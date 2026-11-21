# Feature Specification: Quotation & Delivery Challan Module

**Feature Branch**: `001-quotation-delivery-challan` (work is done on `main` for now; no feature branch created)

**Created**: 2026-11-20

**Status**: Draft

**Input**: User description: "Quotation and Delivery Challan module for alpha-Manage, a business management web app for a tile trading business (customers are individuals or companies; the business buys from distributors). Phase 1: product catalog fed by distributor price lists, customer master, quotations with India GST in INR and PDF output, customer PO recording against an approved quotation, and delivery challans against a PO with partial deliveries. Staff-only users with roles."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Issue a quotation to a customer (Priority: P1)

A sales staff member creates a quotation for a customer (individual or company). They pick tile products from the catalog, enter quantities and optional discounts, review GST-correct totals in rupees, and produce a branded PDF that they share with the customer by hand (WhatsApp or email). The quotation gets a unique, sequential number and a validity date.

**Why this priority**: Issuing quotations is the first thing the business needs and is the entry point of the whole sales flow. On its own it replaces manual quotation making in documents or spreadsheets.

**Independent Test**: With a few products and one customer already in the system, create a quotation, generate the PDF, and check the numbering, line amounts, GST split and total against a hand calculation.

**Acceptance Scenarios**:

1. **Given** a customer in the same state as the business, **When** staff add products and finalize the quotation, **Then** tax is shown as CGST + SGST per line and in the summary, and the grand total is also shown in words in Indian rupees.
2. **Given** a customer in a different state, **When** the quotation is finalized, **Then** tax is shown as IGST instead of CGST + SGST.
3. **Given** a finalized quotation, **When** staff generate the PDF, **Then** the document shows business branding, quotation number, date, validity date, customer details, line items with HSN codes, tax summary, terms and total in words.
4. **Given** a quotation already sent, **When** staff revise it, **Then** a new revision is created that keeps the same quotation number, the earlier revision is preserved and viewable, and only the latest revision is treated as current.
5. **Given** a sent quotation past its validity date with no decision, **When** staff view it, **Then** it shows as expired.

---

### User Story 2 - Maintain products from distributor price lists (Priority: P2)

Staff import a distributor's price list from an Excel/CSV template (reading distributors' PDF price lists automatically is deferred to a later phase; until then staff enter or paste the PDF's rows into the template) to create or update catalog products with the distributor's cost price. Staff then set their own selling price (or margin) per product. Older price lists are kept as versions, so the business can see what a price was at any time, and existing quotations are unaffected by later price changes.

**Why this priority**: The catalog is what makes quotations fast and consistent. Quotations can still be created with manually entered products before this exists, which is why it ranks second.

**Independent Test**: Import a sample Excel price list, confirm products appear with cost prices, set selling prices, import a revised list, and confirm that prices update while the earlier version stays viewable and issued quotations keep their original prices.

**Acceptance Scenarios**:

1. **Given** a distributor price list file, **When** staff import it, **Then** they see a preview of the products found (new, changed, unchanged, unreadable rows) and can confirm before anything is saved.
2. **Given** an imported product with a cost price, **When** staff set a margin percentage or a fixed selling price, **Then** the other value is shown consistently, and the selling price is what appears when the product is picked on a quotation.
3. **Given** a newer price list from the same distributor, **When** it is imported, **Then** changed cost prices are flagged for staff to review and selling prices are not silently changed.
4. **Given** a quotation issued before a price change, **When** staff open it, **Then** its line prices are unchanged.

---

### User Story 3 - Record the customer's PO against an approved quotation (Priority: P3)

When a customer approves a quotation and sends their purchase order, staff mark the quotation approved and record the PO: customer PO number, PO date, an attachment of the PO document, and the quantities ordered per line (usually matching the quotation but sometimes fewer or different).

**Why this priority**: The PO is the trigger for delivery and gives the business a firm commitment to track.

**Independent Test**: Take an approved quotation, record a PO with an attached file, and verify the PO links back to the quotation and shows ordered quantities per product.

**Acceptance Scenarios**:

