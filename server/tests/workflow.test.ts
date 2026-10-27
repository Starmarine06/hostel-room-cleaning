import { describe, it, expect, beforeAll } from 'vitest';

const API = process.env.API_URL || 'http://localhost:4100/api';

type Json = Record<string, any>;

async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json: Json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

let adminToken: string;
let counter = 0;
const uid = () => `${Date.now().toString(36)}${counter++}`;

async function makeRoom(number: string, capacity = 4) {
  const room = await call('POST', '/rooms', { number, capacity }, adminToken);
  expect(room.status).toBe(201);
  return room.json.id as string;
}

// Admin adds the person, who then signs in with the temporary password
async function addPerson(label: string, room?: string, role: 'RESIDENT' | 'CLEANER' = 'RESIDENT') {
  const email = `${label}.${uid()}@test.dev`;
  const added = await call('POST', '/users', { email, role, room }, adminToken);
  if (added.status !== 201) return { status: added.status, token: '', user: {} as Json, email, password: '' };
  const login = await call('POST', '/auth/login', { email, password: added.json.tempPassword });
  expect(login.status).toBe(200);
  return {
    status: added.status,
    token: login.json.token as string,
    user: login.json.user as Json,
    email,
    password: added.json.tempPassword as string,
  };
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

    roomId = await makeRoom('T-230');
    for (let i = 0; i < 4; i++) {
      const r = await addPerson(`res${i}`, 'T-230');
      expect(r.status).toBe(201);
      residents.push(r);
    }
    cleanerToken = (await addPerson('cleanerone', undefined, 'CLEANER')).token;
    cleaner2Token = (await addPerson('cleanertwo', undefined, 'CLEANER')).token;
  });

  it('enforces 4 residents per room', async () => {
    expect((await addPerson('res5', 'T-230')).status).toBe(400);
  });

  it('blocks admin-only endpoints for non-admins', async () => {
    expect((await call('GET', '/users', undefined, residents[0].token)).status).toBe(403);
    expect((await call('POST', '/users/import', { csv: 'a@b.co,T-230' }, residents[0].token)).status).toBe(403);
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
    const raceRoom = await makeRoom('R-101');
    const people = [];
    for (let i = 0; i < 4; i++) people.push(await addPerson(`racer${i}`, 'R-101'));

    const results = await Promise.all(people.map((p) => call('POST', '/requests', { roomId: raceRoom }, p.token)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 400)).toHaveLength(3);
  });

  it('does not let a resident read another room through query filters', async () => {
    const otherId = await makeRoom('O-301');
    const outsider = await addPerson('outsider', 'O-301');
    await call('POST', '/requests', { roomId: otherId }, outsider.token);

    const peek = await call('GET', `/requests?roomId=${otherId}`, undefined, residents[0].token);
    expect(peek.status).toBe(200);
    expect(peek.json.data.every((r: Json) => r.roomId === roomId)).toBe(true);
  });

  it('stores the rejection reason and frees the room', async () => {
    const rid = await makeRoom('J-401');
    const res = await addPerson('rejecter', 'J-401');
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
    const ok = await call('POST', '/rooms', { number: 't-230 ' }, adminToken);
    // T-230 already exists from the workflow suite or is created here: both are fine, but never stored as typed
    expect([201, 400]).toContain(ok.status);

    const created = await call('POST', '/rooms', { number: 'n-512' }, adminToken);
    expect(created.status).toBe(201);
    expect(created.json.number).toBe('N-512');
    expect(created.json.building).toBe('N');
    expect(created.json.floor).toBe(5);
  });
});

describe('csv import', () => {
  it('bulk assigns by email and room, reports bad rows, and issues passwords', async () => {
    await makeRoom('C-101', 2);
    const tag = uid();
    const csv = [
      `${String.fromCharCode(0xfeff)}Email,Room Number`, // Excel's "CSV UTF-8" starts with a BOM
      `new1.${tag}@test.dev,c-101`, // normalised to C-101
      `new2.${tag}@test.dev,C-101`,
      `new3.${tag}@test.dev,C-101`, // room full (capacity 2)
      `bad-email,C-101`,
      `new4.${tag}@test.dev,230`, // wrong format
      `new5.${tag}@test.dev,`, // room missing
      `new6.${tag}@test.dev,C-999`, // room does not exist
      `new1.${tag}@test.dev,C-101`, // duplicate in file
    ].join('\r\n');

    const res = await call('POST', '/users/import', { csv }, adminToken);
    expect(res.status).toBe(200);
    expect(res.json.summary).toMatchObject({ created: 2, failed: 6 });
    const reasons = res.json.failures.map((f: Json) => f.message).join(' | ');
    expect(reasons).toMatch(/full/);
    expect(reasons).toMatch(/valid email/);
    expect(reasons).toMatch(/not a valid room/);
    expect(reasons).toMatch(/Room is missing/);
    expect(reasons).toMatch(/does not exist/);
    expect(reasons).toMatch(/more than once/);

    // the new accounts can sign in with the issued passwords and land in the right room
    expect(res.json.newAccounts).toHaveLength(2);
    for (const acct of res.json.newAccounts) {
      const login = await call('POST', '/auth/login', acct);
      expect(login.status).toBe(200);
      expect(login.json.user.room.number).toBe('C-101');
      expect(login.json.user.password).toBeUndefined();
    }
  });

  it('moves existing residents, creates missing rooms on request, and is idempotent', async () => {
    const tag = uid();
    await makeRoom('M-101');
    const first = await call('POST', '/users/import', { csv: `m.${tag}@test.dev,M-101` }, adminToken);
    expect(first.json.summary.created).toBe(1);

    const again = await call('POST', '/users/import', { csv: `m.${tag}@test.dev,M-101` }, adminToken);
    expect(again.json.summary).toMatchObject({ unchanged: 1, created: 0 });
    expect(again.json.newAccounts).toHaveLength(0);

    const blocked = await call('POST', '/users/import', { csv: `m.${tag}@test.dev,M-202` }, adminToken);
    expect(blocked.json.summary.failed).toBe(1);

    const moved = await call('POST', '/users/import', { csv: `m.${tag}@test.dev,M-202`, createMissingRooms: true }, adminToken);
    expect(moved.json.summary.moved).toBe(1);
    const rooms = await call('GET', '/rooms?limit=500', undefined, adminToken);
    expect(rooms.json.data.some((r: Json) => r.number === 'M-202')).toBe(true);
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

    expect((await call('POST', `/users/${p.user.id}/reset-password`, undefined, p.token)).status).toBe(403);
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
