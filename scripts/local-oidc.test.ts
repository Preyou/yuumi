import { expect, test } from 'bun:test'
import { Buffer } from 'node:buffer'
import { verify } from 'node:crypto'
import { startLocalOidc } from './local-oidc'

test('local OIDC binds authorization codes to the registered callback and PKCE', async () => {
  const appOrigin = 'http://demo.localhost:8123'
  const callback = `${appOrigin}/api/auth/callback/logto`
  const clientId = 'test-app'
  const clientSecret = 'test-secret'
  const provider = startLocalOidc({ appOrigin, callback, clientId, clientSecret, port: 0 })
  try {
    const base = provider.url.origin
    const discovery = await (await fetch(`${base}/oidc/.well-known/openid-configuration`)).json()
    const verifier = crypto.randomUUID()
    const query = new URLSearchParams({
      client_id: clientId,
      code_challenge: new Bun.CryptoHasher('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      nonce: 'test-nonce',
      redirect_uri: callback,
      response_type: 'code',
      scope: 'openid profile email',
      state: 'test-state',
    })
    async function authorize() {
      return fetch(`${discovery.authorization_endpoint}?${query}`, { redirect: 'manual' })
    }
    query.set('redirect_uri', 'http://unexpected.localhost/callback')
    expect((await authorize()).status).toBe(400)
    query.set('redirect_uri', callback)
    const response = await authorize()
    expect(response.status).toBe(303)
    const redirect = new URL(response.headers.get('location')!)
    expect(redirect.origin).toBe(appOrigin)
    expect(redirect.searchParams.get('state')).toBe('test-state')
    const code = redirect.searchParams.get('code')!
    async function exchange(codeVerifier: string) {
      return fetch(discovery.token_endpoint, {
        body: new URLSearchParams({
          client_id: clientId,
          code,
          code_verifier: codeVerifier,
          grant_type: 'authorization_code',
          redirect_uri: callback,
        }),
        headers: { authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}` },
        method: 'POST',
      })
    }
    expect((await exchange('wrong')).status).toBe(400)
    const exchanged = await exchange(verifier)
    expect(exchanged.status).toBe(200)
    const { id_token: token } = await exchanged.json()
    const [header, payload, signature] = token.split('.')
    const { keys: [key] } = await (await fetch(discovery.jwks_uri)).json()
    expect(verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), { format: 'jwk', key }, Buffer.from(signature, 'base64url'))).toBe(true)
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toMatchObject({ iss: discovery.issuer, nonce: 'test-nonce', sub: 'yuumi-local-developer' })
    expect((await exchange(verifier)).status).toBe(400)
  }
  finally { provider.stop(true) }
})
