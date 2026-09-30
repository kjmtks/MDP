'use strict';
// Workspace fonts — the `.mdp/fonts/<id>/` packages decks render with, so a deck
// looks the same on every machine (and offline) instead of falling back to
// whatever the viewer's OS has. Shared by the Electron main process and the web
// server (server.cjs), like mdplink.cjs.
//
// A package is one folder per family:
//   <cdir>/fonts/<id>/font.json   { family, category, faces: [{ file, weight, style,
//                                   unicodeRange? }], license, licenseFile, source,
//                                   installedFrom? }
//   <cdir>/fonts/<id>/<files>     .woff2 (preferred) / .woff / .ttf / .otf
//   <cdir>/fonts/<id>/OFL.txt     the licence text travels with the font
// A folder WITHOUT font.json (fonts dropped in by hand) is inferred from its font
// files' own tables (name / OS/2 / fvar). A face with `unicodeRange` is one slice
// of a split font (Google Fonts serves a CJK family as ~120 of them).
//
// `<cdir>/fonts/requirements.json` DECLARES the fonts decks beneath need — with a
// download source when there is one (app/fontInstall.cjs installs it as a
// package), or as a bare statement for a font that cannot be shared. The renderer
// parses it (src/features/fonts/fontRequirements.ts); listFontRequirements reads it.
//
// Packages cascade like the other `.mdp` assets: the chain is root→nearest and a
// NEARER package wins on a family-name clash.

const zlib = require('zlib');

