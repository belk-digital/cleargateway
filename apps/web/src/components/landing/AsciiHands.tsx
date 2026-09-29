"use client";
import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "framer-motion";
import { useEffect, useRef } from "react";

/**
 * Desktop-only "hands off your money" section. Two hand photos are converted to a grid of digits on a canvas: the
 * silhouette comes from each image's alpha, brightness from its luminance. The hands slide together as the section
 * scrolls in, characters shimmer and swap, a light band sweeps across, and characters near the cursor scramble.
 *
 * Nothing is fetched or run below 1024px, and the loop only runs while the canvas is on screen.
 * The section background can be swapped by dropping a file at /public/ascii-hands-bg.webp.
 */

const FONT =
  "[font-family:var(--font-manrope),ui-sans-serif,system-ui,sans-serif]";
const RAMP = ["1", "7", "3", "2", "0", "5", "9", "8"];
const BUCKETS = 6;
const CANVAS_H = 480;
// Where each hand's fingertip sits inside its own image, as a fraction of the image (measured from the artwork).
const LEFT_TIP = { x: 0.928, y: 0.64 };
const RIGHT_TIP = { x: 0.108, y: 0.45 };

type Cell = {
  x: number;
  y: number;
  g: number;
  base: number;
  bucket: number;
  a: number;
};
type Hand = { cells: Cell[]; buckets: Cell[][]; w: number; h: number };

/** Samples an image into a character grid (cols x rows), keeping only cells that fall inside the hand. */
function buildHand(
  img: HTMLImageElement,
  width: number,
  cw: number,
  ch: number,
): Hand {
  const cols = Math.max(1, Math.floor(width / cw));
  const height = width * (img.naturalHeight / img.naturalWidth);
  const rows = Math.max(1, Math.floor(height / ch));
  const off = document.createElement("canvas");
  off.width = cols;
  off.height = rows;
  const octx = off.getContext("2d", { willReadFrequently: true })!;
  octx.drawImage(img, 0, 0, cols, rows);
  const data = octx.getImageData(0, 0, cols, rows).data;
  const cells: Cell[] = [];
  const buckets: Cell[][] = Array.from({ length: BUCKETS }, () => []);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = (r * cols + c) * 4;
      const a = data[i + 3]! / 255;
      if (a < 0.4) continue;
      const lum =
        (0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!) / 255;
      const b = Math.min(1, Math.max(0, (lum - 0.12) / 0.72)) ** 0.9;
      const base = Math.round(b * (RAMP.length - 1));
      const bucket = Math.min(BUCKETS - 1, Math.floor(b * BUCKETS));
      const cell: Cell = {
        x: c * cw + cw / 2,
        y: r * ch + ch / 2,
        g: base,
        base,
        bucket,
        a,
      };
      cells.push(cell);
      buckets[bucket]!.push(cell);
    }
  }
  return { cells, buckets, w: cols * cw, h: rows * ch };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Small glass label naming who a hand represents. */
