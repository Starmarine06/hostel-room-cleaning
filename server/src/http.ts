// A thin layer that lets the route files keep their Express-style handlers
// (`req.body`, `res.status(400).json(...)`, `next()`) while running on Hono.
// Only the small part of Express that the routes actually use is implemented.
import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  roomId: string | null;
}

export interface Request {
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  params: Record<string, string>;
  query: Record<string, string>;
  headers: Record<string, string | undefined>;
  user?: AuthUser;
}
export type AuthRequest = Request;

export class Response {
  statusCode = 200;
  payload: unknown = undefined;
  sent = false;

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  json(data: unknown) {
    this.payload = data;
    this.sent = true;
    return this;
  }
}

export type NextFunction = () => void;
type Handler = (req: Request, res: Response, next: NextFunction) => unknown;

class BadJson extends Error {}

async function readBody(c: Context): Promise<unknown> {
  if (c.req.method === 'GET' || c.req.method === 'DELETE') return {};
  if (!(c.req.header('content-type') ?? '').includes('application/json')) return {};
  // An empty body is fine (e.g. "claim" has none); only a malformed one is an error
  const text = await c.req.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new BadJson();
  }
}

// Runs a chain of Express-style handlers. `next()` may be called without awaiting, so every
// handler's promise is tracked and the chain is only finished when all of them have settled.
async function runChain(handlers: Handler[], req: Request, res: Response) {
  const pending: Promise<unknown>[] = [];
  const dispatch = (i: number) => {
    const handler = handlers[i];
    if (!handler) return;
    pending.push(Promise.resolve(handler(req, res, () => dispatch(i + 1))));
  };
  dispatch(0);
  for (let n = 0; n < pending.length; n++) await pending[n];
}

export class Router {
  readonly app = new Hono();
  private shared: Handler[] = [];

  // Like Express: applies to routes registered after this call
  use(...handlers: Handler[]) {
    this.shared.push(...handlers);
    return this;
  }

  private register(method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string, handlers: Handler[]) {
    const chain = [...this.shared, ...handlers];
    this.app.on(method.toUpperCase(), path, async (c) => {
      let body: unknown;
      try {
        body = await readBody(c);
      } catch (e) {
        if (e instanceof BadJson) return c.json({ message: 'Invalid JSON' }, 400);
        throw e;
      }
      const req: Request = {
        body,
        params: c.req.param() as Record<string, string>,
        query: c.req.query(),
        headers: c.req.header() as Record<string, string | undefined>,
      };
      const res = new Response();
      await runChain(chain, req, res);
      if (!res.sent) {
        console.error(`No response sent for ${method.toUpperCase()} ${path}`);
        return c.json({ message: 'Internal server error' }, 500);
      }
      return c.json(res.payload as object, res.statusCode as ContentfulStatusCode);
    });
    return this;
  }

  get(path: string, ...handlers: Handler[]) {
    return this.register('get', path, handlers);
  }
  post(path: string, ...handlers: Handler[]) {
    return this.register('post', path, handlers);
  }
  patch(path: string, ...handlers: Handler[]) {
    return this.register('patch', path, handlers);
  }
  put(path: string, ...handlers: Handler[]) {
    return this.register('put', path, handlers);
  }
  delete(path: string, ...handlers: Handler[]) {
    return this.register('delete', path, handlers);
  }
}
