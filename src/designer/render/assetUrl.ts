// Image/font sources in templates are project-relative paths ("assets/frames/ember.png",
// "frames/ember.png", or a card's image_path). They load through tcg-asset://, which only serves
// files inside the project folder. Remote URLs and absolute paths are not loaded (local-first,
// and an absolute path would not survive the project moving).

export type AssetVersions = Record<string, number>

export function assetKey(projectId: number, relPath: string): string {
  return `${projectId}/${relPath.replace(/\\/g, '/').replace(/^\/+/, '')}`
}

export function checkSrc(src: string): { ok: true; rel: string } | { ok: false; reason: string } {
  const s = src.trim()
  if (!s) return { ok: false, reason: 'empty' }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || s.startsWith('data:')) return { ok: false, reason: `only project files can be used, not "${s.slice(0, 40)}"` }
  if (/^([A-Za-z]:|\\\\|\/)/.test(s)) return { ok: false, reason: `absolute paths are not supported ("${s.slice(0, 60)}"); add the file to the project` }
  return { ok: true, rel: s.replace(/\\/g, '/') }
}

export function assetUrl(projectId: number, relPath: string, versions?: AssetVersions): string {
  const rel = relPath.replace(/\\/g, '/').replace(/^\/+/, '')
  const encoded = rel.split('/').map(encodeURIComponent).join('/')
  const v = versions?.[assetKey(projectId, rel)] ?? 0
  return `tcg-asset://p/${projectId}/${encoded}${v ? `?v=${v}` : ''}`
}
