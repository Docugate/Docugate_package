export const getInvoice = (id: string) => fetch(`/api/invoices/${id}`)
export const payInvoice = (id: string) => fetch(`/api/invoices/${id}/pay`, { method: 'POST' })
