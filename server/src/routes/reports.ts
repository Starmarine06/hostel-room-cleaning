import { Router, Response } from '../http.js';
import { prisma } from '../db.js';
import { Prisma } from '../generated/client.js';
import { authenticate, AuthRequest, authorize } from '../middleware/auth.js';
import { validateQuery } from '../middleware/validation.js';
import { reportQuerySchema } from '../utils/schemas.js';
import { findOverdue, sweepOverdueThrottled, OVERDUE_HOURS, OVERDUE_MS } from '../overdue.js';

const router = new Router();
router.use(authenticate, authorize('ADMIN'));

const HOUR = 60 * 60 * 1000;
const round = (n: number) => Math.round(n * 100) / 100;

// "2026-10-01" as an end date means the whole of that day
function parseQuery(query: Record<string, string>) {
  const { from, to, block } = reportQuerySchema.parse(query);
  const range: { gte?: Date; lte?: Date } = {};
  if (from) range.gte = new Date(from);
  if (to) {
    const end = new Date(to);
    range.lte = /^\d{4}-\d{2}-\d{2}$/.test(to) ? new Date(end.getTime() + 24 * HOUR - 1) : end;
  }
  return { range, block };
}

interface Row {
  status: string;
  requestedAt: Date;
  cleanedAt: Date | null;
  rating: number | null;
}

// The numbers every report shows for a group of requests
function summarise(rows: Row[]) {
  const now = Date.now();
  const cleaned = rows.filter((r) => r.cleanedAt);
  const rated = rows.filter((r) => r.rating !== null);
  const waits = cleaned.map((r) => r.cleanedAt!.getTime() - r.requestedAt.getTime());
  return {
    requests: rows.length,
    confirmed: rows.filter((r) => r.status === 'CONFIRMED').length,
    rejected: rows.filter((r) => r.status === 'REJECTED').length,
    open: rows.filter((r) => r.status === 'PENDING' || r.status === 'IN_PROGRESS').length,
    // Cleaned later than OVERDUE_HOURS after the request, or still waiting after that long
    late: rows.filter((r) => (r.cleanedAt ? r.cleanedAt.getTime() : now) - r.requestedAt.getTime() > OVERDUE_MS).length,
    avgHoursToClean: waits.length ? round(waits.reduce((a, b) => a + b, 0) / waits.length / HOUR) : null,
    ratingCount: rated.length,
    avgRating: rated.length ? round(rated.reduce((a, r) => a + r.rating!, 0) / rated.length) : null,
  };
}

function groupBy<T>(items: T[], key: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    groups.set(k, [...(groups.get(k) ?? []), item]);
  }
  return groups;
}

function where(range: { gte?: Date; lte?: Date }, block?: string): Prisma.CleaningRequestWhereInput {
  return {
    ...((range.gte || range.lte) && { requestedAt: range }),
    ...(block && { room: { building: block } }),
  };
}

const fail = (res: Response, error: unknown, what: string) => {
  console.error(`${what} report error:`, error);
  return res.status(500).json({ message: `Failed to build the ${what} report` });
};

// Requests waiting more than OVERDUE_HOURS for a cleaner or for the cleaning to be done
router.get('/overdue', async (_req: AuthRequest, res: Response) => {
  try {
    await sweepOverdueThrottled();
    const now = Date.now();
    const data = (await findOverdue()).map((r) => ({ ...r, hoursWaiting: round((now - r.requestedAt.getTime()) / HOUR) }));
    res.json({ thresholdHours: OVERDUE_HOURS, data });
  } catch (error) {
    fail(res, error, 'overdue');
  }
});

// One line per block for the chosen dates
router.get('/blocks', validateQuery(reportQuerySchema), async (req: AuthRequest, res: Response) => {
  try {
    const { range, block } = parseQuery(req.query);
    const requests = await prisma.cleaningRequest.findMany({
      where: where(range, block),
      select: { status: true, requestedAt: true, cleanedAt: true, rating: true, room: { select: { building: true } } },
    });
    const data = [...groupBy(requests, (r) => r.room.building)]
      .map(([b, rows]) => ({ block: b, ...summarise(rows) }))
      .sort((a, b) => a.block.localeCompare(b.block));
    res.json({ data, totals: summarise(requests) });
  } catch (error) {
    fail(res, error, 'block');
  }
});

// One line per room, optionally for a single block
router.get('/rooms', validateQuery(reportQuerySchema), async (req: AuthRequest, res: Response) => {
  try {
    const { range, block } = parseQuery(req.query);
    const requests = await prisma.cleaningRequest.findMany({
      where: where(range, block),
      select: {
        status: true,
        requestedAt: true,
        cleanedAt: true,
        rating: true,
        room: { select: { number: true, building: true, floor: true } },
      },
    });
    const data = [...groupBy(requests, (r) => r.room.number)]
      .map(([number, rows]) => ({ room: number, block: rows[0].room.building, floor: rows[0].room.floor, ...summarise(rows) }))
      .sort((a, b) => a.block.localeCompare(b.block) || a.room.localeCompare(b.room, undefined, { numeric: true }));
    res.json({ data, totals: summarise(requests) });
  } catch (error) {
    fail(res, error, 'room');
  }
});

// Ratings per cleaner, plus the written feedback behind them
router.get('/ratings', validateQuery(reportQuerySchema), async (req: AuthRequest, res: Response) => {
  try {
    const { range, block } = parseQuery(req.query);
    const requests = await prisma.cleaningRequest.findMany({
      where: { ...where(range, block), cleanerId: { not: null } },
      orderBy: { confirmedAt: 'desc' },
      select: {
        status: true,
        requestedAt: true,
        cleanedAt: true,
        rating: true,
        feedback: true,
        confirmedAt: true,
        room: { select: { number: true, building: true } },
        cleaner: { select: { id: true, name: true, email: true } },
      },
    });
    const byRating = (a: { avgRating: number | null }, b: { avgRating: number | null }) => (b.avgRating ?? 0) - (a.avgRating ?? 0);
    const data = [...groupBy(requests, (r) => r.cleaner!.id)]
      .map(([, rows]) => ({ cleaner: rows[0].cleaner!.name, email: rows[0].cleaner!.email, ...summarise(rows) }))
      .sort(byRating);
    const blocks = [...groupBy(requests, (r) => r.room.building)].map(([block, rows]) => ({ block, ...summarise(rows) })).sort(byRating);
    const rooms = [...groupBy(requests, (r) => r.room.number)]
      .map(([room, rows]) => ({ room, block: rows[0].room.building, ...summarise(rows) }))
      .sort(byRating);
    const comments = requests
      .filter((r) => r.rating !== null)
      .slice(0, 100)
      .map((r) => ({ room: r.room.number, cleaner: r.cleaner!.name, rating: r.rating, feedback: r.feedback, at: r.confirmedAt }));
    res.json({ data, blocks, rooms, totals: summarise(requests), comments });
  } catch (error) {
    fail(res, error, 'rating');
  }
});

export default router;
