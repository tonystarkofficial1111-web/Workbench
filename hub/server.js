// Workbench Hub: the home server on the rig. One folder on one drive holds everything (Work,
// designs, music, videos, saves and settings), and every device running Workbench syncs with it
// over Tailscale. It also sends phone notifications, hands the AI (Ollama) to every device, and
// updates itself from the Workbench site. Plain Node.js, no packages to install.
//
//   node server.js                      start the Hub
//   node server.js --init-owner NAME PIN    create the owner (the installer does this)
//   node server.js --reset-pin NAME PIN     set a new PIN for someone who forgot theirs
"use strict";
const http = require("http"),
  fs = require("fs"),
  fsp = fs.promises,
  path = require("path"),
  crypto = require("crypto"),
  os = require("os"),
  push = require("./push.js"),
  { readTags } = require("./tags.js"),
  { __wbReminders } = require("./reminders.js");

const VERSION = "1.1.0";
const HOME = process.env.WB_HUB_HOME || path.join(__dirname, "..");
const CONF = process.env.WB_HUB_CONFIG || path.join(HOME, "hub.json");
const APP = "https://tonystarkofficial1111-web.github.io";

// ---- settings ----------------------------------------------------------------------------------
const DEF = {
  port: 8770,
  host: "127.0.0.1",
  root: path.join(os.homedir(), "Workbench Hub"),
  name: os.hostname(),
  origins: [APP],
  ollama: "http://127.0.0.1:11434",
  aiModel: "",
  lang: "",
  update: APP + "/Workbench/hub/",
  autoUpdate: true,
  // more music or video folders, for example a second drive later:
  // [{ "path": "E:\\Music", "kind": "music", "everyone": false }]
  libraries: [],
  // a second copy of work.json every day, for example on a second drive later: "E:\\Backups"
  backupDir: "",
};
const readJson = (f, d) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return d;
  }
};
function writeJson(f, v) {
  fs.mkdirSync(path.dirname(f), { recursive: !0 });
  const t = f + "." + process.pid + ".tmp";
  fs.writeFileSync(t, JSON.stringify(v, null, 1));
  fs.renameSync(t, f);
}
const C = Object.assign({}, DEF, readJson(CONF, {}));
const hubf = (n) => path.join(C.root, ".hub", n);
const WORK = () => path.join(C.root, "Work");
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const id36 = () => Date.now().toString(36) + crypto.randomBytes(4).toString("hex");

// ---- log ---------------------------------------------------------------------------------------
const LOG = path.join(HOME, "logs", "hub.log");
function log(...a) {
  const line = new Date().toISOString() + " " + a.join(" ");
  console.log(line);
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: !0 });
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > 2e6) fs.renameSync(LOG, LOG + ".old");
    fs.appendFileSync(LOG, line + "\n");
  } catch {}
}

// ---- people and devices ------------------------------------------------------------------------
let U = { users: [] },
  DV = { devices: [] },
  VAPID = null,
  dvT = 0;
const saveUsers = () => writeJson(hubf("users.json"), U);
const saveDevices = () => (clearTimeout(dvT), writeJson(hubf("devices.json"), DV));
const saveDevicesSoon = () => (clearTimeout(dvT), (dvT = setTimeout(saveDevices, 3000)));
const pinHash = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString("hex");
const safeName = (s) =>
  String(s || "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 60);
const userDir = (u, kind) => path.join(C.root, "Users", u.dir, kind || "");
const canWork = (u) => !!u && (u.role === "owner" || !!u.work);
const pub = (u) => ({ id: u.id, name: u.name, role: u.role, work: canWork(u) });
function addUser(name, pin, role, work) {
  name = String(name || "").trim();
  if (!name || !/^\d{4,12}$/.test(String(pin))) throw new Error("A name and a PIN of 4 to 12 digits are needed.");
  if (U.users.some((u) => u.name.toLowerCase() === name.toLowerCase())) throw new Error("Someone called " + name + " is already on the Hub.");
  let dir = safeName(name) || "User",
    n = 2;
  while (U.users.some((u) => u.dir.toLowerCase() === dir.toLowerCase())) dir = safeName(name) + " " + n++;
  const salt = crypto.randomBytes(16).toString("hex"),
    u = { id: id36(), name, dir, role, work: role === "owner" || !!work, salt, hash: pinHash(pin, salt), created: Date.now() };
  U.users.push(u);
  for (const k of ["Music", "Videos", "Saves"]) fs.mkdirSync(userDir(u, k), { recursive: !0 });
  saveUsers();
  return u;
}
function setPin(u, pin) {
  if (!/^\d{4,12}$/.test(String(pin))) throw new Error("Use a PIN of 4 to 12 digits.");
  u.salt = crypto.randomBytes(16).toString("hex");
  u.hash = pinHash(pin, u.salt);
  saveUsers();
}

function setup() {
  for (const d of [".hub/cache", ".hub/backups", "Work", "Users", "Shared/Music", "Shared/Videos"]) fs.mkdirSync(path.join(C.root, d), { recursive: !0 });
  U = readJson(hubf("users.json"), { users: [] });
  DV = readJson(hubf("devices.json"), { devices: [] });
  VAPID = readJson(hubf("vapid.json"), null);
  if (!VAPID) writeJson(hubf("vapid.json"), (VAPID = push.makeVapid()));
  if (!fs.existsSync(CONF)) writeJson(CONF, C);
}

// ---- HTTP helpers ------------------------------------------------------------------------------
function json(res, code, obj) {
  if (res.headersSent) return res.end();
  const b = Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj));
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Content-Length": b.length, "Cache-Control": "no-store" });
  res.end(b);
}
const fail = (res, code, msg) => json(res, code, { error: msg });
function body(req, limit) {
  return new Promise((ok, bad) => {
    const parts = [];
    let n = 0;
    req.on("data", (c) => {
      n += c.length;
      if (n > (limit || 64e6)) (bad(new Error("Too big")), req.destroy());
      else parts.push(c);
    });
    req.on("end", () => ok(Buffer.concat(parts)));
    req.on("error", bad);
  });
}
async function jsonBody(req, limit) {
  const b = await body(req, limit);
  try {
    return b.length ? JSON.parse(b.toString("utf8")) : {};
  } catch {
    throw Object.assign(new Error("That wasn't valid data."), { code: 400 });
  }
}
function allowOrigin(o) {
  if (!o) return "";
  if (o === "null" || (C.origins || []).includes(o)) return o;
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(o)) return o;
  if (/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net$/i.test(o)) return o;
  return "";
}
function cors(req, res) {
  const o = allowOrigin(req.headers.origin);
  res.setHeader("Vary", "Origin");
  if (!o) return;
  res.setHeader("Access-Control-Allow-Origin", o);
  res.setHeader("Access-Control-Expose-Headers", "ETag, Content-Range, Accept-Ranges, Content-Length, X-Rev");
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", req.headers["access-control-request-headers"] || "Authorization, Content-Type, Range");
    res.setHeader("Access-Control-Max-Age", "600");
    if (req.headers["access-control-request-private-network"]) res.setHeader("Access-Control-Allow-Private-Network", "true");
  }
}
// a path inside base, or null if it tries to leave it
function inside(base, rel) {
  rel = String(rel || "").replace(/\\/g, "/");
  if (!rel || rel.includes("\0") || /(^|\/)\.\.(\/|$)/.test(rel) || /^[a-z]:/i.test(rel) || rel.startsWith("/") || /:/.test(rel)) return null;
  const full = path.resolve(base, rel),
    r = path.relative(base, full);
  return r && !r.startsWith("..") && !path.isAbsolute(r) ? full : null;
}
const TYPES = { mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", weba: "audio/webm", aif: "audio/aiff", aiff: "audio/aiff", mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska", ogv: "video/ogg", psd: "image/vnd.adobe.photoshop", psb: "image/vnd.adobe.photoshop", pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", svg: "image/svg+xml", gif: "image/gif", tif: "image/tiff", tiff: "image/tiff", json: "application/json", txt: "text/plain; charset=utf-8" };
const typeOf = (f) => TYPES[path.extname(f).slice(1).toLowerCase()] || "application/octet-stream";
function sendFile(req, res, file, download) {
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return fail(res, 404, "That file isn't on the rig.");
  }
  if (!st.isFile()) return fail(res, 404, "That file isn't on the rig.");
  const size = st.size;
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", typeOf(file));
  res.setHeader("ETag", '"' + size.toString(36) + "-" + Math.floor(st.mtimeMs).toString(36) + '"');
  res.setHeader("Last-Modified", st.mtime.toUTCString());
  res.setHeader("Cache-Control", "private, no-cache");
  if (download) res.setHeader("Content-Disposition", "attachment; filename*=UTF-8''" + encodeURIComponent(path.basename(file)));
  let start = 0,
    end = size - 1,
    code = 200;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || "").trim());
  if (m && size) {
    if (m[1] === "") start = Math.max(0, size - +m[2]);
    else ((start = +m[1]), m[2] !== "" && (end = Math.min(+m[2], size - 1)));
    if (start > end || start >= size) {
      res.writeHead(416, { "Content-Range": "bytes */" + size });
      return res.end();
    }
    code = 206;
    res.setHeader("Content-Range", "bytes " + start + "-" + end + "/" + size);
  }
  res.setHeader("Content-Length", size ? end - start + 1 : 0);
  res.writeHead(code);
  if (req.method === "HEAD" || !size) return res.end();
  const s = fs.createReadStream(file, { start, end });
  s.on("error", () => res.destroy());
  res.on("close", () => s.destroy());
  s.pipe(res);
}
// a file upload, streamed straight to disk (any size), then put in place
async function receive(req, dest) {
  await fsp.mkdir(path.dirname(dest), { recursive: !0 });
  const tmp = dest + ".part";
  await new Promise((ok, bad) => {
    const w = fs.createWriteStream(tmp);
    req.pipe(w);
    w.on("finish", ok);
    w.on("error", bad);
    req.on("aborted", () => (w.destroy(), bad(new Error("The upload stopped."))));
  });
  await fsp.rename(tmp, dest);
  return (await fsp.stat(dest)).size;
}

