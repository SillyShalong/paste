// Build-time constants injected by vite.config.ts `define`.
declare const __BUILD_DATE__: string;
declare const __GIT_SHA__: string;

interface ImportMetaEnv {
  /// Vite dev/production flag (true under `npm run dev`).
  readonly DEV: boolean;
  readonly TAURI_ENV_DEBUG: string;
  readonly TAURI_ENV_PLATFORM: string;
  readonly TAURI_ENV_ARCH: string;
  readonly TAURI_ENV_OS: string;
  readonly TAURI_ENV_PLATFORM_VERSION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
