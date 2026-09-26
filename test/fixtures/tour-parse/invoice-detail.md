---
route: /invoices/:id
title: Invoice
---

## Customer
target: [data-tour="invoice-customer"]
data: GET /api/invoices/:id → customer.name
code: frontend/src/screens/InvoiceDetail.tsx
source: backend/src/billing.ts
docs: https://www.trydocugate.site/docs

The name of the billed customer. The route handler in `backend/src/routes/invoices.ts` resolves `customerId` to a full `{ id, name }` object by calling `customerName()` in `billing.ts`, which looks the customer up in the in-memory `customers` array.

## Status
target: [data-tour="invoice-status"]
data: GET /api/invoices/:id → status, overdue
code: frontend/src/screens/InvoiceDetail.tsx
source: backend/src/billing.ts
docs: https://www.trydocugate.site/docs

The badge label is `overdue` when `isOverdue()` returns true (an open invoice whose `dueAt` is before `TODAY`), otherwise it mirrors the stored `status` field (`draft`, `open`, or `paid`).

## Line items
target: [data-tour="invoice-lines"]
data: GET /api/invoices/:id → lines, subtotal, tax
code: frontend/src/screens/InvoiceDetail.tsx
source: backend/src/billing.ts
docs: https://www.trydocugate.site/docs

Each row comes from the `lines` array stored on the invoice; the per-row amount is `quantity × unitPrice`, computed in the frontend. The tfoot rows for subtotal and tax are the `subtotal` and `tax` fields returned by `totals()` in `billing.ts`, which derives them from the line items and the 18% `TAX_RATE` constant; neither value is stored.

## Total
target: [data-tour="invoice-total"]
data: GET /api/invoices/:id → total
code: frontend/src/screens/InvoiceDetail.tsx
source: backend/src/billing.ts
docs: https://www.trydocugate.site/docs

The amount due: the line items' subtotal plus 18% tax, computed by `totals()` in the backend. It is never stored.

## Mark as paid
target: [data-tour="mark-paid"]
data: POST /api/invoices/:id/pay → status
code: frontend/src/screens/InvoiceDetail.tsx
source: backend/src/routes/invoices.ts
docs: https://www.trydocugate.site/docs

The button is only rendered when `invoice.status === 'open'`. Clicking it calls `payInvoice()` in `api.ts`, which issues `POST /api/invoices/:id/pay`; the route handler sets `status = 'paid'` and `paidAt = TODAY` in-memory, then the screen reloads the invoice via `reload()`.
