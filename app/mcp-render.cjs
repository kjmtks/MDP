// Headless renderer for the shared web server's MCP endpoint (app/mcp-web.cjs).
//
// A handful of MDP's tools are only answerable by the app itself: the module and
// effect registries, the authoring spec built from them, deck validation, slide
// measurement, and every picture (render_slides / render_deck_overview /
// render_slide_image / read_image). In the desktop app the bridge relays those to
// the editor window over IPC. There is no window on a server — so this opens the
// SAME web app in headless Chromium and drives the SAME handlers through
// `window.mdpMcp.handle` (src/features/mcp/McpBridge.tsx). A preview an AI sees is
// therefore pixel-for-pixel the one the user sees, with no second renderer to keep
// in sync.
//
// One page per user, because the app resolves a workspace from the request header:
// the page is opened with that person's `x-preferred-username`, so it can only ever
// read what they can read. Pages are pooled (idle ones are closed) and each page
// serves one call at a time. `?mcp=1` puts the app in renderer mode: it takes no
// edit locks and writes nothing — MCP writes go through the Node side.

const IDLE_MS = 10 * 60 * 1000;   // close a user's page after this long unused
const MAX_PAGES = 3;              // ... and never keep more than this many alive
const BOOT_MS = 60 * 1000;        // the app has this long to become answerable

let cfg = null;                   // { url, userHeader, executablePath }
let browser = null;
let launching = null;
const pages = new Map();          // user -> { page, at }
const chains = new Map();         // user -> promise tail (one call at a time)
let sweeper = null;

function configure(options) {
  cfg = {
    url: String(options.url || '').replace(/\/+$/, ''),
    userHeader: String(options.userHeader || 'x-preferred-username'),
    executablePath: String(options.executablePath || ''),
  };
}
const enabled = () => !!(cfg && cfg.executablePath);

// ---- browser lifecycle -------------------------------------------------------

async function getBrowser() {
  if (browser && browser.connected) return browser;
  if (launching) return launching;
  const puppeteer = require('puppeteer-core');
  launching = puppeteer.launch({
    executablePath: cfg.executablePath,
    headless: true,
    // --no-sandbox: the browser runs as an unprivileged user inside the app's own
    // container and only ever loads this server's pages (loopback), so the sandbox
    // has nothing to protect that the container does not already.
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-gpu', '--hide-scrollbars', '--mute-audio', '--font-render-hinting=none',
      // One page per user means several pages at once, and Chromium freezes the
      // ones it considers background: timers stop and rendering never settles, so
      // a second user's call would hang the first one's until it timed out.
      '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion',
    ],
  }).then((b) => {
    browser = b;
    launching = null;
    b.on('disconnected', () => { browser = null; pages.clear(); chains.clear(); });
    return b;
  }).catch((e) => { launching = null; throw e; });
  return launching;
}

async function closePage(user) {
  const entry = pages.get(user);
  pages.delete(user);
  chains.delete(user);
  if (entry) { try { await entry.page.close(); } catch { /* already gone */ } }
  if (!pages.size && browser) { const b = browser; browser = null; try { await b.close(); } catch { /* ignore */ } }
}

function sweep() {
  const now = Date.now();
  for (const [user, e] of [...pages]) if (now - e.at > IDLE_MS) closePage(user);
  if (!pages.size && sweeper) { clearInterval(sweeper); sweeper = null; }
}

async function openPage(user) {
  const b = await getBrowser();
  const page = await b.newPage();
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  // One page per user means only ONE of them is the front tab. Chromium stops
  // animation frames in the others, and the slide rasteriser waits for a frame
  // that never comes — the first user's render would hang the moment a second
  // user got a page. Tell every page it is focused and awake.
  const cdp = await page.createCDPSession();
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  await cdp.send('Page.enable').catch(() => {});
  await cdp.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
  // The app resolves the workspace from this header, exactly as it does for the
  // person's own browser — the page cannot see anything they cannot.
  await page.setExtraHTTPHeaders({ [cfg.userHeader]: user });
  page.setDefaultNavigationTimeout(BOOT_MS);
  await page.goto(`${cfg.url}/?mcp=1`, { waitUntil: 'domcontentloaded' });
  // The bridge installs window.mdpMcp once the editor is mounted and its module /
  // effect registries have loaded — until then a tool call would see an empty
  // workspace, so wait for it rather than racing the boot.
  await page.waitForFunction('!!(window.mdpMcp && window.mdpMcp.ready)', { timeout: BOOT_MS, polling: 250 });
  return page;
}

// ---- calls -------------------------------------------------------------------

// Run one relayed method for `user`. Calls for the same user are serialized (one
// editor, one deck open at a time); different users run in parallel pages.
async function call(user, method, params, timeoutMs) {
  if (!enabled()) {
    throw new Error('This tool needs MDP\'s renderer, which is not available on this server (the visual tools are disabled here).');
  }
  const go = () => run(user, method, params, timeoutMs);
  const next = (chains.get(user) || Promise.resolve()).then(go, go);
  chains.set(user, next.then(() => {}, () => {}));
  if (!sweeper) { sweeper = setInterval(sweep, 60 * 1000); sweeper.unref?.(); }
  return next;
}

async function run(user, method, params, timeoutMs) {
  let entry = pages.get(user);
  if (entry && entry.page.isClosed()) { pages.delete(user); entry = null; }
  if (!entry) {
    // Evict the least recently used page before adding another.
    while (pages.size >= MAX_PAGES) {
      const oldest = [...pages].sort((a, b) => a[1].at - b[1].at)[0];
      await closePage(oldest[0]);
    }
    entry = { page: await openPage(user), at: Date.now() };
    pages.set(user, entry);
  }
  entry.at = Date.now();
  const wait = Math.max(5000, Number(timeoutMs) || 30000);
  try {
    return await withTimeout(
      entry.page.evaluate((m, p) => window.mdpMcp.handle(m, p), method, params || {}),
      wait,
      `MDP's renderer did not answer "${method}" within ${Math.round(wait / 1000)}s.`,
    );
  } catch (e) {
    // A page that died (crash, OOM, navigation) must not poison the next call.
    if (entry.page.isClosed()) pages.delete(user);
    throw new Error(String((e && e.message) || e).replace(/^Error: /, ''));
  } finally {
    entry.at = Date.now();
  }
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
  ]);
}

async function shutdown() {
  if (sweeper) { clearInterval(sweeper); sweeper = null; }
  for (const user of [...pages.keys()]) await closePage(user);
}

// Where Chromium lives. The deployment says so explicitly (the image installs it);
// a couple of usual paths are tried so a plain `node server.cjs` on a workstation
// finds one too. Empty -> the visual tools stay off.
function findChromium(explicit) {
  const fs = require('fs');
  const cands = [explicit, process.env.PUPPETEER_EXECUTABLE_PATH, process.env.CHROME_PATH,
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].filter(Boolean);
  for (const c of cands) { try { if (fs.statSync(c).isFile()) return c; } catch { /* next */ } }
  return '';
}

module.exports = { configure, enabled, call, shutdown, findChromium };
