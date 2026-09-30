/**
 * Normalizes a merchant name or raw card descriptor into a stable key, so
 * "SQ *BLUE BOTTLE #123 SAN FRANCISCO" and "Blue Bottle" can share a category rule.
 * The result is only ever stored as a blind index (lib/crypto/blindIndex.ts).
 */
const PREFIXES = /^(sq \*|sq\*|tst\* ?|paypal \*|pp\*|sp \*?|dd \*|in \*|py \*|pos |ach |debit |purchase |checkcard \d*\s*)/;

export function normalizeMerchant(raw: string): string {
  let s = raw.toLowerCase().trim();
  for (let i = 0; i < 2; i++) s = s.replace(PREFIXES, "");
  return s
    .replace(/\*/g, " ")
    .replace(/#\s*\d+/g, " ") // store numbers
    .replace(/\b\d{3,}\b/g, " ") // reference numbers, phone digits
    .replace(/\b(www\.|\.com|\.net|inc|llc|co)\b/g, " ")
    .replace(/[^a-z0-9&' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Prefer Plaid's cleaned merchant name; fall back to the raw descriptor. */
export function merchantKey(merchantName: string | null | undefined, description: string): string {
  return normalizeMerchant(merchantName?.trim() || description);
}
