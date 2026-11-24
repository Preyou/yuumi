import type { LocalState, ServerLaunchEnv } from './local-config'
import { link, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { apiPrefix, parseLocalState, parseServerLaunchEnv, serverDevelopmentEnv } from './local-config'

const host = '127.0.0.1'
const root = resolve(import.meta.dir, '..')
const serverDirectory = resolve(root, 'packages/server')
const statePath = resolve(root, 'dev.local')
const controller = new AbortController()

interface ComposeConfig {
  services?: {
    postgres?: {
      environment?: Record<string, string | undefined>
    }
  }
}

async function readState(): Promise<LocalState | undefined> {
  try {
    return parseLocalState(JSON.parse(await readFile(statePath, 'utf8')))
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

function reservePort(port = 0) {
  return Bun.serve({ fetch: () => new Response(null, { status: 503 }), hostname: host, port })
}

interface RunOptions {
  capture?: boolean
  cleanup?: boolean
  stdin?: 'ignore' | 'inherit'
}

async function run(command: string[], cwd: string, env: typeof process.env, options: RunOptions = {}) {
  const child = Bun.spawn(command, {
    cwd,
    env,
    signal: options.cleanup ? undefined : controller.signal,
    stderr: 'inherit',
    stdin: options.stdin ?? 'ignore',
    stdout: options.capture ? 'pipe' : 'inherit',
  })
  const [result, status] = await Promise.all([
    options.capture ? new Response(child.stdout).text() : '',
    child.exited,
  ])
  if (status !== 0) { throw new Error(`${command.join(' ')} exited with status ${status}`) }
  return result.trim()
}

function composeCommand(project: string) {
  const env = { ...process.env, POSTGRES_PORT: '0', REDIS_PORT: '0' }
  return (args: string[], options?: RunOptions) =>
    run(['docker', 'compose', '--project-name', project, '--file', resolve(root, 'compose.yaml'), ...args], root, env, options)
}

function projectSuffix(projectId: string) {
  return projectId.replaceAll('-', '').slice(0, 16)
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
  ], root, process.env, { capture: true })
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

async function readLocalConnections(compose: ReturnType<typeof composeCommand>) {
  const config = JSON.parse(await compose(['config', '--format', 'json'], { capture: true })) as ComposeConfig
  const pg = config.services?.postgres?.environment
  if (!pg?.POSTGRES_USER || !pg.POSTGRES_PASSWORD || !pg.POSTGRES_DB) {
    throw new Error('compose.yaml must define local PostgreSQL credentials and database name.')
  }
  const [pgAddress, redisAddress] = await Promise.all([
    compose(['port', 'postgres', '5432'], { capture: true }),
    compose(['port', 'redis', '6379'], { capture: true }),
  ])
  const pgPort = publishedPort(pgAddress, 'postgres')
  const redisPort = publishedPort(redisAddress, 'redis')
  const databaseUrl = `postgresql://${encodeURIComponent(pg.POSTGRES_USER)}:${encodeURIComponent(pg.POSTGRES_PASSWORD)}@${host}:${pgPort}/${encodeURIComponent(pg.POSTGRES_DB)}`
  return {
    DATABASE_URL: databaseUrl,
    MIGRATION_DATABASE_URL: databaseUrl,
    REDIS_URL: `redis://${host}:${redisPort}/0`,
  }
}

async function serverLaunchConfiguration() {
  // Bun 在 Server 工作目录加载环境，auth:config 只输出本地编排需要的配置结果。
  const values = await run(
    [process.execPath, 'run', 'auth:config'],
    serverDirectory,
    { ...process.env, ...serverDevelopmentEnv },
    { capture: true },
  )
  return parseServerLaunchEnv(JSON.parse(values) as ServerLaunchEnv)
}

async function provisionLocalUser(resolved: Awaited<ReturnType<typeof serverLaunchConfiguration>>) {
  if (resolved.mode !== 'local') { throw new Error('Set AUTH_MODE=local in packages/server/.env.local to create a local user.') }
  const state = await readState()
  if (!state) { throw new Error('Start this project with bun run dev:local before creating a local user.') }
  const suffix = projectSuffix(state.projectId)
  const compose = composeCommand(`yuumi-local-${suffix}`)
  const services = (await compose(['ps', '--status', 'running', '--services'], { capture: true })).split('\n')
  if (!services.includes('postgres') || !services.includes('redis')) {
    throw new Error('Start this project with bun run dev:local before creating a local user.')
  }
  const connections = await readLocalConnections(compose)
  // 建号只用项目存储。此处的回环地址作为通用 Server 配置供命令初始化。
  await run([process.execPath, 'run', 'auth:user', '--', ...Bun.argv.slice(3)], serverDirectory, {
    ...process.env,
    ...serverDevelopmentEnv,
    ...connections,
    API_PREFIX: apiPrefix,
    APP_ORIGIN: `http://yuumi-${suffix}.localhost`,
    AUTH_MODE: resolved.mode,
    HOST: host,
    OPENAPI_URL: '/openapi',
    PORT: '3100',
  }, { stdin: 'inherit' })
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

  const auth = await serverLaunchConfiguration()
  if (Bun.argv[2] === 'auth:user') {
    await provisionLocalUser(auth)
    return
  }
  const state = await readState()
  const projectId = state?.projectId ?? crypto.randomUUID()
  const suffix = projectSuffix(projectId)
  const project = `yuumi-local-${suffix}`
  const compose = composeCommand(project)
  const children: { name: string, process: ReturnType<typeof Bun.spawn> }[] = []
  let webReservation: ReturnType<typeof reservePort> | undefined
  let serverReservation: ReturnType<typeof reservePort> | undefined
  let projectLock: ReturnType<typeof reservePort> | undefined
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
    if (state) {
      try { projectLock = reservePort(state.lockPort) }
      catch (error) {
        throw new Error(`Cannot acquire this project’s local development lock on port ${state.lockPort}. Stop a running instance or free the port.`, { cause: error })
      }
    }
    try { webReservation = reservePort(auth.registeredOrigin?.port) }
    catch (error) {
      if (!auth.registeredOrigin) { throw error }
      throw new Error(`Cannot bind the registered Logto app origin ${auth.registeredOrigin.origin}.`, { cause: error })
    }
    if (!projectLock) {
      projectLock = reservePort()
      await saveState({ lockPort: projectLock.port!, projectId })
    }
    serverReservation = reservePort()
    const webPort = webReservation.port!
    const serverPort = serverReservation.port!
    // 浏览器会话按主机隔离，已登记的 Logto origin 优先于临时地址。
    const appOrigin = auth.registeredOrigin?.origin ?? `http://yuumi-${suffix}.localhost:${webPort}`
    composeStarted = true
    await compose(['up', '-d', '--wait', '--wait-timeout', '45'])
    const connections = await readLocalConnections(compose)
    const serverEnv = {
      ...process.env,
      ...serverDevelopmentEnv,
      ...connections,
      API_PREFIX: apiPrefix,
      APP_ORIGIN: appOrigin,
      AUTH_MODE: auth.mode,
      HOST: host,
      OPENAPI_URL: '/openapi',
      PORT: String(serverPort),
    }
    await run([process.execPath, 'run', 'db:migrate'], serverDirectory, serverEnv)
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
    if (auth.mode === 'logto' && !auth.logtoConfigured) {
      console.info('Logto login is pending configuration in packages/server/.env.local.')
    }
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
      await Promise.all([webReservation?.stop(true), serverReservation?.stop(true), stopApps()])
    }
    finally {
      try {
        if (composeStarted) { await compose(['stop', '--timeout', '5'], { cleanup: true }) }
      }
      finally {
        // 容器清理完成后释放锁，避免并发启动接管同一 Compose 项目。
        await projectLock?.stop(true)
      }
    }
  }
}

// Bun 的脚本包装器可能转发同一信号，清理期间始终保留监听。
process.on('SIGINT', () => controller.abort())
process.on('SIGTERM', () => controller.abort())
await main()
