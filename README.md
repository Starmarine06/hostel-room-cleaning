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

## Feedback and reports
- When a student confirms a cleaning they give 1-5 stars and an optional comment.
- Import sheet columns: `reg.no, name, room, email` (`.xlsx` or `.csv`).
- Admins get a Reports tab: by block, by room and cleaner ratings for a from/to date range, each downloadable as CSV.
- A room not cleaned for 4 hours shows as an alert on the admin dashboard. The API only runs when called, so `.github/workflows/overdue.yml` calls `/api/internal/sweep` every 15 minutes. It needs the repository secret `CRON_SECRET` (the same value as in the API's env file) and the repository variable `API_URL` (the API address ending in `/api`).

## Security
- Database: PostgreSQL (Neon in production, a Docker `postgres:16` locally) through Prisma. Every query is parameterised. The connection to Neon is encrypted and its certificate is verified.
- Passwords are stored only as bcrypt hashes. Issued and reset passwords are temporary: the person must choose their own (10+ characters) before using anything else.
- A password change or reset closes every older session. Sign-in tokens are signed with one fixed algorithm and expire after a day (`JWT_EXPIRES_IN`).
- Sign-in is rate limited (shared across all instances), and a wrong email takes as long to answer as a wrong password.
- Every route checks the role. Students see only their own room, cleaners only open jobs and their own, and users, reports and imports are admin only.
- Requests are size limited and validated. Only the website's address may call the API (`CLIENT_URL`). Answers carry hardening headers and are never cached.
- Downloaded CSV files neutralise spreadsheet formulas.
- Removing a student deletes their account and details. Their past cleanings stay, without the person, so reports remain correct.

## Checks
- `npm run typecheck`, `npm run lint`, `npm run build`
- `npm test` starts its own API and a separate test database (needs the Postgres container running)
