# Hostel Room Cleaning

Students request room cleaning, cleaners claim and complete it, and a student from the room (or an admin) confirms. Up to 4 residents per room, one open request per room. Rooms are written as `T-230` (block, dash, number).

## Setup
1. `npm install`
2. `docker compose up -d db`
3. Copy `server/.env.example` to `server/.env`, set `JWT_SECRET` and `SEED_PASSWORD`
4. `npx prisma migrate deploy` inside `server/`
5. `npm run db:seed --workspace=server` creates the admin plus demo cleaner, student and rooms
6. `npm run dev` (client on :3000, API on :4000)

## Adding people
Admins use the Users tab: upload a CSV with `email,room` columns (or add one person). New accounts get a temporary password, shown once and downloadable. Sign-in is email and password; set `GOOGLE_CLIENT_ID` to also show a Google button.

## Checks
- `npm run typecheck`, `npm run lint`, `npm run build`
- `npm test` starts its own API and a separate test database (needs the Postgres container running)
