/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: { brand: { DEFAULT: "#0052ff", dark: "#003ecb", light: "#e8f0ff" } },
      backgroundImage: {
        "brand-gradient": "linear-gradient(135deg, #0052ff 0%, #4f6bff 45%, #7c8cff 100%)",
        "brand-gradient-text": "linear-gradient(90deg, #0052ff, #6d5bff, #0052ff)",
      },
      keyframes: {
        "gradient-x": { "0%, 100%": { backgroundPosition: "0% 50%" }, "50%": { backgroundPosition: "100% 50%" } },
        marquee: { from: { transform: "translateX(0)" }, to: { transform: "translateX(-50%)" } },
      },
      animation: { "gradient-x": "gradient-x 6s ease infinite", marquee: "marquee 30s linear infinite" },
    },
  },
  plugins: [],
};
