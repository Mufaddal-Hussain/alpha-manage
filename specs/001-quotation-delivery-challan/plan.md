# Implementation Plan: Quotation & Delivery Challan Module

**Branch**: `main` (spec dir `001-quotation-delivery-challan`) | **Date**: 2026-11-20 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-quotation-delivery-challan/spec.md`

## Summary

Build phase 1 of alpha-Manage for a tile trading business: a staff-only web app to maintain customers and a distributor-fed product catalog, issue GST quotations as PDFs, record the customer PO against an approved quotation, and deliver against it with partial-delivery challans, tracking ordered / delivered / pending per line.

Approach: a single Next.js 16 App Router application (already scaffolded) with server actions and a few route handlers, PostgreSQL via Drizzle, staff authentication with two roles, exact-decimal GST maths, gap-free per-financial-year numbering, `@react-pdf/renderer` for PDFs, and a price-list import that models the real distributor format (price groups of designs) with a mandatory review step. Deployed on Vercel for now with Neon Postgres and Vercel Blob, written so it can move to an Ubuntu server later without code changes beyond configuration.

## Technical Context

**Language/Version**: TypeScript 5, Node.js 22 LTS runtime (Vercel default and Ubuntu-installable)

**Primary Dependencies**: Next.js 16.4 (App Router, React 19.3), Tailwind CSS 4, Drizzle ORM + drizzle-kit, Zod, Better Auth (confirm at implementation), `@react-pdf/renderer`, exceljs, a decimal library (decimal.js)

**Storage**: PostgreSQL (Neon via Vercel Marketplace now; any Postgres later); Vercel Blob for files behind a storage interface (local disk / S3-compatible for self-hosting)

**Testing**: Vitest (unit + DB integration), Playwright (end-to-end), real documents in `samples/` as fixtures

**Target Platform**: Web, desktop and phone browsers; Vercel serverless now, Ubuntu (Node + nginx + Postgres) later

**Project Type**: Web application (single Next.js project; no separate backend)

**Performance Goals**: Typical pages respond in under 1 s; quotation PDF generated in under 5 s; 2,000-product Excel import previewed in under 1 minute of processing

**Constraints**: Exact money arithmetic (no floats); no data lost or altered on issued documents; every endpoint authenticated; serverless time limits require chunked/background processing for PDF imports; no Vercel-only features that block later self-hosting

**Scale/Scope**: One business, under 10 staff users, thousands of products, hundreds of quotations per year, about 20 screens

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` was ratified as version 1.0.0 on 2026-11-21 (T086) from the principles below, which the plan follows:

| Proposed principle | How this plan complies |
|---|---|
| Money is exact (no floating point), tax rules are data | R8: NUMERIC(14,2) + decimal library; GST rates and HSN stored per product/charge |
| Issued documents are immutable history | R9: snapshots, revisions, status transitions only, audit log |
| Numbers are unique and gap-free per series and financial year | R8: transactional sequence table |
| Tests first for money, tax, numbering and stock-like quantity rules | R10: fixtures from real documents |
| Authenticated by default, least privilege | R4: `requireRole()` in the data layer; Proxy only for redirects |
| Simplicity: one app, one database, swappable edges | Single Next.js project; storage/PDF-import behind interfaces |

**Result (pre-design)**: PASS (no ratified gates). **Result (post-design)**: PASS; no complexity violations recorded.

## Project Structure

### Documentation (this feature)

```text
specs/001-quotation-delivery-challan/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0: decisions, sample-document findings
├── data-model.md        # Phase 1: entities, relations, state machines
├── quickstart.md        # Phase 1: how to run and validate end to end
├── contracts/           # Phase 1: UI routes, HTTP endpoints, import template, PDF layouts
│   ├── ui-routes.md
│   ├── http-endpoints.md
│   ├── price-list-import.md
│   └── document-layouts.md
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 (/speckit-tasks) - not created here
```

### Source Code (repository root)

