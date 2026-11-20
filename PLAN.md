# alpha-Manage: Product Plan

Business management web app for a tile trading business (Alpha Tiles, Pune). Status: **plan confirmed by the owner on 2026-11-20 (open decisions resolved). No features built yet.**

## Business flow (whole product)

1. Distributors publish price lists and supply material.
2. Customers (individuals or companies) choose products from the catalog and finalize a list.
3. Staff issue a **quotation**; the customer approves and sends a **purchase order (PO)**.
4. Staff request material from the distributor.
5. Goods are delivered against the PO with **delivery challans** (often in parts).
6. **Invoicing and receipts**, then **payment and PO follow-ups**.
7. **Accounting in Tally**; **automations** such as WhatsApp follow-ups.

## Phase 1 (build first): Quotation and Delivery Challan

Steps 2, 3 and 5 above, plus the catalog and customer master they need.

- Catalog fed by distributor price lists (price groups per size/finish with rate per box and per sq.ft; versions; own selling price/margin).
- Customer master (individual/company, GSTIN, addresses, contacts).
- GST quotations in INR with PDF (CGST+SGST or IGST, HSN, amount in words, revisions, validity, statuses) and an informal "estimate" layout.
- Customer PO recorded against an approved quotation.
- Delivery challans against a PO with partial deliveries and pending-quantity tracking; challan PDF in the existing Tally layout.
- Staff-only login with roles (owner, sales).
- Responsive on iPhone and installable to the home screen (added 2026-11-21).

Details: [spec](specs/001-quotation-delivery-challan/spec.md), [technical plan](specs/001-quotation-delivery-challan/plan.md), [research](specs/001-quotation-delivery-challan/research.md), [data model](specs/001-quotation-delivery-challan/data-model.md), [contracts](specs/001-quotation-delivery-challan/contracts/), [quickstart](specs/001-quotation-delivery-challan/quickstart.md).

## Later phases (not built, not designed out)

Purchase requests to distributors; invoicing and receipts; payment and PO follow-ups; Tally integration; WhatsApp automation; customer portal.

## Tech stack

Next.js 16 (App Router) + TypeScript + Tailwind, PostgreSQL (Neon) with Drizzle, Better Auth, `@react-pdf/renderer`, exceljs, Vercel Blob for files, Vitest + Playwright. Hosting: **Vercel now**; the same code is meant to run later on an Ubuntu server or GoDaddy VPS (Node + nginx + Postgres). GoDaddy shared hosting cannot run it.

## Build order (phase 1)

1. Foundation: database, auth and roles, shell, business profile, numbering, money/GST utilities with tests.
2. Customers and manual products.
3. Quotation and PDF (first useful result for the business).
4. Catalog and price-list import (Excel/CSV template with review; PDF extraction deferred).
5. Purchase order.
6. Delivery challan.
7. Hardening and production deploy.
8. Phone and home-screen app (added 2026-11-21): every screen works on an iPhone and the app can be saved to the home screen (manifest, icons, iOS metadata, safe areas, mobile tests). Runs after the challan phase and, recommended, before the production deploy.

## Open decisions for the owner

Resolved 2026-11-20:

1. PDF price-list import: decide later; no Claude/AI for now. Phase 1 uses an Excel/CSV template.
2. GST rates and HSN/SAC codes: the customer will verify; stored as editable data, not hard-coded.
3. Document numbering: defaults, changeable later.
4. Estimate: a second PDF layout of the same quotation.
5. Vercel and GitHub: already linked in the main session.

Open: none blocking phase 1.
