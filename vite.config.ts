import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";

function gitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Build metadata surfaced in the settings About section
  define: {
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
    __GIT_SHA__: JSON.stringify(gitSha()),
  },
  // Vite options tailored for Tauri development
  //
  // 1. prevent Vite from obscuring Rust errors
  clearScreen: false,
  // 2. Tauri expects a fixed port, fail if that port is not available
  server: {
    strictPort: true,
    watch: {
      // cargo builds touch thousands of files under src-tauri/target and
      // lock them; watching that tree crashes chokidar on Windows
      ignored: ["**/src-tauri/**"],
    },
  },
  // 3. to make use of `TAURI_ENV_DEBUG` and other env variables
  // https://v2.tauri.app/reference/environment-variables/
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    // Tauri's WebView2 supports modern ES; target chrome105 keeps output lean
    target: "chrome105",
    minify: "esbuild",
    sourcemap: false,
  },
});
