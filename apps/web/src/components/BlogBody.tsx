/** Tiny renderer for the lightweight markdown used in lib/blog.ts posts. */
export function BlogBody({ body }: { body: string }) {
  const blocks = body.trim().split(/\n\s*\n/);
  const out: React.ReactNode[] = [];
  let list: string[] = [];
  const flushList = (key: string) => {
    if (list.length === 0) return;
    out.push(
      <ul key={key} className="my-3 space-y-2 pl-5">
        {list.map((li) => (
          <li key={li} className="list-disc marker:text-[#7B86D0]">
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
        <h2 key={i} className="mt-12 border-t border-[#E3E8FA] pt-8 text-2xl font-medium tracking-[-0.03em] text-[#465078] sm:text-3xl">
          {block.slice(3)}
        </h2>,
      );
    } else if (block.split("\n").every((l) => l.startsWith("- "))) {
      list = block.split("\n").map((l) => l.slice(2));
      flushList(`l${i}`);
    } else {
      flushList(`l${i}`);
      out.push(
        <p key={i} className="text-base leading-8 text-[#4A5578] sm:text-[17px]">
          {block}
        </p>,
      );
    }
  });
  flushList("last");
  return <div className="space-y-4">{out}</div>;
}