// ---- sign in -----------------------------------------------------------------------------------
const tries = new Map();
function auth(req, url) {
  const h = String(req.headers.authorization || ""),
    tok = h.startsWith("Bearer ") ? h.slice(7).trim() : url.searchParams.get("t") || "";
  if (!tok) return null;
  const th = sha(tok),
    d = DV.devices.find((x) => x.tokenHash === th),
    u = d && U.users.find((x) => x.id === d.user);
  if (!u) return null;
  if (Date.now() - (d.seen || 0) > 60000) ((d.seen = Date.now()), saveDevicesSoon());
  return { user: u, device: d };
}
function login(b) {
  const name = String(b.name || "").trim(),
    key = name.toLowerCase(),
    t = tries.get(key) || { n: 0, until: 0 };
  if (t.until > Date.now()) throw Object.assign(new Error("Too many wrong PINs. Try again in " + Math.ceil((t.until - Date.now()) / 60000) + " minutes."), { code: 429 });
  const u = U.users.find((x) => x.name.toLowerCase() === key);
  if (!u || pinHash(String(b.pin || ""), u.salt) !== u.hash) {
    t.n++;
    if (t.n >= 5) ((t.until = Date.now() + (t.n >= 10 ? 60 : 15) * 60000), t.n >= 10 && (t.n = 5));
    tries.set(key, t);
    throw Object.assign(new Error(u ? "That PIN isn't right." : "Nobody called " + (name || "that") + " is on this Hub. Ask the owner to add you."), { code: 401 });
  }
  tries.delete(key);
  const token = crypto.randomBytes(32).toString("base64url"),
    d = { id: id36(), user: u.id, name: String(b.device || "Device").slice(0, 60), tokenHash: sha(token), created: Date.now(), seen: Date.now(), push: null, notify: !0 };
  DV.devices.push(d);
  saveDevices();
  log("Signed in:", u.name, "on", d.name);
  return { token, user: pub(u), device: { id: d.id, name: d.name } };
}

// ---- live updates (Server-Sent Events) ---------------------------------------------------------
const live = new Set();
function broadcast(ev, filter) {
  const line = "data: " + JSON.stringify(ev) + "\n\n";
  for (const c of live) if (!filter || filter(c)) c.res.write(line);
}
setInterval(() => {
  for (const c of live) c.res.write(": ping\n\n");
}, 25000).unref();

// ---- Work --------------------------------------------------------------------------------------
const workFile = () => path.join(WORK(), "work.json");
function readWorkText() {
  try {
    return fs.readFileSync(workFile(), "utf8");
  } catch {
    return "";
  }
}
const revOf = (t) => (t ? sha(t).slice(0, 16) : "");
function readWork() {
  const t = readWorkText();
  try {
    return t ? JSON.parse(t) : null;
  } catch {
    return null;
  }
}
function backupWork(text) {
  const day = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  for (const dir of [hubf("backups"), C.backupDir ? path.join(C.backupDir, "Workbench Hub backups") : ""].filter(Boolean))
    try {
      fs.mkdirSync(dir, { recursive: !0 });
      fs.writeFileSync(path.join(dir, "work-" + day + ".json"), text);
      const old = fs
        .readdirSync(dir)
        .filter((n) => /^work-\d{4}-\d\d-\d\d\.json$/.test(n))
        .sort()
        .reverse();
      for (const n of old.slice(90)) fs.unlinkSync(path.join(dir, n));
    } catch (e) {
      log("backup:", e.message);
    }
}

