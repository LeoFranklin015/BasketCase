import type { ReactNode } from "react";
import { SiteFooter, SiteHeader, TabBar } from "@/components/chrome";

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative isolate flex min-h-dvh flex-col">
      <div aria-hidden className="top-glow" />
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-[1280px] flex-1 px-4 pb-16 pt-4 lg:px-8 lg:pt-8">
        {children}
      </main>
      <SiteFooter />
      <TabBar />
    </div>
  );
}
