#!/usr/bin/env node
// The abyss-harness app bin: load config, boot, open the browser.
// All logic lives in @abyss-harness/app-boot — this file is a thin shell.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv, assertEnv, boot, openBrowser } from '@abyss-harness/app-boot'

// The repo root (three levels up from apps/cli/src) owns .env and cordis.yml.
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
process.chdir(root)
loadEnv(root)
assertEnv(['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'MODEL_NAME'])

const ctx = await boot()

// Service fibers settle a few ticks after the loader resolves (async init),
// so poll briefly for the webserver's bound port before handing off.
let port
for (let i = 0; i < 100 && port === undefined; i++) {
  await new Promise(resolve => setTimeout(resolve, 50))
  port = ctx.get('webServer')?.port
}
if (port !== undefined) {
  openBrowser(`http://127.0.0.1:${port}`)
}
