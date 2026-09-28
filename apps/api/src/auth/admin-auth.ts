import { createHash, timingSafeEqual } from "node:crypto";
import { adminUsers, type Db } from "@belk/db";
import { AppError, sessionKindOf } from "@belk/shared";
import { eq } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { Config } from "../config.js";
import { resolveAdminSession } from "./sessions.js";

const sha256 = (s: string) => createHash("sha256").update(s).digest();

/**
 * Authentication for the internal API (ClearGateway staff only). Deliberately separate from merchant API keys:
 *  1. `Authorization: Bearer <ADMIN_TOKEN>`: a shared secret from the environment, compared in constant time
 *     (both sides hashed first so lengths match). If ADMIN_TOKEN is not configured, the whole internal API is off.
 *  2. `X-Admin-Email`: must name an existing row in `admin_users`, so every action is attributable to a person
 *     in the audit log rather than to "the token".
 * The internal API is never CORS-enabled (only the checkout origin is), and is meant to sit behind a private network.
 */
export function adminAuth(db: Db, config: Config) {
  return async function authenticate(req: FastifyRequest): Promise<void> {
    const header = req.headers.authorization;
    const presented = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";

    // Preferred: a personal staff session (password + two-factor at sign-in). No shared secret involved.
    if (sessionKindOf(presented) === "admin") {
      const { user } = await resolveAdminSession(db, presented);
      req.admin = { id: user.id, email: user.email };
      return;
    }

    // Legacy/automation path: the shared ADMIN_TOKEN plus a named staff email. Leave ADMIN_TOKEN unset to disable it.
    if (!config.ADMIN_TOKEN) throw new AppError("unauthorized", "Sign in as staff to use the internal API");
    const ok = presented.length > 0 && timingSafeEqual(sha256(presented), sha256(config.ADMIN_TOKEN));
    if (!ok) throw new AppError("unauthorized", "Missing or invalid admin token");

    const email = req.headers["x-admin-email"];
    if (typeof email !== "string" || !email) throw new AppError("forbidden", "X-Admin-Email header is required");
    const [admin] = await db.select().from(adminUsers).where(eq(adminUsers.email, email.toLowerCase())).limit(1);
    if (admin?.disabledAt) throw new AppError("forbidden", "This staff account is disabled");
    if (!admin) throw new AppError("forbidden", "Unknown admin user");
    req.admin = { id: admin.id, email: admin.email };
  };
}

/** Narrowing helper for handlers behind `adminAuth`. */
export function adminOf(req: FastifyRequest): { id: string; email: string; actor: string } {
  if (!req.admin) throw new AppError("unauthorized", "Not authenticated");
  return { ...req.admin, actor: `admin:${req.admin.id}` };
}
