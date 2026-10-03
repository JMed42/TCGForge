import { useEffect, useMemo, useRef, useState } from 'react'
import { ClipboardPaste, FolderOpen, ImagePlus, Plus, Trash2 } from 'lucide-react'
import { useStore } from '../../store'
import CardRender from '../../designer/render/CardRender.tsx'
import { assetUrl } from '../../designer/render/assetUrl.ts'
import { LibraryContext } from '../../designer/library/LibraryContext.ts'
import { compileLibrary } from '../../designer/library/library.ts'
import { useParsedTemplates } from '../Fit/templates'
import WhereUsedDialog from './WhereUsedDialog'
import { cardUses, symbolMatcher, symbolRename, symbolWhereUsed, usesCount } from './whereUsed'

const input = 'w-full px-2 py-1.5 bg-surface-2 border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent'
const message = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const blank = () => ({ id: null, shortcode: '', rel_path: '', scale: 1, baseline_offset: -0.12, width: null, height: null })

// "Pay {code}{code}: draw a card." drawn by the real renderer at three sizes, with the symbol as
// it is being edited: shows its size and where it sits on the baseline.
function SymbolPreview({ projectId, draft, rows }) {
  const code = draft.shortcode || 'symbol'
  const lib = useMemo(() => compileLibrary({
    ...rows,
    symbols: [...rows.symbols.filter((s) => s.id !== draft.id), { ...draft, shortcode: code }],
  }), [rows, draft, code])
  const line = (pt) => ({
    schemaVersion: 1, size: { widthMm: 80, heightMm: pt * 0.75, bleedMm: 0, safeMm: 0 },
    layers: [
      { id: 'bg', type: 'shape', shape: 'rect', frame: { left: 0, right: 0, top: 0, bottom: 0 }, fill: '#20232c' },
      { id: 'line', type: 'richText', text: `Pay {${code}}{${code}}: draw a card. *Rally {${code}}*`, frame: { left: 2, right: 2, top: 0, bottom: 0 }, style: { font: 'Georgia', sizePt: pt, color: '#f1f1f1', valign: 'middle', wrap: false } },
    ],
  })
  return (
    <LibraryContext.Provider value={lib}>
      <div className="space-y-1" data-testid="symbol-preview">
        {[7, 9, 12].map((pt) => (
          <div key={pt} className="flex items-center gap-2">
            <span className="w-10 text-[10px] text-text-muted text-right">{pt} pt</span>
            <CardRender template={line(pt)} card={null} projectId={projectId} pxPerMm={5} />
          </div>
        ))}
      </div>
    </LibraryContext.Provider>
  )
}

