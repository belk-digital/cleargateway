/**
 * Scrolling keyword strip: light periwinkle text separated by cyan plus icons, on white with faded edges.
 * The list is rendered four times and the animation moves it by half, so the loop is seamless at any width.
 */
function Plus() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#7DC8F2" strokeWidth="1.6" strokeLinejoin="round" aria-hidden className="shrink-0">
      <path d="M9.5 3.5h5v6h6v5h-6v6h-5v-6h-6v-5h6v-6z" />
    </svg>
  );
}

export function Marquee({ items, className = "" }: { items: string[]; className?: string }) {
  return (
    <div aria-hidden className={`overflow-hidden bg-white py-4 [mask-image:linear-gradient(to_right,transparent,#000_8%,#000_92%,transparent)] [font-family:var(--font-manrope),ui-sans-serif,system-ui,sans-serif] ${className}`}>
      <div className="animate-marquee flex w-max items-center gap-9 whitespace-nowrap text-2xl font-light tracking-tight text-[#6F79C4] [animation-duration:50s] sm:text-3xl">
        {[0, 1, 2, 3].flatMap((c) =>
          items.map((m, i) => (
            <span key={`${c}-${i}`} className="flex items-center gap-9">
              {m}
              <Plus />
            </span>
          )),
        )}
      </div>
    </div>
  );
}
