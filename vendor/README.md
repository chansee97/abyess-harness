# Vendored Packages

This directory contains source-vendored copies of the Cordis framework and its foundation libraries, copied into this monorepo instead of being depended on via npm so that the demo fully owns its framework layer (auditable, patchable, pinned) — the same policy as deepseek-harness.

All vendored packages are **renamed into the `@abyss-harness` scope** (`cordis` → `@abyss-harness/cordis`, `@cordisjs/plugin-<x>` → `@abyss-harness/cordis-plugin-<x>`). Directory names and upstream version numbers are deliberately unchanged, so the manifest below still reads as an upstream snapshot. `pnpm-workspace.yaml#linkWorkspacePackages` makes the preserved semver ranges resolve to these pinned workspaces. The root `package.json` declares every vendored/product name as a devDependency so the Cordis Loader — which resolves plugin specifiers against the process cwd — finds them in the root `node_modules`.

**Build-free difference from harness:** harness compiles each package to `lib/` and publishes; this demo has no build step. Every vendored `package.json` points `main` directly at `./src/index.ts`, and tsx executes TypeScript on the fly. Type resolution goes through the root `tsconfig.base.json` `paths`, which maps each name to its source — mirroring harness's paths facade without per-package project references.

## Manifest

Upstream workspace: https://github.com/cordiverse/cordis (single commit supplies all packages: `f46ae95` = core 4.0.0-rc.8, loader 1.0.0-rc.5, include 1.0.4, hmr 1.0.15, timer 1.1.2, logger-console/group 1.0.0).

| Directory | Package name | Upstream name | Version | Source |
|---|---|---|---|---|
| `cosmokit/` | `@abyss-harness/cosmokit` | `cosmokit` | 1.8.1 | npm tarball (`src/`) |
| `schemastery/` | `@abyss-harness/schemastery` | `schemastery` | 3.18.0 | npm tarball (`src/`) |
| `cordis/` | `@abyss-harness/cordis` | `cordis` (`packages/core`) | 4.0.0-rc.8 | git `f46ae95` |
| `loader/` | `@abyss-harness/cordis-plugin-loader` | `@cordisjs/plugin-loader` | 1.0.0-rc.5 | git `f46ae95` |
| `include/` | `@abyss-harness/cordis-plugin-include` | `@cordisjs/plugin-include` | 1.0.4 | git `f46ae95` |
| `group/` | `@abyss-harness/cordis-plugin-group` | `@cordisjs/plugin-group` | 1.0.0 | git `f46ae95` |
| `timer/` | `@abyss-harness/cordis-plugin-timer` | `@cordisjs/plugin-timer` | 1.1.2 | git `f46ae95` |
| `hmr/` | `@abyss-harness/cordis-plugin-hmr` | `@cordisjs/plugin-hmr` | 1.0.15 | git `f46ae95` |
| `logger-console/` | `@abyss-harness/cordis-plugin-logger-console` | `@cordisjs/plugin-logger-console` | 1.0.0 | git `f46ae95` |

Third-party dependencies of the vendored packages stay on npm: `@standard-schema/spec`, `js-yaml`, `chokidar`, `picomatch`, `@babel/code-frame`, `supports-color`.

## Local modifications

Keep this log exhaustive — every divergence from upstream must be listed.

1. **All `package.json` files**: regenerated — `private: true`, scoped `@abyss-harness/*` names, `main: ./src/index.ts` (build-free), dependency ranges rewritten to the `@abyss-harness` workspace names. Third-party ranges preserved.
2. **Internal import specifiers**: bare imports rewritten to the `@abyss-harness` scope; relative imports given explicit `.ts` extensions (imports and `declare module './context'` → `'./context.ts'`). Mirrors harness modification #4 and fixes resolution for both tsc (bundler mode over extensionless d.ts re-exports) and tsx.
3. **`hmr/src/index.ts`**: removed the `./locales/*.yml.ts` imports and the `.i18n({...})` call on the Config schema; deleted `src/locales/`. Mirrors harness modification #1 (those imports need a runtime YAML loader hook we do not vendor).
4. **`logger-console/src/*.ts`**: relative `'./shared.js'` specifiers rewritten to `'./shared.ts'` (the shipped `.js` spelling targets built output; our sources run as TS).

## Sync procedure

To update a vendored package from upstream:

1. Note the target commit/tag in the cordiverse/cordis repo (or the npm tarball version).
2. Copy the package's `src/` over the vendored directory.
3. Re-apply the local modifications above (or drop them if upstream made them unnecessary — update the log either way).
4. Update the version/source column in the manifest table.
5. Run `pnpm install && pnpm typecheck && pnpm dev` at the repo root.
