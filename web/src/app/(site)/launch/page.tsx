import type { Metadata } from "next";
import { LaunchForm } from "@/components/launch-form";
import { PageHead } from "@/components/ui";
import { NET } from "@/lib/config";

export const metadata: Metadata = { title: "Launch a coin" };

export default function LaunchPage() {
  return (
    <div className="space-y-4">
      <PageHead title="Launch a coin">
        Pick what backs it. Every buy sends that basket into the coin&apos;s own vault, so the coin starts with a floor equal to its price. The basket is
        sized from {NET.swapRoute === "oneclick" ? "1Click" : `the ${NET.label.toLowerCase()} swapper`}&apos;s prices today; after launch, no price feed touches buys or sells.
      </PageHead>
      <LaunchForm />
    </div>
  );
}
