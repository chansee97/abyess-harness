# shell/ — shell execution capability

The shell domain, mirroring harness's `packages/shell` group: execution backends
(`bash-local`, sandboxes) and the model-facing tool. This demo ships the bash
tool; a PTY or sandboxed backend would extend this group.

| Package | Role |
|---|---|
| `tool-bash/` | `@abyss-harness/tool-bash` — model-facing `bash` tool |