// ---- music and videos --------------------------------------------------------------------------
// Each person's own Music and Videos folders, the Shared ones, and folders the owner adds from
// anywhere on the rig (a big folder of everything, a second drive later). Those are read where
// they are: nothing is moved or copied. In a mixed folder ("auto") Workbench picks out what it
// needs by folder names and file types: songs from music-looking folders (or anything that is
// clearly a song), videos, and it skips photo folders, program folders and tiny sound effects.
const EXT = { music: /\.(mp3|m4a|aac|flac|wav|ogg|oga|opus|weba|aif|aiff)$/i, video: /\.(mp4|m4v|webm|mov|mkv|ogv)$/i };
const FOLDER = { music: "Music", video: "Videos" };
const SKIP_DIR = /^(\$recycle\.bin|system volume information|windows|program files( \(x86\))?|programdata|appdata|node_modules|\.git|\.hub|temp|tmp|cache|caches|steamapps|xboxgames|recovery|perflogs)$/i;
const PHOTO_DIR = /(^|[\s_.-])(photos?|pictures?|pics|imgs?|images?|camera|camera roll|dcim|screenshots?|wallpapers?|fotos?|im[aá]genes|selfies)($|[\s_.-])/i;
const MUSIC_DIR = /(^|[\s_.-])(music|songs?|audio|mp3s?|tracks?|beats?|albums?|playlists?|dj|m[uú]sica|canciones|mixes|remixes|instrumentals?)($|[\s_.-])/i;
const VIDEO_DIR = /(^|[\s_.-])(videos?|v[ií]deos|movies?|films?|clips?|shows?|series|pel[ií]culas|tv|anime|recordings?)($|[\s_.-])/i;
// what a folder looks like it holds, from its own name or the nearest parent with a telling name
function folderHint(names) {
  for (let i = names.length - 1; i >= 0; i--) {
    if (PHOTO_DIR.test(names[i])) return "photo";
    if (MUSIC_DIR.test(names[i])) return "music";
    if (VIDEO_DIR.test(names[i])) return "video";
  }
  return "";
}
// which list a file belongs in, in a mixed folder (or null to leave it out)
function autoKind(name, size, hint) {
  if (hint === "photo") return null;
  if (EXT.music.test(name)) return hint === "music" || size >= 1.2e6 ? "music" : null;
  if (EXT.video.test(name)) return size >= 1e6 ? "video" : null;
  return null;
}
let tagCache = null,
  tagT = 0;
