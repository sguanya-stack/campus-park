require('dotenv').config();
const dns = require("node:dns");
const cron = require('node-cron');
dns.setServers(["8.8.8.8", "1.1.1.1"]);
const prisma = require("./prismaClient");
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml"
};
const SEATTLE_TIMEZONE = "America/Los_Angeles";
const TRAFFIC_SIMULATION_CRON = "*/5 * * * *";
// Hourly demand curve for Seattle, index = local hour 0-23
// 0 = no demand (empty lots), 1 = fully packed
const HOURLY_DEMAND = [
  0.05, 0.03, 0.03, 0.03, 0.06, 0.12,   // 0–5 am  overnight → early risers
  0.30, 0.66, 0.88, 0.78, 0.64, 0.72,   // 6–11 am morning ramp, peak at 8
  0.82, 0.70, 0.60, 0.62, 0.85, 0.92,   // noon–5pm lunch dip, evening peak at 17
  0.66, 0.46, 0.30, 0.18, 0.12, 0.07    // 6–11 pm taper off
];
const DEFAULT_HOURLY_RATE = 12;
const DEV_ALLOWED_ORIGINS = new Set(
  (process.env.CORS_ORIGIN || "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);

// ── Rate limiting — sliding window per IP ────────────────────────────────────
// Each entry: { timestamps: number[] }  (epoch ms of recent requests)
const rateLimitStore = new Map();

const RATE_LIMIT_RULES = {
  // [route-prefix or "*"]  → { windowMs, max, message }
  "/api/auth/login":    { windowMs: 60_000,  max: 10,  message: "Too many login attempts, please wait 1 minute." },
  "/api/auth/register": { windowMs: 60_000,  max: 5,   message: "Too many registrations from this IP." },
  "/api/bookings":      { windowMs: 60_000,  max: 20,  message: "Too many reservation requests, slow down." },
  "/api/spots/stream":  { windowMs: 60_000,  max: 10,  message: "Too many stream connections." },
  "*":                  { windowMs: 60_000,  max: 300, message: "Rate limit exceeded. Please try again shortly." }
};

function getRateLimit(pathname) {
  for (const [prefix, rule] of Object.entries(RATE_LIMIT_RULES)) {
    if (prefix !== "*" && pathname.startsWith(prefix)) return rule;
  }
  return RATE_LIMIT_RULES["*"];
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

/** Returns true if the request is rate-limited. Writes 429 and returns true. */
function checkRateLimit(req, res, pathname) {
  if (pathname.startsWith("/node_modules") || !pathname.startsWith("/api")) return false;

  const rule = getRateLimit(pathname);
  const ip = getClientIp(req);
  const key = `${ip}:${pathname.startsWith("/api/auth") || pathname.startsWith("/api/bookings") ? pathname : "*"}`;
  const now = Date.now();
  const cutoff = now - rule.windowMs;

  let entry = rateLimitStore.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    rateLimitStore.set(key, entry);
  }

  // Evict timestamps outside the window
  entry.timestamps = entry.timestamps.filter(t => t > cutoff);
  entry.timestamps.push(now);

  const remaining = Math.max(0, rule.max - entry.timestamps.length);
  const resetSec = Math.ceil(rule.windowMs / 1000);

  res.setHeader("X-RateLimit-Limit", String(rule.max));
  res.setHeader("X-RateLimit-Remaining", String(remaining));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil((cutoff + rule.windowMs) / 1000)));

  if (entry.timestamps.length > rule.max) {
    res.setHeader("Retry-After", String(resetSec));
    res.writeHead(429, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: rule.message, retryAfterSeconds: resetSec }));
    return true;
  }
  return false;
}

// Prune the rate-limit store every 5 minutes to prevent unbounded memory growth
setInterval(() => {
  const cutoff = Date.now() - 120_000;
  for (const [key, entry] of rateLimitStore.entries()) {
    entry.timestamps = entry.timestamps.filter(t => t > cutoff);
    if (entry.timestamps.length === 0) rateLimitStore.delete(key);
  }
}, 5 * 60_000);

// ── Idempotency key store ─────────────────────────────────────────────────────
// Prevents duplicate mutations when clients retry on network failure.
// Key: "<userId>:<idempotency-key>"  Value: { status, body, cachedAt }
const idempotencyStore = new Map();
const IDEMPOTENCY_TTL = 5 * 60_000; // 5 minutes

function getIdempotencyKey(req, userId) {
  const key = req.headers["idempotency-key"];
  if (!key || typeof key !== "string" || key.length > 128) return null;
  return `${userId}:${key}`;
}

function checkIdempotency(storeKey) {
  const cached = idempotencyStore.get(storeKey);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt > IDEMPOTENCY_TTL) {
    idempotencyStore.delete(storeKey);
    return null;
  }
  return cached;
}

function saveIdempotency(storeKey, status, body) {
  idempotencyStore.set(storeKey, { status, body, cachedAt: Date.now() });
}

setInterval(() => {
  const cutoff = Date.now() - IDEMPOTENCY_TTL;
  for (const [k, v] of idempotencyStore.entries()) {
    if (v.cachedAt < cutoff) idempotencyStore.delete(k);
  }
}, 5 * 60_000);

// ── Structured logger ─────────────────────────────────────────────────────────
// Emits JSON-lines to stdout — pipe to any log aggregator (Datadog, Loki, etc.)
const LOG_LEVEL_RANK = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LOG_LEVEL  = LOG_LEVEL_RANK[process.env.LOG_LEVEL] ?? LOG_LEVEL_RANK.info;

function log(level, message, fields = {}) {
  if ((LOG_LEVEL_RANK[level] ?? 99) < MIN_LOG_LEVEL) return;
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...fields
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(entry));
}

const logger = {
  debug: (msg, f) => log("debug", msg, f),
  info:  (msg, f) => log("info",  msg, f),
  warn:  (msg, f) => log("warn",  msg, f),
  error: (msg, f) => log("error", msg, f),
};

// ── Feature flags ─────────────────────────────────────────────────────────────
// Stored in DB, cached in-memory with 30-second TTL for hot reads.
// Defaults seeded on first boot.
const DEFAULT_FLAGS = [
  { key: "surge_pricing",      enabled: true,  description: "Dynamic surge pricing based on occupancy" },
  { key: "demand_prediction",  enabled: true,  description: "Show predicted availability in 1 hour" },
  { key: "heatmap",            enabled: true,  description: "Show demand heatmap on the map" },
  { key: "web_push",           enabled: false, description: "Web push notifications for expiry alerts" },
  { key: "marker_clusters",    enabled: true,  description: "Cluster map markers at low zoom levels" },
  { key: "funnel_tracking",    enabled: true,  description: "Client-side funnel analytics event collection" }
];

let flagCache = null;
let flagCacheExpiry = 0;
const FLAG_CACHE_TTL = 30_000;

async function ensureDefaultFlags() {
  for (const f of DEFAULT_FLAGS) {
    await prisma.featureFlag.upsert({
      where: { key: f.key },
      create: f,
      update: { description: f.description } // don't overwrite admin's enabled choice
    });
  }
}

async function getFlags() {
  if (flagCache && Date.now() < flagCacheExpiry) return flagCache;
  const rows = await prisma.featureFlag.findMany();
  flagCache = Object.fromEntries(rows.map(r => [r.key, r.enabled]));
  flagCacheExpiry = Date.now() + FLAG_CACHE_TTL;
  return flagCache;
}

async function invalidateFlagCache() {
  flagCache = null;
}

// ── SSE client registry — broadcast spot availability after every traffic tick
const sseClients = new Set();
function broadcastSpots(spotData) {
  if (sseClients.size === 0) return;
  const payload = `data: ${JSON.stringify(spotData)}\n\n`;
  for (const client of sseClients) {
    try { client.write(payload); } catch { sseClients.delete(client); }
  }
}

