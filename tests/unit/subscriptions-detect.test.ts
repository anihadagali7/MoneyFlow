import { describe, expect, it } from "vitest";
import { addMonths, detectPattern, isActive, priceIncrease, type Charge } from "@/lib/subscriptions/detect";

const monthly = (dates: string[], cents = 15_49): Charge[] => dates.map((date) => ({ date, amountCents: cents }));

describe("detectPattern", () => {
  it("finds a monthly subscription and predicts the next charge", () => {
    const p = detectPattern(monthly(["2026-06-03", "2026-07-03", "2026-08-03", "2026-09-03"]));
    expect(p).toMatchObject({ frequency: "monthly", occurrences: 4, lastDate: "2026-09-03", nextDate: "2026-10-03", monthlyCents: 15_49 });
  });

  it("handles month-end billing and a skipped month", () => {
    expect(detectPattern(monthly(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]))?.frequency).toBe("monthly");
    // One gap of ~2 months among 5 intervals still reads as monthly.
    expect(detectPattern(monthly(["2026-01-05", "2026-02-05", "2026-03-05", "2026-05-05", "2026-06-05", "2026-07-05"]))?.frequency).toBe(
      "monthly",
    );
  });

  it("detects a price increase", () => {
    const p = detectPattern([...monthly(["2026-05-10", "2026-06-10", "2026-07-10", "2026-08-10"], 15_49), { date: "2026-09-10", amountCents: 17_99 }]);
    expect(p).toMatchObject({ lastAmountCents: 17_99, prevAmountCents: 15_49 });
    expect(priceIncrease(p!)).toBe(2_50);
    expect(priceIncrease({ lastAmountCents: 15_49, prevAmountCents: 15_49 })).toBeNull();
    expect(priceIncrease({ lastAmountCents: 15_59, prevAmountCents: 15_49 })).toBeNull(); // under 50¢
  });

  it("finds yearly and weekly charges with enough history", () => {
    expect(detectPattern(monthly(["2024-03-15", "2025-03-15", "2026-03-15"], 139_00))).toMatchObject({
      frequency: "annually",
      nextDate: "2027-03-15",
      monthlyCents: Math.round(139_00 / 12),
    });
    const weeks = Array.from({ length: 8 }, (_, i) => ({ date: new Date(Date.UTC(2026, 6, 1 + i * 7)).toISOString().slice(0, 10), amountCents: 9_99 }));
    expect(detectPattern(weeks)?.frequency).toBe("weekly");
  });

  it("allows utility bills that vary a little", () => {
    const bills = [98_20, 104_75, 91_10, 110_40].map((amountCents, i) => ({ date: addMonths("2026-05-18", i), amountCents }));
    expect(detectPattern(bills)?.frequency).toBe("monthly");
  });

  it("ignores a regular coffee shop or grocery run with varying amounts", () => {
    const coffee = Array.from({ length: 10 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 6, 1 + i * 7)).toISOString().slice(0, 10),
      amountCents: [6_75, 11_20, 4_50, 13_80, 7_25][i % 5],
    }));
    expect(detectPattern(coffee)).toBeNull();
  });

  it("ignores irregular merchants and too little history", () => {
    expect(detectPattern(monthly(["2026-01-03", "2026-01-20", "2026-03-11", "2026-03-15", "2026-06-30"]))).toBeNull();
    expect(detectPattern(monthly(["2026-08-03", "2026-09-03"]))).toBeNull(); // 2 monthly charges isn't enough
    expect(detectPattern([])).toBeNull();
  });

  it("ignores refunds and collapses same-day duplicates", () => {
    const p = detectPattern([
      ...monthly(["2026-06-03", "2026-07-03", "2026-08-03"]),
      { date: "2026-08-03", amountCents: 15_49 },
      { date: "2026-08-10", amountCents: -15_49 },
    ]);
    expect(p).toMatchObject({ occurrences: 3 });
  });
});

describe("isActive", () => {
  it("treats a charge as stopped after half a cycle plus a few days", () => {
    const p = { frequency: "monthly" as const, nextDate: "2026-09-03" };
    expect(isActive(p, "2026-09-20")).toBe(true); // 17 days late, grace is 20
    expect(isActive(p, "2026-09-24")).toBe(false);
  });
});

describe("addMonths", () => {
  it("clamps to month end", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
  });
});
