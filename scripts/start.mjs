import { spawn, spawnSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'

const root = resolve(import.meta.dirname, '..')
const pbExe = join(root, 'pb', 'pocketbase.exe')
const logPath = join(root, 'pb-dev.log')

function run(command, args) {
  return spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
}

function section(title) {
  console.log(`\n${title}`)
}

function findEdge() {
  const candidates = [
    process.env.EDGE_PATH,
    process.env['PROGRAMFILES(X86)'] && join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].filter(Boolean)
  return candidates.find((candidate) => existsSync(candidate))
}

async function isOurAppUp(url) {
  try {
    const [health, index] = await Promise.all([
      fetch(`${url}/api/health`, { signal: AbortSignal.timeout(800) }),
      fetch(`${url}/`, { signal: AbortSignal.timeout(800) }),
    ])
    return health.ok && index.ok
  } catch {
    return false
  }
}

async function isPortFree(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(400) })
    return false
  } catch {
    return true
  }
}

async function determinePort() {
  const requested = process.env.PORT ? parseInt(process.env.PORT, 10) : 8090
  if (await isOurAppUp(`http://127.0.0.1:${requested}`)) return requested
  if (await isOurAppUp('http://127.0.0.1:8095')) return 8095

  if (await isPortFree(requested)) return requested
  if (await isPortFree(8095)) return 8095
  return 8096
}

async function waitForServer(baseUrl) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await isOurAppUp(baseUrl)) return true
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  return false
}

function stopServer(child) {
  if (!child || child.killed) return
  child.kill()
}

section('Building the app…')
const build = run('pnpm', ['build'])
if (build.status !== 0) {
  console.error('\nBuild failed. The app was not started.')
  process.exit(build.status || 1)
}

const port = await determinePort()
const baseUrl = `http://127.0.0.1:${port}`

let server = null
if (await isOurAppUp(baseUrl)) {
  console.log(`\nLocal server is already running at ${baseUrl}.`)
} else {
  if (!existsSync(pbExe)) {
    console.error(`\nPocketBase not found at ${pbExe}`)
    process.exit(1)
  }

  section(`Starting the local server on port ${port}…`)
  const logFd = openSync(logPath, 'a')
  server = spawn(pbExe, ['serve', `--http=127.0.0.1:${port}`], {
    cwd: root,
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
  })
  closeSync(logFd)
  server.once('error', (error) => {
    console.error(`Could not start PocketBase: ${error.message}`)
    process.exit(1)
  })

  if (!(await waitForServer(baseUrl))) {
    stopServer(server)
    console.error('\nThe local server did not start. Recent log output:\n')
    try {
      const lines = readFileSync(logPath, 'utf8').trim().split(/\r?\n/)
      console.error(lines.slice(-20).join('\n'))
    } catch {
      console.error('No log file was found.')
    }
    process.exit(1)
  }
}

const edge = findEdge()
if (!edge) {
  console.error('\nMicrosoft Edge was not found. Set EDGE_PATH to msedge.exe.')
  stopServer(server)
  process.exit(1)
}

const profile = join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'HajriPagar', 'EdgeProfile')
mkdirSync(profile, { recursive: true })

section('Opening હાજરી પગાર…')
console.log(`Local address: ${baseUrl}`)
const app = spawn(
  edge,
  [
    `--app=${baseUrl}/#attendance`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-mode',
    '--window-size=1440,1000',
  ],
  { stdio: 'ignore' },
)

if (server) console.log('Close the app window to stop the local server.')
else console.log('The server was already running and will stay open.')

const cleanup = () => {
  stopServer(server)
}
process.once('SIGINT', () => {
  cleanup()
  process.exit(0)
})
process.once('SIGTERM', () => {
  cleanup()
  process.exit(0)
})

app.once('error', (error) => {
  console.error(`Could not open Edge: ${error.message}`)
  cleanup()
  process.exit(1)
})

app.once('exit', () => {
  cleanup()
  console.log(server ? '\nApp closed. Local server stopped.' : '\nApp closed.')
})
