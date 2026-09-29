import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { Cover } from "@/components/blog/Cover";
import { PageBackdrop } from "@/components/PageBackdrop";
import { Reveal, SpotlightCard, StaggerGroup, StaggerItem } from "@/components/motion/Motion";
import { POSTS } from "@/lib/blog";

export const metadata: Metadata = { title: "Blog · ClearGateway" };

const FONT = "[font-family:var(--font-manrope),ui-sans-serif,system-ui,sans-serif]";
const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
const readMinutes = (body: string) => Math.max(1, Math.round(body.split(/\s+/).length / 200));

export default function BlogIndex() {
  const posts = POSTS.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  const [featured, ...rest] = posts;
  return (
    <>
      <SiteHeader />
      <main className={`relative ${FONT}`}>
        <PageBackdrop />
        <section className="px-4 pb-12 pt-32 text-center sm:pt-40">
          <Reveal>
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[#7B86D0]">Blog</p>
            <h1 className="mx-auto mt-5 max-w-3xl text-[2.4rem] font-medium leading-[1.15] tracking-[-0.04em] text-[#465078] sm:text-6xl">
              Notes from the <span className="text-[#7B86D0]">engine room</span>
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-lg leading-8 text-[#5A6490]">Notes on how ClearGateway is built, written plainly.</p>
          </Reveal>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-8">
          {featured && (
            <Reveal>
              <SpotlightCard href={`/blog/${featured.slug}`} className="!rounded-3xl !bg-white/70">
                <div className="grid sm:grid-cols-2">
                  <Cover i={0} tall />
                  <div className="flex flex-col justify-center p-6 sm:p-9">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#7B86D0]">Featured · {readMinutes(featured.body)} min read</p>
                    <h2 className="mt-3 text-2xl font-medium leading-tight tracking-[-0.03em] !text-[#465078] sm:text-3xl">{featured.title}</h2>
                    <p className="mt-3 text-[15px] leading-7 !text-[#5A6490]">{featured.excerpt}</p>
                    <p className="mt-5 text-xs !text-[#7A83A6]">{when(featured.date)}</p>
                    <p className="mt-3 text-sm font-semibold text-[#5B5BF0]">
                      Read the post <span className="inline-block transition-transform duration-300 group-hover/spot:translate-x-1">→</span>
                    </p>
                  </div>
                </div>
              </SpotlightCard>
            </Reveal>
          )}
          {rest.length > 0 && (
            <StaggerGroup className={`mt-6 grid gap-6 sm:grid-cols-2 ${rest.length >= 3 ? "lg:grid-cols-3" : ""}`}>
              {rest.map((p, i) => (
                <StaggerItem key={p.slug} className="h-full">
                  <SpotlightCard href={`/blog/${p.slug}`} className="h-full !rounded-3xl !bg-white/70">
                    <Cover i={i + 1} />
                    <div className="p-5">
                      <p className="text-xs !text-[#7A83A6]">
                        {when(p.date)} · {readMinutes(p.body)} min read
                      </p>
                      <h2 className="mt-2 text-lg font-semibold leading-snug tracking-[-0.02em] !text-[#465078]">{p.title}</h2>
                      <p className="mt-2 text-sm leading-6 !text-[#5A6490]">{p.excerpt}</p>
                    </div>
                  </SpotlightCard>
                </StaggerItem>
              ))}
            </StaggerGroup>
          )}
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