const server = http.createServer(async (req, res) => {
  // ── Per-request correlation ID ─────────────────────────────────────────────
  const requestId = req.headers["x-request-id"] || crypto.randomUUID();
  req.requestId = requestId;
  const reqStart = Date.now();

  // Emit access-log on response finish (captures real status code)
  res.on("finish", () => {
    const ms = Date.now() - reqStart;
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
    logger[level]("request", {
      requestId,
      method:     req.method,
      path:       req.url,
      status:     res.statusCode,
      durationMs: ms,
      ip:         getClientIp(req),
      userId:     req.userId ?? null
    });
  });

  try {
    const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = decodeURIComponent(parsedUrl.pathname);
    const origin = req.headers.origin;

    if (origin && DEV_ALLOWED_ORIGINS.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-ID, Idempotency-Key");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.setHeader("X-Request-ID", requestId);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Rate limiting — checked before any business logic
    if (checkRateLimit(req, res, pathname)) return;

    if (req.method === 'GET' && parsedUrl.pathname === '/api/recommend') {
      try {
        const zone = parsedUrl.searchParams.get('zone');
        const sortBy = parsedUrl.searchParams.get('sortBy');
        const search = parsedUrl.searchParams.get('search');
        const lat = parseFloat(parsedUrl.searchParams.get('lat'));
        const lng = parseFloat(parsedUrl.searchParams.get('lng'));
        let orderByLogic = { availableSpots: 'desc' };
        if (sortBy === 'price') {
          orderByLogic = { pricePerHour: 'asc' };
        }

        const whereClause = {
          availableSpots: { gt: 0 },
          status: 'active'
        };

        if (zone && zone !== 'all' && zone !== 'All Zones') {
          whereClause.zone = zone;
        }

        if (search) {
          whereClause.OR = [
            { name: { contains: search, mode: 'insensitive' } },
            { address: { contains: search, mode: 'insensitive' } }
          ];
        }

        const recommendedSpots = await prisma.parkingSpot.findMany({
          where: whereClause,
          orderBy: orderByLogic,
          take: 50
        });

        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          prisma.searchLog.create({ data: { lat, lng } }).catch(() => {});
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, count: recommendedSpots.length, data: recommendedSpots }));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: error.message }));
      }
      return;
    }

    // /api/reserve removed — unauthenticated, superseded by /api/bookings which enforces session

    if (pathname.startsWith("/api/")) {
      await handleApi(req, res, parsedUrl, pathname);
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    await serveStatic(req, res, pathname);
  } catch (error) {
    logger.error("unhandled_request_error", {
      requestId: req.requestId,
      method: req.method,
      path: req.url,
      error: String(error.message || error),
      stack: error.stack?.split("\n").slice(0, 5).join(" | ")
    });
    sendJson(res, 500, { error: "Server error", requestId: req.requestId });
  }
});

server.listen(PORT, () => {
  logger.info("server_start", { port: PORT, url: `http://localhost:${PORT}` });
});

server.on("error", (error) => {
  if (error && error.code === "EADDRINUSE") {
    logger.error("port_in_use", { port: PORT, hint: `PORT=${PORT + 1} npm start` });
    process.exit(1);
  }
  logger.error("server_error", { error: String(error) });
  process.exit(1);
});

setupScheduledJobs();
ensureDefaultFlags().catch(err => logger.error("flag_seed_error", { error: err.message }));

