export const apiPrefix = '/api'
export const serverDevelopmentEnv = { NODE_ENV: 'development' }

export interface LocalState {
  lockPort: number
  projectId: string
}

export function parseLocalState(value: unknown): LocalState {
  const state = value as (Partial<LocalState> & { issuerPort?: number }) | null
  // 保留已经存在的 Compose 项目标识与锁端口。
  const lockPort = state?.lockPort ?? state?.issuerPort
  if (typeof state?.projectId !== 'string' || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/.test(state.projectId)
    || typeof lockPort !== 'number' || !Number.isInteger(lockPort) || lockPort < 1 || lockPort > 65535) {
    throw new Error('Invalid dev.local. Restore this project’s local development state from a known copy.')
  }
  return { lockPort, projectId: state.projectId }
}

export interface ServerLaunchEnv {
  mode: string
  appOrigin?: string
  apiPrefix?: string
  logtoConfigured: boolean
}

function parseRegisteredOrigin(input: string | undefined) {
  const raw = input?.trim()
  let address: URL | undefined
  try { address = raw ? new URL(raw) : undefined }
  catch { /* 将 URL 解析失败统一报告为 APP_ORIGIN 配置问题。 */ }
  if (!address || address.protocol !== 'http:' || address.username || address.password
    || address.pathname !== '/' || address.search || address.hash
    || (!['127.0.0.1', 'localhost'].includes(address.hostname) && !address.hostname.endsWith('.localhost'))) {
    throw new Error('Configured Logto dev:local requires an HTTP loopback APP_ORIGIN.')
  }
  return { origin: address.origin, port: Number(address.port || 80) }
}

export function parseServerLaunchEnv(raw: ServerLaunchEnv) {
  const { mode } = raw
  if (mode !== 'off' && mode !== 'logto' && mode !== 'local') {
    throw new Error('AUTH_MODE must be off, logto, or local.')
  }
  if (typeof raw.logtoConfigured !== 'boolean') { throw new TypeError('Server auth:config returned an invalid Logto readiness value.') }
  const logtoConfigured = mode === 'logto' && raw.logtoConfigured
  if (logtoConfigured && raw.apiPrefix?.trim() && raw.apiPrefix.trim() !== apiPrefix) {
    throw new Error('Logto dev:local uses API_PREFIX=/api for the registered callback.')
  }
  const registeredOrigin = logtoConfigured ? parseRegisteredOrigin(raw.appOrigin) : undefined
  return { logtoConfigured, mode, registeredOrigin }
}
