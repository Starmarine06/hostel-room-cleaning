import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Migrations need a direct (non-pooled) connection. Neon injects DATABASE_URL_UNPOOLED; locally one URL is enough.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  datasource: { url: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || '' },
});
