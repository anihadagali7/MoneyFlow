"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowUpIcon, Loader2Icon, RotateCcwIcon, SparklesIcon } from "lucide-react";
import { askQuestion } from "@/actions/ask";
import { answeredTurns } from "@/lib/ask/turns";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export type Message =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; steps: string[] }
  | { role: "error"; text: string; question: string };

const SUGGESTIONS = [
  "How much did I spend on dining last month?",
  "What were my biggest purchases this month?",
  "How does this month's spending compare to last month?",
  "What subscriptions am I paying for?",
  "What was my income and net this year?",
  "Where do I spend the most money?",
];

/**
 * A conversation about the user's own data. It lives only in this component: nothing is
 * saved, and leaving the page starts fresh.
 */
export function AskChat({
  initialMessages = [],
}: {
  /** Only for the dev preview page. */ initialMessages?: Message[];
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pending]);

  function send(question: string, retry = false) {
    const q = question.trim();
    if (q.length < 2 || pending) return;
    const shown = messages.filter((m): m is Exclude<Message, { role: "error" }> => m.role !== "error");
    // Retrying replaces the question that failed instead of showing it twice.
    if (retry && shown.at(-1)?.role === "user") shown.pop();
    const history = answeredTurns(shown)
      .slice(-12)
      .map((m) => ({ role: m.role, text: m.text.slice(0, 4000) }));
    setMessages([...shown, { role: "user", text: q }]);
    setDraft("");
    start(async () => {
      const result = await askQuestion({ question: q, history }).catch(() => null);
      setMessages((all) => [
        ...all,
        result?.ok
          ? { role: "assistant", text: result.answer, steps: result.steps }
          : { role: "error", text: result?.error ?? "Couldn't reach MoneyFlow. Check your connection.", question: q },
      ]);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {messages.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-muted">
            <SparklesIcon className="size-5" />
          </span>
          <div>
            <div className="text-lg font-semibold">Ask about your money</div>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Questions about your spending, income, budgets, subscriptions, trips and goals.
            </p>
          </div>
          <div className="grid w-full max-w-xl gap-2 sm:grid-cols-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                className="rounded-xl border bg-card px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/60"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3" aria-live="polite">
          {messages.map((m, i) => (
            <MessageBubble key={i} message={m} onRetry={(q) => send(q, true)} />
          ))}
          {pending && (
            <div className="flex items-center gap-2 self-start rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" /> Looking at your data…
            </div>
          )}
        </div>
      )}
      <div ref={end} />

      <form
        className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-10 flex flex-col gap-1.5 bg-background/90 pt-2 pb-1 backdrop-blur-lg md:bottom-4"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <div className="flex items-end gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(draft);
              }
            }}
            placeholder="Ask about your money…"
            aria-label="Your question"
            maxLength={500}
            rows={1}
            className="max-h-32 min-h-11 resize-none bg-card"
          />
          <Button
            type="submit"
            size="icon"
            className="size-11 shrink-0"
            disabled={pending || draft.trim().length < 2}
            aria-label="Ask"
          >
            <ArrowUpIcon />
          </Button>
        </div>
        <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
          <span>
            Uses only your MoneyFlow data. Your question and the numbers needed go to Anthropic&apos;s Claude; chats
            aren&apos;t saved.
          </span>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => setMessages([])}
              disabled={pending}
              className="flex shrink-0 items-center gap-1 underline-offset-4 hover:underline"
            >
              <RotateCcwIcon className="size-3" /> New chat
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function MessageBubble({ message: m, onRetry }: { message: Message; onRetry: (q: string) => void }) {
  if (m.role === "user") {
    return (
      <div className="max-w-[85%] self-end rounded-2xl bg-primary px-4 py-2.5 text-sm whitespace-pre-wrap text-primary-foreground">
        {m.text}
      </div>
    );
  }
  if (m.role === "error") {
    return (
      <div
        className="max-w-[85%] self-start rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive"
        role="alert"
      >
        {m.text}{" "}
        <button type="button" onClick={() => onRetry(m.question)} className="font-medium underline underline-offset-4">
          Try again
        </button>
      </div>
    );
  }
  return (
    <div className="max-w-[92%] self-start rounded-2xl bg-muted px-4 py-3 text-sm">
      <AnswerText text={m.text} />
      {m.steps.length > 0 && (
        <div className="mt-2 border-t border-foreground/10 pt-2 text-xs text-muted-foreground">
          Looked at: {m.steps.join(" · ")}
        </div>
      )}
    </div>
  );
}

/** Plain text with "- " bullet lists; any markdown emphasis the model adds is dropped. */
export function AnswerText({ text }: { text: string }) {
  const blocks: Array<{ list: boolean; lines: string[] }> = [];
  for (const raw of text.replace(/\*\*|__/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = /^[-•*]\s+/.test(line);
    const last = blocks.at(-1);
    if (last && last.list === bullet && bullet) last.lines.push(line.replace(/^[-•*]\s+/, ""));
    else blocks.push({ list: bullet, lines: [bullet ? line.replace(/^[-•*]\s+/, "") : line] });
  }
  return (
    <div className="flex flex-col gap-2">
      {blocks.map((b, i) =>
        b.list ? (
          <ul key={i} className="list-disc space-y-1 pl-5">
            {b.lines.map((l, j) => (
              <li key={j}>{l}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>{b.lines[0]}</p>
        ),
      )}
    </div>
  );
}
