/**
 * Parses bank CSV exports into transactions with Plaid's sign (positive = money out).
 * Pure, so it's easy to test against real formats.
 */
export type ImportRow = {
  date: string; // posted date, YYYY-MM-DD
  authorizedDate: string | null; // transaction date, when the file has both
  description: string;
  amountCents: number; // positive = money out
};

export type ParseResult = {
  rows: ImportRow[];
  /** "debit_credit" and "typed" formats state the direction; "single" guesses it. */
  format: "debit_credit" | "typed" | "single";
  skipped: number; // rows that couldn't be read
};

export class ImportError extends Error {}

/** RFC 4180-ish: quoted fields, doubled quotes, commas and newlines inside quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

/** YYYY-MM-DD, MM/DD/YYYY or MM/DD/YY → YYYY-MM-DD, or null. */
export function parseDate(value: string): string | null {
  const v = value.trim();
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return fmt(+m[1], +m[2], +m[3]);
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return fmt(y, +m[1], +m[2]);
  }
  return null;
}
function fmt(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCMonth() !== mo - 1) return null; // e.g. Feb 30
  return date.toISOString().slice(0, 10);
}

/** "$1,234.56", "(12.00)", "-5" → cents; empty → null. */
export function parseAmount(value: string): number | null {
  const v = value.trim();
  if (!v) return null;
  const negative = /^\(.*\)$/.test(v) || v.includes("-");
  const n = Number(v.replace(/[()$,\s-]/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) * (negative ? -1 : 1);
}

const find = (headers: string[], ...names: string[]) => {
  const norm = headers.map((h) => h.trim().toLowerCase());
  for (const n of names) {
    const i = norm.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
};

/**
 * Reads the file into rows. `flipSign` is for single-amount files where the bank writes
 * purchases as positive (the default assumption is negative = money out, as most banks do).
 */
export function parseTransactionsCsv(text: string, flipSign = false): ParseResult {
  const table = parseCsv(text);
  if (table.length < 2) throw new ImportError("That file has no transactions in it.");
  const headers = table[0];
  const posted = find(headers, "posted date", "post date", "posting date");
  const txnDate = find(headers, "transaction date", "trans. date", "date");
  const desc = find(headers, "description", "transaction description", "merchant", "payee", "name", "memo");
  const debit = find(headers, "debit", "withdrawal", "withdrawals", "money out");
  const credit = find(headers, "credit", "deposit", "deposits", "money in");
  const amount = find(headers, "amount", "transaction amount");
  const type = find(headers, "transaction type", "type");
  const dateCol = posted >= 0 ? posted : txnDate;

  if (dateCol < 0 || desc < 0 || (amount < 0 && (debit < 0 || credit < 0))) {
    throw new ImportError(
      "Couldn't find the date, description and amount columns. Download the CSV from your bank's website and try again.",
    );
  }
  const format: ParseResult["format"] = debit >= 0 && credit >= 0 ? "debit_credit" : type >= 0 ? "typed" : "single";

  const rows: ImportRow[] = [];
  let skipped = 0;
  for (const r of table.slice(1)) {
    const date = parseDate(r[dateCol] ?? "");
    const description = (r[desc] ?? "").trim();
    let cents: number | null = null;
    if (format === "debit_credit") {
      const out = parseAmount(r[debit] ?? "");
      const inn = parseAmount(r[credit] ?? "");
      cents = out !== null && out !== 0 ? Math.abs(out) : inn !== null ? -Math.abs(inn) : null;
    } else {
      const a = parseAmount(r[amount] ?? "");
      if (a !== null) {
        if (format === "typed") {
          const t = (r[type] ?? "").trim().toLowerCase();
          cents = t.startsWith("debit") || t === "withdrawal" ? Math.abs(a) : t.startsWith("credit") || t === "deposit" ? -Math.abs(a) : -a;
        } else {
          cents = flipSign ? a : -a; // bank sign (negative = out) → Plaid sign (positive = out)
        }
      }
    }
    if (!date || !description || cents === null || cents === 0) {
      skipped++;
      continue;
    }
    const authorized = posted >= 0 && txnDate >= 0 && txnDate !== posted ? parseDate(r[txnDate] ?? "") : null;
    rows.push({ date, authorizedDate: authorized, description, amountCents: cents });
  }
  if (rows.length === 0) throw new ImportError("Couldn't read any transactions from that file.");
  return { rows, format, skipped };
}
