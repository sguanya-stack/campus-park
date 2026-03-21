require('dotenv').config();
const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

cron.schedule('* * * * *', async () => {
  console.log('🔄 [CRON] Checking for expired reservations...');
  
  // Calculate the timestamp for 5 minutes ago
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

  try {
    // Step A: Find all PENDING reservations older than 5 minutes
    const expiredReservations = await prisma.reservation.findMany({
      where: {
        status: 'PENDING',
        createdAt: { lt: fiveMinutesAgo }
      }
    });

    if (expiredReservations.length === 0) return;

    // Step B: Process each expired reservation safely using a transaction
    for (const res of expiredReservations) {
      await prisma.$transaction(async (tx) => {
        // 1. Mark the reservation as EXPIRED
        await tx.reservation.update({
          where: { id: res.id },
          data: { status: 'EXPIRED' }
        });
        
        // 2. Restore the inventory: increment availableSpots by 1
        await tx.parkingSpot.update({
          where: { id: res.spotId },
          data: { availableSpots: { increment: 1 } }
        });
      });
      console.log(`⏱️ [CRON] Released spot for expired reservation ID: ${res.id}`);
    }
  } catch (error) {
    console.error('❌ [CRON] Error processing expirations:', error);
  }
});
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "db.json");
const DEFAULT_USERS = [
  {
    id: "user-admin",
    name: "admin",
    role: "admin",
    passwordSalt: "campuspark-admin-salt",
    passwordHash:
      "fe66cc3192a3aa6be57d6b5e34dd357e9ebfe5e7f769e020780c8f9ee384f495d4554c821d778c3c543ac3b5ebe5db7391010c6a9f98fb877693c1f14a22edee",
    createdAt: "2026-03-19T00:00:00.000Z"
  }
];
const DEFAULT_SPOTS = [
  { id: "A-01", zone: "Library Zone", location: "Library North Entrance", available: true, isEV: true },
  { id: "A-02", zone: "Library Zone", location: "Library North Entrance", available: true },
  { id: "A-03", zone: "Library Zone", location: "Library West Side", available: false },
  { id: "B-11", zone: "Academic Zone", location: "Academic Hall 1", available: true, isEV: true },
  { id: "B-12", zone: "Academic Zone", location: "Academic Hall 2", available: true },
  { id: "B-13", zone: "Academic Zone", location: "Lab Building East", available: false },
  { id: "C-21", zone: "Residence Zone", location: "Residence Hall 3", available: true },
  { id: "C-22", zone: "Residence Zone", location: "Residence Hall 4", available: true, isEV: true },
  { id: "D-31", zone: "Athletics Zone", location: "Arena South Entrance", available: true },
  { id: "D-32", zone: "Athletics Zone", location: "Track Entrance", available: false }
];

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
const REALTIME_TICK_MS = 30_000;

let simulationRunning = false;

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = decodeURIComponent(parsedUrl.pathname);

    if (req.method === 'GET' && parsedUrl.pathname === '/api/recommend') {
      try {
        const zone = parsedUrl.searchParams.get('zone');
        const sortBy = parsedUrl.searchParams.get('sortBy');
        const search = parsedUrl.searchParams.get('search');
        let orderByLogic = { availableSpots: 'desc' };
        if (sortBy === 'price') {
          orderByLogic = { pricePerHour: 'asc' };
        }

        const whereClause = {
          availableSpots: { gt: 0 },
          status: 'active'
        };

        if (zone && zone !== 'All Zones') {
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

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, count: recommendedSpots.length, data: recommendedSpots }));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: error.message }));
      }
      return;
    }

    if (req.method === 'POST' && parsedUrl.pathname === '/api/reserve') {
      let body = '';

      req.on('data', (chunk) => {
        body += chunk.toString();
      });

      req.on('end', async () => {
        try {
          const { userId, spotId, startTime, endTime } = JSON.parse(body);

          const reservation = await prisma.$transaction(async (tx) => {
            const spot = await tx.parkingSpot.findUnique({ where: { id: spotId } });
            if (!spot) throw new Error('Target parking spot does not exist.');
            if (spot.availableSpots <= 0) {
              throw new Error('Race condition prevented: Spot is no longer available.');
            }

            await tx.parkingSpot.update({
              where: { id: spotId },
              data: { availableSpots: { decrement: 1 } }
            });

            return await tx.reservation.create({
              data: {
                userId: userId,
                spotId: spotId,
                startTime: new Date(startTime),
                endTime: new Date(endTime),
                status: 'PENDING'
              }
            });
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, data: reservation, message: 'Spot locked successfully.' }));
        } catch (error) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: error.message }));
        }
      });
      return;
    }

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
    sendJson(res, 500, { error: "Server error", detail: String(error.message || error) });
  }
});

server.listen(PORT, () => {
  console.log(`CampusPark server running at http://localhost:${PORT}`);
});

