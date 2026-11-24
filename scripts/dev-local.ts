import { link, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { startLocalOidc } from './local-oidc'

const host = '127.0.0.1'
const apiPrefix = '/api'
const root = resolve(import.meta.dir, '..')
const statePath = resolve(root, 'dev.local')
const controller = new AbortController()

interface LocalState {
  issuerPort: number
  projectId: string
}

interface ComposeConfig {
  services?: {
    postgres?: {
      environment?: Record<string, string | undefined>
    }
  }
}

async function readState(): Promise<LocalState | undefined> {
  try {
    const state = JSON.parse(await readFile(statePath, 'utf8')) as Partial<LocalState> | null
    if (!state?.projectId || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/.test(state.projectId)
      || typeof state.issuerPort !== 'number' || !Number.isInteger(state.issuerPort)
      || state.issuerPort < 1 || state.issuerPort > 65535) {
      throw new Error('Invalid dev.local. Restore this project’s local development state from a known copy.')
    }
    return { issuerPort: state.issuerPort, projectId: state.projectId }
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error }
    return undefined
  }
}

async function saveState(state: LocalState) {
  const staged = resolve(root, `dev-${crypto.randomUUID()}.local`)
  try {
    await writeFile(staged, `${JSON.stringify(state, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    await link(staged, statePath)
  }
  finally { await rm(staged, { force: true }) }
}

async function reservePort(exclude?: number) {
  const reserve = () => Bun.serve({ fetch: () => new Response(null, { status: 503 }), hostname: host, port: 0 })
  const first = reserve()
  if (first.port !== exclude) { return first }
  try { return reserve() }
  finally { await first.stop(true) }
}

async function run(command: string[], cwd: string, env: typeof process.env, capture = false, cleanup = false) {
  const child = Bun.spawn(command, {
    cwd,
    env,
    signal: cleanup ? undefined : controller.signal,
    stderr: 'inherit',
    stdin: 'ignore',
    stdout: capture ? 'pipe' : 'inherit',
  })
  const [result, status] = await Promise.all([
    capture ? new Response(child.stdout).text() : '',
    child.exited,
  ])
  if (status !== 0) { throw new Error(`${command.join(' ')} exited with status ${status}`) }
  return result.trim()
}

function composeCommand(project: string) {
  const env = { ...process.env, POSTGRES_PORT: '0', REDIS_PORT: '0' }
  return (args: string[], capture = false, cleanup = false) =>
    run(['docker', 'compose', '--project-name', project, '--file', resolve(root, 'compose.yaml'), ...args], root, env, capture, cleanup)
}

async function ensureLocalDocker() {
  const context = process.env.DOCKER_CONTEXT?.trim()
  const directEndpoint = context ? undefined : process.env.DOCKER_HOST?.trim()
  const endpoint = directEndpoint || await run([
    'docker',
    'context',
    'inspect',
    ...(context ? [context] : []),
    '--format',
    '{{.Endpoints.docker.Host}}',
  ], root, process.env, true)
  if (!endpoint.startsWith('unix:///')) {
    throw new Error('dev:local requires a local Docker context using a Unix socket.')
  }
}

async function waitForProxy(port: number) {
  const endpoint = `http://${host}:${port}${apiPrefix}/health`
  for (let attempt = 0; attempt < 100; attempt++) {
    controller.signal.throwIfAborted()
    try {
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(600) })
      if (response.ok && (await response.json()).data?.status === 'ok') { return }
    }
    catch {
      // 子进程仍在启动时连接可能失败，由固定探测次数限制等待。
    }
    await Bun.sleep(300)
  }
  throw new Error('Web proxy did not return the Server health response.')
}

function publishedPort(address: string, service: string) {
  const port = /^127\.0\.0\.1:(\d+)$/.exec(address)?.[1]
  if (!port || port === '0') { throw new Error(`Missing loopback port for Docker Compose service ${service}.`) }
  return port
}