const FONT_EXT = /\.(woff2|woff|ttf|otf)$/i;
const FORMAT_OF = { woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype' };
const CATEGORIES = ['sans-serif', 'serif', 'monospace', 'other'];

const extOf = (name) => (String(name).match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || '';
const isFontFile = (name) => FONT_EXT.test(String(name));

// --- font file inspection ------------------------------------------------------
const u16 = (b, o) => b.readUInt16BE(o);
const u32 = (b, o) => b.readUInt32BE(o);
const tagAt = (b, o) => b.toString('latin1', o, o + 4);

// The only tables read here. Anything else stays compressed / unread.
const WANTED = new Set(['name', 'OS/2', 'fvar']);

// Plain sfnt (TrueType / OpenType): table directory at `base`; offsets are
// absolute from the start of the file (also inside a TrueType collection).
function sfntTables(buf, base = 0) {
  const numTables = u16(buf, base + 4);
  const out = new Map();
  for (let i = 0; i < numTables; i++) {
    const r = base + 12 + i * 16;
    const tag = tagAt(buf, r);
    const off = u32(buf, r + 8);
    const len = u32(buf, r + 12);
    if (WANTED.has(tag) && off + len <= buf.length) out.set(tag, buf.subarray(off, off + len));
  }
  return out;
}

// WOFF 1.0: per-table zlib.
function woffTables(buf) {
  const numTables = u16(buf, 12);
  const out = new Map();
  for (let i = 0; i < numTables; i++) {
    const r = 44 + i * 20;
    const tag = tagAt(buf, r);
    if (!WANTED.has(tag)) continue;
    const off = u32(buf, r + 4);
    const comp = u32(buf, r + 8);
    const orig = u32(buf, r + 12);
    const raw = buf.subarray(off, off + comp);
    out.set(tag, comp < orig ? zlib.inflateSync(raw) : raw);
  }
  return out;
}

// WOFF 2.0: one Brotli stream holding every table back to back (no padding), in
// directory order. glyf/loca/hmtx may be TRANSFORMED — then their stored length
// is `transformLength` — but name / OS/2 / fvar never are.
const WOFF2_TAGS = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ',
  'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern',
  'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF',
  'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc',
  'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort',
  'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];

function readBase128(buf, pos) {
  let v = 0;
  for (let i = 0; i < 5; i++) {
    const b = buf[pos.o++];
    if (i === 0 && b === 0x80) throw new Error('invalid UIntBase128');
    v = v * 128 + (b & 0x7f);
    if (!(b & 0x80)) return v;
  }
  throw new Error('invalid UIntBase128');
}

function read255UInt16(buf, pos) {
  const code = buf[pos.o++];
  if (code === 253) { const v = u16(buf, pos.o); pos.o += 2; return v; }
  if (code === 255) return buf[pos.o++] + 253;
  if (code === 254) return buf[pos.o++] + 506;
  return code;
}

function woff2Tables(buf) {
  const flavor = tagAt(buf, 4);
  const numTables = u16(buf, 12);
  const totalCompressed = u32(buf, 20);
  const pos = { o: 48 };
  const dir = [];
  for (let i = 0; i < numTables; i++) {
    const flags = buf[pos.o++];
    const idx = flags & 0x3f;
    let tag;
    if (idx === 63) { tag = tagAt(buf, pos.o); pos.o += 4; } else tag = WOFF2_TAGS[idx];
    const version = (flags >> 6) & 3;
    let length = readBase128(buf, pos);
    const transformed = (tag === 'glyf' || tag === 'loca') ? version !== 3 : version !== 0;
    if (transformed) length = readBase128(buf, pos);
    dir.push({ tag, length });
  }
  if (flavor === 'ttcf') {
    // CollectionDirectory — skipped over; the table data layout is unchanged.
    pos.o += 4;                                   // version
    const numFonts = read255UInt16(buf, pos);
    for (let f = 0; f < numFonts; f++) {
      const n = read255UInt16(buf, pos);
      pos.o += 4;                                 // flavor
      for (let k = 0; k < n; k++) read255UInt16(buf, pos);
    }
  }
  const data = zlib.brotliDecompressSync(buf.subarray(pos.o, pos.o + totalCompressed));
  const out = new Map();
  let off = 0;
  for (const t of dir) {
    if (WANTED.has(t.tag) && !out.has(t.tag)) out.set(t.tag, data.subarray(off, off + t.length));
    off += t.length;
  }
  return out;
}

function decodeUtf16be(raw) {
  const b = Buffer.from(raw.subarray(0, raw.length - (raw.length % 2)));
  return b.swap16().toString('utf16le');
}

function readNames(name) {
  if (!name || name.length < 6) return {};
  const count = u16(name, 2);
  const strOff = u16(name, 4);
  const recs = [];
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12;
    if (r + 12 > name.length) break;
    const platform = u16(name, r);
    const encoding = u16(name, r + 2);
    const lang = u16(name, r + 4);
    const id = u16(name, r + 6);
    const len = u16(name, r + 8);
    const off = u16(name, r + 10);
    const raw = name.subarray(strOff + off, strOff + off + len);
    let text;
    if (platform === 3 || platform === 0) text = decodeUtf16be(raw);
    else if (platform === 1 && encoding === 0) text = raw.toString('latin1');
    else continue;
    text = text.replace(/\0/g, '').trim();
    if (text) recs.push({ platform, lang, id, text });
  }
  // Prefer Windows English (US), then Mac English, then Unicode, then anything.
  const pick = (id) => {
    const rs = recs.filter((r) => r.id === id);
    return (rs.find((r) => r.platform === 3 && r.lang === 0x409)
      || rs.find((r) => r.platform === 1 && r.lang === 0)
      || rs.find((r) => r.platform === 0)
      || rs[0] || {}).text || '';
  };
  const pickJa = (id) => (recs.find((r) => r.id === id && r.platform === 3 && r.lang === 0x411) || {}).text || '';
  return {
    family: pick(16) || pick(1),
    subfamily: pick(17) || pick(2),
    localFamily: pickJa(16) || pickJa(1),
    fullName: pick(4),
    version: pick(5),
    copyright: pick(0),
    license: pick(13),
    licenseUrl: pick(14),
  };
}

// fsType (OS/2) — how the font's vendor lets it be embedded in documents.
function embeddingOf(fsType) {
  const bits = fsType & 0x000f;
  if (bits === 0) return 'installable';
  if (bits & 0x0008) return 'editable';
  if (bits & 0x0004) return 'preview-print';
  return 'restricted';
}

// A licence the fonts dialog can call "free to share" without asking.
function licenseKind(text) {
  const t = String(text || '').toLowerCase();
  if (/open font license|scripts\.sil\.org\/ofl|openfontlicense\.org|\bofl\b/.test(t)) return 'OFL-1.1';
  if (/apache license/.test(t)) return 'Apache-2.0';
  if (/ubuntu font licen[cs]e/.test(t)) return 'UFL-1.0';
  return '';
}

/** Read a font file's own description: family names, weight (or the variable
 *  weight range), italic, embedding permission and licence notes. Throws on a
 *  file that is not a font. */
function inspectFontBuffer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) throw new Error('Not a font file.');
  const sig = tagAt(buf, 0);
  let tables;
  let format;
  if (sig === 'wOF2') { tables = woff2Tables(buf); format = 'woff2'; }
  else if (sig === 'wOFF') { tables = woffTables(buf); format = 'woff'; }
  else if (sig === 'ttcf') { tables = sfntTables(buf, u32(buf, 12)); format = 'collection'; }
  else if (sig === 'OTTO') { tables = sfntTables(buf); format = 'opentype'; }
  else if (u32(buf, 0) === 0x00010000 || sig === 'true') { tables = sfntTables(buf); format = 'truetype'; }
  else throw new Error('Not a font file (unknown signature).');

  const names = readNames(tables.get('name'));
  if (!names.family) throw new Error('The font has no family name.');
  const os2 = tables.get('OS/2');
  const weight = os2 && os2.length >= 6 ? u16(os2, 4) : 400;
  const fsType = os2 && os2.length >= 10 ? u16(os2, 8) : 0;
  const fsSelection = os2 && os2.length >= 64 ? u16(os2, 62) : 0;
  let weightRange = null;
  const fvar = tables.get('fvar');
  if (fvar && fvar.length >= 16) {
    const axesOff = u16(fvar, 4);
    const axisCount = u16(fvar, 8);
    const axisSize = u16(fvar, 10);
    for (let i = 0; i < axisCount; i++) {
      const a = axesOff + i * axisSize;
      if (a + 20 > fvar.length) break;
      if (tagAt(fvar, a) === 'wght') {
        const lo = Math.round(fvar.readInt32BE(a + 4) / 65536);
        const hi = Math.round(fvar.readInt32BE(a + 12) / 65536);
        if (lo > 0 && hi >= lo) weightRange = [lo, hi];
      }
    }
  }
  const licenseText = `${names.license} ${names.licenseUrl}`;
  return {
    format,
    family: names.family,
    subfamily: names.subfamily,
    localFamily: names.localFamily,
    fullName: names.fullName,
    version: names.version,
    copyright: names.copyright,
    license: names.license,
    licenseUrl: names.licenseUrl,
    licenseKind: licenseKind(licenseText),
    weight,
    weightRange,
    italic: !!(fsSelection & 0x0001) || /italic|oblique/i.test(names.subfamily),
    fsType,
    embedding: embeddingOf(fsType),
  };
}

