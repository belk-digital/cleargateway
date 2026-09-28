import { generateApiKey } from "@belk/shared";
import { eq } from "drizzle-orm";
import { createDb } from "./client.js";
import { newId } from "./ids.js";
import { createInvite } from "./auth.js";
import { adminUsers, apiKeys, ledgerAccounts, merchantUsers, merchants, onrampRouting } from "./schema.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed in production");

// Testnet-only placeholder wallet; override with SEED_MERCHANT_WALLET (must be a checksummed address).
const payoutWallet = process.env.SEED_MERCHANT_WALLET ?? "0x000000000000000000000000000000000000dEaD";

const { db, close } = createDb(url);

const encryptionKey = process.env.ENCRYPTION_KEY;
const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? "admin@cleargateway.local").toLowerCase();
const ownerEmail = (process.env.SEED_MERCHANT_EMAIL ?? "owner@merchant.local").toLowerCase();
const invites: { label: string; token: string }[] = [];

const merchantId = newId("mer");
const key = generateApiKey("test");

await db.transaction(async (tx) => {
  await tx.insert(merchants).values({
    id: merchantId,
    legalName: "Test Merchant LLC",
    displayName: "Test Merchant",
    status: "active",
    kybStatus: "approved",
    payoutWalletAddress: payoutWallet,
    feeBps: 200,
    branding: { primary_color: "#0052ff" },
  });
  await tx.insert(apiKeys).values({
    id: newId("key"),
    merchantId,
    mode: "test",
    prefix: key.prefix,
    keyHash: key.hash,
  });
  // Ledger accounts: platform-level + this merchant, test mode.
  // The two platform accounts are shared, so re-running the seed must not fail on them.
  await tx
    .insert(ledgerAccounts)
    .values([
      { id: newId("acc"), type: "customer_payments_clearing", mode: "test" },
      { id: newId("acc"), type: "platform_fee_revenue", mode: "test" },
    ])
    .onConflictDoNothing();
  await tx.insert(ledgerAccounts).values({ id: newId("acc"), type: "merchant_receivable", merchantId, mode: "test" });
  // The first staff account: it cannot sign in until its invite link is accepted (password + authenticator app).
  const [existing] = await tx.select().from(adminUsers).where(eq(adminUsers.email, adminEmail)).limit(1);
  const adminId = existing?.id ?? newId("adm");
  if (!existing) await tx.insert(adminUsers).values({ id: adminId, email: adminEmail });
  if (!existing?.passwordHash) {
    if (!encryptionKey) throw new Error("ENCRYPTION_KEY is required to set up the first staff account");
    invites.push({ label: `staff ${adminEmail}`, token: (await createInvite(tx, { kind: "admin", userId: adminId, purpose: "invite", createdBy: null, encryptionKey })).token });
  }
  // A dashboard owner for the test merchant.
  const ownerId = newId("mus");
  const [ownerTaken] = await tx.select({ id: merchantUsers.id }).from(merchantUsers).where(eq(merchantUsers.email, ownerEmail)).limit(1);
  if (!ownerTaken) {
    await tx.insert(merchantUsers).values({ id: ownerId, merchantId, email: ownerEmail, role: "owner" });
    invites.push({ label: `merchant owner ${ownerEmail}`, token: (await createInvite(tx, { kind: "merchant", userId: ownerId, purpose: "invite", createdBy: null })).token });
  }
  // Default on-ramp routing: the "card via on-ramp" checkout method needs at least one enabled provider.
  // Real providers (Wert/Simplex) are stubs; "mock" is what local dev and tests use.
  await tx.insert(onrampRouting).values({ id: newId("ors"), merchantId, provider: "mock", priority: 0, enabled: true });
});

await close();
console.log(`Seeded merchant ${merchantId}`);
console.log("Test API key (shown once, not stored):");
console.log(key.raw);
console.log("");
console.log("One-time setup links (valid 72 hours, shown once). Open  <web url>/accept?token=<token>  to set a password:");
for (const i of invites) console.log(`  ${i.label}: ${i.token}`);
