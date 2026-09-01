/** bash tool: run one shell command, honoring the sandbox policy. */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Context } from '@abyss-harness/cordis'
import { SandboxProvider, SandboxUnavailableError, type SandboxPolicy } from '@abyss-harness/sandbox'

const execFileAsync = promisify(execFile)

export const name = 'tool-bash'
export const inject = ['tools', 'sandboxPolicy']

export function apply(ctx: Context) {
  ctx.tools.register({
    name: 'bash',
    description:
      'Run one shell command and return stdout/stderr.'
      + ' Commands may run under a file sandbox; a blocked file operation is a policy denial, not a bug in the command.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The command line to run' },
      },
      required: ['command'],
    },
    async execute(args, exec) {
      const command = String(args.command)
      const shell = process.platform === 'win32' ? 'cmd.exe' : 'bash'
      const shellArgs = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-lc', command]
      // The confine contract takes the FULL argv (program plus arguments).
      const shellArgv = [shell, ...shellArgs]
      const policy = ctx.sandboxPolicy.resolve()

      // The confinement seam: a confined mode needs a SandboxProvider backend
      // to wrap the argv. No backend mounted → fail closed (never run
      // unconfined); danger-full-access passes through untouched.
      let argv: readonly string[]
      let denialSignatures: readonly string[] = []
      if (policy.mode === 'danger-full-access') {
        argv = shellArgv
      } else {
        // Optional capability: ctx.get(name, false) returns undefined when no
        // provider plugin is mounted, instead of throwing on the Proxy.
        const provider = ctx.get('sandbox', false) as SandboxProvider | undefined
        if (!provider) throw new SandboxUnavailableError(policy.mode)
        const confined = provider.confine(shellArgv, policy as SandboxPolicy)
        argv = confined.argv
        denialSignatures = confined.denialSignatures
      }

      try {
        const { stdout, stderr } = await execFileAsync(argv[0], argv.slice(1), {
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
          killSignal: 'SIGKILL',
          signal: exec.signal,
        })
        return (stdout + (stderr ? `\n[stderr]\n${stderr}` : '')).trim() || '(no output)'
      } catch (error: any) {
        // A backend-reported file denial is a policy outcome, not a command
        // failure — mark it so the model does not retry around the sandbox.
        if (denialSignatures.length && matchesDenial(error, denialSignatures)) {
          throw new Error(`[sandbox: file access denied under ${policy.mode} mode]`)
        }
        // A timed-out or failing command still returns its partial output.
        if (error.stdout || error.stderr) {
          throw new Error(`exit ${error.code ?? '?'}: ${String(error.stdout ?? '').trim()} ${String(error.stderr ?? '').trim()}`.trim())
        }
        throw error
      }
    },
  })
}

/** Match a failed run's stderr lines against the backend's denial dialect. */
function matchesDenial(error: any, denialSignatures: readonly string[]): boolean {
  const stderr = String(error?.stderr ?? '')
  return stderr
    .split(/\r?\n/)
    .some(line => denialSignatures.some(signature => line.toLowerCase().includes(signature.toLowerCase())))
}
