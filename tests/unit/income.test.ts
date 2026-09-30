import { describe, expect, it } from "vitest";
import { incomeByMonth, occurrences, type IncomeSourceInput } from "@/lib/reports/income";

const src = (o: Partial<IncomeSourceInput>): IncomeSourceInput => ({
  amountCents: 100_00,
  frequency: "monthly",
  anchorDate: "2026-01-15",
  endDate: null,
  ...o,
});

describe("occurrences", () => {
  it("biweekly gives three paychecks in some months", () => {
    const s = src({ frequency: "biweekly", anchorDate: "2026-01-02" });
    expect(occurrences(s, "2026-01-01", "2026-02-01")).toEqual(["2026-01-02", "2026-01-16", "2026-01-30"]);
    expect(occurrences(s, "2026-02-01", "2026-03-01")).toEqual(["2026-02-13", "2026-02-27"]);
  });

  it("weekly steps from the anchor even when the range starts later", () => {
    const s = src({ frequency: "weekly", anchorDate: "2026-01-05" });
    expect(occurrences(s, "2026-03-01", "2026-03-15")).toEqual(["2026-03-02", "2026-03-09"]);
  });

  it("monthly clamps to the end of short months", () => {
    const s = src({ anchorDate: "2026-01-31" });
    expect(occurrences(s, "2026-02-01", "2026-05-01")).toEqual(["2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("semimonthly pays on the anchor day and 15 days apart", () => {
    expect(occurrences(src({ frequency: "semimonthly", anchorDate: "2026-01-01" }), "2026-02-01", "2026-03-01")).toEqual([
      "2026-02-01",
      "2026-02-16",
    ]);
    expect(occurrences(src({ frequency: "semimonthly", anchorDate: "2026-01-30" }), "2026-02-01", "2026-03-01")).toEqual([
      "2026-02-15",
      "2026-02-28",
    ]);
  });

  it("annually pays once a year on the anchor month", () => {
    const s = src({ frequency: "annually", anchorDate: "2025-03-15" });
    expect(occurrences(s, "2026-01-01", "2027-01-01")).toEqual(["2026-03-15"]);
  });

  it("respects the start (anchor) and inclusive end date", () => {
    const s = src({ anchorDate: "2026-03-15", endDate: "2026-05-15" });
    expect(occurrences(s, "2026-01-01", "2027-01-01")).toEqual(["2026-03-15", "2026-04-15", "2026-05-15"]);
  });

  it("handles leap years", () => {
    expect(occurrences(src({ anchorDate: "2027-01-29" }), "2028-02-01", "2028-03-01")).toEqual(["2028-02-29"]);
  });
});

describe("incomeByMonth", () => {
  it("sums recurring and one-off income per month", () => {
    const totals = incomeByMonth(
      [src({ frequency: "biweekly", anchorDate: "2026-01-02", amountCents: 2000_00 })],
      [
        { amountCents: 500_00, receivedOn: "2026-01-20" },
        { amountCents: 999_00, receivedOn: "2026-03-01" }, // outside range
      ],
      "2026-01-01",
      "2026-03-01",
    );
    expect(Object.fromEntries(totals)).toEqual({ "2026-01": 6500_00, "2026-02": 4000_00 });
  });
});
