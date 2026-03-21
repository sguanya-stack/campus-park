const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// 📍 纯正西雅图 SLU 真实容量与价格映射表 (Consolidated Data)
const seattleLocations = [
  { 
    name: "Amazon Spheres Garage", address: "2111 7th Ave, Seattle", 
    zone: "South Lake Union", total: 1000, ev: 50, price: 9.99 // ChargePoint 核心区，大容量
  },
  { 
    name: "Whole Foods SLU Garage", address: "2200 Westlake Ave, Seattle", 
    zone: "Westlake Ave", total: 400, ev: 15, price: 11.49 // 商业综合体，中位价
  },
  { 
    name: "Northeastern University SLU Lot", address: "401 Terry Ave N, Seattle", 
    zone: "Terry Ave", total: 250, ev: 12, price: 13.99 // 校园专属车位
  },
  { 
    name: "MOHAI Museum Parking", address: "860 Terry Ave N, Seattle", 
    zone: "Terry Ave", total: 150, ev: 4, price: 10.00 // 博物馆周边公共车位
  },
  { 
    name: "Westlake Hub Garage", address: "320 Westlake Ave N, Seattle", 
    zone: "Westlake Ave", total: 350, ev: 12, price: 4.99 // 办公枢纽
  },
  { 
    name: "Mercer Street Open Lot", address: "500 Mercer St, Seattle", 
    zone: "Mercer St", total: 80, ev: 2, price: 15.00 // 露天平地停车场，容量小
  },
  { 
    name: "Fairview Ave N Lot", address: "1165 Fairview Ave N, Seattle", 
    zone: "Fairview Ave N", total: 100, ev: 2, price: 9.00 // 中小型地面停车
  },
  { 
    name: "Boren Ave Garage", address: "1055 Boren Ave N, Seattle", 
    zone: "Boren Ave N", total: 300, ev: 10, price: 6.99 // 办公楼底商车库
  },
  { 
    name: "Terry Ave North Parking", address: "434 Terry Ave N, Seattle", 
    zone: "Terry Ave", total: 200, ev: 8, price: 8.00 // 中型车库
  },
  { 
    name: "Valley St Street Parking", address: "800 Valley St, Seattle", 
    zone: "Valley St", total: 50, ev: 0, price: 5.99 // 街边路停 (Street Parking)，无电车桩
  }
];

async function main() {
  console.log('🚀 Starting precise data seeding with real Seattle capacities...');

  await prisma.parkingSpot.deleteMany({});
  console.log('🧹 Cleared all messy legacy data (No more Level 1/2/3 duplicates).');

  const spotsToCreate = seattleLocations.map(loc => {
    // 💥 真实早高峰模拟：20% 的停车场彻底爆满
    const isFull = Math.random() < 0.20;
    
    // 如果没满，模拟只剩下极少数空位 (不超过总量的 10%)
    const available = isFull ? 0 : Math.floor(Math.random() * (loc.total * 0.10)) + 1; 

    return {
      name: loc.name,
      address: loc.address,
      zone: loc.zone,
      totalSpots: loc.total,             // 真实的物理总容量
      availableSpots: available,         // 模拟的早高峰可预约数
      pricePerHour: loc.price,
      priceText: `$${loc.price.toFixed(2)}/hr`,
      isEV: loc.ev > 0,                  // 根据 ev 数量推断是否显示 EV 标签
      status: available > 0 ? 'active' : 'full' // 满库自动切状态
    };
  });

  const result = await prisma.parkingSpot.createMany({
    data: spotsToCreate,
    skipDuplicates: true,
  });

  console.log(`🎉 Successfully seeded ${result.count} consolidated, high-quality Seattle locations!`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('❌ Seeding failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
