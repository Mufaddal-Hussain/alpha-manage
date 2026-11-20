# Research: Quotation & Delivery Challan Module

All unknowns from the plan's Technical Context are resolved below. Findings from the four real sample documents in `samples/` are marked **[sample]**.

## R1. Findings from the sample documents **[sample]**

| Document | What it shows | Consequence for design |
|---|---|---|
| `PRICE LIST 01.08.2026.pdf` (Fun Enterprises, 8 pp) | One list carrying two brands (Bi'mor, colortile). Per size: packing line ("1200 X 600 – 3 Pcs Packing, 23.25 Sq.Ft"). Per finish row ("Glossy", "Rustic Matt", "Stone", "Carving", "Glossy Decor"): a comma-separated list of design names, **one** Rate/Box and **one** Rate/Sq.ft for the whole row. "W.E.F. 01.08.2026". | Prices belong to a **price group** (size + finish), not to a single design. Need Brand, effective date, packing (pcs/box, sq.ft/box). |
| `SHCO PL-R 6.1-SEP26.pdf` (Icon, 21 pp) | Section per size/series: "600 mm x 600 mm – GLAZED VITRIFIED TILES / 1 Box: 4 Tiles, Coverage: 15.50 Sq.Ft." Numbered groups (Matt & Rustic, Surface Zero Collection, Vintigo, Persian …), design names in capitals, prices as "₹ 899 / ₹ 58"; **one group can have several price rows** (Matt & Rustic: ₹899 and ₹930 for two sub-lists). Packings vary: 1 Tile = 25.83 sq.ft, 2 Tiles = 46.50 sq.ft, 5 Tiles = 9.69 sq.ft, 6 Tiles = 15.50 sq.ft. "w.e.f 07/09/2026", revision tag "R6.1". | Same price-group model. A group can have more than one price row. Sq.ft per box is not derivable from size alone → store it. Price list has a revision label. |
| `3 Radius 9.pdf` (Delivery Note, Tally-generated) | Seller block (name, address, GSTIN, state code 27, email); Delivery Note No. 3 / Date; Mode/Terms of Payment; Reference No. & Date; Other References; Consignee (Ship to) and Buyer (Bill to) **separate** blocks each with GSTIN and state/code; Buyer's Order No. & Date; Dispatch Doc No.; Dispatched through; Destination; Terms of Delivery; line: "ATN 600X600 8538 Plain Ivory Matt", HSN 6907, 4 BOX @ 580.00 per BOX = 2,320.00; **Transport Charges** line, HSN 8704, 550.00; OUTPUT CGST 258.30 + OUTPUT SGST 258.30; Round Off 0.40; total ₹3,387.00 and in words; HSN-wise taxable summary; "Recd. in Good Condition" and Authorised Signatory. | Challan layout contract (FR-029). Transport is a charge line with its own HSN/SAC. Bill-to ≠ ship-to. Tax is 9%+9% on tiles **and** transport (2,870 × 9% = 258.30). Round-off line. |
| `162 Taher bhai.pdf` (scanned "DELIVERY CHALLAN / ESTIMATE", image-only PDF) | Branded sheet: INVOICE TO, Add, INVOICE#162, DATE; rows SL / ITEM DESCRIPTION / QTY / RATE / TOTAL; free-text item "Granite – Cherry Brown" with no quantity yet; delivery address and contact person written as rows; SUB TOTAL, ADVANCE, TOTAL ₹; standard terms ("Payment 100% advance", "Delivery ex-godown/showroom", "not responsible for breakage in transit", "unloading is customer responsibility", "goods once sold will not be taken back", "no complaints after laying the tiles"); receiver sign / authorised sign; brand logo strip (Motto, Somany, Simpolo, Kajaria, Nitco, AGL, Icon, Simero, Nexion). | A non-GST "estimate" style document with advance + standard terms exists today. Free-text lines and granite (priced per sq.ft, no box packing) must be supported. Terms are a reusable template. Brand strip is a branding asset on PDFs. |

Verification of the price math **[sample]**: 883.50 / 15.50 = 57.00 ✔; 1209.00 / 23.25 = 52.00 ✔; 899 / 15.5 ≈ 58.0 ✔. So rate/sq.ft = rate/box ÷ sq.ft per box, and the list shows rounded values. Store the published values as given; do not recompute and silently differ.

Hand-calc sample for tests **[sample]**: 4 box × 580.00 = 2,320.00; + transport 550.00 = 2,870.00 taxable; CGST 9% = 258.30; SGST 9% = 258.30; sum = 3,386.60; round-off +0.40 → 3,387.00.

## R2. Framework and hosting

- **Decision**: Next.js 16.4 (App Router) + React 19 + TypeScript + Tailwind 4, as already scaffolded. Deploy to **Vercel** now.
- **Rationale**: Already in the repo; one codebase for UI, server actions and PDF/download endpoints; user chose Vercel for now.
- **Alternatives**: Separate API (NestJS/Express) — extra moving parts without benefit at this size. Vite SPA — would need a separate backend.
- **Notes**: This Next.js version has breaking changes from older releases (see `AGENTS.md`): e.g. `middleware` is now `proxy.ts` (`node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`); Proxy is for optimistic redirects only, so **authorization is enforced in the data layer / server actions**, not only in Proxy. Read the relevant docs before writing each feature.
- **Later self-hosting on Ubuntu / GoDaddy VPS**: `next build` + `next start` behind nginx works with the same code. GoDaddy shared/cPanel hosting can't run it. Keeping Postgres, file storage and PDF rendering free of Vercel-only services keeps this move cheap (see R3, R5, R6). Not a phase-1 task.

## R3. Database and access layer

- **Decision**: **PostgreSQL** (Neon, via the Vercel Marketplace, for now) with **Drizzle ORM** and SQL migrations (drizzle-kit).
- **Rationale**: Documents, line items, versions and number sequences are relational and need transactions and row locking (gap-free numbering, challan quantity checks). Postgres runs identically on Ubuntu later. Drizzle is thin, type-safe, and works with Neon's serverless driver and plain `pg`.
- **Alternatives**: Prisma (heavier engine, more friction on serverless; fine but not needed). SQLite/Turso (weaker for concurrent writes and later accounting growth). Supabase (bundles auth/storage we would rather keep swappable).

## R4. Authentication and roles

- **Decision**: Email + password sign-in for staff, DB-backed sessions, roles `owner` and `sales`, using **Better Auth** (to confirm the exact current API and version at implementation time; fall back to Auth.js if it doesn't fit). No self-registration: an owner creates users.
- **Rationale**: Staff-only, small user count, no social login needed; library handles hashing, sessions and CSRF. Role checks live in one server-side `requireRole()` used by every action/route.
- **Alternatives**: Hand-rolled sessions (security risk), Clerk/Auth0 (vendor dependency and cost for a handful of staff).

## R5. File storage (PO attachments, imported files, logo)

- **Decision**: A small `storage` interface with a **Vercel Blob** implementation now (private access, served through an authorised route handler) and a local-disk/S3-compatible implementation for self-hosting later.
- **Rationale**: Vercel's filesystem is read-only/ephemeral; documents must not be publicly guessable URLs.
- **Alternatives**: Store files in Postgres (bloats DB); S3 directly (more setup now).

## R6. PDF generation (quotation, challan)

- **Decision**: **@react-pdf/renderer** in a Node-runtime route handler, with a bundled font that has the ₹ glyph (for example Noto Sans) and the logo/brand strip as embedded images.
- **Rationale**: Pure JS, no headless browser, works on Vercel functions and on Ubuntu. Layouts are declared as components and can mirror the existing Tally delivery note and the branded estimate sheet.
- **Alternatives**: Puppeteer/Chromium (large binary, cold starts, size limits on Vercel); pdf-lib (low-level, slow to build layouts); browser print CSS (output differs per user's browser).

## R7. Price-list import

- **Decision, Excel/CSV (dependable path)**: a downloadable template with one row per **price group row** and a design-names column (separated by `;`), parsed server-side with **exceljs**; always show a preview (new / changed / unchanged / error) before commit.
- **Decision, PDF**: **deferred** (owner, 2026-11-20: decide later, no Claude/AI for now). The original distributor PDF can be attached to a price-list version for reference. The import pipeline is built as *parse → review → approve*, so a PDF extractor can later feed the same review screen without changing the data model or approval step.
- **Rationale [sample]**: Both sample PDFs have a text layer, but prices sit beside **comma-separated design lists** with irregular wrapping (Fun Enterprises page 1 extracts with prices detached from their rows; Icon has several price rows per group), so naive rule-based extraction would be fragile for each new distributor. Staff typing or pasting rows into the template (a spreadsheet makes this quick, and one row covers a whole group of designs) is dependable for now.
- **Future options (not planned)**: LLM-assisted extraction with the same review screen; per-distributor parsers; distributor-supplied Excel.
- **Vercel limits**: the Excel import is small enough to parse in one request; the `import_job` table and chunked endpoint stay available for a future PDF pipeline.

## R8. Money, GST and numbering

- **Money**: amounts stored as `NUMERIC(14,2)` in Postgres; all arithmetic in code uses an exact decimal type (not JS floats). Rates such as 1007.5 per box are valid. Tax is computed per line on taxable value and rounded to 2 dp; document round-off to the nearest rupee is a separate line (as in the Tally sample).
- **GST**: place of supply from the customer's ship-to/bill-to state code vs the business's state code (27 Maharashtra for Alpha Tiles). Same state → CGST+SGST (half rate each); different → IGST. Rate and HSN are per product/charge (tiles 6907 at 18% is an *example, to be confirmed by the owner*; the sample's 9%+9% matches 18%). Rates are data, not constants.
- **Amount in words**: Indian system (lakh/crore), "INR … Only", own tested utility (matches sample: "INR Three Thousand Three Hundred Eighty Seven Only").
- **Numbering**: `number_sequences(series, financial_year, last_value)` updated with `INSERT … ON CONFLICT DO UPDATE … RETURNING` inside the document-creating transaction, so numbers are unique and gap-free per series and year. Financial year April–March. Display format configurable, for example `QT/2026-27/0001`, `CH/2026-27/0001`. Existing business numbers (Tally delivery note "3", estimate "162") can be set as the starting value for a series.
- **Alternatives**: Postgres `SEQUENCE` (not gap-free on rollback, no per-year reset); `MAX()+1` (race conditions).

## R9. Data integrity patterns

- **Snapshots**: issued quotation lines copy product name, HSN, rate, GST rate and unit; customer name/GSTIN/addresses are copied onto the document at issue time (FR-014, FR-031).
- **Revisions**: `quotations` holds the stable number; each edit-after-send creates a `quotation_revisions` row with its own lines; only one revision is current.
- **Delivered quantity**: derived from non-cancelled challan lines (`SUM`), not stored, so it cannot drift; the challan insert runs in a transaction that locks the PO lines and checks pending quantity (FR-027).
- **Immutability**: issued/approved/cancelled documents are only changed through explicit status transitions; every transition writes an `audit_log` row (who, when, from → to).

## R10. Testing

- **Decision**: **Vitest** for unit tests on money, GST, numbering, amount-in-words and price-list parsing; integration tests for database transactions against a real Postgres (throwaway local database or Neon branch); **Playwright** for the main flows (quote → PO → challan). Use the figures from `samples/` as fixtures.
- **Rationale**: Money and numbering are the highest-risk parts; the hand-calc example in R1 becomes the first test.

## R11. Future modules (not built, but not blocked)

| Later module | Hook left in this design |
|---|---|
| Purchase request to distributor | `distributor_id` on products/price groups; PO lines reference products; add `purchase_requests` referencing `purchase_orders`. |
| Invoice + receipt | Invoice references PO lines and challan lines; document-number sequences are generic (`series`). |
| Payment / PO follow-up | `audit_log` and statuses; an `advance_amount` is already captured on quotation/PO. |
| Tally accounting | Parties carry GSTIN/state; HSN and tax splits are stored per line, matching Tally voucher data. |
| WhatsApp automation | Customer contacts hold phone numbers; documents have stable share tokens/PDF endpoints. |
| Customer portal | Customer is a first-class entity; auth roles can be extended with a `customer` role later. |
