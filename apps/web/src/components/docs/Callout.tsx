import type { ReactNode } from "react";

const TONE = {
  note: { box: "border-[#7B86D0]/30 bg-gradient-to-br from-[#EEF0FF] to-[#F6F1FF] text-[#3F4A7A]", icon: "bg-[#7B86D0] text-white", d: "M12 8h.01M11 12h1v5h1" },
  warn: { box: "border-amber-300/70 bg-gradient-to-br from-amber-50 to-orange-50 text-amber-900", icon: "bg-amber-400 text-white", d: "M12 8v5M12 16.5h.01" },
} as const;

export function Callout({ tone = "note", title, children }: { tone?: keyof typeof TONE; title?: string; children: ReactNode }) {
  const t = TONE[tone];
  return (
    <div className={`my-5 flex gap-3 rounded-2xl border p-4 text-sm leading-6 sm:gap-4 sm:p-5 ${t.box}`}>
      <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${t.icon}`}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d={t.d} />
        </svg>
      </span>
      <div className="min-w-0">
        {title && <p className="mb-1 font-semibold">{title}</p>}
        {children}
      </div>
    </div>
  );
}
