import { Callout } from "@/components/docs/Callout";
import { CodeTabs } from "@/components/docs/CodeTabs";
import spec from "@/content/openapi.json";
import { API_URL } from "@/lib/site";

// The reference below is generated from the API's own route schemas (see apps/api/src/export-openapi.ts).
type Schema = {
  type?: string | string[];
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  enum?: unknown[];
  format?: string;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  default?: unknown;
  additionalProperties?: Schema | boolean;
  anyOf?: Schema[];
  description?: string;
};
type Param = { name: string; in: string; required?: boolean; schema?: Schema; description?: string };
type Operation = {
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: Param[];
  requestBody?: { content?: { "application/json"?: { schema?: Schema } } };
  responses?: Record<string, { description?: string; content?: { "application/json"?: { schema?: Schema } } }>;
};

const METHODS = ["get", "post", "put", "patch", "delete"] as const;
const TAG_TITLES: Record<string, string> = {
  payment_intents: "Payments",
  refunds: "Refunds",
  webhook_endpoints: "Webhook endpoints",
  balance: "Balance",
  checkout: "Hosted checkout (for custom checkout pages)",
};
const TAG_ORDER = ["payment_intents", "refunds", "webhook_endpoints", "balance", "checkout"];
const METHOD_COLOR: Record<string, string> = { get: "bg-blue-100 text-blue-800", post: "bg-green-100 text-green-800", delete: "bg-red-100 text-red-800", put: "bg-amber-100 text-amber-800", patch: "bg-amber-100 text-amber-800" };

const typeOf = (s: Schema): string => {
  if (s.enum) return s.enum.map((e) => JSON.stringify(e)).join(" | ");
  if (s.anyOf) return s.anyOf.map(typeOf).join(" | ");
  const t = Array.isArray(s.type) ? s.type.join(" | ") : (s.type ?? "any");
  if (t === "array") return `array<${s.items ? typeOf(s.items) : "any"}>`;
  return s.format ? `${t} (${s.format})` : t;
};

const notes = (s: Schema): string => {
  const n: string[] = [];
  if (s.minimum !== undefined) n.push(`min ${s.minimum}`);
  if (s.maximum !== undefined) n.push(`max ${s.maximum}`);
  if (s.minLength !== undefined && s.minLength > 1) n.push(`min length ${s.minLength}`);
  if (s.maxLength !== undefined) n.push(`max length ${s.maxLength}`);
  if (s.pattern) n.push(`pattern ${s.pattern}`);
  if (s.default !== undefined && typeof s.default !== "object") n.push(`default ${JSON.stringify(s.default)}`);
  return n.join(", ");
};

function flatten(s: Schema | undefined, prefix = "", depth = 0): { name: string; type: string; required: boolean; notes: string }[] {
  if (!s?.properties) return [];
  return Object.entries(s.properties).flatMap(([k, v]) => {
    const name = prefix + k;
    const row = { name, type: typeOf(v), required: s.required?.includes(k) ?? false, notes: notes(v) };
    return depth < 2 && v.properties ? [row, ...flatten(v, `${name}.`, depth + 1)] : [row];
  });
}

/** A plausible example value for a request body, built from its schema. Required fields only. */
function example(s: Schema | undefined, key = ""): unknown {
  if (!s) return null;
  if (s.enum) return s.enum[0];
  if (s.anyOf) return example(s.anyOf[0], key);
  const t = Array.isArray(s.type) ? s.type[0] : s.type;
  if (t === "object" || s.properties) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s.properties ?? {})) if (s.required?.includes(k)) out[k] = example(v, k);
    return out;
  }
  if (t === "array") return s.items ? [example(s.items, key)] : [];
  if (t === "integer" || t === "number") return s.minimum ?? 1;
  if (t === "boolean") return true;
  if (key === "amount") return "25500000";
  if (key.endsWith("_address")) return "0xCustomerWalletAddress";
  if (key.endsWith("_id")) return "pi_...";
  if (s.format === "uri") return "https://example.com";
  if (s.format === "email") return "customer@example.com";
  return "string";
}

