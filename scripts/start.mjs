import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const pbPort = Number(process.env.PB_PORT || 8091)
const appPort = Number(process.env.PORT || 5173)
const pbUrl = `http://127.0.0.1:${pbPort}`
process.env.VITE_PB_URL ??= pbUrl
let pocketbase = null
let vite = null

async function running(url) {
  try { const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(500) }); return response.ok }
  catch { return false }
}
async function waitFor(url) {
  for (let i = 0; i < 60; i += 1) {
    if (await running(url)) return true
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  return false
}
function stop() {
  vite?.kill('SIGTERM')
  pocketbase?.kill('SIGTERM')
}

if (!(await running(pbUrl))) {
  pocketbase = spawn(process.env.POCKETBASE_BIN || 'pocketbase', [
    'serve', `--http=127.0.0.1:${pbPort}`, '--dir=pb/pb_data', '--publicDir=pb/pb_public', '--migrationsDir=pb/pb_migrations',
  ], { cwd: root, stdio: 'inherit' })
  if (!(await waitFor(pbUrl))) { stop(); throw new Error('PocketBase did not start. Check that the pocketbase command is installed.') }
}

vite = spawn('pnpm', ['dev', '--host', '127.0.0.1', '--port', String(appPort)], { cwd: root, stdio: 'inherit' })
console.log(`Local app: ${`http://127.0.0.1:${appPort}`}`)
console.log(`Local database: ${pbUrl}`)
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stop(); process.exit(0) })
vite.once('exit', (code) => { pocketbase?.kill('SIGTERM'); process.exit(code ?? 0) })
