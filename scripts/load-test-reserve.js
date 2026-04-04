#!/usr/bin/env node
/**
 * Concurrency load test: 10 users try to reserve the same spot simultaneously.
 * Only 1 slot is available. Expected result: exactly 1 success, 9 failures.
 *
 * Usage:
 *   node scripts/load-test-reserve.js
 *
 * Requires the dev server running on localhost:3000 and at least one spot
 * with availableSpots = 1. The script:
 *   1. Finds the spot with the fewest available spaces (≥1).
 *   2. Forces availableSpots = 1 via direct DB update (Prisma).
 *   3. Fires 10 concurrent POST /api/bookings requests with 10 pre-seeded users.
 *   4. Verifies exactly 1 succeeded and availableSpots = 0 in DB.
 */

"use strict";
const http = require("http");
const { PrismaClient } = require("@prisma/client");

const BASE = "http://localhost:3000";
const prisma = new PrismaClient();

// ── helpers ──────────────────────────────────────────────────────────────────
function post(path, body, token) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const opts = {
      hostname: "localhost",
      port: 3000,
      path,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    };
    const req = http.request(opts, res => {
      let data = "";
      res.on("data", d => (data += d));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=== CampusPark Concurrency Load Test ===\n");

  // 1. Pick the first active spot
  const spot = await prisma.parkingSpot.findFirst({
    where: { status: "active" },
    orderBy: { name: "asc" }
  });
  if (!spot) { console.error("No active spots found."); process.exit(1); }

  // 2. Force it to exactly 1 available slot
  await prisma.parkingSpot.update({
    where: { id: spot.id },
    data: { availableSpots: 1 }
  });
  console.log(`Target spot : ${spot.name} (id=${spot.id})`);
  console.log(`Set         : availableSpots = 1\n`);

  // 3. Get or create 10 test users and log them all in
  const CONCURRENCY = 10;
  const tokens = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    const name = `loadtest_user_${i}`;
    // Ensure user exists (ignore conflict)
    const reg = await post("/api/auth/register", { name, password: "TestPass123!" });
    if (reg.status !== 201 && reg.status !== 409) {
      console.warn(`  Register user ${name}: HTTP ${reg.status}`);
    }
    const login = await post("/api/auth/login", { name, password: "TestPass123!" });
    if (!login.body?.token) {
      console.error(`  Login failed for ${name}:`, login.body);
      process.exit(1);
    }
    tokens.push(login.body.token);
  }
  console.log(`Logged in ${CONCURRENCY} test users.\n`);

  // 4. Fire all reservations simultaneously
  const startTime = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hr from now
  const requests = tokens.map(token =>
    post(
      "/api/bookings",
      {
        spotId: spot.id,
        plate: "LOADTEST",
        phone: "2061234567",
        startTime,
        durationHours: 1
      },
      token
    )
  );

  console.log(`Firing ${CONCURRENCY} concurrent reservation requests...`);
  const t0 = Date.now();
  const results = await Promise.allSettled(requests);
  const elapsed = Date.now() - t0;

  // 5. Analyse results
  let successes = 0;
  let failures = 0;
  results.forEach((r, i) => {
    const ok = r.status === "fulfilled" && r.value.status === 201;
    if (ok) {
      successes++;
      console.log(`  User ${i}: ✅ RESERVED  (HTTP ${r.value.status})`);
    } else {
      failures++;
      const msg = r.status === "fulfilled"
        ? `HTTP ${r.value.status} — ${r.value.body?.error || r.value.body?.message || JSON.stringify(r.value.body)}`
        : r.reason?.message;
      console.log(`  User ${i}: ❌ rejected  (${msg})`);
    }
  });

  console.log(`\nCompleted in ${elapsed} ms`);
  console.log(`Successes : ${successes}  (expected 1)`);
  console.log(`Failures  : ${failures}  (expected ${CONCURRENCY - 1})`);

  // 6. Verify DB state
  const after = await prisma.parkingSpot.findUnique({ where: { id: spot.id } });
  console.log(`\nDB availableSpots after : ${after.availableSpots}  (expected 0)`);

  // Only count reservations created during THIS test run (last 30 s)
  const since = new Date(t0 - 5000);
  const newReservations = await prisma.reservation.count({
    where: {
      spotId: spot.id,
      status: { in: ["PENDING", "ACTIVE", "CONFIRMED"] },
      createdAt: { gte: since }
    }
  });
  console.log(`DB new reservations (this run) : ${newReservations}  (expected 1)`);

  // 7. Pass / Fail
  const pass =
    successes === 1 &&
    failures === CONCURRENCY - 1 &&
    after.availableSpots === 0 &&
    newReservations === 1;

  console.log(`\n${ pass ? "✅ PASS — race condition handled correctly." : "❌ FAIL — double-booking detected or availableSpots mismatch!" }`);

  // Cleanup: cancel the successful reservation and reset spot
  await prisma.reservation.updateMany({
    where: { spotId: spot.id, status: { in: ["PENDING", "ACTIVE", "CONFIRMED"] } },
    data: { status: "CANCELLED" }
  });
  await prisma.parkingSpot.update({ where: { id: spot.id }, data: { availableSpots: 1 } });
  console.log("Cleanup done.\n");

  await prisma.$disconnect();
  process.exit(pass ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
