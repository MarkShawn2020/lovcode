import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import Pages from "vite-plugin-pages";
import { LovinspPlugin } from "lovinsp";
import pkg from "./package.json";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

const lovinspExclude = [
  // Keep source jumps on feature/page call sites instead of shadcn/ui primitives.
  /[/\\]src[/\\]components[/\\]ui[/\\]/,
];

// https://vite.dev/config/
export default defineConfig(async () => ({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    LovinspPlugin({
      bundler: "vite",
      hideConsole: true,
      injectTo: [
        path.resolve(__dirname, "src/main.tsx"),
      ],
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
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 51216,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
        protocol: "ws",
        host,
        port: 1421,
      }
      : undefined,
    watch: {
      // 3. keep dev-server file watching away from generated/heavy directories
      ignored: [
        "**/src-tauri/**",
        "**/target/**",
        "**/third-parties/**",
        "**/dist/**",
        "**/output/**",
      ],
    },
  },
}));
