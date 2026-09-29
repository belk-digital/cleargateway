import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { CodeTabs } from "@/components/docs/CodeTabs";
import { Faq } from "@/components/Faq";
import { AsciiHands } from "@/components/landing/AsciiHands";
import { BlogSection } from "@/components/landing/BlogSection";
import { CtaSection } from "@/components/landing/CtaSection";
import { Hero } from "@/components/landing/Hero";
import { Marquee } from "@/components/Marquee";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { WhyIcon } from "@/components/landing/WhyIcon";
import { PlatformFeatures } from "@/components/landing/PlatformFeatures";
import { Reveal, SpotlightCard, StaggerGroup, StaggerItem } from "@/components/motion/Motion";
import { POSTS } from "@/lib/blog";
import { API_URL } from "@/lib/site";

const WHY = [
  {
    icon: "shield",
    title: "Non-custodial by design",
    body: "Customer payments are split by a smart contract in one atomic step: your share goes straight to your wallet, our fee to ours. ClearGateway never holds your money and has no withdraw function to abuse.",
  },
  {
    icon: "chain",
    title: "The blockchain is the source of truth",
    body: "A payment is only marked paid after the chain confirms it and a final re-check passes, with reorg protection. No trusting a customer's browser or a third party's say-so.",
  },
  {
    icon: "coin",
    title: "Exact money, no surprises",
    body: "Amounts are whole numbers of USDC base units, never floating point. Fees are set in basis points and always round down, so every cent is accounted for in a double-entry ledger.",
  },
] as const;

const SNIPPET = `curl ${API_URL}/v1/payment_intents \\
  -H "Authorization: Bearer $CLEARGATEWAY_API_KEY" \\
  -H "Idempotency-Key: order-1042" \\
  -H "Content-Type: application/json" \\
  -d '{ "amount": "25500000", "merchant_order_id": "order-1042" }'
# amount is in USDC base units: 25500000 = 25.50 USDC
# the response contains a checkout_url to send your customer to`;

const MARQUEE = ["Non-custodial", "USDC on Base", "HMAC-signed webhooks", "Idempotent API", "Double-entry ledger", "Reorg-safe confirmations", "Two-factor staff", "Generated API docs"];

export default function Home() {
  const posts = POSTS.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  return (
    <>
      <SiteHeader />
      <main>
        <Hero />

        <Marquee items={MARQUEE} />

        <section className="mx-auto max-w-3xl px-4 py-20">
          <Reveal>
            <CodeTabs samples={[{ label: "Create a payment", code: SNIPPET }]} />
          </Reveal>
        </section>

        <AsciiHands />

        <section className="relative overflow-hidden bg-white pb-24 pt-16">
          <video aria-hidden className="pointer-events-none absolute inset-0 h-full w-full object-cover motion-reduce:hidden" src="/cleargateway-hero-bg.mp4" autoPlay muted loop playsInline preload="metadata" />
          {/* White vignette: the video's gradient shows through the middle and fades to white on every side. */}
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_62%_58%_at_50%_50%,rgba(255,255,255,0)_0%,rgba(255,255,255,0.3)_55%,#fff_100%)]" />
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white via-transparent to-white" />
          <div className="relative mx-auto max-w-[76rem] px-4 sm:px-8">
            <Reveal className="mx-auto mb-14 max-w-3xl text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#4A7BEA]">Why ClearGateway</p>
              <h2 className="mt-5 text-4xl font-semibold leading-[1.15] tracking-tight text-[#0B1440] sm:text-5xl">
                Built so you never have to
                <br />
                <span className="bg-gradient-to-r from-[#0BA5D9] via-[#3B6FE8] to-[#A855F7] bg-clip-text text-transparent">trust us with your money</span>
              </h2>
            </Reveal>
            <StaggerGroup className="grid gap-6 md:grid-cols-3" gap={0.14}>
              {WHY.map((f) => (
                <StaggerItem key={f.title} className="h-full">
                  <SpotlightCard className="h-full !rounded-3xl !border-white/70 !bg-white/25 pb-8 shadow-[0_20px_60px_rgba(44,91,160,0.12)] !backdrop-blur-xl">
                    <div className="flex justify-center pb-2 pt-8">
                      <WhyIcon kind={f.icon} />
                    </div>
                    <div className="px-7 text-center">
                      <h3 className="text-xl font-semibold tracking-tight text-[#0B1440]">{f.title}</h3>
                      <p className="mt-3 text-[15px] leading-7 text-[#4A5578]">{f.body}</p>
                    </div>
                  </SpotlightCard>
                </StaggerItem>
              ))}
            </StaggerGroup>
          </div>
        </section>

        <HowItWorks />

        <PlatformFeatures />

        <Faq />

        <BlogSection posts={posts} />

        <CtaSection />
      </main>
      <SiteFooter />
    </>
  );
}
