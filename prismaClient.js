const { PrismaClient } = require("@prisma/client");

const globalForPrisma = global;
const prisma = globalForPrisma.__campusPrisma || new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__campusPrisma = prisma;
}

module.exports = prisma;
