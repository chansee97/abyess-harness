import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// katex.min.css declares every font face three times (woff2 + woff + ttf),
// which emits ~1 MB of font files into dist. Every browser KaTeX can render in
// supports woff2 (2016+), so keep only the woff2 src and drop the legacy
// fallback files — fonts go from 1047 kB to 250 kB with identical rendering.
function katexWoff2Only(): Plugin {
  return {
    name: 'katex-woff2-only',
    generateBundle(_, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== 'asset') continue
        if (/KaTeX_[^/]*\.(woff|ttf)$/i.test(file.fileName)) {
          delete bundle[file.fileName]
        } else if (file.fileName.endsWith('.css') && /KaTeX_/.test(String(file.source))) {
          // woff2 is always the first src; strip ",url(...) format(...)" tails
          file.source = String(file.source)
            .replace(/,\s?url\([^)]+\)\s*format\("(?:woff|truetype)"\)/g, '')
        }
      }
    },
  }
}

// No standalone dev server, mirroring harness: the page is always served by
// the backend (single origin), which injects the runtime the shell needs.
// Frontend development is a watch-build (`pnpm dev:web`) that rebuilds
// web-dist/ on source change; the backend stat-polls it and broadcasts a
// reload frame over the event downlink.
export default defineConfig({
  plugins: [react(), katexWoff2Only()],
  build: {
    outDir: '../../web-dist',
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            // Everything from node_modules lands in one hashed vendor chunk so
            // app-only edits don't invalidate third-party code in cache.
            { name: 'vendor', test: /node_modules[\\/]/ },
          ],
        },
      },
    },
    // The vendor chunk carries all of react-dom/shiki/katex/markdown at once
    // (~1.3 MB); calibrate the alert to it instead of silencing blindly.
    chunkSizeWarningLimit: 1400,
  },
})
