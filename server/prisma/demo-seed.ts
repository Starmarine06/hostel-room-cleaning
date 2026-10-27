// Fills a DEMO database with sample rooms, people and requests so the system can be tried out.
// It WIPES the database it points at, so it only runs when DEMO_RESET=yes is set on purpose.
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { prisma, pool } from '../src/db.js';

if (process.env.DEMO_RESET !== 'yes') {
  throw new Error('Refusing to run: this wipes the database. Set DEMO_RESET=yes to confirm it is a demo database.');
}

const need = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

const minutes = (n: number) => new Date(Date.now() - n * 60_000);
const hash = (plain: string) => bcrypt.hash(plain, 12);
// People who exist only to fill rooms; nobody knows their passwords
const unknownPassword = () => hash(randomBytes(18).toString('base64url'));

async function main() {
  await prisma.cleaningRequest.deleteMany();
  await prisma.rateLimit.deleteMany();
  await prisma.user.deleteMany();
  await prisma.room.deleteMany();

  const room = (number: string) => prisma.room.create({ data: { number, building: 'T', floor: 2, capacity: 4 } });
  const [r230, r231, r232, r233] = await Promise.all([room('T-230'), room('T-231'), room('T-232'), room('T-233')]);

  const person = async (email: string, name: string, role: 'ADMIN' | 'CLEANER' | 'RESIDENT', password: string, roomId?: string) =>
    prisma.user.create({
      data: { email, name, role, roomId: roomId ?? null, password: await hash(password), activatedAt: new Date() },
    });

  await person('admin.demo@example.com', 'Demo Admin', 'ADMIN', need('DEMO_ADMIN_PASSWORD'));
  const cleaner = await person('cleaner.demo@example.com', 'Demo Cleaner', 'CLEANER', need('DEMO_CLEANER_PASSWORD'));
  await person('student.demo@example.com', 'Demo Student', 'RESIDENT', need('DEMO_STUDENT_PASSWORD'), r230.id);

  const filler = async (email: string, name: string, roomId: string) =>
    prisma.user.create({
      data: { email, name, role: 'RESIDENT', roomId, password: await unknownPassword(), activatedAt: new Date() },
    });
  await filler('roommate1.demo@example.com', 'Demo Roommate A', r230.id);
  await filler('roommate2.demo@example.com', 'Demo Roommate B', r230.id);
  const kiran = await filler('kiran.demo@example.com', 'Kiran Rao', r231.id);
  await filler('meera.demo@example.com', 'Meera Das', r231.id);
  const arjun = await filler('arjun.demo@example.com', 'Arjun Nair', r232.id);
  await filler('sana.demo@example.com', 'Sana Khan', r233.id);

  // One request waiting for a cleaner to claim, and one finished earlier, so every screen has something to show
  await prisma.cleaningRequest.create({
    data: { roomId: r231.id, requestedBy: kiran.id, status: 'PENDING', requestedAt: minutes(35) },
  });
  await prisma.cleaningRequest.create({
    data: {
      roomId: r232.id,
      requestedBy: arjun.id,
      status: 'CONFIRMED',
      cleanerId: cleaner.id,
      confirmedBy: arjun.id,
      requestedAt: minutes(60 * 26),
      claimedAt: minutes(60 * 25),
      cleanedAt: minutes(60 * 24),
      confirmedAt: minutes(60 * 23),
    },
  });

  console.log('Demo data ready: 4 rooms, 9 people, 2 requests');
}

main().finally(async () => {
  await prisma.$disconnect();
  await pool.end();
});
