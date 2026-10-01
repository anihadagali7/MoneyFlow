import type { Metadata } from "next";
import { AskChat } from "@/components/ask/ask-chat";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Ask" };
// A question can take a few Claude calls plus queries.
export const maxDuration = 60;

export default async function AskPage() {
  await requireUser();
  return (
    <>
      <PageHeader title="Ask" description="Questions about your own MoneyFlow data" />
      <div className="mx-auto max-w-3xl">
        <AskChat />
      </div>
    </>
  );
}
