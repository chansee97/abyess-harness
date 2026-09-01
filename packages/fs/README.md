# fs/ — filesystem capability

The filesystem domain, mirroring harness's `packages/fs` group: the model-facing
tools and the local provider live together under one capability. This demo ships
the read/write tools; a remote provider (or a sandbox) would slot in beside them
without touching consumers.

| Package | Role |
|---|---|
| `tool-read-file/` | `@abyss-harness/tool-read-file` — model-facing `read` tool |
| `tool-write-file/` | `@abyss-harness/tool-write-file` — model-facing `write` tool |

The registry itself is `@abyss-harness/tools` (packages/core/tools).
