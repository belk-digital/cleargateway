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
    <div className="my-4 overflow-hidden rounded-xl border border-slate-800 bg-slate-900 text-slate-100">
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-1.5">
        <div className="flex gap-1">
          {samples.map((s, idx) => (
            <button
              key={s.label}
              onClick={() => setI(idx)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${idx === i ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button
          className="rounded-md px-2 py-1 text-xs text-slate-400 hover:text-white"
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
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed">
        <code>{cur.code}</code>
      </pre>
    </div>
  );
}

export const Code = ({ children }: { children: string }) => <CodeTabs samples={[{ label: "code", code: children }]} />;
