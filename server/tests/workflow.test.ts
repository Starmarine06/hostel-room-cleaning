import pg from 'pg';
import fs from 'node:fs';
import jwt from 'jsonwebtoken';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const API = process.env.API_URL || 'http://localhost:4100/api';

type Json = Record<string, any>;

// Neon's gateway sometimes answers 502/503/504 with its own plain-text error before the request reaches
// the app. The website retries those once, so the tests do too, and count how often it was needed.
let platformRetries = 0;
afterAll(() => {
  if (platformRetries) console.log(`PLATFORM_RETRIES=${platformRetries}`);
});

async function call(method: string, path: string, body?: unknown, token?: string) {
  for (let attempt = 0; ; attempt++) {
    let res: Response | undefined;
    try {
      res = await fetch(`${API}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      if (attempt >= 2) throw error;
      platformRetries++;
      continue;
    }
    const text = await res.text();
    let json: Json = {};
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    const platformError = [502, 503, 504].includes(res.status) && !json.message;
    if (platformError && attempt < 2) {
      platformRetries++;
      await new Promise((r) => setTimeout(r, 800));
      continue;
    }
    return { status: res.status, json };
  }
}

let adminToken: string;
let counter = 0;
const uid = () => `${Date.now().toString(36)}${counter++}`;

// A block code unique to this run, so tests never collide with rooms left in a persistent database
const BLK = ('X' + Math.random().toString(36).slice(2, 5)).toUpperCase();
const room = (n: number) => `${BLK}-${n}`;
const lower = (n: number) => `${BLK.toLowerCase()}-${n}`;

async function makeRoom(number: string, capacity = 4) {
  const room = await call('POST', '/rooms', { number, capacity }, adminToken);
  expect(room.status).toBe(201);
  return room.json.id as string;
}

// Admin adds the person, who then signs in with the temporary password
async function addPerson(label: string, room?: string, role: 'RESIDENT' | 'CLEANER' = 'RESIDENT', keepTemp = false) {
  const email = `${label}.${uid()}@test.dev`;
  const added = await call('POST', '/users', { email, role, room }, adminToken);
  if (added.status !== 201) return { status: added.status, token: '', user: {} as Json, email, password: '' };
  const login = await call('POST', '/auth/login', { email, password: added.json.tempPassword });
  expect(login.status).toBe(200);
  let token = login.json.token as string;
  let password = added.json.tempPassword as string;
  if (!keepTemp) {
    // an issued password only lets the person choose their own, which every real user does first
    password = 'Chosen-pass-1234';
    const changed = await call('POST', '/auth/change-password', { currentPassword: added.json.tempPassword, newPassword: password }, token);
    expect(changed.status).toBe(200);
    token = changed.json.token as string;
  }
  return { status: added.status, token, user: login.json.user as Json, email, password };
}

describe('cleaning request workflow', () => {
  let cleanerToken: string;
  let cleaner2Token: string;
  let roomId: string;
  const residents: { token: string; user: Json }[] = [];

  beforeAll(async () => {
    const login = await call('POST', '/auth/login', {
      email: process.env.ADMIN_EMAIL || 'admin@hostel.com',
      password: process.env.SEED_PASSWORD || 'password123',
    });
    expect(login.status).toBe(200);
    adminToken = login.json.token;

    roomId = await makeRoom(room(230));
    for (let i = 0; i < 4; i++) {
      const r = await addPerson(`res${i}`, room(230));
      expect(r.status).toBe(201);
      residents.push(r);
    }
    cleanerToken = (await addPerson('cleanerone', undefined, 'CLEANER')).token;
    cleaner2Token = (await addPerson('cleanertwo', undefined, 'CLEANER')).token;
  });

  it('enforces 4 residents per room', async () => {
    expect((await addPerson('res5', room(230))).status).toBe(400);
  });

  it('blocks admin-only endpoints for non-admins', async () => {
    expect((await call('GET', '/users', undefined, residents[0].token)).status).toBe(403);
    expect((await call('POST', '/users/import', { csv: `a@b.co,${room(230)}` }, residents[0].token)).status).toBe(403);
    expect((await call('POST', '/rooms', { number: 'Z-1' }, residents[0].token)).status).toBe(403);
  });

  it('runs the full lifecycle with dual confirmation and no duplicates', async () => {
    const [a, b] = residents;

    const created = await call('POST', '/requests', { roomId }, a.token);
    expect(created.status).toBe(201);
    const id = created.json.id as string;

    // duplicate from the same resident and from a roommate
    expect((await call('POST', '/requests', { roomId }, a.token)).status).toBe(400);
    expect((await call('POST', '/requests', { roomId }, b.token)).status).toBe(400);

    // cleaning must be claimed before it can be marked cleaned
    expect((await call('POST', `/requests/${id}/cleaned`, undefined, cleanerToken)).status).toBeGreaterThanOrEqual(400);

    // only one cleaner wins a simultaneous claim
    const claims = await Promise.all([
      call('POST', `/requests/${id}/claim`, undefined, cleanerToken),
      call('POST', `/requests/${id}/claim`, undefined, cleaner2Token),
    ]);
    expect(claims.map((c) => c.status).sort()).toEqual([200, 400]);
    const winnerToken = claims[0].status === 200 ? cleanerToken : cleaner2Token;
    const loserToken = winnerToken === cleanerToken ? cleaner2Token : cleanerToken;

    // cannot confirm before it is cleaned
    expect((await call('POST', `/requests/${id}/confirm`, undefined, b.token)).status).toBe(400);

    // wrong cleaner cannot mark cleaned
    expect((await call('POST', `/requests/${id}/cleaned`, undefined, loserToken)).status).toBeGreaterThanOrEqual(400);

    const cleaned = await call('POST', `/requests/${id}/cleaned`, undefined, winnerToken);
    expect(cleaned.status).toBe(200);
    expect(cleaned.json.status).toBe('CLEANED');

    // cleaner cannot confirm own work
    expect((await call('POST', `/requests/${id}/confirm`, undefined, winnerToken)).status).toBe(403);

    // room stays locked while awaiting confirmation
    expect((await call('POST', '/requests', { roomId }, a.token)).status).toBe(400);

    // every party involved can open the request detail; outsiders cannot
    for (const token of [a.token, b.token, winnerToken, adminToken]) {
      const detail = await call('GET', `/requests/${id}`, undefined, token);
      expect(detail.status).toBe(200);
      expect(detail.json.room.residents).toHaveLength(4);
    }
    expect((await call('GET', `/requests/${id}`, undefined, loserToken)).status).toBe(403);

    const confirmed = await call('POST', `/requests/${id}/confirm`, undefined, b.token);
    expect(confirmed.status).toBe(200);
    expect(confirmed.json.status).toBe('CONFIRMED');
    expect(confirmed.json.confirmedBy).toBe(b.user.id);

    // room is free again
    expect((await call('POST', '/requests', { roomId }, a.token)).status).toBe(201);
  });

  it('lets exactly one of many simultaneous requests through', async () => {
    const raceRoom = await makeRoom(room(111));
    const people = [];
    for (let i = 0; i < 4; i++) people.push(await addPerson(`racer${i}`, room(111)));

    const results = await Promise.all(people.map((p) => call('POST', '/requests', { roomId: raceRoom }, p.token)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 400)).toHaveLength(3);
  });

  it('does not let a resident read another room through query filters', async () => {
    const otherId = await makeRoom(room(301));
    const outsider = await addPerson('outsider', room(301));
    await call('POST', '/requests', { roomId: otherId }, outsider.token);

    const peek = await call('GET', `/requests?roomId=${otherId}`, undefined, residents[0].token);
    expect(peek.status).toBe(200);
    expect(peek.json.data.every((r: Json) => r.roomId === roomId)).toBe(true);
  });

  it('stores the rejection reason and frees the room', async () => {
    const rid = await makeRoom(room(401));
    const res = await addPerson('rejecter', room(401));
    const created = await call('POST', '/requests', { roomId: rid }, res.token);
    const id = created.json.id as string;
    await call('POST', `/requests/${id}/claim`, undefined, cleanerToken);
    await call('POST', `/requests/${id}/cleaned`, undefined, cleanerToken);

    const rejected = await call('POST', `/requests/${id}/reject`, { reason: 'Floor still dirty' }, res.token);
    expect(rejected.status).toBe(200);
    expect(rejected.json.status).toBe('REJECTED');
    expect(rejected.json.rejectReason).toBe('Floor still dirty');

    expect((await call('POST', '/requests', { roomId: rid }, res.token)).status).toBe(201);
  });
});

describe('room numbers', () => {
  it('only accepts the Block-Number format and normalises case', async () => {
    for (const bad of ['230', 'T230', 'T-', '-230', 'TOOLONG-1', 'T-12345', 'T 230 B']) {
      expect((await call('POST', '/rooms', { number: bad }, adminToken)).status).toBe(400);
    }
    const ok = await call('POST', '/rooms', { number: `${lower(230)} ` }, adminToken);
    // Already created by the workflow suite, so this is a duplicate: rejected, but never stored as typed
    expect([201, 400]).toContain(ok.status);

    const created = await call('POST', '/rooms', { number: lower(512) }, adminToken);
    expect(created.status).toBe(201);
    expect(created.json.number).toBe(room(512));
    expect(created.json.building).toBe(BLK);
    expect(created.json.floor).toBe(5);
  });
});

describe('csv import', () => {
  it('bulk assigns by email and room, reports bad rows, and issues passwords', async () => {
    await makeRoom(room(102), 2);
    const tag = uid();
    const csv = [
      `${String.fromCharCode(0xfeff)}Email,Room Number`, // Excel's "CSV UTF-8" starts with a BOM
      `new1.${tag}@test.dev,${lower(102)}`, // normalised to upper case
      `new2.${tag}@test.dev,${room(102)}`,
      `new3.${tag}@test.dev,${room(102)}`, // room full (capacity 2)
      `bad-email,${room(102)}`,
      `new4.${tag}@test.dev,230`, // wrong format
      `new5.${tag}@test.dev,`, // room missing
      `new6.${tag}@test.dev,${room(999)}`, // room does not exist
      `new1.${tag}@test.dev,${room(102)}`, // duplicate in file
    ].join('\r\n');

    const res = await call('POST', '/users/import', { csv }, adminToken);
    expect(res.status).toBe(200);
    // the room that did not exist yet is created on the way
    expect(res.json.summary).toMatchObject({ created: 3, failed: 5 });
    const reasons = res.json.failures.map((f: Json) => f.message).join(' | ');
    expect(reasons).toMatch(/full/);
    expect(reasons).toMatch(/valid email/);
    expect(reasons).toMatch(/not a valid room/);
    expect(reasons).toMatch(/Room is missing/);
    expect(reasons).toMatch(/more than once/);

    // the new accounts can sign in with the issued passwords and land in the right room
    expect(res.json.newAccounts).toHaveLength(3);
    for (const acct of res.json.newAccounts) {
      const login = await call('POST', '/auth/login', acct);
      expect(login.status).toBe(200);
      expect([room(102), room(999)]).toContain(login.json.user.room.number);
      expect(login.json.user.password).toBeUndefined();
    }
  });

  it('moves existing residents, creates missing rooms, and is idempotent', async () => {
    const tag = uid();
    await makeRoom(room(201));
    const first = await call('POST', '/users/import', { csv: `m.${tag}@test.dev,${room(201)}` }, adminToken);
    expect(first.json.summary.created).toBe(1);

    const again = await call('POST', '/users/import', { csv: `m.${tag}@test.dev,${room(201)}` }, adminToken);
    expect(again.json.summary).toMatchObject({ unchanged: 1, created: 0 });
    expect(again.json.newAccounts).toHaveLength(0);

    const moved = await call('POST', '/users/import', { csv: `m.${tag}@test.dev,${room(202)}` }, adminToken);
    expect(moved.json.summary.moved).toBe(1);
    const rooms = await call('GET', '/rooms?limit=500', undefined, adminToken);
    expect(rooms.json.data.some((r: Json) => r.number === room(202))).toBe(true);
  });

  it('rejects a file whose header lacks the email or room column', async () => {
    const res = await call('POST', '/users/import', { csv: 'name,phone\nx,y' }, adminToken);
    expect(res.status).toBe(400);
  });
});

describe('login and passwords', () => {
  it('gives the same answer for unknown email and wrong password, and never returns the hash', async () => {
    const p = await addPerson('pw', undefined, 'RESIDENT');
    const wrong = await call('POST', '/auth/login', { email: p.email, password: 'definitely-wrong' });
    const unknown = await call('POST', '/auth/login', { email: 'nobody@test.dev', password: 'definitely-wrong' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.json.message).toBe(unknown.json.message);

    const me = await call('GET', '/auth/me', undefined, p.token);
    expect(me.json.password).toBeUndefined();
    const users = await call('GET', '/users?limit=500', undefined, adminToken);
    expect(users.json.data.every((u: Json) => u.password === undefined)).toBe(true);
  });

  it('lets people change their password, and lets admins reset a forgotten one', async () => {
    const p = await addPerson('chg');
    const bad = await call('POST', '/auth/change-password', { currentPassword: 'nope', newPassword: 'brandnew123' }, p.token);
    expect(bad.status).toBe(400);
    const short = await call('POST', '/auth/change-password', { currentPassword: p.password, newPassword: 'short' }, p.token);
    expect(short.status).toBe(400);

    const ok = await call('POST', '/auth/change-password', { currentPassword: p.password, newPassword: 'brandnew123' }, p.token);
    expect(ok.status).toBe(200);
    expect((await call('POST', '/auth/login', { email: p.email, password: p.password })).status).toBe(401);
    expect((await call('POST', '/auth/login', { email: p.email, password: 'brandnew123' })).status).toBe(200);

    const reset = await call('POST', `/users/${p.user.id}/reset-password`, undefined, adminToken);
    expect(reset.status).toBe(200);
    expect((await call('POST', '/auth/login', { email: p.email, password: 'brandnew123' })).status).toBe(401);
    expect((await call('POST', '/auth/login', { email: p.email, password: reset.json.tempPassword })).status).toBe(200);

    // an ordinary resident may not reset anyone's password
    const other = await addPerson('nosy', undefined, 'RESIDENT');
    expect((await call('POST', `/users/${p.user.id}/reset-password`, undefined, other.token)).status).toBe(403);
  });

  it('has no self-registration and no password-less backdoor', async () => {
    const reg = await call('POST', '/auth/register', { name: 'x', email: 'x@test.dev', password: 'password123' });
    expect(reg.status).toBe(404);
    const test = await call('POST', '/auth/test-login', { email: 'admin@hostel.com' });
    expect(test.status).toBe(404);
    const google = await call('POST', '/auth/google', { credential: 'fake' });
    expect([401, 503]).toContain(google.status);
  });
});

describe('live updates', () => {
  const WS = () => process.env.WS_URL || 'ws://localhost:4100/ws';

  // Connects, authenticates and resolves once the server says it is ready
  function listen(token: string) {
    return new Promise<{ ws: WebSocket; events: Json[]; closed: () => boolean }>((resolve, reject) => {
      const ws = new WebSocket(WS());
      const events: Json[] = [];
      let closed = false;
      ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token }));
      ws.onclose = () => (closed = true);
      ws.onerror = () => reject(new Error('websocket error'));
      ws.onmessage = (e) => {
        const msg = JSON.parse(String(e.data));
        if (msg.type === 'ready') resolve({ ws, events, closed: () => closed });
        else if (msg.type === 'event') events.push(msg);
        else if (msg.type === 'error') {
          resolve({ ws, events: [msg], closed: () => closed });
          ws.close(); // like the website, the client closes after an auth error
        }
      };
      setTimeout(() => reject(new Error('websocket timeout')), 15000);
    });
  }
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('pushes request events to the right people only', async () => {
    await makeRoom(room(501));
    await makeRoom(room(502));
    const mine = await addPerson('live-mine', room(501));
    const roommate = await addPerson('live-mate', room(501));
    const other = await addPerson('live-other', room(502));
    const cleaner = await addPerson('live-cleaner', undefined, 'CLEANER');

    const sockets = await Promise.all([mine, roommate, other, cleaner].map((p) => listen(p.token)));
    const [sMine, sMate, sOther, sCleaner] = sockets;

    const created = await call('POST', '/requests', { roomId: mine.user.roomId }, mine.token);
    expect(created.status).toBe(201);
    await wait(1500);

    expect(sMine.events.map((e) => e.event)).toContain('request:created');
    expect(sMate.events.map((e) => e.event)).toContain('request:created');
    expect(sCleaner.events.map((e) => e.event)).toContain('request:created');
    expect(sOther.events).toHaveLength(0); // a different room hears nothing

    await call('POST', `/requests/${created.json.id}/claim`, undefined, cleaner.token);
    await wait(1500);
    const update = sMine.events.find((e) => e.event === 'request:updated');
    expect(update?.data.status).toBe('IN_PROGRESS');

    sockets.forEach((s) => s.ws.close());
  });

  it('rejects a bad token and sends that socket nothing', async () => {
    const bad = await listen('not-a-real-token');
    expect(bad.events[0]?.type).toBe('error');

    // an unauthenticated socket must not receive anyone's events
    await makeRoom(room(503));
    const resident = await addPerson('live-bad', room(503));
    expect((await call('POST', '/requests', { roomId: resident.user.roomId }, resident.token)).status).toBe(201);
    await wait(1500);
    expect(bad.events).toHaveLength(1); // still just the error

    // Neon does not finish the close handshake promptly, so only check the full close locally
    if (!process.env.REMOTE_API) {
      for (let i = 0; i < 50 && !bad.closed(); i++) await wait(100);
      expect(bad.closed()).toBe(true);
    }
  });

  it('answers malformed JSON with a clear 400, not a crash', async () => {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    const text = await res.text();
    expect(res.status, `status ${res.status}, body: ${text.slice(0, 300)}`).toBe(400);
    expect(JSON.parse(text).message).toBeTruthy();
  });
});

describe('feedback and reports', () => {
  // Its own block, so the totals below only count this group's requests
  const FB = ('Y' + Math.random().toString(36).slice(2, 5)).toUpperCase();
  const fbRoom = (n: number) => `${FB}-${n}`;
  let cleanerToken: string;
  let cleanerName: string;

  beforeAll(async () => {
    const login = await call('POST', '/auth/login', {
      email: process.env.ADMIN_EMAIL || 'admin@hostel.com',
      password: process.env.SEED_PASSWORD || 'password123',
    });
    adminToken = login.json.token;
    const cleaner = await addPerson('rater', undefined, 'CLEANER');
    cleanerToken = cleaner.token;
    cleanerName = cleaner.user.name;
  });

  async function cleanedRoom(number: string) {
    const roomId = await makeRoom(number);
    const student = await addPerson('fb', number);
    const id = (await call('POST', '/requests', { roomId }, student.token)).json.id as string;
    await call('POST', `/requests/${id}/claim`, undefined, cleanerToken);
    await call('POST', `/requests/${id}/cleaned`, undefined, cleanerToken);
    return { id, student };
  }

  it('stores a rating with the confirmation and rejects a bad one', async () => {
    const { id, student } = await cleanedRoom(fbRoom(601));
    expect((await call('POST', `/requests/${id}/confirm`, { rating: 6 }, student.token)).status).toBe(400);
    const done = await call('POST', `/requests/${id}/confirm`, { rating: 4, feedback: 'Spotless floor' }, student.token);
    expect(done.status).toBe(200);
    expect(done.json.rating).toBe(4);
    expect(done.json.feedback).toBe('Spotless floor');
  });

  it('reports by block, room and cleaner rating, for admins only', async () => {
    const { id, student } = await cleanedRoom(fbRoom(602));
    await call('POST', `/requests/${id}/confirm`, { rating: 2 }, student.token);

    const range = '?from=2020-01-01&to=2099-12-31';
    const blocks = await call('GET', `/reports/blocks${range}`, undefined, adminToken);
    expect(blocks.status).toBe(200);
    const mine = blocks.json.data.find((b: Json) => b.block === FB);
    expect(mine.requests).toBe(2);
    expect(mine.confirmed).toBe(2);
    expect(mine.avgRating).toBe(3); // (4 + 2) / 2

    const rooms = await call('GET', `/reports/rooms${range}&block=${FB}`, undefined, adminToken);
    expect(rooms.json.data.map((r: Json) => r.room)).toEqual([fbRoom(601), fbRoom(602)]);

    // a window in the past has nothing in it
    const empty = await call('GET', '/reports/blocks?from=2020-01-01&to=2020-01-02', undefined, adminToken);
    expect(empty.json.data).toEqual([]);

    const ratings = await call('GET', `/reports/ratings${range}`, undefined, adminToken);
    const row = ratings.json.data.find((r: Json) => r.cleaner === cleanerName);
    expect(row.avgRating).toBe(3);
    expect(ratings.json.comments.some((c: Json) => c.feedback === 'Spotless floor')).toBe(true);

    expect((await call('GET', `/reports/blocks${range}`, undefined, cleanerToken)).status).toBe(403);
    expect((await call('GET', '/reports/blocks?from=nonsense', undefined, adminToken)).status).toBe(400);
  });

  it('flags a room not cleaned for 4 hours, once, and guards the sweep endpoint', async () => {
    const roomId = await makeRoom(fbRoom(603));
    const student = await addPerson('slow', fbRoom(603));
    const id = (await call('POST', '/requests', { roomId }, student.token)).json.id as string;

    const before = await call('GET', '/reports/overdue', undefined, adminToken);
    expect(before.json.data.some((r: Json) => r.id === id)).toBe(false);

    const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await db.connect();
    await db.query(`UPDATE "CleaningRequest" SET "requestedAt" = now() - interval '5 hours' WHERE id = $1`, [id]);

    const after = await call('GET', '/reports/overdue', undefined, adminToken);
    const hit = after.json.data.find((r: Json) => r.id === id);
    expect(hit.hoursWaiting).toBeGreaterThanOrEqual(5);

    expect((await call('POST', '/internal/sweep')).status).toBe(403);
    const cron = await fetch(`${API}/internal/sweep`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
    expect(cron.status).toBe(200);
    const alerted = await db.query(`SELECT "overdueAlertedAt" FROM "CleaningRequest" WHERE id = $1`, [id]);
    expect(alerted.rows[0].overdueAlertedAt).not.toBeNull();
    await db.end();
  });

  it('imports reg.no, name, room and email columns', async () => {
    const reg = `R${uid()}`;
    const email = `sheet.${uid()}@test.dev`;
    const csv = `reg.no,name,room,email\r\n${reg},Sheet Student,${fbRoom(604)},${email}\r\n`;
    const res = await call('POST', '/users/import', { csv, createMissingRooms: true }, adminToken);
    expect(res.status).toBe(200);
    expect(res.json.summary.created).toBe(1);

    const users = await call('GET', '/users?limit=500', undefined, adminToken);
    const made = users.json.data.find((u: Json) => u.email === email);
    expect(made.regNo).toBe(reg);
    expect(made.name).toBe('Sheet Student');

    // the same reg.no on another email is refused
    const dup = await call('POST', '/users/import', { csv: `reg.no,name,room,email\r\n${reg},Other,${fbRoom(604)},other.${uid()}@test.dev\r\n` }, adminToken);
    expect(dup.json.summary.failed).toBe(1);
  });
});

const REMOTE = Boolean(process.env.REMOTE_API);
const mailed = () =>
  fs
    .readFileSync(process.env.MAIL_OUT!, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { to: string; body: string });

describe('yearly sheet: room size, mail and block changes', () => {
  const MB = ('M' + Math.random().toString(36).slice(2, 5)).toUpperCase();
  const mr = (n: number) => `${MB}-${n}`;
  const HEAD = 'reg.no,name,room,room size,email';

  it.skipIf(REMOTE)('creates the room with its size, mails the password, and never mails an existing person again', async () => {
    const tag = uid();
    const email = `kid.${tag}@mail.test`;
    const csv = `${HEAD}\r\nREG${tag},Kid One,${mr(101)},6,${email}\r\n`;
    const first = await call('POST', '/users/import', { csv }, adminToken);
    expect(first.status).toBe(200);
    expect(first.json.summary.created).toBe(1);
    expect(first.json.emailed).toBe(1);
    expect(first.json.newAccounts).toEqual([]); // nothing for the admin to hand out

    const rooms = await call('GET', '/rooms?limit=500', undefined, adminToken);
    expect(rooms.json.data.find((r: Json) => r.number === mr(101)).capacity).toBe(6);

    const mail = mailed().filter((m) => m.to === email);
    expect(mail).toHaveLength(1);
    const password = /Temporary password: (\S+)/.exec(mail[0].body)![1];
    expect((await call('POST', '/auth/login', { email, password })).status).toBe(200);

    // next year: a different room, and a different name and reg.no in the sheet
    const next = await call('POST', '/users/import', { csv: `${HEAD}\r\nOTHER${tag},Someone Else,${mr(202)},4,${email}\r\n` }, adminToken);
    expect(next.json.summary).toMatchObject({ moved: 1, created: 0, failed: 0 });
    expect(next.json.emailed).toBe(0);
    expect(next.json.newAccounts).toEqual([]);
    expect(mailed().filter((m) => m.to === email)).toHaveLength(1); // no second mail

    // the old password still works and nothing but the room changed
    const login = await call('POST', '/auth/login', { email, password });
    expect(login.status).toBe(200);
    expect(login.json.user).toMatchObject({ name: 'Kid One', regNo: `REG${tag}` });
    expect(login.json.user.room.number).toBe(mr(202));
  });

  it.skipIf(REMOTE)('shows the admin the password when it cannot be emailed', async () => {
    const email = `nomail.${uid()}@test.dev`; // this address is refused by the test mail server
    const res = await call('POST', '/users/import', { csv: `${HEAD}\r\nR${uid()},No Mail,${mr(303)},4,${email}\r\n` }, adminToken);
    expect(res.json.summary.created).toBe(1);
    expect(res.json.emailed).toBe(0);
    expect(res.json.newAccounts.map((a: Json) => a.email)).toEqual([email]);
  });

  it('refills a whole block in one upload even though every room is full', async () => {
    const tag = uid();
    const names = ['a', 'b', 'c', 'd'].map((n) => `${n}.${tag}@test.dev`);
    const setup = names.map((e, i) => `R${tag}${i},S${i},${mr(i < 2 ? 401 : 402)},2,${e}`).join('\r\n');
    expect((await call('POST', '/users/import', { csv: `${HEAD}\r\n${setup}\r\n` }, adminToken)).json.summary.created).toBe(4);

    // everyone swaps rooms; both rooms are full (size 2) until the people leave
    const swap = names.map((e, i) => `R${tag}${i},S${i},${mr(i < 2 ? 402 : 401)},2,${e}`).join('\r\n');
    const res = await call('POST', '/users/import', { csv: `${HEAD}\r\n${swap}\r\n` }, adminToken);
    expect(res.json.summary).toMatchObject({ moved: 4, failed: 0 });
  });

  it('checks the room size', async () => {
    const tag = uid();
    const bad = await call('POST', '/users/import', { csv: `${HEAD}\r\nR${tag},Bad,${mr(501)},abc,bad.${tag}@test.dev\r\n` }, adminToken);
    expect(bad.json.failures[0].message).toMatch(/Room size/);

    await call('POST', '/users/import', { csv: `${HEAD}\r\nR${tag}a,P1,${mr(502)},3,p1.${tag}@test.dev\r\nR${tag}b,P2,${mr(502)},3,p2.${tag}@test.dev\r\n` }, adminToken);
    const shrink = await call('POST', '/users/import', { csv: `${HEAD}\r\nR${tag}c,P3,${mr(502)},1,p3.${tag}@test.dev\r\n` }, adminToken);
    expect(shrink.json.failures[0].message).toMatch(/cannot be 1/);
  });

  it('reports ratings by block and by room as well as by cleaner', async () => {
    const cleaner = await addPerson('rb', undefined, 'CLEANER');
    const roomId = await makeRoom(mr(601));
    const student = await addPerson('rbs', mr(601));
    const id = (await call('POST', '/requests', { roomId }, student.token)).json.id as string;
    await call('POST', `/requests/${id}/claim`, undefined, cleaner.token);
    await call('POST', `/requests/${id}/cleaned`, undefined, cleaner.token);
    await call('POST', `/requests/${id}/confirm`, { rating: 5 }, student.token);

    const ratings = await call('GET', '/reports/ratings?from=2020-01-01&to=2099-12-31', undefined, adminToken);
    expect(ratings.json.blocks.find((b: Json) => b.block === MB).avgRating).toBe(5);
    expect(ratings.json.rooms.find((r: Json) => r.room === mr(601))).toMatchObject({ block: MB, avgRating: 5 });
  });
});

describe('security', () => {
  it('lets an issued password do nothing except choose a new one', async () => {
    const p = await addPerson('fresh', undefined, 'RESIDENT', true);
    const blocked = await call('GET', '/requests', undefined, p.token);
    expect(blocked.status).toBe(403);
    expect(blocked.json.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await call('GET', '/auth/me', undefined, p.token)).status).toBe(200);

    expect((await call('POST', '/auth/change-password', { currentPassword: p.password, newPassword: p.password }, p.token)).status).toBe(400);
    expect((await call('POST', '/auth/change-password', { currentPassword: p.password, newPassword: 'too-short' }, p.token)).status).toBe(400);
    const changed = await call('POST', '/auth/change-password', { currentPassword: p.password, newPassword: 'My-own-password-9' }, p.token);
    expect(changed.status).toBe(200);
    expect((await call('GET', '/requests', undefined, changed.json.token)).status).toBe(200);

    // the session opened with the temporary password is closed by the change
    expect((await call('GET', '/auth/me', undefined, p.token)).status).toBe(401);
  });

  it('signs a person out everywhere when an admin resets their password', async () => {
    const p = await addPerson('reset', undefined, 'RESIDENT');
    expect((await call('GET', '/requests', undefined, p.token)).status).toBe(200);
    expect((await call('POST', `/users/${p.user.id}/reset-password`, undefined, adminToken)).status).toBe(200);
    expect((await call('GET', '/requests', undefined, p.token)).status).toBe(401);
  });

  it('rejects forged tokens', async () => {
    const admin = await call('GET', '/auth/me', undefined, adminToken);
    const id = admin.json.id as string;
    const wrongKey = jwt.sign({ id }, 'not-the-secret');
    const noSignature = jwt.sign({ id }, '', { algorithm: 'none' });
    expect((await call('GET', '/users', undefined, wrongKey)).status).toBe(401);
    expect((await call('GET', '/users', undefined, noSignature)).status).toBe(401);
  });

  it('sends hardening headers and stops caching of answers', async () => {
    const res = await fetch(`${API}/health`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  // Runs last: it deletes every student that is not in its file
  it.skipIf(REMOTE)('removes students missing from the file entirely, but only when the whole sheet is clean', async () => {
    const tag = uid();
    const HEAD = 'reg.no,name,room,room size,email';
    const stay = `stay.${tag}@test.dev`;
    const leave = `leave.${tag}@test.dev`;
    const roomNo = `${BLK}-${700 + (counter % 90)}`;
    const first = await call('POST', '/users/import', { csv: `${HEAD}\r\nR1${tag},Stay,${roomNo},4,${stay}\r\nR2${tag},Leave,${roomNo},4,${leave}\r\n` }, adminToken);
    expect(first.json.summary.created).toBe(2);

    // the leaver has a cleaning on record
    const leaver = first.json.newAccounts.find((a: Json) => a.email === leave);
    const login = await call('POST', '/auth/login', leaver);
    const changed = await call('POST', '/auth/change-password', { currentPassword: leaver.password, newPassword: 'Leaver-pass-123' }, login.json.token);
    const roomId = login.json.user.roomId as string;
    const requestId = (await call('POST', '/requests', { roomId }, changed.json.token)).json.id as string;

    // a sheet with a bad row removes nobody
    const blocked = await call('POST', '/users/import', { csv: `${HEAD}\r\nR1${tag},Stay,${roomNo},4,${stay}\r\nX,Bad,not-a-room,4,bad.${tag}@test.dev\r\n`, removeMissing: true }, adminToken);
    expect(blocked.json.removed).toBe(0);
    expect(blocked.json.removalSkipped).toMatch(/need fixing/);
    expect((await call('POST', '/auth/login', { email: leave, password: 'Leaver-pass-123' })).status).toBe(200);

    // a clean sheet removes the leaver, and only students
    const clean = await call('POST', '/users/import', { csv: `${HEAD}\r\nR1${tag},Stay,${roomNo},4,${stay}\r\n`, removeMissing: true }, adminToken);
    expect(clean.json.removed).toBeGreaterThanOrEqual(1);
    expect((await call('POST', '/auth/login', { email: leave, password: 'Leaver-pass-123' })).status).toBe(401);
    expect((await call('GET', '/auth/me', undefined, changed.json.token)).status).toBe(401);
    expect((await call('GET', '/auth/me', undefined, adminToken)).status).toBe(200);

    // the cleaning stays on record for the reports, without the person
    const record = await call('GET', `/requests/${requestId}`, undefined, adminToken);
    expect(record.status).toBe(200);
    expect(record.json.requester).toBeNull();
  });
});
