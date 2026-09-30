import Link from "next/link";
import { ChevronLeftIcon, PlaneIcon } from "lucide-react";
import { BarList } from "@/components/charts/bar-list";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatTile } from "@/components/stat-tile";
import { TxnList } from "@/components/transactions/txn-list";
import { AddTransactionsButton, RemoveFromTrip, TripMenu } from "@/components/trips/trip-controls";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCents } from "@/lib/money";
import type { TripDetail } from "@/lib/trips";
import { dateRange } from "./trips-view";

export function TripDetailView({ data, today }: { data: TripDetail; today: string }) {
  const { trip } = data;
  return (
    <>
      <Link
        href="/trips"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeftIcon className="size-4" /> Trips
      </Link>
      <PageHeader
        title={trip.name}
        description={`${dateRange(trip.startsOn, trip.endsOn)} · ${trip.days} day${trip.days === 1 ? "" : "s"}`}
        actions={
          <>
            <AddTransactionsButton tripId={trip.id} candidates={data.addable} />
            <TripMenu id={trip.id} fields={{ name: trip.name, startsOn: trip.startsOn, endsOn: trip.endsOn }} />
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatTile
          label="Total"
          value={formatCents(trip.totalCents)}
          hint={`${trip.count} charge${trip.count === 1 ? "" : "s"}`}
        />
        <StatTile
          label="Per day"
          value={formatCents(Math.round(trip.totalCents / trip.days))}
          hint="Including flights and hotels"
        />
        <StatTile
          className="col-span-2 lg:col-span-1"
          label="Biggest cost"
          value={trip.categories[0] ? formatCents(trip.categories[0].cents) : "—"}
          hint={trip.categories[0]?.name ?? "Nothing on this trip yet"}
        />
      </div>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>By category</CardTitle>
            <CardDescription>Refunds are netted out</CardDescription>
          </CardHeader>
          <CardContent>
            <BarList
              total={trip.totalCents}
              empty="Add transactions to see the breakdown."
              items={trip.categories.map((c) => ({ key: c.slug, label: c.name, cents: c.cents }))}
            />
          </CardContent>
        </Card>
        <Card className="gap-0 overflow-visible pb-0 lg:col-span-3">
          <CardHeader className="pb-4">
            <CardTitle>Transactions</CardTitle>
            <CardDescription>Remove anything that wasn&apos;t part of the trip</CardDescription>
          </CardHeader>
          {data.rows.length === 0 ? (
            <EmptyState icon={PlaneIcon} title="No transactions yet" description="Use Add transactions to pick them." />
          ) : (
            <TxnList
              rows={data.rows}
              today={today}
              subtitle="category"
              trailingOnPhones
              trailing={(r) => <RemoveFromTrip tripId={trip.id} row={r} />}
            />
          )}
        </Card>
      </div>
    </>
  );
}
