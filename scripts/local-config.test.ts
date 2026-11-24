import { expect, test } from 'bun:test'
import { parseLocalState, parseServerLaunchEnv } from './local-config'

const projectId = '12345678-1234-1234-1234-123456789abc'

test('legacy development state retains the project and lock port', () => {
  expect(parseLocalState({ issuerPort: 4040, projectId })).toEqual({ lockPort: 4040, projectId })
  expect(parseLocalState({ lockPort: 4041, projectId })).toEqual({ lockPort: 4041, projectId })
  expect(() => parseLocalState({ lockPort: 0, projectId })).toThrow('Invalid dev.local')
})

test('only fully configured Logto mode uses the registered origin', () => {
  const appOrigin = 'http://example.localhost:4321'
  expect(parseServerLaunchEnv({ appOrigin, logtoConfigured: true, mode: 'logto' })).toEqual({
    logtoConfigured: true,
    mode: 'logto',
    registeredOrigin: { origin: appOrigin, port: 4321 },
  })
  expect(parseServerLaunchEnv({ appOrigin: 'http://localhost', logtoConfigured: true, mode: 'logto' }).registeredOrigin)
    .toEqual({ origin: 'http://localhost', port: 80 })
  expect(parseServerLaunchEnv({ appOrigin, logtoConfigured: false, mode: 'logto' })).toEqual({
    logtoConfigured: false,
    mode: 'logto',
    registeredOrigin: undefined,
  })
  for (const mode of ['local', 'off']) {
    expect(parseServerLaunchEnv({ appOrigin, logtoConfigured: true, mode })).toEqual({
      logtoConfigured: false,
      mode,
      registeredOrigin: undefined,
    })
  }
})

test('rejects malformed mode and origins that cannot reach the local Web server', () => {
  expect(() => parseServerLaunchEnv({ logtoConfigured: false, mode: 'typo' })).toThrow('AUTH_MODE')
  for (const appOrigin of [
    undefined,
    'not a URL',
    'https://localhost:4321',
    'http://localhost:4321/path',
    'http://localhost.evil.test:4321',
  ]) {
    expect(() => parseServerLaunchEnv({ appOrigin, logtoConfigured: true, mode: 'logto' })).toThrow('HTTP loopback APP_ORIGIN')
  }
  expect(() => parseServerLaunchEnv({
    apiPrefix: '/custom',
    appOrigin: 'http://localhost:4321',
    logtoConfigured: true,
    mode: 'logto',
  })).toThrow('API_PREFIX=/api')
})
