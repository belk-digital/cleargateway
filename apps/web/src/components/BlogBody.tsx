/** Tiny renderer for the lightweight markdown used in lib/blog.ts posts. */
export function BlogBody({ body }: { body: string }) {
  const blocks = body.trim().split(/\n\s*\n/);
  const out: React.ReactNode[] = [];
  let list: string[] = [];
  const flushList = (key: string) => {
    if (list.length === 0) return;
    out.push(
      <ul key={key} className="my-3 space-y-1 pl-5">
        {list.map((li) => (
          <li key={li} className="list-disc">
            {li}
          </li>
        ))}
      </ul>,
    );
    list = [];
  };
  blocks.forEach((block, i) => {
    if (block.startsWith("## ")) {
      flushList(`l${i}`);
      out.push(
        <h2 key={i} className="mt-8 text-xl font-semibold text-slate-900">
          {block.slice(3)}
        </h2>,
      );
    } else if (block.split("\n").every((l) => l.startsWith("- "))) {
      list = block.split("\n").map((l) => l.slice(2));
      flushList(`l${i}`);
    } else {
      flushList(`l${i}`);
      out.push(
        <p key={i} className="leading-7 text-slate-700">
          {block}
        </p>,
      );
    }
  });
  flushList("last");
  return <div className="space-y-4">{out}</div>;
}
