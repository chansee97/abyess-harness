# sandbox/ — process-sandbox capability family

Mirroring harness's `packages/sandbox` group: the confinement vocabulary and
contract, and the policy home, live together under one capability. This demo
ships no enforcement backend (harness's landlock/bwrap/seatbelt/Windows-ACL
providers are not ported) — confined modes fail closed; consumers pass
`danger-full-access` through untouched.

| Package | Role | ctx key |
|---|---|---|
| `sandbox/` | Mode vocabulary, per-call policy types, and the fail-closed `SandboxProvider` contract | `ctx.sandbox` (abstract — a backend plugin registers on it) |
| `sandbox-policy/` | Resolves the deployment's file-effect mode and workspace root; describes the policy in the system prompt | `ctx.sandboxPolicy` |