1. **Given** a sent quotation, **When** staff mark it approved and record a PO, **Then** the PO is linked to the quotation and the quotation can no longer be edited, only revised via a new revision before approval.
2. **Given** a PO that differs from the quotation (changed quantities or removed items), **When** staff record it, **Then** the PO captures its own ordered quantities, and the difference from the quotation is visible.
3. **Given** a rejected or expired quotation, **When** staff try to record a PO against it, **Then** they are blocked or asked to reinstate the quotation first.

---

### User Story 4 - Deliver against a PO with delivery challans (Priority: P4)

As goods are dispatched to the customer, staff create a delivery challan against the PO. The challan lists the products and quantities in this delivery, the delivery address, vehicle and driver details, and has a receiver-signature block. A PO can have several challans (partial deliveries). The system tracks, per product line, how much has been ordered, delivered, and is still pending, and prevents delivering more than the pending quantity unless an authorized user explicitly allows it.

**Why this priority**: This closes the loop on the order and gives the paperwork for dispatch. It depends on POs existing.

**Independent Test**: Against a PO for 100 boxes of a tile, create a challan for 60 and another for 40, and verify pending quantities after each, the challan numbers, and the printable PDF with vehicle and signature block.

**Acceptance Scenarios**:

1. **Given** a PO with pending quantities, **When** staff create a challan for part of the quantities, **Then** the PO shows delivered and pending quantities per line and its status becomes partially delivered.
2. **Given** all quantities delivered across challans, **When** the last challan is issued, **Then** the PO status becomes fully delivered.
3. **Given** a challan quantity above the pending quantity, **When** staff try to issue it, **Then** the system blocks it with a clear message unless an owner/admin overrides.
4. **Given** an issued challan, **When** staff generate the PDF, **Then** it shows challan number, date, PO and quotation references, delivery address, vehicle and driver, line items with quantities, and a receiver name/signature/date block (no prices needed on the challan).
5. **Given** an issued challan, **When** it needs to be cancelled, **Then** it is marked cancelled (never deleted), its quantities return to pending, and its number is not reused.

---

### User Story 5 - Manage customers and staff access (Priority: P2)

Staff keep a customer master of individuals and companies, with GSTIN (for companies), billing and shipping addresses and contact people. Only signed-in staff can use the system. An owner/admin can add staff users and control what each can do; sales staff can create quotations, record POs and issue challans but cannot change settings, users, or override restricted actions.

**Why this priority**: Required by quotations (customer details and GST place-of-supply) and by basic security, but a minimal version is enough to start.

**Independent Test**: Create an individual and a company customer, verify GSTIN format validation and that a sales user cannot access admin-only screens.

**Acceptance Scenarios**:

1. **Given** a company customer with a GSTIN, **When** staff save it, **Then** the GSTIN format is validated and the state is derived from it for tax purposes.
2. **Given** an individual customer without a GSTIN, **When** staff select a state manually, **Then** quotations use that state for the CGST/SGST vs IGST decision.
3. **Given** a person who is not signed in, **When** they try to open any page or document, **Then** they are asked to sign in first.
4. **Given** a sales-role user, **When** they try an owner/admin-only action, **Then** it is not available to them.

---

### Edge Cases

- A price-list file has missing prices, duplicate product codes, merged cells, or unexpected columns: unreadable rows are reported in the preview rather than silently dropped or imported wrongly.
- Distributors send PDF price lists: automatic PDF reading is out of this phase, so staff convert the rows into the Excel/CSV template (or add products manually).
- GST rounding: line-level and total-level rounding must be consistent so the PDF total equals the sum shown, with any round-off shown as a separate line.
- A customer's state or GSTIN changes after a quotation was issued: issued documents keep the details they were issued with.
- Two staff create documents at the same time: document numbers remain unique and gap-free per series.
- A product is later discontinued or its price changes: existing quotations, POs and challans are unaffected, and new quotations cannot pick a discontinued product.
- Quotation has zero lines, a negative quantity, or a discount above 100%: blocked with a clear message.
- Tile quantities can be sold in boxes, pieces or square feet/metres: a product has a defined unit, and conversions (for example, coverage per box) are shown but not guessed.
- Numbering resets per financial year (April to March) in India: the numbering format must make the year clear and never repeat a number.
- Attachments (PO files) are large or in an unexpected format: size/type limits are enforced with a clear message.

## Requirements *(mandatory)*

### Functional Requirements

**Access and users**

