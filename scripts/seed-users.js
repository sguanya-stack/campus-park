require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const prisma = new PrismaClient();

function hashPassword(password, salt) {
  return crypto.createHmac('sha256', salt).update(password).digest('hex');
}

const firstNames = [
  'Emma','Liam','Olivia','Noah','Ava','William','Sophia','James','Isabella','Oliver',
  'Mia','Benjamin','Charlotte','Elijah','Amelia','Lucas','Harper','Mason','Evelyn','Logan',
  'Wei','Jing','Ming','Fang','Lei','Xiao','Yan','Hui','Cheng','Yu',
  'Maria','Carlos','Sofia','Miguel','Valentina','Luis','Ana','Diego','Elena','Pedro',
  'Aisha','Omar','Fatima','Hassan','Layla','Ahmed','Zara','Yusuf','Nour','Ibrahim',
  'Priya','Arjun','Divya','Raj','Neha','Vikram','Ananya','Sanjay','Pooja','Rohit',
  'Yuki','Kenji','Sakura','Takeshi','Hana','Ryo','Akemi','Haruto','Yui','Kenta',
  'Alex','Jordan','Taylor','Morgan','Casey','Riley','Avery','Quinn','Peyton','Blake',
  'Marcus','Jasmine','Tyrone','Alicia','Devon','Imani','Darius','Keisha','Malik','Tanya',
  'Ivan','Natasha','Dmitri','Olga','Alexei','Katya','Boris','Irina','Sergei','Anya',
  'Finn','Siobhan','Cormac','Aoife','Declan','Niamh','Seamus','Brigid','Patrick','Orla',
  'Lars','Ingrid','Erik','Astrid','Bjorn','Freya','Sven','Helga','Gunnar','Sigrid',
  'Jean','Marie','Pierre','Claire','Francois','Sophie','Antoine','Camille','Louis','Isabelle',
];

const lastNames = [
  'Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Wilson','Taylor',
  'Chen','Wang','Li','Zhang','Liu','Yang','Huang','Wu','Zhou','Lin',
  'Rodriguez','Martinez','Hernandez','Lopez','Gonzalez','Perez','Sanchez','Ramirez','Torres','Flores',
  'Kim','Park','Lee','Choi','Jung','Kang','Cho','Yoon','Lim','Han',
  'Patel','Singh','Shah','Kumar','Sharma','Gupta','Mehta','Joshi','Desai','Rao',
  'Anderson','Thomas','Jackson','White','Harris','Martin','Thompson','Moore','Young','Allen',
  'Walker','Hall','King','Scott','Green','Baker','Adams','Nelson','Carter','Mitchell',
  'Nguyen','Tran','Pham','Vu','Dang','Do','Le','Ly','Ho','Bui',
  'Muller','Schmidt','Schneider','Fischer','Weber','Meyer','Wagner','Becker','Schulz','Hoffmann',
];

function randPlate() {
  const L = 'ABCDEFGHJKLMNPRSTUVWXYZ', D = '0123456789';
  const l = n => Array.from({length:n}, () => L[Math.floor(Math.random()*L.length)]).join('');
  const d = n => Array.from({length:n}, () => D[Math.floor(Math.random()*D.length)]).join('');
  const fmts = [() => d(1)+l(3)+d(3), () => l(3)+d(4), () => d(2)+l(3)+d(2)];
  return fmts[Math.floor(Math.random()*fmts.length)]();
}

const personas = [
  { type:'commuter',      weight:0.30, daysPerWeek:5, preferMorning:true,  durations:[8,9,10], preferCheap:true  },
  { type:'student',       weight:0.25, daysPerWeek:4, preferMorning:false, durations:[2,3,4],  preferCheap:true  },
  { type:'shopper',       weight:0.15, daysPerWeek:2, preferMorning:false, durations:[1,2,3],  preferCheap:false },
  { type:'professional',  weight:0.15, daysPerWeek:5, preferMorning:true,  durations:[6,7,8],  preferCheap:false },
  { type:'occasional',    weight:0.10, daysPerWeek:1, preferMorning:false, durations:[1,2],    preferCheap:false },
  { type:'evening_event', weight:0.05, daysPerWeek:1, preferMorning:false, durations:[2,3,4],  preferCheap:false },
];