// --- packages ------------------------------------------------------------------
const WEIGHT_RE = /^(\d{1,3})(\s+\d{1,3})?$/;
const clean = (s, max = 200) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const stripBom = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

function normalizeWeight(w) {
  const s = clean(w, 16).toLowerCase();
  if (s === 'normal') return '400';
  if (s === 'bold') return '700';
  return WEIGHT_RE.test(s) ? s.replace(/\s+/, ' ') : '400';
}
const normalizeStyle = (s) => (['italic', 'oblique'].includes(clean(s, 10).toLowerCase()) ? clean(s, 10).toLowerCase() : 'normal');
const normalizeCategory = (c) => (CATEGORIES.includes(c) ? c : 'sans-serif');
// CSS unicode-range (`U+0-FF, U+131, U+30??`); anything else is dropped.
const RANGE_RE = /^[Uu]\+[0-9A-Fa-f?]{1,6}(-[0-9A-Fa-f]{1,6})?(\s*,\s*[Uu]\+[0-9A-Fa-f?]{1,6}(-[0-9A-Fa-f]{1,6})?)*$/;
const normalizeRange = (r) => { const s = clean(r, 20000); return RANGE_RE.test(s) ? s.replace(/\s*,\s*/g, ', ') : ''; };

// A short, cache-safe version token for a face file: changes when the file does.
const versionOf = (st) => `${Number(st.size || 0).toString(36)}-${Math.floor(Number(st.mtime || 0) / 1000).toString(36)}`;

// Inferred packages (no font.json) are cached — inspecting means reading the files.
const inferCache = new Map();

