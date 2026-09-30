/** Plaid returns amounts as floats in major units; we store integer cents. */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function formatCents(cents: number, currency = "USD"): string {
  if (currency === "USD") return usd.format(cents / 100);
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}