const renderText = (t: string) =>
  t.split(/(`[^`]+`)/g).map((part, i) => (part.startsWith("`") ? <code key={i}>{part.slice(1, -1)}</code> : <span key={i}>{part}</span>));

function PropTable({ rows }: { rows: ReturnType<typeof flatten> }) {
  if (rows.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
            <th className="px-3 py-1.5 font-medium">Field</th>
            <th className="px-3 py-1.5 font-medium">Type</th>
            <th className="px-3 py-1.5 font-medium">Details</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.name}>
              <td className="whitespace-nowrap px-3 py-1.5 font-mono">
                {r.name}
                {r.required && <span className="ml-1 text-red-600">*</span>}
              </td>
              <td className="px-3 py-1.5 font-mono text-slate-600">{r.type}</td>
              <td className="px-3 py-1.5 text-slate-600">{r.notes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function curlFor(method: string, path: string, op: Operation): string {
  const isCheckout = path.startsWith("/v1/checkout/");
  const lines = [`curl -X ${method.toUpperCase()} "${API_URL}${path.replace(/\{(\w+)\}/g, (_m, n: string) => `<${n}>`)}"`];
  lines.push(isCheckout ? `  -H "x-client-secret: <the payment's client secret>"` : `  -H "Authorization: Bearer $CLEARGATEWAY_API_KEY"`);
  if (op.parameters?.some((p) => p.in === "header" && p.name === "idempotency-key" && p.required)) lines.push(`  -H "Idempotency-Key: <unique per request>"`);
  const body = op.requestBody?.content?.["application/json"]?.schema;
  if (body) {
    lines.push(`  -H "Content-Type: application/json"`);
    lines.push(`  -d '${JSON.stringify(example(body), null, 2)}'`);
  }
  return lines.join(" \\\n");
}

export default function Page() {
  const paths = (spec as { paths: Record<string, Record<string, Operation>> }).paths;
  const ops = Object.entries(paths).flatMap(([path, item]) =>
    METHODS.filter((m) => item[m]).map((m) => ({ path, method: m, op: item[m] as Operation })),
  );
  const groups = TAG_ORDER.map((tag) => ({ tag, ops: ops.filter((o) => o.op.tags?.[0] === tag) })).filter((g) => g.ops.length > 0);
  const anchor = (m: string, p: string) => `${m}-${p.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}`;

  return (
    <>
      <h1>API reference</h1>
      <p>
        Base URL: <code>{API_URL}</code>. All requests and responses are JSON. This page is generated from the API&apos;s own schemas, so it always matches what the API accepts.
      </p>
      <Callout title="Authentication">
        Merchant endpoints use <code>Authorization: Bearer sk_test_…</code>. Hosted-checkout endpoints use the payment&apos;s client secret in an <code>x-client-secret</code> header instead. Money amounts are integer strings in USDC base
        units (6 decimals). See <a href="/docs/errors">Errors, limits &amp; idempotency</a>. A <code>*</code> marks required fields.
      </Callout>

      <div className="flex flex-wrap gap-2 text-sm">
        {groups.map((g) => (
          <a key={g.tag} href={`#${g.tag}`} className="rounded-full border border-slate-200 bg-white px-3 py-1 !no-underline hover:border-brand">
            {TAG_TITLES[g.tag] ?? g.tag}
          </a>
        ))}
      </div>

      {groups.map((g) => (
        <section key={g.tag} id={g.tag}>
          <h2>{TAG_TITLES[g.tag] ?? g.tag}</h2>
          <div className="space-y-4">
            {g.ops.map(({ path, method, op }) => {
              const params = (op.parameters ?? []).filter((p) => p.in !== "header");
              const headerParams = (op.parameters ?? []).filter((p) => p.in === "header" && p.name !== "x-client-secret");
              const body = op.requestBody?.content?.["application/json"]?.schema;
              const okCode = Object.keys(op.responses ?? {}).find((c) => c.startsWith("2"));
              const okSchema = okCode ? op.responses?.[okCode]?.content?.["application/json"]?.schema : undefined;
              return (
                <details key={anchor(method, path)} id={anchor(method, path)} className="group rounded-xl border border-slate-200 bg-white open:shadow-sm">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3">
                    <span className={`rounded px-2 py-0.5 text-xs font-bold uppercase ${METHOD_COLOR[method]}`}>{method}</span>
                    <code className="!bg-transparent !p-0 font-mono text-sm text-slate-900">{path}</code>
                    <span className="text-sm text-slate-500">{op.summary}</span>
                  </summary>
                  <div className="space-y-4 border-t border-slate-100 px-4 py-4">
                    {op.description && <p className="text-sm">{renderText(op.description)}</p>}
                    {headerParams.some((h) => h.required) && (
                      <p className="text-sm">
                        Required header: <code>{headerParams.filter((h) => h.required).map((h) => h.name).join(", ")}</code>
                      </p>
                    )}
                    {params.length > 0 && (
                      <div>
                        <p className="mb-1 text-xs font-semibold uppercase text-slate-500">Path and query parameters</p>
                        <PropTable
                          rows={params.map((p) => ({ name: `${p.name} (${p.in})`, type: p.schema ? typeOf(p.schema) : "string", required: !!p.required, notes: p.schema ? notes(p.schema) : "" }))}
                        />
                      </div>
                    )}
                    {body && (
                      <div>
                        <p className="mb-1 text-xs font-semibold uppercase text-slate-500">Request body</p>
                        <PropTable rows={flatten(body)} />
                      </div>
                    )}
                    <CodeTabs samples={[{ label: "curl", code: curlFor(method, path, op) }]} />
                    {okSchema && (
                      <div>
                        <p className="mb-1 text-xs font-semibold uppercase text-slate-500">Response {okCode}</p>
                        <PropTable rows={flatten(okSchema)} />
                      </div>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}
