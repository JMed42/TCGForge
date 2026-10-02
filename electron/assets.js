// Project assets: served to the renderer through the tcg-asset:// protocol and watched on disk
// so a replaced file updates every render (spec: "Assets").
//
//   tcg-asset://p/{projectId}/{relPath}?v={version}
//
// relPath is resolved inside {userData}/projects/{projectId}/, trying in order:
//   {relPath}            e.g. assets/art/hero.png, art/hero.png (Phase 1 art picker)
//   assets/{relPath}     e.g. frames/ember.png -> assets/frames/ember.png
//   templates/{relPath}  Phase 0 template assets (templates/assets/...)
// Anything that would leave the project folder is refused.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const SCHEME = 'tcg-asset';
const ASSET_SUBDIRS = ['art', 'frames', 'icons', 'fonts'];

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
};

function projectRoot(userDataPath, projectId) {
  const pid = Number(projectId);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  return path.join(userDataPath, 'projects', String(pid));
}

function isInside(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Absolute path of an existing asset file, or null. Never returns a path outside the project.
 * @param {string} relPath  forward-slash path relative to the project (already URL-decoded)
 */
function resolveProjectAsset(userDataPath, projectId, relPath) {
  const root = projectRoot(userDataPath, projectId);
  if (!root || typeof relPath !== 'string' || !relPath || relPath.length > 1024) return null;
  if (relPath.includes('\0') || path.isAbsolute(relPath) || /^[A-Za-z]:/.test(relPath) || relPath.startsWith('\\\\')) return null;
  const parts = relPath.replace(/\\/g, '/').split('/');
  if (parts.some((p) => p === '..')) return null;
  for (const prefix of ['', 'assets', 'templates']) {
    const candidate = path.resolve(root, prefix, ...parts);
    if (!isInside(root, candidate)) continue;
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // try the next location
    }
  }
  return null;
}

// Parse tcg-asset://p/{projectId}/{relPath}
function parseAssetUrl(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== `${SCHEME}:` || u.hostname !== 'p') return null;
  const segments = u.pathname.split('/').filter(Boolean);
  if (segments.length < 2) return null;
  let rel;
  try { rel = segments.slice(1).map(decodeURIComponent).join('/'); } catch { return null; }
  return { projectId: Number(segments[0]), relPath: rel };
}

// Must run before app 'ready'.
function registerAssetScheme(protocol) {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  ]);
}

function registerAssetProtocol(protocol, net, userDataPath) {
  protocol.handle(SCHEME, async (request) => {
    const parsed = parseAssetUrl(request.url);
    const file = parsed && resolveProjectAsset(userDataPath, parsed.projectId, parsed.relPath);
    if (!file) return new Response('not found', { status: 404 });
    const res = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(res.headers);
    const ext = path.extname(file).slice(1).toLowerCase();
    if (MIME[ext]) headers.set('Content-Type', MIME[ext]);
    headers.set('Cache-Control', 'no-cache');
    headers.set('Access-Control-Allow-Origin', '*');
    return new Response(res.body, { status: res.status, headers });
  });
}

/**
 * Watch every project folder; calls onChange({ projectId, relPath }) for changed files,
 * debounced per file. Returns a function that stops watching.
 */
function watchProjectAssets(userDataPath, onChange, { debounceMs = 120 } = {}) {
  const root = path.join(userDataPath, 'projects');
  fs.mkdirSync(root, { recursive: true });
  const timers = new Map();
  let watcher;
  try {
    watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const parts = String(filename).split(/[\\/]/).filter(Boolean);
      const projectId = Number(parts[0]);
      if (!Number.isInteger(projectId) || parts.length < 2) return;
      const relPath = parts.slice(1).join('/');
      const key = `${projectId}/${relPath}`;
      clearTimeout(timers.get(key));
      timers.set(key, setTimeout(() => {
        timers.delete(key);
        onChange({ projectId, relPath });
      }, debounceMs));
    });
  } catch (err) {
    console.warn(`[assets] file watching unavailable: ${err.message}`);
    return () => {};
  }
  watcher.on('error', (err) => console.warn(`[assets] watcher error: ${err.message}`));
  return () => {
    for (const t of timers.values()) clearTimeout(t);
    watcher.close();
  };
}

module.exports = {
  SCHEME, ASSET_SUBDIRS, projectRoot, resolveProjectAsset, parseAssetUrl,
  registerAssetScheme, registerAssetProtocol, watchProjectAssets,
};
