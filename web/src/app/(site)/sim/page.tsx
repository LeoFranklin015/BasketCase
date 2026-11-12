import type { Metadata } from "next";
import { SimView } from "@/components/sim-view";
import { PageHead } from "@/components/ui";

export const metadata: Metadata = { title: "Simulation" };

export default function SimPage() {
  return (
    <div className="space-y-4">
      <PageHead title="60 days, simulated">
        The coin&apos;s math run against simulated buyers, sellers and burners over 60 days, across many random seeds. Lines are the median run; the shaded
        band covers the 10th to 90th percentile. It is a model, not a forecast.
      </PageHead>
      <SimView />
    </div>
  );
}
