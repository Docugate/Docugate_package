import { getInvoice, payInvoice } from '../api'

export function InvoiceDetail() {
  return (
    <div>
      <span data-tour="invoice-total">100</span>
      <button data-tour="mark-paid">Mark as paid</button>
    </div>
  )
}
