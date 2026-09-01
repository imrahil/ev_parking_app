// Pins the hand-rolled Web Push crypto to the spec, and checks the endpoint
// allowlist that stops /watch being an open relay.
//
//   cd worker && npm test
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { encryptPayload, isPushEndpoint, isSubscription } from '../src/push.js'

const dec = (s) => {
  const p = s.replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(p.padEnd(p.length + ((4 - (p.length % 4)) % 4), '=')), (c) =>
    c.charCodeAt(0),
  )
}
const enc = (b) =>
  Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

// The worked example from RFC 8291 section 5.
const V = {
  plaintext: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  asPublic:
    'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic:
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
    'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT' +
    'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
}

// A self-consistent implementation can still be wrong on the wire — every push
// service would just reject it. This is the check that catches that.
test('encryptPayload matches the RFC 8291 §5 test vector byte for byte', async () => {
  const asPublicBytes = dec(V.asPublic)
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: enc(asPublicBytes.slice(1, 33)),
      y: enc(asPublicBytes.slice(33, 65)),
      d: V.asPrivate,
    },
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  )
  const publicKey = await crypto.subtle.importKey(
    'raw',
    asPublicBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    [],
  )

  const body = await encryptPayload(
    { keys: { p256dh: V.uaPublic, auth: V.auth } },
    dec(V.plaintext),
    { keyPair: { privateKey, publicKey }, salt: dec(V.salt) },
  )

  assert.equal(enc(body), V.body)
})

test('a random send produces a well-formed aes128gcm record', async () => {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])
  const p256dh = enc(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)))
  const auth = enc(crypto.getRandomValues(new Uint8Array(16)))
  const plaintext = new TextEncoder().encode(JSON.stringify({ title: 'free' }))

  const body = await encryptPayload({ keys: { p256dh, auth } }, plaintext)

  assert.equal(new DataView(body.buffer).getUint32(16), 4096, 'record size')
  assert.equal(body[20], 65, 'keyid is an uncompressed P-256 point')
  assert.equal(body[21], 0x04, 'point is uncompressed')
  // header (86) + plaintext + 0x02 delimiter + 16-byte GCM tag
  assert.equal(body.length, 86 + plaintext.length + 1 + 16)
  assert.notEqual(enc(body.slice(0, 16)), enc(new Uint8Array(16)), 'salt is not all zeros')
})

test('only real push services are accepted as endpoints', () => {
  for (const ok of [
    'https://fcm.googleapis.com/fcm/send/abc',
    // what a real Chrome install actually handed out during local testing
    'https://jmt17.google.com/fcm/send/eSzB6JcQ2qc:APA91bFxwwe3bpqLxdB7',
    'https://android.googleapis.com/gcm/send/abc',
    'https://web.push.apple.com/xyz',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://abc.notify.windows.com/w/?token=x',
  ]) {
    assert.ok(isPushEndpoint(ok), ok)
  }

  for (const bad of [
    'https://attacker.test/collect',
    'http://fcm.googleapis.com/fcm/send/abc', // not https
    'https://fcm.googleapis.com.attacker.test/x', // suffix confusion
    'https://notfcm.googleapis.com/x',
    'https://storage.googleapis.com/my-bucket/x', // Google, but not a push path
    'https://mail.google.com/mail/u/0', // ditto
    'not a url',
    undefined,
  ]) {
    assert.equal(isPushEndpoint(bad), false, String(bad))
  }
})

test('subscriptions need both keys and a valid endpoint', () => {
  const good = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    keys: { p256dh: 'x', auth: 'y' },
  }
  assert.ok(isSubscription(good))
  assert.equal(isSubscription({ ...good, keys: { p256dh: 'x' } }), false)
  assert.equal(isSubscription({ ...good, endpoint: 'https://attacker.test/x' }), false)
  assert.equal(isSubscription(null), false)
})
