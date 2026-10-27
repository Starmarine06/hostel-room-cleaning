import { spawn, spawnSync, ChildProcess } from 'node:child_process';
import pg from 'pg';

const PORT = '4100';
const BASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/hostel_cleaning?schema=public';
// A brand-new database for every run, dropped afterwards, so tests never touch real data
const TEST_DB = `hostel_test_${Date.now().toString(36)}`;
const withDb = (name: string) => BASE_URL.replace(/\/[^/?]+(\?|$)/, `/${name}$1`);
const TEST_URL = withDb(TEST_DB);
const shell = process.platform === 'win32';

let server: ChildProcess | undefined;

function run(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell,
    env: { ...process.env, DATABASE_URL: TEST_URL, DATABASE_URL_UNPOOLED: '' },
  });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed`);
}

async function admin<T>(fn: (client: pg.Client) => Promise<T>) {
  const client = new pg.Client({ connectionString: withDb('postgres') });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

// REMOTE_API=https://host (no trailing /api) runs the same tests against a deployed API instead
const REMOTE = process.env.REMOTE_API?.replace(/\/$/, '');

export async function setup() {
  if (REMOTE) {
    process.env.API_URL = `${REMOTE}/api`;
    process.env.WS_URL = `${REMOTE.replace(/^http/, 'ws')}/ws`;
    return;
  }
  await admin((c) => c.query(`CREATE DATABASE "${TEST_DB}"`));
  run('npx', ['prisma', 'migrate', 'deploy']);
  run('npx', ['tsx', 'prisma/seed.ts']);

  server = spawn('npx', ['tsx', 'src/dev.ts'], {
    stdio: 'inherit',
    shell,
    env: {
      ...process.env,
      DATABASE_URL: TEST_URL,
      DATABASE_URL_UNPOOLED: '',
      PORT,
      JWT_SECRET: process.env.JWT_SECRET || 'test-secret',
      LOGIN_RATE_LIMIT: '100000',
    },
  });

  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/api/health`)).ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
    if (i === 59) throw new Error('test server did not start');
  }
  process.env.API_URL = `http://localhost:${PORT}/api`;
  process.env.WS_URL = `ws://localhost:${PORT}/ws`;
}

export async function teardown() {
  if (REMOTE) return;
  if (server?.pid) {
    if (shell) spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F']);
    else server.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 1000));
  }
  await admin((c) => c.query(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`)).catch((e) =>
    console.error('Could not drop test database:', e.message)
  );
}
