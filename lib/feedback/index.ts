/**
 * Feedback that becomes a GitHub issue. Shared by the form (for its preview) and the server
 * (which re-scrubs and builds the issue itself, so the client can't skip the scrubbing).
 * Issues may be public, so nothing here may carry financial data or who the user is.
 */

export const FEEDBACK_KINDS = {
  bug: {
    label: "Report a problem",
    short: "Problem",
    hint: "Something broke, looks wrong or didn't work",
    issueLabel: "bug",
  },
  feature: {
    label: "Request a feature",
    short: "Feature idea",
    hint: "Something you'd like MoneyFlow to do",
    issueLabel: "enhancement",
  },
  other: {
    label: "Something else",
    short: "Other",
    hint: "A question, an idea or general feedback",
    issueLabel: "question",
  },
} as const;
export type FeedbackKind = keyof typeof FEEDBACK_KINDS;

export const FEEDBACK_AREAS = {
  connections: "Bank connections & syncing",
  dashboard: "Overview",
  transactions: "Transactions & search",
  categories: "Categories",
  import: "CSV import",
  income: "Income",
  budgets: "Budgets & alerts",
  goals: "Savings goals",
  subscriptions: "Subscriptions",
  trips: "Trips",
  reports: "Reports & charts",
  mobile: "iPhone & home screen app",
  account: "Login, account & privacy",
  other: "Something else",
} as const;
export type FeedbackArea = keyof typeof FEEDBACK_AREAS;

/** Technical context gathered in the browser, only sent if the user leaves it switched on. */
export type FeedbackDetails = {
  path?: string;
  userAgent?: string;
  viewport?: string;
  standalone?: boolean;
  /** Recent errors in this tab, oldest first. */
  errors?: Array<{ at: string; message: string; digest?: string }>;
};

/** For technical details: removes anything that could be personal or financial. */
export function scrubTechnical(text: string): string {
  return scrubText(text)
    .replace(/(https?:\/\/[^\s?#"')]+)[?#][^\s"')]*/g, "$1") // query strings
    .replace(/\$\s?-?[\d,]+(?:\.\d+)?/g, "[amount]")
    .replace(/\b\d{1,3}(?:,\d{3})*\.\d{2}\b/g, "[amount]")
    .replace(/••\s?\d+/g, "••[mask]");
}

/** For what the user typed: emails, account-like numbers and tokens. Their words stay. */
export function scrubText(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\b(?:\d[ -]?){6,}\b/g, "[number]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[token]");
}

/** Stops "@name" in feedback from pinging GitHub users. */
const noMentions = (s: string) => s.replace(/@(?=[A-Za-z0-9])/g, "@​");
const noFences = (s: string) => s.replace(/```/g, "ʼʼʼ");

/**
 * The technical details block as it will appear in the issue (also shown as the preview).
 * Error messages are scrubbed; the browser string and error ids are kept only if they look
 * like what they claim to be, since scrubbing would mangle their version numbers and ids.
 */
export function formatDetails(details: FeedbackDetails, appVersion?: string): string {
  const safe = (v: string | undefined, pattern: RegExp) => (v && pattern.test(v) ? v : undefined);
  const userAgent = safe(details.userAgent, /^[\w .,;:()/+-]{1,400}$/);
  const digest = (d?: string) => safe(d, /^[\w-]{1,40}$/);
  const lines: string[] = [];
  if (details.path) lines.push(`Page: ${scrubTechnical(details.path.split(/[?#]/)[0])}`);
  if (appVersion) lines.push(`App version: ${appVersion}`);
  if (userAgent) lines.push(`Browser: ${userAgent}`);
  if (details.viewport)
    lines.push(`Screen: ${scrubTechnical(details.viewport)}${details.standalone ? " (home screen app)" : ""}`);
  if (details.errors?.length) {
    lines.push("", "Recent errors:");
    for (const e of details.errors) {
      const id = digest(e.digest);
      lines.push(`- ${scrubTechnical(e.at)} ${scrubTechnical(e.message)}${id ? ` (server error id: ${id})` : ""}`);
    }
  }
  return lines.join("\n");
}

export type FeedbackInput = {
  kind: FeedbackKind;
  area: FeedbackArea;
  title: string;
  description: string;
  details?: FeedbackDetails | null;
};

export function buildIssue(input: FeedbackInput, opts: { reporter: string; appVersion?: string; sentAt: string }) {
  const kind = FEEDBACK_KINDS[input.kind];
  const area = FEEDBACK_AREAS[input.area];
  const sections = [
    `**${kind.label}** · ${area}`,
    "",
    noMentions(scrubText(input.description.trim())) || "_No description._",
  ];
  if (input.details) {
    sections.push(
      "",
      "<details><summary>Technical details</summary>",
      "",
      "```",
      noFences(formatDetails(input.details, opts.appVersion)),
      "```",
      "",
      "</details>",
    );
  }
  sections.push("", `<sub>Sent from MoneyFlow ${opts.sentAt} · reporter ${opts.reporter}</sub>`);
  return {
    title: noMentions(scrubText(input.title.trim())).slice(0, 120),
    body: sections.join("\n"),
    labels: ["feedback", kind.issueLabel, `area: ${input.area}`],
  };
}
