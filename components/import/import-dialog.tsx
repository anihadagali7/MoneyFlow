"use client";

import { useRef, useState, useTransition } from "react";
import { FileUpIcon } from "lucide-react";
import { toast } from "sonner";
import { importCsv, previewCsvImport, type PreviewResult } from "@/actions/import";
import { Button } from "@/components/ui/button";
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
}: {
  accountId: string;
  label: string;
  bank: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Only for the dev preview page, to review the preview step's layout. */
  initialPreview?: Preview | null;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [flip, setFlip] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(initialPreview);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import older transactions</DialogTitle>
          <DialogDescription>
            {label}. Plaid only gets the history {bank} shares, often about 90 days. A CSV from {bank}&apos;s website
            fills in the rest.
          </DialogDescription>
        </DialogHeader>

        {!preview && (
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
                  {shortDate(preview.from)}, {preview.from.slice(0, 4)} – {shortDate(preview.to)},{" "}
                  {preview.to.slice(0, 4)} · {formatCents(preview.spentCents)} spent
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

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              if (preview) {
                setPreview(null);
                setFileName(null);
                setText(null);
              } else onOpenChange(false);
            }}
          >
            {preview ? "Choose another file" : "Cancel"}
          </Button>
          {preview && (
            <Button
              disabled={pending || preview.newCount === 0}
              onClick={() =>
                startTransition(async () => {
                  const result = await importCsv(accountId, text!, flip);
                  if (!result.ok) return setError(result.error);
                  toast.success(`Imported ${result.imported} transaction${result.imported === 1 ? "" : "s"}`, {
                    description: "Categorizing them now. Refresh in a minute.",
                  });
                  onOpenChange(false);
                })
              }
            >
              {pending ? "Importing…" : `Import ${preview.newCount}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
