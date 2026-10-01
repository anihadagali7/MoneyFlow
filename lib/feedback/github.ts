import "server-only";

export class FeedbackNotConfiguredError extends Error {
  constructor() {
    super("Feedback isn't set up on this server yet.");
  }
}

/**
 * Opens an issue in GITHUB_FEEDBACK_REPO ("owner/name") with GITHUB_FEEDBACK_TOKEN, a
 * fine-grained token limited to that repo's issues. Returns the issue's number and page.
 */
export async function createIssue(
  issue: { title: string; body: string; labels: string[] },
  fetchImpl: typeof fetch = fetch,
): Promise<{ number: number; url: string | null }> {
  const token = process.env.GITHUB_FEEDBACK_TOKEN;
  const repo = process.env.GITHUB_FEEDBACK_REPO;
  if (!token || !repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new FeedbackNotConfiguredError();

  const post = (payload: object) =>
    fetchImpl(`https://api.github.com/repos/${repo}/issues`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "MoneyFlow-feedback",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });

  let res = await post(issue);
  // A token that can't apply labels gets a 403/422; the issue still matters more than its labels.
  if (!res.ok && (res.status === 403 || res.status === 422)) {
    res = await post({ title: issue.title, body: issue.body });
  }
  if (!res.ok) throw new Error(`GitHub issue failed with ${res.status}`);
  const created = (await res.json()) as { number: number; html_url?: string };
  return { number: created.number, url: created.html_url?.startsWith("https://github.com/") ? created.html_url : null };
}
