// The rig's browser, for one person at a time (Workbench Hub 1.8.0).
// It runs a real Edge or Chrome on the rig with no window ("headless"), in a throwaway profile that
// is deleted when the session ends, and sends its picture to the person's device. Every request the
// browser makes goes through a small filter on the rig that only connects to the public internet:
// the rig itself, your home network, your tailnet and the Hub are all refused, so whoever uses it
// can't reach anything of yours. Only host names are ever written down.
"use strict";
const { spawn } = require("child_process");
const fs = require("fs"),
  os = require("os"),
  path = require("path"),
  net = require("net"),
  http = require("http"),
  dns = require("dns").promises,
  crypto = require("crypto");

const WIN = process.platform === "win32";

function findExe(custom) {
  const E = process.env,
    list = [E.WB_BROWSER_EXE, custom];
  if (WIN)
    for (const base of [E["ProgramFiles(x86)"], E.ProgramFiles, E.LOCALAPPDATA].filter(Boolean))
      list.push(path.join(base, "Microsoft", "Edge", "Application", "msedge.exe"), path.join(base, "Google", "Chrome", "Application", "chrome.exe"));
  else list.push("/usr/bin/microsoft-edge", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/opt/pw-browsers/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  for (const p of list)
    try {
      if (p && fs.statSync(p).isFile()) return p;
    } catch {}
  return "";
}

// an address that is the rig, your home, your tailnet or otherwise not the public internet
function privIp(ip) {
  ip = String(ip).replace(/^::ffff:/i, "");
  if (net.isIPv4(ip)) {
    const [a, b, c] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0 && c === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase();
    return x === "::" || x === "::1" || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || /^ff/.test(x);
  }
  return !0;
}
// the address to connect to for a host name, or "" when it isn't allowed
async function publicAddr(host, allowLocal) {
  host = String(host || "").replace(/^\[|\]$/g, "");
  if (!host) return "";
  if (net.isIP(host)) return allowLocal || !privIp(host) ? host : "";
  if (!allowLocal && (/^localhost$/i.test(host) || /\.(local|localhost|internal|lan|home|home\.arpa|ts\.net)$/i.test(host) || !host.includes("."))) return "";
  try {
    const r = await dns.lookup(host, { all: !0 });
    if (!r.length) return "";
    if (!allowLocal && r.some((x) => privIp(x.address))) return "";
    return r[0].address;
  } catch {
    return "";
  }
}

const KEYS = { Enter: 13, Backspace: 8, Tab: 9, Escape: 27, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46, Home: 36, End: 35, PageUp: 33, PageDown: 34, " ": 32 };

// the real size of a JPEG picture (so clicks can be mapped onto the page whatever size it was sent at)
function jpegSize(b) {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) {
      i += m === 0xff ? 1 : 2;
      continue;
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}
function normUrl(u) {
  u = String(u || "").trim().slice(0, 2000);
  if (!u) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(u) && !/^[^\s/]+\.[a-z]{2,}:\d+/i.test(u)) return /^https?:\/\//i.test(u) ? u : "";
  if (!/\s/.test(u) && /^[^\s/]+\.[^\s/]{2,}([/?#].*)?$/.test(u)) return "https://" + u;
  return "https://duckduckgo.com/?q=" + encodeURIComponent(u);
}

// ---- limits for guests and the public (1.19.0) --------------------------------------------------------
// A built-in list of kinds of site a guest can't open (adult, gambling, piracy, and web proxies that would let
// someone slip past the rig's rules). It is a best effort: a list like this can't know every site. The strict
// protection is the owner's own "only these sites" list, which guests can't go outside of.
const BLOCK_WORDS = /(^|[.-])(porn|porno|xxx|sex|xvideos|xnxx|xhamster|redtube|youporn|pornhub|spankbang|onlyfans|fansly|chaturbate|stripchat|bongacams|livejasmin|camsoda|cam4|hentai|rule34|nhentai|e621|nsfw|escort|erotic|milf|brazzers|fap|jav|bet365|betway|bovada|draftkings|fanduel|casino|poker|sportsbook|slots|1xbet|stake|roobet|bc\.game|torrent|piratebay|thepiratebay|1337x|rarbg|yts|nyaa|kickass|limetorrents|fmovies|123movies|putlocker|soap2day|gomovies|streameast|croxyproxy|proxysite|kproxy|hidemyass|hide\.me|whoer|tor2web|onion|betting|wager|lottery|lotto|bingo|bookmaker|jackpot|gamble|gambling|sportsbet|parlay|gore|liveleak|bestgore|kaotic|snuff|darknet|silkroad|warez|nulled|keygen|cracked|escorts|camgirls|camshow|swinger|fetish|bdsm|nude|nudes|naked|topless|lingerie|thot|incest|hookup|sugardaddy)([.-]|$)/i;
const normHost = (e) => String(e || "").toLowerCase().trim().replace(/^[a-z]+:\/\//, "").replace(/^\*\./, "").replace(/^www\./, "").split(/[/?#:\s]/)[0].replace(/\.+$/, "");
// words that are safe to find anywhere inside a name (so "ecasino.net" and "pokerstars.eu" are caught)
const BLOCK_SUB = /(porn|xvideos|xnxx|xhamster|redtube|youporn|onlyfans|chaturbate|livejasmin|hentai|casino|pokerstars|piratebay|torrent|bet365|sportsbet|stripchat|bongacams)/i;
function hostBlocked(h) {
  h = normHost(h);
  return !!h && (BLOCK_WORDS.test(h) || BLOCK_SUB.test(h));
}
function hostListed(list, h) {
  h = normHost(h);
  return !!h && (list || []).some((e) => {
    e = normHost(e);
    return e && (h === e || h.endsWith("." + e));
  });
}
// the address a filtering DNS (like Cloudflare's family 1.1.1.3) gives for a site it won't let through
const isSink = (ip) => ip === "0.0.0.0" || ip === "::" || ip === "::0" || /^0+(:0+)*$/.test(String(ip));
async function sinkholed(host) {
  try {
    const r = await dns.lookup(host, { all: !0 });
    return r.length > 0 && r.every((x) => isSink(x.address));
  } catch {
    return !1;
  }
}
// search engines: always ask for strict safe search (a guest can't turn it off from inside the page, since every page they open is rewritten)
function safeSearchUrl(str) {
  let u;
  try {
    u = new URL(str);
  } catch {
    return null;
  }
  const h = normHost(u.hostname);
  let k = "",
    v = "";
  if (/^(html\.|lite\.)?duckduckgo\.com$/.test(h) && (u.searchParams.has("q") || /^\/(html|lite)/.test(u.pathname))) ((k = "kp"), (v = "1"));
  else if (/(^|\.)google\.[a-z.]{2,6}$/.test(h) && /^\/(search|images|webhp)/.test(u.pathname)) ((k = "safe"), (v = "active"));
  else if (/(^|\.)bing\.com$/.test(h) && /^\/(search|images|videos)/.test(u.pathname)) ((k = "adlt"), (v = "strict"));
  else return null;
  if (u.searchParams.get(k) === v) return null;
  u.searchParams.set(k, v);
  return u.toString();
}
const NOTE_PAGE = (t, b) => "<!doctype html><meta charset=utf-8><title>" + t + "</title><meta name=viewport content='width=device-width'><body style=\"margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#14161c;color:#eef1f6;font:16px/1.5 system-ui,sans-serif;text-align:center\"><div style=\"max-width:420px;padding:24px\"><h2 style=\"margin:0 0 8px\">" + t + "</h2><p style=\"margin:0;color:#aab3c2\">" + b + "</p></div></body>";

// ---- I2P (1.24.0) -----------------------------------------------------------------------------------------
// Optional: send the rig browser's traffic through the I2P network instead of straight out. I2P is a chain of other people's
// computers, so it is slower and many sites are slow or fail (that is why it is off unless the owner turns it on). The owner
// runs the I2P router on the rig; it listens on this computer only: 127.0.0.1:4444 for web pages (HTTP) and :4445 for HTTPS.
// The rig never looks the name up itself in this mode (no local DNS), and names that only make sense on the rig's own network
// are still refused, so a guest can't use this to reach the home network.
const I2P_DEFAULT = { on: !1, host: "127.0.0.1", http: 4444, https: 4445 };
function i2pCfg(c) {
  c = Object.assign({}, I2P_DEFAULT, c || {});
  const port = (v, d) => (Number.isInteger(+v) && +v >= 1 && +v <= 65535 ? +v : d);
  return { on: !!c.on, host: /^(127\.0\.0\.1|localhost|\[?::1\]?)$/i.test(String(c.host || "")) ? "127.0.0.1" : "127.0.0.1", http: port(c.http, 4444), https: port(c.https, 4445) };
}
// a name is fine to send through I2P if it is a public-looking name or an .i2p address; private ranges and rig-only names never are
function i2pTargetOk(host) {
  host = String(host || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  if (!host || host.length > 253) return !1;
  if (/\.i2p$/.test(host)) return /^[a-z0-9.-]+$/.test(host);
  if (net.isIP(host)) return !isPrivateIp(host);
  if (!host.includes(".")) return !1;
  if (/(^|\.)(localhost|local|lan|home|internal|intranet|corp|home\.arpa|ts\.net|onion)$/.test(host)) return !1;
  return /^[a-z0-9._-]+$/.test(host);
}
function isPrivateIp(ip) {
  if (net.isIPv6(ip)) return /^(::1?$|f[cd]|fe[89ab]|::ffff:(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.))/i.test(ip) || ip === "::";
  const p = ip.split(".").map(Number);
  return p[0] === 0 || p[0] === 10 || p[0] === 127 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || p[0] >= 224;
}
// is the I2P router answering on its two local ports?
function i2pProbe(c) {
  c = i2pCfg(c);
  const one = (port) => new Promise((ok) => {
    const s = net.connect({ host: c.host, port, timeout: 1500 }, () => (s.destroy(), ok(!0)));
    s.on("error", () => ok(!1));
    s.on("timeout", () => (s.destroy(), ok(!1)));
  });
  return Promise.all([one(c.http), one(c.https)]).then(([http, https]) => ({ http, https, host: c.host, httpPort: c.http, httpsPort: c.https }));
}
const I2P_DOWN = "I2P isn't answering on this computer. Start the I2P router on the rig (its web proxy is 127.0.0.1:4444), or turn I2P off in the Hub.";

function create(opts) {
  const log = opts.log || (() => {}),
    allowLocal = !!(opts.allowLocal || process.env.WB_BROWSER_ALLOW_LOCAL);
  // (1.22.0) several people at once, up to opts.max() (5 unless the owner changed it): one browser window each
  const SESS = new Map(),
    starts = new Set(),
    maxSess = () => Math.max(1, Math.min(10, Math.round(+(opts.max && opts.max()) || 5)));
  // profiles left behind if the Hub was stopped while someone had the browser open
  try {
    for (const n of fs.readdirSync(os.tmpdir())) /^wb-browser-[0-9a-f]{12}$/.test(n) && fs.rmSync(path.join(os.tmpdir(), n), { recursive: !0, force: !0 });
  } catch {}
  process.on("exit", () => {
    try {
      for (const x of SESS.values()) x.proc.kill();
    } catch {}
  });

  // ---- the filter every request goes through ----
  // (1.11.0) trying to reach a private address goes in the rule log: once, then at most every 5 minutes
  function blockNote(S) {
    if (S && opts.onBlock && Date.now() - (S.blockAt || 0) > 300000) {
      S.blockAt = Date.now();
      try {
        opts.onBlock(S.user);
      } catch {}
    }
  }
  function makeProxy(R) {
    const srv = http.createServer(async (req, res) => {
      req.on("error", () => {});
      res.on("error", () => {});
      req.socket && req.socket.on("error", () => {});
      let u;
      try {
        u = new URL(req.url);
      } catch {
        res.writeHead(400);
        return res.end();
      }
      if (R.s && R.s.policy && hostBlocked(u.hostname)) {
        R.s.refused = (R.s.refused || 0) + 1;
        res.writeHead(403, { "Content-Type": "text/plain" });
        return res.end("Not allowed.");
      }
      const I2 = i2pCfg(opts.i2p && opts.i2p());
      if (I2.on) {
        if (u.protocol !== "http:" || !i2pTargetOk(u.hostname)) {
          R.s && R.s.blocked++;
          R.s && (R.s.lastBlocked = u.hostname);
          blockNote(R.s);
          res.writeHead(403, { "Content-Type": "text/plain" });
          return res.end("Blocked: through I2P the rig's browser only reaches public sites and .i2p addresses.");
        }
        const h2 = Object.assign({}, req.headers);
        delete h2["proxy-connection"];
        const pr2 = http.request({ host: I2.host, port: I2.http, method: req.method, path: req.url, headers: h2, timeout: 60000 }, (r) => (res.writeHead(r.statusCode, r.headers), r.pipe(res)));
        pr2.on("timeout", () => pr2.destroy());
        pr2.on("error", () => {
          const sent = res.headersSent;
          sent || res.writeHead(502, { "Content-Type": "text/plain" });
          res.end(sent ? undefined : I2P_DOWN);
        });
        return req.pipe(pr2);
      }
      const addr = u.protocol === "http:" ? await publicAddr(u.hostname, allowLocal) : "";
      if (!addr && R.s && R.s.policy && (await sinkholed(u.hostname))) {
        R.s.refused = (R.s.refused || 0) + 1;
        res.writeHead(403, { "Content-Type": "text/plain" });
        return res.end("Not allowed.");
      }
      if (!addr) {
        R.s && R.s.blocked++;
        R.s && (R.s.lastBlocked = u.hostname);
        blockNote(R.s);
        res.writeHead(403, { "Content-Type": "text/plain" });
        return res.end("Blocked: the rig's browser only reaches the public internet.");
      }
      const h = Object.assign({}, req.headers);
      delete h["proxy-connection"];
      const pr = http.request({ host: addr, port: u.port || 80, method: req.method, path: u.pathname + u.search, headers: h }, (r) => (res.writeHead(r.statusCode, r.headers), r.pipe(res)));
      pr.on("error", () => (res.headersSent || res.writeHead(502), res.end()));
      req.pipe(pr);
    });
    srv.on("connect", async (req, sock, head) => {
      sock.on("error", () => {}); // the browser hanging up mustn't take the Hub down
      const m = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(req.url || "");
      if (m && R.s && R.s.policy && hostBlocked(m[1])) {
        R.s.refused = (R.s.refused || 0) + 1;
        sock.end("HTTP/1.1 403 Forbidden\r\n\r\n");
        return;
      }
      const I2 = i2pCfg(opts.i2p && opts.i2p());
      if (I2.on) {
        if (!m || +m[2] > 65535 || !i2pTargetOk(m[1])) {
          R.s && R.s.blocked++;
          R.s && m && (R.s.lastBlocked = m[1]);
          blockNote(R.s);
          return sock.end("HTTP/1.1 403 Forbidden\r\n\r\n");
        }
        // ask I2P's HTTPS proxy to open the tunnel, then pass the bytes both ways
        const up2 = net.connect({ host: I2.host, port: I2.https, timeout: 60000 }, () => up2.write("CONNECT " + m[1] + ":" + m[2] + " HTTP/1.1\r\nHost: " + m[1] + ":" + m[2] + "\r\n\r\n"));
        let buf = Buffer.alloc(0),
          done = !1;
        up2.on("data", (d) => {
          if (done) return;
          buf = Buffer.concat([buf, d]);
          const e = buf.indexOf("\r\n\r\n");
          if (e < 0) return buf.length > 8192 && (up2.destroy(), sock.destroy());
          done = !0;
          if (!/^HTTP\/1\.[01] 2\d\d/.test(buf.toString("latin1", 0, 20))) return (sock.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"), up2.destroy());
          sock.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          head && head.length && up2.write(head);
          const rest = buf.subarray(e + 4);
          rest.length && sock.write(rest);
          up2.removeAllListeners("data");
          up2.pipe(sock);
          sock.pipe(up2);
        });
        up2.on("timeout", () => up2.destroy());
        up2.on("error", () => (done ? sock.destroy() : sock.end("HTTP/1.1 502 Bad Gateway\r\n\r\n")));
        up2.on("close", () => sock.destroy());
        sock.on("close", () => up2.destroy());
        return;
      }
      const addr = m ? await publicAddr(m[1], allowLocal) : "";
      if (!addr && m && R.s && R.s.policy && (await sinkholed(m[1]))) {
        R.s.refused = (R.s.refused || 0) + 1;
        sock.end("HTTP/1.1 403 Forbidden\r\n\r\n");
        return;
      }
      if (!addr || +m[2] > 65535) {
        R.s && R.s.blocked++;
        R.s && m && (R.s.lastBlocked = m[1]);
        blockNote(R.s);
        sock.end("HTTP/1.1 403 Forbidden\r\n\r\n");
        return;
      }
      const up = net.connect(+m[2], addr, () => {
        sock.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        head && head.length && up.write(head);
        up.pipe(sock);
        sock.pipe(up);
      });
      up.on("error", () => sock.destroy());
      sock.on("close", () => up.destroy());
    });
    srv.on("clientError", (e, s) => s.destroy());
    return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
  }
  const freePort = () =>
    new Promise((ok) => {
      const s = net.createServer().listen(0, "127.0.0.1", () => {
        const p = s.address().port;
        s.close(() => ok(p));
      });
    });

  // ---- a Chrome DevTools connection ----
  function cdp(url) {
    return new Promise((ok, bad) => {
      const ws = new WebSocket(url),
        pending = new Map(),
        on = new Map();
      let id = 0;
      const c = {
        send: (method, params) =>
          new Promise((res, rej) => {
            const i = ++id;
            pending.set(i, { res, rej });
            try {
              ws.send(JSON.stringify({ id: i, method, params: params || {} }));
            } catch (e) {
              pending.delete(i);
              rej(e);
            }
          }),
        on: (ev, f) => on.set(ev, f),
        close: () => {
          try {
            ws.close();
          } catch {}
        },
      };
      ws.onopen = () => ok(c);
      ws.onerror = () => bad(new Error("The browser didn't answer."));
      ws.onclose = () => {
        for (const p of pending.values()) p.rej(new Error("closed"));
        pending.clear();
        c.onclose && c.onclose();
      };
      ws.onmessage = (m) => {
        let j;
        try {
          j = JSON.parse(m.data);
        } catch {
          return;
        }
        if (j.id && pending.has(j.id)) {
          const p = pending.get(j.id);
          pending.delete(j.id);
          j.error ? p.rej(new Error(j.error.message)) : p.res(j.result || {});
        } else if (j.method && on.has(j.method)) on.get(j.method)(j.params || {});
      };
    });
  }
  const getJson = (port, p) =>
    new Promise((ok, bad) => {
      http.get({ host: "127.0.0.1", port, path: p }, (r) => {
        let b = "";
        r.on("data", (d) => (b += d));
        r.on("end", () => {
          try {
            ok(JSON.parse(b));
          } catch (e) {
            bad(e);
          }
        });
      }).on("error", bad);
    });

  // make the real window (so the picture too) exactly w by h, by measuring the window's own frame
  async function setSize(s, w, h) {
    try {
      const win = await s.br.send("Browser.getWindowForTarget", { targetId: s.targetId }),
        m = await s.pg.send("Runtime.evaluate", { expression: "[outerWidth-innerWidth,outerHeight-innerHeight]", returnByValue: !0 }),
        [dw, dh] = (m.result && m.result.value) || [0, 0];
      await s.br.send("Browser.setWindowBounds", { windowId: win.windowId, bounds: { windowState: "normal", width: w + dw, height: h + dh } });
      await new Promise((r) => setTimeout(r, 120));
      const c = await s.pg.send("Runtime.evaluate", { expression: "[innerWidth,innerHeight]", returnByValue: !0 }),
        [iw, ih] = (c.result && c.result.value) || [0, 0];
      if (iw === w && ih === h) await s.pg.send("Emulation.clearDeviceMetricsOverride").catch(() => {});
      else await s.pg.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: !1 });
    } catch {
      await s.pg.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: !1 });
    }
    s.w = w;
    s.h = h;
    await s.pg.send("Page.stopScreencast").catch(() => {});
    await s.pg.send("Page.startScreencast", { format: "jpeg", quality: 55, maxWidth: w, maxHeight: h, everyNthFrame: 1 });
  }
  async function start(user, cfg, policy) {
    if (SESS.has(user.id)) return state(user);
    if (starts.has(user.id)) throw Object.assign(new Error("The rig's browser is starting. Try again in a moment."), { code: 409 });
    if (SESS.size + starts.size >= maxSess()) throw Object.assign(new Error("The rig's browser is full right now (" + maxSess() + " people are using it). Try again in a few minutes."), { code: 409 });
    const exe = findExe(cfg && cfg.exe);
    if (!exe) throw Object.assign(new Error("The rig has no Edge or Chrome to use. Install Microsoft Edge or Google Chrome on the rig."), { code: 400 });
    if (os.freemem() < 0.9e9) throw Object.assign(new Error("The rig is low on memory right now (under 1 GB free). Try again later, or close something on the rig."), { code: 503 });
    starts.add(user.id);
    const R = { s: null };
    let proc = null,
      proxy = null,
      dir = "";
    try {
      proxy = await makeProxy(R);
      const port = await freePort(),
        id = crypto.randomBytes(6).toString("hex");
      dir = path.join(os.tmpdir(), "wb-browser-" + id);
      fs.mkdirSync(dir, { recursive: !0 });
      const args = [
        "--headless=new",
        "--remote-debugging-port=" + port,
        "--remote-debugging-address=127.0.0.1",
        "--user-data-dir=" + dir,
        "--proxy-server=http://127.0.0.1:" + proxy.address().port,
        "--proxy-bypass-list=<-loopback>",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-sync",
        "--disable-translate",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-features=Translate,OptimizationHints,MediaRouter",
        "--mute-audio",
        "--password-store=basic",
        "--use-mock-keychain",
        "--window-size=1280,720",
        "about:blank",
      ];
      if (i2pCfg(opts.i2p && opts.i2p()).on) args.push("--force-webrtc-ip-handling-policy=disable_non_proxied_udp", "--webrtc-ip-handling-policy=disable_non_proxied_udp");
      if (process.platform === "linux") args.push("--disable-dev-shm-usage", ...(process.getuid && process.getuid() === 0 ? ["--no-sandbox"] : []));
      proc = spawn(exe, args, { stdio: "ignore", windowsHide: !0 });
      proc.on("error", () => {});
      let ver = null;
      for (let i = 0; i < 60 && !ver; i++) {
        await new Promise((r) => setTimeout(r, 250));
        if (proc.exitCode != null) throw new Error("The browser closed straight away.");
        try {
          ver = await getJson(port, "/json/version");
        } catch {}
      }
      if (!ver) throw new Error("The browser didn't start.");
      let page = null;
      for (let i = 0; i < 20 && !page; i++) {
        const l = await getJson(port, "/json/list").catch(() => []);
        page = l.find((t) => t.type === "page");
        page || (await new Promise((r) => setTimeout(r, 150)));
      }
      if (!page) throw new Error("The browser has no page.");
      const br = await cdp(ver.webSocketDebuggerUrl),
        pg = await cdp(page.webSocketDebuggerUrl);
      const sess = (R.s = { user: { id: user.id, name: user.name }, targetId: page.id, id, proc, proxy, dir, br, pg, port, at: Date.now(), seen: Date.now(), url: "about:blank", title: "", host: "", n: 0, frame: null, waiters: [], blocked: 0, lastBlocked: "", w: 1280, h: 720, fw: 1280, fh: 720 });
      SESS.set(user.id, sess);
      sess.policy = policy || null;
      proc.on("exit", () => SESS.get(user.id) === sess && stop("The browser closed.", sess));
      pg.onclose = () => SESS.get(user.id) === sess && stop("The browser closed.", sess);
      pg.on("Page.screencastFrame", (p) => {
        pg.send("Page.screencastFrameAck", { sessionId: p.sessionId }).catch(() => {});
        sess.frame = Buffer.from(p.data, "base64");
        const z = jpegSize(sess.frame);
        z && ((sess.fw = z.w), (sess.fh = z.h));
        sess.n++;
        const w = sess.waiters.splice(0);
        for (const f of w) f();
      });
      pg.on("Page.frameNavigated", (p) => {
        const f = p.frame || {};
        if (f.parentId) return;
        sess.url = String(f.url || "").slice(0, 600);
        if (!/^https?:|^about:blank$/i.test(sess.url)) {
          pg.send("Page.navigate", { url: "about:blank" }).catch(() => {});
          return;
        }
        let h = "";
        try {
          h = new URL(sess.url).hostname;
        } catch {}
        if (h && h !== sess.host) {
          sess.host = h;
          opts.onVisit && opts.onVisit(h, sess.user);
        }
        pg.send("Runtime.evaluate", { expression: "document.title" }).then((r) => (sess.title = String((r.result && r.result.value) || "").slice(0, 120))).catch(() => {});
      });
      pg.on("Page.javascriptDialogOpening", (p) => pg.send("Page.handleJavaScriptDialog", { accept: p.type === "alert" }).catch(() => {}));
      await br.send("Browser.setDownloadBehavior", { behavior: "deny" }).catch(() => {});
      await pg.send("Page.enable");
      if (sess.policy) {
        // no files in (the file chooser is held and never answered), and every page the guest opens is checked
        await pg.send("Page.setInterceptFileChooserDialog", { enabled: !0 }).catch(() => {});
        pg.on("Fetch.requestPaused", async (p) => {
          let h = "";
          try {
            h = new URL(p.request.url).hostname;
          } catch {}
          let why = !h ? "" : hostBlocked(h) ? "cat" : sess.policy.only && !hostListed(sess.policy.only, h) ? "list" : "";
          if (!why && h && !/^[\d.]+$/.test(h) && (await sinkholed(h))) why = "cat";
          if (!why) {
            const ss = safeSearchUrl(p.request.url);
            return void pg.send("Fetch.continueRequest", ss ? { requestId: p.requestId, url: ss } : { requestId: p.requestId }).catch(() => {});
          }
          sess.refused = (sess.refused || 0) + 1;
          const page = why === "list" ? NOTE_PAGE("That site isn't on the list", "The owner only lets this browser open the sites on their list.") : NOTE_PAGE("Not allowed here", "This kind of site is blocked for guests.");
          pg.send("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "text/html; charset=utf-8" }], body: Buffer.from(page).toString("base64") }).catch(() => {});
        });
        await pg.send("Fetch.enable", { patterns: [{ urlPattern: "*", resourceType: "Document", requestStage: "Request" }] });
        if (sess.policy.minutes) {
          sess.endsAt = Date.now() + sess.policy.minutes * 60000;
          sess.cap = setTimeout(() => SESS.get(user.id) === sess && stop("The " + sess.policy.minutes + " minutes ran out.", sess), sess.policy.minutes * 60000);
        }
      }
      // links that want a new window open here instead (there is only one window)
      await pg.send("Page.addScriptToEvaluateOnNewDocument", { source: "window.open=function(u){if(u)location.href=u;return null};document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[target]');if(a)a.target='_self'},true);" });
      await pg.send("Emulation.setFocusEmulationEnabled", { enabled: !0 }).catch(() => {});
      await pg.send("Page.bringToFront").catch(() => {});
      await setSize(sess, 1280, 720);
      sess.tt = setInterval(() => SESS.get(user.id) === sess && pg.send("Runtime.evaluate", { expression: "document.title" }).then((r) => (sess.title = String((r.result && r.result.value) || "").slice(0, 120))).catch(() => {}), 3000);
      sess.idle = setInterval(() => SESS.get(user.id) === sess && Date.now() - sess.seen > (opts.idleMs || 10 * 60000) && stop("It was idle for 10 minutes.", sess), 15000);
      log("Browser started for", user.name);
      return state(user);
    } catch (e) {
      try {
        proc && proc.kill();
        proxy && proxy.close();
      } catch {}
      if (R.s && SESS.get(user.id) === R.s) SESS.delete(user.id);
      throw Object.assign(new Error(e.message || "The browser didn't start."), { code: e.code || 500 });
    } finally {
      starts.delete(user.id);
    }
  }
  // stop(why) closes every window; stop(why, user id) one person's; stop(why, session) that window
  function stop(why, who) {
    if (who === void 0) return void [...SESS.values()].forEach((x) => stop(why, x));
    const s = typeof who === "string" ? SESS.get(who) : who;
    if (!s || SESS.get(s.user.id) !== s) return;
    SESS.delete(s.user.id);
    clearInterval(s.idle);
    clearInterval(s.tt);
    clearTimeout(s.cap);
    for (const f of s.waiters.splice(0)) f();
    try {
      s.pg.close();
      s.br.close();
    } catch {}
    try {
      s.proxy.close();
      s.proxy.closeAllConnections && s.proxy.closeAllConnections();
    } catch {}
    const kill = () => {
      try {
        if (WIN && s.proc.pid) spawn("taskkill", ["/pid", String(s.proc.pid), "/T", "/F"], { stdio: "ignore", windowsHide: !0 });
        else s.proc.kill("SIGKILL");
      } catch {}
    };
    kill();
    setTimeout(() => {
      kill();
      try {
        fs.rmSync(s.dir, { recursive: !0, force: !0 });
      } catch {}
    }, 2500);
    log("Browser stopped for", s.user.name, why ? "· " + why : "");
    opts.onStop && opts.onStop(s.user, why || "");
  }
  function state(user) {
    const exe = findExe(opts.exe && opts.exe()),
      S = (user && SESS.get(user.id)) || null;
    return { inUse: SESS.size, max: maxSess(), full: SESS.size + starts.size >= maxSess() && !S, available: !!exe, active: S ? { user: S.user.name, since: S.at, host: S.host, mine: !!user && S.user.id === user.id, blocked: S.blocked, lastBlocked: S.lastBlocked, endsAt: S.endsAt || 0, refused: S.refused || 0, limited: !!S.policy } : null, url: S ? S.url : "", title: S ? S.title : "", w: S ? S.w : 0, h: S ? S.h : 0, n: S ? S.n : 0 };
  }
  const mine = (user) => {
    const S = SESS.get(user.id);
    if (!S) throw Object.assign(new Error("You don't have the rig's browser open."), { code: 409 });
    S.seen = Date.now();
    return S;
  };
  async function go(user, url) {
    const s = mine(user);
    if (url === "back" || url === "forward") return s.pg.send("Runtime.evaluate", { expression: "history." + url + "()" });
    if (url === "reload") return s.pg.send("Page.reload");
    const u = normUrl(url);
    if (!u) throw Object.assign(new Error("Type a web address or something to search for."), { code: 400 });
    if (s.policy && s.policy.only && !s.policy.only.length) throw Object.assign(new Error("The owner hasn't added any allowed sites yet."), { code: 403 });
    await s.pg.send("Page.navigate", { url: u });
  }
  async function resize(user, w, h) {
    const s = mine(user);
    w = Math.max(320, Math.min(1600, Math.round(+w || 1280)));
    h = Math.max(240, Math.min(1000, Math.round(+h || 720)));
    if (w === s.w && h === s.h) return;
    await setSize(s, w, h);
  }
  async function input(user, list) {
    const s = mine(user),
      pg = s.pg;
    // clicks come in the picture's own pixels; the page wants its own
    const kx = s.w / (s.fw || s.w),
      ky = s.h / (s.fh || s.h);
    for (const e of [].concat(list || []).slice(0, 60)) {
      const x = Math.max(0, Math.min(s.w, Math.round((+e.x || 0) * kx))),
        y = Math.max(0, Math.min(s.h, Math.round((+e.y || 0) * ky))),
        btn = e.b === 2 ? "right" : e.b === 1 ? "middle" : "left";
      if (e.t === "m") await pg.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: e.d ? 1 : 0 });
      else if (e.t === "d") await pg.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: btn, buttons: 1, clickCount: e.c || 1 });
      else if (e.t === "u") await pg.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: btn, buttons: 0, clickCount: e.c || 1 });
      else if (e.t === "w") await pg.send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: Math.max(-2000, Math.min(2000, +e.dx || 0)), deltaY: Math.max(-2000, Math.min(2000, +e.dy || 0)) });
      else if (e.t === "x") {
        const t = String(e.text || "").slice(0, 2000);
        t && (await pg.send("Input.insertText", { text: t }));
      } else if (e.t === "k") {
        const k = String(e.key || "").slice(0, 20),
          mod = (e.alt ? 1 : 0) | (e.ctrl ? 2 : 0) | (e.meta ? 4 : 0) | (e.shift ? 8 : 0),
          vk = KEYS[k] || (/^[a-z0-9]$/i.test(k) ? k.toUpperCase().charCodeAt(0) : 0);
        if (e.ctrl || e.meta) {
          const cmd = { a: "selectAll", z: "undo", y: "redo" }[k.toLowerCase()];
          await pg.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: k, modifiers: mod, windowsVirtualKeyCode: vk, ...(cmd ? { commands: [cmd] } : {}) });
          await pg.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, modifiers: mod, windowsVirtualKeyCode: vk });
        } else if (k.length === 1) {
          await pg.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, text: k, unmodifiedText: k, modifiers: mod, windowsVirtualKeyCode: vk });
          await pg.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, modifiers: mod, windowsVirtualKeyCode: vk });
        } else if (KEYS[k]) {
          await pg.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: k, modifiers: mod, windowsVirtualKeyCode: vk, ...(k === "Enter" ? { text: "\r" } : {}) });
          await pg.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, modifiers: mod, windowsVirtualKeyCode: vk });
        }
      }
    }
  }
  // the newest picture, once there's one newer than n (or after waitMs)
  async function frame(user, n, waitMs) {
    let s = mine(user);
    if (s.n <= n && waitMs) await new Promise((ok) => (s.waiters.push(ok), setTimeout(ok, waitMs)));
    s = SESS.get(user.id);
    if (!s) throw Object.assign(new Error("The rig's browser closed."), { code: 409 });
    s.seen = Date.now();
    return { n: s.n, buf: s.n > n ? s.frame : null, url: s.url, title: s.title, w: s.fw || s.w, h: s.fh || s.h };
  }
  return { proxyForTest: makeProxy, start, stop, go, input, resize, frame, state, all: () => [...SESS.values()], active: () => [...SESS.values()][0] || null };
}

module.exports = { create, i2pCfg, i2pProbe, i2pTargetOk, findExe, privIp, publicAddr, normUrl, hostBlocked, hostListed, normHost, safeSearchUrl, sinkholed };
