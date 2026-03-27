const prisma = require("../prismaClient");

const TOTAL_LOGS = 200;
const NEU_CENTER = { lat: 47.6159, lng: -122.3382 };
const AMAZON_CENTER = { lat: 47.6155, lng: -122.3384 };
const REGION_CENTER = { lat: 47.619, lng: -122.336 };

function randomGaussian(mean, stdDev) {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return z * stdDev + mean;
}

function jitteredPoint(center, spread) {
  return {
    lat: randomGaussian(center.lat, spread),
    lng: randomGaussian(center.lng, spread)
  };
}

function randomRecentDate() {
  const twelveHoursMs = 12 * 60 * 60 * 1000;
  const offset = Math.floor(Math.random() * twelveHoursMs);
  return new Date(Date.now() - offset);
}

async function main() {
  const logs = [];
  for (let i = 0; i < TOTAL_LOGS; i += 1) {
    let point;
    const roll = Math.random();
    if (roll < 0.45) {
      point = jitteredPoint(NEU_CENTER, 0.0025);
    } else if (roll < 0.9) {
      point = jitteredPoint(AMAZON_CENTER, 0.0022);
    } else {
      point = jitteredPoint(REGION_CENTER, 0.006);
    }
    logs.push({
      lat: point.lat,
      lng: point.lng,
      createdAt: randomRecentDate()
    });
  }

  await prisma.searchLog.createMany({ data: logs });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
