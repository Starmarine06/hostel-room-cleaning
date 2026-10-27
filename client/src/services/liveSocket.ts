// Live updates over a plain WebSocket. Reconnects by itself, and tells listeners to refresh
// ('resync') after a reconnect, because events sent while it was down are not replayed.
type Handler = (data: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any

export function liveSocketUrl(): string {
  const explicit = import.meta.env.VITE_SOCKET_URL as string | undefined;
  const api = import.meta.env.VITE_API_URL as string | undefined;
  const base = explicit || (api ? new URL(api).origin : 'http://localhost:4000');
  return `${base.replace(/^http/, 'ws').replace(/\/$/, '')}/ws`;
}

export class LiveSocket {
  private ws?: WebSocket;
  private handlers = new Map<string, Set<Handler>>();
  private stopped = false;
  private attempt = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private hasConnected = false;

  constructor(
    private url: string,
    private getToken: () => string | null,
    private onStatus: (connected: boolean) => void
  ) {
    this.connect();
  }

  on(event: string, handler: Handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
  }

  off(event: string, handler: Handler) {
    this.handlers.get(event)?.delete(handler);
  }

  close() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.ws?.close();
  }

  private emit(event: string, data?: unknown) {
    this.handlers.get(event)?.forEach((handler) => handler(data));
  }

  private connect() {
    if (this.stopped) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    let authFailed = false;

    ws.onopen = () => {
      const token = this.getToken();
      if (!token) return ws.close();
      ws.send(JSON.stringify({ type: 'auth', token }));
    };

    ws.onmessage = (e) => {
      let message: { type?: string; event?: string; data?: unknown };
      try {
        message = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (message.type === 'ready') {
        this.attempt = 0;
        this.onStatus(true);
        if (this.hasConnected) this.emit('resync');
        this.hasConnected = true;
      } else if (message.type === 'event' && message.event) {
        this.emit(message.event, message.data);
      } else if (message.type === 'error') {
        authFailed = true;
        ws.close(); // the server leaves closing to the browser
      }
    };

    ws.onclose = () => {
      this.onStatus(false);
      if (this.stopped || authFailed) return;
      // 1s, 2s, 4s ... up to 30s, with a little randomness so clients do not all return at once
      const delay = Math.min(30_000, 1000 * 2 ** this.attempt++) * (0.75 + Math.random() * 0.5);
      this.timer = setTimeout(() => this.connect(), delay);
    };
  }
}
