import 'dotenv/config';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client.js';

// Neon's URLs say sslmode=require, which node-postgres already treats as verify-full; say so explicitly
export const secureUrl = (url: string | undefined) => url?.replace('sslmode=require', 'sslmode=verify-full');

// One small pool for the whole instance (Neon Functions share instances between requests)
export const pool = new pg.Pool({ connectionString: secureUrl(process.env.DATABASE_URL), max: 5 });

// Only exists on Neon: stops an idle-connection drop from crashing the instance
if (process.env.NEON_BRANCH) {
  const { attachDatabasePool } = await import('@neon/functions');
  attachDatabasePool(pool);
}

export const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
