// Slows down password guessing. Counters live in Postgres so they are shared by every instance.
import type { Context, Next } from 'hono';
import { pool } from './db.js';

const WINDOW = '15 minutes';

function clientIp(c: Context) {
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || c.req.header('x-real-ip') || 'unknown';
}

// Counts failed attempts per address+email and per address; blocks once either passes its limit
export function loginRateLimit() {
  const perEmail = Number(process.env.LOGIN_RATE_LIMIT) || 10;
  const perIp = perEmail * 5;

  return async (c: Context, next: Next) => {
    let email = '';
    try {
      email = String((await c.req.json())?.email ?? '').toLowerCase().slice(0, 200);
    } catch {
      /* not JSON; the route will reject it */
    }
    const ip = clientIp(c);
    const keys = [
      { key: `login:ip:${ip}`, limit: perIp },
      { key: `login:ip-email:${ip}|${email}`, limit: perEmail },
    ];

    const { rows } = await pool.query(
      'select key, count from "RateLimit" where key = any($1) and "resetAt" > now()',
      [keys.map((k) => k.key)]
    );
    const blocked = keys.some((k) => (rows.find((r) => r.key === k.key)?.count ?? 0) >= k.limit);
    if (blocked) {
      return c.json({ message: 'Too many sign-in attempts. Please wait 15 minutes and try again.' }, 429);
    }

    await next();

    // Only failures count, so many students signing in from one network are not penalised
    if (c.res.status === 401 || c.res.status === 403) {
      for (const { key } of keys) {
        await pool.query(
          `insert into "RateLimit" (key, count, "resetAt") values ($1, 1, now() + interval '${WINDOW}')
           on conflict (key) do update set
             count = case when "RateLimit"."resetAt" < now() then 1 else "RateLimit".count + 1 end,
             "resetAt" = case when "RateLimit"."resetAt" < now() then now() + interval '${WINDOW}' else "RateLimit"."resetAt" end`,
          [key]
        );
      }
    }
  };
}
