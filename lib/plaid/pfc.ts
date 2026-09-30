import type { CategorySlug } from "@/lib/categorize/taxonomy";

/**
 * Maps Plaid's personal_finance_category to ours, only when Plaid is very confident.
 * Matches on keywords rather than exact codes because Plaid's taxonomy has versions
 * (v1, and v2 for accounts created after Dec 2025) with different detailed codes.
 * Anything not matched here goes to the LLM, which also sees Plaid's code as a hint.
 */
const RULES: Array<[RegExp, CategorySlug]> = [
  [/CREDIT_CARD_PAYMENT/, "payments_transfers"],
  [/^INCOME_(WAGES|SALARY)/, "income_salary"],
  [/^INCOME_(INTEREST|DIVIDENDS|TAX_REFUND|RETIREMENT|UNEMPLOYMENT|OTHER)/, "income_other"],
  [/TRANSFER_OUT_WITHDRAWAL|ATM_WITHDRAWAL/, "cash_atm"],
  [/^TRANSFER_(IN|OUT)/, "payments_transfers"],
  [/GROCER/, "groceries"],
  [/COFFEE/, "coffee"],
  [/FAST_FOOD|RESTAURANT/, "dining"],
  [/AIRLINES|FLIGHTS/, "travel_flights"],
  [/LODGING|HOTELS/, "travel_lodging"],
  [/RENTAL_CARS/, "travel_other"],
  [/TAXIS_AND_RIDE_SHARES|RIDE_SHARE/, "transport_rideshare"],
  [/TRANSPORTATION_GAS|GAS_STATIONS|FUEL/, "transport_gas"],
  [/PARKING|PUBLIC_TRANSIT|TOLLS/, "transport_transit"],
  [/GAS_AND_ELECTRICITY|WATER|SEWAGE|WASTE/, "bills_utilities"],
  [/INTERNET_AND_CABLE|TELEPHONE/, "phone_internet"],
  [/PHARMAC|PRIMARY_CARE|DENTAL|EYE_CARE|MEDICAL/, "health_medical"],
  [/GYMS_AND_FITNESS|FITNESS/, "fitness"],
  [/HAIR_AND_BEAUTY|PERSONAL_CARE/, "personal_care"],
  [/INSURANCE/, "insurance"],
  [/INTEREST_CHARGE|BANK_FEES|LATE_FEE|FOREIGN_TRANSACTION_FEE|ATM_FEE/, "fees_interest"],
  [/ELECTRONICS/, "shopping_electronics"],
  [/CHARITABLE_GIVING|DONATION/, "gifts_donations"],
  [/RENT$|^RENT_AND_UTILITIES_RENT/, "rent_housing"],
];

export type Pfc = { primary?: string | null; detailed?: string | null; confidence_level?: string | null };

export function mapPfcToSlug(pfc: Pfc | null | undefined): CategorySlug | null {
  if (!pfc?.detailed || pfc.confidence_level !== "VERY_HIGH") return null;
  for (const [pattern, slug] of RULES) if (pattern.test(pfc.detailed)) return slug;
  return null;
}
