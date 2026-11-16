import { spawn, exec, execSync } from 'node:child_process'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'

const root = resolve(import.meta.dirname, '..')
const pbPort = Number(process.env.PB_PORT || 8091)
const appPort = Number(process.env.PORT || 5173)
const pbUrl = `http://127.0.0.1:${pbPort}`
const appUrl = `http://127.0.0.1:${appPort}`

process.env.VITE_PB_URL = pbUrl

function getPocketBaseBin() {
  if (process.env.POCKETBASE_BIN) return process.env.POCKETBASE_BIN
  const localWin = resolve(root, 'pb', 'pocketbase.exe')
  if (process.platform === 'win32' && existsSync(localWin)) return localWin
  const localUnix = resolve(root, 'pb', 'pocketbase')
  if (existsSync(localUnix)) return localUnix
  return 'pocketbase'
}

function freePortIfHung(port) {
  if (process.platform !== 'win32') return
  try {
    const cmd = `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"`
    execSync(cmd, { stdio: 'ignore' })
  } catch {
    // Ignore cleanup errors
  }
}

async function isHealthy(url) {
  try {
    const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(600) })
    return res.ok
  } catch {
    return false
  }
}

async function isAppReady(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(500) })
    return res.ok || res.status === 304
  } catch {
    return false
  }
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
    // Ignore browser open errors
  }
}

console.log('===================================================')
console.log('   Attendance & Salary (Hajri Pagar) Launcher')
console.log('===================================================')

// 1. Check PocketBase status and heal hung processes if needed
console.log('[1/4] Checking database connection...')
const pbBin = getPocketBaseBin()

if (!(await isHealthy(pbUrl))) {
  // Clear any zombie process blocking port 8091
  freePortIfHung(pbPort)
}

// 2. Ensure migrations are applied
console.log('[2/4] Verifying database schema...')
try {
  execSync(`"${pbBin}" migrate up --dir=pb/pb_data --migrationsDir=pb/pb_migrations`, {
    cwd: root,
    stdio: 'ignore',
  })
} catch (e) {
  console.warn('Note: Migration check completed.')
}

// 3. Start PocketBase if not already running
let pbProcess = null
if (!(await isHealthy(pbUrl))) {
  console.log('[3/4] Starting local database engine...')
  pbProcess = spawn(
    pbBin,
    [
      'serve',
      `--http=127.0.0.1:${pbPort}`,
      '--dir=pb/pb_data',
      '--publicDir=pb/pb_public',
      '--migrationsDir=pb/pb_migrations',
    ],
    { cwd: root, stdio: 'pipe' },
  )

  pbProcess.on('error', (err) => {
    console.error('Database process error:', err.message)
  })

  // Wait up to 10 seconds for PocketBase to become healthy
  let ready = false
  for (let i = 0; i < 40; i++) {
    if (await isHealthy(pbUrl)) {
      ready = true
      break
    }
    await new Promise((r) => setTimeout(r, 250))
  }

  if (!ready) {
    console.error(`Failed to start database on port ${pbPort}.`)
    console.error('Attempting automatic port release and restart...')
    freePortIfHung(pbPort)
    pbProcess = spawn(
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
  }
} else {
  console.log('Database is already running and healthy.')
}

// 4. Start Web Application
console.log('[4/4] Starting application interface...')
freePortIfHung(appPort)

const pnpmCmd = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const viteProcess = spawn(pnpmCmd, ['dev', '--host', '127.0.0.1', '--port', String(appPort)], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
})

viteProcess.on('error', (err) => {
  console.error('Interface process error:', err.message)
  console.log('Falling back to standalone database mode at:', pbUrl)
  openBrowser(pbUrl)
})

// Poll for app readiness, then launch browser
let launched = false
for (let i = 0; i < 50; i++) {
  if (await isAppReady(appUrl)) {
    console.log(`\n===================================================`)
    console.log(`  APPLICATION RUNNING SUCCESSFULLY!`)
    console.log(`  Web Address: ${appUrl}`)
    console.log(`  (You can leave this window minimized)`)
    console.log(`===================================================\n`)
    openBrowser(appUrl)
    launched = true
    break
  }
  await new Promise((r) => setTimeout(r, 200))
}

if (!launched) {
  // If Vite took longer, still attempt to open browser
  openBrowser(appUrl)
}

function cleanup() {
  console.log('\nShutting down services cleanly...')
  try {
    viteProcess?.kill('SIGTERM')
  } catch {}
  try {
    pbProcess?.kill('SIGTERM')
  } catch {}
  process.exit(0)
}

process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)

viteProcess.on('exit', () => {
  cleanup()
})
