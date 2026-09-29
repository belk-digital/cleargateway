import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { BlogBody } from "@/components/BlogBody";
import { getPost, POSTS } from "@/lib/blog";

export function generateStaticParams() {
  return POSTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const post = getPost((await params).slug);
  return { title: post ? `${post.title} · ClearGateway Blog` : "Blog · ClearGateway" };
}

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const post = getPost((await params).slug);
  if (!post) notFound();
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-14">
        <Link href="/blog" className="text-sm text-brand hover:underline">
          ← All posts
        </Link>
        <p className="mt-4 text-sm text-slate-500">{when(post.date)}</p>
        <h1 className="mt-1 text-3xl font-semibold text-slate-900">{post.title}</h1>
        <div className="mt-8">
          <BlogBody body={post.body} />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