function SymbolEditor({ projectId, rows, initial, onDone }) {
  const [draft, setDraft] = useState(initial)
  const [error, setError] = useState(null)
  const [note, setNote] = useState(null)
  const [icons, setIcons] = useState([])
  const [dialog, setDialog] = useState(null)
  const fileRef = useRef(null)
  const cards = useStore((s) => s.cards)
  const documents = useStore((s) => s.documents)
  const templates = useParsedTemplates()
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }))
  useEffect(() => {
    window.api.getAssets(projectId, 'icon').then((rowsOut) => setIcons(rowsOut || [])).catch(() => setIcons([]))
  }, [projectId])

  const took = (res, how) => {
    if (res?.empty) { setNote('No image on the clipboard.'); return }
    if (!res?.path) return
    set({ rel_path: res.path, width: res.thumbnail?.width ?? null, height: res.thumbnail?.height ?? null })
    setNote(how)
  }
  const fail = (e) => setError(message(e))
  const paste = () => window.api.pasteImageFromClipboard(projectId, { folder: 'icons', name: draft.shortcode || 'symbol' }).then((r) => took(r, 'Pasted from the clipboard.'), fail)
  const fromFile = (file) => {
    if (!file) return
    let p = null
    try { p = window.api.pathForFile(file) } catch { p = null }
    if (!p) { setError('Could not read that file.'); return }
    window.api.importCardArt(projectId, p, { folder: 'icons' }).then((r) => took(r, `Copied ${file.name} into the project.`), fail)
  }

  const original = initial.id ? rows.symbols.find((s) => s.id === initial.id) : null
  const save = async () => {
    setError(null)
    const shortcode = String(draft.shortcode || '').trim().replace(/^\{|\}$/g, '')
    const fields = { id: draft.id, shortcode, rel_path: draft.rel_path, scale: Number(draft.scale), baseline_offset: Number(draft.baseline_offset) }
    if (original && shortcode !== original.shortcode) {
      const uses = symbolWhereUsed({ cards, documents, templates }, original.shortcode)
      if (usesCount(uses)) {
        setDialog({
          mode: 'rename', title: `Rename {${original.shortcode}} to {${shortcode}}`, what: `{${original.shortcode}}`, uses,
          onConfirm: async (everywhere) => {
            const s = useStore.getState()
            if (everywhere) await s.renameLibraryItem({ change: { kind: 'symbol', id: original.id, to: shortcode }, ...symbolRename(uses, templates, original.shortcode, shortcode) })
            await s.saveSymbol(fields)
            onDone(shortcode)
          },
        })
        return
      }
    }
    try {
      await useStore.getState().saveSymbol(fields)
      onDone(shortcode)
    } catch (e) { setError(e.message) }
  }
  const remove = () => {
    const uses = symbolWhereUsed({ cards, documents, templates }, original.shortcode)
    setDialog({
      mode: 'delete', title: `Delete {${original.shortcode}}`, what: `{${original.shortcode}}`, uses,
      onConfirm: async () => { await useStore.getState().deleteLibraryItem('symbol', original.id); onDone(null) },
    })
  }

  return (
    <div className="space-y-4" data-testid="symbol-editor" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); fromFile(e.dataTransfer.files[0]) }}>
      <div className="flex items-end gap-3">
        <label className="flex-1 space-y-1 text-xs text-text-muted">
          Shortcode (type it in card text as {'{'}{draft.shortcode || 'code'}{'}'})
          <input data-testid="symbol-code" className={`${input} font-mono`} value={draft.shortcode} placeholder="fire" onChange={(e) => set({ shortcode: e.target.value.trim().replace(/^\{|\}$/g, '') })} />
        </label>
        <div className="w-16 h-16 rounded-lg bg-surface-2 border border-border flex items-center justify-center overflow-hidden">
          {draft.rel_path ? <img src={assetUrl(projectId, draft.rel_path)} alt="" className="max-w-[56px] max-h-[56px]" /> : <ImagePlus size={20} className="text-text-muted" />}
        </div>
      </div>
      <div className="space-y-1">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={paste} data-testid="symbol-paste" className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-surface-2 hover:bg-surface-3 text-text-secondary"><ClipboardPaste size={13} /> Paste image</button>
          <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-surface-2 hover:bg-surface-3 text-text-secondary"><ImagePlus size={13} /> Choose file…</button>
          <input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.gif,.svg" className="hidden" data-testid="symbol-file" onChange={(e) => { fromFile(e.target.files[0]); e.target.value = '' }} />
          {icons.length > 0 && (
            <select data-testid="symbol-pick" className="px-2 py-1 text-xs rounded bg-surface-2 border border-border text-text-secondary" value="" onChange={(e) => { const a = icons.find((x) => x.rel_path === e.target.value); if (a) { set({ rel_path: a.rel_path, width: a.width, height: a.height }); setNote(null) } }}>
              <option value="">Or a file in assets/icons…</option>
              {icons.map((a) => <option key={a.rel_path} value={a.rel_path}>{a.rel_path.split('/').pop()}</option>)}
            </select>
          )}
          <button type="button" onClick={() => window.api.openProjectFolder(projectId, 'assets/icons')} className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-surface-2 text-text-muted"><FolderOpen size={13} /> Icons folder</button>
        </div>
        <p className="text-[11px] text-text-muted">PNG, JPEG, GIF or SVG (SVG stays crisp at any size). You can also drop a file here.</p>
        {note && <p className="text-[11px] text-text-secondary" data-testid="symbol-note">{note}</p>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1 text-xs text-text-muted">
          Size (× the text size)
          <input data-testid="symbol-scale" type="number" min={0.2} max={4} step={0.05} className={input} value={draft.scale} onChange={(e) => set({ scale: e.target.value })} />
        </label>
        <label className="space-y-1 text-xs text-text-muted">
          Baseline offset (em; negative moves it down)
          <input data-testid="symbol-offset" type="number" min={-2} max={2} step={0.02} className={input} value={draft.baseline_offset} onChange={(e) => set({ baseline_offset: e.target.value })} />
        </label>
      </div>
      {draft.rel_path && <SymbolPreview projectId={projectId} rows={rows} draft={{ ...draft, scale: Number(draft.scale) || 1, baseline_offset: Number(draft.baseline_offset) || 0 }} />}
      {error && <p className="text-xs text-danger" data-testid="symbol-error">{error}</p>}
      <div className="flex gap-2">
        <button onClick={save} data-testid="symbol-save" className="px-3 py-1.5 rounded bg-accent hover:brightness-110 text-sm text-white">Save</button>
        <button onClick={() => onDone(undefined)} className="px-3 py-1.5 rounded bg-surface-2 hover:bg-surface-3 text-sm text-text-secondary">Cancel</button>
        {original && <button onClick={remove} data-testid="symbol-delete" className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 rounded text-sm text-text-muted hover:text-danger hover:bg-surface-2"><Trash2 size={14} /> Delete</button>}
      </div>
      {dialog && <WhereUsedDialog {...dialog} onClose={() => setDialog(null)} />}
    </div>
  )
}