async function handleApi(req, res, url, pathname) {
  // ── Feature flags ─────────────────────────────────────────────────────────
  // GET /api/flags — public, returns {key: boolean} map for client features
  if (req.method === "GET" && pathname === "/api/flags") {
    const flags = await getFlags();
    sendJson(res, 200, flags);
    return;
  }

  // PATCH /api/admin/flags/:key — admin toggles a flag
  if (req.method === "PATCH" && pathname.startsWith("/api/admin/flags/")) {
    const session = await requireAdmin(req, res);
    if (!session) return;
    const flagKey = decodeURIComponent(pathname.replace("/api/admin/flags/", ""));
    const body = await readBody(req);
    if (typeof body.enabled !== "boolean") {
      sendJson(res, 400, { error: "enabled (boolean) is required" });
      return;
    }
    const updated = await prisma.featureFlag.upsert({
      where: { key: flagKey },
      create: { key: flagKey, enabled: body.enabled },
      update: { enabled: body.enabled }
    });
    await invalidateFlagCache();
    logger.info("feature_flag_toggled", { requestId: req.requestId, key: flagKey, enabled: body.enabled, by: session.user.name });
    sendJson(res, 200, { key: updated.key, enabled: updated.enabled });
    return;
  }

  // GET /api/admin/flags — admin: list all flags with metadata
  if (req.method === "GET" && pathname === "/api/admin/flags") {
    const session = await requireAdmin(req, res);
    if (!session) return;
    const flags = await prisma.featureFlag.findMany({ orderBy: { key: "asc" } });
    sendJson(res, 200, flags);
    return;
  }

  if (req.method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/login") {
    await ensureDefaultAdminUser();
    const body = await readBody(req);
    const name = String(body.name || "").trim();
    const password = String(body.password || "");
    if (!name || !password) {
      sendJson(res, 400, { error: "Name and password are required" });
      return;
    }
    const user = await prisma.appUser.findUnique({
      where: { name }
    });
    if (!user || !verifyPassword(password, user.passwordSalt, user.passwordHash)) {
      sendJson(res, 401, { error: "Invalid credentials" });
      return;
    }
    const token = crypto.randomUUID();
    await prisma.$transaction([
      prisma.appSession.deleteMany({
        where: { userId: user.id }
      }),
      prisma.appSession.create({
        data: {
          token,
          userId: user.id
        }
      })
    ]);
    req.userId = user.id;
    logger.info("user_login", { requestId: req.requestId, userId: user.id, role: user.role });
    sendJson(res, 200, {
      token,
      user: {
        id: user.id,
        name: user.name,
        role: user.role
      }
    });
    return;
  }

  if (
    req.method === "POST" &&
    (pathname === "/api/auth/register" || pathname === "/api/signup")
  ) {
    await ensureDefaultAdminUser();
    const body = await readBody(req);
    const name = String(body.name || "").trim();
    const password = String(body.password || "");
    if (!name || !password) {
      sendJson(res, 400, { error: "Name and password are required" });
      return;
    }
    if (password.length < 6) {
      sendJson(res, 400, { error: "Password must be at least 6 characters" });
      return;
    }
    if (!/^[\p{L}\p{N} _-]{2,20}$/u.test(name)) {
      sendJson(res, 400, { error: "Name must be 2-20 characters (letters/numbers/space/_/-)" });
      return;
    }
    const passwordSalt = crypto.randomBytes(16).toString("hex");
    const passwordHash = hashPassword(password, passwordSalt);
    try {
      await prisma.appUser.create({
        data: {
          name,
          role: "student",
          passwordSalt,
          passwordHash
        }
      });
    } catch (error) {
      if (error && error.code === "P2002") {
        res.statusCode = 409;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(
          JSON.stringify({
            success: false,
            message: "Username is already taken. Please try another one."
          })
        );
        return;
      }
      throw error;
    }
    logger.info("user_register", { requestId: req.requestId, name });
    sendJson(res, 201, { ok: true });
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/logout") {
    const session = await requireSession(req, res);
    if (!session) {
      return;
    }
    await prisma.appSession.delete({
      where: { token: session.token }
    });
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && pathname === "/api/session") {
    const session = await requireSession(req, res);
    if (!session) {
      return;
    }
    sendJson(res, 200, {
      user: {
        id: session.user.id,
        name: session.user.name,
        role: session.user.role
      }
    });
    return;
  }

  // ── SSE: real-time spot availability stream ─────────────────────────────────
  if (req.method === "GET" && pathname === "/api/spots/stream") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.write(": connected\n\n");

    // Send current spot state immediately on connect
    const currentSpots = await prisma.parkingSpot.findMany({
      where: { status: "active" },
      orderBy: { name: "asc" }
    });
    res.write(`data: ${JSON.stringify(currentSpots.map(s => ({
      id: s.id, availableSpots: s.availableSpots, totalSpots: s.totalSpots, pricePerHour: Number(s.pricePerHour)
    })))}\n\n`);

    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  if (req.method === "GET" && pathname === "/api/spots") {
    const at = parseDate(url.searchParams.get("at")) || new Date();
    const zone = url.searchParams.get("zone");
    const search = String(url.searchParams.get("search") || "").trim();
    const since = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const spots = await prisma.parkingSpot.findMany({
      where: {
        zone: zone && zone !== "all" ? zone : undefined,
        OR: search
          ? [
              { name: { contains: search, mode: "insensitive" } },
              { address: { contains: search, mode: "insensitive" } }
            ]
          : undefined
      },
      orderBy: [{ zone: "asc" }, { name: "asc" }]
    });

    const recentSearches = await prisma.searchLog.findMany({
      where: {
        createdAt: { gte: since }
      },
      select: { lat: true, lng: true }
    });

    const mapped = spots.map((spot, index) => {
      const mappedSpot = withPrismaSpotStatus(spot, at);
      const coords = getSpotCoordsForDemand(mappedSpot, index);
      const demandCount = coords ? countNearbySearches(coords, recentSearches, 500) : 0;
      const highDemand = demandCount > 20;
      const basePrice = Number(mappedSpot.pricePerHour);
      const adjustedPrice = Number.isFinite(basePrice)
        ? Number((basePrice * (highDemand ? 1.5 : 1)).toFixed(2))
        : mappedSpot.pricePerHour;

      return {
        ...mappedSpot,
        pricePerHour: adjustedPrice,
        surgeMultiplier: highDemand ? 1.5 : 1,
        highDemand,
        demandSearchCount: demandCount
      };
    });
    sendJson(res, 200, { spots: mapped });
    return;
  }

  // ── AI En-route Parking Recommendation ────────────────────────────────────
  if (req.method === "GET" && pathname === "/api/recommend-enroute") {
    const fromLat = parseFloat(url.searchParams.get("fromLat"));
    const fromLng = parseFloat(url.searchParams.get("fromLng"));
    // Destination defaults to Seattle campus centre (Space Needle area)
    const toLat   = parseFloat(url.searchParams.get("toLat")  || "47.6205");
    const toLng   = parseFloat(url.searchParams.get("toLng")  || "-122.3493");

    if (!Number.isFinite(fromLat) || !Number.isFinite(fromLng)) {
      sendJson(res, 400, { error: "fromLat and fromLng are required" });
      return;
    }

    // ── Fetch route from OSRM (free, no key) ────────────────────────────────
    let routeGeoJSON = null;
    let routeCoords  = [[fromLng, fromLat], [toLng, toLat]]; // straight-line fallback
    try {
      const osrmUrl = `http://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson`;
      const signal  = typeof AbortSignal?.timeout === "function"
        ? AbortSignal.timeout(6000) : undefined;
      const osrmRes = await fetch(osrmUrl, { signal });
      if (osrmRes.ok) {
        const osrmData = await osrmRes.json();
        const coords   = osrmData?.routes?.[0]?.geometry?.coordinates;
        if (Array.isArray(coords) && coords.length > 1) {
          routeCoords  = coords;
          routeGeoJSON = { type: "LineString", coordinates: coords };
        }
      }
    } catch (e) {
      logger.warn("osrm_failed", { requestId: req.requestId, error: e.message });
    }

    // ── Point-to-route distance (meters, geodetically correct) ─────────────
    function ptSegMeters(lat, lng, aLat, aLng, bLat, bLng) {
      const dx = bLng - aLng, dy = bLat - aLat;
      const lenSq = dx * dx + dy * dy;
      let t = lenSq === 0 ? 0 : ((lng - aLng) * dx + (lat - aLat) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
      const nearLat = aLat + t * dy;
      const nearLng = aLng + t * dx;
      const dLat = (lat - nearLat) * 111320;
      const dLng = (lng - nearLng) * 111320 * Math.cos(lat * Math.PI / 180);
      return Math.sqrt(dLat * dLat + dLng * dLng);
    }
    function minDistToRoute(lat, lng) {
      let minD = Infinity;
      for (let i = 0; i < routeCoords.length - 1; i++) {
        const [aLng, aLat] = routeCoords[i];
        const [bLng, bLat] = routeCoords[i + 1];
        const d = ptSegMeters(lat, lng, aLat, aLng, bLat, bLng);
        if (d < minD) minD = d;
      }
      return minD;
    }

    // ── Shared helpers (same as heatmap section) ────────────────────────────
    function spotPopularityEr(name = "") {
      const n = name.toLowerCase();
      if (n.includes("amazon") || n.includes("sphere")) return 1.00;
      if (n.includes("westlake hub"))  return 0.88;
      if (n.includes("whole foods"))   return 0.82;
      if (n.includes("mohai"))         return 0.72;
      if (n.includes("mercer"))        return 0.68;
      if (n.includes("boren"))         return 0.60;
      if (n.includes("northeastern"))  return 0.55;
      if (n.includes("valley"))        return 0.50;
      if (n.includes("fairview"))      return 0.45;
      return 0.55;
    }
    function hashStrEr(s) {
      let h = 0;
      for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
      return Math.abs(h);
    }
    function spotLatLngEr(spot, idx) {
      const seed = hashStrEr(`${spot.id}${spot.name}${spot.address || ""}${idx}`);
      return [
        47.615    + ((seed % 1000) / 1000 - 0.5) * 0.010,
        -122.3384 + (((seed / 1000) % 1000) / 1000 - 0.5) * 0.012
      ];
    }

    // ── Time-of-day demand ──────────────────────────────────────────────────
    const nowEr = new Date();
    const monthEr = nowEr.getUTCMonth();
    const isDSTEr = monthEr >= 2 && monthEr <= 10;
    const localHourEr = (nowEr.getUTCHours() + 24 + (isDSTEr ? -7 : -8)) % 24;
    const DEMAND_CURVE_ER = [
      0.04, 0.02, 0.02, 0.02, 0.04, 0.09,
      0.24, 0.62, 0.93, 0.81, 0.68, 0.76,
      0.86, 0.74, 0.66, 0.65, 0.82, 0.97,
      0.70, 0.50, 0.34, 0.22, 0.14, 0.07
    ];
    const timeDemandEr = DEMAND_CURVE_ER[localHourEr];

    // ── Fetch and score spots ────────────────────────────────────────────────
    const allSpotsEr = await prisma.parkingSpot.findMany({
      where: { status: "active" },
      orderBy: { name: "asc" }
    });

    const ON_ROUTE_M = 300; // metres — on-route threshold

    const scored = allSpotsEr
      .map((spot, idx) => {
        const [lat, lng] = spotLatLngEr(spot, idx);
        const distM      = Math.round(minDistToRoute(lat, lng));
        const available  = Number(spot.availableSpots || 0);
        const pop        = spotPopularityEr(spot.name);

        // proximityScore: 1 if on route, degrades to 0 at 2 km
        const proxScore  = distM <= ON_ROUTE_M
          ? 1 - distM / ON_ROUTE_M
          : Math.max(0, 1 - distM / 2000);
        const availScore = Math.min(available / 10, 1);
        const crowdScore = 1 - timeDemandEr * pop; // lower crowd = better
        const score      = proxScore * 0.5 + availScore * 0.3 + crowdScore * 0.2;

        return { spot, lat, lng, distM, available, onRoute: distM <= ON_ROUTE_M, score };
      })
      .filter(s => s.available > 0)
      .sort((a, b) => b.score - a.score);

    const results = scored.slice(0, 3).map(({ spot, lat, lng, distM, available, onRoute }) => ({
      ...spot,
      lat,
      lng,
      distM,
      available,
      onRoute,
      isAvailable: true
    }));

    sendJson(res, 200, {
      results,
      route: routeGeoJSON,
      from: { lat: fromLat, lng: fromLng },
      to:   { lat: toLat,   lng: toLng }
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/analytics/heatmap") {
    // ── Realistic, time-varying heatmap ────────────────────────────────────
    // Spots have no lat/lng in the DB; we use the same hash formula as the
    // frontend (app.js getSpotLatLng) so blobs land on top of map pins.
    //
    // Demand changes every 10 minutes via a deterministic seed — all clients
    // in the same window see identical data without any Math.random() drift.
    //
    // Rules:
    //  • Only 3-6 of the ~10 spots are "active" at once (threshold filter)
    //  • Intensity follows an hourly demand curve (peak 8-9am & 5-6pm PT)
    //  • Weekends run at ~30% of weekday volume
    //  • Each active spot gets a Gaussian scatter of points (~85 m radius)

    const allSpots = await prisma.parkingSpot.findMany({
      where:  { status: "active" },
      select: { id: true, name: true, address: true },
      orderBy: { name: "asc" }
    });

    const now        = new Date();
    const utcHour    = now.getUTCHours();
    const month      = now.getUTCMonth();            // 0-11
    const isDST      = month >= 2 && month <= 10;   // rough DST window
    const localHour  = (utcHour + 24 + (isDST ? -7 : -8)) % 24;   // Pacific
    const localDay   = new Date(now.getTime() + (isDST ? -7 : -8) * 3600000).getDay();
    const tenMinSlot = Math.floor(now.getTime() / (10 * 60 * 1000));

    // Hourly demand multiplier 0→1, Pacific time (index = local hour 0-23)
    const DEMAND_CURVE = [
      0.04, 0.02, 0.02, 0.02, 0.04, 0.09,   // 0–5  am  (very quiet)
      0.24, 0.62, 0.93, 0.81, 0.68, 0.76,   // 6–11 am  (morning peak at 8)
      0.86, 0.74, 0.66, 0.65, 0.82, 0.97,   // 12–5 pm  (lunch + evening peak at 17)
      0.70, 0.50, 0.34, 0.22, 0.14, 0.07    // 6–11 pm  (taper off)
    ];
    const weekendFactor = (localDay === 0 || localDay === 6) ? 0.30 : 1.00;
    const globalDemand  = DEMAND_CURVE[localHour] * weekendFactor;

    // How popular each spot is by default (name-matched)
    function spotPopularity(name = "") {
      const n = name.toLowerCase();
      if (n.includes("amazon") || n.includes("sphere")) return 1.00;
      if (n.includes("westlake hub"))                    return 0.88;
      if (n.includes("whole foods"))                     return 0.82;
      if (n.includes("mohai"))                           return 0.72;
      if (n.includes("mercer"))                          return 0.68;
      if (n.includes("boren"))                           return 0.60;
      if (n.includes("northeastern"))                    return 0.55;
      if (n.includes("valley"))                          return 0.50;
      if (n.includes("fairview"))                        return 0.45;
      return 0.55;
    }

    // Deterministic PRNG — no Math.random(), stable per 10-min slot.
    // IMPORTANT: JS ^ (XOR) converts both sides to signed 32-bit, so large h
    // values go negative without the >>> 0 re-cast after every operation.
    function prng(a, b) {
      let h = ((Math.imul(a | 0, 1664525) + (b | 0) + 1013904223) | 0) >>> 0;
      h = (h ^ (h >>> 16)) >>> 0;
      h = Math.imul(h, 0x45d9f3b) >>> 0;
      h = (h ^ (h >>> 16)) >>> 0;
      return h / 4294967296;   // always in [0, 1)
    }

    // Box-Muller: two uniform [0,1] → one standard normal
    function gaussian(u1, u2) {
      return Math.sqrt(-2 * Math.log(Math.max(u1, 1e-10))) * Math.cos(2 * Math.PI * u2);
    }

    // ── MUST match app.js hashString + getSpotLatLng exactly ──────────────
    function hashStr(s) {
      let h = 0;
      for (let i = 0; i < s.length; i++) {
        h = ((h << 5) - h + s.charCodeAt(i)) | 0;
      }
      return Math.abs(h);
    }
    function spotLatLng(spot, idx) {
      const seed = hashStr(`${spot.id}${spot.name}${spot.address || ""}${idx}`);
      return [
        47.615  + ((seed % 1000)          / 1000 - 0.5) * 0.010,
        -122.3384 + (((seed / 1000) % 1000) / 1000 - 0.5) * 0.012
      ];
    }
    // ──────────────────────────────────────────────────────────────────────

    const points = [];
    allSpots.forEach((spot, idx) => {
      const [cLat, cLng] = spotLatLng(spot, idx);
      const pop = spotPopularity(spot.name);

      // Each 10-min slot gives every spot a random "surge" factor 0.1–1.2
      // This is what makes only a subset of spots hot at any given time.
      const surge  = 0.10 + prng(tenMinSlot + idx * 7, idx + 3) * 1.10;
      const demand = globalDemand * pop * surge;

      if (demand < 0.12) return;  // below threshold → spot is quiet, skip it

      const n     = Math.round(demand * 28);  // up to ~28 points per spot
      const sigma = 0.00078;                  // ≈85 m Gaussian radius

      for (let i = 0; i < n; i++) {
        const base = tenMinSlot * 997 + idx * 31 + i;
        const u1 = prng(base * 2,     13);
        const u2 = prng(base * 2 + 1, 17);
        const u3 = prng(base * 2,     19);
        const u4 = prng(base * 2 + 1, 23);
        points.push({
          lat: cLat + gaussian(u1, u2) * sigma,
          lng: cLng + gaussian(u3, u4) * sigma
        });
      }
    });

    sendJson(res, 200, points);
    return;
  }

  // ── Funnel analytics ─────────────────────────────────────────────────────
  // POST /api/analytics/events — client sends batched funnel events
  if (req.method === "POST" && pathname === "/api/analytics/events") {
    const body = await readBody(req);
    const events = Array.isArray(body) ? body : [body];
    const session = await getSession(req); // optional auth
    const userId = session?.user?.id ?? null;

    const VALID_EVENTS = new Set(["search", "spot_view", "reserve_start", "reserve_complete", "check_in", "check_out"]);
    const toInsert = events
      .filter(e => e && VALID_EVENTS.has(e.event) && typeof e.sessionId === "string" && e.sessionId.length <= 64)
      .slice(0, 20) // max 20 events per batch
      .map(e => ({
        sessionId: e.sessionId,
        userId,
        event:     e.event,
        spotId:    typeof e.spotId === "string" ? e.spotId : null,
        meta:      e.meta && typeof e.meta === "object" ? e.meta : undefined
      }));

    if (toInsert.length > 0) {
      await prisma.funnelEvent.createMany({ data: toInsert });
    }
    sendJson(res, 204, {});
    return;
  }

  // GET /api/analytics/funnel — admin: conversion rates for each funnel step
  if (req.method === "GET" && pathname === "/api/analytics/funnel") {
    const session = await requireAdmin(req, res);
    if (!session) return;

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // last 7 days
    const STEPS = ["search", "spot_view", "reserve_start", "reserve_complete", "check_in", "check_out"];
    const counts = await prisma.funnelEvent.groupBy({
      by: ["event"],
      _count: { sessionId: true },
      where: { createdAt: { gte: since } }
    });
    const countMap = Object.fromEntries(counts.map(c => [c.event, c._count.sessionId]));
    const funnel = STEPS.map((step, i) => ({
      step,
      count: countMap[step] || 0,
      conversionFromPrev: i === 0
        ? 1
        : (countMap[STEPS[i - 1]] ? (countMap[step] || 0) / countMap[STEPS[i - 1]] : 0)
    }));
    sendJson(res, 200, { funnel, since: since.toISOString() });
    return;
  }

  if (req.method === "POST" && pathname === "/api/spots") {
    const session = await requireAdmin(req, res);
    if (!session) return;
    const body = await readBody(req);
    const id = String(body.id || "").trim().toUpperCase();
    const zone = String(body.zone || "").trim();
    const location = String(body.location || "").trim();
    if (!id || !zone || !location) {
      sendJson(res, 400, { error: "id, zone, location are required" });
      return;
    }
    const existingSpot = await prisma.parkingSpot.findFirst({
      where: {
        OR: [{ slug: id.toLowerCase() }, { name: location }]
      }
    });
    if (existingSpot) {
      sendJson(res, 409, { error: "Spot id already exists" });
      return;
    }
    const createdSpot = await prisma.parkingSpot.create({
      data: {
        slug: id.toLowerCase(),
        name: location,
        address: location,
        zone,
        totalSpots: 1,
        availableSpots: 1,
        status: "active"
      }
    });
    sendJson(res, 201, { ok: true, spot: withPrismaSpotStatus(createdSpot, new Date()) });
    return;
  }

  // POST /api/spots/:id/rate  — submit a 1-5 star rating after checkout
  if (req.method === "POST" && pathname.startsWith("/api/spots/") && pathname.endsWith("/rate")) {
    const session = await requireSession(req, res);
    if (!session) return;
    const spotId = decodeURIComponent(pathname.replace("/api/spots/", "").replace("/rate", ""));
    const body = await parseBody(req);
    const stars = Number(body.stars);
    const reservationId = String(body.reservationId || "");
    if (!stars || stars < 1 || stars > 5) {
      sendJson(res, 400, { error: "stars must be 1–5" });
      return;
    }
    // Verify the reservation belongs to this user and is COMPLETED
    const reservation = await prisma.reservation.findFirst({
      where: { id: reservationId, userId: session.user.id, spotId, status: "COMPLETED" }
    });
    if (!reservation) {
      sendJson(res, 403, { error: "Reservation not found or not completed" });
      return;
    }
    const rating = await prisma.spotRating.upsert({
      where: { reservationId },
      create: { spotId, userId: session.user.id, reservationId, stars },
      update: { stars }
    });
    sendJson(res, 200, { ok: true, rating });
    return;
  }

  // GET /api/spots/:id/rating  — get average rating for a spot
  if (req.method === "GET" && pathname.startsWith("/api/spots/") && pathname.endsWith("/rating")) {
    const spotId = decodeURIComponent(pathname.replace("/api/spots/", "").replace("/rating", ""));
    const agg = await prisma.spotRating.aggregate({
      where: { spotId },
      _avg: { stars: true },
      _count: { stars: true }
    });
    sendJson(res, 200, {
      average: agg._avg.stars ? +Number(agg._avg.stars).toFixed(1) : null,
      count: agg._count.stars
    });
    return;
  }

  if (req.method === "PATCH" && pathname.startsWith("/api/spots/") && pathname.endsWith("/toggle")) {
    const session = await requireAdmin(req, res);
    if (!session) return;
    const spotId = decodeURIComponent(pathname.replace("/api/spots/", "").replace("/toggle", ""));
    const spot = await prisma.parkingSpot.findUnique({
      where: { id: spotId }
    });
    if (!spot) {
      sendJson(res, 404, { error: "Spot not found" });
      return;
    }
    const updatedSpot = await prisma.parkingSpot.update({
      where: { id: spotId },
      data: { status: spot.status === "active" ? "inactive" : "active" }
    });
    sendJson(res, 200, { ok: true, spot: withPrismaSpotStatus(updatedSpot, new Date()) });
    return;
  }

  if (req.method === "GET" && pathname === "/api/bookings/me") {
    const session = await requireSession(req, res);
    if (!session) return;
    const items = await prisma.reservation.findMany({
      where: {
        userId: session.user.id,
        status: { in: ["PENDING", "ACTIVE", "CONFIRMED", "COMPLETED"] }
      },
      orderBy: [{ status: "asc" }, { startTime: "asc" }]
    });
    sendJson(res, 200, {
      bookings: items.map((item) =>
        mapReservationForClient(item, session.user.name, session.user.role)
      )
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/bookings/me/export") {
    const session = await requireSession(req, res);
    if (!session) return;
    const items = await prisma.reservation.findMany({
      where: {
        userId: session.user.id,
        status: { in: ["PENDING", "ACTIVE", "CONFIRMED", "COMPLETED"] }
      },
      orderBy: [{ status: "asc" }, { startTime: "asc" }]
    });
    const filename = `campus-parking-${encodeURIComponent(session.user.name)}.json`;
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.end(
      JSON.stringify(
        items.map((item) => mapReservationForClient(item, session.user.name, session.user.role)),
        null,
        2
      )
    );
    return;
  }

  if (req.method === "GET" && pathname === "/api/admin/bookings/export") {
    const session = await requireSession(req, res);
    if (!session) return;
    if (session.user.role !== "admin") { sendJson(res, 403, { error: "Forbidden" }); return; }
    const items = await prisma.reservation.findMany({
      include: { spot: true },
      orderBy: { createdAt: "desc" }
    });
    const csvCols = ["id", "userId", "spotId", "spotName", "zone", "plate", "phone", "status", "startTime", "endTime", "createdAt", "finalAmount", "ticketCode"];
    const esc = v => v == null ? "" : `"${String(v).replace(/"/g, '""')}"`;
    const rows = items.map(r => [
      r.id, r.userId, r.spotId, r.spot?.name ?? "", r.spot?.zone ?? "",
      r.plateNumber ?? "", r.phoneNumber ?? "", r.status,
      r.startTime?.toISOString() ?? "", r.endTime?.toISOString() ?? "",
      r.createdAt?.toISOString() ?? "", r.finalAmount ?? "", r.ticketCode ?? ""
    ].map(esc).join(","));
    const csv = [csvCols.join(","), ...rows].join("\r\n");
    const filename = `campuspark-bookings-${new Date().toISOString().slice(0, 10)}.csv`;
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.end(csv);
    return;
  }

  if (
    req.method === "POST" &&
    (pathname === "/api/bookings" || pathname === "/api/reservations")
  ) {
    const session = await requireSession(req, res);
    if (!session) return;

    // Idempotency: replay cached response for duplicate requests
    const idemKey = getIdempotencyKey(req, session.user.id);
    if (idemKey) {
      const cached = checkIdempotency(idemKey);
      if (cached) {
        res.setHeader("Idempotency-Replayed", "true");
        sendJson(res, cached.status, cached.body);
        return;
      }
    }

    const body = await readBody(req);

    const spotId = String(body.spotId || "").trim();
    const plate = String(body.plate || "").trim().toUpperCase();
    const phone = String(body.phone || "").trim();
    const start = parseDate(body.startTime);
    const durationHours = Number(body.durationHours);
    const end =
      parseDate(body.endTime) ||
      (start && Number.isFinite(durationHours)
        ? new Date(start.getTime() + durationHours * 60 * 60 * 1000)
        : null);

    if (!spotId || !start || !end) {
      sendJson(res, 400, { error: "spotId, startTime, and endTime or durationHours are required" });
      return;
    }
    if (!isPlateValid(plate)) {
      sendJson(res, 400, { error: "Invalid plate format" });
      return;
    }
    if (!isPhoneValid(phone)) {
      sendJson(res, 400, {
        error:
          "Invalid phone format. Please enter a 10-digit number (e.g., 123-456-7890 or 1234567890)"
      });
      return;
    }
    if (end <= start) {
      sendJson(res, 400, { error: "End time must be later than start time" });
      return;
    }
    if (Number.isFinite(durationHours) && (durationHours < 1 || durationHours > 4)) {
      sendJson(res, 400, { error: "Duration must be 1-4 hours" });
      return;
    }
    if (start < new Date()) {
      sendJson(res, 400, { error: "Start time must be in the future" });
      return;
    }

    const result = await createReservation({
      userId: session.user.id,
      userName: session.user.name,
      userRole: session.user.role,
      spotId,
      startTime: start,
      endTime: end,
      plateNumber: plate || "TBD",
      phoneNumber: phone || "TBD"
    });

    if (!result.success) {
      sendJson(res, 409, { error: result.message });
      return;
    }

    const responseBody = { booking: result.data };
    if (idemKey) saveIdempotency(idemKey, 201, responseBody);
    sendJson(res, 201, responseBody);
    return;
  }

  if (req.method === "POST" && pathname === "/api/check-in") {
    const session = await requireSession(req, res);
    if (!session) return;

    const body = await readBody(req);
    const reservationId = String(body.reservationId || "").trim();
    const ticketCode = String(body.ticketCode || "").trim();

    if (!reservationId || !/^\d{6}$/.test(ticketCode)) {
      sendJson(res, 400, { error: "reservationId and a 6-digit ticketCode are required" });
      return;
    }

    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId }
    });

    if (!reservation) {
      sendJson(res, 404, { error: "Reservation not found" });
      return;
    }

    if (reservation.userId !== session.user.id && session.user.role !== "admin") {
      sendJson(res, 403, { error: "Forbidden" });
      return;
    }

    if (reservation.status !== "PENDING") {
      sendJson(res, 409, { error: "Only PENDING reservations can be checked in" });
      return;
    }

    try {
      const checkedInReservation = await prisma.reservation.update({
        where: { id: reservationId },
        data: {
          status: "ACTIVE",
          ticketCode,
          checkInTime: new Date()
        }
      });

      sendJson(res, 200, {
        ok: true,
        booking: mapReservationForClient(checkedInReservation, session.user.name, session.user.role)
      });
    } catch (error) {
      if (error && error.code === "P2002") {
        sendJson(res, 409, { error: "This ticket code has already been used" });
        return;
      }
      throw error;
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/check-out") {
    const session = await requireSession(req, res);
    if (!session) return;

    const body = await readBody(req);
    const reservationId = String(body.reservationId || "").trim();
    if (!reservationId) {
      sendJson(res, 400, { error: "reservationId is required" });
      return;
    }

    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { spot: true }
    });

    if (!reservation) {
      sendJson(res, 404, { error: "Reservation not found" });
      return;
    }

    if (reservation.userId !== session.user.id && session.user.role !== "admin") {
      sendJson(res, 403, { error: "Forbidden" });
      return;
    }

    if (reservation.status !== "ACTIVE") {
      sendJson(res, 409, { error: "Only ACTIVE reservations can be checked out" });
      return;
    }

    const checkOutTime = new Date();
    const billingStartTime = reservation.checkInTime || reservation.startTime;
    const finalAmount = calculateReservationSettlement(
      billingStartTime,
      checkOutTime,
      reservation.spot?.pricePerHour
    );

    const checkedOutReservation = await prisma.$transaction(async (tx) => {
      // Clamped increment: LEAST ensures availableSpots never exceeds totalSpots
      await tx.$executeRaw`
        UPDATE "ParkingSpot"
        SET "availableSpots" = LEAST("availableSpots" + 1, "totalSpots")
        WHERE id = ${reservation.spotId}
      `;

      return tx.reservation.update({
        where: { id: reservationId },
        data: {
          status: "COMPLETED",
          checkOutTime,
          finalAmount
        }
      });
    });

    sendJson(res, 200, {
      ok: true,
      booking: mapReservationForClient(checkedOutReservation, session.user.name, session.user.role)
    });
    return;
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/bookings/")) {
    const session = await requireSession(req, res);
    if (!session) return;
    const bookingId = pathname.replace("/api/bookings/", "");
    const booking = await prisma.reservation.findUnique({
      where: { id: bookingId }
    });
    if (!booking) {
      sendJson(res, 404, { error: "Booking not found" });
      return;
    }
    if (booking.userId !== session.user.id && session.user.role !== "admin") {
      sendJson(res, 403, { error: "Forbidden" });
      return;
    }

    await prisma.$transaction(async (tx) => {
      if (booking.status === "PENDING" || booking.status === "ACTIVE" || booking.status === "CONFIRMED") {
        await tx.$executeRaw`
          UPDATE "ParkingSpot"
          SET "availableSpots" = LEAST("availableSpots" + 1, "totalSpots")
          WHERE id = ${booking.spotId}
        `;
      }

      await tx.reservation.update({
        where: { id: bookingId },
        data: { status: "CANCELLED" }
      });
    });

    sendJson(res, 200, { ok: true });
    return;
  }

  // ── Admin analytics dashboard ────────────────────────────────────────────
  if (req.method === "GET" && pathname === "/api/admin/analytics") {
    const session = await requireAdmin(req, res);
    if (!session) return;

    const now = new Date();
    const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [recentReservations, spots] = await Promise.all([
      prisma.reservation.findMany({
        where: { createdAt: { gte: since24h } },
        select: { createdAt: true, finalAmount: true, spotId: true, status: true }
      }),
      prisma.parkingSpot.findMany({
        where: { status: "active" },
        select: { id: true, zone: true, pricePerHour: true }
      })
    ]);

    // Hourly booking counts for last 24 h
    const hourlyCounts = Array(24).fill(0);
    const hourlyRevenue = Array(24).fill(0);
    for (const r of recentReservations) {
      const hrsAgo = Math.floor((now - new Date(r.createdAt)) / 3_600_000);
      const bucket = 23 - Math.min(23, hrsAgo);
      hourlyCounts[bucket]++;
      if (r.finalAmount) hourlyRevenue[bucket] += Number(r.finalAmount);
    }

    // Revenue per zone (estimated from completed reservations today)
    const spotZone = new Map(spots.map(s => [s.id, s.zone || "Other"]));
    const zoneRevMap = {};
    for (const r of recentReservations) {
      if (r.finalAmount == null) continue;
      const zone = spotZone.get(r.spotId) || "Other";
      zoneRevMap[zone] = (zoneRevMap[zone] || 0) + Number(r.finalAmount);
    }

    // Today's total revenue
    const todayRevenue = recentReservations
      .filter(r => new Date(r.createdAt) >= todayStart && r.finalAmount != null)
      .reduce((sum, r) => sum + Number(r.finalAmount), 0);

    const hourLabels = Array.from({ length: 24 }, (_, i) => {
      const d = new Date(since24h.getTime() + (i + 1) * 3_600_000);
      return `${String(d.getHours()).padStart(2, "0")}:00`;
    });

    sendJson(res, 200, {
      todayRevenue: +todayRevenue.toFixed(2),
      hourlyBookings: { labels: hourLabels, data: hourlyCounts },
      hourlyRevenue:  { labels: hourLabels, data: hourlyRevenue.map(v => +v.toFixed(2)) },
      zoneRevenue: {
        labels: Object.keys(zoneRevMap),
        data: Object.values(zoneRevMap).map(v => +v.toFixed(2))
      }
    });
    return;
  }

  // ── Session & retention metrics ───────────────────────────────────────────
  if (req.method === "GET" && pathname === "/api/admin/metrics") {
    const session = await requireAdmin(req, res);
    if (!session) return;

    const now     = new Date();
    const oneDayAgo  = new Date(now - 1   * 86_400_000);
    const sevenDaysAgo = new Date(now - 7 * 86_400_000);
    const thirtyDaysAgo = new Date(now - 30 * 86_400_000);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [dauRows, wauRows, mauRows, newUsersToday, newUsersWeek, totalUsers,
           dauSessions, wauSessions, d7Bookings, d30Bookings] = await Promise.all([
      // DAU — unique authenticated funnel sessions today
      prisma.funnelEvent.findMany({ where: { userId: { not: null }, createdAt: { gte: todayStart } }, select: { userId: true }, distinct: ["userId"] }),
      prisma.funnelEvent.findMany({ where: { userId: { not: null }, createdAt: { gte: sevenDaysAgo } }, select: { userId: true }, distinct: ["userId"] }),
      prisma.funnelEvent.findMany({ where: { userId: { not: null }, createdAt: { gte: thirtyDaysAgo } }, select: { userId: true }, distinct: ["userId"] }),
      prisma.appUser.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.appUser.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      prisma.appUser.count(),
      // Anonymous sessions (DAU by sessionId)
      prisma.funnelEvent.findMany({ where: { createdAt: { gte: todayStart } }, select: { sessionId: true }, distinct: ["sessionId"] }),
      prisma.funnelEvent.findMany({ where: { createdAt: { gte: sevenDaysAgo } }, select: { sessionId: true }, distinct: ["sessionId"] }),
      prisma.reservation.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      prisma.reservation.count({ where: { createdAt: { gte: thirtyDaysAgo } } })
    ]);

    // 7-day DAU trend (bookings per day as proxy, available without funnel events in early data)
    const daysAgo7 = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now);
      d.setDate(d.getDate() - (6 - i));
      return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    });
    const bookingsByDay = await prisma.reservation.groupBy({
      by: ["createdAt"],
      _count: true,
      where: { createdAt: { gte: sevenDaysAgo } }
    });
    // Bucket by day
    const dayBuckets = daysAgo7.map(d => {
      const next = new Date(d.getTime() + 86_400_000);
      const count = bookingsByDay
        .filter(r => new Date(r.createdAt) >= d && new Date(r.createdAt) < next)
        .reduce((s, r) => s + r._count, 0);
      return { date: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }), bookings: count };
    });

    sendJson(res, 200, {
      dau:           dauRows.length,
      wau:           wauRows.length,
      mau:           mauRows.length,
      dauSessions:   dauSessions.length,
      wauSessions:   wauSessions.length,
      newUsersToday,
      newUsersWeek,
      totalUsers,
      d7Bookings,
      d30Bookings,
      retentionD7:   totalUsers > 0 ? +(wauRows.length / Math.max(totalUsers, 1) * 100).toFixed(1) : 0,
      dauTrend:      dayBuckets
    });
    return;
  }

  // ── OpenAPI spec + Swagger UI ─────────────────────────────────────────────
  if (req.method === "GET" && pathname === "/api/openapi.json") {
    try {
      const spec = await fs.readFile(path.join(ROOT, "openapi.json"), "utf8");
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(spec);
    } catch {
      sendJson(res, 404, { error: "openapi.json not found" });
    }
    return;
  }

  if (req.method === "GET" && pathname === "/api/docs") {
    const swaggerHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CampusPark API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>body{margin:0}.swagger-ui .topbar{background:#1e3a5f}</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: "/api/openapi.json",
      dom_id: "#swagger-ui",
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: "BaseLayout",
      deepLinking: true
    });
  </script>
