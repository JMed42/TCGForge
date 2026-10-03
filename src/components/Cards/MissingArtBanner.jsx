import { useEffect, useState } from 'react'
import { ImageOff } from 'lucide-react'
import { useStore } from '../../store'

// Missing-art report (spec Library: "watched art folder with a missing-art report"): cards whose
// image path and template images whose source don't resolve to a file in the project.
export default function MissingArtBanner() {
  const missing = useStore((s) => s.missingArt)
  const only = useStore((s) => s.missingArtOnly)
  const [details, setDetails] = useState(false)
  const none = !missing || !missing.cards.length
  useEffect(() => { if (none && only) useStore.getState().setMissingArtOnly(false) }, [none, only])
  if (!missing || (!missing.cards.length && !missing.templates.length)) return null
  const n = missing.cards.length
  return (
    <div className="mx-4 mb-2 px-3 py-2 rounded-lg border border-amber-500/40 bg-amber-500/10 text-xs text-amber-300" data-testid="missing-art">
      <div className="flex items-center gap-3">
        <ImageOff size={14} />
        <span className="flex-1" data-testid="missing-art-summary">
          {n > 0 && `${n} card${n === 1 ? '' : 's'} missing art`}
          {n > 0 && missing.templates.length > 0 && ' · '}
          {missing.templates.length > 0 && `${missing.templates.length} template image${missing.templates.length === 1 ? '' : 's'} missing`}
        </span>
        {n > 0 && (
          <button
            data-testid="missing-art-filter"
            onClick={() => useStore.getState().setMissingArtOnly(!only)}
            className={`px-2 py-0.5 rounded ${only ? 'bg-amber-500 text-black' : 'bg-amber-500/20 hover:bg-amber-500/30'}`}
          >
            {only ? 'Show all cards' : 'Show only these'}
          </button>
        )}
        <button onClick={() => setDetails((d) => !d)} className="underline decoration-dotted">{details ? 'Hide' : 'Details'}</button>
      </div>
      {details && (
        <ul className="mt-2 space-y-0.5 text-amber-200/90 max-h-32 overflow-auto">
          {missing.cards.map((c) => <li key={`c${c.id}`}>{c.name}: <code>{c.image_path}</code></li>)}
          {missing.templates.map((t) => <li key={`t${t.id}:${t.layer}`}>Template “{t.name}”, layer {t.layer}: <code>{t.src}</code></li>)}
        </ul>
      )}
    </div>
  )
}
