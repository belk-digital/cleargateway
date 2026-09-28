import Link from "next/link";

/** Header for the public site (landing and docs). */
export function SiteHeader() {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <Link href="/" className="text-lg font-semibold text-brand">
          ClearGateway
        </Link>
        <nav className="flex gap-4 text-sm text-slate-600">
          <Link href="/docs" className="hover:text-slate-900">
            Docs
          </Link>
          <Link href="/docs/api" className="hover:text-slate-900">
            API reference
          </Link>
          <Link href="/docs/webhooks" className="hover:text-slate-900">
            Webhooks
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <Link href="/dashboard" className="rounded-lg px-3 py-1.5 text-slate-700 hover:bg-slate-100">
            Merchant sign in
          </Link>
          <Link href="/docs/quickstart" className="rounded-lg bg-brand px-3.5 py-1.5 font-medium text-white hover:bg-brand-dark">
            Get started
          </Link>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-slate-500">
        <span>© ClearGateway. Testnet only: no real money moves.</span>
        <span className="flex gap-4">
          <Link href="/docs">Docs</Link>
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/admin">Staff</Link>
        </span>
      </div>
    </footer>
  );
}