- **FR-001**: System MUST require staff to sign in before viewing or changing any data or downloading any document.
- **FR-002**: System MUST support at least two roles, owner/admin and sales staff, with owner/admin able to manage users and restricted actions.
- **FR-003**: System MUST record who created, changed, approved, issued, or cancelled each quotation, PO, and challan, and when.

**Customers**

- **FR-004**: Users MUST be able to create, edit, and search customers who are either individuals or companies.
- **FR-005**: System MUST store, per customer, name, type, GSTIN (optional for individuals, validated in format when given), billing address, one or more shipping addresses, state, and one or more contacts (name, phone, email).

**Catalog and price lists**

- **FR-006**: Users MUST be able to import a distributor price list from an Excel file, previewing results before saving.
- **FR-007**: System MUST let staff attach the original distributor PDF to a price-list version for reference. Automatic extraction from PDF is deferred (decision pending); the import format must not prevent adding it later.
- **FR-008**: System MUST model distributor price lists the way they are actually published: a distributor carries one or more brands; each brand's list is organized by size (for example 600x600, 1200x600, 1200x195), with a packing definition (tiles per box and square feet per box) and groups of designs that share one finish/category and one price (for example "Glossy" or "Rustic Matt"), quoted as rate per box and rate per square foot. A price therefore belongs to a price group, and each design (for example "Imperia Silver") inherits its cost price from the group it sits in.
- **FR-008a**: System MUST store, per sellable product (a design in a given size and finish), name/code, brand, distributor, size, finish/category, packing (tiles per box, sq.ft per box), unit of sale, HSN code, GST rate, and current distributor cost price (rate per box and per sq.ft, kept consistent with the packing).
- **FR-008b**: System MUST support non-tile and special items sold by the business (for example granite sold per sq.ft with no fixed box packing, or items entered as free text) and non-product charge lines such as transport charges, each with their own HSN/SAC code and GST rate.
- **FR-009**: Users MUST be able to set a selling price per product either directly or as a margin on the cost price.
- **FR-010**: System MUST keep each imported price list as a version, showing what changed against the previous version, and MUST NOT change selling prices automatically on import.
- **FR-011**: System MUST allow products to be added and edited manually, and marked discontinued.

**Quotations**

