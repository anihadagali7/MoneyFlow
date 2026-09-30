import { describe, expect, it } from "vitest";
import { explainDeposits } from "@/lib/income/detect";
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

describe("todayIn", () => {
  it("uses the user's timezone, not the server's", async () => {
    const { todayIn } = await import("@/lib/time");
    // 9:30pm in New York on Sep 30 is already Oct 1 in UTC.
    const evening = new Date("2026-10-01T01:30:00Z");
    expect(todayIn("America/New_York", evening)).toEqual({ iso: "2026-09-30", month: { year: 2026, month: 9 } });
    expect(todayIn("UTC", evening).iso).toBe("2026-10-01");
    expect(todayIn("Not/AZone", evening).iso).toBe("2026-09-30"); // falls back to the default
  });

  it("adds years, clamping leap days", async () => {
    const { addYears } = await import("@/lib/time");
    expect(addYears("2028-02-29", 1)).toBe("2029-02-28");
    expect(addYears("2026-09-30", -1)).toBe("2025-09-30");
  });
});

describe("detectPaycheck", () => {
  it("recognizes every-2-weeks and twice-a-month pay", async () => {
    const { detectPaycheck } = await import("@/lib/income/detect");
    const biweekly = ["2026-07-03", "2026-07-17", "2026-07-31", "2026-08-14", "2026-08-28"].map((date) => ({ date, amountCents: 2861_54 }));
    expect(detectPaycheck(biweekly)).toMatchObject({ frequency: "biweekly", amountCents: 2861_54, lastDate: "2026-08-28" });
    const semi = ["2026-06-15", "2026-06-30", "2026-07-15", "2026-07-31", "2026-08-14", "2026-08-31"].map((date) => ({ date, amountCents: 3100_00 }));
    expect(detectPaycheck(semi)?.frequency).toBe("semimonthly");
    expect(detectPaycheck([{ date: "2026-08-01", amountCents: 500_00 }])).toBeNull();
    // Biweekly dates that happen to sit near two days of the month are still biweekly.
    const lookalike = ["2026-07-31", "2026-08-14", "2026-08-28", "2026-09-11"].map((date) => ({ date, amountCents: 2861_54 }));
    expect(detectPaycheck(lookalike)?.frequency).toBe("biweekly");
  });
});

describe("explainDeposits", () => {
  const dep = (date: string, amountCents = 2400_00) => ({ date, amountCents });

  it("says when there are too few paychecks to see a schedule", () => {
    expect(explainDeposits([dep("2026-09-11"), dep("2026-08-28"), dep("2026-08-14")])).toEqual({
      frequency: "biweekly",
      reason: "3 deposits so far; 4 needed to spot a schedule",
    });
  });

  it("says when deposits skip around", () => {
    const dates = ["2026-01-02", "2026-01-16", "2026-03-27", "2026-04-10", "2026-06-19", "2026-07-03"];
    expect(explainDeposits(dates.map((d) => dep(d))).reason).toBe(
      "Some deposits are off schedule (gaps or extra payments)",
    );
  });
});
