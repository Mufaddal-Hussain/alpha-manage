# Data Model: Quotation & Delivery Challan Module

PostgreSQL. Conventions: `id` is a UUID primary key; every table has `created_at`, `updated_at`; money is `NUMERIC(14,2)`; quantities are `NUMERIC(12,3)`; rates may carry 2 decimals (for example 1007.50). "Snapshot" means the value is copied at issue time and never recomputed from its source.

## Access and settings

**user** — id, name, email (unique), password hash (managed by auth library), `role` (`owner` | `sales`), `active`.

**business_profile** (single row) — legal name, trade name, address lines, city, state, `state_code` (e.g. 27), GSTIN, phone, email, logo file, brand-strip image file, bank name / account / IFSC (for documents), default quotation validity days (15), default terms template id.

**number_series** — `series` (`quotation` | `challan` | later `invoice`, `receipt`), `format` (e.g. `QT/{FY}/{N:4}`), `financial_year` (e.g. `2026-27`), `last_value`. Unique (`series`, `financial_year`). Updated only inside the document-creating transaction.

**terms_template** — name, body (list of clauses, e.g. "Payment 100% advance", "Delivery ex-godown / showroom"), `is_default`.

**audit_log** — user, entity type, entity id, action (`create`, `status_change`, `override`, …), from/to status, note, timestamp.

**file** — storage key, original name, mime type, size, uploaded by. Referenced by PO attachments, price-list sources and the business logo.

## Parties

**customer** — `type` (`individual` | `company`), display name, legal name, GSTIN (nullable, format-validated), PAN (nullable), `state_code`, billing address, phone, email, notes, `active`.

**customer_address** — customer, label, address lines, city, pincode, `state_code`, `is_default_shipping`. (Shipping destinations, e.g. "Koregaon Park site".)

**customer_contact** — customer, name, phone, email, role. (Site contact persons, as on the Taher bhai sheet.)

**distributor** — name, GSTIN (nullable), phone, email, address, notes, `active`.

## Catalog

