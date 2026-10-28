import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import bcrypt from 'bcryptjs';
import { prisma } from './db.js';
import { Prisma } from './generated/client.js';
import { attachClient, type LiveSocket } from './realtime.js';
import { loginRateLimit } from './rateLimit.js';
import authRoutes from './routes/auth.js';
import roomRoutes from './routes/rooms.js';
import requestRoutes from './routes/requests.js';
import userRoutes from './routes/users.js';
import reportRoutes from './routes/reports.js';
import { sweepOverdue, sweepOverdueThrottled } from './overdue.js';

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set');
}

// CLIENT_URL may list several origins, comma separated
const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:3000').split(',').map((o) => o.trim());

// On a fresh deployment there is no way to sign in yet, so create the first admin from the environment
async function ensureAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;
  if (await prisma.user.findUnique({ where: { email } })) return;
  try {
    await prisma.user.create({
      data: { email, name: 'Admin', role: 'ADMIN', password: await bcrypt.hash(password, 12), activatedAt: new Date() },
    });
    console.log(`Created admin ${email}`);
  } catch (error) {
    // Another instance created it a moment earlier: that is fine
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
  }
}

export interface AppOptions {
  // Provided by the runtime that can upgrade a request to a WebSocket (Neon Functions)
  upgrade?: (request: Request) => { socket: LiveSocket; response: Response };
}

// Retried on later requests until it succeeds (for example if the first try ran before the migrations did)
let adminDone = false;
let adminAttempt: Promise<void> | undefined;
function adminReady() {
  if (adminDone) return Promise.resolve();
  adminAttempt ??= ensureAdmin()
    .then(() => {
      adminDone = true;
    })
    .catch((error) => console.error('Could not create admin:', error))
    .finally(() => {
      adminAttempt = undefined;
    });
  return adminAttempt;
}

export function createApp(options: AppOptions = {}) {
  const app = new Hono();

  app.use(
    '/api/*',
    cors({
      origin: allowedOrigins,
      credentials: true,
      allowHeaders: ['Content-Type', 'Authorization'],
      allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    })
  );
  // Hardening headers on every API answer, and nothing personal is ever cached by a browser or proxy
  app.use('/api/*', secureHeaders());
  app.use('/api/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });
  app.use('/api/*', bodyLimit({ maxSize: 2 * 1024 * 1024, onError: (c) => c.json({ message: 'Request too large' }, 413) }));
  app.use('/api/*', async (_c, next) => {
    await adminReady(); // the very first request must not race the admin creation
    await sweepOverdueThrottled();
    await next();
  });

  app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

  // Called by the scheduled GitHub workflow so overdue alerts go out even when nobody is using the site
  app.post('/api/internal/sweep', async (c) => {
    const secret = process.env.CRON_SECRET;
    if (!secret || c.req.header('authorization') !== `Bearer ${secret}`) return c.json({ message: 'Forbidden' }, 403);
    await sweepOverdue();
    return c.json({ ok: true });
  });

  app.use('/api/auth/login', loginRateLimit());
  app.use('/api/auth/google', loginRateLimit());

  app.route('/api/auth', authRoutes.app);
  app.route('/api/users', userRoutes.app);
  app.route('/api/rooms', roomRoutes.app);
  app.route('/api/requests', requestRoutes.app);
  app.route('/api/reports', reportRoutes.app);

  if (options.upgrade) {
    const upgrade = options.upgrade;
    app.get('/ws', (c) => {
      if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') return c.text('Expected a WebSocket connection', 426);
      const { socket, response } = upgrade(c.req.raw);
      void attachClient(socket);
      return response; // must be returned untouched
    });
  }

  app.notFound((c) => c.json({ message: 'Not found' }, 404));
  app.onError((error, c) => {
    console.error('Unhandled error:', error);
    return c.json({ message: 'Internal server error' }, 500);
  });

  return app;
}
