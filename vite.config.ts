import { defineConfig } from "vite";

// Horizon needs cross-origin isolation (SharedArrayBuffer / wasm threads).
// `require-corp`, the policy coi-serviceworker applies on GitHub Pages: every
// tile host used here answers with CORS headers, so it loads under both.
const crossOriginIsolationHeaders = {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
    // Relative asset URLs: the build works under any subpath.
    base: "./",
    // horizon-core spawns its pthread workers from `new URL(..., import.meta.url)`:
    // pre-bundling would move it into .vite/deps and break those URLs.
    optimizeDeps: { exclude: ["@siradel-oss/horizon-core"] },
    worker: { format: "es" },
    build: { target: "es2022" },
    server: { headers: crossOriginIsolationHeaders },
    preview: { headers: crossOriginIsolationHeaders },
});
