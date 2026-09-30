import { describe, expect, it } from "vitest";
import { homeCity, suggestTrips, tripBookings, tripTransactions, type TripCandidate } from "@/lib/trips/detect";

let n = 0;
const t = (date: string, city: string | null, slug: string | null = "dining", amountCents = 40_00): TripCandidate => ({
  id: `t${n++}`,
  date,
  city,
  slug,
  amountCents,
});

// A month at home in Brooklyn with a Chicago trip Sep 3–6.
const home = ["2026-08-01", "2026-08-05", "2026-08-12", "2026-08-20", "2026-09-10", "2026-09-15"].map((d) => t(d, "Brooklyn", "groceries"));
const flight = t("2026-07-20", null, "travel_flights", 320_00); // booked online 6 weeks before
const hotel = t("2026-09-03", null, "travel_lodging", 612_00); // charged at check-in, online
const chicago = [
  t("2026-09-03", "Chicago"),
  t("2026-09-04", "chicago ", "coffee", 6_50),
  t("2026-09-05", "Chicago"),
  t("2026-09-06", "Chicago", "transport_rideshare", 28_00),
];
const netflixDuringTrip = t("2026-09-04", null, "subscriptions_streaming", 17_99);
const all = [...home, flight, hotel, ...chicago, netflixDuringTrip];
const none = { existing: [], dismissed: new Set<string>(), taggedIds: new Set<string>() };

describe("homeCity", () => {
  it("is where most in-person spending happens", () => {
    expect(homeCity(all)).toBe("brooklyn");
    expect(homeCity([t("2026-01-01", null)])).toBeNull();
  });
});

describe("suggestTrips", () => {
  it("finds the trip, its hotel, and the flight booked weeks earlier, but not home spending", () => {
    const [trip, ...rest] = suggestTrips(all, none);
    expect(rest).toHaveLength(0);
    expect(trip).toMatchObject({ city: "Chicago", startsOn: "2026-09-03", endsOn: "2026-09-06", key: "2026-09-03:chicago" });
    expect(new Set(trip.transactionIds)).toEqual(new Set([...chicago.map((c) => c.id), hotel.id]));
    expect(trip.bookingIds).toEqual([flight.id]);
    expect(trip.totalCents).toBe(40_00 + 6_50 + 40_00 + 28_00 + 612_00 + 320_00);
  });

  it("ignores a day out and tiny clusters", () => {
    const dayTrip = [t("2026-06-01", "Newark"), t("2026-06-01", "Newark"), t("2026-06-01", "Newark")];
    const tooFew = [t("2026-05-01", "Boston"), t("2026-05-02", "Boston")];
    expect(suggestTrips([...home, ...dayTrip, ...tooFew], none)).toEqual([]);
  });

  it("splits trips separated by more than 3 days", () => {
    const trips = suggestTrips(
      [...home, ...["2026-03-01", "2026-03-02", "2026-03-03"].map((d) => t(d, "Miami")), ...["2026-03-10", "2026-03-11", "2026-03-12"].map((d) => t(d, "Austin"))],
      none,
    );
    expect(trips.map((s) => s.city)).toEqual(["Austin", "Miami"]);
  });

  it("skips trips that overlap existing ones, were dismissed, or are already tagged", () => {
    expect(suggestTrips(all, { ...none, existing: [{ startsOn: "2026-09-05", endsOn: "2026-09-08" }] })).toEqual([]);
    expect(suggestTrips(all, { ...none, dismissed: new Set(["2026-09-03:chicago"]) })).toEqual([]);
    expect(suggestTrips(all, { ...none, taggedIds: new Set(chicago.map((c) => c.id)) })).toEqual([]);
  });
});

describe("manual trips", () => {
  it("picks travel and away-from-home charges in the window, not streaming at home", () => {
    const ids = tripTransactions(all, "brooklyn", { startsOn: "2026-09-02", endsOn: "2026-09-07" });
    expect(ids).toContain(hotel.id);
    expect(ids).not.toContain(netflixDuringTrip.id);
    expect(tripBookings(all, "2026-09-03", new Set())).toEqual([flight.id]);
  });
});
