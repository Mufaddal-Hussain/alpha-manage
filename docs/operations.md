# alpha-Manage: operations guide

For the owner and whoever looks after the system. It covers the daily runbook, backups and restore, the Vercel deployment (what has to be set and how to check it) and how the same app runs later on an Ubuntu server. Nothing in this file contains a secret: variables are listed by name only.

Contents: [1. What runs where](#1-what-runs-where) · [2. Owner runbook](#2-owner-runbook) · [3. Backup and restore](#3-backup-and-restore) · [4. Deploying to Vercel](#4-deploying-to-vercel-t083) · [5. Running on Ubuntu later](#5-running-on-ubuntu-node-postgres-nginx) · [6. If something goes wrong](#6-if-something-goes-wrong)

## 1. What runs where

| Part | Today (Vercel) | Later (Ubuntu server) |
|---|---|---|
| The app (Next.js 16, one project, no separate backend) | Vercel, one deployment per push | `npm run build` + `npm run start` under systemd, nginx in front |
| Database (all customers, quotations, POs, challans, users, audit log) | Neon Postgres (Vercel Marketplace) | PostgreSQL 16 on the server |
| Files (PO attachments, price-list source files, logo and brand strip) | Vercel Blob, private (`STORAGE_DRIVER=vercel-blob`) | A folder on disk (`STORAGE_DRIVER=local`, `STORAGE_LOCAL_DIR`) |
| PDFs (quotation, estimate, challan) | Generated on request; a quotation PDF is cached as a file and regenerated if the file is missing | Same |

Everything the business owns is therefore in **two places: the database and the file store**. Both must be backed up (section 3). The code is in git and can always be rebuilt.

No feature depends on Vercel: the only Vercel-specific code is the Blob adapter (`src/lib/storage/vercel-blob.ts`), selected by `STORAGE_DRIVER`. File keys look like `uploads/<id>/<name>` (and `documents/...` for cached PDFs) in both drivers, which is what makes moving files between them a plain copy.

## 2. Owner runbook

### First sign-in on a new system

1. `npm run db:migrate`, then `npm run db:seed`. The seed prints the owner's one-time password once, on the first run only. Copy it somewhere safe, sign in, and change it from **Settings → Users → Reset password**.
2. **Settings → Business profile**: legal name, address, GSTIN, bank details, logo and brand strip, default HSN code and GST rate for imported products. Imports refuse to start until the default HSN and GST rate are set.
3. **Settings → Numbering**: check the quotation and challan formats and starting numbers (`QT/{FY}/{N:4}`, `CH/{FY}/{N:4}`). Do this *before* the first real document: a format cannot repeat a number, but starting numbers are easiest to set while nothing is issued.
4. **Settings → Terms**: the standard terms printed on documents.
5. **Settings → Users**: add the sales staff.
6. The business has to **verify the GST rates and HSN/SAC codes** held on products and charge types (`Transport Charges`, `Loading` are seeded with placeholder values from a sample delivery note). They are editable data, never fixed in code.

### Everyday

| Task | Where |
|---|---|
| Add or deactivate a staff member, change a role, reset a password | Settings → Users (owner only). A deactivated person is locked out immediately, even with a live session. |
| See who did what | Settings → Audit log (owner only): creates, status changes, overrides, settings changes, newest first; filter by record type, action and date. Entries are never edited or deleted. |
| Deliver more than a PO's pending quantity | Only the owner can, with a reason; it is recorded as an `override` in the audit log. |
| Cancel an issued challan | The owner (any), or sales for their own challan on the day it was issued. A cancelled challan keeps its number and its quantities return to pending. |
| Fix a wrong quotation | Revise it (a new revision, same number) before it is approved. An approved quotation is locked. |
| New price list from a distributor | Catalog → Import price list → review → approve. Selling prices never change automatically; changed costs are flagged for review. |
| Start of a financial year (1 April) | Nothing to do: numbers restart by themselves with the first document of the new year, and the year is part of every number (`QT/2027-28/0001`). |

### Weekly and monthly

- **Weekly**: glance at the dashboard (open quotations, expiring soon, POs with pending deliveries) and at the audit log for overrides and cancellations.
- **Monthly**: check that the latest backup file exists and is not empty; once a quarter, do a **test restore** (section 3.4). A backup that has never been restored is a hope, not a backup.
- **Whenever staff leave**: deactivate them the same day.

## 3. Backup and restore

### 3.1 What to back up

1. **The database**: everything except the uploaded files.
2. **The file store**: PO attachments, price-list source files, logo, brand strip. Quotation PDFs are regenerated on demand, so losing those is harmless; the others cannot be recreated.

A database restored without its files still works: the records are intact and downloading a missing attachment answers "not found".

### 3.2 Database

**Layer 1: the provider's history (Neon).** Neon keeps a rolling history of the database and can restore to a past moment or branch from one. The length of that window depends on the Neon plan: check it in the Neon console (project → Settings → restore window) and make sure it covers what you are comfortable losing. To go back in time, use the Neon console's restore or branch-from-timestamp feature, then point `DATABASE_URL` at the restored branch (or restore in place) and redeploy. Treat this as the quick "undo" for mistakes in the last days, not as your only backup.

**Layer 2: your own dump (works the same on Neon and on Ubuntu).** A nightly `pg_dump` kept somewhere that is *not* the same account as the database.

```bash
# Use the UNPOOLED connection string (Neon: the "direct" host without -pooler); pg_dump needs a session connection.
# The client's major version must be at least the server's (check: psql --version, and the Postgres version in the Neon console).
pg_dump --format=custom --no-owner --no-privileges \
  --file "alpha-manage-$(date +%F).dump" "$DATABASE_URL_UNPOOLED"
```

Keep, for example, the last 14 daily dumps and 12 monthly ones, in an encrypted off-site location (a second cloud account, an external disk that is not left plugged in). The dump contains customer data and password hashes: store it as carefully as the database itself.

**Before any risky change** (a migration, a bulk edit) take a dump or create a Neon branch first; migrations only go forward (`npm run db:migrate`), and the way back is a restore.

### 3.3 Files

- **Vercel Blob**: there is no built-in versioned backup. Copy the store periodically: list every blob (`list()` from `@vercel/blob`, with the same `BLOB_READ_WRITE_TOKEN` the app uses) and download each pathname to a folder, keeping the pathname as the file path (`uploads/<id>/<name>`). *No ready-made script exists yet; it is recorded as a follow-up (see `specs/001-quotation-delivery-challan/tasks.md`, Phase 10).*
- **Local disk (Ubuntu)**: the folder `STORAGE_LOCAL_DIR`. Back it up with `rsync -a --delete-after /var/lib/alpha-manage/uploads/ backup-host:/backups/alpha-manage/uploads/` (or any backup tool) on the same schedule as the database dump.

### 3.4 Restore

Restore into an **empty scratch database first**, check it, then switch over. Never restore over production without a fresh dump of production taken just before.

```bash
# 1. An empty database (Neon: create a new branch or database; Ubuntu: createdb alpha_manage_restore)
# 2. Load the dump (unpooled connection string of the EMPTY database)
pg_restore --no-owner --no-privileges --exit-on-error \
  --dbname "$RESTORE_DATABASE_URL_UNPOOLED" alpha-manage-2026-11-21.dump

# 3. Check the data: counts should match what you expect
psql "$RESTORE_DATABASE_URL_UNPOOLED" -c \
  "select (select count(*) from customer) customers, (select count(*) from quotation) quotations,
          (select count(*) from purchase_order) pos, (select count(*) from delivery_challan) challans,
          (select count(*) from \"user\") users;"

# 4. Point the app at it: set DATABASE_URL (and DATABASE_URL_UNPOOLED) to the restored database, redeploy / restart,
#    then run `npm run db:migrate` if the dump is older than the code (it applies only what is missing).
```

Then restore the files into the file store (Blob: upload each file back under its original pathname; local: copy the folder back) and run the smoke test (section 4.4). The test restore each quarter is exactly this, ending with signing in to the scratch copy and opening an old quotation PDF and PO attachment.

### 3.5 If someone deletes or changes something by mistake

Issued documents are never deleted by the app: they are cancelled or revised, not removed (only an unnumbered draft can be deleted). So the usual fix is inside the app (revise, cancel, reinstate; see the audit log for what happened). A database restore is only for real data loss.

## 4. Deploying to Vercel (T083)

> **Status.** The project is linked to Vercel and GitHub. **The deployment has not been configured or run**: the owner is deciding the production storage setup first and has to approve the deploy. This section is the preparation: what the app needs and how to check it afterwards. Task T083 stays open until the owner has done the steps in 4.5.

### 4.1 Environment variables

Names only. Set them in Vercel → Project → Settings → Environment Variables. All of them are read on the server; none is exposed to the browser (there are no `NEXT_PUBLIC_*` variables). They are validated by `src/lib/env.ts` the first time the app needs them, so a missing one shows as an "Invalid environment variables" error on the first request, not at build time.

**Production**

| Variable | Required | What it is |
|---|---|---|
| `DATABASE_URL` | yes | Pooled Postgres connection string of the **production** Neon database. |
| `AUTH_SECRET` | yes | Session signing secret, 32+ characters (`openssl rand -base64 32`). Production gets its own value. Changing it signs everybody out. |
| `STORAGE_DRIVER` | yes | `vercel-blob`. (`local` writes to the function's disk, which is temporary on Vercel: uploads would vanish.) |
| `BLOB_READ_WRITE_TOKEN` | yes, with `vercel-blob` | Token of the Blob store connected to the project; Vercel adds it when the store is connected. The store should be **private**. |
| `BETTER_AUTH_URL` | recommended | The public origin, e.g. `https://<your-domain>`. Without it the auth library derives the origin from each request (it logs a warning) and sign-in callbacks and redirects can use the wrong host. |
| `DATABASE_URL_UNPOOLED` | only where migrations run | Direct (non-pooled) connection string used by `npm run db:migrate`. The Neon integration sets it. The running app does not need it. |

**Preview** (every branch and pull-request deployment)

| Variable | Required | What it is |
|---|---|---|
| `DATABASE_URL` | yes | A **separate Neon branch** (never the production database), so previews cannot touch real data. The Neon–Vercel integration can create one branch per preview. |
| `AUTH_SECRET` | yes | A different value from Production. |
| `STORAGE_DRIVER` | yes | `vercel-blob`, with its own Blob store, or Preview has no uploads. |
| `BLOB_READ_WRITE_TOKEN` | yes, with `vercel-blob` | Token of the **Preview** Blob store (not the production one). |
| `BETTER_AUTH_URL` | optional | Leave unset on previews: their addresses change with every deployment and the origin is then derived from the request. |

**Not set on Vercel**: `TEST_DATABASE_URL` (tests only), `STORAGE_LOCAL_DIR` (Ubuntu only), `SEED_OWNER_EMAIL` (used once, when running the seed), `CI`, `PLAYWRIGHT_BASE_URL`, `PHONE_BROWSER`.

### 4.2 Before the first deploy

1. Production database: a Neon database connected through the Vercel Marketplace; run `npm run db:migrate` and `npm run db:seed` against it **once**, from a machine that has the production `DATABASE_URL_UNPOOLED` in its environment (the seed prints the owner password once; see section 2).
2. A Blob store connected to the project (private) so `BLOB_READ_WRITE_TOKEN` exists.
3. `npm run build`, `npm run lint`, `npm test` and `npm run test:e2e` pass on the commit being deployed.
4. **Know the upload limit.** Vercel limits the size of a request to a function (documented as 4.5 MB at the time of writing; check the current Vercel docs). The app accepts PO files up to 10 MB each (18 MB together) and price-list files up to 5 MB + 15 MB, so on Vercel a larger upload is refused by the platform before the app sees it. Normal PO PDFs and phone photos are usually below it; very large scans are not. If that bites, the fix is to upload straight to Blob from the browser (recorded as a follow-up).

### 4.3 Deploy

Pushing to the connected GitHub branch deploys: a push to the production branch makes a Production deployment, any other branch a Preview. **Do not push until the owner has approved.** Migrations are not run by the deployment: apply them (`npm run db:migrate` against production) *before* the code that needs them goes live; they are additive and forward-only.

Rolling back code: Vercel → Deployments → promote a previous deployment. Rolling back data is a restore (section 3.4).

### 4.4 Deploy smoke test (about 10 minutes)

On the deployed URL, in a private window:

1. Open `/` signed out: you land on the sign-in page. Open `/api/files/00000000-0000-4000-8000-000000000000` and `/api/documents/quotation/00000000-0000-4000-8000-000000000000/pdf`: both answer `401`.
2. Sign in as the owner. The dashboard loads with no error.
3. **Settings → Business profile** shows the business details. Upload the logo (tests Blob writes) and reload: the logo shows.
4. Create a customer, then a quotation for that customer with two lines and a transport charge, and **Issue** it. The number looks like `QT/2026-27/0001`.
5. **View PDF** and **Download PDF**: both give a PDF with the logo, the tax split and the total in words.
6. **Approve** the quotation, **Record PO** with a small PDF attached (under 4 MB), then open the attachment from the PO page: it downloads.
7. Create a challan for part of the PO; open the PO: delivered and pending quantities are right; open the challan PDF.
8. As the owner, **Settings → Audit log** lists the steps above.
9. Sign in as a sales user (create one in Settings → Users): owner-only screens (`/settings/users`, `/settings/business`, `/settings/numbering`, `/settings/audit`) show "no access".
10. Clean up: cancel the test challan; leave the test quotation and PO as history (nothing in the app deletes issued documents), or deactivate the test customer. Do the smoke test on a Preview deployment first so the production books stay clean.

### 4.5 What the owner still has to do for T083

1. Decide the production storage: Vercel Blob (private store) as planned, or another option. Do not change `STORAGE_DRIVER` before deciding.
2. Create or connect the production Neon database, and a Neon branch for Previews.
3. Connect a private Blob store (Production) and one for Preview.
4. Set the variables in 4.1 for Production and Preview (generate two different `AUTH_SECRET` values).
5. Run migrations and the seed against production, and save the owner password the seed prints.
6. Approve the push; run the smoke test (4.4) on a Preview first, then on Production.
7. Set up the nightly dump and the file copy (section 3) before real data goes in.

## 5. Running on Ubuntu (Node, Postgres, nginx)

The same code runs unchanged; only the environment differs. These steps are written for Ubuntu 24.04 LTS with a plain VPS; adapt package versions as needed.

### 5.1 Install

```bash
# Node.js 22 LTS (NodeSource) and build tools
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git nginx postgresql postgresql-contrib certbot python3-certbot-nginx

# A service user that owns the app and its files
sudo adduser --system --group --home /srv/alpha-manage alpha
sudo mkdir -p /var/lib/alpha-manage/uploads && sudo chown -R alpha:alpha /var/lib/alpha-manage
```

### 5.2 Database

```bash
sudo -u postgres psql <<'SQL'
create user alpha with password 'CHOOSE-A-LONG-PASSWORD';
create database alpha_manage owner alpha;
SQL
```

Postgres listens on localhost only by default: keep it that way (no public port). The connection string is `postgres://alpha:<password>@localhost:5432/alpha_manage`.

### 5.3 App

```bash
sudo -u alpha git clone <repository-url> /srv/alpha-manage/app && cd /srv/alpha-manage/app
sudo -u alpha npm ci
```

Environment file, readable only by the service user (`sudo install -m 600 -o alpha -g alpha /dev/null /etc/alpha-manage.env`, then edit it):

```ini
DATABASE_URL=postgres://alpha:<password>@localhost:5432/alpha_manage
AUTH_SECRET=<32+ random characters>
STORAGE_DRIVER=local
STORAGE_LOCAL_DIR=/var/lib/alpha-manage/uploads
BETTER_AUTH_URL=https://app.example.com
NODE_ENV=production
PORT=3000
```

```bash
set -a; . /etc/alpha-manage.env; set +a
sudo -E -u alpha npm run build
sudo -E -u alpha npm run db:migrate
sudo -E -u alpha npm run db:seed      # first install only; prints the owner password once
```

systemd unit `/etc/systemd/system/alpha-manage.service`:

```ini
[Unit]
Description=alpha-Manage
After=network.target postgresql.service

[Service]
User=alpha
WorkingDirectory=/srv/alpha-manage/app
EnvironmentFile=/etc/alpha-manage.env
ExecStart=/usr/bin/npm run start -- --hostname 127.0.0.1 --port 3000
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now alpha-manage
journalctl -u alpha-manage -f        # logs
```

### 5.4 nginx and HTTPS

`/etc/nginx/sites-available/alpha-manage`:

```nginx
server {
    server_name app.example.com;
    listen 80;

    # Server Actions accept uploads up to 20 MB (next.config.ts); nginx must allow at least that.
    client_max_body_size 25m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
```

Sign-in is rate limited by the app (about 3 attempts per 10 seconds per client address), so nginx must pass the real address (`X-Forwarded-For`, set above); otherwise everybody behind the proxy shares one limit.

```bash
sudo ln -s /etc/nginx/sites-available/alpha-manage /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d app.example.com     # HTTPS and automatic renewal
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable
```

### 5.5 Updating

```bash
cd /srv/alpha-manage/app && sudo -u alpha git pull
sudo -u alpha npm ci
set -a; . /etc/alpha-manage.env; set +a
sudo -E -u alpha npm run build
sudo -E -u alpha npm run db:migrate     # take a dump first (section 3)
sudo systemctl restart alpha-manage
```

Check afterwards: `curl -I https://app.example.com/sign-in` answers `200`, then run the smoke test in 4.4.

### 5.6 Backups on the server

A nightly cron job (as the `alpha` user, `crontab -e`) for the database and files, copied off the machine:

```cron
15 2 * * *  . /etc/alpha-manage.env && pg_dump --format=custom --no-owner --no-privileges --file /var/backups/alpha-manage/db-$(date +\%F).dump "$DATABASE_URL" && find /var/backups/alpha-manage -name 'db-*.dump' -mtime +14 -delete
30 2 * * *  rsync -a /var/lib/alpha-manage/uploads/ /var/backups/alpha-manage/uploads/
45 2 * * *  rsync -a /var/backups/alpha-manage/ backup-host:/backups/alpha-manage/
```

(`/var/backups/alpha-manage` must exist and belong to `alpha`; the last line is the off-machine copy and needs an SSH key to the backup host.) Restore as in section 3.4.

### 5.7 Moving from Vercel + Neon to this server

1. Dump production on the old side (section 3.2) and restore it into the new database (section 3.4).
2. Copy the files: download every blob from Vercel Blob keeping its pathname, and place it under `STORAGE_LOCAL_DIR` at the same relative path (`uploads/<id>/<name>`; cached PDFs under `documents/` can be skipped, they are rebuilt). The `file` table stores exactly those keys, so nothing in the database changes.
3. Start the app with `STORAGE_DRIVER=local`, run the smoke test (4.4), then switch the DNS name. Keep the old deployment untouched until the new one has run for a few days.
4. Users keep their passwords (the hashes are in the database); everybody has to sign in again because `AUTH_SECRET` and the domain differ.

## 6. If something goes wrong

| Symptom | Likely cause and fix |
|---|---|
| Every page shows "Invalid environment variables" | A required variable is missing or too short: `DATABASE_URL`, `AUTH_SECRET` (32+), and `BLOB_READ_WRITE_TOKEN` when `STORAGE_DRIVER=vercel-blob`. The message names which. |
| Cannot sign in, correct password | The user may be deactivated (Settings → Users), or `AUTH_SECRET` was changed (clears all sessions; sign in again). |
| A quotation or challan PDF fails | Look at the server log. PDFs read the bundled font from `src/lib/pdf/fonts` (traced into the Vercel build by `next.config.ts`); a custom build step that strips that folder breaks them. |
| An upload fails on Vercel with a size error before the app responds | The platform's request-size limit (see 4.2, point 4): use a smaller file. |
| Uploads disappear after a while on Vercel | `STORAGE_DRIVER` is `local` on Vercel. Set it to `vercel-blob`. |
| Two people report the same document number | Should be impossible (numbers are assigned inside the creating transaction, tested with concurrent use). Check the audit log and the `number_series` table, and keep the database state: do not edit it by hand. |
| The app was restored from an older dump and is missing recent documents | Expected: only what existed at the time of the dump is back. Re-enter the missing ones; numbers continue from the restored series. Check **Settings → Numbering** before issuing anything new. |