const libCache = new Map();
const libId = (p) => sha(String(p).toLowerCase()).slice(0, 8);
function libraries() {
  let L = [].concat(C.libraries || []).filter((l) => l && l.path);
  for (const l of L) l.id = l.id || libId(l.path);
  return L;
}
// the folders a person sees for one kind (music or video)
function libsFor(u, kind) {
  const out = [
    { key: "u:" + u.id + ":" + kind, scope: "u", dir: userDir(u, FOLDER[kind]), mode: kind, label: "Mine" },
    { key: "s:" + kind, scope: "s", dir: path.join(C.root, "Shared", FOLDER[kind]), mode: kind, label: "Shared" },
  ];
  for (const l of libraries()) {
    const mode = l.kind === "music" || l.kind === "video" ? l.kind : "auto";
    if ((mode === kind || mode === "auto") && (l.everyone || u.role === "owner")) out.push({ key: "l:" + l.id, scope: "l" + l.id, dir: l.path, mode, label: l.label || path.basename(l.path) || l.path });
  }
  return out;
}
function libDir(u, scope, kind) {
  const l = libsFor(u, kind).find((x) => x.scope === scope);
  return l ? l.dir : null;
}
const mediaId = (kind, scope, rel) => Buffer.from(kind + "\n" + scope + "\n" + rel).toString("base64url");
function fromId(id) {
  const p = Buffer.from(String(id || ""), "base64url").toString("utf8").split("\n");
  return p.length === 3 && FOLDER[p[0]] ? { kind: p[0], scope: p[1], rel: p[2] } : null;
}
function tagsOf(file, st, name) {
  if (!tagCache) tagCache = readJson(hubf("cache/tags.json"), {});
  const k = file,
    c = tagCache[k];
  if (c && c.s === st.size && c.m === Math.floor(st.mtimeMs)) return c;
  const t = readTags(file, name);
  tagCache[k] = { s: st.size, m: Math.floor(st.mtimeMs), title: t.title, artist: t.artist, album: t.album, bpm: t.bpm, key: t.key };
  clearTimeout(tagT);
  tagT = setTimeout(() => writeJson(hubf("cache/tags.json"), tagCache), 2000);
  return tagCache[k];
}
// one walk through a folder collects its music and its videos
async function scanLib(L) {
  const out = { music: [], video: [] };
  const walk = async (dir, rel, names) => {
    let ents;
    try {
      ents = await fsp.readdir(dir, { withFileTypes: !0 });
    } catch {
      return;
    }
    const hint = L.mode === "auto" ? folderHint(names) : "";
    for (const e of ents) {
      if (e.name.startsWith(".") || e.name.startsWith("~$")) continue;
      const full = path.join(dir, e.name),
        r = rel ? rel + "/" + e.name : e.name;
      if (e.isDirectory()) {
        if (names.length >= 14 || SKIP_DIR.test(e.name) || (L.mode === "auto" && PHOTO_DIR.test(e.name))) continue;
        await walk(full, r, [...names, e.name]);
        continue;
      }
      if (e.name.endsWith(".part")) continue;
      const maybe = L.mode === "auto" ? EXT.music.test(e.name) || EXT.video.test(e.name) : EXT[L.mode].test(e.name);
      if (!maybe) continue;
      let st;
      try {
        st = await fsp.stat(full);
      } catch {
        continue;
      }
      const kind = L.mode === "auto" ? autoKind(e.name, st.size, hint) : L.mode;
      if (!kind) continue;
      const t = kind === "music" ? tagsOf(full, st, e.name) : { title: e.name.replace(/\.[^.]+$/, "") };
      out[kind].push({ id: mediaId(kind, L.scope, r), name: e.name, title: t.title, artist: t.artist || "", album: t.album || "", bpm: t.bpm || 0, key: t.key || "", size: st.size, mtime: Math.floor(st.mtimeMs), type: typeOf(e.name), scope: L.scope, where: L.label, folder: rel });
    }
  };
  await walk(L.dir, "", []);
  return out;
}
// a folder's list, from memory when it's recent (and refreshed in the background when older)
async function libItems(L, kind) {
  const c = libCache.get(L.key);
  if (c && Date.now() - c.t > 60000 && !c.busy)
    c.busy = scanLib(L)
      .then((items) => libCache.set(L.key, { t: Date.now(), items }))
      .catch(() => (c.busy = null));
  if (c) return c.items[kind] || [];
  const items = await scanLib(L);
  libCache.set(L.key, { t: Date.now(), items });
  return items[kind] || [];
}
const scanning = new Set();
const forget = (u, kind) => (libCache.delete("u:" + u.id + ":" + kind), libCache.delete("s:" + kind));
async function listMedia(u, kind) {
  const items = [];
  for (const L of libsFor(u, kind)) items.push(...(await libItems(L, kind)));
  return items.sort((a, b) => b.mtime - a.mtime);
}
// folders on the rig, for the owner picking one from another device
function drives() {
  if (process.platform !== "win32") return ["/"];
  const out = [];
  for (let c = 67; c <= 90; c++) {
    const d = String.fromCharCode(c) + ":\\";
    try {
      fs.statSync(d) && out.push(d);
    } catch {}
  }
  return out;
}
function browse(p) {
  if (!p) return { path: "", parent: null, dirs: drives().map((d) => ({ name: d, path: d })) };
  const full = path.resolve(p);
  let ents = [];
  try {
    ents = fs.readdirSync(full, { withFileTypes: !0 });
  } catch (e) {
    throw Object.assign(new Error("Can't open that folder on the rig."), { code: 400 });
  }
  const parent = path.dirname(full) === full ? "" : path.dirname(full);
  return {
    path: full,
    parent,
    dirs: ents
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !e.name.startsWith("$") && !/^(system volume information|recovery|perflogs)$/i.test(e.name))
      .map((e) => ({ name: e.name, path: path.join(full, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 500),
  };
}

// ---- save from a link -----------------------------------------------------------------------------
// A link to a music or video file (one you bought, free or Creative Commons music, a file in your
// own Google Drive or Dropbox) is downloaded by the rig straight into your Music or Videos, so
// big files keep going while your devices are off. Streaming sites are not downloaded from.
const NO_RIP = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com|googlevideo\.com|spotify\.com|scdn\.co|soundcloud\.com|sndcdn\.com|music\.apple\.com|tidal\.com|deezer\.com|tiktok\.com|instagram\.com|facebook\.com|fbcdn\.net|twitch\.tv|netflix\.com|primevideo\.com|disneyplus\.com|hulu\.com|pandora\.com|audiomack\.com)$/i;
const TYPE_EXT = { "audio/mpeg": ".mp3", "audio/mp3": ".mp3", "audio/mp4": ".m4a", "audio/x-m4a": ".m4a", "audio/aac": ".aac", "audio/flac": ".flac", "audio/x-flac": ".flac", "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/wave": ".wav", "audio/ogg": ".ogg", "audio/opus": ".opus", "audio/webm": ".weba", "video/mp4": ".mp4", "video/x-m4v": ".m4v", "video/webm": ".webm", "video/quicktime": ".mov", "video/x-matroska": ".mkv", "video/ogg": ".ogv" };
const jobs = new Map();
// share links that open a page turned into the file itself
function directLink(u) {
  const x = new URL(u);
  if (/(^|\.)dropbox\.com$/i.test(x.hostname)) (x.searchParams.delete("dl"), x.searchParams.set("dl", "1"));
  const g = /(^|\.)drive\.google\.com$/i.test(x.hostname) && (/\/file\/d\/([\w-]+)/.exec(x.pathname) || (x.searchParams.get("id") && [0, x.searchParams.get("id")]));
  if (g) return "https://drive.usercontent.google.com/download?id=" + g[1] + "&export=download&confirm=t";
  if (/(^|\.)1drv\.ms$|(^|\.)onedrive\.live\.com$/i.test(x.hostname) && !x.searchParams.has("download")) x.searchParams.set("download", "1");
  return x.toString();
}
async function safeHost(x) {
  if (!/^https?:$/.test(x.protocol)) throw new Error("Only http and https links can be saved.");
  if (NO_RIP.test(x.hostname)) throw new Error("Workbench doesn't download from streaming sites like " + x.hostname.replace(/^www\./, "") + ". Use a direct link to a file you own.");
  if (C.allowLocalFetch) return;
  const addrs = await require("dns").promises.lookup(x.hostname, { all: !0 }).catch(() => {
    throw new Error("Can't find " + x.hostname + ". Check the link.");
  });
  for (const a of addrs) if (/^(127\.|0\.|169\.254\.|::1$|fe80:|::ffff:127\.)/i.test(a.address)) throw new Error("That link points at the rig itself.");
}
function fileName(res, url, kind, type) {
  let n = "";
  const cd = res.headers.get("content-disposition") || "";
  const m = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(cd) || /filename="?([^";]+)"?/i.exec(cd);
  if (m)
    try {
      n = decodeURIComponent(m[1].trim().replace(/^"|"$/g, ""));
    } catch {
      n = m[1];
    }
  if (!n)
    try {
      n = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() || "");
    } catch {}
  n = safeName(n) || (kind === "video" ? "Video" : "Song") + " " + new Date().toISOString().slice(0, 10);
  if (!EXT[kind].test(n)) n = n.replace(/\.[a-z0-9]{2,5}$/i, "") + (TYPE_EXT[type] || (kind === "video" ? ".mp4" : ".mp3"));
  return n;
}
async function runJob(job, u) {
  job.state = "downloading";
  const ctl = new AbortController();
  job.cancel = () => ctl.abort();
  let stall = setTimeout(() => ctl.abort(), 60000),
    tmp = "";
  try {
    let url = directLink(job.url),
      res = null;
    for (let hop = 0; hop < 8; hop++) {
      const x = new URL(url);
      await safeHost(x);
      res = await fetch(url, { redirect: "manual", signal: ctl.signal, headers: { "User-Agent": "WorkbenchHub/" + VERSION, Accept: "audio/*,video/*,*/*;q=0.5" } });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        url = new URL(res.headers.get("location"), url).toString();
        continue;
      }
      break;
    }
    if (!res || !res.ok) throw new Error("The link answered " + (res ? res.status : "nothing") + ".");
    const type = String(res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase(),
      cd = /filename\*?=(?:UTF-8'')?"?([^";]+)/i.exec(res.headers.get("content-disposition") || ""),
      guess = (cd ? cd[1] : "") + " " + decodeURIComponent(new URL(url).pathname),
      kind = job.to || (/^audio\//.test(type) ? "music" : /^video\//.test(type) ? "video" : /\.(mp3|m4a|aac|flac|wav|ogg|oga|opus|weba|aif|aiff)\b/i.test(guess) ? "music" : /\.(mp4|m4v|webm|mov|mkv|ogv)\b/i.test(guess) ? "video" : "");
    if (/text\/html|application\/xhtml/.test(type)) throw new Error("That link opens a web page, not a file. Use the file's direct download link (it usually ends in .mp3 or .mp4).");
    if (!kind) throw new Error("That isn't a music or video file (it's " + (type || "something else") + ").");
    const name = fileName(res, url, kind, type),
      base = job.shared ? path.join(C.root, "Shared", FOLDER[kind]) : userDir(u, FOLDER[kind]);
    fs.mkdirSync(base, { recursive: !0 });
    let dest = path.join(base, name),
      n = 2;
    while (fs.existsSync(dest)) dest = path.join(base, name.replace(/(\.[^.]+)$/, " (" + n++ + ")$1"));
    Object.assign(job, { kind, name: path.basename(dest), total: +res.headers.get("content-length") || 0, got: 0 });
    tmp = dest + ".part";
    const ws = fs.createWriteStream(tmp);
    for await (const chunk of res.body) {
      clearTimeout(stall);
      stall = setTimeout(() => ctl.abort(), 60000);
      job.got += chunk.length;
      if (!ws.write(chunk)) await new Promise((r) => ws.once("drain", r));
    }
    await new Promise((ok, bad) => (ws.end(ok), ws.on("error", bad)));
    if (!job.got) throw new Error("The link gave an empty file.");
    fs.renameSync(tmp, dest);
    tmp = "";
    job.state = "done";
    job.mediaId = mediaId(kind, job.shared ? "s" : "u", path.basename(dest));
    forget(u, kind);
    log("Saved from a link:", job.name, "for", u.name);
  } catch (e) {
    job.state = "error";
    job.err = e.name === "AbortError" ? (job.cancelled ? "Stopped." : "The download stalled. Try again.") : e.message;
    tmp && fs.rmSync(tmp, { force: !0 });
  } finally {
    clearTimeout(stall);
    job.at = Date.now();
    delete job.cancel;
    broadcast({ type: "media", job: job.id, state: job.state }, (c) => c.user.id === u.id);
    nextJob(u);
  }
}
function nextJob(u) {
  const mine = [...jobs.values()].filter((j) => j.user === u.id);
  if (mine.filter((j) => j.state === "downloading").length >= 2) return;
  const q = mine.find((j) => j.state === "queued");
  q && runJob(q, u);
}
const jobView = (j) => ({ id: j.id, url: j.url, name: j.name, kind: j.kind, got: j.got, total: j.total, state: j.state, err: j.err, mediaId: j.mediaId || "", at: j.at });

