import { computeProgress, type ActiveAlert, type BudgetsData } from "@/lib/budgets";
import type { IncomeData } from "@/lib/reports/incomeData";
import type { MonthRow, ReportData } from "@/lib/reports/summary";
import type { DashboardData, ItemSummary, TransactionsData, TxnRow } from "@/lib/views/data";

/** Sample data for the development-only preview page (app/dev/preview). Not real user data. */

const cats = [
  ["groceries", "Groceries"],
  ["dining", "Restaurants & Dining"],
  ["subscriptions_streaming", "Streaming Subscriptions"],
  ["travel_flights", "Flights"],
  ["transport_rideshare", "Rideshare & Taxi"],
  ["shopping_general", "Shopping"],
  ["coffee", "Coffee & Snacks"],
  ["payments_transfers", "Payments & Transfers"],
] as const;
const categories = cats.map(([slug, name], i) => ({ id: `00000000-0000-4000-8000-00000000000${i}`, slug, name }));
const cat = (slug: string) => categories.find((c) => c.slug === slug)!;

const months: MonthRow[] = [
  ["2026-04", "Apr", 3420_18, 6200_00],
  ["2026-05", "May", 4105_77, 6200_00],
  ["2026-06", "Jun", 5890_40, 6200_00],
  ["2026-07", "Jul", 3912_05, 9300_00],
  ["2026-08", "Aug", 4380_66, 6200_00],
  ["2026-09", "Sep", 2984_31, 6200_00],
].map(([key, label, spendCents, incomeCents]) => ({
  key: key as string,
  label: label as string,
  spendCents: spendCents as number,
  incomeCents: incomeCents as number,
  netCents: (incomeCents as number) - (spendCents as number),
}));

