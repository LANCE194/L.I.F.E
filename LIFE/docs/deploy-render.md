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

## Steps

1. Push the latest code to GitHub (`git push`).
2. Sign in at https://dashboard.render.com (you can sign in with GitHub).
3. Click **New +** → **Blueprint**.
4. Connect your GitHub account if asked, then choose the **L.I.F.E** repository.
5. Render reads `render.yaml` and shows one web service, **life-cpr**. When asked for
   **LIFE_ADMIN_PASSWORD**, enter a strong password (at least 12 characters). This is the
   first admin's password; keep it private.
6. Click **Apply**. The first build takes a few minutes (installing packages and building the
   dashboard). Follow it under **Logs**; it is finished when the log shows `Listening on 0.0.0.0`.
7. Open the address Render shows (for example `https://life-cpr.onrender.com`).
8. Sign in as **admin** with the password from step 5. You will be asked to choose a new one.
9. Add trainees, trainers and sign-in accounts as on the local version.

Every later `git push` to `main` redeploys automatically (on the free plan, that also erases
the data).

## Notes

- The site uses HTTPS, which browsers require for camera access.
- If you forget the admin password on the free plan, use **Manual Deploy → Restart service**:
  the database is recreated with the password from `LIFE_ADMIN_PASSWORD`. On the paid plan, changing
  `LIFE_ADMIN_PASSWORD` does not affect an existing account; another admin can reset it under
  Settings → User accounts.
- If no `LIFE_ADMIN_PASSWORD` is set, a random first-admin password is printed once in **Logs**.
- Sign-in tokens use `JWT_SECRET`, which Render generates once; changing it signs everyone out.
- Online, trainee data is subject to the Data Privacy Act of 2012 (RA 10173). Use the free plan
  only with test data, and obtain consent before storing real trainee records online.

## Can't sign in as admin?

Open the service's **Logs** on Render and look at the lines printed when the server started.

1. **"NOTE: a new, empty database was created"**: on the free plan the database is erased after
   every sleep (about 15 minutes without visitors), restart or redeploy. Any password you chose
   after signing in is gone; sign in again with your `LIFE_ADMIN_PASSWORD` value and choose a new
   one. To keep data, use a paid instance with a disk.
2. **"One-time password: ..."**: `LIFE_ADMIN_PASSWORD` was missing or shorter than 12 characters
   when the server started; sign in with the printed password.
3. **"Too many failed attempts"** on the sign-in page: wait 5 minutes (or restart the service).
4. **Still stuck**: under **Environment**, set `LIFE_ADMIN_PASSWORD` (12+ characters) and add
   `LIFE_RESET_ADMIN` = `1`, save, and redeploy. The admin password is reset to that value at
   startup. After signing in, delete `LIFE_RESET_ADMIN` again.

The username is `admin` (capitals don't matter). Spaces around the `LIFE_ADMIN_PASSWORD` value
are ignored.

Services created from a **Public Git Repository** URL do not redeploy automatically when you
push; use **Manual Deploy → Deploy latest commit** to get new versions.
