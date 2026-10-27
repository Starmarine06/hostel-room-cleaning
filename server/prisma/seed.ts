import bcrypt from 'bcryptjs';
import { prisma, pool } from '../src/db.js';

async function main() {
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@hostel.com').toLowerCase();
  const password = process.env.SEED_PASSWORD || 'password123';
  const hash = await bcrypt.hash(password, 12);

  const rooms = [];
  for (const number of ['A-101', 'A-102', 'A-201']) {
    const [block, digits] = number.split('-');
    rooms.push(
      await prisma.room.upsert({
        where: { number },
        update: {},
        create: { number, building: block, floor: Math.floor(Number(digits) / 100), capacity: 4 },
      })
    );
  }

  const users = [
    { email: adminEmail, name: 'Admin', role: 'ADMIN' as const, roomId: null },
    { email: 'cleaner@hostel.com', name: 'Casey Cleaner', role: 'CLEANER' as const, roomId: null },
    { email: 'resident@hostel.com', name: 'Riley Resident', role: 'RESIDENT' as const, roomId: rooms[0].id },
  ];
  for (const u of users) {
    await prisma.user.upsert({ where: { email: u.email }, update: {}, create: { ...u, password: hash } });
  }

  console.log('Seeded demo admin, cleaner, resident and sample rooms');
}

main().finally(async () => {
  await prisma.$disconnect();
  await pool.end();
});
