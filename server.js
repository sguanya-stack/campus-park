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
const TRAFFIC_SIMULATION_CRON = "*/15 * * * *";
const DEFAULT_HOURLY_RATE = 12;
const DEV_ALLOWED_ORIGINS = new Set(
  (process.env.CORS_ORIGIN || "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = decodeURIComponent(parsedUrl.pathname);
    const origin = req.headers.origin;

    if (origin && DEV_ALLOWED_ORIGINS.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

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

setupScheduledJobs();

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

  if (req.method === "GET" && pathname === "/api/analytics/heatmap") {
    const since = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const points = await prisma.searchLog.findMany({
      where: {
        createdAt: { gte: since }
      },
      select: { lat: true, lng: true },
      orderBy: { createdAt: "desc" }
    });
    sendJson(res, 200, points);
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

  if (
    req.method === "POST" &&
    (pathname === "/api/bookings" || pathname === "/api/reservations")
  ) {
    const session = await requireSession(req, res);
    if (!session) return;
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

    sendJson(res, 201, { booking: result.data });
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
      await tx.parkingSpot.update({
        where: { id: reservation.spotId },
        data: { availableSpots: { increment: 1 } }
      });

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

function setupScheduledJobs() {
  cron.schedule("* * * * *", expireStalePendingReservations, {
    timezone: SEATTLE_TIMEZONE
  });

  cron.schedule(TRAFFIC_SIMULATION_CRON, async () => {
    try {
      const summary = await applyTrafficSimulation();
      if (summary.length > 0) {
        console.log(`[traffic] Seattle availability refresh: ${summary.join(", ")}`);
      }
    } catch (error) {
      console.error("[traffic] Failed to refresh simulated traffic data:", error);
    }
  }, {
    timezone: SEATTLE_TIMEZONE
  });
}

async function expireStalePendingReservations() {
  console.log("🔄 [CRON] Checking for expired reservations...");
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

        // Clamp availableSpots to totalSpots to prevent double-fire overflow
        const spot = await tx.parkingSpot.findUnique({
          where: { id: reservation.spotId },
          select: { availableSpots: true, totalSpots: true }
        });
        if (spot && spot.availableSpots < spot.totalSpots) {
          await tx.parkingSpot.update({
            where: { id: reservation.spotId },
            data: { availableSpots: { increment: 1 } }
          });
        }
      });
      console.log(`⏱️ [CRON] Released spot for expired reservation ID: ${reservation.id}`);
    }
  } catch (error) {
    console.error("❌ [CRON] Error processing expirations:", error);
  }
}

async function applyTrafficSimulation(now = new Date()) {
  const spots = await prisma.parkingSpot.findMany({
    where: { status: "active" },
    orderBy: [{ zone: "asc" }, { name: "asc" }]
  });
  if (spots.length === 0) return [];

  const seattleParts = getSeattleLocalTimeParts(now);
  const trafficProfile = getSeattleTrafficProfile(seattleParts.hour);
  const updates = [];
  const summary = [];

  for (const spot of spots) {
    const totalSpots = Number(spot.totalSpots || 0);
    if (totalSpots <= 0) continue;

    const jitter = randomInRange(-0.05, 0.05);
    const occupancyRatio = clamp(trafficProfile.baseOccupancy + jitter, 0.2, 0.98);
    const occupiedSpots = Math.min(
      totalSpots - 1,
      Math.max(0, Math.round(totalSpots * occupancyRatio))
    );
    const nextAvailableSpots = clamp(totalSpots - occupiedSpots, 1, totalSpots);

    updates.push(
      prisma.parkingSpot.update({
        where: { id: spot.id },
        data: {
          availableSpots: nextAvailableSpots,
          fetchedAt: now
        }
      })
    );

    summary.push(
      `${spot.name}: ${nextAvailableSpots}/${totalSpots} (${trafficProfile.label}, ${seattleParts.hour}:00 PT)`
    );
  }

  if (updates.length > 0) {
    await prisma.$transaction(updates);
  }

  return summary;
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
    hour12: false
  });
  const [{ value: hourValue }] = formatter.formatToParts(date).filter((part) => part.type === "hour");
  return { hour: Number(hourValue) };
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
