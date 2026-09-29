/** Soft pastel wave that fades out down the page, used behind the docs and blog headers. Decorative only. */
export function PageBackdrop({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-x-0 top-0 -z-10 h-[36rem] bg-[url(/gradient-bg.webp)] bg-cover bg-top opacity-80 [mask-image:linear-gradient(to_bottom,#000_35%,transparent)] ${className}`}
    />
  );
}
