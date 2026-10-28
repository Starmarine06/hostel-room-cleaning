// Local development and tests: a normal Node server. Production runs src/function.ts on Neon.
import 'dotenv/config';
import { serve } from '@hono/node-server';
import { WebSocketServer } from 'ws';
import { createApp } from './app.js';
import { attachClient, type LiveSocket } from './realtime.js';
import { pool } from './db.js';
import { sweepOverdueThrottled } from './overdue.js';

const app = createApp();
const port = Number(process.env.PORT) || 4000;

const server = serve({ fetch: app.fetch, port }, () => {
  console.log(`Server running on http://localhost:${port}`);
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (request, socket, head) => {
  if (new URL(request.url ?? '/', 'http://localhost').pathname !== '/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    void attachClient(ws as unknown as LiveSocket);
  });
});

// Alerts go out even when nobody is calling the API
setInterval(() => void sweepOverdueThrottled(), 5 * 60_000).unref();

const shutdown = async () => {
  server.close();
  await pool.end().catch(() => undefined);
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
