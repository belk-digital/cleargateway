// Cover art is generated from the post's position, so posts get distinct covers without image assets.
const COVERS = ["from-[#8C95DC] via-[#7B86D0] to-[#5B5BF0]", "from-[#7FC8F2] via-[#7B9BE0] to-[#7B86D0]", "from-[#B9A6F5] via-[#8C95DC] to-[#6F79C4]", "from-[#9BE3FF] via-[#7DB2F0] to-[#7B86D0]"];

export function Cover({ i, tall, fill }: { i: number; tall?: boolean; fill?: boolean }) {
  return (
    <div className={`relative overflow-hidden bg-gradient-to-br ${COVERS[i % COVERS.length]} ${tall ? "h-52 sm:h-full sm:min-h-[16rem]" : fill ? "h-36 sm:h-full sm:min-h-[9rem]" : "h-36"}`}>
      <div aria-hidden className="absolute -right-8 -top-8 h-40 w-40 rounded-full bg-white/30 blur-2xl transition-transform duration-700 group-hover/spot:scale-150" />
      <div aria-hidden className="absolute -bottom-10 left-8 h-32 w-32 rounded-[40%] bg-white/25 blur-xl transition-transform duration-700 group-hover/spot:translate-x-4" />
      <div aria-hidden className="absolute inset-x-6 bottom-5 h-px bg-white/40" />
    </div>
  );
}
