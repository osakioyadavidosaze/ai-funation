import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#12131a",
        panel: "#1a1b24",
        accent: "#a78bfa",
      },
    },
  },
  plugins: [],
};

export default config;
