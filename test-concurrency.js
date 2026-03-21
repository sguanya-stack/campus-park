const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🚀 Starting High-Concurrency Test...');

  // 1. Fetch any available parking spot from the database
  const spot = await prisma.parkingSpot.findFirst({
    where: { availableSpots: { gt: 0 } }
  });

  if (!spot) {
    console.log('❌ No available spots found. Please run seed script first.');
    return;
  }

  console.log(`📍 Testing on Spot ID: ${spot.id}`);

  // 2. Artificially set inventory to exactly 1 to simulate "Last Spot" scenario
  await prisma.parkingSpot.update({
    where: { id: spot.id },
    data: { availableSpots: 1 }
  });
  console.log(`⚠️ Inventory forced to 1. Ready for stress test.\n`);

  // 3. Define the atomic transaction logic (identical to your server.js API)
  const attemptReservation = async (userName) => {
    try {
      const result = await prisma.$transaction(async (tx) => {
        // Step A: Check inventory
        const currentSpot = await tx.parkingSpot.findUnique({ where: { id: spot.id } });
        
        if (currentSpot.availableSpots <= 0) {
          throw new Error("Race condition prevented: Spot is no longer available.");
        }

        // Step B: Atomic decrement
        await tx.parkingSpot.update({
          where: { id: spot.id },
          data: { availableSpots: { decrement: 1 } }
        });

        // Step C: Create order
        return await tx.reservation.create({
          data: {
            userId: `mock-user-${userName}`,
            spotId: spot.id,
            startTime: new Date(),
            endTime: new Date(Date.now() + 60 * 60 * 1000), // +1 Hour
            status: 'PENDING'
          }
        });
      });
      console.log(`✅ SUCCESS: ${userName} successfully locked the spot! Reservation ID: ${result.id}`);
    } catch (error) {
      console.log(`❌ REJECTED for ${userName}: ${error.message}`);
    }
  };

  console.log('💥 FIRE! Simulating Alice and Bob clicking at the exact same millisecond...\n');

  // 4. Trigger both requests concurrently using Promise.all
  await Promise.all([
    attemptReservation('Alice'),
    attemptReservation('Bob')
  ]);

  // 5. Verify the final inventory status
  const finalSpot = await prisma.parkingSpot.findUnique({ where: { id: spot.id } });
  console.log(`\n📊 Final Available Spots for this location: ${finalSpot.availableSpots}`);
  
  if (finalSpot.availableSpots === 0) {
    console.log('🏆 TEST PASSED: System successfully prevented overselling!');
  } else {
    console.log('🚨 TEST FAILED: Inventory is incorrect.');
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