async function readPackage(vfs, resolveTarget, dir) {
  const entries = await vfs.vfsList(resolveTarget(dir));
  const listed = new Map(entries.filter((e) => !e.isDir).map((e) => [e.name, e]));
  const files = [...listed.keys()];
  const stats = new Map();
  // An SSH listing already carries size + mtime — a stat per file would cost a
  // round trip each, and a split font has ~120 files.
  const statOf = async (name) => {
    if (!stats.has(name)) {
      const e = listed.get(name);
      if (e && typeof e.size === 'number' && e.mtime) stats.set(name, { size: e.size, mtime: e.mtime });
      else {
        try { stats.set(name, await vfs.vfsStat(resolveTarget(`${dir}/${name}`))); }
        catch { stats.set(name, null); }
      }
    }
    return stats.get(name);
  };

  let meta = null;
  if (files.includes('font.json')) {
    meta = JSON.parse(stripBom(String(await vfs.vfsReadText(resolveTarget(`${dir}/font.json`)))));
    if (!meta || typeof meta !== 'object') meta = null;
  }

  const faces = [];
  const problems = [];
  let family = meta ? clean(meta.family, 120) : '';

  if (meta && Array.isArray(meta.faces) && meta.faces.length) {
    const present = [];
    for (const f of meta.faces) {
      const file = clean(f && f.file, 200);
      if (!file || /[\\/]/.test(file) || !isFontFile(file)) { problems.push(`bad face entry "${file}"`); continue; }
      if (!listed.has(file)) { problems.push(`missing file ${file}`); continue; }
      present.push({ f, file });
    }
    const sts = await Promise.all(present.map(({ file }) => statOf(file)));
    present.forEach(({ f, file }, i) => {
      const st = sts[i];
      if (!st) { problems.push(`unreadable file ${file}`); return; }
      const unicodeRange = normalizeRange(f.unicodeRange);
      faces.push({
        file, path: `${dir}/${file}`, format: FORMAT_OF[extOf(file)],
        weight: normalizeWeight(f.weight), style: normalizeStyle(f.style),
        ...(unicodeRange ? { unicodeRange } : {}),
        size: st.size || 0, version: versionOf(st),
      });
    });
  } else {
    const fontFiles = files.filter(isFontFile).sort();
    const sts = await Promise.all(fontFiles.map(statOf));
    const key = `${dir}|${fontFiles.map((n, i) => `${n}:${sts[i] ? versionOf(sts[i]) : '-'}`).join(',')}`;
    let inferred = inferCache.get(key);
    if (!inferred) {
      inferred = [];
      for (let i = 0; i < fontFiles.length; i++) {
        if (!sts[i]) continue;
        try {
          const info = inspectFontBuffer(await vfs.vfsReadBuffer(resolveTarget(`${dir}/${fontFiles[i]}`)));
          inferred.push({ file: fontFiles[i], info, st: sts[i] });
        } catch (e) { problems.push(`${fontFiles[i]}: ${e.message}`); }
      }
      if (inferCache.size > 200) inferCache.clear();
      inferCache.set(key, inferred);
    }
    for (const { file, info, st } of inferred) {
      if (!family) family = info.family;
      faces.push({
        file, path: `${dir}/${file}`, format: FORMAT_OF[extOf(file)],
        weight: info.weightRange ? `${info.weightRange[0]} ${info.weightRange[1]}` : String(info.weight || 400),
        style: info.italic ? 'italic' : 'normal',
        size: st.size || 0, version: versionOf(st),
      });
    }
  }

  if (!family || !faces.length) return null;
  const licenseFile = meta && clean(meta.licenseFile, 200);
  // Written by app/fontInstall.cjs: where the files were downloaded from.
  const from = meta && meta.installedFrom && typeof meta.installedFrom === 'object' ? meta.installedFrom : null;
  const fromText = from && (from.google ? `Google Fonts (${clean(from.google, 120)})`
    : clean(from.zip || from.url || (Array.isArray(from.urls) ? from.urls[0] : ''), 500));
  return {
    family,
    category: normalizeCategory(meta && meta.category),
    faces,
    license: meta ? clean(meta.license, 60) : '',
    licenseFile: licenseFile && listed.has(licenseFile) ? licenseFile : '',
    source: meta ? clean(meta.source, 500) : '',
    inferred: !meta,
    ...(fromText ? { installedFrom: fromText } : {}),
    size: faces.reduce((n, f) => n + f.size, 0),
    ...(problems.length ? { problems } : {}),
  };
}

/** Every font package available to a deck whose `.mdp` chain is `chain`
 *  (root→nearest), NEAREST winning on a family-name clash. `resolveTarget` maps
 *  a workspace-relative path to a VFS target (mdplink.resolve / server `vres`). */
async function listFonts(chain, resolveTarget, vfs) {
  const byFamily = new Map();
  for (const cdir of chain) {
    let dirs = [];
    try { dirs = (await vfs.vfsList(resolveTarget(`${cdir}/fonts`))).filter((e) => e.isDir); }
    catch { continue; }                         // no fonts folder in this `.mdp`
    for (const d of dirs.sort((a, b) => a.name.localeCompare(b.name))) {
      const dir = `${cdir}/fonts/${d.name}`;
      try {
        const pkg = await readPackage(vfs, resolveTarget, dir);
        if (pkg) byFamily.set(pkg.family.toLowerCase(), { id: d.name, dir, configDir: cdir, ...pkg });
      } catch (e) { /* unreadable package — skip it, keep the others */ }
    }
  }
  return [...byFamily.values()].sort((a, b) => a.family.localeCompare(b.family));
}

/** The raw `requirements.json` of every `.mdp` in the chain that has one
 *  (root→nearest). Parsing and merging happen in the renderer, which can then
 *  point out a malformed file where the user edits it. */
async function listFontRequirements(chain, resolveTarget, vfs) {
  const out = [];
  for (const cdir of chain) {
    const path = `${cdir}/fonts/requirements.json`;
    try { out.push({ configDir: cdir, path, text: String(await vfs.vfsReadText(resolveTarget(path))).slice(0, 512 * 1024) }); }
    catch { /* nothing declared in this `.mdp` */ }
  }
  return out;
}

const FONT_MIME = { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf' };

module.exports = { listFonts, listFontRequirements, inspectFontBuffer, isFontFile, FONT_MIME, CATEGORIES };
