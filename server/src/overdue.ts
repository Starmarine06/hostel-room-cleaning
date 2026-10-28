// A room that has waited this long without being cleaned is reported to the admins
import { prisma } from './db.js';
import { publish } from './realtime.js';

export const OVERDUE_HOURS = 4;
export const OVERDUE_MS = OVERDUE_HOURS * 60 * 60 * 1000;

const OPEN = ['PENDING', 'IN_PROGRESS'] as const;

const include = {
  room: { select: { id: true, number: true, building: true, floor: true } },
  requester: { select: { id: true, name: true, email: true } },
  cleaner: { select: { id: true, name: true, email: true } },
};

// Requests still waiting to be cleaned after OVERDUE_HOURS, oldest first
export function findOverdue() {
  return prisma.cleaningRequest.findMany({
    where: { status: { in: [...OPEN] }, requestedAt: { lt: new Date(Date.now() - OVERDUE_MS) } },
    orderBy: { requestedAt: 'asc' },
    include,
  });
}

// Tells the admins about each overdue request once. Claiming the alert with updateMany keeps parallel
// instances from announcing the same request twice.
export async function sweepOverdue() {
  const due = await prisma.cleaningRequest.findMany({
    where: { status: { in: [...OPEN] }, requestedAt: { lt: new Date(Date.now() - OVERDUE_MS) }, overdueAlertedAt: null },
    select: { id: true },
  });
  for (const { id } of due) {
    const claimed = await prisma.cleaningRequest.updateMany({
      where: { id, overdueAlertedAt: null, status: { in: [...OPEN] } },
      data: { overdueAlertedAt: new Date() },
    });
    if (claimed.count === 0) continue;
    const request = await prisma.cleaningRequest.findUniqueOrThrow({ where: { id }, include });
    await publish(['admins'], 'request:overdue', request);
  }
}

// Functions have no timer of their own, so any API call may trigger the sweep, at most once a minute
let lastSweep = 0;
export async function sweepOverdueThrottled() {
  if (Date.now() - lastSweep < 60_000) return;
  lastSweep = Date.now();
  try {
    await sweepOverdue();
  } catch (error) {
    console.error('Overdue sweep failed:', error);
  }
}
