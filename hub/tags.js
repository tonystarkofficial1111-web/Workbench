// Song titles for the Hub's music list: ID3 tags (MP3), Vorbis comments (FLAC), or the file name
// ("Artist - Title.mp3") when a file has no tags.
"use strict";
const fs = require("fs");

function fromName(name) {
  const base = name.replace(/\.[^.]+$/, "").replace(/_/g, " ").trim(),
    m = base.match(/^(.+?)\s+-\s+(.+)$/);
  return m ? { artist: m[1].replace(/^\d+[\s.-]+/, ""), title: m[2] } : { artist: "", title: base.replace(/^\d+[\s.-]+/, "") };
}
function text(buf, enc) {
  let s;
  if (enc === 1 || enc === 2) {
    let b = buf;
    if (enc === 1 && b[0] === 0xfe && b[1] === 0xff) s = Buffer.from(b.subarray(2)).swap16().toString("utf16le");
    else if (enc === 1 && b[0] === 0xff && b[1] === 0xfe) s = b.subarray(2).toString("utf16le");
    else if (enc === 2) s = Buffer.from(b.subarray(0, b.length & ~1)).swap16().toString("utf16le");
    else s = b.toString("utf16le");
  } else s = enc === 3 ? buf.toString("utf8") : buf.toString("latin1");
  return s.replace(/\u0000+$/g, "").split("\u0000")[0].trim();
}
function id3(b, out) {
  if (b.length < 10 || b.toString("latin1", 0, 3) !== "ID3") return;
  const ver = b[3],
    size = ((b[6] & 127) << 21) | ((b[7] & 127) << 14) | ((b[8] & 127) << 7) | (b[9] & 127),
    end = Math.min(b.length, 10 + size),
    want = ver === 2 ? { TT2: "title", TP1: "artist", TAL: "album", TBP: "bpm" } : { TIT2: "title", TPE1: "artist", TALB: "album", TBPM: "bpm", TKEY: "key" };
  let p = 10;
  if (ver > 2 && b[5] & 0x40) p += ver === 4 ? ((b[10] & 127) << 21) | ((b[11] & 127) << 14) | ((b[12] & 127) << 7) | (b[13] & 127) : b.readUInt32BE(10) + 4;
  while (p + (ver === 2 ? 6 : 10) <= end) {
    let id, len, hd;
    if (ver === 2) ((id = b.toString("latin1", p, p + 3)), (len = (b[p + 3] << 16) | (b[p + 4] << 8) | b[p + 5]), (hd = 6));
    else ((id = b.toString("latin1", p, p + 4)), (len = ver === 4 ? ((b[p + 4] & 127) << 21) | ((b[p + 5] & 127) << 14) | ((b[p + 6] & 127) << 7) | (b[p + 7] & 127) : b.readUInt32BE(p + 4)), (hd = 10));
    if (!/^[A-Z0-9]{3,4}$/.test(id) || len <= 0) break;
    const f = b.subarray(p + hd, Math.min(end, p + hd + len));
    if (want[id] && f.length > 1) out[want[id]] = text(f.subarray(1), f[0]);
    p += hd + len;
  }
}
function flac(b, out) {
  if (b.toString("latin1", 0, 4) !== "fLaC") return;
  let p = 4;
  while (p + 4 <= b.length) {
    const last = b[p] & 0x80,
      type = b[p] & 0x7f,
      len = (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3];
    if (type === 4 && p + 4 + len <= b.length) {
      let q = p + 4,
        vl = b.readUInt32LE(q);
      q += 4 + vl;
      const n = b.readUInt32LE(q);
      q += 4;
      for (let i = 0; i < n && q + 4 <= b.length; i++) {
        const l = b.readUInt32LE(q),
          s = b.toString("utf8", q + 4, q + 4 + l),
          k = s.slice(0, s.indexOf("=")).toUpperCase(),
          v = s.slice(s.indexOf("=") + 1);
        q += 4 + l;
        if (k === "TITLE") out.title = v;
        else if (k === "ARTIST") out.artist = v;
        else if (k === "ALBUM") out.album = v;
        else if (k === "BPM") out.bpm = v;
      }
      return;
    }
    if (last) return;
    p += 4 + len;
  }
}
// Read the tags of one file (only its first 512 KB is read).
function readTags(file, name) {
  const out = {};
  try {
    const fd = fs.openSync(file, "r"),
      b = Buffer.alloc(512 * 1024),
      n = fs.readSync(fd, b, 0, b.length, 0);
    fs.closeSync(fd);
    const buf = b.subarray(0, n);
    id3(buf, out);
    flac(buf, out);
  } catch (e) {}
  const fb = fromName(name);
  return { title: out.title || fb.title, artist: out.artist || fb.artist, album: out.album || "", bpm: parseFloat(out.bpm) || 0, key: out.key || "" };
}
module.exports = { readTags, fromName };
