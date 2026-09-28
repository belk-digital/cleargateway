"use client";
import { useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";

export function PageHeader({ title, children, sub }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {sub && <p className="mt-1 text-sm text-slate-500">{sub}</p>}
      </div>
      <div className="flex gap-2">{children}</div>
    </div>
  );
}

export function Card({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      {title && <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>}
      {children}
    </section>
  );
}

export function Button({ variant = "primary", className = "", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const v = {
    primary: "bg-brand text-white hover:bg-brand-dark",
    secondary: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-100",
    danger: "bg-red-600 text-white hover:bg-red-700",
  }[variant];
  return <button {...p} className={`rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${v} ${className}`} />;
}

export function Field({ label, hint, ...p }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      <input {...p} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand" />
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Select({ label, children, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      <select {...p} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
        {children}
      </select>
    </label>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      {message}
    </p>
  ) : null;
}

export function Notice({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{children}</p>;
}

const TONES: Record<string, string> = {
  succeeded: "bg-green-100 text-green-800",
  active: "bg-green-100 text-green-800",
  approved: "bg-green-100 text-green-800",
  enabled: "bg-green-100 text-green-800",
  ok: "bg-green-100 text-green-800",
  confirming: "bg-blue-100 text-blue-800",
  awaiting_payment: "bg-blue-100 text-blue-800",
  requested: "bg-blue-100 text-blue-800",
  created: "bg-slate-100 text-slate-700",
  pending_kyb: "bg-amber-100 text-amber-800",
  underpaid: "bg-amber-100 text-amber-800",
  mismatch: "bg-amber-100 text-amber-800",
  in_review: "bg-amber-100 text-amber-800",
  expired: "bg-slate-200 text-slate-700",
  canceled: "bg-slate-200 text-slate-700",
  disabled: "bg-slate-200 text-slate-700",
  failed: "bg-red-100 text-red-800",
  suspended: "bg-red-100 text-red-800",
  rejected: "bg-red-100 text-red-800",
  error: "bg-red-100 text-red-800",
};
export function Badge({ value }: { value: string }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[value] ?? "bg-slate-100 text-slate-700"}`}>{value.replace(/_/g, " ")}</span>;
}

export function Table({ head, children, empty }: { head: string[]; children: ReactNode[] | ReactNode; empty?: string }) {
  const rows = Array.isArray(children) ? children.length : children ? 1 : 0;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
      {rows === 0 && <p className="px-3 py-6 text-center text-sm text-slate-500">{empty ?? "Nothing here yet."}</p>}
    </div>
  );
}
export const Td = ({ children, className = "" }: { children?: ReactNode; className?: string }) => <td className={`px-3 py-2.5 align-top ${className}`}>{children}</td>;

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="secondary"
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard unavailable: the value is visible anyway */
        }
      }}
    >
      {done ? "Copied" : label}
    </Button>
  );
}

export const Mono = ({ children }: { children: ReactNode }) => <span className="break-all font-mono text-xs">{children}</span>;
export const shortId = (id: string) => (id.length > 14 ? `${id.slice(0, 7)}…${id.slice(-6)}` : id);
export const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

/** One-time secret display (API keys, webhook secrets). */
export function SecretOnce({ title, value, onDone }: { title: string; value: string; onDone: () => void }) {
  return (
    <Card className="border-amber-300 bg-amber-50">
      <p className="mb-2 text-sm font-semibold text-amber-900">{title}</p>
      <p className="mb-3 text-sm text-amber-900">Copy it now. For your security it cannot be shown again.</p>
      <div className="mb-3 rounded-lg border border-amber-200 bg-white p-3">
        <Mono>{value}</Mono>
      </div>
      <div className="flex gap-2">
        <CopyButton text={value} />
        <Button variant="secondary" onClick={onDone}>
          I have saved it
        </Button>
      </div>
    </Card>
  );
}
