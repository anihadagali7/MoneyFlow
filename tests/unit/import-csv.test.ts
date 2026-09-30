import { describe, expect, it } from "vitest";
import { ImportError, parseAmount, parseCsv, parseDate, parseTransactionsCsv } from "@/lib/import/csv";

describe("parseCsv", () => {
  it("handles quotes, commas and newlines in fields, CRLF and a BOM", () => {
    const text = '﻿a,b,c\r\n"x, y","he said ""hi""","multi\nline"\r\n\r\n1,2,3\n';
    expect(parseCsv(text)).toEqual([
      ["a", "b", "c"],
      ["x, y", 'he said "hi"', "multi\nline"],
      ["1", "2", "3"],
    ]);
  });
});

describe("parseDate / parseAmount", () => {
  it("reads common date formats and rejects impossible dates", () => {
    expect(parseDate("2026-03-05")).toBe("2026-03-05");
    expect(parseDate("03/05/2026")).toBe("2026-03-05");
    expect(parseDate("3/5/26")).toBe("2026-03-05");
    expect(parseDate("02/30/2026")).toBeNull();
    expect(parseDate("yesterday")).toBeNull();
  });
  it("reads amounts with $, commas, minus and parentheses", () => {
    expect(parseAmount("$1,234.56")).toBe(123456);
    expect(parseAmount("-12.5")).toBe(-1250);
    expect(parseAmount("(40.00)")).toBe(-4000);
    expect(parseAmount("")).toBeNull();
  });
});

describe("parseTransactionsCsv", () => {
  it("reads a Capital One credit card export (Debit/Credit columns)", () => {
    const csv = [
      "Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit",
      "2026-03-04,2026-03-05,4821,NETFLIX.COM,Entertainment,15.49,",
      "2026-03-10,2026-03-10,4821,CAPITAL ONE AUTOPAY PYMT,Payment/Credit,,1250.00",
      '2026-03-12,2026-03-13,4821,"AMAZON.COM, REFUND",Merchandise,,38.99',
    ].join("\n");
    const { rows, format, skipped } = parseTransactionsCsv(csv);
    expect(format).toBe("debit_credit");
    expect(skipped).toBe(0);
    expect(rows).toEqual([
      { date: "2026-03-05", authorizedDate: "2026-03-04", description: "NETFLIX.COM", amountCents: 15_49 },
      { date: "2026-03-10", authorizedDate: "2026-03-10", description: "CAPITAL ONE AUTOPAY PYMT", amountCents: -1250_00 },
      { date: "2026-03-13", authorizedDate: "2026-03-12", description: "AMAZON.COM, REFUND", amountCents: -38_99 },
    ]);
  });

  it("reads a Capital One 360 bank export (amount + type)", () => {
    const csv = [
      "Account Number,Transaction Date,Transaction Amount,Transaction Type,Transaction Description,Balance",
      "0921,03/02/26,2861.54,Credit,ACME CORP PAYROLL,6420.55",
      "0921,03/03/26,54.20,Debit,TRADER JOES #552,6366.35",
    ].join("\n");
    const { rows, format } = parseTransactionsCsv(csv);
    expect(format).toBe("typed");
    expect(rows.map((r) => [r.date, r.amountCents])).toEqual([
      ["2026-03-02", -2861_54],
      ["2026-03-03", 54_20],
    ]);
  });

  it("reads a single-amount export (negative = spent), with a flip option", () => {
    const csv = "Date,Description,Amount\n03/01/2026,STARBUCKS,-6.75\n03/02/2026,REFUND,12.00";
    expect(parseTransactionsCsv(csv).rows.map((r) => r.amountCents)).toEqual([6_75, -12_00]);
    expect(parseTransactionsCsv(csv, true).rows.map((r) => r.amountCents)).toEqual([-6_75, 12_00]);
    expect(parseTransactionsCsv(csv).format).toBe("single");
  });

  it("skips unreadable rows and rejects files it can't understand", () => {
    const csv = "Date,Description,Amount\n03/01/2026,A,-1\nnot a date,B,-2\n03/03/2026,,-3";
    expect(parseTransactionsCsv(csv)).toMatchObject({ skipped: 2 });
    expect(() => parseTransactionsCsv("foo,bar\n1,2")).toThrow(ImportError);
    expect(() => parseTransactionsCsv("Date,Description,Amount\n")).toThrow(ImportError);
  });
});

describe("real exports pasted by the user", () => {
  it("reads a Chase checking export (signed amounts win over the Type column)", () => {
    const csv = [
      "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #,",
      "CREDIT,09/30/2026,ORIG CO NAME:FORD MOTOR COMPA CO ENTRY DESCR:PAYROLLDD  SEC:PPD  ORIG ID:1380549190,3268.42,ACH_CREDIT, ,,",
      "DEBIT,09/28/2026,VERIZON          PAYMENTREC                 PPD ID: 9783397101,-19.99,ACH_DEBIT,2815.57,,",
      "DEBIT,09/16/2026,Wealthfront      EDI PYMNTS 45D13F762C5046  WEB ID: 4271967207,-500.00,MISC_DEBIT,2835.56,,",
    ].join("\n");
    const { rows, format } = parseTransactionsCsv(csv);
    expect(format).toBe("single");
    expect(rows.map((r) => [r.date, r.amountCents])).toEqual([
      ["2026-09-30", -3268_42], // paycheck: money in
      ["2026-09-28", 19_99],
      ["2026-09-16", 500_00],
    ]);
  });

  it("reads the same exports when tab-separated (copied through a spreadsheet)", () => {
    const tabbed = [
      "Transaction Date\tPosted Date\tCard No.\tDescription\tCategory\tDebit\tCredit",
      "2025-12-28\t2025-12-29\t993\tHERTZTOLL 963357183\tGas/Automotive\t0.94\t",
      "2025-12-23\t2025-12-26\t993\tMACYS  NEWPORT CENTRE\tMerchandise\t\t92.54",
    ].join("\n");
    const { rows, format } = parseTransactionsCsv(tabbed);
    expect(format).toBe("debit_credit");
    expect(rows.map((r) => [r.date, r.authorizedDate, r.description, r.amountCents])).toEqual([
      ["2025-12-29", "2025-12-28", "HERTZTOLL 963357183", 94],
      ["2025-12-26", "2025-12-23", "MACYS  NEWPORT CENTRE", -92_54],
    ]);
    expect(parseTransactionsCsv("Date;Description;Amount\n03/01/2026;CAFE;-4.50").rows[0].amountCents).toBe(4_50);
  });
});
