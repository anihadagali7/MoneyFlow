/** Default category slugs. Must match the seed in drizzle/0001_rls_and_seed.sql. */
export const CATEGORY_SLUGS = [
  "groceries",
  "dining",
  "coffee",
  "bills_utilities",
  "phone_internet",
  "subscriptions_streaming",
  "subscriptions_software",
  "rent_housing",
  "transport_rideshare",
  "transport_gas",
  "transport_transit",
  "travel_flights",
  "travel_lodging",
  "travel_other",
  "shopping_general",
  "shopping_electronics",
  "health_medical",
  "fitness",
  "personal_care",
  "entertainment",
  "education",
  "gifts_donations",
  "insurance",
  "fees_interest",
  "cash_atm",
  "other",
  "payments_transfers",
  "rewards_credits",
  "income_salary",
  "income_other",
] as const;

export type CategorySlug = (typeof CATEGORY_SLUGS)[number];

export function isCategorySlug(value: string): value is CategorySlug {
  return (CATEGORY_SLUGS as readonly string[]).includes(value);
}
