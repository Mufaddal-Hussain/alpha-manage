# Contract: Price-List Import

## Excel / CSV template (dependable path)

One row per **price row of a group** (a group may have several rows). Header row required. Sheet name: `Prices`.

| Column | Required | Example | Notes |
|---|---|---|---|
| `brand` | yes | `colortile` | Must exist or be created in review |
| `list_label` | no | `R6.1` | Revision label shown in version history |
| `effective_from` | yes | `2026-08-01` | "w.e.f." date, ISO format |
| `size` | yes | `600 x 600` | Free text; `length_mm`/`width_mm` parsed from `NxM` |
| `pieces_per_box` | yes | `4` | |
| `sqft_per_box` | yes | `15.50` | |
| `finish` | yes | `Rustic Matt` | Group / category name |
| `rate_per_box` | yes | `883.50` | INR, ex-GST |
| `rate_per_sqft` | no | `57.00` | If blank, computed; if present, checked |
| `designs` | yes | `Imperia Silver; Imperia Pearl; Star white` | Separated by `;` |
| `hsn_code` | no | `6907` | Default taken from settings if blank |

Validation: all required columns present; numbers parse; `rate_per_box ÷ sqft_per_box` within ₹1 of `rate_per_sqft`; a design name appears at most once per brand + size + list; duplicate design names inside one cell are collapsed with a warning.

## PDF import (deferred, informational)

Not in phase 1 (owner decision, 2026-11-20). The original PDF can only be attached to a price-list version as a reference file. This section records the intended shape so a future extractor can feed the same review screen.

Input: a distributor price-list PDF (text layer expected; samples in `samples/`).
Extractor output, per group row, uses the same fields as the Excel template plus `source_page`:

```json
{
  "brand": "colortile",
  "list_label": null,
  "effective_from": "2026-08-01",
  "size": "600 x 600",
  "pieces_per_box": 4,
  "sqft_per_box": 15.5,
  "finish": "Rustic Matt",
  "rate_per_box": 883.5,
  "rate_per_sqft": 57,
  "designs": ["Imperia Silver", "Imperia Pearl", "Star white"],
  "source_page": 1
}
```

Rules enforced before a row can be accepted: required fields present; arithmetic check as above; every design string came from the page text (the review screen highlights any design not found verbatim); one group row per price shown on the page. Rows failing a rule are shown as `error` with a message and cannot be accepted until corrected.

## Diff semantics on approval

Compared with the brand's current published list, matched by (size, finish, design):

- `new` — design or group not present before → create.
- `changed` — rate differs → create new group version, update product `cost_per_unit`, flag product for selling-price review (selling price untouched).
- `unchanged` — no action.
- `removed` — in the old list but absent from the new one → listed for the owner to decide (keep active / mark discontinued); never auto-discontinued.

## Fixture expectations (from `samples/`)

- `PRICE LIST 01.08.2026.pdf` → brands Bi'mor and colortile; groups include `1200 x 600 / 3 pcs / 23.25 sq.ft / Glossy / 1209.00 / 52.00` and `600 x 600 / 4 pcs / 15.50 / Rustic Matt / 883.50 / 57.00`.
- `SHCO PL-R 6.1-SEP26.pdf` → brand Icon, list label `R6.1`, effective 2026-09-07, group `600 x 600 / 4 pcs / 15.50 / Matt & Rustic` with **two** price rows (899/58 and 930/60).
