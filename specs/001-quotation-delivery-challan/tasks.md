---

description: "Task list for the Quotation & Delivery Challan module (phase 1 of alpha-Manage)"
---

# Tasks: Quotation & Delivery Challan Module

**Input**: Design documents from `specs/001-quotation-delivery-challan/` (plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md)

**Prerequisites**: plan.md and spec.md (done); research, data model, contracts and quickstart (done)

**Tests**: Included, because the plan (research R10) requires tests for money, GST, numbering and pending-quantity rules, and the quickstart validates against them. Test tasks come before the implementation they cover; write them first and see them fail.

**Organization**: Tasks are grouped by user story. Note on order: the spec ranks the customer/staff-access story (US5) at P2, but quotations (US1, P1) need customers and sign-in, so US5 is built before US1. Within each phase the order is tests → schema → logic → server actions → UI.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 quotation, US2 catalog/price lists, US3 purchase order, US4 delivery challan, US5 customers and staff access
- Constraint citations like `data-model.md` `customer.gstin` point to the canonical field definition; do not restate it, just implement it.

## Sessions (one Claude Code session per phase)

Each phase below is executed in its own dedicated session, named as shown. Sessions that write code run **one at a time, in this order**, because later phases build on the files of earlier ones. Each session ends with its phase checkpoint passing and a commit; the next session starts only after that.

| Session | Phase | Tasks | Ends when |
|---|---|---|---|
| `s1-setup` | 1 Setup | T001–T007 | `npm run build` and `npm test` run clean |
| `s2-foundation` | 2 Foundational | T008–T029 | unit + numbering tests pass, owner can sign in, settings editable |
| `s3-customers-access` | 3 US5 | T030–T037 | customers work, access-control e2e passes |
| `s4-quotation` | 4 US1 (MVP) | T038–T051 | quotation + both PDFs verified by hand |
| `s5-catalog-import` | 5 US2 | T052–T063 | sample price lists import, versions kept |
| `s6-purchase-order` | 6 US3 | T064–T069 | approved quotation → PO with attachment |
| `s7-challan` | 7 US4 | T070–T077 | partial deliveries and challan PDF verified |
| `s8-polish-release` | 8 Polish | T078–T086 | quickstart passes, deployed to Vercel |

## Path Conventions

Single Next.js project at the repository root (see plan.md "Source Code"): `src/app`, `src/db`, `src/lib`, `src/server`, `src/components`, `tests/unit|integration|e2e`, `samples/` as fixtures.

> **Next.js 16 reminder** (from `AGENTS.md`): this version differs from older releases (for example `middleware` is now `proxy.ts`). Before writing code for a task that touches routing, server actions, route handlers, caching or the proxy, read the matching guide under `node_modules/next/dist/docs/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Session**: `s1-setup`

**Purpose**: Dependencies, tooling and configuration so everything after can be built and tested.

- [X] T001 Add runtime dependencies to `package.json` (drizzle-orm, a Postgres driver that works with Neon and plain Postgres, zod, decimal.js, better-auth, @react-pdf/renderer, exceljs, @vercel/blob) and run `npm install`
- [X] T002 Add dev dependencies to `package.json` (drizzle-kit, vitest, @playwright/test, tsx) and scripts `db:generate`, `db:migrate`, `db:seed`, `test`, `test:e2e`
- [X] T003 [P] Create `vitest.config.ts` with path alias `@/` → `src/` and create `tests/unit/`, `tests/integration/`, `tests/e2e/` folders with a placeholder-free smoke test `tests/unit/smoke.test.ts`
- [X] T004 [P] Create `playwright.config.ts` (base URL from env, dev-server start command) in the repository root
- [X] T005 [P] Create `.env.example` listing `DATABASE_URL`, `AUTH_SECRET`, `BLOB_READ_WRITE_TOKEN`, `STORAGE_DRIVER`, and add `src/lib/env.ts` validating environment variables with zod
- [X] T006 Create `drizzle.config.ts` and `src/db/index.ts` (database client from `DATABASE_URL`, usable in server actions and route handlers; must also work against a plain local Postgres)
- [X] T007 [P] Add `public/brand/` placeholders instructions in `README.md` for the logo and brand strip images (assets supplied by the owner) and document the setup commands from `quickstart.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Session**: `s2-foundation`

