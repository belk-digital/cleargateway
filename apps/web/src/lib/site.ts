/** Base URL shown in documentation examples. */
export const API_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
export const SITE_NAME = "ClearGateway";

/** Social profiles shown in the footer. Each appears only when its NEXT_PUBLIC_SOCIAL_* URL is set. */
export const SOCIALS = [
  { name: "X", href: process.env.NEXT_PUBLIC_SOCIAL_X, d: "M4 4l16 16M20 4L4 20" },
  { name: "LinkedIn", href: process.env.NEXT_PUBLIC_SOCIAL_LINKEDIN, d: "M4 9h4v11H4zM6 4a2 2 0 110 4 2 2 0 010-4zM10 9h4v2c.8-1.4 2.2-2.2 4-2.2 3 0 4 2 4 5V20h-4v-5.5c0-1.3-.5-2.2-1.8-2.2S14 13.200 14 14.500V20h-4z" },
  { name: "Instagram", href: process.env.NEXT_PUBLIC_SOCIAL_INSTAGRAM, d: "M7 3h10a4 4 0 014 4v10a4 4 0 01-4 4H7a4 4 0 01-4-4V7a4 4 0 014-4zM12 8a4 4 0 100 8 4 4 0 000-8zM17.500 6.500h.01" },
  { name: "YouTube", href: process.env.NEXT_PUBLIC_SOCIAL_YOUTUBE, d: "M3 8a3 3 0 013-3h12a3 3 0 013 3v8a3 3 0 01-3 3H6a3 3 0 01-3-3V8zM10 9l5 3-5 3V9z" },
  { name: "Discord", href: process.env.NEXT_PUBLIC_SOCIAL_DISCORD, d: "M8 7c2.500-1 5.500-1 8 0 2 3 3 6 3 9-1.500 1.200-3 1.800-4.500 2l-1-2M8 7c-2 3-3 6-3 9 1.500 1.200 3 1.800 4.500 2l1-2M9 13h.01M15 13h.01" },
] as const;