const spots = [
  { id:'cmmzvqgyi0000d06kzs6dmqhq', price:9.99  },
  { id:'cmmzvqgyi0001d06kb8o5sfc1', price:11.49 },
  { id:'cmmzvqgyi0002d06kucw2dugz', price:13.99 },
  { id:'cmmzvqgyi0003d06k331sj4hk', price:10    },
  { id:'cmmzvqgyi0004d06k89korots', price:4.99  },
  { id:'cmmzvqgyi0005d06kkyo6zj3h', price:15    },
  { id:'cmmzvqgyi0006d06k7dngdhr2', price:9     },
  { id:'cmmzvqgyi0007d06kyk5u6so4', price:6.99  },
  { id:'cmmzvqgyi0008d06kvmeg5rbs', price:8     },
  { id:'cmmzvqgyi0009d06k2u6p31yg', price:5.99  },
];
const cheapSpots = spots.filter(s => s.price < 7);
const premiumSpots = spots.filter(s => s.price >= 9);

function pickPersona() {
  let r = Math.random(), cum = 0;
  for (const p of personas) { cum += p.weight; if (r < cum) return p; }
  return personas[0];
}

function pickSpot(persona) {
  const pool = persona.preferCheap ? cheapSpots : premiumSpots;
  const src = Math.random() < 0.65 ? pool : spots;
  return src[Math.floor(Math.random() * src.length)];
}