**Purpose**: Core infrastructure and pure business logic needed by every user story.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Tests first (pure logic and numbering)

- [X] T008 [P] Write failing unit tests for exact money helpers in `tests/unit/money.test.ts`: decimal add/multiply, rounding to 2 dp, round-off to nearest rupee returning the signed round-off amount (case: 3,386.60 → +0.40)
- [X] T009 [P] Write failing unit tests for GST in `tests/unit/gst.test.ts`: intra-state split into CGST+SGST (half rate each), inter-state IGST, place-of-supply decision from state codes, the Radius 9 case (2,870.00 taxable at 18% → CGST 258.30, SGST 258.30; inter-state IGST 516.60)
- [X] T010 [P] Write failing unit tests for amount in words in `tests/unit/amount-in-words.test.ts`: Indian numbering (lakh, crore), paise, and the exact string "INR Three Thousand Three Hundred Eighty Seven Only" for 3,387.00
- [X] T011 [P] Write failing unit tests for financial-year helpers in `tests/unit/financial-year.test.ts`: April–March year label (for example 2026-27), boundaries on 31 March and 1 April
- [X] T012 [P] Write failing integration test for gap-free numbering in `tests/integration/numbering.test.ts`: 50 numbers requested concurrently from one series and year are unique and consecutive; a new financial year restarts at 1; a rolled-back transaction does not consume a number (needs a real Postgres)

### Core schema

- [X] T013 Define core tables in `src/db/schema/core.ts`: `user` (role enum per `data-model.md` `user.role`, active flag), `business_profile`, `number_series` (unique series + financial_year per `data-model.md` `number_series.series` and `number_series.financial_year`, `number_series.last_value`), `terms_template`, `audit_log`, `file`; export from `src/db/schema/index.ts`
- [X] T014 Generate and apply the first migration (`src/db/migrations/`) and confirm it runs on an empty local database

### Pure logic

- [X] T015 [P] Implement `src/lib/money.ts` (decimal.js wrappers, rounding, round-off) until T008 passes
- [X] T016 [P] Add Indian state-code data in `src/lib/gst/state-codes.ts` (code, name, GSTIN prefix) and implement `src/lib/gst.ts` (tax mode, split, per-line tax) until T009 passes
- [X] T017 [P] Implement `src/lib/amount-in-words.ts` until T010 passes
- [X] T018 [P] Implement `src/lib/financial-year.ts` until T011 passes
- [X] T019 Implement `src/lib/numbering.ts`: `nextNumber(tx, series, date)` using an upsert-and-return on `number_series` inside the caller's transaction, formatting from the series format (`QT/{FY}/{N}`) until T012 passes (depends on T013–T014, T018)

### Auth, access control and shell

