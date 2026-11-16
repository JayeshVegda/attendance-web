import { spawn, exec } from 'node:child_process'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'

const root = resolve(import.meta.dirname, '..')
const pbPort = Number(process.env.PB_PORT || 8091)
const appPort = Number(process.env.PORT || 5173)
const pbUrl = `http://127.0.0.1:${pbPort}`
const appUrl = `http://127.0.0.1:${appPort}`
process.env.VITE_PB_URL ??= pbUrl

let pocketbase = null
let vite = null

function getPocketBaseBin() {
  if (process.env.POCKETBASE_BIN) return process.env.POCKETBASE_BIN
  const localWin = resolve(root, 'pb', 'pocketbase.exe')
  if (process.platform === 'win32' && existsSync(localWin)) return localWin
  const localUnix = resolve(root, 'pb', 'pocketbase')
  if (existsSync(localUnix)) return localUnix
  return 'pocketbase'
}

async function running(url) {
  try {
    const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(600) })
    return response.ok
  } catch {
    return false
  }
}

async function waitFor(url, maxAttempts = 60) {
  for (let i = 0; i < maxAttempts; i += 1) {
    if (await running(url)) return true
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

function stop() {
  vite?.kill('SIGTERM')
  pocketbase?.kill('SIGTERM')
}

function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      exec(`start "" "${url}"`)
    } else if (process.platform === 'darwin') {
      exec(`open "${url}"`)
    } else {
      exec(`xdg-open "${url}"`)
    }
  } catch {
    // Non-fatal if browser cannot be automatically opened
  }
}

const pbBin = getPocketBaseBin()

// Start PocketBase if not already running
if (!(await running(pbUrl))) {
  pocketbase = spawn(
    pbBin,
    [
      'serve',
      `--http=127.0.0.1:${pbPort}`,
      '--dir=pb/pb_data',
      '--publicDir=pb/pb_public',
      '--migrationsDir=pb/pb_migrations',
    ],
    { cwd: root, stdio: 'inherit' },
  )

  if (!(await waitFor(pbUrl))) {
    stop()
    throw new Error(`PocketBase did not start on ${pbUrl}. Check permissions or executable path: ${pbBin}`)
  }
}

// Start Vite dev server for live development
const pnpmCmd = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
vite = spawn(pnpmCmd, ['dev', '--host', '127.0.0.1', '--port', String(appPort)], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
})

console.log(`\n===========================================`)
console.log(`  Attendance & Salary is RUNNING!`)
console.log(`  Local App:      ${appUrl}`)
console.log(`  Standalone App: ${pbUrl}`)
console.log(`  Database API:   ${pbUrl}/api/`)
console.log(`===========================================\n`)

// Wait for app to be ready, then launch browser
;(async () => {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(appUrl, { signal: AbortSignal.timeout(400) })
      if (res.ok) {
        console.log(`Launching default browser at ${appUrl}...`)
        openBrowser(appUrl)
        break
      }
    } catch {
      // Waiting for vite to listen
    }
    await new Promise((r) => setTimeout(r, 250))
  }
})()

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    stop()
    process.exit(0)
  })
}

vite.once('exit', (code) => {
  pocketbase?.kill('SIGTERM')
  process.exit(code ?? 0)
})
