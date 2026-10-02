// Registers a project's font files (assets/fonts/*) as FontFaces loaded through tcg-asset://, so
// templates can use them by family name. Re-registers a file when it changes on disk.

import { useEffect, useState } from 'react'
import type { ProjectFont } from '../api.d.ts'
import { assetUrl, assetKey } from './assetUrl.ts'
import type { AssetVersions } from './assetUrl.ts'

const registered = new Map<string, FontFace>() // key: projectId/relPath@version

export function useProjectFonts(projectId: number | null | undefined, versions?: AssetVersions): { ready: boolean; fonts: ProjectFont[] } {
  const [state, setState] = useState<{ key: string; fonts: ProjectFont[] } | null>(null)
  const fontVersionKey = Object.entries(versions || {})
    .filter(([k]) => projectId && k.startsWith(`${projectId}/`) && /fonts\//.test(k))
    .map(([k, v]) => `${k}@${v}`)
    .sort()
    .join('|')
  const key = `${projectId ?? ''}#${fontVersionKey}`

  useEffect(() => {
    if (!projectId) { setState({ key, fonts: [] }); return }
    let cancelled = false
    ;(async () => {
      const fonts: ProjectFont[] = await window.api.listProjectFonts(projectId).catch(() => [])
      await Promise.all(fonts.map(async (f) => {
        const v = versions?.[assetKey(projectId, f.relPath)] ?? 0
        const id = `${projectId}/${f.relPath}@${v}`
        if (registered.has(id)) return
        // Drop older versions of the same file.
        for (const [k, face] of registered) {
          if (k.startsWith(`${projectId}/${f.relPath}@`)) { document.fonts.delete(face); registered.delete(k) }
        }
        const face = new FontFace(f.family, `url("${assetUrl(projectId, f.relPath, versions)}")`, { weight: String(f.weight), style: f.style })
        try {
          await face.load()
          document.fonts.add(face)
          registered.set(id, face)
        } catch (err) {
          console.warn(`[fonts] could not load ${f.relPath}:`, err)
        }
      }))
      if (!cancelled) setState({ key, fonts })
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { ready: state?.key === key, fonts: state?.key === key ? state.fonts : [] }
}