server.on("error", (error) => {
  if (error && error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use.`);
    console.error(`Try stopping the existing process or run: PORT=${PORT + 1} npm start`);
    process.exit(1);
  }

  console.error("Server failed to start:", error);
  process.exit(1);
});

startRealtimeSpotSimulation();

async function handleApi(req, res, url, pathname) {
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
    if (!/^[A-Za-z0-9 _-]{2,20}$/.test(name)) {
      sendJson(res, 400, { error: "Name must be 2-20 characters" });
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

  if (req.method === "GET" && pathname === "/api/spots") {
    const at = parseDate(url.searchParams.get("at")) || new Date();
    const zone = url.searchParams.get("zone");
    const search = String(url.searchParams.get("search") || "").trim();
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

    const mapped = spots.map((spot) => withPrismaSpotStatus(spot, at));
    sendJson(res, 200, { spots: mapped });
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
        status: { in: ["PENDING", "CONFIRMED"] }
      },
      orderBy: { startTime: "asc" }
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
        status: { in: ["PENDING", "CONFIRMED"] }
      },
      orderBy: { startTime: "asc" }
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

  if (
    req.method === "POST" &&
    (pathname === "/api/bookings" || pathname === "/api/reservations")
  ) {
    const session = await requireSession(req, res);
    if (!session) return;
    const body = await readBody(req);

    const spotId = String(body.spotId || "").trim().toUpperCase();
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

    sendJson(res, 201, { booking: result.data });
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
      if (booking.status === "PENDING" || booking.status === "CONFIRMED") {
        await tx.parkingSpot.update({
          where: { id: booking.spotId },
          data: { availableSpots: { increment: 1 } }
        });
      }

      await tx.reservation.update({
        where: { id: bookingId },
        data: { status: "CANCELLED" }
      });
    });

    sendJson(res, 200, { ok: true });
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
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
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

async function readDb() {
  await ensureDb();
  const raw = await fs.readFile(DB_PATH, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }
  return {
    spots: Array.isArray(parsed.spots) && parsed.spots.length ? parsed.spots : [...DEFAULT_SPOTS],
    bookings: Array.isArray(parsed.bookings) ? parsed.bookings : [],
    sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    users: Array.isArray(parsed.users) && parsed.users.length ? parsed.users : [...DEFAULT_USERS]
  };
}

async function writeDb(db) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${DB_PATH}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(db, null, 2)}\n`, "utf8");
  await fs.rename(tmp, DB_PATH);
}

async function ensureDb() {
  try {
    await fs.access(DB_PATH);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const initial = { spots: DEFAULT_SPOTS, bookings: [], sessions: [], users: DEFAULT_USERS };
    await fs.writeFile(DB_PATH, `${JSON.stringify(initial, null, 2)}\n`, "utf8");
  }
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
        throw new Error("Too slow. This time slot is sold out, or the parking location is unavailable.");
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

    console.log("Reservation successful, locked spot:", reservation.id);
    return {
      success: true,
      data: mapReservationForClient(reservation, userName, userRole)
    };
  } catch (error) {
    console.error("Reservation failed, transaction rolled back:", error.message);
    return { success: false, message: error.message };
  }
}

function startRealtimeSpotSimulation() {
  setInterval(async () => {
    if (simulationRunning) return;
    simulationRunning = true;
    try {
      const changedZones = await applyRealtimeSpotSimulation();
      if (changedZones.length > 0) {
        console.log(`[sim] Updated zone availability: ${changedZones.join(", ")}`);
      }
    } catch (error) {
      console.error("[sim] Failed to update simulated spot data:", error);
    } finally {
      simulationRunning = false;
    }
  }, REALTIME_TICK_MS).unref();
}

async function applyRealtimeSpotSimulation() {
  const spots = await prisma.parkingSpot.findMany({
    where: { status: "active" },
    orderBy: [{ zone: "asc" }, { name: "asc" }]
  });
  const zones = groupSpotsByZone(spots);
  const changedZones = [];

  for (const [zone, zoneSpots] of Object.entries(zones)) {
    if (zoneSpots.length === 0) continue;

    const currentAvailable = zoneSpots.reduce(
      (sum, spot) => sum + Number(spot.availableSpots || 0),
      0
    );
    const totalSpots = zoneSpots.reduce((sum, spot) => sum + Number(spot.totalSpots || 0), 0);
    if (totalSpots <= 0) continue;

    const requestedDelta = getRandomInt(1, Math.min(3, totalSpots)) * getRandomDirection();
    const targetAvailable = clamp(currentAvailable + requestedDelta, 0, totalSpots);
    const delta = targetAvailable - currentAvailable;

    if (delta === 0) continue;

    const mutableSpots = shuffle(
      zoneSpots.map((spot) => ({
        ...spot,
        availableSpots: Number(spot.availableSpots || 0),
        totalSpots: Number(spot.totalSpots || 0)
      }))
    );

    let remaining = Math.abs(delta);
    while (remaining > 0) {
      const candidates =
        delta > 0
          ? mutableSpots.filter((spot) => spot.availableSpots < spot.totalSpots)
          : mutableSpots.filter((spot) => spot.availableSpots > 0);

      if (candidates.length === 0) break;

      const targetSpot = candidates[Math.floor(Math.random() * candidates.length)];
      targetSpot.availableSpots += delta > 0 ? 1 : -1;
      remaining -= 1;
    }

    await prisma.$transaction(
      mutableSpots.map((spot) =>
        prisma.parkingSpot.update({
          where: { id: spot.id },
          data: { availableSpots: clamp(spot.availableSpots, 0, spot.totalSpots) }
        })
      )
    );

    const nextAvailable = mutableSpots.reduce((sum, spot) => sum + spot.availableSpots, 0);
    changedZones.push(`${zone}: ${nextAvailable}/${totalSpots}`);
  }

  return changedZones;
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

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getRandomDirection() {
  return Math.random() < 0.5 ? -1 : 1;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
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
