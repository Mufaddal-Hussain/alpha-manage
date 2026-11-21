# Contract: Document Layouts (PDF)

Layouts mirror the business's existing documents in `samples/`. Fonts must render ₹. A4 portrait. Business details come from `business_profile`, never hard-coded.

## 1. GST Quotation

Header: logo, business name, address, phone, email, GSTIN, state and code.
Meta: **QUOTATION**, quotation number (+ revision when > 1), date, valid until.
Parties: Bill to (name, address, GSTIN, state/code) and Ship to / site (address, contact person and phone).
Table: Sl · Description · HSN/SAC · Qty (unit, with sq.ft/box equivalent) · Rate · Disc % · Taxable value · GST % · Amount. Charge lines (for example Transport Charges, HSN/SAC per `charge_type`) appear after products.
Totals: Taxable total, CGST + SGST **or** IGST, Round off, **Grand total (₹)**, amount in words ("INR … Only"), advance and balance when set.
HSN-wise tax summary table (taxable value, rate, CGST/SGST/IGST amounts).
Footer: terms and conditions, bank details, "for {business}" and authorised signatory, brand strip.

## 2. Estimate (customer-friendly, from the "Delivery Challan / Estimate" sheet)

Same data as the quotation, different presentation: header with logo and contact; "ESTIMATE TO", address, number, date; table Sl · Item description · Qty · Rate · Total (free-text lines allowed, quantity may be blank); Sub total, Advance, **Total ₹**; the standard terms list; receiver sign and authorised sign; brand strip. Tax breakup can be omitted or shown in a single line per business setting.

## 3. Delivery Challan (Tally-style delivery note)

Title **DELIVERY NOTE / DELIVERY CHALLAN**.
Top block: business name, address, GSTIN, state/code, email.
Right grid: Delivery note no. · Dated · Mode/Terms of payment · Reference no. & date · Other references · Buyer's order no. · Dated · Dispatch doc no. · Dispatched through · Destination · Terms of delivery.
Left: **Consignee (Ship to)** and **Buyer (Bill to)**, each with name, address, GSTIN/UIN, state name and code.
Vehicle no., driver name and phone.
Table: Sl · Description of goods · HSN/SAC · Quantity (unit) · Rate · per · Disc % · Amount. Rate/Amount columns and the tax/round-off/total block appear only when `show_prices` is true; otherwise quantity-only. Total quantity row.
When prices are shown: charges (transport), CGST/SGST or IGST, round-off, total, amount in words, HSN-wise taxable summary.
Footer: "Received in good condition" block (receiver name, signature, date), "for {business} — Authorised signatory", "This is a computer generated document". Cancelled challans carry a "CANCELLED" mark.
**As built (Phase 7).** "Reference no. & date" and "Buyer's order no. & date" are one cell each (one stored text, as in `data-model.md`), not separate number and date cells. Vehicle number, driver name and driver phone are a strip under the header. The price block is items only: charges (transport) are not carried on a challan, because a PO has no charge lines to copy them from. The CANCELLED mark is a large diagonal stamp plus a line under the title with the date and reason. Title is "DELIVERY NOTE / DELIVERY CHALLAN".

## Acceptance check (from the Radius 9 sample)

Given product ATN 600X600 8538 Plain Ivory Matt, HSN 6907, 4 BOX at 580.00 per BOX, Transport Charges 550.00 (HSN/SAC 8704), intra-state (27 → 27) at 9% + 9%:
taxable 2,870.00; CGST 258.30; SGST 258.30; round-off 0.40; total **₹3,387.00**; words "INR Three Thousand Three Hundred Eighty Seven Only". The challan/quotation engine must reproduce these figures.
