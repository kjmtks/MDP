'use strict';
// Install a DECLARED font into a `.mdp`: `.mdp/fonts/requirements.json` lists the
// fonts decks under a folder need, and an entry with a `source` can be fetched —
// from Google Fonts, from direct font-file URLs, or from inside a ZIP archive —
// and written as a font package (`<cdir>/fonts/<id>/`: files + font.json) that
// app/fonts.cjs then lists like any other. Shared by app/main.cjs and server.cjs.
//
// Runs only on an explicit user action (the app is offline-first: rendering never
// fetches anything; only this installer touches the network).

const zlib = require('zlib');
const { inspectFontBuffer, isFontFile } = require('./fonts.cjs');

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const MAX_FILE = 60 * 1024 * 1024;       // one download
const MAX_TOTAL = 250 * 1024 * 1024;     // everything one install writes
// The shared (multi-user) web deployment must not become a proxy that fetches
// arbitrary addresses for its users: there, only these hosts (and redirects to them).
const SHARED_HOSTS = new Set([
  'fonts.googleapis.com', 'fonts.gstatic.com', 'raw.githubusercontent.com', 'github.com',
  'objects.githubusercontent.com', 'release-assets.githubusercontent.com', 'codeload.github.com',
  'cdn.jsdelivr.net',
]);
const GOOGLE_LICENSE = { ofl: ['OFL-1.1', 'OFL.txt'], apache: ['Apache-2.0', 'LICENSE.txt'], ufl: ['UFL-1.0', 'UFL.txt'] };
const CATEGORY = { SANS_SERIF: 'sans-serif', SERIF: 'serif', MONOSPACE: 'monospace', DISPLAY: 'other', HANDWRITING: 'other' };

const clean = (s, max = 200) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const stripBom = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
const slugOf = (family) => family.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'font';
const safeName = (name) => {
  const base = String(name).split(/[\\/]/).pop() || 'font';
  const m = base.match(/^(.*?)(\.[a-z0-9]{1,6})$/i);
  const stem = (m ? m[1] : base).normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|-+$/g, '') || 'font';
  return `${stem.slice(0, 100)}${m ? m[2].toLowerCase() : ''}`;
};

// --- downloading ---------------------------------------------------------------
async function download(url, ctx, opts = {}) {
  let current = String(url);
  for (let hop = 0; hop < 6; hop++) {
    let u;
    try { u = new URL(current); } catch { throw new Error(`Not a valid URL: ${current}`); }
    if (u.protocol !== 'https:') throw new Error(`Only https downloads are allowed: ${current}`);
    if (ctx.sharedMode && !SHARED_HOSTS.has(u.hostname)) throw new Error(`Downloads from ${u.hostname} are not allowed on this server.`);
    const res = await ctx.fetchImpl(current, {
      redirect: ctx.sharedMode ? 'manual' : 'follow',
      headers: { 'User-Agent': CHROME_UA, ...(opts.headers || {}) },
    });
    if (ctx.sharedMode && res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), current).toString();
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${current}`);
    const len = Number(res.headers.get('content-length') || 0);
    if (len > (opts.max || MAX_FILE)) throw new Error(`Too large (${len} bytes): ${current}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > (opts.max || MAX_FILE)) throw new Error(`Too large (${buf.length} bytes): ${current}`);
    ctx.total += buf.length;
    if (ctx.total > MAX_TOTAL) throw new Error('The font is larger than the install limit (250 MB).');
    return buf;
  }
  throw new Error(`Too many redirects: ${url}`);
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

