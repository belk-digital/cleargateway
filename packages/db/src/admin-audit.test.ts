import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { recordAdminAudit } from "./admin.js";
import { createDb } from "./client.js";
import { newId } from "./ids.js";
import { adminAuditLog, adminUsers } from "./schema.js";

const ctx = createDb(process.env.TEST_DATABASE_URL as string);
afterAll(async () => {
  await ctx.close();
});

describe("admin audit log", () => {
  it("records entries and is append-only (UPDATE and DELETE are blocked by trigger)", async () => {
    const adminId = newId("adm");
    await ctx.db.insert(adminUsers).values({ id: adminId, email: `${adminId}@cleargateway.test` });
    await ctx.db.transaction((tx) => recordAdminAudit(tx, { adminId, action: "merchant.suspend", targetType: "merchant", targetId: "mer_x", data: { from: "active" } }));

    const [row] = await ctx.db.select().from(adminAuditLog).where(eq(adminAuditLog.adminId, adminId));
    expect(row).toMatchObject({ action: "merchant.suspend", targetType: "merchant", targetId: "mer_x", data: { from: "active" } });
    await expect(ctx.db.execute(sql`UPDATE admin_audit_log SET action = 'x' WHERE id = ${row?.id}`)).rejects.toThrow();
    await expect(ctx.db.execute(sql`DELETE FROM admin_audit_log WHERE id = ${row?.id}`)).rejects.toThrow();
  });

  it("commits with the change it describes, or not at all", async () => {
    const adminId = newId("adm");
    await ctx.db.insert(adminUsers).values({ id: adminId, email: `${adminId}@cleargateway.test` });
    await expect(
      ctx.db.transaction(async (tx) => {
        await recordAdminAudit(tx, { adminId, action: "merchant.fee", targetType: "merchant", targetId: "mer_y" });
        throw new Error("the change failed");
      }),
    ).rejects.toThrow("the change failed");
    expect(await ctx.db.select().from(adminAuditLog).where(eq(adminAuditLog.adminId, adminId))).toHaveLength(0);
  });

  it("rejects an entry for an unknown admin", async () => {
    await expect(ctx.db.transaction((tx) => recordAdminAudit(tx, { adminId: "adm_nope", action: "a", targetType: "t", targetId: "i" }))).rejects.toThrow();
  });
});