async function main() {
  if (process.platform === 'win32') { throw new Error('Run dev:local in WSL on Windows.') }
  if (!Bun.which('docker')) { throw new Error('dev:local requires Docker Compose.') }
  const packages = ['server', 'web'] as const
  for (const name of packages) {
    if (!await Bun.file(resolve(root, 'packages', name, 'package.json')).exists()
      || !await Bun.file(resolve(root, 'packages', name, 'node_modules/.bin', name === 'web' ? 'vite' : 'drizzle-kit')).exists()) {
      throw new Error('Run bun install --frozen-lockfile and bun run setup before dev:local.')
    }
  }
  await ensureLocalDocker()

  const state = await readState()
  const projectId = state?.projectId ?? crypto.randomUUID()
  const suffix = projectId.replaceAll('-', '').slice(0, 16)
  const project = `yuumi-local-${suffix}`
  const compose = composeCommand(project)
  const webReservation = await reservePort(state?.issuerPort)
  const serverReservation = await reservePort(state?.issuerPort)
  const webPort = webReservation.port!
  const serverPort = serverReservation.port!
  // Cookie 按主机而非端口隔离，并行项目使用不同主机名。
  const appOrigin = `http://yuumi-${suffix}.localhost:${webPort}`
  const callback = `${appOrigin}${apiPrefix}/auth/callback/logto`
  const clientId = `yuumi-local-${suffix}`
  const clientSecret = crypto.randomUUID()
  const children: { name: string, process: ReturnType<typeof Bun.spawn> }[] = []
  let oidc: ReturnType<typeof startLocalOidc> | undefined
  let composeStarted = false

  function launch(name: typeof packages[number], env: typeof process.env) {
    const child = Bun.spawn([process.execPath, 'run', 'dev'], {
      cwd: resolve(root, 'packages', name),
      detached: true,
      env,
      stderr: 'inherit',
      stdin: 'ignore',
      stdout: 'inherit',
    })
    children.push({ name, process: child })
  }

  async function stopApps() {
    function signalAll(signal: NodeJS.Signals) {
      for (const { process: child } of children) {
        try { process.kill(-child.pid, signal) }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') { throw error } }
      }
    }
    // Bun 脚本还有子进程，终止各自的进程组防止 watch 与 Vite 留在后台。
    signalAll('SIGTERM')
    const closed = Promise.all(children.map(({ process: child }) => child.exited))
    if (!await Promise.race([closed.then(() => true), Bun.sleep(5_000).then(() => false)])) {
      signalAll('SIGKILL')
      await closed
    }
  }

  try {
    try { oidc = startLocalOidc({ appOrigin, callback, clientId, clientSecret, port: state?.issuerPort ?? 0 }) }
    catch (error) {
      if (!state) { throw error }
      throw new Error(`Cannot bind this project’s local OIDC port ${state.issuerPort}. Free the port to preserve existing users.`, { cause: error })
    }
    if (!state) { await saveState({ issuerPort: oidc.port!, projectId }) }

    const config = JSON.parse(await compose(['config', '--format', 'json'], true)) as ComposeConfig
    const pg = config.services?.postgres?.environment
    if (!pg?.POSTGRES_USER || !pg.POSTGRES_PASSWORD || !pg.POSTGRES_DB) {
      throw new Error('compose.yaml must define local PostgreSQL credentials and database name.')
    }
    composeStarted = true
    await compose(['up', '-d', '--wait', '--wait-timeout', '45'])
    const pgPort = publishedPort(await compose(['port', 'postgres', '5432'], true), 'postgres')
    const redisPort = publishedPort(await compose(['port', 'redis', '6379'], true), 'redis')
    const databaseUrl = `postgresql://${encodeURIComponent(pg.POSTGRES_USER)}:${encodeURIComponent(pg.POSTGRES_PASSWORD)}@${host}:${pgPort}/${encodeURIComponent(pg.POSTGRES_DB)}`
    const serverEnv = {
      ...process.env,
      API_PREFIX: apiPrefix,
      APP_ORIGIN: appOrigin,
      DATABASE_URL: databaseUrl,
      HOST: host,
      LOGTO_API_RESOURCE: `${appOrigin}${apiPrefix}`,
      LOGTO_APP_ID: clientId,
      LOGTO_APP_SECRET: clientSecret,
      LOGTO_ENDPOINT: oidc.url.origin,
      MIGRATION_DATABASE_URL: databaseUrl,
      NODE_ENV: 'development',
      OPENAPI_URL: '/openapi',
      PORT: String(serverPort),
      REDIS_URL: `redis://${host}:${redisPort}/0`,
    }
    await run([process.execPath, 'run', 'db:migrate'], resolve(root, 'packages/server'), serverEnv)
    controller.signal.throwIfAborted()

    await serverReservation.stop(true)
    launch('server', serverEnv)
    await webReservation.stop(true)
    launch('web', {
      ...process.env,
      DEV_API_ORIGIN: `http://${host}:${serverPort}`,
      DEV_WEB_HOST: host,
      DEV_WEB_PORT: String(webPort),
      NODE_ENV: 'development',
      VITE_SYS_API_BASE_URL: apiPrefix,
    })
    const exited = Promise.race(children.map(async ({ name, process: child }) => {
      const status = await child.exited
      throw new Error(`${name} development server exited with status ${status}`)
    }))
    await Promise.race([waitForProxy(webPort), exited])
    console.info(`Yuumi local is ready at ${appOrigin}`)
    await Promise.race([
      exited,
      new Promise((resolve) => {
        if (controller.signal.aborted) { resolve(undefined) }
        else { controller.signal.addEventListener('abort', () => resolve(undefined), { once: true }) }
      }),
    ])
  }
  catch (error) {
    if (!controller.signal.aborted) { throw error }
  }
  finally {
    controller.abort()
    try {
      await Promise.all([webReservation.stop(true), serverReservation.stop(true), stopApps()])
    }
    finally {
      try {
        if (composeStarted) { await compose(['stop', '--timeout', '5'], false, true) }
      }
      finally {
        // 并发启动会争用项目签发者端口，最后释放它，避免停掉下一次启动的容器。
        await oidc?.stop(true)
      }
    }
  }
}

// Bun 的脚本包装器可能转发同一信号，清理期间始终保留监听。
process.on('SIGINT', () => controller.abort())
process.on('SIGTERM', () => controller.abort())
await main()
