export type InvoiceStatus = "draft" | "open" | "paid" | "void";

export interface Invoice {
  id: string;
  customer: string;
  amountCents: number;
  currency: string;
  issuedAt: string;
  dueAt: string;
  status: InvoiceStatus;
}

export const INVOICES: Invoice[] = [
  {
    id: "inv_1001",
    customer: "Northwind",
    amountCents: 15000,
    currency: "USD",
    issuedAt: "2026-01-03",
    dueAt: "2026-01-17",
    status: "open",
  },
];

export function listInvoices(): Invoice[] {
  return INVOICES.slice();
}