export default function SymbolsTab() {
  const projectId = useStore((s) => s.activeProjectId)
  const rows = useStore((s) => s.library)
  const cards = useStore((s) => s.cards)
  const [selected, setSelected] = useState(null) // symbol id, or 'new'
  const counts = useMemo(() => new Map(rows.symbols.map((s) => [s.shortcode, cardUses(cards, symbolMatcher(s.shortcode)).length])), [rows, cards])
  const editing = selected === 'new' ? blank() : rows.symbols.find((s) => s.id === selected) || null
  // Fixed while an item is open: the library reloads when a file lands in assets/icons (e.g. a
  // pasted image), and that must not reset what is being edited.
  const initial = useMemo(() => editing && { ...editing }, [selected]) // eslint-disable-line react-hooks/exhaustive-deps
  const done = (code) => {
    if (code === undefined) { setSelected(null); return }
    const s = useStore.getState().library.symbols.find((x) => x.shortcode === code)
    setSelected(s ? s.id : null)
  }
  return (
    <div className="h-full flex">
      <div className="flex-1 overflow-auto p-6">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3" data-testid="symbol-grid">
          {rows.symbols.map((s) => (
            <button
              key={s.id}
              data-symbol-tile={s.shortcode}
              onClick={() => setSelected(s.id)}
              className={`flex flex-col items-center gap-2 p-3 rounded-lg border ${selected === s.id ? 'border-accent bg-accent/10' : 'border-border bg-surface-1 hover:bg-surface-2'}`}
            >
              <img src={assetUrl(projectId, s.rel_path)} alt="" className="h-10 max-w-[80px] object-contain" />
              <span className="font-mono text-sm text-text-primary">{`{${s.shortcode}}`}</span>
              <span className="text-[10px] text-text-muted">{counts.get(s.shortcode) ? `${counts.get(s.shortcode)} card${counts.get(s.shortcode) === 1 ? '' : 's'}` : 'not used yet'}</span>
            </button>
          ))}
          <button data-testid="new-symbol" onClick={() => setSelected('new')} className="flex flex-col items-center justify-center gap-2 p-3 rounded-lg border border-dashed border-border text-text-muted hover:text-accent hover:border-accent min-h-[110px]">
            <Plus size={20} /> <span className="text-xs">New symbol</span>
          </button>
        </div>
        {!rows.symbols.length && (
          <p className="mt-6 max-w-lg text-sm text-text-muted">
            A symbol is a small image you type in card text with a shortcode in braces, like {'{fire}'} or {'{T}'}. It is drawn
            inline, sized to the text and sitting on the baseline, everywhere: the editor, the preview, exports and print sheets.
          </p>
        )}
      </div>
      {initial && (
        <aside className="w-[420px] flex-shrink-0 border-l border-border bg-surface-1 overflow-auto p-5">
          <h3 className="mb-4 text-sm font-semibold text-text-primary">{selected === 'new' ? 'New symbol' : `{${initial.shortcode}}`}</h3>
          <SymbolEditor key={selected} projectId={projectId} rows={rows} initial={initial} onDone={done} />
        </aside>
      )}
    </div>
  )
}
