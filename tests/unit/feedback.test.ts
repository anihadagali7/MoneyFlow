import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { buildIssue, formatDetails, scrubTechnical, scrubText } from "@/lib/feedback";
import { createIssue, FeedbackNotConfiguredError } from "@/lib/feedback/github";

const meta = { reporter: "a1b2c3d4e5", appVersion: "cb1cfd8", sentAt: "2026-09-30 19:00 UTC" };

describe("scrubbing", () => {
  it("removes emails, account-like numbers and tokens from what the user typed, keeping their words", () => {
    expect(scrubText("Email me at ani@example.com, card 4111 1111 1111 1111, spent $42.10")).toBe(
      "Email me at [email], card [number], spent $42.10",
    );
    expect(scrubText("token session_abcdefghijklmnopqrstuvwxyz123456")).toBe("token [token]");
  });

  it("also strips amounts, card masks and query strings from technical details", () => {
    expect(
      scrubTechnical(
        "TypeError at https://app.test/transactions?q=netflix&month=2026-09: $1,284.17 on Venture ••4821, 98.00",
      ),
    ).toBe("TypeError at https://app.test/transactions [amount] on Venture ••[mask], [amount]");
  });
});

describe("buildIssue", () => {
  it("labels by kind and area, and identifies the sender only by reporter ref", () => {
    const issue = buildIssue(
      { kind: "feature", area: "income", title: "Split paychecks", description: "Like @octocat said", details: null },
      meta,
    );
    expect(issue.labels).toEqual(["feedback", "enhancement", "area: income"]);
    expect(issue.title).toBe("Split paychecks");
    expect(issue.body).toContain("**Request a feature** · Income");
    expect(issue.body).toContain("@​octocat"); // no GitHub mention
    expect(issue.body).toContain("reporter a1b2c3d4e5");
    expect(issue.body).not.toContain("Technical details");
  });

  it("puts scrubbed technical details in a collapsed block that can't break out of its fence", () => {
    const issue = buildIssue(
      {
        kind: "bug",
        area: "transactions",
        title: "Crash",
        description: "It broke",
        details: {
          path: "/transactions?q=rent",
          userAgent:
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Safari/604.1",
          viewport: "390×844",
          standalone: true,
          errors: [{ at: "19:01:02", message: "Error: ``` $1,395.00 rent", digest: "3528710917" }],
        },
      },
      meta,
    );
    expect(issue.labels).toEqual(["feedback", "bug", "area: transactions"]);
    expect(issue.body).toContain("<details><summary>Technical details</summary>");
    expect(issue.body).toContain("Page: /transactions\n");
    expect(issue.body).toContain("App version: cb1cfd8");
    expect(issue.body).toContain("Screen: 390×844 (home screen app)");
    expect(issue.body).toContain("Error: ʼʼʼ [amount] rent (server error id: 3528710917)");
    expect(issue.body).toContain("AppleWebKit/605.1.15 Version/18.6"); // versions aren't amounts
    expect(issue.body.match(/```/g)).toHaveLength(2);
  });

  it("previews exactly what the issue will contain, dropping fields that don't look right", () => {
    expect(formatDetails({ path: "/income", errors: [] })).toBe("Page: /income");
    expect(formatDetails({ userAgent: "<script>alert(1)</script>" })).toBe("");
    expect(formatDetails({ errors: [{ at: "x", message: "m", digest: "a b" }] })).toBe("\nRecent errors:\n- x m");
  });
});

describe("createIssue", () => {
  afterEach(() => vi.unstubAllEnvs());
  const issue = { title: "t", body: "b", labels: ["feedback"] };

  it("refuses to run without a token and repo", async () => {
    vi.stubEnv("GITHUB_FEEDBACK_TOKEN", "");
    await expect(createIssue(issue, vi.fn())).rejects.toBeInstanceOf(FeedbackNotConfiguredError);
  });

  it("posts to the configured repo, retrying without labels if the token can't set them", async () => {
    vi.stubEnv("GITHUB_FEEDBACK_TOKEN", "test-token");
    vi.stubEnv("GITHUB_FEEDBACK_REPO", "owner/feedback");
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 422 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ number: 42, html_url: "https://github.com/owner/feedback/issues/42" }), {
          status: 201,
        }),
      );
    expect(await createIssue(issue, fetchImpl)).toEqual({
      number: 42,
      url: "https://github.com/owner/feedback/issues/42",
    });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.github.com/repos/owner/feedback/issues");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual(issue);
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({ title: "t", body: "b" });
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe("Bearer test-token");
  });
});
