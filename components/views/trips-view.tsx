import Link from "next/link";
import { ChevronRightIcon, MapPinIcon, PlaneIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { NewTripButton, SuggestionActions } from "@/components/trips/trip-controls";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCents } from "@/lib/money";
import type { TripsData } from "@/lib/trips";
import { shortDate } from "@/lib/views/dates";

export function dateRange(start: string, end: string) {
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  const year = end.slice(0, 4);
  return start === end
    ? `${shortDate(start)}, ${year}`
    : `${shortDate(start)} – ${shortDate(end)}${sameYear ? `, ${year}` : ""}`;
}

export function TripsView({ data, today }: { data: TripsData; today: string }) {
  return (
    <>
      <PageHeader
        title="Trips"
        description="What each trip really cost, flights to coffee"
        actions={<NewTripButton today={today} />}
      />

      {data.suggestions.length > 0 && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Looks like you traveled</CardTitle>
            <CardDescription>Spending away from home. Create a trip to track it, or dismiss.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {data.suggestions.map((s) => (
                <li key={s.key} className="flex flex-wrap items-center gap-3 py-3">
                  <MapPinIcon className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{s.city}</div>
                    <div className="text-xs text-muted-foreground">
                      {dateRange(s.startsOn, s.endsOn)} · {s.transactionIds.length + s.bookingIds.length} charges ·{" "}
                      {formatCents(s.totalCents)}
                    </div>
                  </div>
                  <SuggestionActions suggestion={s} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {data.trips.length === 0 ? (
        <Card>
          <EmptyState
            icon={PlaneIcon}
            title="No trips yet"
            description="Create a trip with its dates and MoneyFlow gathers the flights, hotels, meals and rides, so you see what it really cost. Trips are also suggested automatically when you spend away from home."
            action={<NewTripButton today={today} variant="outline" />}
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {data.trips.map((t) => (
            <Link key={t.id} href={`/trips/${t.id}`}>
              <Card className="gap-3 p-5 transition-colors hover:bg-muted/40">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{t.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {dateRange(t.startsOn, t.endsOn)} · {t.days} day{t.days === 1 ? "" : "s"}
                    </div>
                  </div>
                  <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
                </div>
                <div className="text-2xl font-semibold tracking-tight">{formatCents(t.totalCents)}</div>
                <div className="flex flex-wrap gap-1.5">
                  {t.categories.slice(0, 3).map((c) => (
                    <span key={c.slug} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {c.name} {formatCents(c.cents)}
                    </span>
                  ))}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
