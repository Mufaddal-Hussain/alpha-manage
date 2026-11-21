# Contract: UI Routes and Permissions

All routes except `/sign-in` require a signed-in staff user. `owner` can do everything; `sales` is limited as shown. Authorization is enforced in server actions and data queries, not only in Proxy.

| Route | Purpose | sales | owner |
|---|---|---|---|
| `/sign-in` | Staff sign-in | public | public |
| `/` | Dashboard: open quotations (sent and still valid, plus the number of drafts), quotations expiring soon (valid-until within 7 days), POs with pending deliveries (open or partially delivered, with how many lines still have goods to deliver) | ✔ | ✔ |
| `/customers`, `/customers/new`, `/customers/[id]` | List/search, create, edit customer, addresses, contacts | ✔ | ✔ |
| `/catalog/products`, `/catalog/products/new`, `/catalog/products/[id]` | Browse/search products, edit selling price/margin, HSN, GST, discontinue | ✔ view/create, set selling price | ✔ |
| `/catalog/brands` | Distributors and brands | view | ✔ manage |
| `/catalog/price-lists`, `/catalog/price-lists/[id]` | Versions per brand, groups, compare with previous version | view | ✔ |
| `/catalog/import/new`, `/catalog/import/[jobId]` | Upload Excel/PDF, processing progress, **review screen** (accept/skip rows, fix values), approve | ✔ | ✔ |
| `/quotations` | List with filters (customer, status, date, number) | ✔ | ✔ |
| `/quotations/new` | Create (customer, lines, charges, terms, layout) | ✔ | ✔ |
| `/quotations/[id]` | View current revision, history of revisions, status actions, PDF, duplicate | ✔ | ✔ |
| `/quotations/[id]/revise` | New revision (not allowed once approved) | ✔ | ✔ |
| `/orders`, `/orders/new?quotation=[id]`, `/orders/[id]` | List/search POs (customer, PO number, quotation number, status, date); record PO (number, date, attachments, ordered quantities, advance, notes) from `?quotation=[id]` (without it, pick an approved quotation); PO page shows quoted vs ordered, attachments and, from Phase 7, delivery progress per line (a placeholder until then) | ✔ | ✔ |
| `/challans`, `/challans/new?order=[id]`, `/challans/[id]` | Create challan from PO (lines with pending quantities prefilled), view, PDF, cancel | ✔ create/view; cancel own same-day | ✔ all, override over-delivery |
| `/settings/business` | Business profile, logo, bank, brand strip | — | ✔ |
| `/settings/numbering` | Series formats and starting numbers | — | ✔ |
| `/settings/terms` | Terms templates | view | ✔ |
| `/settings/users` | Create/deactivate staff, set role, reset password | — | ✔ |
| `/settings/audit` | Audit log: every create, status change, override and settings change, newest first, filter by record type, action and date, 50 per page | — | ✔ |

## Key interactions (acceptance hooks)

- **Quotation editor**: add line by searching products (name, brand, size); quantity entry accepts boxes or sq.ft and shows the other; totals update live (CGST/SGST or IGST, round-off, total in words).
- **Status actions** shown only when valid (see state machine in `data-model.md`).
- **Challan create**: quantity inputs default to pending; exceeding pending shows an error; owners see an "Override with reason" control.
- **Import review**: table of parsed groups with rule warnings (rate/box ÷ sq.ft/box mismatch, design in two groups, missing packing); nothing is saved before "Approve".
