# alpha-Manage Constitution

## Core Principles

### I. Money Is Exact; Tax Rules Are Data
All money and quantity arithmetic MUST use exact decimals (`decimal.js` in code, `NUMERIC` in the database). Floating-point
numbers MUST NOT hold or compute amounts. GST rates, HSN/SAC codes, rounding and financial-year rules MUST be stored as
editable data (per product, charge type or setting) and MUST NOT be hard-coded constants in business logic. Rationale:
the business issues tax documents; a one-paisa drift or a stale hard-coded rate is a real error.

### II. Issued Documents Are Immutable History
Once a quotation, purchase order or challan is issued, its figures, customer details and item snapshots MUST NOT change.
Corrections happen through new revisions, cancellation (never deletion; the number stays reserved) or valid status
transitions, and every create, status change and override MUST be written to the audit log in the same transaction as the
change. Later edits to customers, products or prices MUST NOT alter issued documents. Rationale: documents are legal and
commercial records, and later modules (invoices, accounting) build on them.

### III. Numbers Are Unique and Gap-Free Per Series and Financial Year
Every document number MUST be assigned from a per-series, per-financial-year (April to March) sequence inside the
transaction that creates the document, so numbers never repeat, never skip, and survive concurrent use. The financial year
MUST be part of every number format. Drafts that have no number MUST NOT consume one. Rationale: numbering gaps and
duplicates are audit findings.

### IV. Tests First for Money, Tax, Numbering and Quantity Rules (NON-NEGOTIABLE)
Code that computes money, GST, rounding, amount in words, document numbers, status transitions or ordered/delivered/pending
quantities MUST have its tests written first, using fixtures from real documents in `samples/` where they exist. Such
logic MUST live in pure modules (`src/lib`) that are testable without the framework, and rules that need a database
(numbering, locking, pending quantities) MUST have integration tests against a test database that is never the main one.
A change to these rules is not done until the unit, integration and end-to-end suites pass.

### V. Authenticated by Default, Least Privilege
Every page, server action and route handler MUST authorise inside the data layer with `requireUser()`, `requireRole()` or
`authorizeRequest()` before reading or writing data; Proxy only redirects optimistically and is never the control.
Owner-only capabilities (users, settings, audit log, overrides) MUST be restricted with `requireRole("owner")`. Signed-out
requests to documents and files MUST receive 401, and uploads MUST be limited by type (checked from content, not the
browser's claim) and size. There is no self-registration and no public storage URL. Rationale: the app holds customer and
pricing data for a single business and is staff-only.

### VI. Simplicity: One App, One Database, Swappable Edges
The system MUST remain one Next.js application with one PostgreSQL database. Anything provider-specific (file storage,
hosting, future PDF import) MUST sit behind a small interface selected by configuration, so the app runs on Vercel with Neon
and Blob today and on Ubuntu with Node, Postgres and nginx later with no code change beyond configuration. New services,
queues or dependencies MUST be justified in writing in the plan's complexity tracking before they are added.

## Technology and Delivery Constraints

- Stack: Next.js 16 (App Router), TypeScript, Tailwind, Drizzle on PostgreSQL, Better Auth, `@react-pdf/renderer`, exceljs,
  Vitest and Playwright. Read the matching guide in `node_modules/next/dist/docs/` before relying on Next.js behaviour.
- Every screen MUST work at phone width (375 to 430 px) with no sideways scroll and touch targets of at least 44 px.
- Secrets MUST NOT be committed. Environment variables are validated in one place (`src/lib/env.ts`).
- Schema changes are forward-only migrations; take a backup before applying them to production (`docs/operations.md`).
- Deploying to production and pushing to the shared remote require the owner's approval.

## Development Workflow and Quality Gates

- Work follows the Spec Kit artifacts in `specs/` (spec, plan, tasks); behaviour or data-rule changes update them first.
- A change is mergeable only when `npm test`, `npm run test:e2e`, `npm run build` and `npm run lint` pass.
- Bugs found in money, tax, numbering, quantity or access rules are fixed together with a test that fails without the fix.
- Reviews MUST check the changed code against the six principles above.

## Governance

This constitution supersedes other practices for this project. Amendments are made with `/speckit-constitution`, recorded
in git with the reason, approved by the owner, and, where they change existing behaviour, accompanied by a migration plan.
Versioning follows semantic versioning: MAJOR for removing or redefining a principle, MINOR for adding a principle or
materially expanding guidance, PATCH for clarifications. Compliance is reviewed whenever a plan is written (Constitution
Check in `plan.md`) and before each release; any deviation MUST be recorded and justified in the plan's complexity tracking.
Runtime guidance for contributors lives in `README.md`, `AGENTS.md` and `docs/operations.md`.

**Version**: 1.0.0 | **Ratified**: 2026-11-21 | **Last Amended**: 2026-11-21
