import { describe, expect, it } from "vitest";
import { computeGoalProgress, contributionPace } from "@/lib/goals/progress";

const base = { savedCents: 1000_00, targetCents: 5000_00, targetDate: "2027-06-01", today: "2026-09-30", paceCents: null };

describe("computeGoalProgress", () => {
  it("works out what's needed per month to hit the date", () => {
    const p = computeGoalProgress(base);
    expect(p).toMatchObject({ pct: 0.2, remainingCents: 4000_00, reached: false, overdue: false });
    // ~8 months left → about $500/month
    expect(p.neededPerMonthCents).toBeGreaterThan(490_00);
    expect(p.neededPerMonthCents).toBeLessThan(510_00);
  });

  it("is on track when the pace covers what's needed, and projects a finish date", () => {
    expect(computeGoalProgress({ ...base, paceCents: 600_00 })).toMatchObject({ status: "on_track" });
    const behind = computeGoalProgress({ ...base, paceCents: 200_00 });
    expect(behind.status).toBe("behind");
    expect(behind.projectedDate).toBe("2028-05-31"); // 20 months at $200 (609 days)
  });

  it("handles reached, no date and overdue goals", () => {
    expect(computeGoalProgress({ ...base, savedCents: 5200_00 })).toMatchObject({ reached: true, pct: 1, remainingCents: 0, status: "reached", neededPerMonthCents: null });
    expect(computeGoalProgress({ ...base, targetDate: null })).toMatchObject({ status: "no_date", neededPerMonthCents: null });
    expect(computeGoalProgress({ ...base, targetDate: "2026-08-01" })).toMatchObject({ overdue: true, status: "behind" });
  });

  it("needs the whole remainder within the final month", () => {
    expect(computeGoalProgress({ ...base, targetDate: "2026-10-10" }).neededPerMonthCents).toBe(4000_00);
  });
});

describe("contributionPace", () => {
  it("averages the last 90 days per month, withdrawals included", () => {
    const pace = contributionPace(
      [
        { amountCents: 300_00, date: "2026-09-15" },
        { amountCents: 300_00, date: "2026-08-15" },
        { amountCents: 300_00, date: "2026-07-15" },
        { amountCents: -100_00, date: "2026-09-20" },
        { amountCents: 5000_00, date: "2026-01-01" }, // too old
      ],
      "2026-09-30",
    );
    expect(pace).toBe(Math.round((800_00 / 90) * 30.44));
  });
});