function randDate(start, end) {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

function pickStatus(startTime, now) {
  if (startTime > now) return 'PENDING';
  if (startTime < new Date(now - 30*24*60*60*1000)) return Math.random() < 0.04 ? 'CANCELLED' : 'COMPLETED';
  return Math.random() < 0.25 ? 'ACTIVE' : 'COMPLETED';
}

const searchZones = [
  { lat:47.6155, lng:-122.3400, r:0.008 },
  { lat:47.6210, lng:-122.3490, r:0.006 },
  { lat:47.6085, lng:-122.3310, r:0.007 },
  { lat:47.6255, lng:-122.3345, r:0.005 },
  { lat:47.6125, lng:-122.3455, r:0.009 },
];

function randSearchPt() {
  const z = searchZones[Math.floor(Math.random()*searchZones.length)];
  const a = Math.random()*2*Math.PI, r = Math.random()*z.r;
  return { lat: z.lat + r*Math.cos(a), lng: z.lng + r*Math.sin(a) };
}

async function main() {
  const now = new Date();
  const sixMonthsAgo = new Date(now - 180*24*60*60*1000);

  const existing = await prisma.appUser.findMany({ select:{ name:true } });
  const usedNames = new Set(existing.map(u => u.name));
  console.log(`Existing users: ${existing.length}`);

  // Build 200 user records
  const toCreate = [];
  let attempts = 0;
  while (toCreate.length < 200 && attempts < 3000) {
    attempts++;
    const fn = firstNames[Math.floor(Math.random()*firstNames.length)];
    const ln = lastNames[Math.floor(Math.random()*lastNames.length)];
    const sfx = Math.random() < 0.4 ? String(Math.floor(Math.random()*99)+1) : '';
    const name = fn + ln + sfx;
    if (usedNames.has(name)) continue;
    usedNames.add(name);
    const salt = crypto.randomBytes(12).toString('hex');
    const createdAt = randDate(sixMonthsAgo, now);
    toCreate.push({ name, salt, hash: hashPassword('password123', salt), createdAt, persona: pickPersona() });
  }

  console.log(`Creating ${toCreate.length} users sequentially...`);
  const created = [];
  for (let i = 0; i < toCreate.length; i++) {
    const u = toCreate[i];
    try {
      const r = await prisma.appUser.create({
        data: { name: u.name, role:'student', passwordSalt: u.salt, passwordHash: u.hash, createdAt: u.createdAt },
        select: { id:true }
      });
      created.push({ id: r.id, persona: u.persona, createdAt: u.createdAt });
    } catch (_) {}
    if ((i+1) % 20 === 0) process.stdout.write(`\r  ${i+1}/${toCreate.length} users`);
  }
  console.log(`\n  Done: ${created.length} users created`);

  // Build all reservation records in memory, then batch insert
  console.log('Building reservations...');
  const usedTickets = new Set();
  const chars = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
  function genTicket() {
    let t;
    do { t = Array.from({length:6}, () => chars[Math.floor(Math.random()*chars.length)]).join(''); }
    while (usedTickets.has(t));
    usedTickets.add(t);
    return t;
  }

  const allReservations = [];
  for (const user of created) {
    const p = user.persona;
    const weeksActive = Math.max(1, Math.floor((now - user.createdAt)/(7*24*60*60*1000)));
    const numRes = Math.min(Math.floor(weeksActive * p.daysPerWeek * (0.3 + Math.random()*0.5)), 35);

    for (let r = 0; r < numRes; r++) {
      const spot = pickSpot(p);
      const startTime = randDate(user.createdAt, now);
      let hour;
      if (p.preferMorning) hour = 7 + Math.floor(Math.random()*3);
      else if (p.type === 'evening_event') hour = 18 + Math.floor(Math.random()*3);
      else hour = 10 + Math.floor(Math.random()*8);
      startTime.setHours(hour, Math.floor(Math.random()*60), 0, 0);

      const dur = p.durations[Math.floor(Math.random()*p.durations.length)];
      const endTime = new Date(startTime.getTime() + dur*60*60*1000);
      const status = pickStatus(startTime, now);
      const finalAmount = (status==='COMPLETED'||status==='ACTIVE')
        ? parseFloat((spot.price * dur).toFixed(2)) : null;

      allReservations.push({
        userId: user.id, spotId: spot.id,
        startTime, endTime,
        plateNumber: randPlate(),
        ticketCode: genTicket(),
        status, finalAmount,
        checkInTime: (status==='ACTIVE'||status==='COMPLETED') ? startTime : null,
        checkOutTime: status==='COMPLETED' ? endTime : null,
        createdAt: startTime,
      });
    }
  }

  console.log(`Inserting ${allReservations.length} reservations in batches...`);
  const RES_BATCH = 50;
  let inserted = 0;
  for (let i = 0; i < allReservations.length; i += RES_BATCH) {
    const batch = allReservations.slice(i, i+RES_BATCH);
    try {
      const r = await prisma.reservation.createMany({ data: batch, skipDuplicates: true });
      inserted += r.count;
    } catch(e) {
      // fallback: insert one by one
      for (const row of batch) {
        try { await prisma.reservation.create({ data: row }); inserted++; } catch(_) {}
      }
    }
    if ((i+RES_BATCH) % 200 === 0) process.stdout.write(`\r  ${Math.min(i+RES_BATCH, allReservations.length)}/${allReservations.length}`);
  }
  console.log(`\n  Done: ${inserted} reservations inserted`);

  // Search logs for heatmap (300 recent points)
  console.log('Creating search logs...');
  const twelveHAgo = new Date(now - 12*60*60*1000);
  const logs = Array.from({length:300}, () => {
    const pt = randSearchPt();
    return { lat: pt.lat, lng: pt.lng, createdAt: randDate(twelveHAgo, now) };
  });
  await prisma.searchLog.createMany({ data: logs });

  const [uc, rc, lc] = await Promise.all([
    prisma.appUser.count(), prisma.reservation.count(), prisma.searchLog.count()
  ]);
  console.log(`\n✅ 完成！`);
  console.log(`   用户总数:    ${uc}`);
  console.log(`   预约总数:    ${rc}`);
  console.log(`   搜索日志:    ${lc}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
