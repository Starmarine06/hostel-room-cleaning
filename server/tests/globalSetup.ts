import { spawn, spawnSync, ChildProcess } from 'node:child_process';
import pg from 'pg';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = '4100';
const BASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/hostel_cleaning?schema=public';
// A brand-new database for every run, dropped afterwards, so tests never touch real data
const TEST_DB = `hostel_test_${Date.now().toString(36)}`;
const withDb = (name: string) => BASE_URL.replace(/\/[^/?]+(\?|$)/, `/${name}$1`);
const TEST_URL = withDb(TEST_DB);
const shell = process.platform === 'win32';

let server: ChildProcess | undefined;
let smtp: net.Server | undefined;

// A tiny mail server: keeps every message in a file, and only accepts addresses ending in @mail.test,
// so the tests can see both a mail that arrives and one that cannot be delivered
function startFakeSmtp(port: number, outFile: string) {
  return new Promise<net.Server>((resolve) => {
    const srv = net.createServer((sock) => {
      let buf = '';
      let inData = false;
      let to = '';
      sock.on('error', () => undefined);
      sock.write('220 fake ESMTP\r\n');
      sock.on('data', (chunk) => {
        buf += chunk.toString();
        for (;;) {
          if (inData) {
            const end = buf.indexOf('\r\n.\r\n');
            if (end < 0) return;
            fs.appendFileSync(outFile, JSON.stringify({ to, body: buf.slice(0, end) }) + '\n');
            buf = buf.slice(end + 5);
            inData = false;
            sock.write('250 OK\r\n');
            continue;
          }
          const eol = buf.indexOf('\r\n');
          if (eol < 0) return;
          const line = buf.slice(0, eol);
          buf = buf.slice(eol + 2);
          const cmd = line.toUpperCase();
          if (cmd.startsWith('RCPT TO')) {
            to = line.slice(line.indexOf('<') + 1, line.indexOf('>'));
            sock.write(to.endsWith('@mail.test') ? '250 OK\r\n' : '550 no such mailbox\r\n');
          } else if (cmd === 'DATA') {
            inData = true;
            sock.write('354 go ahead\r\n');
          } else if (cmd === 'QUIT') {
            sock.write('221 bye\r\n');
            sock.end();
          } else if (cmd.startsWith('EHLO') || cmd.startsWith('HELO')) {
            sock.write('250 fake\r\n');
          } else {
            sock.write('250 OK\r\n');
          }
        }
      });
    });
    srv.listen(port, '127.0.0.1', () => resolve(srv));
  });
}

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
  process.env.TEST_DATABASE_URL = TEST_URL;
  process.env.CRON_SECRET = 'test-cron';
  process.env.MAIL_OUT = path.join(os.tmpdir(), `hostel-mail-${TEST_DB}.jsonl`);
  fs.writeFileSync(process.env.MAIL_OUT, '');
  smtp = await startFakeSmtp(2525, process.env.MAIL_OUT);
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
      CRON_SECRET: 'test-cron',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: '2525',
      MAIL_FROM: 'hostel@test.dev',
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
  smtp?.close();
  if (server?.pid) {
    if (shell) spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F']);
    else server.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 1000));
  }
  await admin((c) => c.query(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`)).catch((e) =>
    console.error('Could not drop test database:', e.message)
  );
}
