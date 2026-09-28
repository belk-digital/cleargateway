import { intentPublicFields, type IntentRow } from "@belk/db";
import { deriveClientSecret } from "@belk/shared";
import type { z } from "zod";
import type { Config } from "../config.js";
import type { intentResponse } from "../modules/payment-intents/schemas.js";

const OPEN_STATUSES = new Set(["created", "awaiting_payment"]);

/** Unpaid intents past `expires_at` are reported as expired even before the expiry worker records it. */
export function effectiveStatus(row: Pick<IntentRow, "status" | "expiresAt">, now = new Date()): IntentRow["status"] {
  return OPEN_STATUSES.has(row.status) && row.expiresAt < now ? "expired" : row.status;
}

/** Merchant-facing representation: the shared intent view plus the checkout secret and URL. */
export function serializeIntent(row: IntentRow, config: Pick<Config, "CLIENT_SECRET_KEY" | "CHECKOUT_BASE_URL">): z.infer<typeof intentResponse> {
  const clientSecret = config.CLIENT_SECRET_KEY ? deriveClientSecret(config.CLIENT_SECRET_KEY, row.id) : null;
  return {
    ...intentPublicFields(row),
    status: effectiveStatus(row),
    client_secret: clientSecret,
    // Secret in the URL fragment: never sent to servers or written to access logs.
    checkout_url: clientSecret ? `${config.CHECKOUT_BASE_URL}/${row.id}#client_secret=${clientSecret}` : null,
  };
}
