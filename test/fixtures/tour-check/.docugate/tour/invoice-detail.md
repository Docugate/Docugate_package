---
route: /invoices/:id
title: Invoice
---

## Total
target: [data-tour="invoice-total"]
data: GET /api/invoices/:id → total
code: frontend/src/screens/InvoiceDetail.tsx
source: backend/src/billing.ts
docs: https://example.com/docs

The amount due.

## Mark as paid
target: [data-tour="mark-paid"]
data: POST /api/invoices/:id/pay → status
code: frontend/src/screens/InvoiceDetail.tsx

Click to pay.
