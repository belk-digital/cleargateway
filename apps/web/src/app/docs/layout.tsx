import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DocsLayoutShell } from "@/components/docs/DocsLayoutShell";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";

export const metadata: Metadata = { title: "Docs · ClearGateway" };

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <DocsLayoutShell>{children}</DocsLayoutShell>
      <SiteFooter />
    </>
  );
}
