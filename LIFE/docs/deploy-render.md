# Deploying L.I.F.E. to Render

L.I.F.E. is designed to run offline on one laptop. A Render deployment is an optional online
copy, for example for demonstrations. Camera video is still processed only in the visitor's
browser; trainee records are stored on Render's server.

The repository contains a Blueprint (`render.yaml` at the repository root) that tells Render how
to build and run the app in the `LIFE` folder.

## Free plan vs. keeping data

| | Free (default in `render.yaml`) | Paid (Starter + disk) |
|---|---|---|
| Cost | US$0 | about US$7/month + about US$0.25/GB/month |
| Data (trainees, accounts, sessions) | **Erased** on every restart, redeploy or sleep | Kept on a persistent disk |
| Sleeps when idle | After ~15 minutes; the next visit takes about a minute to wake | No |
| Good for | Demonstrations | Real trainees |

To keep data: in `render.yaml` change `plan: free` to `plan: starter`, uncomment the `disk:`
block and the `LIFE_DB_PATH` variable, commit and push.

## Admin sign-in

| | Username | Password |
|---|---|---|
| Online (built in) | `admin` | `LifeCPR@2026` |
| Your own (optional) | `admin` | the value of the `LIFE_ADMIN_PASSWORD` environment variable (12+ characters) |

On the free plan (no disk) the admin password is restored at every start, so the built-in
password always works and no password change is forced. With a paid plan and a disk, the admin
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
