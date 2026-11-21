# alpha-Manage

Staff-only web app for a tile business: customers, product catalog and price lists, GST quotations (PDF), customer purchase orders and partial-delivery challans.

Built with Next.js 16 (App Router, React 19), TypeScript, Tailwind 4, PostgreSQL with Drizzle, Better Auth, `@react-pdf/renderer` and exceljs. The design lives in [`specs/001-quotation-delivery-challan/`](specs/001-quotation-delivery-challan/) (spec, plan, data model, contracts and task list).

> This Next.js version has breaking changes from older releases. Before touching routing, config or caching, read the matching guide under `node_modules/next/dist/docs/` (see `AGENTS.md`).

## Prerequisites

- Node.js 22 LTS and npm
- A PostgreSQL database: a local Postgres, or a Neon database created through the Vercel Marketplace
- Playwright browsers for end-to-end tests: `npx playwright install chromium`

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in the values below
npm run db:migrate
npm run db:seed
npm run dev
```

Open <http://localhost:3000>. Sign in with the owner account printed by the seed script (credentials are never stored in the repository).

> The schema lives in `src/db/schema/` and migrations in `src/db/migrations/`. `npm run db:seed` is additive and safe to re-run; it prints the owner's generated password once, on the first run only. `npm run build`, `npm run lint` and the unit tests work without a database.

### Environment variables

Set these in `.env.local` locally and in the Vercel project (Production and Preview). Real values are never committed (`.env*` is gitignored, except `.env.example`). They are validated by `src/lib/env.ts`.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (`postgres://user:password@host:5432/db`). With Neon, use the pooled connection string. |
| `AUTH_SECRET` | Session signing secret, at least 32 characters (`openssl rand -base64 32`). |
| `STORAGE_DRIVER` | `vercel-blob` on Vercel, `local` for local disk (development / self-hosting). |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob token. Required only when `STORAGE_DRIVER=vercel-blob`. |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js development server, production build, production server |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit and integration tests (`tests/unit`, `tests/integration`) |
| `npm run test:e2e` | Playwright end-to-end tests (`tests/e2e`); starts `npm run dev` unless `PLAYWRIGHT_BASE_URL` points at a running server |
| `npm run db:generate` | Generate SQL migrations from the Drizzle schema |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL` |
| `npm run db:seed` | Seed business profile, defaults and the owner user (`src/db/seed.ts`) |

Integration tests (`tests/integration`) use `TEST_DATABASE_URL`, a separate database or Neon branch that is never the main one (they apply migrations to it and insert/delete rows; the helper refuses to run if it matches `DATABASE_URL`). Without it they are skipped with a warning. Keep `DATABASE_URL` on a development branch, not production.

## Install on iPhone

alpha-Manage works at phone width and can be saved to the home screen like an app:

1. Open the site in **Safari** on the iPhone and sign in once.
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Open it from the new icon: it runs full screen without Safari's bars. Use **Menu** (top right) to move around.

In the app, **View PDF** opens the PDF in its own tab or window (close it to come back) and **Download PDF** saves a copy to the phone. The icon is a placeholder mark: replace the files in `public/icons/` (or edit `scripts/generate-icons.mjs` and run `node scripts/generate-icons.mjs`) once there is a logo. The `STORAGE_DRIVER` setting is a production setting handled with the Vercel deployment (T083), not part of this.

Phone checks: `npx playwright test --project=iphone-390 --project=iphone-375 --project=iphone-430` (also part of `npm run test:e2e`); `PHONE_SHOTS=1` saves screenshots to `docs/phone/`. See [docs/phone/audit.md](docs/phone/audit.md).

## Brand images (supplied by the owner)

The PDF layouts show the company logo and a strip of brand logos (see `specs/001-quotation-delivery-challan/contracts/document-layouts.md`). The images are not in the repository: the owner supplies them. Put the originals in `public/brand/` using these names:

| File | Used for |
|---|---|
| `public/brand/logo.png` | Company logo in the header of the quotation, estimate and challan PDFs |
| `public/brand/brand-strip.png` | Strip of brand logos in the footer of the quotation and estimate PDFs |

Use PNG with a transparent or white background: the logo at least 600 px wide, the brand strip at least 1800 px wide. The owner will also be able to upload both from the business settings page once it is built; an uploaded image takes precedence, and `public/brand/` serves as the default until then. Until a file exists, PDFs render without that image.

## Deploying to Vercel

The project is linked to Vercel and GitHub. Before deploying, set the environment variables above for Production and Preview and connect a Neon database from the Vercel Marketplace. Run `npm run build` locally first.
