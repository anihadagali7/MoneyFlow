"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { AlertCircleIcon, CheckCircle2Icon, FileUpIcon, Loader2Icon } from "lucide-react";
import { importCsv, previewCsvImport, type PreviewResult } from "@/actions/import";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { TxnAmount } from "@/components/money";
import { formatCents } from "@/lib/money";
import { shortDate } from "@/lib/views/dates";

type Preview = Extract<PreviewResult, { ok: true }>;

/** Import older transactions for one account from a bank CSV: choose file → preview → import. */
export function ImportDialog({
  accountId,
  label,
  bank,
  open,
  onOpenChange,
  initialPreview = null,
  initialDone = null,
}: {
  accountId: string;
  label: string;
  bank: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Only for the dev preview page, to review the preview and result steps' layout. */
  initialPreview?: Preview | null;
  initialDone?: { imported: number; from: string; to: string; fileName: string | null } | null;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [flip, setFlip] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(initialPreview);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState<{ imported: number; from: string; to: string; fileName: string | null } | null>(
    initialDone,
  );

  const range = (from: string, to: string) =>
    `${shortDate(from)}, ${from.slice(0, 4)} – ${shortDate(to)}, ${to.slice(0, 4)}`;

  // Start fresh each time it opens (not on close, which would flash the first step as it slides away).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open && done) reset();
  }

  function reset() {
    setPreview(null);
    setFileName(null);
    setText(null);
    setDone(null);
    setError(null);
  }

  function runImport(p: Preview) {
    setError(null);
    setImporting(true);
    startTransition(async () => {
      try {
        const result = await importCsv(accountId, text!, flip);
        if (!result.ok) return setError(result.error);
        setDone({ imported: result.imported, from: p.from, to: p.to, fileName });
        setPreview(null);
      } catch {
        setError(
          "Couldn't confirm the import finished. Check this account on the Accounts page; importing the same file again won't add duplicates.",
        );
      } finally {
        setImporting(false);
      }
    });
  }

  function load(content: string, flipSign: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await previewCsvImport(accountId, content, flipSign);
      if (result.ok) setPreview(result);
      else {
        setPreview(null);
        setError(result.error);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (importing) return; // don't lose track of an import mid-way
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import older transactions</DialogTitle>
          <DialogDescription>
            {label}. Plaid only gets the history {bank} shares, often about 90 days. A CSV from {bank}&apos;s website
            fills in the rest.
          </DialogDescription>
        </DialogHeader>

        {done && (
          <div className="flex flex-col items-center gap-2 rounded-xl bg-muted/60 p-5 text-center text-sm">
            <CheckCircle2Icon className="size-8 text-status-good" />
            <div className="text-lg font-semibold">
              Imported {done.imported} transaction{done.imported === 1 ? "" : "s"}
            </div>
            <div className="text-muted-foreground">
              {done.fileName && <span className="block break-all">{done.fileName}</span>}
              {range(done.from, done.to)}
            </div>
            <p className="text-xs text-muted-foreground">
              Categories are being filled in now and usually finish within a minute. The Accounts page shows the
              progress.
            </p>
          </div>
        )}

        {!preview && !done && (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 text-sm">
            <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>On {bank}&apos;s website, open this account&apos;s transactions.</li>
              <li>Choose Download, pick a date range and the CSV format.</li>
              <li>Pick the file below. On iPhone it&apos;s in Files → Downloads.</li>
            </ol>
            <input
              ref={input}
              type="file"
              accept=".csv,text/csv,text/comma-separated-values,application/vnd.ms-excel"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 1_500_000) return setError("That file is too large. Download a shorter date range.");
                const content = await file.text();
                setFileName(file.name);
                setText(content);
                load(content, flip);
              }}
            />
            <Button variant="outline" className="h-14" disabled={pending} onClick={() => input.current?.click()}>
              <FileUpIcon /> {pending ? "Reading…" : (fileName ?? "Choose CSV file")}
            </Button>
          </div>
        )}

        {preview && (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 text-sm">
            <div className="rounded-xl bg-muted/60 p-4">
              <div className="text-2xl font-semibold">
                {preview.newCount} new transaction{preview.newCount === 1 ? "" : "s"}
              </div>
              {preview.newCount > 0 && (
                <div className="mt-1 text-muted-foreground">
                  {range(preview.from, preview.to)} · {formatCents(preview.spentCents)} spent
                </div>
              )}
              <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                {preview.alreadySynced > 0 && preview.syncedFrom && (
                  <li>
                    {preview.alreadySynced} from {shortDate(preview.syncedFrom)}, {preview.syncedFrom.slice(0, 4)}{" "}
                    onward are skipped: your {bank} connection already has that period.
                  </li>
                )}
                {preview.duplicates > 0 && <li>{preview.duplicates} already in MoneyFlow will be skipped.</li>}
                {preview.skipped > 0 && (
                  <li>
                    {preview.skipped} row{preview.skipped === 1 ? "" : "s"} couldn&apos;t be read.
                  </li>
                )}
                <li>Card payments and transfers aren&apos;t counted as spending.</li>
              </ul>
            </div>
            {preview.sample.length > 0 && (
              <ul className="divide-y rounded-xl border">
                {preview.sample.map((r, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate">{r.description}</span>
                      <span className="block text-xs text-muted-foreground">{shortDate(r.date)}</span>
                    </span>
                    <TxnAmount cents={r.amountCents} className="shrink-0" />
                  </li>
                ))}
              </ul>
            )}
            {preview.format === "single" && (
              <label className="flex items-center justify-between gap-3 rounded-xl bg-muted/60 px-4 py-3">
                <span>
                  Purchases look like refunds?
                  <span className="block text-xs text-muted-foreground">Flip if spending shows as +green above</span>
                </span>
                <Switch
                  checked={flip}
                  onCheckedChange={(v) => {
                    setFlip(v);
                    if (text) load(text, v);
                  }}
                />
              </label>
            )}
          </div>
        )}

        {importing && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2Icon className="size-4 shrink-0 animate-spin" />
            Importing {preview?.newCount} transactions. Keep this open, it takes a few seconds.
          </p>
        )}

        {error && (
          <p className="flex gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive" role="alert">
            <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        )}

        <DialogFooter>
          {done ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Done
              </Button>
              <Link
                href={`/transactions?card=${accountId}&month=${done.to.slice(0, 7)}`}
                className={buttonVariants()}
                onClick={() => onOpenChange(false)}
              >
                View transactions
              </Link>
            </>
          ) : (
            <>
              <Button variant="outline" disabled={importing} onClick={() => (preview ? reset() : onOpenChange(false))}>
                {preview ? "Choose another file" : "Cancel"}
              </Button>
              {preview && (
                <Button disabled={pending || preview.newCount === 0} onClick={() => runImport(preview)}>
                  {importing && <Loader2Icon className="animate-spin" />}
                  {importing ? "Importing…" : `Import ${preview.newCount}`}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