- **FR-012**: Users MUST be able to create a quotation for a customer by selecting products, quantities, optional per-line discount, and optional additional charges (for example transport or loading), and MUST be able to enter quantity in boxes or in square feet with the other shown automatically from the product's packing (rounding up to whole boxes where whole boxes are sold).
- **FR-012a**: A quotation MUST be able to record a separate bill-to buyer and ship-to consignee, a delivery address and site contact person (as used on the business's existing documents), and an advance amount expected or received, with the balance shown.
- **FR-013**: System MUST calculate line totals, taxable value, GST (CGST + SGST for same-state, IGST for different-state), round-off, and grand total in Indian rupees, and show the total in words.
- **FR-014**: System MUST copy the product name, unit, HSN, GST rate and price onto the quotation line at the time of issue so later catalog changes do not alter it.
- **FR-015**: System MUST assign each quotation a unique, sequential number per financial year, and a validity date (default configurable, for example 15 days).
- **FR-016**: System MUST support quotation statuses: draft, sent, approved, rejected, expired, and MUST show only valid next transitions.
- **FR-017**: Users MUST be able to revise a quotation not yet approved, creating a new revision while keeping earlier revisions viewable.
- **FR-018**: Users MUST be able to generate a branded PDF of a quotation with business details (name, address, GSTIN, bank details), customer details, line items with HSN codes, tax summary, terms and conditions, and total in words.
- **FR-019**: Users MUST be able to download or copy a share link for the PDF to send manually; sending by the system itself is not required in this phase.
- **FR-020**: Users MUST be able to duplicate an existing quotation to start a new one.
- **FR-021**: Users MUST be able to list and filter quotations by customer, status, date, and number.

**Purchase orders**

- **FR-022**: Users MUST be able to record a customer PO against an approved quotation, capturing PO number, PO date, ordered quantities per line, and an attached PO file.
- **FR-023**: System MUST link each PO to its quotation and show differences between quoted and ordered quantities.
- **FR-024**: System MUST prevent duplicate customer PO numbers for the same customer unless explicitly confirmed.

**Delivery and challans**

- **FR-025**: Users MUST be able to create one or more delivery challans against a PO, each listing products and the quantities delivered in that dispatch.
- **FR-026**: System MUST track ordered, delivered, and pending quantity per PO line, and show PO delivery status as not delivered, partially delivered, or fully delivered.
- **FR-027**: System MUST block challan quantities above the pending quantity, with an owner/admin override that is recorded.
- **FR-028**: System MUST assign each challan a unique, sequential number per financial year.
- **FR-029**: Users MUST be able to generate a challan PDF in the layout the business already uses for delivery notes: business details with GSTIN and state, challan number and date, mode/terms of payment, reference number and date, buyer's order (PO) number and date, dispatch document number, dispatched through, destination, terms of delivery, bill-to buyer and ship-to consignee (each with GSTIN and state), line items with HSN, quantity and unit, vehicle number, driver name and phone, a \"received in good condition\" receiver block, and an authorised-signatory block. Rates, tax and totals on the challan MUST be optional (shown or hidden per challan).
- **FR-030**: System MUST allow an issued challan to be cancelled (not deleted), restoring its quantities to pending and keeping its number reserved.

**Data integrity and future growth**

- **FR-031**: System MUST keep issued quotations, POs, and challans as historical records that cannot be altered by later changes to customers, products, or prices.
- **FR-032**: System MUST keep the links quotation to PO to challan in a form that later modules (purchase requests to distributors, invoices, receipts, payment follow-up, accounting export, messaging automation) can build on without reshaping existing records.

### Key Entities *(include if feature involves data)*

- **Staff User**: A person who signs in; has a role (owner/admin or sales).
- **Customer**: An individual or company the business sells to; has GSTIN (optional), state, addresses, and contacts.
- **Distributor**: A supplier who provides price lists and materials to the business.
- **Brand**: A tile brand supplied through a distributor (a distributor can carry several, for example two brands on one price list).
- **Price List (version)**: One import of a distributor's prices for a brand, with effective date (\"w.e.f.\"), source file, and the price groups it contained.
- **Price Group**: Within a price list, a size plus finish/category with packing definition, rate per box and rate per sq.ft, and the list of designs that share that price.
- **Product**: A sellable design in a given size and finish (or a special/free-text item such as granite), with brand, packing, unit, HSN code, GST rate, current cost price (from its price group), and selling price.
- **Quotation**: A priced offer to a customer, with number, status, validity date, customer snapshot, revisions, and tax summary.
- **Quotation Line**: A product on a quotation, with quantity, unit price, discount, tax rate, and amounts, copied from the catalog at issue time.
- **Purchase Order (customer PO)**: The customer's order linked to a quotation; has PO number, date, attachment, ordered lines, and delivery status.
- **Delivery Challan**: A dispatch document against a PO; has number, date, delivery address, vehicle and driver, status (issued or cancelled), and delivered lines.
- **Business Profile**: The business's own name, address, GSTIN, bank details, logo, terms, and numbering settings used on documents.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A sales staff member can create and produce the PDF of a typical quotation (10 line items for an existing customer) in under 5 minutes.
- **SC-002**: Quotation totals, GST split, and total in words match an independent hand calculation on 100% of a sample set of at least 20 test quotations, including same-state, inter-state, discounted, and round-off cases.
- **SC-003**: A distributor Excel price list of up to 2,000 products can be imported and reviewed in under 10 minutes, with 100% of unreadable rows reported rather than silently skipped.
- **SC-004**: Every issued quotation, PO and challan number is unique and sequential within its financial year, with no duplicates or gaps in a test of at least 50 documents created including concurrent use.
- **SC-005**: For any PO, staff can see ordered, delivered and pending quantity per line at a glance, and the figures stay correct across partial deliveries and challan cancellations in 100% of test scenarios.
- **SC-006**: A challan can be created from an existing PO and printed in under 3 minutes.
- **SC-007**: Unauthenticated visitors can access no business data or documents, and sales-role users cannot perform any owner/admin-only action.
- **SC-008**: Staff can find any past quotation, PO or challan by customer, number, or date in under 30 seconds.

### Verification status (T085, 2026-11-21)

Checked by running the suites and `quickstart.md` (record in that file). Status: **met** = proven by an automated test or by the check named; **met, not timed** = the capability is built and tested but nobody has timed it with a stopwatch; **open** = see the follow-up task.

| ID | Status | Evidence |
|---|---|---|
| SC-001 | **met, not timed** | A quotation (customer, products, charge, issue, PDF) is created end to end in `quotation.spec.ts` and `full-flow.spec.ts`; a 10-line, under-5-minute run by a person has not been timed. Follow-up F-05. |
| SC-002 | **met** | `tests/unit/quotation-sample-set.test.ts`: 26 quotations (intra, inter, discount, paise, fractional sq.ft, mixed GST, zero-rated, negative round-off, lakh and crore) agree with an independent hand-calculation implementation, plus the Radius 9 example in `quotation-calc.test.ts`. |
| SC-003 | **met** | `price-list-import.test.ts`: a 2,000-design list is previewed and approved, each step under 30 s, unreadable rows reported (not skipped). |
| SC-004 | **met** | `numbering.test.ts`: 50 concurrent numbers are unique and consecutive; new financial year restarts; cancelled challan numbers are not reused (`challan.test.ts`). |
| SC-005 | **met** | `challan.test.ts` and `challan.spec.ts`: ordered/delivered/pending after 60+40 partial deliveries, over-delivery block, cancellation restoring quantities; `full-flow.spec.ts` repeats it through the screens. |
| SC-006 | **met, not timed** | A challan is created from a PO and its PDF opened in `challan.spec.ts` and `full-flow.spec.ts` in a few clicks; not timed by a person. Follow-up F-05. |
| SC-007 | **met** | `tests/unit/security-audit.test.ts` (every server action, route handler and page authorises; owner-only actions use the owner role) and `tests/e2e/security.spec.ts` (signed-out and forged-cookie requests to every page, `/api/documents/...` and `/api/files/...` are redirected or get 401; sales users are refused every owner-only screen; no self-registration or role escalation through the auth endpoints). |
| SC-008 | **met, not timed** | Quotation, PO and challan lists filter by customer, number and date (`quotation.spec.ts`, `purchase-order.spec.ts`, `challan.spec.ts`); the dashboard and the audit log add two more ways in. Not timed. |

## Assumptions

- Real sample documents from the business are kept in `samples/`: two distributor price lists (a multi-brand list from Fun Enterprises effective 01.08.2026, and an Icon / SHCO list R6.1 effective 07.09.2026, 21 pages), a computer-generated delivery note (Tally layout) and a scanned \"Delivery Challan / Estimate\" sheet. Requirements above were checked against these documents.
- The scanned \"Delivery Challan / Estimate\" shows the business also issues an informal combined estimate/challan for some customers (item description, quantity, rate, total, advance, standard terms such as \"100% advance\" and \"delivery ex-godown/showroom\"). The quotation module must be able to produce an equivalent customer-friendly document with terms and advance, in addition to the full GST quotation.
- Price-list PDFs are text-based, but their layout (prices beside groups of design names, several sizes per page, multiple brands) makes naive table extraction unreliable. Phase 1 therefore imports from a standard Excel/CSV template with a review step; the owner will decide later whether and how to add automatic PDF reading, and no AI service is used for now.

- The business operates in India: amounts are in INR, tax is GST with CGST + SGST for same-state and IGST for inter-state sales, and the financial year runs April to March.
- Users are internal staff only; customers and distributors do not sign in during this phase. Documents are shared with customers manually as PDFs.
- Quotation validity defaults to 15 days and is configurable.
- Price-list import in this phase is from the Excel/CSV template or manual entry; PDF price lists are stored as reference files only.
- The business's own details (name, address, GSTIN, bank details, logo, terms) are set once by an owner/admin and reused on documents.
- One business entity and one location are in scope; multi-branch support is not needed yet.
- Stock and inventory tracking are out of scope; challans deduct nothing from stock in this phase.
- Delivery challans for goods moving between states may later need e-way bill details; capturing those is out of scope for this phase.
- Out of scope but must not be designed out: purchase requests to distributors after a quotation is approved, invoicing and receipts, payment and PO follow-ups, accounting integration with Tally, WhatsApp-based reminders and automation, and a customer portal.
- The application will be hosted on the web, with a managed database and file storage, and used on desktop and phone browsers.