</body>
</html>`;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(swaggerHtml);
    return;
  }

  if (req.method === "GET" && pathname === "/api/stats") {
    const at = parseDate(url.searchParams.get("at")) || new Date();
    const [spotAggregate, activeSpots, todayBookings] = await Promise.all([
      prisma.parkingSpot.aggregate({
        _sum: { totalSpots: true }
      }),
      prisma.parkingSpot.aggregate({
        where: { status: "active" },
        _sum: { availableSpots: true }
      }),
      prisma.reservation.count({
        where: {
          createdAt: {
            gte: new Date(at.getFullYear(), at.getMonth(), at.getDate()),
            lt: new Date(at.getFullYear(), at.getMonth(), at.getDate() + 1)
          }
        }
      })
    ]);

    const total = Number(spotAggregate._sum.totalSpots || 0);
    const available = Number(activeSpots._sum.availableSpots || 0);
    sendJson(res, 200, { total, available, todayBookings });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

async function serveStatic(req, res, pathname) {
  const spaPath =
    pathname === "/" || pathname === "/reservations" || pathname === "/login" || pathname === "/admin"
      ? "index.html"
      : pathname.replace(/^\/+/, "");
  const relativePath = spaPath;
  const filePath = path.join(ROOT, relativePath);
  const normalized = path.normalize(filePath);
  if (!normalized.startsWith(ROOT)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }
  try {
    const stat = await fs.stat(normalized);
    if (stat.isDirectory()) {
      sendJson(res, 403, { error: "Forbidden" });
      return;
    }
    const ext = path.extname(normalized).toLowerCase();
    const body = await fs.readFile(normalized);
    res.statusCode = 200;
    res.setHeader("Content-Type", MIME_TYPES[ext] || "application/octet-stream");
    // Prevent stale JS/CSS/HTML caching during development
    if ([".html", ".js", ".css"].includes(ext)) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
    }
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.end(body);
  } catch {
    sendJson(res, 404, { error: "File not found" });
  }
}

function sendJson(res, code, payload) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) {
      throw new Error("Payload too large");
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function getToken(req) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return null;
  return auth.slice("Bearer ".length).trim();
}

async function getSession(req) {
  const token = getToken(req);
  if (!token) return null;
  return prisma.appSession.findUnique({
    where: { token },
    include: { user: true }
  });
}

async function requireSession(req, res) {
  const session = await getSession(req);
  if (!session) {
    sendJson(res, 401, { error: "Unauthorized" });
    return null;
  }
  // Attach userId so the access-log finish hook can include it
  req.userId = session.user.id;
  return session;
}

async function requireAdmin(req, res) {
  const session = await requireSession(req, res);
  if (!session) return null;
  if (session.user.role !== "admin") {
    sendJson(res, 403, { error: "Admin role required" });
    return null;
  }
  return session;
}

async function ensureDefaultAdminUser() {
  const existingAdmin = await prisma.appUser.findUnique({
    where: { name: "admin" }
  });

  if (existingAdmin) return existingAdmin;

  return prisma.appUser.create({
    data: {
      id: "user-admin",
      name: "admin",
      role: "admin",
      passwordSalt: "campuspark-admin-salt",
      passwordHash:
        "fe66cc3192a3aa6be57d6b5e34dd357e9ebfe5e7f769e020780c8f9ee384f495d4554c821d778c3c543ac3b5ebe5db7391010c6a9f98fb877693c1f14a22edee"
    }
  });
}


async function createReservation({
  userId,
  userName,
  userRole,
  spotId,
  startTime,
  endTime,
  plateNumber = "TBD",
  phoneNumber = "TBD"
}) {
  try {
    const reservation = await prisma.$transaction(async (tx) => {
      // ── Duplicate guard ────────────────────────────────────────────────────
      // Prevent the same user from holding two active/pending reservations
      // for the same spot (catches double-click and concurrent tab submits).
      const existing = await tx.reservation.findFirst({
        where: {
          userId,
          spotId,
          status: { in: ["PENDING", "ACTIVE", "CONFIRMED"] }
        },
        select: { id: true }
      });
      if (existing) {
        throw new Error("You already have an active reservation for this spot.");
      }

      // ── Atomic check-and-decrement ─────────────────────────────────────────
      // updateMany with availableSpots > 0 is serialised by Postgres row-level
      // lock: exactly one concurrent transaction succeeds, the rest get count=0.
      const updateResult = await tx.parkingSpot.updateMany({
        where: {
          id: spotId,
          availableSpots: { gt: 0 },
          status: "active"
        },
        data: {
          availableSpots: { decrement: 1 }
        }
      });

      if (updateResult.count === 0) {
        throw new Error("This spot just filled up — please choose another.");
      }

      return await tx.reservation.create({
        data: {
          userId,
          spotId,
          startTime: new Date(startTime),
          endTime: new Date(endTime),
          plateNumber: plateNumber || "TBD",
          phoneNumber: phoneNumber || "TBD",
          status: "PENDING"
        }
      });
    });

    logger.info("reservation_created", { reservationId: reservation.id, spotId, userId });
    return {
      success: true,
      data: mapReservationForClient(reservation, userName, userRole)
    };
  } catch (error) {
    logger.warn("reservation_failed", { spotId, userId, error: error.message });
    return { success: false, message: error.message };
  }
}

function setupScheduledJobs() {
  cron.schedule("* * * * *", expireStalePendingReservations, {
    timezone: SEATTLE_TIMEZONE
  });

  cron.schedule(TRAFFIC_SIMULATION_CRON, async () => {
    try {
      const summary = await applyTrafficSimulation();
      if (summary.length > 0) {
        logger.info("traffic_simulation", { spots: summary.length, summary: summary.join(" | ") });
      }
    } catch (error) {
      logger.error("traffic_simulation_error", { error: error.message });
    }
  }, {
    timezone: SEATTLE_TIMEZONE
  });

  // Run once immediately on startup so data is fresh from first request
  applyTrafficSimulation().then(summary => {
    if (summary.length > 0) {
      logger.info("traffic_simulation_startup", { spots: summary.length });
    }
  }).catch(err => logger.error("traffic_simulation_startup_error", { error: err.message }));
}

async function expireStalePendingReservations() {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

  try {
    const expiredReservations = await prisma.reservation.findMany({
      where: {
        status: "PENDING",
        createdAt: { lt: fiveMinutesAgo }
      }
    });

    if (expiredReservations.length === 0) return;

    for (const reservation of expiredReservations) {
      await prisma.$transaction(async (tx) => {
        await tx.reservation.update({
          where: { id: reservation.id },
          data: { status: "EXPIRED" }
        });

        // LEAST-guarded increment: atomic, no separate read needed
        await tx.$executeRaw`
          UPDATE "ParkingSpot"
          SET "availableSpots" = LEAST("availableSpots" + 1, "totalSpots")
          WHERE id = ${reservation.spotId}
        `;
      });
      logger.info("reservation_expired", { reservationId: reservation.id, spotId: reservation.spotId });
    }
  } catch (error) {
    logger.error("expiry_cron_error", { error: error.message });
  }
}

async function applyTrafficSimulation(now = new Date()) {
  const spots = await prisma.parkingSpot.findMany({
    where: { status: "active" },
    orderBy: [{ zone: "asc" }, { name: "asc" }]
  });
  if (spots.length === 0) return [];

  // Count PENDING + ACTIVE reservations per spot right now.
  // These represent physically held slots — the simulation must never
  // "free" a spot that a real user is holding.
  const heldRows = await prisma.reservation.groupBy({
    by: ["spotId"],
    where: {
      status: { in: ["PENDING", "ACTIVE", "CONFIRMED"] }
    },
    _count: { id: true }
  });
  const heldBySpot = new Map(heldRows.map(r => [r.spotId, r._count.id]));

  const { hour, minute } = getSeattleLocalTimeParts(now);
  // Base demand from hourly curve (0-1)
  const baseOccupancy = HOURLY_DEMAND[hour] ?? 0.5;
  // Sub-hour sine wave: ±8% oscillation across the 60-minute window
  const sineBoost = Math.sin((minute / 60) * 2 * Math.PI) * 0.08;

  const updates = [];
  const summary = [];
  const broadcastPayload = [];

  for (const spot of spots) {
    const totalSpots = Number(spot.totalSpots || 0);
    if (totalSpots <= 0) continue;

    // Per-spot personality: some lots are inherently busier than others
    const bias = spotOccupancyBias(spot.name);
    // ±10% random jitter so each 5-min tick looks different
    const jitter = randomInRange(-0.10, 0.10);
    const occupancyRatio = clamp(baseOccupancy * bias + sineBoost + jitter, 0.02, 0.98);
    const simulatedAvail = totalSpots - Math.round(totalSpots * occupancyRatio);

    // Never report more availability than what real bookings allow.
    // heldSlots = number of PENDING/ACTIVE reservations occupying physical spots.
    const heldSlots = heldBySpot.get(spot.id) || 0;
    const maxAllowedAvail = Math.max(0, totalSpots - heldSlots);
    const nextAvailableSpots = clamp(Math.min(simulatedAvail, maxAllowedAvail), 0, totalSpots);

    updates.push(
      prisma.parkingSpot.update({
        where: { id: spot.id },
        data: { availableSpots: nextAvailableSpots, fetchedAt: now }
      })
    );
    broadcastPayload.push({
      id: spot.id,
      availableSpots: nextAvailableSpots,
      totalSpots,
      pricePerHour: Number(spot.pricePerHour)
    });

    summary.push(
      `${spot.name}: ${nextAvailableSpots}/${totalSpots} (occ=${Math.round(occupancyRatio * 100)}%, held=${heldSlots}, ${hour}:${String(minute).padStart(2, "0")} PT)`
    );
  }

  if (updates.length > 0) {
    await prisma.$transaction(updates);
    // Push lightweight availability snapshot to all SSE subscribers
    broadcastSpots(broadcastPayload);
  }
  return summary;
}

// Returns a deterministic occupancy multiplier in [0.75, 1.25] based on spot name.
// High-traffic lots (e.g. Amazon Spheres) naturally run busier than street lots.
function spotOccupancyBias(name = "") {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  return 0.75 + (Math.abs(h) % 1000) / 2000;
}

function groupSpotsByZone(spots) {
  return spots.reduce((acc, spot) => {
    if (!acc[spot.zone]) {
      acc[spot.zone] = [];
    }
    acc[spot.zone].push(spot);
    return acc;
  }, {});
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function randomInRange(min, max) {
  return Math.random() * (max - min) + min;
}

function calculateReservationSettlement(startTimeInput, endTimeInput, hourlyRateInput) {
  const startTime = parseDate(startTimeInput) || new Date();
  const endTime = parseDate(endTimeInput) || new Date();
  const durationMs = Math.max(endTime.getTime() - startTime.getTime(), 15 * 60 * 1000);
  const quarterHours = Math.max(1, Math.ceil(durationMs / (15 * 60 * 1000)));
  const billedHours = quarterHours / 4;
  const hourlyRate = Number(hourlyRateInput || DEFAULT_HOURLY_RATE);
  const safeRate = Number.isFinite(hourlyRate) && hourlyRate > 0 ? hourlyRate : DEFAULT_HOURLY_RATE;
  return Number((billedHours * safeRate).toFixed(2));
}

function getSeattleLocalTimeParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: SEATTLE_TIMEZONE,
    hour: "numeric",
    minute: "numeric",
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  const hour   = Number(parts.find(p => p.type === "hour")?.value   ?? 0);
  const minute = Number(parts.find(p => p.type === "minute")?.value ?? 0);
  return { hour, minute };
}

function getSeattleTrafficProfile(hour) {
  if (hour >= 8 && hour < 10) {
    return { label: "morning-rush", baseOccupancy: 0.9 };
  }
  if (hour >= 16 && hour < 18) {
    return { label: "evening-rush", baseOccupancy: 0.93 };
  }
  if (hour >= 10 && hour < 16) {
    return { label: "midday", baseOccupancy: 0.72 };
  }
  return { label: "off-peak", baseOccupancy: 0.58 };
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function verifyPassword(password, salt, expectedHash) {
  return hashPassword(password, salt) === expectedHash;
}

function parseDate(input) {
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

function hasOverlap(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

function withSpotStatus(spot, bookings, at) {
  const booked = bookings.some((b) => {
    if (b.spotId !== spot.id) return false;
    const start = new Date(b.startTime);
    const end = new Date(b.endTime);
    return at >= start && at < end;
  });
  return {
    ...spot,
    booked,
    isAvailable: spot.available && !booked
  };
}

function withPrismaSpotStatus(spot, at) {
  const isAvailable = spot.status === "active" && Number(spot.availableSpots || 0) > 0;
  return {
    ...spot,
    booked: !isAvailable,
    isAvailable,
    checkedAt: at.toISOString()
  };
}

function hashString(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function getSpotCoordsForDemand(spot, index) {
  const lat = Number(spot.latitude ?? spot.lat);
  const lng = Number(spot.longitude ?? spot.lng ?? spot.lon);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng };
  }

  const seedSource = `${spot.id || ""}${spot.externalLocationId || ""}${spot.slug || ""}${spot.name || ""}${spot.address || ""}${index}`;
  const seed = hashString(seedSource);
  const latOffset = ((seed % 1000) / 1000 - 0.5) * 0.01;
  const lngOffset = (((seed / 1000) % 1000) / 1000 - 0.5) * 0.012;
  return { lat: 47.615 + latOffset, lng: -122.3384 + lngOffset };
}

function countNearbySearches(coords, logs, radiusMeters) {
  if (!coords || !logs.length) return 0;
  let count = 0;
  for (const log of logs) {
    if (distanceMeters(coords, log) <= radiusMeters) count += 1;
  }
  return count;
}

function distanceMeters(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * earthRadius * Math.asin(Math.min(1, Math.sqrt(h)));
}

function countTodayBookings(bookings) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  return bookings.filter((b) => {
    const t = new Date(b.startTime);
    return t.getFullYear() === y && t.getMonth() === m && t.getDate() === d;
  }).length;
}

function mapReservationForClient(reservation, ownerName = "", ownerRole = "") {
  return {
    id: reservation.id,
    userId: reservation.userId,
    spotId: reservation.spotId,
    ownerName,
    ownerRole,
    plate: reservation.plateNumber || "TBD",
    phone: reservation.phoneNumber || "TBD",
    startTime: reservation.startTime,
    endTime: reservation.endTime,
    status: reservation.status,
    ticketCode: reservation.ticketCode || "",
    checkInTime: reservation.checkInTime,
    checkOutTime: reservation.checkOutTime,
    finalAmount:
      reservation.finalAmount === null || typeof reservation.finalAmount === "undefined"
        ? null
        : Number(reservation.finalAmount),
    createdAt: reservation.createdAt
  };
}

function isPlateValid(plate) {
  return /^[A-Z0-9-]{5,8}$/.test(plate);
}

function isPhoneValid(phone) {
  return /^(?:\d{10}|\d{3}-\d{3}-\d{4}|\(\d{3}\)\s?\d{3}-\d{4}|\d{3}\s\d{3}\s\d{4})$/.test(
    phone.trim()
  );
}
