import { spawn, spawnSync, ChildProcess } from 'node:child_process';

const PORT = '4100';
const TEST_DB = 'hostel_cleaning_test';
const BASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/hostel_cleaning?schema=public';
const TEST_URL = BASE_URL.replace(/\/[^/?]+(\?|$)/, `/${TEST_DB}$1`);
const shell = process.platform === 'win32';

let server: ChildProcess | undefined;

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell, env: { ...process.env, ...env, DATABASE_URL: TEST_URL } });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed`);
}

export async function setup() {
  // Fresh database for every run; reset recreates it and applies all migrations
  run('npx', ['prisma', 'migrate', 'reset', '--force', '--skip-seed']);
  run('npx', ['tsx', 'prisma/seed.ts']);

  server = spawn('npx', ['tsx', 'src/index.ts'], {
    stdio: 'inherit',
    shell,
    env: { ...process.env, DATABASE_URL: TEST_URL, PORT, JWT_SECRET: process.env.JWT_SECRET || 'test-secret', LOGIN_RATE_LIMIT: '100000' },
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
}

export async function teardown() {
  if (!server?.pid) return;
  if (shell) spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F']);
  else server.kill('SIGTERM');
}
