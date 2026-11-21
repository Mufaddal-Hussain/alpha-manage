# Contract: HTTP Endpoints

Mutations are Next.js server actions (typed, Zod-validated, authenticated). Only the endpoints below are HTTP route handlers, because they return files or run long jobs. All require a valid session cookie; unauthenticated requests receive `401`, role violations `403`. All run on the Node.js runtime.

## `GET /api/documents/quotation/[id]/pdf`

Query: `revision` (optional, default current), `layout` (optional: `gst_quotation` | `estimate`, default from the revision), `download` (`1` forces attachment).

- `200 application/pdf` — the document. Name: `{number}-rev{n}.pdf`.
- `404` — not found. `409` — quotation still `draft` and unnumbered (preview allowed with `?preview=1`, watermarked "DRAFT").

## `GET /api/documents/challan/[id]/pdf`

Query: `prices` (`show` | `hide`, default from the challan), `download`.

- `200 application/pdf`; `404`; cancelled challans render with a "CANCELLED" mark.

## `GET /api/files/[id]`

Streams a stored file (PO attachment, import source, logo) after checking the caller may see the owning record. Every signed-in staff member may see every PO (both roles have the Orders screens), so PO attachments need no per-record check beyond the session; add one here if that ever changes. `200` with the original content type; `403`/`404` otherwise. Never exposes a public storage URL.

## `GET /api/imports/template`

The blank price-list template (`.xlsx`: the `Prices` sheet with its header row and one example row, plus a help sheet). Signed-in staff; `401` otherwise.

## `POST /api/imports/[jobId]/process`

**Not built (T062 skipped, Phase 5).** Reserved for chunked processing of large imports (and a future PDF pipeline). Excel/CSV imports are parsed in one request: an integration test imports and approves a 2,000-design list (400 rows) against Neon, asserting each step stays under 30 s (the whole test, cleanup included, ran in about 25 s); parsing and diffing are in memory and saving uses bulk inserts, so no chunked endpoint exists. Build it only if a real list exceeds the limits. Processes the next chunk of an import job and updates `import_job` progress. Idempotent per chunk. Called repeatedly by the import page until `status = needs_review`.

- `200 { status, processed, total, nextChunk }`
- `409` if the job is already approved; `422` if the file cannot be read (message surfaced in the UI).

## Server actions (summary of the contract, not HTTP)

| Action | Input | Rules |
|---|---|---|
| `createCustomer` / `updateCustomer` | name, type, GSTIN?, state, addresses, contacts | GSTIN format and state-code match |
| `saveQuotationDraft` | customer, lines, charges, terms, layout, dates | ≥1 line, quantities > 0, discount 0–100 |
| `issueQuotation` | quotation id | assigns number from series in the same transaction; computes and freezes totals |
| `sendQuotation` / `approveQuotation` / `rejectQuotation` / `reinstateQuotation` | id (+ note) | valid transitions only; audit logged |
| `reviseQuotation` | id | creates revision n+1; blocked when approved |
| `recordPurchaseOrder` | quotation id, customer PO no., date, lines (quotation line, ordered quantity), advance, notes, files (PDF, PNG, JPEG or WebP; up to 5, 10 MB each, 18 MB together), confirm-duplicate flag | quotation must be `approved` (rejected/expired/sent/draft are refused with a reinstate/approve hint); quantity > 0, whole boxes for box items, each line once, charge lines cannot be ordered; duplicate (customer, PO no.) refused unless confirmed, the confirmation is audited; PO lines snapshot description, HSN, unit, rate, discount, GST |
| `createChallan` | PO id, header fields, lines (po_line, quantity), show prices | locks PO lines; quantity ≤ pending unless owner override with reason; assigns number |
| `cancelChallan` | id, reason | status → cancelled; number retained; quantities return to pending |
| `startPriceListImport` | brand, file, source type | creates `import_job` |
| `approveImport` | job id, accepted rows | creates price list version, groups, designs, products; does not change selling prices; flags changed costs |
| `setSellingPrice` | product id, price **or** margin % | updates both consistently |
