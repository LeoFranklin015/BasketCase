import type { Metadata } from "next";
import { Graveyard } from "@/components/graveyard";

export const metadata: Metadata = { title: "Graveyard" };

export default function GraveyardPage() {
  return <Graveyard />;
}
