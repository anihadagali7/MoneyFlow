import { describe, expect, it } from "vitest";
import { merchantKey, normalizeMerchant } from "@/lib/merchant";
import { centsToInput, formatCents, toCents } from "@/lib/money";
import { mapPfcToSlug } from "@/lib/plaid/pfc";

describe("money", () => {
  it("converts Plaid floats to integer cents without float drift", () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(-12.345)).toBe(-1234);
    expect(toCents(1234.56)).toBe(123456);
  });
  it("formats cents", () => {
    expect(formatCents(123456)).toBe("$1,234.56");
    expect(formatCents(-500)).toBe("-$5.00");
  });
  it("keeps cents when filling an edit field", () => {
    expect(centsToInput(150_00)).toBe("150");
    expect(centsToInput(150_50)).toBe("150.50");
    expect(centsToInput(5)).toBe("0.05");
  });
});

describe("normalizeMerchant", () => {
  it.each([
    ["SQ *BLUE BOTTLE COFFEE #123", "blue bottle coffee"],
    ["TST* Blue Bottle Coffee", "blue bottle coffee"],
    ["PAYPAL *NETFLIX.COM", "netflix"],
    ["UBER   *EATS 8005928996", "uber eats"],
  ])("%s → %s", (raw, expected) => {
    expect(normalizeMerchant(raw)).toBe(expected);
  });

  it("prefers Plaid's merchant name", () => {
    expect(merchantKey("Starbucks", "STARBUCKS STORE 12345 SEATTLE WA")).toBe("starbucks");
    expect(merchantKey(null, "STARBUCKS STORE 12345")).toBe("starbucks store");
  });
});

describe("mapPfcToSlug", () => {
  it("maps only VERY_HIGH confidence", () => {
    expect(mapPfcToSlug({ detailed: "FOOD_AND_DRINK_GROCERIES", confidence_level: "VERY_HIGH" })).toBe("groceries");
    expect(mapPfcToSlug({ detailed: "FOOD_AND_DRINK_GROCERIES", confidence_level: "HIGH" })).toBeNull();
    expect(mapPfcToSlug({ detailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT", confidence_level: "VERY_HIGH" })).toBe(
      "payments_transfers",
    );
    expect(mapPfcToSlug({ detailed: "GENERAL_MERCHANDISE_OTHER", confidence_level: "VERY_HIGH" })).toBeNull();
    expect(mapPfcToSlug(null)).toBeNull();
  });
});

describe("groupByDate", () => {
  it("makes one group per date, newest first, even from unsorted rows", async () => {
    const { groupByDate } = await import("@/lib/views/dates");
    const groups = groupByDate([
      { date: "2026-09-03", id: 1 },
      { date: "2026-09-04", id: 2 },
      { date: "2026-09-03", id: 3 },
    ]);
    expect(groups.map((g) => [g.date, g.rows.map((r) => r.id)])).toEqual([
      ["2026-09-04", [2]],
      ["2026-09-03", [1, 3]],
    ]);
  });
});

describe("matchesSearch", () => {
  it("matches names, descriptors and exact amounts", async () => {
    const { matchesSearch } = await import("@/lib/views/data");
    const r = { merchant: "Netflix", description: "NETFLIX.COM 866-579", amountCents: 15_49 };
    expect(matchesSearch(r, "netf")).toBe(true);
    expect(matchesSearch(r, "866")).toBe(true);
    expect(matchesSearch(r, "15.49")).toBe(true);
    expect(matchesSearch(r, "$15.49")).toBe(true);
    expect(matchesSearch({ ...r, amountCents: -15_49 }, "15.49")).toBe(true); // refunds too
    expect(matchesSearch(r, "15.50")).toBe(false);
    expect(matchesSearch(r, "hulu")).toBe(false);
  });
});
