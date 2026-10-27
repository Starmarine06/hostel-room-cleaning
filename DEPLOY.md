# Deploying (free tiers)

Three pieces: **Neon** (database) + **Render** (API) + **Netlify** (website).

## 1. Database (Neon)
1. Create a project at neon.tech, then copy the **direct** (non-pooled) connection string.
2. Keep it for step 2 as `DATABASE_URL`. It must end with `?sslmode=require`.

## 2. API (Render)
1. Push this repo to GitHub.
2. In Render: New > Blueprint, pick the repo. `render.yaml` sets everything up.
3. Fill in the prompted variables:
   - `DATABASE_URL`: from step 1
   - `CLIENT_URL`: your Netlify address (add it after step 3; several can be comma separated)
   - `ADMIN_EMAIL` / `ADMIN_PASSWORD`: the first admin account, created automatically on first start
4. After deploy, `https://<name>.onrender.com/api/health` should answer `{"status":"ok"}`.

Free tier note: the API sleeps after ~15 minutes idle, so the first visit afterwards takes 30-60 seconds.

## 3. Website (Netlify)
1. New site from the same GitHub repo. `netlify.toml` provides the build settings.
2. Add the environment variable `VITE_API_URL` = `https://<name>.onrender.com/api`
3. Deploy, then put the Netlify address into Render's `CLIENT_URL` and redeploy the API.

## 4. First use
Sign in with the admin account, add rooms (e.g. `T-230`), then upload the students' CSV (`email,room`).
Optional later: set `GOOGLE_CLIENT_ID` on Render to show a Google sign-in button.
