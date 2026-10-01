import type { Metadata } from "next";
import { FeedbackForm } from "@/components/feedback/feedback-form";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { FEEDBACK_KINDS, type FeedbackArea, type FeedbackKind } from "@/lib/feedback";

export const metadata: Metadata = { title: "Feedback" };

const AREA_FOR_PAGE: Record<string, FeedbackArea> = {
  dashboard: "dashboard",
  transactions: "transactions",
  budgets: "budgets",
  goals: "goals",
  subscriptions: "subscriptions",
  trips: "trips",
  reports: "reports",
  income: "income",
  accounts: "connections",
  settings: "account",
};

export default async function FeedbackPage({ searchParams }: PageProps<"/feedback">) {
  await requireUser();
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const kind = one(params.kind);
  // Only a same-site path is kept, e.g. "/income".
  const from = one(params.from)?.match(/^\/[\w/-]*$/)?.[0] ?? "";
  const digest = one(params.digest)?.match(/^[\w-]{1,40}$/)?.[0];
  return (
    <>
      <PageHeader title="Feedback" description="Report a problem or tell us what you'd like MoneyFlow to do" />
      <div className="max-w-2xl">
        <FeedbackForm
          initialKind={kind && kind in FEEDBACK_KINDS ? (kind as FeedbackKind) : undefined}
          initialArea={AREA_FOR_PAGE[from.split("/")[1] ?? ""]}
          from={from}
          digest={digest}
        />
      </div>
    </>
  );
}
