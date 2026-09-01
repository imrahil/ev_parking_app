// Web Push sender: RFC 8291 (aes128gcm payload encryption) + RFC 8292 (VAPID).
//
// Hand-rolled on purpose. The maintained WebCrypto push libraries on npm still
// emit the legacy `aesgcm` draft encoding with a `WebPush` authorization
// header; Apple's push service only accepts the RFC versions, so those
// libraries silently break notifications on iPhones — the platform this app
// most needs to reach.
//
// Verified against the RFC 8291 §5 test vector (see the repo's worker test).

const RECORD_SIZE = 4096
const TTL_SECONDS = 600 // a "charger is free" older than one refresh is a lie
const JWT_LIFETIME_S = 12 * 60 * 60

const encoder = new TextEncoder()

// Services we are willing to POST a push to. Without this, /watch is an open
// relay: the caller supplies `endpoint` and the worker fetches it.
//
// Chrome does NOT only use fcm.googleapis.com — real installs hand out hosts
// like jmt17.google.com/fcm/send/..., so Google is matched by domain suffix and
// narrowed by path instead of being enumerated by hostname.
const PUSH_SERVICES = [
  { host: '.googleapis.com', path: /^\/(fcm|gcm)\/send\// }, // Chrome, Edge
  { host: '.google.com', path: /^\/(fcm|gcm)\/send\// }, // Chrome, alternate hosts
  { host: '.push.services.mozilla.com' }, // Firefox
  { host: '.push.apple.com' }, // Safari, iOS
  { host: '.notify.windows.com' }, // Edge (legacy WNS)
]

/** True if `endpoint` is an https URL on a known push service. */
export function isPushEndpoint(endpoint) {
  if (typeof endpoint !== 'string') return false
  let url
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  return PUSH_SERVICES.some(
    ({ host, path }) => url.hostname.endsWith(host) && (!path || path.test(url.pathname)),
  )
}

/** Shape check for what the browser's PushManager.subscribe() gives us. */
export function isSubscription(sub) {
  return (
    !!sub &&
    typeof sub === 'object' &&
    isPushEndpoint(sub.endpoint) &&
    !!sub.keys &&
    typeof sub.keys.auth === 'string' &&
    typeof sub.keys.p256dh === 'string'
  )
}

function encodeBase64Url(bytes) {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decodeBase64Url(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), '=')), (c) =>
    c.charCodeAt(0),
  )
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/**
 * Stable id for a subscription, used as the KV key suffix. Endpoints are long
 * and contain characters we'd rather not put in a key, so hash them.
 * Mirrored by subIdFor() in src/api.ts — change both or a device loses its watches.
 */
export async function subId(endpoint) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(endpoint))
  return encodeBase64Url(new Uint8Array(digest))
}

/** HKDF-Extract + Expand in one step (what WebCrypto's HKDF deriveBits does). */
async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    length * 8,
  )
  return new Uint8Array(bits)
}

/**
 * RFC 8291 §3.4 — encrypt one push message into a single aes128gcm record.
 *
 * `seed` exists only so the test can pin the ephemeral key and salt and compare
 * against the RFC's published vector; production always randomises both.
 */
export async function encryptPayload(subscription, plaintext, seed = {}) {
  const uaPublic = decodeBase64Url(subscription.keys.p256dh)
  const authSecret = decodeBase64Url(subscription.keys.auth)

  const keyPair =
    seed.keyPair ??
    (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']))
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey))
  const salt = seed.salt ?? crypto.getRandomValues(new Uint8Array(16))

  const uaKey = await crypto.subtle.importKey(
    'raw',
    uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, keyPair.privateKey, 256),
  )

  const ikm = await hkdf(
    authSecret,
    ecdhSecret,
    concat(encoder.encode('WebPush: info\0'), uaPublic, asPublic),
    32,
  )
  const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12)

  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  // Single record, so the payload ends with the 0x02 last-record delimiter
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      aesKey,
      concat(plaintext, Uint8Array.of(2)),
    ),
  )

  // aes128gcm content-coding header (RFC 8188 §2.1): salt | rs | idlen | keyid
  const header = new Uint8Array(21 + asPublic.length)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, RECORD_SIZE)
  header[20] = asPublic.length
  header.set(asPublic, 21)

  return concat(header, ciphertext)
}

// One JWT per push service, reused until it is close to expiring. Signing is
// cheap but the free plan gives us 10ms of CPU per invocation in total.
const jwtCache = new Map()

async function vapidAuthorization(origin, env) {
  const cached = jwtCache.get(origin)
  const now = Math.floor(Date.now() / 1000)
  if (cached && cached.exp - now > 60 * 60) return cached.value

  const exp = now + JWT_LIFETIME_S
  const signingInput = [
    { typ: 'JWT', alg: 'ES256' },
    { aud: origin, exp, sub: env.VAPID_SUBJECT },
  ]
    .map((part) => encodeBase64Url(encoder.encode(JSON.stringify(part))))
    .join('.')

  const publicKey = decodeBase64Url(env.VAPID_PUBLIC_KEY)
  const key = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: encodeBase64Url(publicKey.slice(1, 33)),
      y: encodeBase64Url(publicKey.slice(33, 65)),
      d: env.VAPID_PRIVATE_KEY,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )

  // WebCrypto ECDSA already returns the raw r||s pair that JWS ES256 wants
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    encoder.encode(signingInput),
  )

  const value = `vapid t=${signingInput}.${encodeBase64Url(new Uint8Array(signature))},k=${env.VAPID_PUBLIC_KEY}`
  jwtCache.set(origin, { value, exp })
  return value
}

/**
 * Encrypts and delivers one notification.
 * Returns the push service's HTTP status (0 if the request itself threw).
 *
 * 404/410 mean the subscription is dead and should be dropped — every other
 * failure is worth retrying on the next refresh.
 */
export async function sendPush(subscription, data, env) {
  const body = await encryptPayload(subscription, encoder.encode(JSON.stringify(data)))

  try {
    const res = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidAuthorization(new URL(subscription.endpoint).origin, env),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(body.length),
        TTL: String(TTL_SECONDS),
        Urgency: 'high',
      },
      body,
    })
    return res.status
  } catch {
    return 0
  }
}
