/// <reference types="vite/client" />

/**
 * Backend port injected by vite.config.ts `define` (dev only). The PTY
 * WebSocket connects directly to this port to skip the dev proxy. Replaced at
 * build time with a numeric literal; declared via `typeof` guard at the call
 * site so production builds (where it's undefined) don't ReferenceError.
 */
declare const __OPENALICE_DEV_BACKEND_PORT__: number

interface ImportMetaEnv {
  readonly VITE_DEMO_MODE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
