import { useEffect, useState } from 'react'
import { FolderOpen, RefreshCw } from 'lucide-react'
import { useStore } from '../../store'

// The project's font files ({project}/assets/fonts). Templates use them by family name; the
// file name gives the family and style ("Cinzel-Bold.ttf" is Cinzel, weight 700).
export default function FontsTab() {
  const projectId = useStore((s) => s.activeProjectId)
  const assetVersions = useStore((s) => s.assetVersions)
  const [fonts, setFonts] = useState(null)
  const load = () => window.api.listProjectFonts(projectId).then(setFonts).catch(() => setFonts([]))
  useEffect(() => { load() }, [projectId, assetVersions]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="h-full overflow-auto p-6 space-y-4">
      <div className="flex items-center gap-2">
        <button data-testid="open-fonts-folder" onClick={() => window.api.openProjectFolder(projectId, 'assets/fonts')} className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-surface-2 hover:bg-surface-3 text-sm text-text-secondary"><FolderOpen size={14} /> Open fonts folder</button>
        <button onClick={load} title="Look again" className="p-1.5 rounded hover:bg-surface-2 text-text-muted"><RefreshCw size={14} /></button>
      </div>
      <p className="max-w-2xl text-sm text-text-muted">
        Put .ttf, .otf or .woff files in the project's fonts folder, named Family-Style (for example Cinzel-Bold.ttf). They
        appear here and in the Designer's font list right away, and exports use them.
      </p>
      {fonts && (fonts.length ? (
        <table className="max-w-3xl w-full text-sm" data-testid="fonts-table">
          <thead><tr className="text-left text-xs text-text-muted border-b border-border"><th className="py-1 font-medium">Family</th><th className="py-1 font-medium">Weight</th><th className="py-1 font-medium">Style</th><th className="py-1 font-medium">File</th></tr></thead>
          <tbody>
            {fonts.map((f) => (
              <tr key={f.relPath} className="border-b border-border">
                <td className="py-1.5 text-text-primary" style={{ fontFamily: `"${f.family}", sans-serif`, fontWeight: f.weight, fontStyle: f.style }}>{f.family}</td>
                <td className="py-1.5 text-text-secondary">{f.weight}</td>
                <td className="py-1.5 text-text-secondary">{f.style}</td>
                <td className="py-1.5 text-text-muted font-mono text-xs">{f.relPath}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="text-sm text-text-muted" data-testid="no-fonts">No font files yet.</p>)}
    </div>
  )
}
