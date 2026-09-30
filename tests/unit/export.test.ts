import { describe, expect, it } from "vitest";
import { csvField, transactionsCsv } from "@/lib/export";

describe("csv", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvField('Joe\'s "Diner", NYC')).toBe('"Joe\'s ""Diner"", NYC"');
    expect(csvField("line\nbreak")).toBe('"line\nbreak"');
    expect(csvField(null)).toBe("");
  });

  it("neutralizes spreadsheet formulas in text but not in amounts", () => {
    expect(csvField("=HYPERLINK(\"http://evil\")")).toBe('"\'=HYPERLINK(""http://evil"")"');
    expect(csvField("-12.50", false)).toBe("-12.50");
  });

  it("writes a header and one row per transaction", () => {
    const csv = transactionsCsv({
      transactions: [
        { date: "2026-09-01", merchant: "Netflix", description: "NETFLIX.COM", amount: 15.49, category: "Streaming", card: "Venture 4821", pending: false, notes: null, tags: [] },
      ],
    } as never);
    const lines = csv.replace("﻿", "").trim().split("\r\n");
    expect(lines[0]).toBe("Date,Merchant,Description,Amount,Category,Card,Pending,Notes,Tags");
    expect(lines[1]).toBe("2026-09-01,Netflix,NETFLIX.COM,15.49,Streaming,Venture 4821,no,,");
  });
});