// ---- notifications -----------------------------------------------------------------------------
const subject = () => (C.origins && C.origins[0]) || APP;
async function pushTo(d, msg) {
  if (!d.push) return 0;
  try {
    const code = await push.send(d.push, msg, VAPID, subject(), { topic: String(msg.tag || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || undefined });
    if (code === 404 || code === 410) ((d.push = null), saveDevices(), log("Push: a device's notifications expired:", d.name));
    else if (code >= 400) log("Push to", d.name, "answered", code);
    return code;
  } catch (e) {
    log("Push to", d.name, "failed:", e.message);
    return 0;
  }
}
const target = (t) => (t.ord ? "ord:" + t.ord : t.co ? "co:" + t.co : "");
const localDay = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
async function checkReminders() {
  const D = readWork();
  if (!D) return;
  const items = __wbReminders(D, Date.now()),
    N = readJson(hubf("notified.json"), { sent: {}, daily: "" }),
    to = DV.devices.filter((d) => d.push && d.notify !== !1 && canWork(U.users.find((u) => u.id === d.user)));
  if (to.length) {
    const fresh = items.filter((t) => t.p >= 50 && !N.sent[t.key]);
    const msgs =
      fresh.length > 3
        ? [{ title: fresh.length + " things need you", body: fresh.slice(0, 3).map((t) => t.text).join(" · ") + "…", tag: "wb-many", open: "bell" }]
        : fresh.map((t) => ({ title: t.text, body: t.sub || "", tag: t.key, open: target(t) }));
    for (const d of to) for (const m of msgs) await pushTo(d, m);
    for (const t of fresh) N.sent[t.key] = Date.now();
    // a morning round-up of everything on the list
    if (new Date().getHours() >= 8 && N.daily !== localDay() && items.length) {
      N.daily = localDay();
      for (const d of to) await pushTo(d, { title: "Today: " + items.length + " thing" + (items.length === 1 ? "" : "s") + " on your list", body: items.slice(0, 3).map((t) => t.text).join(" · "), tag: "wb-daily", open: "bell" });
    }
  }
  for (const k in N.sent) if (Date.now() - N.sent[k] > 45 * 864e5) delete N.sent[k];
  writeJson(hubf("notified.json"), N);
}

// ---- the AI (Ollama on this computer) ----------------------------------------------------------
async function ollama(p, init, ms) {
  const r = await fetch(C.ollama.replace(/\/+$/, "") + p, Object.assign({ signal: AbortSignal.timeout(ms || 180000) }, init || {}));
  if (!r.ok) throw new Error("Ollama answered " + r.status);
  return r.json();
}
async function pickModel() {
  if (C.aiModel) return C.aiModel;
  const t = await ollama("/api/tags", {}, 8000),
    names = (t.models || []).map((m) => m.name);
  return names.find((n) => /^llama3\.1/.test(n)) || names[0] || "";
}
function briefContext(D) {
  const live = (a) => (a || []).filter((r) => r && !r.del),
    co = (id) => live(D.companies).find((c) => c.id === id),
    lines = [];
  for (const o of live(D.orders).filter((o) => !["Done", "Cancelled", "Installed", "Paid"].includes(o.status)).slice(0, 30)) {
    const c = co(o.companyId),
      l = (o.log || [])[0];
    lines.push("- " + [o.no, c ? c.name : "no customer", o.status, o.want ? "wants: " + String(o.want).slice(0, 140) : "", o.due ? "due " + o.due : "", l ? "last update: " + String(l.text).slice(0, 100) : ""].filter(Boolean).join(" | "));
  }
  return lines.join("\n");
}
let digesting = null;
async function makeDigest() {
  if (digesting) return digesting;
  digesting = (async () => {
    const D = readWork();
    if (!D) return null;
    const items = __wbReminders(D, Date.now()),
      biz = (D.settings && D.settings.biz) || {},
      dg = { at: Date.now(), items: items.slice(0, 20).map((t) => ({ key: t.key, kind: t.kind, p: t.p, text: t.text, sub: t.sub, chip: t.chip, cls: t.cls, ord: t.ord, co: t.co })), text: "", model: "", err: "" };
    try {
      const model = await pickModel();
      if (model) {
        const r = await ollama("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            stream: !1,
            keep_alive: "30m",
            options: { num_ctx: 8192, temperature: 0.3 },
            messages: [
              { role: "system", content: "You write the short hourly briefing for the owner of " + (biz.name || "a small vehicle graphics, decal and wrap shop") + ". Use only the facts given. Name customers and job numbers. One short paragraph of 3 to 5 sentences, no lists, no headings." + (C.lang ? " Write in " + C.lang + "." : "") },
              { role: "user", content: "Now: " + new Date().toString().slice(0, 21) + "\n\nTHE LIST (most important first):\n" + (items.length ? items.slice(0, 15).map((t) => "- " + t.text + (t.sub ? " (" + t.sub + ")" : "")).join("\n") : "- nothing waiting") + "\n\nOPEN JOBS:\n" + (briefContext(D) || "- none") + "\n\nWrite the briefing: what matters most right now and why." },
            ],
          }),
        });
        dg.text = String((r.message && r.message.content) || "")
          .replace(/<think>[\s\S]*?<\/think>/gi, "")
          .trim();
        dg.model = model;
      }
    } catch (e) {
      dg.err = "The AI on the rig didn't answer (" + e.message + ").";
    }
    writeJson(hubf("digest.json"), dg);
    broadcast({ type: "digest", at: dg.at }, (c) => canWork(c.user));
    return dg;
  })().finally(() => (digesting = null));
  return digesting;
}
function proxyOllama(req, res, url) {
  const t = new URL(C.ollama),
    q = new URLSearchParams(url.search);
  q.delete("t");
  const headers = Object.assign({}, req.headers);
  for (const h of ["origin", "referer", "authorization", "host", "cookie"]) delete headers[h];
  for (const h of Object.keys(headers)) if (/^sec-|^access-control-/i.test(h)) delete headers[h];
  const pr = http.request({ hostname: t.hostname, port: t.port || 80, method: req.method, path: (url.pathname.replace(/^\/ollama/, "") || "/") + (q.toString() ? "?" + q : ""), headers }, (r) => {
    const h = Object.assign({}, r.headers);
    for (const k of Object.keys(h)) if (/^access-control-/i.test(k)) delete h[k];
    res.writeHead(r.statusCode, h);
    r.pipe(res);
  });
  pr.on("error", () => fail(res, 502, "The AI isn't running on the rig. On the rig, open Ollama (it starts with Windows once installed), then try again."));
  req.pipe(pr);
}

