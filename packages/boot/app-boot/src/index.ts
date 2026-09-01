/**
 * Shared boot glue for the app bin: load the gitignored `.env`, validate
 * required variables, drive the Cordis Loader against a `cordis.yml` until
 * the tree settles, and hand the Web UI URL to the default browser.
 *
 * @module @abyss-harness/app-boot
 */

import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { parseEnv } from 'node:util'
import { Context } from '@abyss-harness/cordis'
import Loader from '@abyss-harness/cordis-plugin-loader'

export interface BootOptions {
  /** Path of the composition root, resolved against the process cwd. */
  configPath?: string
}

/** Load `.env` from the given directory WITHOUT clobbering existing names. */
export function loadEnv(dir: string = process.cwd()): void {
  try {
    const file = parseEnv(readFileSync(dir + '/.env', 'utf8'))
    for (const [name, value] of Object.entries(file)) {
      if (process.env[name] === undefined) process.env[name] = value
    }
  } catch (error: any) {
    if (error.code !== 'ENOENT') throw error
  }
}

/** Assert every required variable is present; exits loudly otherwise. */
export function assertEnv(required: string[]): void {
  for (const name of required) {
    if (!process.env[name]) {
      console.error(`abyss-harness: set ${name} in .env (copy .env.example) or the environment before starting.`)
      process.exit(1)
    }
  }
}

/**
 * Create the root Context, mount the Loader, and compose the application
 * from the config file. Resolves once the tree has settled.
 */
export async function boot(options: BootOptions = {}): Promise<Context> {
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(process.cwd()).href + '/'

  await ctx.plugin(Loader)
  await ctx.loader.create({
    name: '@abyss-harness/cordis-plugin-include',
    config: {
      path: options.configPath ?? './cordis.yml',
    },
  })
  return ctx
}

/** Hand one URL to the operating system's default browser. */
export function openBrowser(url: string): void {
  const opener = process.platform === 'win32'
    ? spawn('cmd.exe', ['/d', '/s', '/c', 'start', '', url], { detached: true, stdio: 'ignore' })
    : process.platform === 'darwin'
      ? spawn('open', [url], { detached: true, stdio: 'ignore' })
      : spawn('xdg-open', [url], { detached: true, stdio: 'ignore' })
  opener.on('error', () => {})
  opener.unref()
}
