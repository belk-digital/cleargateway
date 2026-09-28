import type { Db } from "@belk/db";
import type { OnrampProvider, OnrampProviderName } from "@belk/onramp";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { getAddress, isAddress } from "viem";
import { z } from "zod";
import type { Config } from "../../config.js";
import type { ChainBlockReader } from "../../lib/chain-reader.js";
import type { IntentSigner } from "../../signer/index.js";
import { checkoutStatus, createOnrampSession, createOrGetDepositAddress, createWalletPayment, loadIntentWithSecret, publicCheckoutView } from "./service.js";

interface Opts {
  db: Db;
  config: Config;
  signer: IntentSigner | undefined;
  chain: ChainBlockReader | undefined;
  onrampProviders: Record<OnrampProviderName, OnrampProvider>;
}

const TERMINAL = new Set(["succeeded", "expired", "failed", "canceled", "refunded", "partially_refunded"]);
const SSE_POLL_MS = 2000;
const SSE_MAX_MS = 10 * 60 * 1000;

const params = z.object({ intentId: z.string().regex(/^pi_[0-9a-f]{32}$/) }).strict();
const secretQuery = z.object({ client_secret: z.string().max(200).optional() }).strict();
const secretHeader = z.object({ "x-client-secret": z.string().max(200).optional() }).passthrough();

const payerAddress = z
  .string()
  .refine((v) => isAddress(v, { strict: true }), "must be a valid EVM address (mixed-case addresses must have a correct checksum)")
  .transform((v) => getAddress(v));

const walletPaymentBody = z
  .object({ payer_address: payerAddress, method: z.enum(["approve", "authorization"]).default("approve") })
  .strict();

const onrampSessionBody = z
  .object({ customer_wallet_address: payerAddress, customer_email: z.string().email().max(320).optional() })
  .strict();

const description =
  "Public endpoint scoped to one intent. Authenticate with the intent's client secret via the `x-client-secret` header " +
  "(or `client_secret` query parameter for EventSource, which cannot set headers).";

export const checkoutRoutes: FastifyPluginAsync<Opts> = async (instance, { db, config, signer, chain, onrampProviders }) => {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/checkout/:intentId",
    {
      schema: {
        tags: ["checkout"],
        summary: "Public-safe fields for rendering checkout",
        description,
        params,
        querystring: secretQuery,
        headers: secretHeader,
      },
    },
    async (req) => {
      const row = await loadIntentWithSecret(db, req.params.intentId, req.headers["x-client-secret"] ?? req.query.client_secret);
      return publicCheckoutView(db, row, config);
    },
  );

  app.post(
    "/checkout/:intentId/wallet-payment",
    {
      schema: {
        tags: ["checkout"],
        summary: "Get the signed payload for paying from a connected wallet",
        description:
          description +
          " `method=approve` returns approval + `pay` arguments; `method=authorization` returns EIP-3009 typed data " +
          "for a one-signature payment via `payWithAuthorization`.",
        params,
        querystring: secretQuery,
        headers: secretHeader,
        body: walletPaymentBody,
      },
    },
    async (req) => {
      const row = await loadIntentWithSecret(db, req.params.intentId, req.headers["x-client-secret"] ?? req.query.client_secret);
      return createWalletPayment(db, { config, signer }, row.id, {
        payer: req.body.payer_address as `0x${string}`,
        method: req.body.method,
      });
    },
  );

  app.post(
    "/checkout/:intentId/deposit-address",
    {
      schema: {
        tags: ["checkout"],
        summary: "Get (or create) a per-payment deposit address for sending USDC from an exchange",
        description:
          description +
          " Idempotent: returns the same address on every call. The customer sends USDC on Base to this address; " +
          "the platform detects, confirms and settles the payment automatically, with no signature from the customer.",
        params,
        querystring: secretQuery,
        headers: secretHeader,
      },
    },
    async (req) => {
      const row = await loadIntentWithSecret(db, req.params.intentId, req.headers["x-client-secret"] ?? req.query.client_secret);
      return createOrGetDepositAddress(db, { config, chain }, row.id);
    },
  );

  app.post(
    "/checkout/:intentId/onramp-session",
    {
      schema: {
        tags: ["checkout"],
        summary: "Create a card / Apple Pay on-ramp session (Wert primary, Simplex secondary; provider picked per merchant)",
        description:
          description +
          " The on-ramp delivers USDC to `customer_wallet_address`, which must belong to the customer (never the " +
          "merchant's payout wallet, the splitter, or the USDC contract). That wallet then pays through " +
          "`/wallet-payment` once funded; this endpoint never marks the intent paid.",
        params,
        querystring: secretQuery,
        headers: secretHeader,
        body: onrampSessionBody,
      },
    },
    async (req) => {
      const row = await loadIntentWithSecret(db, req.params.intentId, req.headers["x-client-secret"] ?? req.query.client_secret);
      return createOnrampSession(db, { config, providers: onrampProviders }, row.id, {
        customerWalletAddress: req.body.customer_wallet_address as `0x${string}`,
        customerEmail: req.body.customer_email,
      });
    },
  );

  app.get(
    "/checkout/:intentId/status",
    { schema: { tags: ["checkout"], summary: "Poll payment status", description, params, querystring: secretQuery, headers: secretHeader } },
    async (req) => {
      const row = await loadIntentWithSecret(db, req.params.intentId, req.headers["x-client-secret"] ?? req.query.client_secret);
      return { ...(await checkoutStatus(db, row.id)), required_confirmations: config.CONFIRMATIONS };
    },
  );

  app.get(
    "/checkout/:intentId/status/stream",
    {
      schema: {
        tags: ["checkout"],
        summary: "Server-sent events stream of status changes",
        description: description + " Emits `status` events on change and closes once the payment reaches a final state.",
        params,
        querystring: secretQuery,
        headers: secretHeader,
      },
    },
    async (req, reply) => {
      const row = await loadIntentWithSecret(db, req.params.intentId, req.headers["x-client-secret"] ?? req.query.client_secret);
      const id = row.id;

      // Take over the raw response; keep headers (CORS, request id) already set by hooks.
      reply.hijack();
      reply.raw.writeHead(200, {
        ...reply.getHeaders(),
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      } as Record<string, string>);

      let last = "";
      let closed = false;
      const startedAt = Date.now();
      const finish = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        reply.raw.end();
      };
      const tick = async () => {
        try {
          const s = await checkoutStatus(db, id);
          const payload = JSON.stringify({ ...s, required_confirmations: config.CONFIRMATIONS });
          if (payload !== last) {
            last = payload;
            reply.raw.write(`event: status\ndata: ${payload}\n\n`);
          } else {
            reply.raw.write(": keep-alive\n\n");
          }
          if (TERMINAL.has(s.status) || Date.now() - startedAt > SSE_MAX_MS) finish();
        } catch (err) {
          req.log.warn({ err }, "sse status poll failed");
          finish();
        }
      };
      const timer = setInterval(() => void tick(), SSE_POLL_MS);
      req.raw.on("close", finish);
      await tick();
    },
  );
};