// ---- updates -----------------------------------------------------------------------------------
const newer = (a, b) => {
  const x = String(a).split(".").map(Number),
    y = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return !1;
};
async function checkUpdate() {
  if (!C.autoUpdate || !C.update) return;
  try {
    const r = await fetch(C.update + "version.json", { cache: "no-store", signal: AbortSignal.timeout(20000) });
    if (!r.ok) return;
    const v = await r.json();
    if (!newer(v.version, VERSION)) return;
    const tmp = path.join(__dirname, ".update");
    fs.rmSync(tmp, { recursive: !0, force: !0 });
    fs.mkdirSync(tmp);
    for (const [name, hash] of Object.entries(v.files || {})) {
      if (!/^[\w.-]+$/.test(name)) throw new Error("bad file name " + name);
      const b = Buffer.from(await (await fetch(C.update + name, { cache: "no-store", signal: AbortSignal.timeout(60000) })).arrayBuffer());
      if (sha(b) !== hash) throw new Error(name + " didn't download correctly");
      fs.writeFileSync(path.join(tmp, name), b);
    }
    for (const name of Object.keys(v.files)) fs.copyFileSync(path.join(tmp, name), path.join(__dirname, name));
    fs.rmSync(tmp, { recursive: !0, force: !0 });
    log("Updated to", v.version, "- restarting");
    setTimeout(() => process.exit(3), 300);
  } catch (e) {
    log("Update check:", e.message);
  }
}

// ---- the status page (what you see opening the Hub's address in a browser) ---------------------
function statusPage(req, res) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]),
    work = readWorkText(),
    html =
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Workbench Hub</title><style>body{margin:0;background:#101114;color:#eef1f5;font:15px/1.5 system-ui,Segoe UI,sans-serif}main{max-width:640px;margin:8vh auto;padding:0 20px}h1{font-size:34px;margin:0 0 4px;letter-spacing:-.01em}.k{color:#9aa2ae;text-transform:uppercase;font-size:12px;letter-spacing:.16em}.ok{color:#7dffa8}ul{padding-left:18px}a{color:#7dffa8}code{background:#1d2026;padding:2px 6px}</style><main><div class="k">// Workbench Hub ' +
      VERSION +
      '</div><h1>Running <span class="ok">●</span></h1><p>This is the home server on <b>' +
      esc(C.name) +
      "</b>. Open Workbench on any of your devices and connect to this address: the bell at the top right → Hub.</p><ul><li>" +
      U.users.length +
      " people · " +
      DV.devices.length +
      " devices signed in</li><li>Work data: " +
      (work ? Math.round(work.length / 1024) + " KB" : "none yet") +
      "</li><li>Folder: <code>" +
      esc(C.root) +
      '</code></li></ul><p><a href="' +
      APP +
      '/Workbench/">Open Workbench</a></p></main>';
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(html);
}

