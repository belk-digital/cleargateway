import Link from "next/link";
import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { POSTS } from "@/lib/blog";

export const metadata: Metadata = { title: "Blog · ClearGateway" };

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

export default function BlogIndex() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-14">
        <h1 className="text-3xl font-semibold text-slate-900">Blog</h1>
        <p className="mt-2 text-slate-600">Notes on how ClearGateway is built, written plainly.</p>
        <div className="mt-10 divide-y divide-slate-200">
          {POSTS.slice()
            .sort((a, b) => (a.date < b.date ? 1 : -1))
            .map((p) => (
              <Link key={p.slug} href={`/blog/${p.slug}`} className="block py-6 !no-underline">
                <p className="text-xs text-slate-500">{when(p.date)}</p>
                <h2 className="mt-1 text-xl font-semibold !text-slate-900">{p.title}</h2>
                <p className="mt-2 !text-slate-600">{p.excerpt}</p>
              </Link>
            ))}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
