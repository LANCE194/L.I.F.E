# Deploying L.I.F.E. to Render

L.I.F.E. is designed to run offline on one laptop. A Render deployment is an optional online
copy, for example for demonstrations. Camera video is still processed only in the visitor's
browser; trainee records are stored on Render's server.

The repository contains a Blueprint (`render.yaml` at the repository root) that tells Render how
to build and run the app in the `LIFE` folder.

## Free plan vs. keeping data

| | Free, no Turso | Free + Turso (recommended) | Paid (Starter + disk) |
|---|---|---|---|
| Cost | US$0 | US$0 (Turso free plan) | about US$7/month + about US$0.25/GB/month |
| Data (trainees, accounts, sessions, passwords) | **Erased** on every restart, redeploy or sleep | **Kept** until deleted in the app | Kept on a persistent disk |
| Sleeps when idle | After ~15 minutes; the next visit takes about a minute to wake | Same | No |
| Good for | Quick demonstrations | Real use at no cost | Real use |

To keep data for free: follow **Keeping data for free with Turso** below.
To keep data on a paid plan instead: in `render.yaml` change `plan: free` to `plan: starter`,
uncomment the `disk:` block and the `LIFE_DB_PATH` variable, commit and push.

## Keeping data for free with Turso

[Turso](https://turso.tech) is a free cloud database that works like SQLite. With it, L.I.F.E.
keeps a copy of its database in Turso: within about 2 seconds of every change (new trainee,
session, password, setting, deletion) and once more when Render stops or puts the service to
sleep. When the service starts again on an empty disk, the copy is restored before anyone can
sign in. Logging out, refreshing the page, a restart, a redeploy or sleep no longer remove
anything; data goes away only when someone deletes it in the app.

1. Sign up at https://turso.tech (free; a GitHub or Google account works).
2. Create a database (**Databases → Create Database**). Name it e.g. `life`, and pick the
   location closest to Singapore that is offered.
3. Open the database and copy its **URL**. It looks like `libsql://life-yourname.turso.io`.
4. Click **Create Token** (read and write access, no expiry) and copy the token.
5. In Render open the service → **Environment** and add:
   - `TURSO_DATABASE_URL` = the URL from step 3
   - `TURSO_AUTH_TOKEN` = the token from step 4
6. **Save, rebuild and deploy**. In **Logs** you should see
   `Cloud storage: Turso has no saved data yet; starting a new database.` on the first start,
   then `Cloud storage: data saved to Turso`. After later restarts the log says
   `Cloud storage: saved data restored from Turso`.
7. Sign in with **admin** / **LifeCPR@2026** (or your `LIFE_ADMIN_PASSWORD`). Because data is
   now kept, you are asked to choose a new admin password, and it stays.

Check it at any time: open `https://<your-site>/api/health`. `"storage": {"mode": "turso", ...}`
shows when the data was last saved and whether any change is still waiting to be uploaded.

Notes:

- Data that existed before Turso was added is not copied (on the free plan it was already lost
  at the last restart); start entering data after step 6.
- Use one Turso database for one running server only. Do not put the same values on the
  laptop copy; the laptop keeps its data in `database/life.db` anyway.
- If Turso cannot be reached when the service starts, the service stops with
  `Could not read the saved data from cloud storage` instead of starting empty, so the saved
  data is never overwritten. Render retries automatically; check the URL and token if it keeps
  failing.
- Turso holds trainee records and password hashes: keep the token secret (only in Render's
  Environment, never in the repository).

## Admin sign-in

| | Username | Password |
|---|---|---|
| Online (built in) | `admin` | `LifeCPR@2026` |
| Your own (optional) | `admin` | the value of the `LIFE_ADMIN_PASSWORD` environment variable (12+ characters) |

On the free plan without Turso (no disk) the admin password is restored at every start, so the built-in
password always works and no password change is forced. With Turso, or a paid plan and a disk, the admin
must choose a new password at first sign-in, and it is kept.

Because this repository is public, anyone who reads it can see the built-in password. Use the
free plan only with test data, or set your own `LIFE_ADMIN_PASSWORD`.

## Steps

1. Push the latest code to GitHub (`git push`).
2. Sign in at https://dashboard.render.com.
3. Click **+ New** → **Web Service** → **Public Git Repository**, paste
   `https://github.com/LANCE194/L.I.F.E` and click **Connect**. (Or **+ New** → **Blueprint** if
   your GitHub account is connected; it reads `render.yaml`.)
4. Settings: Language **Node**, Branch `main`, Region **Singapore**, Root Directory `LIFE`,
   Build Command `npm ci --prefix server && npm ci --include=dev --prefix dashboard && npm run build --prefix dashboard`,
   Start Command `node server/index.js`, Instance Type **Free**, Health Check Path `/api/health`.
5. Environment variables: `NODE_VERSION` = `22`, and `JWT_SECRET` = any random 40+ characters
   (or **Generate**).
6. Click **Deploy Web Service** and wait for `Listening on 0.0.0.0` in **Logs**.
7. Open the address Render shows and sign in with **admin** / **LifeCPR@2026**.

To get a newer version later: **Manual Deploy → Deploy latest commit** (services created from a
public repository URL do not redeploy automatically).

## Notes

- The site uses HTTPS, which browsers require for camera access.
- The admin password in use is printed in **Logs** at every start (the built-in one, or a note
  that `LIFE_ADMIN_PASSWORD` is used).
- Sign-in tokens use `JWT_SECRET`, which Render generates once; changing it signs everyone out.
- Online, trainee data is subject to the Data Privacy Act of 2012 (RA 10173). Use the free plan
  only with test data, and obtain consent before storing real trainee records online.

## Can't sign in as admin?

1. Use username `admin` and password `LifeCPR@2026` (or your `LIFE_ADMIN_PASSWORD` if you set
   one; it replaces the built-in password). Check **Logs** for the line starting `Username: admin`.
2. If you set `LIFE_ADMIN_PASSWORD` earlier and don't remember it, delete it under
   **Environment** and redeploy; the built-in password then applies.
3. **"Too many failed attempts"**: wait 5 minutes, or restart the service.
4. Make sure you are on the latest version: **Manual Deploy → Deploy latest commit**.
5. With a paid plan and a disk, if the admin password is lost: set `LIFE_ADMIN_PASSWORD` and
   `LIFE_RESET_ADMIN` = `1`, redeploy, sign in, then delete `LIFE_RESET_ADMIN`.

Opening addresses that start with `/api` in the browser shows short technical messages; use the
site address without `/api`.
