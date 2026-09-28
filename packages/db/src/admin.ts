import type { DbTx } from "./client.js";
import { newId } from "./ids.js";
import { adminAuditLog } from "./schema.js";

/**
 * Appends one entry to the admin audit log. Call it INSIDE the same transaction as the change it describes, so the
 * change and its audit line commit (or roll back) together. Never put secrets in `data`.
 */
export async function recordAdminAudit(
  tx: DbTx,
  input: { adminId: string; action: string; targetType: string; targetId: string; data?: Record<string, unknown> },
): Promise<void> {
  await tx.insert(adminAuditLog).values({
    id: newId("aud"),
    adminId: input.adminId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    data: input.data ?? {},
  });
}