// --- Google Fonts ----------------------------------------------------------------
// The family's METADATA.pb (github.com/google/fonts) says which styles and axes
// exist; the CSS2 API then serves the self-hostable WOFF2 files, split by
// unicode-range (a CJK family comes as ~120 slices the browser loads on demand).
function parseMetadataPb(text) {
  const top = text.split(/\nfonts \{/)[0];
  const meta = {
    name: (/^name: "(.*)"/m.exec(top) || [])[1] || '',
    license: ((/^license: "(\w+)"/m.exec(text) || [])[1] || '').toLowerCase(),
    category: (/^category: "(\w+)"/m.exec(text) || [])[1] || '',
    fonts: [],
    axes: [],
  };
  for (const m of text.matchAll(/^fonts \{([\s\S]*?)^\}/gm)) {
    meta.fonts.push({
      style: (/style: "(\w+)"/.exec(m[1]) || [])[1] || 'normal',
      weight: Number((/weight: (\d+)/.exec(m[1]) || [])[1] || 400),
    });
  }
  for (const m of text.matchAll(/^axes \{([\s\S]*?)^\}/gm)) {
    meta.axes.push({
      tag: (/tag: "(\w+)"/.exec(m[1]) || [])[1] || '',
      min: Number((/min_value: ([\d.]+)/.exec(m[1]) || [])[1]),
      max: Number((/max_value: ([\d.]+)/.exec(m[1]) || [])[1]),
    });
  }
  return meta;
}

// `weights` (optional, from the declaration) narrows a family to those weights —
// the files then hold static instances instead of the whole variable range.
function cssQuery(meta, weights) {
  const fam = encodeURIComponent(meta.name).replace(/%20/g, '+');
  const italic = meta.fonts.some((f) => f.style === 'italic');
  const wght = meta.axes.find((a) => a.tag === 'wght' && a.min > 0 && a.max >= a.min);
  const wanted = (Array.isArray(weights) ? weights : []).map(Number)
    .filter((w) => Number.isInteger(w) && w >= 1 && w <= 1000
      && (wght ? w >= wght.min && w <= wght.max : meta.fonts.some((f) => f.weight === w)));
  if (wanted.length) {
    const ws = [...new Set(wanted)].sort((a, b) => a - b);
    return italic ? `${fam}:ital,wght@${[0, 1].flatMap((i) => ws.map((w) => `${i},${w}`)).join(';')}` : `${fam}:wght@${ws.join(';')}`;
  }
  if (wght) {
    const r = `${Math.round(wght.min)}..${Math.round(wght.max)}`;
    return italic ? `${fam}:ital,wght@0,${r};1,${r}` : `${fam}:wght@${r}`;
  }
  const tuples = [...new Set(meta.fonts.map((f) => `${f.style === 'italic' ? 1 : 0},${f.weight}`))]
    .sort((a, b) => { const [ia, wa] = a.split(',').map(Number); const [ib, wb] = b.split(',').map(Number); return ia - ib || wa - wb; });
  if (!tuples.length) return fam;
  return italic ? `${fam}:ital,wght@${tuples.join(';')}` : `${fam}:wght@${tuples.map((t) => t.split(',')[1]).join(';')}`;
}

function parseFontFaceBlocks(css) {
  const out = [];
  for (const m of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const body = m[1];
    const src = /src:\s*url\(\s*['"]?([^'")\s]+)['"]?\s*\)\s*format\(\s*['"]?([\w-]+)['"]?\s*\)/.exec(body);
    if (!src) continue;
    out.push({
      style: (/font-style:\s*([\w-]+)/.exec(body) || [])[1] || 'normal',
      weight: ((/font-weight:\s*([\d ]+);/.exec(body) || [])[1] || '400').trim().replace(/\s+/, ' '),
      unicodeRange: ((/unicode-range:\s*([^;]+);/.exec(body) || [])[1] || '').trim(),
      url: src[1],
      format: src[2],
    });
  }
  return out;
}

async function fromGoogle(family, weights, ctx) {
  const slug = family.toLowerCase().replace(/[^a-z0-9]/g, '');
  let meta = null;
  let licDir = '';
  for (const d of ['ofl', 'apache', 'ufl']) {
    try {
      meta = parseMetadataPb((await download(`https://raw.githubusercontent.com/google/fonts/main/${d}/${slug}/METADATA.pb`, ctx)).toString('utf8'));
      licDir = d;
      break;
    } catch { /* try the next licence folder */ }
  }
  if (!meta || !meta.name) throw new Error(`"${family}" is not on Google Fonts (looked for google/fonts …/${slug}/METADATA.pb).`);
  const css = (await download(`https://fonts.googleapis.com/css2?family=${cssQuery(meta, weights)}&display=block`, ctx)).toString('utf8');
  const blocks = parseFontFaceBlocks(css);
  if (!blocks.length) throw new Error(`Google Fonts returned no font files for "${meta.name}".`);
  const files = await mapLimit(blocks, 6, async (b, i) => {
    const w = b.weight.replace(' ', '-');
    const ext = b.format === 'woff2' ? '.woff2' : b.format === 'woff' ? '.woff' : '.ttf';
    return {
      name: `${slug}-${b.style === 'italic' ? 'italic' : 'normal'}-${w}-${String(i).padStart(3, '0')}${ext}`,
      buf: await download(b.url, ctx),
      face: { weight: b.weight, style: b.style === 'italic' ? 'italic' : 'normal', ...(b.unicodeRange ? { unicodeRange: b.unicodeRange } : {}) },
    };
  });
  const [licenseId, licenseName] = GOOGLE_LICENSE[licDir] || ['', ''];
  let license = null;
  try { license = { name: licenseName, buf: await download(`https://raw.githubusercontent.com/google/fonts/main/${licDir}/${slug}/${licenseName}`, ctx) }; }
  catch { /* keep going without the text; the id is still recorded */ }
  return {
    family: meta.name,
    category: CATEGORY[meta.category] || 'sans-serif',
    files,
    license,
    licenseId,
    source: `https://fonts.google.com/specimen/${encodeURIComponent(meta.name).replace(/%20/g, '+')}`,
  };
}

// --- plain files and ZIP archives -----------------------------------------------
function describe(name, buf) {
  const info = inspectFontBuffer(buf);
  return {
    info,
    face: {
      weight: info.weightRange ? `${info.weightRange[0]} ${info.weightRange[1]}` : String(info.weight || 400),
      style: info.italic ? 'italic' : 'normal',
    },
  };
}

async function fromUrls(urls, ctx) {
  const files = [];
  for (const url of urls) {
    const buf = await download(url, ctx);
    const name = safeName(decodeURIComponent(new URL(url).pathname));
    if (!isFontFile(name)) throw new Error(`Not a font file (.woff2/.woff/.ttf/.otf): ${url}`);
    const { info, face } = describe(name, buf);
    files.push({ name, buf, face, info });
  }
  return { files };
}

// Minimal ZIP reader: the central directory gives each entry's sizes and offset
// (so data descriptors do not matter); stored and deflated entries are supported.
function zipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a ZIP archive.');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) throw new Error('Broken ZIP directory.');
    const flags = buf.readUInt16LE(off + 8);
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const size = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString(flags & 0x800 ? 'utf8' : 'latin1', off + 46, off + 46 + nameLen);
    out.push({ name, method, compSize, size, localOff });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function zipRead(buf, e) {
  if (e.size > MAX_FILE) throw new Error(`Too large inside the ZIP: ${e.name}`);
  const lo = e.localOff;
  if (buf.readUInt32LE(lo) !== 0x04034b50) throw new Error(`Broken ZIP entry: ${e.name}`);
  const start = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28);
  const data = buf.subarray(start, start + e.compSize);
  if (e.method === 0) return Buffer.from(data);
  // The stated size may lie (a "zip bomb") — cap what inflating may produce.
  if (e.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: MAX_FILE });
  throw new Error(`Unsupported ZIP compression (method ${e.method}): ${e.name}`);
}

// `files` entries match an entry by its full path or by its file name; `*` is a
// wildcard (e.g. "*.otf", "fonts/ttf/*-Regular.ttf").
function zipMatcher(patterns) {
  const res = patterns.map((p) => new RegExp(`(^|/)${String(p).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')}$`, 'i'));
  return (name) => res.some((r) => r.test(name));
}

async function fromZip(zipUrl, patterns, ctx) {
  const zip = await download(zipUrl, ctx, { max: MAX_TOTAL });
  const entries = zipEntries(zip).filter((e) => !e.name.endsWith('/') && !/(^|\/)(__MACOSX|\.)/.test(e.name));
  const wanted = Array.isArray(patterns) && patterns.length ? zipMatcher(patterns) : (n) => isFontFile(n);
  const picked = entries.filter((e) => isFontFile(e.name) && wanted(e.name));
  if (!picked.length) {
    const fonts = entries.filter((e) => isFontFile(e.name)).map((e) => e.name).slice(0, 12);
    throw new Error(`No matching font files in the ZIP. It contains: ${fonts.join(', ') || '(no font files)'}`);
  }
  const used = new Set();
  const files = picked.map((e) => {
    const buf = zipRead(zip, e);
    let name = safeName(e.name);
    for (let n = 2; used.has(name.toLowerCase()); n++) name = name.replace(/(\.[a-z0-9]+)$/i, `-${n}$1`);
    used.add(name.toLowerCase());
    const { info, face } = describe(name, buf);
    return { name, buf, face, info };
  });
  const lic = entries.find((e) => /(^|\/)(OFL|LICEN[CS]E|COPYING)[^/]*$/i.test(e.name) && e.size < 512 * 1024);
  if (!lic) return { files, license: null };
  const licName = safeName(lic.name);
  return { files, license: { name: /\.(txt|md)$/i.test(licName) ? licName : `${licName}.txt`, buf: zipRead(zip, lic) } };
}

// --- writing the package ----------------------------------------------------------
async function writePackage(vfs, resolveTarget, configDir, pkg) {
  const fontsDir = `${configDir}/fonts`;
  let existing = [];
  try { existing = (await vfs.vfsList(resolveTarget(fontsDir))).filter((e) => e.isDir).map((e) => e.name); } catch { /* none yet */ }
  // Reinstalling a family replaces the package this installer wrote for it. A
  // package of that family put there another way (the official catalog, a file the
  // user added) is left alone — the family is already there.
  let id = '';
  for (const name of existing) {
    let meta = null;
    try { meta = JSON.parse(stripBom(String(await vfs.vfsReadText(resolveTarget(`${fontsDir}/${name}/font.json`))))); }
    catch { continue; }
    if (!meta || String(meta.family || '').toLowerCase() !== pkg.family.toLowerCase()) continue;
    if (!meta.installedFrom) throw new Error(`"${pkg.family}" is already in ${fontsDir}/${name} — remove that package first to reinstall it.`);
    id = name;
    break;
  }
  const replacing = !!id;
  if (!id) {
    id = slugOf(pkg.family);
    for (let n = 2; existing.includes(id); n++) id = `${slugOf(pkg.family)}-${n}`;
  }
  const dir = `${fontsDir}/${id}`;
  if (replacing) await vfs.vfsRemove(resolveTarget(dir));
  let bytes = 0;
  for (const f of pkg.files) { await vfs.vfsWrite(resolveTarget(`${dir}/${f.name}`), f.buf); bytes += f.buf.length; }
  if (pkg.license) await vfs.vfsWrite(resolveTarget(`${dir}/${pkg.license.name}`), pkg.license.buf);
  const meta = {
    family: pkg.family,
    category: pkg.category,
    faces: pkg.files.map((f) => ({ file: f.name, ...f.face, size: f.buf.length })),
    license: pkg.licenseId || '',
    ...(pkg.license ? { licenseFile: pkg.license.name } : {}),
    source: pkg.source || '',
    installedFrom: pkg.installedFrom,
    installedAt: new Date().toISOString(),
  };
  await vfs.vfsWrite(resolveTarget(`${dir}/font.json`), Buffer.from(`${JSON.stringify(meta, null, 2)}\n`, 'utf-8'));
  return { id, dir, family: pkg.family, files: pkg.files.length, bytes };
}

/** Install one requirement entry ({ family, source, category?, license?,
 *  homepage? }) into `<configDir>/fonts/`. `fetchImpl` is the platform fetch
 *  (Electron's net.fetch honours the system proxy); `sharedMode` restricts hosts. */
async function installFont({ entry, configDir, resolveTarget, vfs, fetchImpl, sharedMode = false }) {
  const family = clean(entry && entry.family, 120);
  if (!family) throw new Error('The declaration has no family name.');
  const cdir = String(configDir || '');
  if (!/^(\.mdp|.+\/\.mdp)$/.test(cdir) || cdir.split('/').some((s) => !s || s === '.' || s === '..') || cdir.includes('\\')) {
    throw new Error('Fonts are installed into a .mdp folder only.');
  }
  const src = entry.source;
  const ctx = { fetchImpl, sharedMode, total: 0 };
  let got;
  let installedFrom;
  if (src === 'google' || (src && typeof src === 'object' && src.google)) {
    const name = clean(typeof src === 'object' && typeof src.google === 'string' ? src.google : family, 120);
    const weights = src && typeof src === 'object' && Array.isArray(src.weights) ? src.weights : null;
    got = await fromGoogle(name, weights, ctx);
    installedFrom = { google: got.family, ...(weights ? { weights } : {}) };
  } else if (src && typeof src === 'object' && src.zip) {
    got = await fromZip(clean(src.zip, 2000), Array.isArray(src.files) ? src.files.map((f) => clean(f, 300)) : [], ctx);
    installedFrom = { zip: clean(src.zip, 2000), ...(Array.isArray(src.files) ? { files: src.files.map((f) => clean(f, 300)) } : {}) };
  } else if (src && typeof src === 'object' && (src.url || Array.isArray(src.urls))) {
    const urls = (src.urls || [src.url]).map((u) => clean(u, 2000)).filter(Boolean).slice(0, 40);
    got = await fromUrls(urls, ctx);
    installedFrom = src.urls ? { urls } : { url: urls[0] };
  } else {
    throw new Error(`"${family}" has no download source — it is declared as required only.`);
  }
  // The DECLARED name is what decks use; the files may call themselves otherwise.
  const declared = entry.category;
  return await writePackage(vfs, resolveTarget, cdir, {
    family,
    category: ['sans-serif', 'serif', 'monospace', 'other'].includes(declared) ? declared : (got.category || 'sans-serif'),
    files: got.files,
    license: got.license || null,
    licenseId: clean(entry.license, 60) || got.licenseId || (got.files[0] && got.files[0].info && got.files[0].info.licenseKind) || '',
    source: clean(entry.homepage, 500) || got.source || '',
    installedFrom,
  });
}

module.exports = { installFont, parseMetadataPb, cssQuery, parseFontFaceBlocks, zipEntries, zipRead };
