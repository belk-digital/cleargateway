"use client";
import { useState } from "react";

export interface Sample {
  label: string;
  code: string;
}

/** A code block, optionally with language tabs, and a copy button. Plain text: nothing here is executed. */
export function CodeTabs({ samples }: { samples: Sample[] }) {
  const [i, setI] = useState(0);
  const [copied, setCopied] = useState(false);
  const cur = samples[i] ?? samples[0]!;
  return (
    <div className="my-5 overflow-hidden rounded-2xl border border-white/10 bg-[#0F1A3C] text-sky-50 shadow-[0_16px_40px_rgba(15,26,60,0.25)]">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
        <div className="flex min-w-0 gap-1 overflow-x-auto rounded-lg bg-white/5 p-0.5">
          {samples.map((s, idx) => (
            <button
              key={s.label}
              type="button"
              onClick={() => setI(idx)}
              className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition ${idx === i ? "bg-white text-slate-900" : "text-slate-300 hover:text-white"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-300 transition hover:bg-white/10 hover:text-white"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(cur.code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              /* clipboard unavailable */
            }
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            {copied ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <path d="M9 9h10v10H9zM5 15V5h10" />}
          </svg>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-[12.5px] leading-relaxed text-sky-50/95 sm:text-[13px]">
        <code>{cur.code}</code>
      </pre>
    </div>
  );
}

export const Code = ({ children }: { children: string }) => <CodeTabs samples={[{ label: "code", code: children }]} />;
