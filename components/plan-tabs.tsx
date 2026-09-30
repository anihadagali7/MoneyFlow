import { SegmentedLinks } from "@/components/segmented-links";

/** Budgets and Goals share one tab on phones; this switches between them. */
export function PlanTabs({ active }: { active: "budgets" | "goals" }) {
  return (
    <div className="mb-4">
      <SegmentedLinks
        active={active}
        items={[
          { key: "budgets", label: "Budgets", href: "/budgets" },
          { key: "goals", label: "Goals", href: "/goals" },
        ]}
      />
    </div>
  );
}
