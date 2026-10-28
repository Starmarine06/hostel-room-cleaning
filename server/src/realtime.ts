// Live updates. Events are published through Postgres NOTIFY so that every running instance
// (Neon may run several in parallel) can deliver them to the browsers connected to it.
import pg from 'pg';
import jwt from 'jsonwebtoken';
import { pool, prisma, secureUrl } from './db.js';

// The part of a WebSocket we rely on; both `ws` and the standard WebSocket fit
export interface LiveSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: (event: any) => void): void; // eslint-disable-line @typescript-eslint/no-explicit-any
}

interface Client {
  socket: LiveSocket;
  rooms: Set<string>;
}

const CHANNEL = 'live_events';
const NOTIFY_LIMIT = 7500; // Postgres caps a NOTIFY payload at about 8000 bytes
const clients = new Set<Client>();

function deliver(payload: { rooms: string[]; event: string; data: unknown }) {
  const message = JSON.stringify({ type: 'event', event: payload.event, data: payload.data });
  for (const client of clients) {
    if (payload.rooms.some((room) => client.rooms.has(room))) {
      try {
        client.socket.send(message);
      } catch {
        /* the socket closed; its close handler removes it */
      }
    }
  }
}

let listener: Promise<void> | undefined;

function ensureListening() {
  if (listener) return listener;
  const attempt = (async () => {
    const client = new pg.Client({ connectionString: secureUrl(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL) });
    const reset = () => {
      listener = undefined;
      // Reconnect shortly if anyone is still connected
      if (clients.size > 0) setTimeout(() => ensureListening().catch(() => undefined), 2000);
    };
    client.on('error', reset);
    client.on('end', reset);
    client.on('notification', (n) => {
      try {
        deliver(JSON.parse(n.payload ?? '{}'));
      } catch (error) {
        console.error('Bad live event payload:', error);
      }
    });
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
  })();
  listener = attempt;
  attempt.catch(() => {
    if (listener === attempt) listener = undefined;
  });
  return attempt;
}

// Send an event to everyone in the given rooms, on any instance. Never fails the request that caused it.
export async function publish(rooms: string[], event: string, data: unknown) {
  try {
    let payload = JSON.stringify({ rooms, event, data });
    if (Buffer.byteLength(payload) > NOTIFY_LIMIT) {
      payload = JSON.stringify({ rooms, event, data: { id: (data as { id?: string })?.id, truncated: true } });
    }
    await pool.query('select pg_notify($1, $2)', [CHANNEL, payload]);
  } catch (error) {
    console.error('Could not publish live event:', error);
  }
}

// A browser connects, then must send {type:'auth', token} within 10 seconds
export async function attachClient(socket: LiveSocket) {
  const client: Client = { socket, rooms: new Set() };

  // NOTE: the server never calls socket.close(). On Neon Functions that ended the whole instance, so the
  // next requests failed while it restarted. A client that does not authenticate is simply ignored (it
  // receives nothing and costs nothing), and well-behaved browsers close the connection themselves.
  let pinger: ReturnType<typeof setInterval> | undefined;
  const dropClient = () => {
    clearTimeout(authTimer);
    if (pinger) clearInterval(pinger);
    clients.delete(client);
  };
  const authTimer = setTimeout(dropClient, 10_000); // unauthenticated clients are not kept in the list

  socket.addEventListener('close', dropClient);

  socket.addEventListener('message', async (event) => {
    let message: { type?: string; token?: string };
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (message.type !== 'auth' || !message.token) return;

    try {
      const decoded = jwt.verify(message.token, process.env.JWT_SECRET!) as { id: string };
      const user = await prisma.user.findUnique({
        where: { id: decoded.id },
        select: { id: true, role: true, roomId: true },
      });
      if (!user) throw new Error('unknown user');

      await ensureListening();
      client.rooms.clear();
      if (user.roomId) client.rooms.add(`room:${user.roomId}`);
      if (user.role === 'CLEANER' || user.role === 'ADMIN') client.rooms.add('cleaners');
      if (user.role === 'ADMIN') client.rooms.add('admins');
      clearTimeout(authTimer);
      clients.add(client);
      // Keeps the connection alive through idle periods
      pinger ??= setInterval(() => {
        try {
          socket.send(JSON.stringify({ type: 'ping' }));
        } catch {
          /* closed */
        }
      }, 25_000);
      socket.send(JSON.stringify({ type: 'ready' }));
    } catch {
      dropClient();
      socket.send(JSON.stringify({ type: 'error', message: 'Authentication failed' }));
    }
  });
}
