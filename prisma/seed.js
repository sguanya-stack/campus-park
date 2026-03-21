const fs = require("node:fs/promises");
const path = require("node:path");
const { PrismaClient, Prisma } = require("@prisma/client");

const prisma = new PrismaClient();
const CSV_PATH = path.join(__dirname, "..", "parking_data.csv");

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error("Seed failed:", error);
    await prisma.$disconnect();
    process.exit(1);
  });

async function main() {
  const csvText = await fs.readFile(CSV_PATH, "utf8");
  const rows = parseCsv(csvText);

  if (!rows.length) {
    console.log("No rows found in parking_data.csv");
    return;
  }

  for (const [index, row] of rows.entries()) {
    const data = mapCsvRowToParkingSpot(row, index);

    await prisma.parkingSpot.upsert({
      where: { externalLocationId: data.externalLocationId },
      update: data,
      create: data
    });
  }

  console.log(`Seeded ${rows.length} parking spots from parking_data.csv`);
}

function mapCsvRowToParkingSpot(row, index) {
  const locationId = String(row.location_id || "").trim();
  const fetchedAt = parseLooseDate(row.fetched_at);
  const startTime = parseLooseDate(row.start_time_local);
  const stopTime = parseLooseDate(row.stop_time_local);
  const priceValue = Number(row.price);
  const totalSpots = estimateTotalSpots(locationId, index);
  const availableSpots = estimateAvailableSpots(locationId, totalSpots);

  return {
    externalLocationId: locationId,
    slug: `seattle-parking-${locationId}`,
    name: `Seattle Parking Location ${locationId}`,
    address: null,
    zone: inferZone(startTime, stopTime),
    totalSpots,
    availableSpots,
    pricePerHour: Number.isFinite(priceValue)
      ? new Prisma.Decimal(priceValue.toFixed(2))
      : null,
    priceText: String(row.price_text || "").trim() || null,
    isEV: estimateEvFlag(locationId),
    status: "active",
    requiresPrintPass: parseBoolean(row.requires_print_pass),
    requiresDisplayPass: parseBoolean(row.requires_display_pass),
    cancellationNotice: Number.parseInt(row.cancellation_notice || "0", 10) || 0,
    fetchedAt
  };
}

function parseCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row = {};

    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });

    return row;
  });
}

function splitCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

function parseLooseDate(value) {
  if (!value) return null;
  const normalized = String(value).trim().replace(" ", "T");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseBoolean(value) {
  return String(value).trim().toLowerCase() === "true";
}

function estimateTotalSpots(locationId, index) {
  return 40 + ((hashString(`${locationId}-${index}`) % 161) + index % 7);
}

function estimateAvailableSpots(locationId, totalSpots) {
  const ratioSeed = hashString(`${locationId}-availability`) % 46;
  const ratio = 0.15 + ratioSeed / 100;
  return Math.max(0, Math.min(totalSpots, Math.round(totalSpots * ratio)));
}

function estimateEvFlag(locationId) {
  return hashString(`${locationId}-ev`) % 3 === 0;
}

function inferZone(startTime, stopTime) {
  if (!startTime || !stopTime) return "Seattle";
  const durationHours = Math.max(1, Math.round((stopTime - startTime) / (60 * 60 * 1000)));
  if (durationHours >= 8) return "Downtown";
  if (durationHours >= 4) return "South Lake Union";
  return "Seattle Core";
}

function hashString(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}
