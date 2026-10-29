// Web Push for the Workbench Hub, with no extra packages: VAPID keys and signatures (RFC 8292)
// and the aes128gcm payload encryption (RFC 8291 / RFC 8188), using Node's own crypto.
"use strict";
const crypto = require("crypto");

const b64u = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");
const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();

// A new key pair for this Hub. The public key goes to each device when it subscribes.
function makeVapid() {
  const e = crypto.createECDH("prime256v1");
  e.generateKeys();
  return { pub: b64u(e.getPublicKey()), priv: b64u(e.getPrivateKey()) };
}

// "vapid t=<signed token>, k=<public key>" for one push service (the endpoint's origin)
function vapidHeader(endpoint, vapid, subject) {
  const pub = unb64u(vapid.pub),
    key = crypto.createPrivateKey({ key: { kty: "EC", crv: "P-256", d: vapid.priv, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }, format: "jwk" }),
    head = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" })),
    body = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })),
    sig = crypto.sign("sha256", Buffer.from(head + "." + body), { key, dsaEncoding: "ieee-p1363" });
  return "vapid t=" + head + "." + body + "." + b64u(sig) + ", k=" + vapid.pub;
}

// Encrypt a message for one browser. fixed = { asPriv, salt } only for tests.
function encrypt(plain, p256dh, auth, fixed) {
  const ua = unb64u(p256dh),
    secret = unb64u(auth),
    as = crypto.createECDH("prime256v1");
  fixed && fixed.asPriv ? as.setPrivateKey(unb64u(fixed.asPriv)) : as.generateKeys();
  const asPub = as.getPublicKey(),
    shared = as.computeSecret(ua),
    ikm = hmac(hmac(secret, shared), Buffer.concat([Buffer.from("WebPush: info\0"), ua, asPub, Buffer.from([1])])),
    salt = fixed && fixed.salt ? unb64u(fixed.salt) : crypto.randomBytes(16),
    prk = hmac(salt, ikm),
    cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01", "binary")).subarray(0, 16),
    nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01", "binary")).subarray(0, 12),
    c = crypto.createCipheriv("aes-128-gcm", cek, nonce),
    ct = Buffer.concat([c.update(Buffer.concat([Buffer.from(plain), Buffer.from([2])])), c.final(), c.getAuthTag()]),
    head = Buffer.alloc(21);
  salt.copy(head, 0);
  head.writeUInt32BE(4096, 16);
  head[20] = asPub.length;
  return Buffer.concat([head, asPub, ct]);
}

// The receiving side, for tests: what the browser does with its private key.
function decrypt(body, uaPriv, auth) {
  const ua = crypto.createECDH("prime256v1");
  ua.setPrivateKey(unb64u(uaPriv));
  const salt = body.subarray(0, 16),
    idlen = body[20],
    asPub = body.subarray(21, 21 + idlen),
    ct = body.subarray(21 + idlen),
    shared = ua.computeSecret(asPub),
    ikm = hmac(hmac(unb64u(auth), shared), Buffer.concat([Buffer.from("WebPush: info\0"), ua.getPublicKey(), asPub, Buffer.from([1])])),
    prk = hmac(salt, ikm),
    cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01", "binary")).subarray(0, 16),
    nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01", "binary")).subarray(0, 12),
    d = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  let out = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  let end = out.length - 1;
  while (end >= 0 && out[end] === 0) end--;
  return out.subarray(0, end).toString();
}

// Send one notification. Resolves to the push service's status code (201 = delivered to the
// service; 404/410 = this subscription is gone and should be forgotten).
async function send(sub, message, vapid, subject, opts) {
  opts = opts || {};
  const body = encrypt(JSON.stringify(message), sub.keys.p256dh, sub.keys.auth);
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: vapidHeader(sub.endpoint, vapid, subject),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(opts.ttl || 24 * 3600),
      Urgency: opts.urgency || "normal",
      ...(opts.topic ? { Topic: opts.topic } : {}),
    },
    body,
    signal: AbortSignal.timeout(20000),
  });
  return res.status;
}

module.exports = { makeVapid, vapidHeader, encrypt, decrypt, send, b64u, unb64u };
