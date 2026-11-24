import { Buffer } from 'node:buffer'
import { generateKeyPairSync, sign } from 'node:crypto'

interface LocalOidcOptions {
  appOrigin: string
  callback: string
  clientId: string
  clientSecret: string
  port: number
}

interface AuthorizationCode {
  challenge: string
  expiresAt: number
  nonce: string
}

const CODE_TTL_MS = 120_000
const PKCE_CHALLENGE = /^[\w-]{43}$/

function base64Json(value: object) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function invalid(error: string, status = 400) {
  return Response.json({ error }, { headers: { 'cache-control': 'no-store' }, status })
}

export function startLocalOidc(options: LocalOidcOptions) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const kid = crypto.randomUUID()
  const jwk = { ...publicKey.export({ format: 'jwk' }), alg: 'RS256', kid, use: 'sig' }
  const codes = new Map<string, AuthorizationCode>()
  const { callback } = options
  const authorization = `Basic ${btoa(`${options.clientId}:${options.clientSecret}`)}`

  function authorize(query: URLSearchParams) {
    const challenge = query.get('code_challenge')
    const nonce = query.get('nonce')
    const state = query.get('state')
    if (query.get('client_id') !== options.clientId
      || query.get('redirect_uri') !== callback
      || query.get('response_type') !== 'code'
      || query.get('code_challenge_method') !== 'S256'
      || !query.get('scope')?.split(' ').includes('openid')
      || !challenge || !PKCE_CHALLENGE.test(challenge) || !nonce || !state) {
      return invalid('invalid_request')
    }
    const now = Date.now()
    for (const [code, entry] of codes) {
      if (entry.expiresAt <= now) { codes.delete(code) }
    }
    if (codes.size >= 128) { return invalid('temporarily_unavailable', 503) }
    const code = crypto.randomUUID()
    codes.set(code, { challenge, expiresAt: now + CODE_TTL_MS, nonce })
    const redirect = new URL(callback)
    redirect.search = new URLSearchParams({ code, state }).toString()
    return Response.redirect(redirect, 303)
  }

  async function token(request: Request, issuer: string) {
    if (request.headers.get('authorization') !== authorization) { return invalid('invalid_client', 401) }
    const form = new URLSearchParams(await request.text())
    const code = form.get('code') ?? ''
    const verifier = form.get('code_verifier') ?? ''
    const grant = codes.get(code)
    if (form.get('grant_type') !== 'authorization_code' || form.get('client_id') !== options.clientId
      || form.get('redirect_uri') !== callback || !grant || grant.expiresAt <= Date.now()
      || new Bun.CryptoHasher('sha256').update(verifier).digest('base64url') !== grant.challenge) {
      return invalid('invalid_grant')
    }
    codes.delete(code)
    const now = Math.floor(Date.now() / 1000)
    const payload = {
      aud: options.clientId,
      email: 'developer@yuumi.localhost',
      email_verified: true,
      exp: now + 300,
      iat: now,
      iss: issuer,
      name: 'Yuumi Local',
      nonce: grant.nonce,
      sub: 'yuumi-local-developer',
    }
    const unsigned = `${base64Json({ alg: 'RS256', kid, typ: 'JWT' })}.${base64Json(payload)}`
    const signature = sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url')
    return Response.json({
      access_token: crypto.randomUUID(),
      expires_in: 300,
      id_token: `${unsigned}.${signature}`,
      scope: 'openid profile email',
      token_type: 'Bearer',
    }, { headers: { 'cache-control': 'no-store' } })
  }

  return Bun.serve({
    async fetch(request, server) {
      const url = new URL(request.url)
      const issuer = `${server.url.origin}/oidc`
      if (request.method === 'POST' && url.pathname === '/oidc/token') { return token(request, issuer) }
      if (request.method !== 'GET') { return invalid('invalid_request', 405) }
      switch (url.pathname) {
        case '/oidc/.well-known/openid-configuration': return Response.json({
          authorization_endpoint: `${issuer}/authorize`,
          code_challenge_methods_supported: ['S256'],
          end_session_endpoint: `${issuer}/logout`,
          id_token_signing_alg_values_supported: ['RS256'],
          issuer,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          token_endpoint: `${issuer}/token`,
        })
        case '/oidc/jwks': return Response.json({ keys: [jwk] })
        case '/oidc/authorize': return authorize(url.searchParams)
        case '/oidc/logout': return url.searchParams.get('client_id') === options.clientId
          && url.searchParams.get('post_logout_redirect_uri') === options.appOrigin
          ? Response.redirect(options.appOrigin, 303)
          : invalid('invalid_request')
        default: return invalid('not_found', 404)
      }
    },
    hostname: '127.0.0.1',
    port: options.port,
  })
}
