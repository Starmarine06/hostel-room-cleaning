import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { PrismaClient } from '@prisma/client';
import authRoutes from './routes/auth.js';
import roomRoutes from './routes/rooms.js';
import requestRoutes from './routes/requests.js';
import userRoutes from './routes/users.js';

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set');
}

// CLIENT_URL may list several origins, comma separated
const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:3000').split(',').map((o) => o.trim());

const app = express();
// Render and similar hosts sit behind a proxy; needed for correct client IPs in rate limiting
app.set('trust proxy', 1);
const httpServer = createServer(app);
export const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

export const prisma = new PrismaClient();

// Socket.io authentication middleware
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }

    const jwt = await import('jsonwebtoken');
    const decoded = jwt.default.verify(token, process.env.JWT_SECRET!) as {
      id: string;
      email: string;
      name: string;
      role: string;
      roomId: string | null;
    };

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, email: true, name: true, role: true, roomId: true },
    });

    if (!user) {
      return next(new Error('User not found'));
    }

    socket.data.user = user;
    next();
  } catch (error) {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id, 'User:', socket.data.user.name);

  const user = socket.data.user;

  // Auto-join rooms based on user role
  if (user.roomId) {
    socket.join(`room:${user.roomId}`);
    console.log(`User ${user.name} joined room:${user.roomId}`);
  }

  if (user.role === 'CLEANER') {
    socket.join('cleaners');
    console.log(`Cleaner ${user.name} joined cleaners room`);
  }

  // Handle manual room joining (for admins viewing other rooms)
  socket.on('join-room', (roomId: string) => {
    if (user.role === 'ADMIN' || user.roomId === roomId) {
      socket.join(`room:${roomId}`);
      console.log(`User ${user.name} joined room:${roomId}`);
    }
  });

  socket.on('join-cleaners', () => {
    if (user.role === 'CLEANER' || user.role === 'ADMIN') {
      socket.join('cleaners');
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));
app.use(express.json({ limit: '2mb' }));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Slow down password guessing
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.LOGIN_RATE_LIMIT) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many sign-in attempts. Please wait 15 minutes and try again.' },
});
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/google', loginLimiter);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/requests', requestRoutes);

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ message: 'Internal server error' });
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ message: 'Not found' });
});

const PORT = process.env.PORT || 4000;

// On a fresh deployment there is no way to sign in yet, so create the first admin from the environment
async function ensureAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;
  if (await prisma.user.findUnique({ where: { email } })) return;
  await prisma.user.create({
    data: { email, name: 'Admin', role: 'ADMIN', password: await bcrypt.hash(password, 12), activatedAt: new Date() },
  });
  console.log(`Created admin ${email}`);
}

httpServer.listen(PORT, () => {
  ensureAdmin().catch((error) => console.error('Could not create admin:', error));
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📡 Socket.io ready`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  await prisma.$disconnect();
  httpServer.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully');
  await prisma.$disconnect();
  httpServer.close(() => {
    process.exit(0);
  });
});