- [X] T020 Configure Better Auth for email + password with database sessions and the `owner` / `sales` roles in `src/lib/auth/index.ts` and mount its handler under `src/app/api/auth/[...all]/route.ts` (confirm the library's current API in its docs first; fall back to Auth.js if it does not fit)
- [X] T021 Implement `src/lib/auth/session.ts` with `requireUser()` and `requireRole(role)` helpers that throw/redirect for unauthenticated or unauthorized callers (authorization lives here, used by every server action and route handler)
- [X] T022 Add `src/proxy.ts` that redirects unauthenticated page requests to `/sign-in` (optimistic check only; see the Next.js proxy doc)
- [X] T023 [P] Build `src/app/(auth)/sign-in/page.tsx` and its form component in `src/components/auth/sign-in-form.tsx`
- [X] T024 Build the authenticated shell in `src/app/(app)/layout.tsx` with sidebar navigation (items hidden by role per `contracts/ui-routes.md`), mobile-friendly header, and sign-out
- [X] T025 [P] Implement `src/lib/audit.ts` (`recordAudit(tx, {...})`) and `src/lib/errors.ts` (typed domain errors surfaced as form messages, plus server-side logging)
- [X] T026 [P] Implement the storage interface in `src/lib/storage/index.ts` with a Vercel Blob adapter `src/lib/storage/vercel-blob.ts` and a local-disk adapter `src/lib/storage/local.ts`, chosen by `STORAGE_DRIVER`
- [X] T027 Implement `GET /api/files/[id]` in `src/app/api/files/[id]/route.ts` (session required; streams from storage; 401/403/404 per `contracts/http-endpoints.md`)
- [X] T028 Implement the seed script `src/db/seed.ts`: Alpha Tiles business profile (name, address, GSTIN, state code 27 from the sample documents), default terms template (the six terms on the sample estimate sheet), default numbering series, one owner user with a generated password printed to the console only
- [X] T029 [P] Build settings pages for the owner: `src/app/(app)/settings/business/page.tsx` (profile, logo, brand strip, bank details), `src/app/(app)/settings/numbering/page.tsx` (formats, starting numbers), `src/app/(app)/settings/terms/page.tsx` (terms templates), with actions in `src/server/settings.ts`

**Checkpoint**: Foundation ready. Unit and numbering tests pass, owner can sign in, settings are editable.

---

## Phase 3: User Story 5 - Customers and staff access (Priority: P2, built first because US1 depends on it)

**Session**: `s3-customers-access`

**Goal**: Staff maintain individual and company customers and the owner manages staff users and roles.

**Independent Test**: Create an individual and a company customer (GSTIN validated, state derived), then sign in as a sales user and confirm owner-only screens are not reachable (quickstart scenario 2).

### Tests for User Story 5

- [ ] T030 [P] [US5] Write failing unit tests for GSTIN validation in `tests/unit/gstin.test.ts`: format pattern and first-two-digits-equal-state-code rule per `data-model.md` `customer.gstin` and `customer.state_code`, valid sample `08BOSPP7444G1ZA` (Rajasthan) and `27ABYFA7430K1ZT` (Maharashtra)
- [ ] T031 [P] [US5] Write Playwright test `tests/e2e/access-control.spec.ts`: signed-out visit to `/customers` redirects to sign-in; a sales user receives no access to `/settings/users` or `/settings/business`

### Implementation for User Story 5

- [ ] T032 [US5] Define customer tables in `src/db/schema/parties.ts`: `customer` (`data-model.md` `customer.type`, `customer.gstin`, `customer.state_code`), `customer_address`, `customer_contact`, `distributor`; generate the migration
- [ ] T033 [P] [US5] Implement GSTIN validation in `src/lib/gstin.ts` until T030 passes
- [ ] T034 [US5] Implement customer queries and actions in `src/server/customers.ts` (create, update, search by name/GSTIN/phone, add/edit addresses and contacts; all call `requireUser()`; zod schemas validate input)
- [ ] T035 [US5] Build customer pages: `src/app/(app)/customers/page.tsx` (list + search), `src/app/(app)/customers/new/page.tsx`, `src/app/(app)/customers/[id]/page.tsx` with forms in `src/components/customers/`
- [ ] T036 [US5] Implement staff user management in `src/server/users.ts` (owner only: create user, set role per `data-model.md` `user.role`, deactivate, reset password) and `src/app/(app)/settings/users/page.tsx`
- [ ] T037 [US5] Hide owner-only navigation and enforce `requireRole('owner')` on settings and user actions; make T031 pass

**Checkpoint**: Customers and users work; access control verified.

---

## Phase 4: User Story 1 - Issue a quotation to a customer (Priority: P1) 🎯 MVP

**Session**: `s4-quotation`

**Goal**: Staff create a GST-correct quotation (or estimate layout) from products, get a numbered PDF, and manage its status and revisions.

**Independent Test**: With a few manually entered products and one customer, create a quotation, generate both PDFs, and compare numbering, line amounts, GST split and total with a hand calculation (quickstart scenarios 1, 3, 4, 5).

### Tests for User Story 1

- [ ] T038 [P] [US1] Write failing unit tests for the quotation calculation engine in `tests/unit/quotation-calc.test.ts`: box ↔ sq.ft conversion with whole-box rounding, line discount, charge lines with their own GST rate, intra vs inter-state, round-off line, the Radius 9 totals (₹3,387.00) and amount in words
- [ ] T039 [P] [US1] Write failing integration tests in `tests/integration/quotation-flow.test.ts`: issuing assigns a number once and not for drafts; revising keeps the number and increments revision; approved quotations cannot be revised; invalid status transitions are rejected; expiry shows after `valid_until`
- [ ] T040 [P] [US1] Write Playwright test `tests/e2e/quotation.spec.ts`: sign in, create a quotation for an existing customer with two products and a transport charge, issue it, download the PDF (response is `application/pdf`)

### Implementation for User Story 1

- [ ] T041 [US1] Define catalog essentials and quotation tables in `src/db/schema/catalog-basic.ts` and `src/db/schema/quotations.ts`: `product` (`data-model.md` `product.unit`, `product.status`, `product.gst_rate`, `product.hsn_code`), `charge_type`, `quotation` (`data-model.md` `quotation.status`, `quotation.number`), `quotation_revision` (`quotation_revision.tax_mode`, `quotation_revision.layout`, `quotation_revision.valid_until`, `quotation_revision.advance_amount`), `quotation_line` (`quotation_line.kind`, `quotation_line.quantity`, `quotation_line.discount_percent`); generate the migration
- [ ] T042 [P] [US1] Implement manual product management in `src/server/products.ts` and pages `src/app/(app)/catalog/products/page.tsx`, `src/app/(app)/catalog/products/new/page.tsx`, `src/app/(app)/catalog/products/[id]/page.tsx` (name, size, finish, unit, packing, HSN, GST rate, selling price/margin, discontinue, including free-text/special items such as granite per FR-008b) and charge types in the seed script `src/db/seed.ts` (Transport Charges, Loading)
- [ ] T043 [US1] Implement the calculation engine in `src/lib/quotation/calc.ts` using `money`, `gst` and `amount-in-words` until T038 passes
- [ ] T044 [US1] Implement the status machine in `src/lib/quotation/status.ts` (valid transitions from `data-model.md`, derived expired state) and quotation actions in `src/server/quotations.ts`: `saveQuotationDraft`, `issueQuotation` (number from `nextNumber` in the same transaction, totals frozen, customer/product snapshots copied per FR-014), `sendQuotation`, `approveQuotation`, `rejectQuotation`, `reinstateQuotation`, `reviseQuotation`, `duplicateQuotation`, `deleteDraft`; all write `audit_log`; make T039 pass
- [ ] T045 [US1] Build quotation list with filters (customer, status, date, number) in `src/app/(app)/quotations/page.tsx` (FR-021)
- [ ] T046 [US1] Build the quotation editor in `src/app/(app)/quotations/new/page.tsx` and `src/components/quotations/quotation-editor.tsx`: customer picker, bill-to and ship-to with site contact, product search, quantity in boxes or sq.ft with the other shown, discount, charge lines, advance, validity (default from `business_profile`), terms template, layout choice, live totals and amount in words
- [ ] T047 [US1] Build `src/app/(app)/quotations/[id]/page.tsx` (current revision, revision history, valid status actions, PDF buttons, duplicate) and `src/app/(app)/quotations/[id]/revise/page.tsx`
- [ ] T048 [P] [US1] Build the GST quotation PDF layout in `src/lib/pdf/quotation-gst.tsx` per `contracts/document-layouts.md` §1 (bundle a font with the ₹ glyph under `src/lib/pdf/fonts/`)
- [ ] T049 [P] [US1] Build the estimate PDF layout in `src/lib/pdf/quotation-estimate.tsx` per `contracts/document-layouts.md` §2
- [ ] T050 [US1] Implement `GET /api/documents/quotation/[id]/pdf` in `src/app/api/documents/[kind]/[id]/pdf/route.ts` (Node runtime, session required, `revision`, `layout`, `download`, `preview` per `contracts/http-endpoints.md`; cache the generated file and regenerate when the revision changes)
- [ ] T051 [US1] Make T040 pass and fix gaps found; confirm quickstart scenarios 1, 3, 4 and 5 by hand

**Checkpoint**: User Story 1 is fully usable on its own: this is the MVP the business can start using.

---

## Phase 5: User Story 2 - Maintain products from distributor price lists (Priority: P2)

**Session**: `s5-catalog-import`

**Goal**: Staff import distributor price lists from the Excel/CSV template, review them, and keep versions; products get cost prices from price groups while staff control selling prices.

**Independent Test**: Import a sample list, set selling prices, import a revised list, and confirm flagged cost changes, untouched selling prices, a viewable earlier version, and unchanged issued quotations (quickstart scenario 6).

### Tests for User Story 2

- [ ] T052 [P] [US2] Create fixtures in `tests/fixtures/price-lists/` as Excel/CSV files built from `samples/PRICE LIST 01.08.2026.pdf` and `samples/SHCO PL-R 6.1-SEP26.pdf` (including the Icon "Matt & Rustic" group with two price rows and a deliberately wrong rate row)
- [ ] T053 [P] [US2] Write failing unit tests for the template parser and rules in `tests/unit/price-list-parse.test.ts`: required columns, `;`-separated designs, rate per box ÷ sq.ft per box within ₹1 of rate per sq.ft, duplicate design in a list, missing packing
- [ ] T054 [P] [US2] Write failing integration tests in `tests/integration/price-list-import.test.ts`: diff semantics (new / changed / unchanged / removed), approval creates a new price list version, product cost updated, `product.selling_price_per_unit` unchanged, existing `quotation_line` rates unchanged

### Implementation for User Story 2

- [ ] T055 [US2] Define catalog tables in `src/db/schema/catalog.ts`: `brand`, `price_list` (`data-model.md` `price_list.status`), `price_group`, `design`, `price_group_design`, `import_job` (`import_job.status`, `import_job.source_type`), `import_row` (`import_row.kind`); extend `product` with `price_group_id`, `cost_per_unit`, `margin_percent` (`data-model.md` `product.cost_per_unit`, `product.margin_percent`); generate the migration
- [ ] T056 [P] [US2] Implement the template builder (downloadable `.xlsx`) and parser in `src/lib/import/price-list-template.ts` per `contracts/price-list-import.md`, with validation rules in `src/lib/import/price-list-rules.ts` until T053 passes
- [ ] T057 [US2] Implement diff and approval logic in `src/lib/import/price-list-diff.ts` and actions in `src/server/catalog.ts` (`startPriceListImport`, `approveImport`, `setSellingPrice` keeping price and margin consistent, `markProductDiscontinued`) until T054 passes
- [ ] T058 [P] [US2] Build brand and distributor pages in `src/app/(app)/catalog/brands/page.tsx` (owner manages, sales view)
- [ ] T059 [US2] Build the import flow: `src/app/(app)/catalog/import/new/page.tsx` (brand, file upload, optional reference PDF attached per FR-007, template download link) and `src/app/(app)/catalog/import/[jobId]/page.tsx` (review table with new/changed/unchanged/error rows and warnings, accept/skip/fix rows, Approve)
- [ ] T060 [US2] Build price list history in `src/app/(app)/catalog/price-lists/page.tsx` and `src/app/(app)/catalog/price-lists/[id]/page.tsx` (groups, designs, comparison with the previous version, link to the reference PDF)
- [ ] T061 [US2] Update product pages from T042 to show cost price, margin and "cost changed, review selling price" flags, and make the quotation editor product search (T046) show brand/size/finish and use the selling price
- [ ] T062 [US2] Implement the optional chunked endpoint `src/app/api/imports/[jobId]/process/route.ts` only if the parser exceeds request limits on real lists; otherwise skip and note it in `contracts/http-endpoints.md`
- [ ] T063 [US2] Verify quickstart scenario 6 by importing groups from both sample lists end to end

**Checkpoint**: Catalog import works; quotations and catalog are independent but integrated through the product search.

---

## Phase 6: User Story 3 - Record the customer's PO against an approved quotation (Priority: P3)

**Session**: `s6-purchase-order`

**Goal**: After approval, staff record the customer's PO (number, date, attachment, ordered quantities, advance) linked to the quotation.

**Independent Test**: Approve a quotation, record a PO with an attachment and one reduced quantity, and see the link, the quoted-vs-ordered difference, and blocking on rejected/expired quotations (quickstart scenario 7).

### Tests for User Story 3

- [ ] T064 [P] [US3] Write failing integration tests in `tests/integration/purchase-order.test.ts`: PO only against an approved quotation; duplicate customer PO number requires confirmation and is audited; ordered quantity may differ from quoted; PO lines snapshot description, HSN, rate
- [ ] T065 [P] [US3] Write Playwright test `tests/e2e/purchase-order.spec.ts`: approve a quotation, record a PO with a file attached, open the file through `/api/files/[id]`

### Implementation for User Story 3

- [ ] T066 [US3] Define `purchase_order` (`data-model.md` `purchase_order.status`, `purchase_order.customer_po_number`), `po_line` (`po_line.quantity_ordered`) and the PO file join in `src/db/schema/orders.ts`; generate the migration
- [ ] T067 [US3] Implement `recordPurchaseOrder` and queries in `src/server/orders.ts` (approved-only check, uniqueness of customer + PO number with confirmed override, snapshots, advance received, file upload through the storage interface, audit log) until T064 passes
- [ ] T068 [US3] Build `src/app/(app)/orders/new/page.tsx` (from `?quotation=[id]`), `src/app/(app)/orders/page.tsx` and `src/app/(app)/orders/[id]/page.tsx` showing quoted vs ordered differences, attachments, and (placeholder until US4) delivery progress per line
- [ ] T069 [US3] Add the "Record PO" action to the quotation page `src/app/(app)/quotations/[id]/page.tsx` for approved quotations and block it for rejected/expired ones; make T065 pass

**Checkpoint**: Quotation → approval → PO works end to end.

---

## Phase 7: User Story 4 - Deliver against a PO with delivery challans (Priority: P4)

**Session**: `s7-challan`

**Goal**: Staff create one or more challans against a PO with partial deliveries, see ordered/delivered/pending per line, and print the Tally-style challan.

**Independent Test**: PO of 100 boxes: challan for 60, then 40, a challan for 1 more is blocked, cancel the first and see pending restored with its number retained (quickstart scenarios 8 and 9).

### Tests for User Story 4

- [ ] T070 [P] [US4] Write failing integration tests in `tests/integration/challan.test.ts`: 60 + 40 on 100 ordered; over-delivery rejected; owner override requires a reason and is audited; sales cannot override; cancel restores pending and keeps the number; two concurrent challans cannot jointly exceed pending; PO status moves open → partially delivered → delivered and back after cancel
- [ ] T071 [P] [US4] Write Playwright test `tests/e2e/challan.spec.ts`: create two partial challans from a PO and download the PDF with prices hidden and shown

### Implementation for User Story 4

- [ ] T072 [US4] Define `delivery_challan` (`data-model.md` `delivery_challan.number`, `delivery_challan.status`, `delivery_challan.show_prices`, `delivery_challan.vehicle_no`) and `challan_line` (`data-model.md` `challan_line.quantity`) in `src/db/schema/challans.ts`; generate the migration
- [ ] T073 [US4] Implement pending-quantity query (`delivered = SUM` over issued challans, never stored) in `src/lib/challan/pending.ts` and the actions in `src/server/challans.ts`: `createChallan` (single transaction: lock PO lines `FOR UPDATE`, check pending, owner override with reason, number from `nextNumber`, snapshots of consignee/buyer, update PO status), `cancelChallan` (reason, status change, number kept); audit every action; make T070 pass
- [ ] T074 [US4] Build `src/app/(app)/challans/new/page.tsx` (from `?order=[id]`, quantities prefilled with pending, header fields per `contracts/document-layouts.md` §3, show-prices toggle, owner-only override control), `src/app/(app)/challans/page.tsx` and `src/app/(app)/challans/[id]/page.tsx` (cancel with reason)
- [ ] T075 [US4] Replace the delivery-progress placeholder on `src/app/(app)/orders/[id]/page.tsx` with ordered / delivered / pending per line and the list of challans
- [ ] T076 [P] [US4] Build the challan PDF layout in `src/lib/pdf/challan.tsx` per `contracts/document-layouts.md` §3 (consignee and buyer blocks, vehicle/driver, receiver block, optional prices and tax summary, CANCELLED mark)
- [ ] T077 [US4] Extend `src/app/api/documents/[kind]/[id]/pdf/route.ts` to serve `challan` with the `prices` option; make T071 pass; verify quickstart scenarios 8 and 9

**Checkpoint**: The full phase 1 flow (customer → quotation → PO → challans) works.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Session**: `s8-polish-release`

**Purpose**: Cross-story quality, security, and release.

- [ ] T078 [P] Build the dashboard `src/app/(app)/page.tsx` (open quotations, expiring soon, POs with pending deliveries)
- [ ] T079 [P] Add an audit log view for owners in `src/app/(app)/settings/audit/page.tsx`
- [ ] T080 Write the full-flow Playwright test `tests/e2e/full-flow.spec.ts` (customer → quotation → approve → PO → two challans) and run all suites
- [ ] T081 [P] Security pass: confirm every server action and route handler calls `requireUser()`/`requireRole()`, file uploads enforce type and size limits (spec edge case), and signed-out requests to `/api/documents/...` and `/api/files/...` return 401 (quickstart scenario 10, SC-007)
- [ ] T082 [P] Responsive and accessibility pass on the quotation editor, challan form and import review at phone width
- [ ] T083 Configure Vercel: environment variables for Production and Preview, Neon database, Blob store, `npm run build` clean, then run the deploy smoke test from `quickstart.md` (the Vercel and GitHub link already exists from the main session)
- [ ] T084 [P] Document database backup/restore and owner runbook in `docs/operations.md`, including how the same app is later run on Ubuntu (Node, Postgres, nginx)
- [ ] T085 Run the whole `quickstart.md` validation and tick off the success criteria SC-001 to SC-008; record gaps as follow-up tasks
- [ ] T086 Ratify the project constitution from the principles proposed in `plan.md` using `/speckit-constitution`

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (1)** → **Foundational (2)** → all user stories.
- **US5 (3)** needs Foundational; **US1 (4)** needs US5 (customers, sign-in).
- **US2 (5)** needs Foundational and the `product` table from US1 (T041); it can start once T041 exists and can run in parallel with US3/US4 work.
- **US3 (6)** needs US1 (approved quotations). **US4 (7)** needs US3 (POs).
- **Polish (8)** after the stories it covers.

### Within a story

Tests first (they fail), then schema → logic → server actions → UI → PDF/routes.

### Parallel opportunities

- Setup: T003, T004, T005, T007.
- Foundational tests T008–T012 together, then T015–T018 together; T023, T025, T026, T029 are independent files.
- US1: T038–T040 together; T048 and T049 (two PDF layouts) together; T042 alongside T043.
- US2: T052–T054 together; T056 and T058 together.
- After US1: US2 and US3 can proceed in parallel by different people.

### Parallel example (Foundational tests)

```text
T008 money tests          tests/unit/money.test.ts
T009 GST tests            tests/unit/gst.test.ts
T010 amount-in-words      tests/unit/amount-in-words.test.ts
T011 financial-year       tests/unit/financial-year.test.ts
T012 numbering (needs DB) tests/integration/numbering.test.ts
```

## Implementation Strategy

- **MVP**: Phases 1, 2, 3 (US5) and 4 (US1). At that point staff can create customers and products by hand and issue numbered GST quotations and estimates as PDFs. Stop and validate with the owner (quickstart scenarios 1–5, SC-001, SC-002, SC-004).
- **Incremental delivery**: add US2 (catalog import) → US3 (PO) → US4 (challan), validating each against its independent test, then Polish.
- **Open items carried from the plan**: GST rates and HSN/SAC codes are placeholders until the customer verifies them (kept as data, not code); PDF price-list extraction is deferred and out of this task list.
