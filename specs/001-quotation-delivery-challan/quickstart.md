# Quickstart: Run and Validate the Quotation & Delivery Challan Module

This is a validation guide. Implementation detail lives in `tasks.md` (created by `/speckit-tasks`) and the code.

## Prerequisites

- Node.js 22 LTS and npm.
- A PostgreSQL database URL: a local Postgres, or a Neon database created through the Vercel Marketplace.
- `.env.local` (not committed) with at least: `DATABASE_URL`, `AUTH_SECRET`, `BLOB_READ_WRITE_TOKEN` (or the local-storage setting).
- Sample documents in `samples/` (already present).

## Setup

```bash
npm install
npm run db:migrate
npm run db:seed        # business profile (Alpha Tiles), state codes, charge types, owner user
npm run dev
```

Sign in with the seeded owner account (credentials printed by the seed script, not stored in the repo).

## Validation scenarios

Each scenario maps to a user story and success criteria in [spec.md](spec.md).

1. **Money, GST and words (SC-002)** — `npm test`. The unit test for the Radius 9 example must pass: 4 box × 580.00 + transport 550.00 → CGST 258.30, SGST 258.30, round-off 0.40, total 3,387.00, "INR Three Thousand Three Hundred Eighty Seven Only". An inter-state variant must show IGST 516.60 instead.
2. **Customers (US5)** — create "Radius 9 Innovations" (company, GSTIN `08BOSPP7444G1ZA`, Rajasthan) and an individual in Maharashtra. Invalid GSTIN or a state that disagrees with the GSTIN must be rejected. A `sales` user must not reach `/settings/users`.
3. **Quotation (US1, SC-001)** — create a quotation for each customer with 10 lines including a transport charge. Intra-state shows CGST+SGST, inter-state IGST. Download the PDF and compare with `contracts/document-layouts.md`. Time yourself: under 5 minutes.
4. **Numbering (SC-004)** — issue 50 quotations, including from two browsers at once; numbers are unique and sequential for the financial year.
5. **Revision and expiry (US1)** — revise a sent quotation; rev 1 stays viewable, number unchanged. Set a past `valid_until` and confirm it shows as expired.
6. **Price-list import (US2, SC-003)** — import the Excel template with a sample of rows from `samples/PRICE LIST 01.08.2026.pdf`. Review screen shows new rows; approve. Import a second version with one changed rate; the change is flagged and selling prices stay untouched. Old quotations keep their prices. Enter the sample groups listed in `contracts/price-list-import.md` (from the two sample PDFs) through the template and confirm they import as expected.
7. **Purchase order (US3)** — approve a quotation, record a PO with an attachment and one reduced quantity; the difference from the quotation is visible; recording a PO on a rejected/expired quotation is blocked.
8. **Partial deliveries (US4, SC-005, SC-006)** — PO of 100 boxes: challan 1 for 60 (PO shows 60 delivered / 40 pending, partially delivered), challan 2 for 40 (delivered), a challan for 1 more is blocked, owner override requires a reason. Cancel challan 1: pending returns to 60 and its number is not reused.
9. **Challan PDF (FR-029)** — PDF matches the Tally delivery-note layout (consignee and buyer separate, vehicle, driver, receiver block); prices hidden and shown variants both render.
10. **Security (SC-007)** — signed-out requests to every page, `/api/documents/...` and `/api/files/...` are redirected or return 401.
11. **Phone (Phase 9)** — `npx playwright test --project=iphone-390 --project=iphone-375 --project=iphone-430`: every screen has no sideways scroll, targets of at least 44 px and field text of at least 16 px; the main flows work at 390 px. Done on this machine (Chromium with iPhone emulation). **Still to do on a real iPhone:** Safari → Share → Add to Home Screen, open standalone, check the notch and home bar, View and Download of a PDF.

## Deploy check (Vercel)

- Environment variables set in the Vercel project (Production and Preview), database connected, `npm run build` passes locally.
- Smoke test on the deployed URL: sign in, create a quotation, download a PDF, upload a PO file and download it again.

## Validation record (T085, 2026-11-21)

Run on the Phase 8 commit with `npm test` (unit and integration, against the TEST database), `npm run test:e2e` (Chromium desktop and the iPhone-width projects), `npm run build` and `npm run lint`.

| # | Scenario | Result | Where it is proven |
|---|---|---|---|
| 1 | Money, GST and words (SC-002) | Pass | `quotation-calc.test.ts` (Radius 9: 3,387.00; inter-state IGST 516.60) and `quotation-sample-set.test.ts` (26 independent cases) |
| 2 | Customers (US5) | Pass | `gstin.test.ts`, `customer-schema.test.ts`, `customers.test.ts`; `access-control.spec.ts` (sales user cannot reach `/settings/users`) |
| 3 | Quotation (US1, SC-001) | Pass; the 5-minute timing was not measured | `quotation.spec.ts`, `full-flow.spec.ts`; PDF layout rendered, side-by-side comparison with `document-layouts.md` left to the owner (F-06) |
| 4 | Numbering (SC-004) | Pass | `numbering.test.ts` (50 concurrent). Two browsers at once are covered by the concurrent transactions test, not by two real browsers. |
| 5 | Revision and expiry | Pass | `quotation.spec.ts`, `quotation-status.test.ts`, `quotation-flow.test.ts`; the dashboard lists sent quotations by days left |
| 6 | Price-list import (US2, SC-003) | Pass | `catalog-import.spec.ts`, `price-list-import.test.ts` (second version flags the changed cost, selling prices untouched, old quotations keep their prices; 2,000-design list) |
| 7 | Purchase order (US3) | Pass | `purchase-order.spec.ts`, `purchase-order.test.ts` (file attached, reduced quantity shown, rejected/expired blocked) |
| 8 | Partial deliveries (US4, SC-005, SC-006) | Pass | `challan.spec.ts`, `challan.test.ts`, `full-flow.spec.ts` (60 + 40, over-delivery blocked, owner override with reason, cancel restores 60 pending and keeps the number) |
| 9 | Challan PDF (FR-029) | Pass for rendering (prices hidden and shown, cancelled mark); layout comparison with the Tally delivery note left to the owner (F-06) | `challan.spec.ts` |
| 10 | Security (SC-007) | Pass | `security-audit.test.ts`, `upload-limits.test.ts`, `security.spec.ts` |
| 11 | Phone (Phase 9) | Pass in Chromium with iPhone emulation, also on WebKit (see the phase 9 commits); **T093, the iPhone simulator check, is still open because this machine has no full Xcode**, and the real home-screen install has not been tried on hardware | `mobile.spec.ts`, `mobile-audit.spec.ts` |
| Deploy check | **Not done** | T083 is prepared (`docs/operations.md`) but not run: the owner has not approved a deploy |

Notes for whoever runs the suites:

- Run the e2e suite against the dev server (`npm run test:e2e` starts one). Against a production build (`next start`) the sign-in endpoint is rate limited by Better Auth (about 3 attempts per 10 seconds per address), so parallel specs fail at sign-in; that is the protection working, not a bug.
- Only one `next dev` can run per folder; if another one is already running, Playwright cannot start its own.
