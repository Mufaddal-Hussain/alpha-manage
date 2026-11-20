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

## Deploy check (Vercel)

- Environment variables set in the Vercel project (Production and Preview), database connected, `npm run build` passes locally.
- Smoke test on the deployed URL: sign in, create a quotation, download a PDF, upload a PO file and download it again.
