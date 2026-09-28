import type { ReactNode } from "react";

const TONE = {
  note: "border-blue-200 bg-blue-50 text-blue-900",
  warn: "border-amber-300 bg-amber-50 text-amber-900",
} as const;

export function Callout({ tone = "note", title, children }: { tone?: keyof typeof TONE; title?: string; children: ReactNode }) {
  return (
    <div className={`my-4 rounded-lg border px-4 py-3 text-sm leading-6 ${TONE[tone]}`}>
      {title && <p className="mb-1 font-semibold">{title}</p>}
      {children}
    </div>
  );
}
