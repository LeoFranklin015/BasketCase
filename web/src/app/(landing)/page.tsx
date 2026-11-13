import type { Metadata } from "next";
import { Landing } from "@/components/landing";
import { BRAND } from "@/lib/config";

export const metadata: Metadata = {
  title: { absolute: `${BRAND.name}: ${BRAND.tagline}` },
};

export default function Page() {
  return <Landing />;
}
