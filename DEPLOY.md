# Deploying (free tiers, no card)

Three pieces: **Neon** (database and API) + **Netlify** (website).

## How it fits together
- The API runs as a **Neon Function** (`server/src/function.ts`) on the same Neon project as the database.
- Live updates travel over a WebSocket (`/ws`) and are fanned out through Postgres `NOTIFY`, so every function instance delivers them to its own browsers.
- The website is static files on Netlify. It talks to the API using `VITE_API_URL`.
- Everything Neon-related lives in `neon/` (`neon.ts`, env files, `.neon`) so the Neon CLI never touches `server/.env`.

## One-time setup
1. `neon login` (browser sign-in), then in `neon/`:
   `neon checkout <branch> --project-id <id> --env .env.production`
   - `.env.production` holds `JWT_SECRET`, `CLIENT_URL` (the Netlify address), `ADMIN_EMAIL`, `ADMIN_PASSWORD`. It is gitignored.
   - Load it into the shell first (`set -a; . ./.env.production; set +a`) because `neon.ts` reads it.
2. Apply the database migrations to that branch (from `server/`, with the branch's `DATABASE_URL_UNPOOLED` in the environment):
   `npx prisma migrate deploy`
3. Build and publish the website:
   `VITE_API_URL=https://<function-url>/api npm run build --workspace=client`
   `netlify deploy --prod --dir client/dist`
4. Put the Netlify address into `CLIENT_URL` and redeploy the function: `neon deploy --env .env.production`.

## Day to day
- Update the API: `neon deploy --env .env.production` (from `neon/`, env loaded).
- Update the website: rebuild and `netlify deploy --prod --dir client/dist`.
- Logs: `neon logs query --source function --since 1h`.
- The first admin is created automatically from `ADMIN_EMAIL` / `ADMIN_PASSWORD` on first start. Change the password in Profile after signing in.

## Things worth knowing
- Neon Functions are in beta. Free usage limits were not published in the docs when this was set up.
- The server must never call `socket.close()` on a WebSocket: on Neon that took the whole instance down. Browsers close their own connections.
- Optional: set `GOOGLE_CLIENT_ID` in `.env.production` to show a Google sign-in button.
