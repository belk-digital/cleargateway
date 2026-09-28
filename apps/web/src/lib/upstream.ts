import "server-only";
import type { Session } from "./session";

export const API_BASE = (process.env.API_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

export const upstreamHeaders = (s: Session): Record<string, string> => ({ authorization: `Bearer ${s.token}` });

export const upstreamPrefix = (kind: Session["kind"]) => (kind === "merchant" ? "/v1" : "/internal/v1");

/** Account calls a signed-in user may make on themselves (everything else under /auth/v1 is public or not for the browser). */
export const AUTH_PATHS = new Set(["password", "me"]);