**brand** — name, distributor, `active`. (Fun Enterprises carries Bi'mor and colortile; Icon is distributed via SHCO.)

**price_list** — brand, `label` (e.g. "R6.1"), `effective_from` (w.e.f.), source file, status (`draft` | `published` | `superseded`), imported by, imported at. One published list per brand is current; older lists stay readable.

**price_group** — price list, `size_label` (e.g. "600 x 600"), `length_mm`, `width_mm` (nullable), `finish` (e.g. "Glossy", "Rustic Matt", "Matt & Rustic", "Vintigo"), `pieces_per_box`, `sqft_per_box`, `rate_per_box`, `rate_per_sqft`, `sort_order`, optional `note` (e.g. "9 mm series"). A series can yield several groups when a source group has more than one price row.

**design** — brand, `name` (e.g. "Imperia Silver"), `active`. Unique (brand, name). Reusable across price lists so history of a design's price is traceable.

**price_group_design** — price group, design. Each design appears in at most one group per size per price list.

**product** — the sellable item. brand (nullable for free-text/special items), design (nullable), `price_group_id` (nullable; the current group supplying cost), `name`, `code` (nullable), `size_label`, `finish`, `unit` (`box` | `sqft` | `piece`), `pieces_per_box`, `sqft_per_box` (nullable for granite etc.), `hsn_code`, `gst_rate`, `cost_per_unit` (copied from the group when imported, kept for margin), `selling_price_per_unit`, `margin_percent` (derived or set), `status` (`active` | `discontinued`). Products for a design are created from price groups on import (one per design per size/finish) and can also be added by hand.

**charge_type** — non-product charges: name ("Transport Charges", "Loading"), `hsn_sac_code`, `gst_rate`, `active`.

### Price-list import tables

**import_job** — brand, price list (draft), source file, source type (`excel` | `pdf`), status (`uploaded` | `processing` | `needs_review` | `approved` | `failed`), page/chunk progress, error summary, created by.

**import_row** — job, page/row reference, parsed payload (JSON: size, packing, finish, rates, design names), `kind` (`new` | `changed` | `unchanged` | `error`), message, `accepted` flag. On approval, accepted rows become price groups, designs and product updates.

## Quotation

**quotation** — `number` (unique, from series), customer, `status`, `current_revision_id`, `created_by`, `approved_at`, `rejected_at`, `expired_at`.

**quotation_revision** — quotation, `revision_no` (1, 2, …), quotation date, `valid_until`, **bill-to snapshot** (name, GSTIN, address, `state_code`), **ship-to snapshot** (name, address, `state_code`, site contact name/phone), `place_of_supply_state_code`, `tax_mode` (`intra` → CGST+SGST, `inter` → IGST), `layout` (`gst_quotation` | `estimate`), terms text, `advance_amount`, subtotal (taxable), CGST total, SGST total, IGST total, `round_off`, `grand_total`, `total_in_words`, `notes`, `sent_at`, PDF file (cached, regenerated on change).

**quotation_line** — revision, `line_no`, `product_id` (nullable for free text), **snapshot**: description, `hsn_code`, `unit`, `pieces_per_box`, `sqft_per_box`; `quantity` (in `unit`), `quantity_alt` (derived sq.ft or boxes, for display), `rate`, `discount_percent`, `taxable_value`, `gst_rate`, `cgst_amount`, `sgst_amount`, `igst_amount`, `line_total`, `kind` (`product` | `charge`), `charge_type_id` (for transport/loading).

### Quotation status machine

```
draft ──send──▶ sent ──approve──▶ approved
  │               │ ├─reject──▶ rejected
  │               │ └─(valid_until passes)──▶ expired
  │               └──revise──▶ new revision (status stays draft→sent again)
  └─delete (draft only, number not yet issued) 
approved: locked; can only be followed by PO / cancel by owner
rejected/expired ──reinstate (owner or sales with note)──▶ sent
```

A quotation gets its number when it first leaves `draft` (issue), so gap-free numbering is not wasted on abandoned drafts. Revisions after sending keep the number and increment `revision_no`.

## Purchase order (customer PO)

**purchase_order** — `internal_ref` (optional, own series later), quotation, `quotation_revision_id` (the approved revision), customer, **customer_po_number**, `po_date`, `advance_received`, `notes`, `status` (`open` | `partially_delivered` | `delivered` | `cancelled`), attachment file(s) (via `po_file` join: PO, file), `created_by`. Unique (customer, customer_po_number) unless override noted in audit_log.

**po_line** — PO, `quotation_line_id` (nullable if added at PO time), **snapshot** description, `hsn_code`, `unit`, `quantity_ordered`, `quantity_quoted` (for difference display), `rate`, `gst_rate`.

`status` is derived and kept in sync by challan transactions (`open` when delivered = 0, `partially_delivered` when 0 < delivered < ordered on any line, `delivered` when every line is fully delivered, unless cancelled by owner).

## Delivery challan

**delivery_challan** — `number` (unique, from series), purchase order, customer, `challan_date`, **consignee (ship-to) snapshot** (name, GSTIN, address, `state_code`), **buyer (bill-to) snapshot**, `mode_terms_of_payment`, `reference_no_date`, `other_references`, `buyers_order_no_date` (from PO), `dispatch_doc_no`, `dispatched_through`, `destination`, `terms_of_delivery`, `vehicle_no`, `driver_name`, `driver_phone`, `show_prices` (boolean), `status` (`issued` | `cancelled`), `cancelled_at`, `cancel_reason`, PDF file, `created_by`. Charges such as transport can be carried on the challan when `show_prices` is true.

**challan_line** — challan, `po_line_id`, **snapshot** description, `hsn_code`, `unit`, `quantity` (> 0), `rate` (when shown), and tax amounts when `show_prices` is true.

### Derived quantities (never stored)

For each `po_line`:
`delivered = SUM(challan_line.quantity)` over challans with `status = 'issued'`;
`pending = quantity_ordered − delivered`.
Issue rule: inside one transaction, lock the PO's lines (`SELECT … FOR UPDATE`), recompute pending, and reject any challan line whose quantity exceeds pending unless an `owner` supplies an override reason (recorded in `audit_log`). Cancelling a challan frees its quantity again; its number stays reserved.

## Relationships (summary)

```
distributor 1─* brand 1─* price_list 1─* price_group *─* design
brand 1─* design ; price_group 1─* product (current cost source)
customer 1─* customer_address / customer_contact
customer 1─* quotation 1─* quotation_revision 1─* quotation_line ─ product / charge_type
quotation 1─* purchase_order 1─* po_line ─ quotation_line
purchase_order 1─* delivery_challan 1─* challan_line ─ po_line
number_series feeds quotation.number and delivery_challan.number
audit_log and file are referenced by id from the above
```

## Validation rules (from the spec)

- GSTIN: 15 chars, pattern `^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$`; first two digits must equal the state code of the party.
- `tax_mode` is derived: `place_of_supply_state_code == business_profile.state_code` → intra, else inter. Not user-editable on an issued revision.
- Quotation needs at least one line; quantity > 0; `discount_percent` between 0 and 100; `valid_until` ≥ quotation date.
- Where a product is sold in boxes, quantity is a whole number of boxes; the sq.ft equivalent is shown, not stored as the source of truth.
- Challan line quantity > 0 and ≤ pending (override by owner only).
- Product with `status = discontinued` cannot be added to new quotation lines.
- Price-list import never alters `selling_price_per_unit`; changed cost prices are flagged for review.
