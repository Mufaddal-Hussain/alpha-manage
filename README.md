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

> Until the foundation phase lands, there is no database schema: `db:generate` / `db:migrate` need `src/db/schema/` and `db:seed` runs `src/db/seed.ts`, both created in the next phase. `npm run build`, `npm run lint` and `npm test` already work without a database.

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

Integration tests that touch the database need `DATABASE_URL` pointing at a throwaway database (a local Postgres or a Neon branch), never production.

## Brand images (supplied by the owner)

The PDF layouts show the company logo and a strip of brand logos (see `specs/001-quotation-delivery-challan/contracts/document-layouts.md`). The images are not in the repository: the owner supplies them. Put the originals in `public/brand/` using these names:

| File | Used for |
|---|---|
| `public/brand/logo.png` | Company logo in the header of the quotation, estimate and challan PDFs |
| `public/brand/brand-strip.png` | Strip of brand logos in the footer of the quotation and estimate PDFs |

Use PNG with a transparent or white background: the logo at least 600 px wide, the brand strip at least 1800 px wide. The owner will also be able to upload both from the business settings page once it is built; an uploaded image takes precedence, and `public/brand/` serves as the default until then. Until a file exists, PDFs render without that image.

## Deploying to Vercel

The project is linked to Vercel and GitHub. Before deploying, set the environment variables above for Production and Preview and connect a Neon database from the Vercel Marketplace. Run `npm run build` locally first.
