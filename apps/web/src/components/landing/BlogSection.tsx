import Link from "next/link";
import { Cover } from "@/components/blog/Cover";
import { Reveal, SpotlightCard, StaggerGroup, StaggerItem } from "@/components/motion/Motion";
import type { Post } from "@/lib/blog";

const FONT = "[font-family:var(--font-manrope),ui-sans-serif,system-ui,sans-serif]";
const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
const readMinutes = (body: string) => Math.max(1, Math.round(body.split(/\s+/).length / 200));

/** Homepage blog teaser: the newest post large on the left, the next two stacked beside it. `posts` must be newest first. */
export function BlogSection({ posts }: { posts: Post[] }) {
  const [featured, ...rest] = posts.slice(0, 3);
  if (!featured) return null;
  return (
    <section className={`relative overflow-hidden px-4 py-20 sm:px-8 ${FONT}`}>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[30rem] bg-[url(/gradient-bg.webp)] bg-cover bg-bottom opacity-60 [mask-image:linear-gradient(to_top,#000_30%,transparent)]" />
      <div className="mx-auto max-w-[76rem]">
        <Reveal className="mb-12 flex flex-col items-center justify-between gap-6 text-center sm:flex-row sm:items-end sm:text-left">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[#7B86D0]">Blog</p>
            <h2 className="mt-4 text-4xl font-medium leading-[1.15] tracking-[-0.04em] text-[#465078] sm:text-6xl">
              From the <span className="text-[#7B86D0]">blog</span>
            </h2>
            <p className="mt-4 max-w-md text-lg leading-8 text-[#5A6490]">Notes on how ClearGateway is built, written plainly.</p>
          </div>
          <Link href="/blog" className="group inline-flex shrink-0 items-center gap-2 rounded-full border border-[#7B86D0]/40 bg-white/70 px-6 py-3 text-sm font-semibold text-[#5B5BF0] backdrop-blur transition duration-300 hover:-translate-y-0.5 hover:border-[#7B86D0] hover:shadow-lg hover:shadow-indigo-500/10">
            See all posts
            <span className="transition-transform group-hover:translate-x-1">→</span>
          </Link>
        </Reveal>

        <StaggerGroup className="grid gap-6 lg:grid-cols-[1.25fr_1fr]" gap={0.12}>
          <StaggerItem className="min-w-0">
            <SpotlightCard href={`/blog/${featured.slug}`} className="h-full !rounded-3xl !bg-white/75">
              <div className="h-52 sm:h-64">
                <Cover i={0} fill />
              </div>
              <div className="p-6 sm:p-8">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#7B86D0]">
                  Latest · {readMinutes(featured.body)} min read
                </p>
                <h3 className="mt-3 text-2xl font-medium leading-tight tracking-[-0.03em] !text-[#465078] sm:text-3xl">{featured.title}</h3>
                <p className="mt-3 text-[15px] leading-7 !text-[#5A6490]">{featured.excerpt}</p>
                <div className="mt-6 flex items-center justify-between">
                  <p className="text-xs !text-[#7A83A6]">{when(featured.date)}</p>
                  <p className="text-sm font-semibold text-[#5B5BF0]">
                    Read the post <span className="inline-block transition-transform duration-300 group-hover/spot:translate-x-1">→</span>
                  </p>
                </div>
              </div>
            </SpotlightCard>
          </StaggerItem>

          {rest.length > 0 && (
            <div className="grid min-w-0 gap-6">
              {rest.map((p, i) => (
                <StaggerItem key={p.slug} className="min-w-0">
                  <SpotlightCard href={`/blog/${p.slug}`} className="h-full !rounded-3xl !bg-white/75">
                    <div className="flex h-full flex-col sm:flex-row lg:flex-col xl:flex-row">
                      <div className="sm:w-2/5 lg:w-full xl:w-2/5">
                        <Cover i={i + 1} fill />
                      </div>
                      <div className="flex-1 p-5">
                        <p className="text-xs !text-[#7A83A6]">
                          {when(p.date)} · {readMinutes(p.body)} min read
                        </p>
                        <h3 className="mt-2 text-lg font-semibold leading-snug tracking-[-0.02em] !text-[#465078]">{p.title}</h3>
                        <p className="mt-2 line-clamp-2 text-sm leading-6 !text-[#5A6490]">{p.excerpt}</p>
                      </div>
                    </div>
                  </SpotlightCard>
                </StaggerItem>
              ))}
            </div>
          )}
        </StaggerGroup>
      </div>
    </section>
  );
}
