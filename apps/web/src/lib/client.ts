"use client";
import { useCallback, useEffect, useState } from "react";

export type Kind = "merchant" | "admin";
export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T;
  error: string | null;
}

/** Call the ClearGateway API through our server-side proxy (credentials live in an httpOnly cookie). */
export async function call<T = unknown>(kind: Kind, method: string, path: string, body?: unknown, idem?: string): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { "x-cleargateway-csrf": "1" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (idem) headers["idempotency-key"] = idem;
  let res: Response;
  try {
    res = await fetch(`/api/proxy/${kind}/${path.replace(/^\//, "")}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    return { ok: false, status: 0, data: null as T, error: "Network error" };
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (res.status === 401) {
    // Session expired or key revoked: back to the login page.
    window.location.href = kind === "merchant" ? "/dashboard/login" : "/admin/login";
  }
  const e = (data as { error?: { message?: string } } | null)?.error;
  return { ok: res.ok, status: res.status, data: data as T, error: res.ok ? null : (e?.message ?? `Request failed (${res.status})`) };
}

/** GET a resource and keep it in state. `reload()` refetches. */
export function useGet<T>(kind: Kind, path: string | null) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: path !== null });
  const load = useCallback(async () => {
    if (path === null) return;
    setState((s) => ({ ...s, loading: true }));
    const r = await call<T>(kind, "GET", path);
    setState({ data: r.ok ? r.data : null, error: r.error, loading: false });
  }, [kind, path]);
  useEffect(() => {
    void load();
  }, [load]);
  return { ...state, reload: load };
}

export async function logout(kind: Kind): Promise<void> {
  await fetch(`/api/session/${kind}`, { method: "DELETE", headers: { "x-cleargateway-csrf": "1" } });
  window.location.href = kind === "merchant" ? "/dashboard/login" : "/admin/login";
}

export interface List<T> {
  object: "list";
  data: T[];
  has_more?: boolean;
  next_cursor?: string | null;
}
