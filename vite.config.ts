import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import Pages from "vite-plugin-pages";
import { LovinspPlugin } from "lovinsp";
import pkg from "./package.json";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

const lovinspExclude = [/[/\\]src[/\\]components[/\\]ui[/\\]/];

export default defineConfig(async ({ command }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    // lovinsp: dev-only Cmd-click → source jump.
    command === "serve" &&
      LovinspPlugin({
        bundler: "vite",
        hideConsole: true,
        injectTo: [path.resolve(__dirname, "src/main.tsx")],
        exclude: lovinspExclude,
        match: /\.[jt]sx$/,
        skipSnippets: ["htmlScript"],
      }),
    Pages({
      dirs: "src/pages",
      extensions: ["tsx"],
      routeStyle: "next",
    }),
    react(),
    tailwindcss(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 51216,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
}));