// ---- the routes ---------------------------------------------------------------------------------
async function route(req, res) {
  const url = new URL(req.url, "http://hub"),
    p = url.pathname,
    M = req.method;
  cors(req, res);
  if (M === "OPTIONS") return (res.writeHead(204), res.end());
  if (p === "/" || p === "/index.html") return statusPage(req, res);
  if (p === "/api/ping") return json(res, 200, { ok: !0, hub: "Workbench Hub", version: VERSION, name: C.name, setup: U.users.length > 0, time: Date.now() });
  if (p === "/api/login" && M === "POST") return json(res, 200, login(await jsonBody(req, 1e4)));
  const a = auth(req, url);
  if (!a) return fail(res, 401, "Sign in to the Hub again.");
  const u = a.user,
    owner = u.role === "owner";
  if (p.startsWith("/ollama/") || p === "/ollama") return proxyOllama(req, res, url);
  switch (p) {
    case "/api/logout":
      DV.devices = DV.devices.filter((d) => d !== a.device);
      saveDevices();
      return json(res, 200, { ok: !0 });
    case "/api/me": {
      let disk = null;
      try {
        const s = fs.statfsSync(C.root);
        disk = { free: s.bavail * s.bsize, size: s.blocks * s.bsize };
      } catch {}
      return json(res, 200, { user: pub(u), device: { id: a.device.id, name: a.device.name, push: !!a.device.push }, hub: { name: C.name, version: VERSION, disk: owner ? disk : null, root: owner ? C.root : "" } });
    }
    case "/api/me/pin": {
      const b = await jsonBody(req, 1e4);
      if (pinHash(String(b.old || ""), u.salt) !== u.hash) return fail(res, 401, "Your current PIN isn't right.");
      setPin(u, b.pin);
      return json(res, 200, { ok: !0 });
    }
    case "/api/events": {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
      res.write("retry: 5000\n\n");
      const c = { res, user: u, device: a.device };
      live.add(c);
      req.on("close", () => live.delete(c));
      return;
    }
    case "/api/users":
      if (!owner) return fail(res, 403, "Only the owner can manage people.");
      if (M === "GET") return json(res, 200, { users: U.users.map((x) => ({ ...pub(x), created: x.created, devices: DV.devices.filter((d) => d.user === x.id).map((d) => ({ id: d.id, name: d.name, seen: d.seen, push: !!d.push })) })) });
      if (M === "POST") {
        const b = await jsonBody(req, 1e4);
        const nu = addUser(b.name, b.pin, "member", !!b.work);
        log("Added", nu.name);
        return json(res, 200, { user: pub(nu) });
      }
      break;
    case "/api/devices":
      if (M === "DELETE") {
        const d = DV.devices.find((x) => x.id === url.searchParams.get("id"));
        if (!d || (!owner && d.user !== u.id)) return fail(res, 404, "No such device.");
        DV.devices = DV.devices.filter((x) => x !== d);
        saveDevices();
        return json(res, 200, { ok: !0 });
      }
      break;
    // ---- Work (the owner, and anyone the owner lets in)
    case "/api/work": {
      if (!canWork(u)) return fail(res, 403, "Work is only for the people the owner allows.");
      const text = readWorkText(),
        rev = revOf(text);
      if (M === "GET") {
        res.setHeader("X-Rev", rev);
        return json(res, 200, '{"rev":"' + rev + '","data":' + (text || "null") + "}");
      }
      if (M === "PUT") {
        const b = await jsonBody(req, 200e6);
        if ((b.base || "") !== rev) return json(res, 409, '{"rev":"' + rev + '","data":' + (text || "null") + "}");
        if (!b.data || typeof b.data !== "object" || !Array.isArray(b.data.orders)) return fail(res, 400, "That isn't Work data.");
        const nt = JSON.stringify(b.data);
        fs.mkdirSync(WORK(), { recursive: !0 });
        const tmp = workFile() + ".tmp";
        fs.writeFileSync(tmp, nt);
        fs.renameSync(tmp, workFile());
        backupWork(nt);
        const nr = revOf(nt);
        broadcast({ type: "work", rev: nr, by: a.device.id }, (c) => canWork(c.user));
        clearTimeout(route.remT);
        route.remT = setTimeout(checkReminders, 8000);
        return json(res, 200, { rev: nr });
      }
      break;
    }
    case "/api/work/file": {
      if (!canWork(u)) return fail(res, 403, "Work is only for the people the owner allows.");
      const f = inside(WORK(), url.searchParams.get("path"));
      if (!f || /(^|[\\/])work\.json$/i.test(f)) return fail(res, 400, "That path isn't allowed.");
      if (M === "GET" || M === "HEAD") return sendFile(req, res, f, url.searchParams.has("download"));
      if (M === "PUT") return json(res, 200, { size: await receive(req, f) });
      if (M === "DELETE") return (await fsp.rm(f, { force: !0 }), json(res, 200, { ok: !0 }));
      break;
    }
    case "/api/work/list": {
      if (!canWork(u)) return fail(res, 403, "Work is only for the people the owner allows.");
      const d = url.searchParams.get("dir") ? inside(WORK(), url.searchParams.get("dir")) : WORK();
      if (!d) return fail(res, 400, "That path isn't allowed.");
      let ents = [];
      try {
        ents = await fsp.readdir(d, { withFileTypes: !0 });
      } catch {}
      const out = [];
      for (const e of ents) {
        if (e.name.endsWith(".part") || e.name.endsWith(".tmp")) continue;
        const st = await fsp.stat(path.join(d, e.name)).catch(() => null);
        st && out.push({ name: e.name, dir: e.isDirectory(), size: st.size, mtime: Math.floor(st.mtimeMs) });
      }
      return json(res, 200, { items: out });
    }
    // ---- saves and settings (each person their own)
    case "/api/saves": {
      const f = path.join(userDir(u, "Saves"), "saves.json");
      let text = "";
      try {
        text = fs.readFileSync(f, "utf8");
      } catch {}
      const rev = revOf(text);
      if (M === "GET") return json(res, 200, text ? '{"rev":"' + rev + '","save":' + text + "}" : { rev: "", save: null });
      if (M === "PUT") {
        const b = await jsonBody(req, 100e6);
        if ((b.base || "") !== rev) return json(res, 409, text ? '{"rev":"' + rev + '","save":' + text + "}" : { rev: "", save: null });
        if (!b.save || typeof b.save.storage !== "object") return fail(res, 400, "That isn't a Workbench save.");
        const nt = JSON.stringify(Object.assign({}, b.save, { savedAt: Date.now(), device: a.device.name }));
        fs.mkdirSync(path.dirname(f), { recursive: !0 });
        fs.writeFileSync(f + ".tmp", nt);
        fs.renameSync(f + ".tmp", f);
        return json(res, 200, { rev: revOf(nt) });
      }
      break;
    }
    // ---- music and videos
    case "/api/media": {
      const kind = url.searchParams.get("kind") === "video" ? "video" : "music";
      if (M === "GET") return json(res, 200, { items: await listMedia(u, kind), libraries: libsFor(u, kind).map((l) => ({ scope: l.scope, label: l.label })) });
      if (M === "DELETE") {
        const m = fromId(url.searchParams.get("id")),
          base = m && (m.scope === "u" || owner) ? libDir(u, m.scope, m.kind) : null,
          f = base && inside(base, m.rel);
        if (!f) return fail(res, 403, "You can only remove your own files.");
        await fsp.rm(f, { force: !0 });
        libCache.clear();
        return json(res, 200, { ok: !0 });
      }
      break;
    }
    case "/api/media/file": {
      const m = fromId(url.searchParams.get("id")),
        base = m && libDir(u, m.scope, m.kind),
        f = base && inside(base, m.rel);
      if (!f) return fail(res, 404, "That file isn't on the rig.");
      return sendFile(req, res, f, url.searchParams.has("download"));
    }
    case "/api/media/upload": {
      if (M !== "PUT" && M !== "POST") break;
      const kind = url.searchParams.get("kind") === "video" ? "video" : "music",
        shared = url.searchParams.get("to") === "shared" && owner,
        name = safeName(url.searchParams.get("name"));
      if (!name || !EXT[kind].test(name)) return fail(res, 400, kind === "music" ? "Send MP3, M4A, FLAC, WAV or OGG files." : "Send MP4, WEBM, MOV or MKV files.");
      const base = shared ? path.join(C.root, "Shared", FOLDER[kind]) : userDir(u, FOLDER[kind]);
      let dest = path.join(base, name),
        n = 2;
      while (fs.existsSync(dest)) dest = path.join(base, name.replace(/(\.[^.]+)$/, " (" + n++ + ")$1"));
      const size = await receive(req, dest);
      forget(u, kind);
      return json(res, 200, { size, id: mediaId(kind, shared ? "s" : "u", path.basename(dest)) });
    }
    case "/api/media/fetch": {
      if (M !== "POST") break;
      const b = await jsonBody(req, 2e4);
      let x;
      try {
        x = new URL(String(b.url || "").trim());
      } catch {
        return fail(res, 400, "Paste the whole link, starting with https://");
      }
      try {
        await safeHost(x);
      } catch (e) {
        return fail(res, 400, e.message);
      }
      const job = { id: id36(), user: u.id, url: x.toString(), to: b.to === "music" || b.to === "video" ? b.to : "", shared: b.to === "shared" && owner, name: "", kind: "", got: 0, total: 0, state: "queued", err: "", at: Date.now() };
      jobs.set(job.id, job);
      for (const [k, j] of jobs) if (j.user === u.id && j.state !== "queued" && j.state !== "downloading" && Date.now() - j.at > 6 * 3600000) jobs.delete(k);
      nextJob(u);
      return json(res, 200, { job: jobView(job) });
    }
    case "/api/media/jobs": {
      if (M === "DELETE") {
        const j = jobs.get(url.searchParams.get("id"));
        if (j && j.user === u.id) j.state === "downloading" ? ((j.cancelled = !0), j.cancel && j.cancel()) : jobs.delete(j.id);
        return json(res, 200, { ok: !0 });
      }
      return json(res, 200, { jobs: [...jobs.values()].filter((j) => j.user === u.id).sort((a, b) => b.at - a.at).slice(0, 30).map(jobView) });
    }
    // ---- folders on the rig (the owner adds them; nothing is moved or copied)
    case "/api/libraries": {
      if (!owner) return fail(res, 403, "Only the owner can choose the rig's folders.");
      if (M === "POST") {
        const b = await jsonBody(req, 2e4),
          p = path.resolve(String(b.path || ""));
        let st = null;
        try {
          st = fs.statSync(p);
        } catch {}
        if (!b.path || !st || !st.isDirectory()) return fail(res, 400, "That folder isn't on the rig.");
        if (libraries().some((l) => path.resolve(l.path).toLowerCase() === p.toLowerCase())) return fail(res, 400, "That folder is already in the list.");
        C.libraries = libraries().concat([{ id: libId(p), path: p, kind: b.kind === "music" || b.kind === "video" ? b.kind : "auto", everyone: !!b.everyone, label: String(b.label || path.basename(p) || p).slice(0, 60) }]);
        writeJson(CONF, C);
        log("Added folder", p);
      } else if (M === "DELETE") {
        C.libraries = libraries().filter((l) => l.id !== url.searchParams.get("id"));
        writeJson(CONF, C);
        libCache.clear();
      } else if (M === "PATCH") {
        const b = await jsonBody(req, 2e4),
          l = libraries().find((x) => x.id === b.id);
        if (!l) return fail(res, 404, "No such folder.");
        "everyone" in b && (l.everyone = !!b.everyone);
        C.libraries = libraries().map((x) => (x.id === l.id ? l : x));
        writeJson(CONF, C);
      }
      const out = [];
      // a folder nobody has looked through yet is looked through now, in the background
      for (const L of libsFor(u, "music").concat(libsFor(u, "video"))) {
        if (!L.key.startsWith("l:") || libCache.has(L.key) || scanning.has(L.key)) continue;
        scanning.add(L.key);
        scanLib(L)
          .then((items) => libCache.set(L.key, { t: Date.now(), items }))
          .catch(() => {})
          .finally(() => scanning.delete(L.key));
      }
      for (const l of libraries()) {
        let exists = !1;
        try {
          exists = fs.statSync(l.path).isDirectory();
        } catch {}
        const c = libCache.get("l:" + l.id);
        out.push({ id: l.id, path: l.path, kind: l.kind || "auto", everyone: !!l.everyone, label: l.label || path.basename(l.path), exists, music: c ? c.items.music.length : null, video: c ? c.items.video.length : null });
      }
      return json(res, 200, { libraries: out });
    }
    case "/api/browse":
      if (!owner) return fail(res, 403, "Only the owner can look through the rig's folders.");
      return json(res, 200, browse(url.searchParams.get("path") || ""));
    // ---- notifications
    case "/api/push/key":
      return json(res, 200, { key: VAPID.pub });
    case "/api/push/subscribe": {
      const b = await jsonBody(req, 2e4);
      if (!b.sub || !b.sub.endpoint || !b.sub.keys) return fail(res, 400, "That isn't a push subscription.");
      a.device.push = { endpoint: b.sub.endpoint, keys: { p256dh: b.sub.keys.p256dh, auth: b.sub.keys.auth } };
      a.device.notify = b.notify !== !1;
      saveDevices();
      return json(res, 200, { ok: !0 });
    }
    case "/api/push/unsubscribe":
      a.device.push = null;
      saveDevices();
      return json(res, 200, { ok: !0 });
    case "/api/push/test": {
      const code = await pushTo(a.device, { title: "Workbench Hub", body: "Notifications work on this device.", tag: "wb-test", open: "bell" });
      return code >= 200 && code < 300 ? json(res, 200, { ok: !0 }) : fail(res, 502, "The phone's push service didn't take it" + (code ? " (" + code + ")" : "") + ". Check that the rig has internet.");
    }
    case "/api/digest": {
      if (!canWork(u)) return fail(res, 403, "Work is only for the people the owner allows.");
      if (M === "POST") {
        const b = await jsonBody(req, 1e4);
        if (b.lang && b.lang !== C.lang) ((C.lang = String(b.lang).slice(0, 30)), writeJson(CONF, C));
        return json(res, 200, (await makeDigest()) || {});
      }
      const dg = readJson(hubf("digest.json"), null);
      if (!dg || Date.now() - dg.at > 65 * 60000) makeDigest().catch(() => {});
      return json(res, 200, dg || {});
    }
  }
  return fail(res, 404, "Not found");
}