```text
src/
├── app/
│   ├── (auth)/sign-in/                 # sign-in page
│   ├── (app)/                          # authenticated shell
│   │   ├── page.tsx                    # dashboard (recent quotations, pending deliveries)
│   │   ├── customers/
│   │   ├── catalog/                    # brands, price lists, products, import review
│   │   ├── quotations/                 # list, new, [id], [id]/revise
│   │   ├── orders/                     # customer POs, [id] with delivery progress
│   │   ├── challans/                   # list, new (from a PO), [id]
│   │   └── settings/                   # business profile, numbering, terms, users (owner)
│   └── api/
│       ├── documents/[kind]/[id]/pdf/route.ts   # quotation / challan PDF
│       ├── files/[id]/route.ts                  # authorised file download
│       └── imports/[id]/process/route.ts        # chunked price-list import step
├── db/
│   ├── schema/                         # Drizzle tables by area
│   ├── migrations/
│   └── index.ts
├── lib/
│   ├── money.ts                        # decimal helpers, rounding, round-off
│   ├── gst.ts                          # place of supply, CGST/SGST/IGST split
│   ├── amount-in-words.ts              # Indian numbering
│   ├── numbering.ts                    # per-series, per-financial-year sequences
│   ├── financial-year.ts
│   ├── auth/                           # session, requireRole
│   ├── storage/                        # interface + vercel-blob + local adapters
│   ├── pdf/                            # react-pdf layouts: quotation, estimate, challan
│   └── import/                         # excel template parser, pdf-assisted extractor, validators
├── server/                             # server actions and queries per module
│   ├── customers.ts  catalog.ts  quotations.ts  orders.ts  challans.ts  settings.ts
└── components/                         # shared UI (tables, forms, status badges)

tests/
├── unit/                               # money, gst, words, numbering, import parsers
├── integration/                        # DB transactions: numbering, pending-qty check, revisions
└── e2e/                                # Playwright: quote -> PO -> challan

samples/                                # real documents used as fixtures
```

**Structure Decision**: One Next.js project (no separate frontend/backend), because the team is one person plus staff-scale usage, server actions cover mutations, and a handful of route handlers cover PDFs, file downloads and the import job. Pure business logic lives in `src/lib` so it is unit-testable without the framework and reusable by later modules (invoice, Tally export).

## Build Order (vertical slices)

1. **Foundation**: DB + migrations, auth + roles, app shell, business profile, financial year and numbering, money/GST/words utilities with tests (first test = the Radius 9 hand-calc in research R1).
2. **Customers** (US5) and **manual product entry** so quotations can start before imports exist.
3. **Quotation** (US1): create, GST totals, PDF, statuses, revisions, duplicate, list/filter. *First shippable result for the business.*
4. **Catalog and price lists** (US2): brands, price groups, Excel template import with review, selling price/margin, version history. (PDF price-list extraction is deferred; no AI service is used for now.)
5. **Purchase order** (US3): record against approved quotation, attachment, quoted vs ordered differences.
6. **Delivery challan** (US4): partial deliveries, pending checks, cancel, challan PDF in the Tally layout.
7. **Hardening**: roles audit, audit log views, e2e flows, Vercel production deploy and backups.

Slices 1–3 give a working quotation tool; 4–6 follow. Each slice is independently testable per the spec's priorities.

## Decisions Needed From the Owner

Resolved by the owner on 2026-11-20:

1. **PDF price-list import**: deferred; no Claude/AI for now. Phase 1 imports from the Excel/CSV template or manual entry. Revisit later.
2. **GST rates and HSN/SAC codes**: the customer (business) will verify them. Rates and codes are stored as editable data per product and charge type, never hard-coded; the sample's tiles 6907 at 9%+9% and transport 8704 are placeholders until confirmed.
3. **Document numbering**: defaults are fine (`QT/{FY}/{N}`, `CH/{FY}/{N}`; starting numbers set in settings), changeable later.
4. **Quotation vs estimate**: the estimate is a second PDF layout of the same quotation.
5. **Vercel / GitHub**: already linked in the main session; this plan does not set up deployment accounts.

Still open: none blocking phase 1.

## Complexity Tracking

No constitution violations; nothing to justify.
