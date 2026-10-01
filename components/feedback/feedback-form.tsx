"use client";

import { useState, useTransition } from "react";
import { BugIcon, CheckCircle2Icon, LightbulbIcon, MessageCircleIcon } from "lucide-react";
import { submitFeedback } from "@/actions/feedback";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  FEEDBACK_AREAS,
  FEEDBACK_KINDS,
  formatDetails,
  type FeedbackArea,
  type FeedbackDetails,
  type FeedbackKind,
} from "@/lib/feedback";
import { cn } from "@/lib/utils";
import { collectDetails } from "./error-log";

const KIND_ICON = { bug: BugIcon, feature: LightbulbIcon, other: MessageCircleIcon } as const;
const PLACEHOLDER: Record<FeedbackKind, { title: string; description: string }> = {
  bug: {
    title: "e.g. Chase import shows the wrong dates",
    description: "What happened, and what did you expect? Steps to make it happen again help a lot.",
  },
  feature: {
    title: "e.g. Split a transaction between categories",
    description: "What would you like to do, and why would it help?",
  },
  other: { title: "Summary", description: "Tell us what's on your mind." },
};

export function FeedbackForm({
  initialKind = "bug",
  initialArea = "other",
  from = "",
  digest,
}: {
  initialKind?: FeedbackKind;
  initialArea?: FeedbackArea;
  /** The page the user came from (e.g. the error screen). */
  from?: string;
  digest?: string;
}) {
  const [kind, setKind] = useState<FeedbackKind>(initialKind);
  const [area, setArea] = useState<FeedbackArea>(initialArea);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [withDetails, setWithDetails] = useState(initialKind === "bug");
  const [details, setDetails] = useState<FeedbackDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ issue: number; url: string | null } | null>(null);
  const [pending, start] = useTransition();

  // Read from the browser when needed (sending, or opening the preview), never during render.
  const currentDetails = () => {
    const d = collectDetails(from || window.location.pathname);
    if (digest && !d.errors?.some((e) => e.digest === digest)) {
      d.errors = [...(d.errors ?? []), { at: "this page", message: "Error screen shown", digest }];
    }
    return d;
  };

  if (sent !== null) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
          <CheckCircle2Icon className="size-8 text-status-good" />
          <div className="text-lg font-semibold">Thanks, that&apos;s sent</div>
          <p className="max-w-sm text-sm text-muted-foreground">
            It&apos;s filed as{" "}
            {sent.url ? (
              <a href={sent.url} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                issue #{sent.issue}
              </a>
            ) : (
              `#${sent.issue}`
            )}{" "}
            on GitHub, where you can follow it.
            {kind === "bug" ? " If it keeps happening, sending it again with new details helps." : ""}
          </p>
          <Button
            variant="outline"
            className="mt-2"
            onClick={() => {
              setSent(null);
              setTitle("");
              setDescription("");
            }}
          >
            Send something else
          </Button>
        </CardContent>
      </Card>
    );
  }

  const areaItems = Object.entries(FEEDBACK_AREAS).map(([value, label]) => ({ value, label }));

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const result = await submitFeedback({
            kind,
            area,
            title,
            description,
            details: withDetails ? currentDetails() : null,
          });
          if (result.ok) setSent({ issue: result.issue, url: result.url });
          else setError(result.error);
        });
      }}
    >
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Kind of feedback">
        {(Object.keys(FEEDBACK_KINDS) as FeedbackKind[]).map((k) => {
          const Icon = KIND_ICON[k];
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => {
                setKind(k);
                setWithDetails(k === "bug");
              }}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-xl border bg-card p-3 text-center transition-colors hover:bg-muted/60 sm:flex-row sm:items-start sm:gap-3 sm:text-left",
                kind === k && "border-primary ring-2 ring-primary/20",
              )}
            >
              <Icon className="size-4 shrink-0 sm:mt-0.5" />
              <span>
                <span className="block text-sm font-medium sm:hidden">{FEEDBACK_KINDS[k].short}</span>
                <span className="hidden text-sm font-medium sm:block">{FEEDBACK_KINDS[k].label}</span>
                <span className="hidden text-xs text-muted-foreground sm:block">{FEEDBACK_KINDS[k].hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="fb-area">Area</Label>
            <Select items={areaItems} value={area} onValueChange={(v) => setArea(v as FeedbackArea)}>
              <SelectTrigger id="fb-area" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {areaItems.map((i) => (
                  <SelectItem key={i.value} value={i.value}>
                    {i.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="fb-title">Summary</Label>
            <Input
              id="fb-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={PLACEHOLDER[kind].title}
              maxLength={120}
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="fb-description">Details</Label>
            <Textarea
              id="fb-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={PLACEHOLDER[kind].description}
              maxLength={4000}
              className="min-h-32"
            />
          </div>

          <div className="rounded-xl bg-muted/60 p-3">
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>
                Include technical details
                <span className="block text-xs text-muted-foreground">
                  Page, app version, device and recent errors. No transactions, amounts or account info.
                </span>
              </span>
              <Switch checked={withDetails} onCheckedChange={setWithDetails} />
            </label>
            {withDetails && (
              <details
                className="mt-2 text-xs"
                onToggle={(e) => {
                  if (e.currentTarget.open) setDetails(currentDetails());
                }}
              >
                <summary className="cursor-pointer text-muted-foreground">See exactly what&apos;s sent</summary>
                <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-background p-2 break-all whitespace-pre-wrap">
                  {details ? formatDetails(details) : ""}
                </pre>
              </details>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Posted as a <strong className="font-medium text-foreground">public</strong> issue on MoneyFlow&apos;s
            GitHub, without your name or email. Emails and long numbers are removed automatically; leave out anything
            else you wouldn&apos;t want others to see.
          </p>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" disabled={pending || title.trim().length < 3} className="self-end">
            {pending ? "Sending…" : "Send"}
          </Button>
        </CardContent>
      </Card>
    </form>
  );
}