// ---- start -------------------------------------------------------------------------------------
function main() {
  const argv = process.argv.slice(2);
  setup();
  if (argv[0] === "--init-owner") {
    if (U.users.some((x) => x.role === "owner")) return console.log("The Hub already has an owner.");
    addUser(argv[1], argv[2], "owner");
    return console.log("Owner created: " + argv[1]);
  }
  if (argv[0] === "--reset-pin") {
    const x = U.users.find((y) => y.name.toLowerCase() === String(argv[1] || "").toLowerCase());
    if (!x) return (console.log("Nobody called " + argv[1]), process.exit(1));
    setPin(x, argv[2]);
    return console.log("New PIN set for " + x.name);
  }
  const srv = http.createServer((req, res) =>
    route(req, res).catch((e) => {
      if (e.code !== 400 && e.code !== 401 && e.code !== 429) log("Error", req.method, req.url.split("?")[0], e.stack || e.message);
      fail(res, typeof e.code === "number" ? e.code : 500, e.message || "Something went wrong on the Hub.");
    }),
  );
  srv.requestTimeout = 0;
  srv.headersTimeout = 60000;
  srv.on("error", (e) => {
    log("Can't start:", e.message);
    process.exit(e.code === "EADDRINUSE" ? 2 : 1);
  });
  srv.listen(C.port, C.host, () => log("Workbench Hub", VERSION, "on http://" + C.host + ":" + C.port, "· folder", C.root));
  setTimeout(checkReminders, 20000);
  setInterval(() => checkReminders().catch((e) => log("reminders:", e.message)), 10 * 60000);
  setInterval(() => makeDigest().catch((e) => log("digest:", e.message)), 60 * 60000);
  setTimeout(() => makeDigest().catch(() => {}), 120000);
  setTimeout(checkUpdate, 5 * 60000);
  setInterval(checkUpdate, 6 * 3600000);
}
if (require.main === module) main();
module.exports = { route, setup, C, addUser, checkReminders, makeDigest, directLink, folderHint, autoKind, VERSION };
