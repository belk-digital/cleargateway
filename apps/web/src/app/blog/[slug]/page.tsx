import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { BlogBody } from "@/components/BlogBody";
import { Cover } from "@/components/blog/Cover";
import { PageBackdrop } from "@/components/PageBackdrop";
import { Reveal, ScrollProgress, SpotlightCard } from "@/components/motion/Motion";
import { getPost, POSTS } from "@/lib/blog";

export function generateStaticParams() {
  return POSTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const post = getPost((await params).slug);
  return { title: post ? `${post.title} · ClearGateway Blog` : "Blog · ClearGateway" };
}

const FONT = "[font-family:var(--font-manrope),ui-sans-serif,system-ui,sans-serif]";
const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
const readMinutes = (body: string) => Math.max(1, Math.round(body.split(/\s+/).length / 200));

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const post = getPost((await params).slug);
  if (!post) notFound();
  const others = POSTS.filter((p) => p.slug !== post.slug)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 2);
  return (
    <>
      <SiteHeader />
      <ScrollProgress />
      <main className={`relative ${FONT}`}>
        <PageBackdrop />
        <header className="px-4 pb-10 pt-32 sm:pt-40">
          <Reveal className="mx-auto max-w-3xl">
            <Link href="/blog" className="group inline-flex items-center gap-1.5 rounded-full border border-white/70 bg-white/60 px-3.5 py-1.5 text-sm font-medium text-[#5A6490] backdrop-blur transition hover:text-[#3F4A9C]">
              <span className="transition-transform group-hover:-translate-x-1">←</span> All posts
            </Link>
            <p className="mt-8 text-xs font-semibold uppercase tracking-[0.25em] text-[#7B86D0]">
              {when(post.date)} · {readMinutes(post.body)} min read
            </p>
            <h1 className="mt-4 text-[2rem] font-medium leading-[1.15] tracking-[-0.04em] text-[#465078] sm:text-6xl">{post.title}</h1>
            <p className="mt-5 text-lg leading-8 text-[#5A6490] sm:text-xl">{post.excerpt}</p>
          </Reveal>
        </header>

        <article className="mx-auto max-w-3xl px-4 pb-16 sm:px-6">
          <div className="rounded-3xl border border-white/70 bg-white/70 p-5 shadow-[0_16px_50px_rgba(60,70,160,0.10)] backdrop-blur-xl sm:p-10">
            <BlogBody body={post.body} />
          </div>

          <div className="mt-8 rounded-3xl bg-[#7B86D0] p-8 text-center text-white shadow-[0_20px_60px_rgba(60,70,160,0.25)] sm:p-10">
            <p className="text-2xl font-medium tracking-[-0.03em] sm:text-3xl">Want to try it yourself?</p>
            <p className="mt-2 text-white/85">Take a test payment in a few minutes.</p>
            <Link href="/docs/quickstart" className="mt-6 inline-block rounded-full bg-white px-7 py-3 text-sm font-semibold text-[#5B5BF0] transition hover:-translate-y-0.5 hover:shadow-lg">
              Read the quickstart
            </Link>
          </div>

          {others.length > 0 && (
            <div className="mt-14">
              <p className="mb-5 text-xs font-semibold uppercase tracking-[0.25em] text-[#7B86D0]">Keep reading</p>
              <div className="grid gap-5 sm:grid-cols-2">
                {others.map((p, i) => (
                  <SpotlightCard key={p.slug} href={`/blog/${p.slug}`} className="h-full !rounded-3xl !bg-white/70">
                    <Cover i={i + 1} />
                    <div className="p-5">
                      <p className="text-xs !text-[#7A83A6]">{when(p.date)}</p>
                      <h2 className="mt-2 text-lg font-semibold leading-snug tracking-[-0.02em] !text-[#465078]">{p.title}</h2>
                    </div>
                  </SpotlightCard>
                ))}
              </div>
            </div>
          )}
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