function txn(
  id: number,
  date: string,
  merchant: string,
  amountCents: number,
  slug: string | null,
  extra: Partial<TxnRow> = {},
): TxnRow {
  const c = slug ? cat(slug) : null;
  return {
    id: `10000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
    date,
    pending: false,
    amountCents,
    merchant,
    description: merchant.toUpperCase(),
    card: "Venture X ••4821",
    categoryId: c?.id ?? null,
    categoryName: c?.name ?? null,
    needsReview: false,
    isTransfer: slug === "payments_transfers",
    ...extra,
  };
}

const rows: TxnRow[] = [
  txn(1, "2026-09-30", "Blue Bottle Coffee", 6_75, "coffee", { pending: true }),
  txn(2, "2026-09-30", "Whole Foods Market", 142_18, "groceries"),
  txn(3, "2026-09-29", "Uber", 23_40, "transport_rideshare"),
  txn(4, "2026-09-29", "Netflix", 15_49, "subscriptions_streaming"),
  txn(5, "2026-09-28", "JMK LLC", 64_00, "shopping_general", {
    needsReview: true,
    merchant: "JMK LLC 8827",
    description: "JMK LLC 8827 BROOKLYN NY",
  }),
  txn(6, "2026-09-27", "Delta Air Lines", 412_60, "travel_flights"),
  txn(7, "2026-09-27", "Amazon", -38_99, "shopping_general"),
  txn(8, "2026-09-26", "Capital One Payment", -1250_00, "payments_transfers"),
  txn(9, "2026-09-26", "Sweetgreen", 18_25, null),
];

const items: ItemSummary[] = [
  {
    id: "item-1",
    institutionName: "Capital One",
    status: "active",
    lastSyncedAt: "2026-09-30T07:40:00Z",
    cards: ["Venture X ••4821", "Quicksilver ••1190"],
  },
  {
    id: "item-2",
    institutionName: "Chase",
    status: "login_required",
    lastSyncedAt: "2026-09-27T12:00:00Z",
    cards: ["Sapphire Preferred ••7703"],
  },
];

const today = { iso: "2026-09-20", month: { year: 2026, month: 9 } };
function budget(id: string, slug: string | null, name: string, limitCents: number, spentCents: number) {
  return {
    id,
    categoryId: slug ? `cat-${slug}` : null,
    slug,
    name,
    limitCents,
    spentCents,
    progress: computeProgress(limitCents, spentCents, today),
  };
}
const budgetsData: BudgetsData = {
  monthKey: "2026-09",
  monthName: "September",
  daysLeft: 11,
  total: budget("b0", null, "Total spending", 4000_00, 2984_31),
  budgets: [
    budget("b1", "dining", "Restaurants & Dining", 400_00, 452_18),
    budget("b2", "groceries", "Groceries", 900_00, 742_40),
    budget("b3", "shopping_general", "Shopping", 300_00, 212_05),
    budget("b4", "subscriptions_streaming", "Streaming Subscriptions", 80_00, 64_96),
  ],
  suggestions: [
    {
      categoryId: "cat-travel_flights",
      slug: "travel_flights",
      name: "Flights",
      averageCents: 650_00,
      thisMonthCents: 412_60,
    },
    { categoryId: "cat-coffee", slug: "coffee", name: "Coffee & Snacks", averageCents: 62_00, thisMonthCents: 48_30 },
  ],
  spendCategories: [
    { id: "cat-travel_flights", name: "Flights" },
    { id: "cat-coffee", name: "Coffee & Snacks" },
  ],
  averages: { "cat-travel_flights": 650_00, "cat-coffee": 62_00, __total: 4105_00 },
};
const alerts: ActiveAlert[] = [
  {
    id: "a1",
    budgetId: "b1",
    name: "Restaurants & Dining",
    slug: "dining",
    threshold: 100,
    progress: budgetsData.budgets[0].progress,
    limitCents: 400_00,
    spentCents: 452_18,
  },
  {
    id: "a2",
    budgetId: "b2",
    name: "Groceries",
    slug: "groceries",
    threshold: 80,
    progress: budgetsData.budgets[1].progress,
    limitCents: 900_00,
    spentCents: 742_40,
  },
];

export const fixtures = {
  budgets: budgetsData,
  alerts,
  today: "2026-09-30",
  now: Date.parse("2026-09-30T08:10:00Z"),
  dashboard: {
    monthKey: "2026-09",
    monthName: "September",
    current: { spendCents: months[5].spendCents, incomeCents: months[5].incomeCents, netCents: months[5].netCents },
    lastMonth: { spendCents: months[4].spendCents, incomeCents: months[4].incomeCents, netCents: months[4].netCents },
    trend: months,
    categories: [
      { slug: "groceries", name: "Groceries", cents: 812_40 },
      { slug: "dining", name: "Restaurants & Dining", cents: 604_12 },
      { slug: "travel_flights", name: "Flights", cents: 412_60 },
      { slug: "shopping_general", name: "Shopping", cents: 388_05 },
      { slug: "subscriptions_streaming", name: "Streaming Subscriptions", cents: 64_96 },
      { slug: "coffee", name: "Coffee & Snacks", cents: 48_30 },
    ],
    uncategorized: 1,
    needsReview: 3,
    recent: rows.slice(0, 8),
    items,
  } satisfies DashboardData,
  transactions: {
    monthKey: "2026-09",
    monthName: "September 2026",
    prevMonthKey: "2026-08",
    nextMonthKey: "2026-10",
    filters: { month: "2026-09" },
    categories,
    cards: [
      { id: "card-1", label: "Venture X ••4821" },
      { id: "card-2", label: "Quicksilver ••1190" },
    ],
    rows,
    totals: { outCents: 682_67, inCents: 38_99 },
  } satisfies TransactionsData,
  reports: {
    range: "6m",
    rangeLabel: "Last 6 months",
    months,
    totals: { spendCents: 24673_37, incomeCents: 40300_00, netCents: 15626_63 },
    prior: { spendCents: 22110_02, incomeCents: 37200_00, netCents: 15089_98 },
    categories: [
      { slug: "groceries", name: "Groceries", cents: 4820_11, count: 38 },
      { slug: "travel_flights", name: "Flights", cents: 3912_60, count: 6 },
      { slug: "dining", name: "Restaurants & Dining", cents: 3605_42, count: 51 },
      { slug: "shopping_general", name: "Shopping", cents: 3190_88, count: 27 },
      { slug: "rent_housing", name: "Rent & Housing", cents: 2400_00, count: 1 },
      { slug: "subscriptions_streaming", name: "Streaming Subscriptions", cents: 389_76, count: 24 },
    ].map((c) => ({ ...c })),
    cards: [
      { id: "card-1", label: "Venture X ••4821", cents: 16402_10 },
      { id: "card-2", label: "Quicksilver ••1190", cents: 5871_27 },
      { id: "card-3", label: "Sapphire Preferred ••7703", cents: 2400_00 },
    ],
    merchants: [
      { name: "Whole Foods Market", cents: 2204_51, count: 17 },
      { name: "Delta Air Lines", cents: 1650_20, count: 3 },
      { name: "Amazon", cents: 1402_77, count: 22 },
      { name: "Trader Joe's", cents: 998_40, count: 14 },
      { name: "Uber", cents: 611_18, count: 26 },
    ],
    largest: [
      { id: "l1", date: "2026-06-14", merchant: "Airbnb", category: "Hotels & Lodging", cents: 1840_00 },
      { id: "l2", date: "2026-06-02", merchant: "Delta Air Lines", category: "Flights", cents: 912_40 },
      { id: "l3", date: "2026-08-19", merchant: "Apple Store", category: "Electronics", cents: 849_00 },
    ],
    uncategorized: 2,
  } satisfies ReportData,
  income: {
    sources: [
      {
        id: "s1",
        label: "Acme Corp salary",
        amountCents: 2861_54,
        frequency: "biweekly",
        frequencyLabel: "Every 2 weeks",
        anchorDate: "2026-01-02",
        endDate: null,
        monthlyCents: 6200_00,
        nextPayDate: "2026-10-09",
      },
    ],
    entries: [
      { id: "e1", label: "Annual bonus", amountCents: 3100_00, receivedOn: "2026-07-15" },
      { id: "e2", label: "Tax refund", amountCents: 842_00, receivedOn: "2026-04-02" },
    ],
    monthlyRecurringCents: 6200_00,
  } satisfies IncomeData,
  items,
};