function Tag({
  icon,
  children,
  className = "",
}: {
  icon: string;
  children: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border border-white/80 bg-white px-4 py-2 text-sm font-semibold text-[#4B4BE6] shadow-[0_8px_30px_rgba(30,20,120,0.25)] ${className}`}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d={icon} />
      </svg>
      {children}
    </span>
  );
}

const ICON_PERSON = "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0";
const ICON_STORE =
  "M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9a2.700 2.700 0 005.300 0 2.700 2.700 0 005.400 0A2.700 2.700 0 0020 9M10 20v-6h4v6";

export function AsciiHands() {
  const reduce = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start end", "center center"],
  });
  const progress = useSpring(scrollYProgress, {
    stiffness: 70,
    damping: 22,
    mass: 0.6,
  });
  const coinScale = useTransform(progress, [0.55, 0.95], [0, 1]);
  const coinOpacity = useTransform(progress, [0.55, 0.85], [0, 1]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const mq = window.matchMedia("(min-width: 1024px)");
    let teardown: (() => void) | undefined;

    const start = () => {
      let cancelled = false;
      let raf = 0;
      let visible = false;
      let last = 0;
      const pointer = { x: -9999, y: -9999 };
      let left: Hand | null = null;
      let right: Hand | null = null;
      let geo = { sw: 0, W: 0, cw: 6, ch: 8, ly: 0, ry: 0 };
      const ctx = canvas.getContext("2d")!;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      let images: [HTMLImageElement, HTMLImageElement] | null = null;

      const layout = () => {
        if (!images) return;
        const sw = canvas.clientWidth;
        canvas.width = Math.round(sw * dpr);
        canvas.height = Math.round(CANVAS_H * dpr);
        const W = sw * 0.495;
        const cw = Math.max(5, Math.round(W / 104));
        const ch = Math.round(cw * 1.3);
        left = buildHand(images[0], W, cw, ch);
        right = buildHand(images[1], W, cw, ch);
        const tipY = CANVAS_H * 0.5;
        geo = {
          sw,
          W,
          cw,
          ch,
          ly: tipY - LEFT_TIP.y * left.h,
          ry: tipY - RIGHT_TIP.y * right.h,
        };
      };

      const drawHand = (
        hand: Hand,
        ox: number,
        oy: number,
        t: number,
        sweep: number,
        animated: boolean,
      ) => {
        ctx.save();
        ctx.translate(ox, oy);
        for (let b = 0; b < BUCKETS; b++) {
          const shimmer = animated
            ? 0.9 + 0.1 * Math.sin(t * 1.6 + b * 1.3)
            : 1;
          ctx.globalAlpha = (0.5 + 0.5 * (b / (BUCKETS - 1))) * shimmer;
          ctx.fillStyle = b === BUCKETS - 1 ? "#E6F8FF" : "#FFFFFF";
          for (const c of hand.buckets[b]!) ctx.fillText(RAMP[c.g]!, c.x, c.y);
        }
        if (animated) {
          // A diagonal light band and the cursor halo redraw a subset of cells brighter, in cyan.
          ctx.fillStyle = "#9FEBFF";
          for (const c of hand.cells) {
            const band = Math.abs(c.x + c.y * 0.45 - sweep);
            const dx = c.x + ox - pointer.x;
            const dy = c.y + oy - pointer.y;
            const near = dx * dx + dy * dy < 4900;
            if (band < 26 || near) {
              ctx.globalAlpha = near ? 0.95 : 0.85 * (1 - band / 26);
              ctx.fillText(
                near ? RAMP[(Math.random() * RAMP.length) | 0]! : RAMP[c.g]!,
                c.x,
                c.y,
              );
            }
          }
        }
        ctx.restore();
      };

      const frame = (t: number, animated: boolean) => {
        if (!left || !right) return;
        const p = animated ? progress.get() : 1;
        const spread = (1 - p) * geo.sw * 0.13;
        const bob = animated ? Math.sin(t * 0.9) * 5 : 0;
        // The fingertips sit slightly right of centre in the artwork; nudge both hands so the gap is centred.
        const centre = (LEFT_TIP.x - (1 - RIGHT_TIP.x)) * 0.5 * geo.W;
        const gap = 46; // extra room either side for the ClearGateway pill
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, geo.sw, CANVAS_H);
        ctx.font = `700 ${geo.ch * 0.95}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const sweep = animated
          ? ((t * 140) % (geo.W * 1.9)) - geo.W * 0.3
          : -9999;
        drawHand(
          left,
          -spread - centre - gap,
          geo.ly + bob,
          t,
          sweep,
          animated,
        );
        drawHand(
          right,
          geo.sw - geo.W + spread - centre + gap,
          geo.ry - bob,
          t,
          geo.W * 1.9 - sweep,
          animated,
        );
        if (animated) {
          // Swap a few characters each frame so the hands feel alive.
          for (const hand of [left, right]) {
            const n = Math.ceil(hand.cells.length * 0.015);
            for (let i = 0; i < n; i++) {
              const c = hand.cells[(Math.random() * hand.cells.length) | 0]!;
              c.g = Math.min(
                RAMP.length - 1,
                Math.max(0, c.base + (((Math.random() * 3) | 0) - 1)),
              );
            }
          }
        }
      };

      const loop = (now: number) => {
        raf = requestAnimationFrame(loop);
        if (!visible || now - last < 28) return;
        last = now;
        frame(now / 1000, true);
      };

      const io = new IntersectionObserver(([e]) => {
        visible = !!e?.isIntersecting;
      });
      io.observe(canvas);
      const onMove = (e: MouseEvent) => {
        const r = canvas.getBoundingClientRect();
        pointer.x = e.clientX - r.left;
        pointer.y = e.clientY - r.top;
      };
      const onLeave = () => {
        pointer.x = pointer.y = -9999;
      };
      const section = sectionRef.current;
      section?.addEventListener("mousemove", onMove);
      section?.addEventListener("mouseleave", onLeave);
      const ro = new ResizeObserver(() => {
        layout();
        if (reduce) frame(0, false);
      });
      ro.observe(canvas);

      Promise.all([
        loadImage("/ascii/left-hand.webp"),
        loadImage("/ascii/right-hand.webp"),
      ])
        .then((imgs) => {
          if (cancelled) return;
          images = [imgs[0], imgs[1]];
          layout();
          if (reduce) frame(0, false);
          else raf = requestAnimationFrame(loop);
        })
        .catch(() => {
          /* images missing: leave the section empty rather than break the page */
        });

      return () => {
        cancelled = true;
        cancelAnimationFrame(raf);
        io.disconnect();
        ro.disconnect();
        section?.removeEventListener("mousemove", onMove);
        section?.removeEventListener("mouseleave", onLeave);
      };
    };

    const sync = () => {
      teardown?.();
      teardown = mq.matches ? start() : undefined;
    };
    sync();
    mq.addEventListener("change", sync);
    return () => {
      mq.removeEventListener("change", sync);
      teardown?.();
    };
  }, [reduce, progress]);

  return (
    <section
      ref={sectionRef}
      className={`relative hidden overflow-hidden text-white lg:block ${FONT}`}
      style={{
        backgroundImage:
          "url(/ascii-hands-bg.webp), linear-gradient(135deg, #4B4BE6 0%, #6B5BF0 55%, #7B6BF5 100%)",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div className="relative mx-auto max-w-[88rem] px-8 pt-20 text-center">
        <p className="text-xs font-medium uppercase tracking-[0.35em] text-white/85">
          Non-custodial
        </p>
        <span className="mx-auto mt-3 block h-px w-10 bg-white/70" />
        <h2 className="mx-auto mt-7 max-w-3xl text-6xl font-medium leading-[1.1] tracking-[-0.04em]">
          Hands off{" "}
          <span className="bg-gradient-to-r from-[#7FE8FF] via-white to-[#F2B8FF] bg-clip-text text-transparent">
            your money.
          </span>
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-lg leading-8 text-white/85">
          The payment goes from your customer straight to your wallet.
          ClearGateway never holds it in between.
        </p>
      </div>

      <div className="relative mt-4" style={{ height: CANVAS_H }}>
        <canvas
          ref={canvasRef}
          aria-hidden
          className="absolute inset-0 h-full w-full"
        />
        {/* ClearGateway, dead centre between the fingertips, styled like the navbar logo */}
        <div
          aria-hidden
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        >
          <motion.div
            style={{ scale: coinScale, opacity: coinOpacity }}
            className="relative"
          >
            <span className="absolute inset-0 -m-4 rounded-full bg-white/30 blur-xl" />
            <span className="relative flex items-center gap-2.5 rounded-full border border-white/80 bg-white py-2.5 pl-3 pr-5 shadow-[0_12px_40px_rgba(30,20,120,0.35)]">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[#7FE8FF] via-[#5B8CF0] to-[#7A6BFF] shadow-md shadow-indigo-500/30">
                <span className="h-3 w-3 rounded-[3px] bg-white/95" />
              </span>
              <span className="bg-gradient-to-r from-[#3F6FE8] to-[#7A6BFF] bg-clip-text text-xl font-bold tracking-[-0.03em] text-transparent">
                ClearGateway
              </span>
            </span>
          </motion.div>
        </div>
        <motion.div
          style={{ opacity: coinOpacity }}
          className="absolute left-[7%] top-2"
        >
          <Tag icon={ICON_PERSON}>Customer</Tag>
        </motion.div>
        <motion.div
          style={{ opacity: coinOpacity }}
          className="absolute right-[7%] top-[120px]"
        >
          <Tag icon={ICON_STORE}>Merchant</Tag>
        </motion.div>
      </div>
    </section>
  );
}
