import { useEffect, useMemo, useRef, useState } from 'react'
import { FileSpreadsheet, Upload, X } from 'lucide-react'
import { useStore } from '../../store'
import CardRender, { cardPixelSize } from '../../designer/render/CardRender.tsx'
import { resolveTemplate, orderRules, describeResolution } from '../../designer/rules/resolveTemplate.ts'
import { useProjectFonts } from '../../designer/render/useProjectFonts.ts'
import { useParsedTemplates } from './CardPreviewPane'

// CSV/XLSX import (spec: "maps spreadsheet columns onto custom fields, with a preview before
// commit"). Choose a file → map each column → check the plan and a live render of any row →
// import in one transaction.

const FIELD_LABELS = {
  name: 'Name', type: 'Type', set_name: 'Set', rarity: 'Rarity', cost: 'Cost', power: 'Power', toughness: 'Toughness',
  rules_text: 'Rules text', flavor_text: 'Flavor text', tags: 'Tags', notes: 'Notes', image_path: 'Image path',
}
const ACTION_STYLE = {
  create: 'bg-emerald-600/20 text-emerald-400',
  update: 'bg-sky-600/20 text-sky-400',
  skip: 'bg-surface-3 text-text-muted',
}
const ipcMessage = (error) => String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const slug = (h) => String(h).normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase().replace(/^([0-9])/, 'f_$1').slice(0, 64)

function PlannedCardRender({ row, projectId }) {
  const cards = useStore((s) => s.cards)
  const rules = useStore((s) => s.templateRules)
  const assetVersions = useStore((s) => s.assetVersions)
  const templates = useParsedTemplates()
  const fonts = useProjectFonts(projectId)
  const card = useMemo(() => {
    if (!row) return null
    const base = row.cardId ? cards.find((c) => c.id === row.cardId) || {} : { id: `import-${row.line}` }
    return { ...base, ...row.data, custom_fields: row.data.custom_fields ?? base.custom_fields ?? {} }
  }, [row, cards])
  const ids = useMemo(() => [...templates.keys()], [templates])
  const res = useMemo(() => (card ? resolveTemplate(card, orderRules(rules), ids) : null), [card, rules, ids])
  const template = res?.templateId ? templates.get(res.templateId)?.template : null
  if (!card) return <p className="text-xs text-text-muted">Select a row to preview it.</p>
  if (!template) return <p className="text-xs text-text-muted">No template to preview with.</p>
  const pxPerMm = Math.min(260 / template.size.widthMm, 360 / template.size.heightMm)
  const size = cardPixelSize(template, pxPerMm, false)
  return (
    <div className="space-y-2" data-testid="import-render">
      <p className="text-[11px] text-text-muted">{describeResolution(res, (id) => templates.get(id)?.row.name || `#${id}`)}</p>
      {fonts.ready && (
        <div style={{ width: size.width, height: size.height }} className="shadow-xl">
          <CardRender template={template} card={card} projectId={projectId} pxPerMm={pxPerMm} assetVersions={assetVersions} />
        </div>
      )}
    </div>
  )
}

export default function ImportDialog({ onClose }) {
  const projectId = useStore((s) => s.activeProjectId)
  const [info, setInfo] = useState(null) // readSpreadsheet result
  const [mapping, setMapping] = useState([])
  const [options, setOptions] = useState({ matchBy: 'name', blankClears: false })
  const [plan, setPlan] = useState(null)
  const [selected, setSelected] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const fileRef = useRef(null)

  const open = async (opts) => {
    setError(null)
    setBusy(true)
    try {
      const r = await window.api.readSpreadsheet(projectId, opts)
      if (r?.canceled) return
      setInfo(r)
      setMapping(r.suggestedMapping)
      setPlan(null)
      setSelected(null)
    } catch (e) {
      setError(ipcMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const onFile = (file) => {
    if (!file) return
    let p
    try { p = window.api.pathForFile(file) } catch { p = null }
    if (!p) { setError('Could not read that file’s location.'); return }
    open({ inputPath: p })
  }

  // Re-plan whenever the mapping or options change.
  useEffect(() => {
    if (!info) return undefined
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const p = await window.api.previewImport(info.token, mapping, options)
        if (cancelled) return
        setPlan(p)
        setError(null)
        setSelected((s) => (s && p.rows.some((r) => r.line === s) ? s : p.rows.find((r) => r.action !== 'skip')?.line ?? null))
      } catch (e) {
        if (!cancelled) { setPlan(null); setError(ipcMessage(e)) }
      }
    }, 120)
    return () => { cancelled = true; clearTimeout(t) }
  }, [info, mapping, options])

  const commit = async () => {
    setBusy(true)
    try {
      const r = await window.api.commitImport(info.token, mapping, options)
      setResult(r)
      await useStore.getState().loadCards()
    } catch (e) {
      setError(ipcMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const targetOptions = (header, current) => {
    const opts = [['ignore', '— Ignore —'], ...Object.entries(FIELD_LABELS)]
    const custom = new Set(info.customFields)
    const own = slug(header)
    if (own) custom.add(own)
    if (current.startsWith('custom:')) custom.add(current.slice(7))
    return { builtin: opts, custom: [...custom].sort() }
  }

  const samples = (col) => info.sampleRows.map((r) => r[col]).filter((v) => v && v.trim()).slice(0, 3)
  const selectedRow = plan?.rows.find((r) => r.line === selected) || null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" data-testid="import-dialog">
      <div className="w-[1100px] max-w-[96vw] h-[88vh] flex flex-col bg-surface-1 border border-border rounded-xl shadow-2xl">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-border">
          <FileSpreadsheet size={18} className="text-accent" />
          <h2 className="text-base font-semibold text-text-primary flex-1">Import cards</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface-3 text-text-muted"><X size={18} /></button>
        </div>

        {!info && !result && (
          <div
            className="flex-1 flex flex-col items-center justify-center gap-4 m-5 border-2 border-dashed border-border rounded-xl"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files[0]) }}
          >
            <Upload size={32} className="text-text-muted" />
            <p className="text-sm text-text-secondary">Drop a .csv, .tsv or .xlsx file here, or</p>
            <button onClick={() => fileRef.current?.click()} disabled={busy} className="px-4 py-2 text-sm rounded bg-accent text-white hover:brightness-110" data-testid="import-choose">
              Choose file…
            </button>
            <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.xlsx,.xlsm" className="hidden" data-testid="import-file-input" onChange={(e) => onFile(e.target.files[0])} />
            <p className="text-xs text-text-muted max-w-md text-center">
              The first row should hold column names. Nothing is written until you press Import; you'll see what each row will do first.
            </p>
          </div>
        )}

        {info && !result && (
          <div className="flex-1 min-h-0 flex">
            {/* Mapping */}
            <div className="w-[420px] flex-shrink-0 flex flex-col border-r border-border min-h-0">
              <div className="px-4 py-3 border-b border-border space-y-2 text-xs">
                <p className="text-text-primary font-medium truncate" data-testid="import-file-name">{info.fileName} · {info.rowCount} rows</p>
                <div className="flex gap-3 items-center flex-wrap">
                  {info.sheets.length > 0 && (
                    <label className="flex items-center gap-1 text-text-muted">
                      Sheet
                      <select data-testid="import-sheet" className="px-2 py-1 bg-surface-2 border border-border rounded text-text-primary" value={info.sheet} onChange={(e) => open({ token: info.token, sheet: e.target.value })}>
                        {info.sheets.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </label>
                  )}
                  <label className="flex items-center gap-1 text-text-muted">
                    <input type="checkbox" checked={info.headerRow} onChange={(e) => open({ token: info.token, headerRow: e.target.checked })} className="accent-accent" data-testid="import-header-row" />
                    First row is column names
                  </label>
                </div>
                <div className="flex gap-3 items-center flex-wrap">
                  <select data-testid="import-match" className="px-2 py-1 bg-surface-2 border border-border rounded text-text-primary" value={options.matchBy} onChange={(e) => setOptions((o) => ({ ...o, matchBy: e.target.value }))}>
                    <option value="name">Update cards with the same name</option>
                    <option value="none">Always add new cards</option>
                  </select>
                  <label className="flex items-center gap-1 text-text-muted">
                    <input type="checkbox" checked={options.blankClears} onChange={(e) => setOptions((o) => ({ ...o, blankClears: e.target.checked }))} className="accent-accent" />
                    Blank cells clear fields
                  </label>
                </div>
              </div>
              <div className="flex-1 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-surface-1">
                    <tr className="text-text-muted text-left border-b border-border">
                      <th className="px-3 py-2 font-medium">Column</th>
                      <th className="px-3 py-2 font-medium">Imports as</th>
                    </tr>
                  </thead>
                  <tbody>
                    {info.headers.map((h, i) => {
                      const { builtin, custom } = targetOptions(h, mapping[i] || 'ignore')
                      return (
                        <tr key={i} className="border-b border-border align-top" data-map-row={i}>
                          <td className="px-3 py-2">
                            <div className="text-text-primary font-medium">{h}</div>
                            <div className="text-text-muted truncate max-w-[180px]" title={samples(i).join(' · ')}>{samples(i).join(' · ') || '(empty)'}</div>
                          </td>
                          <td className="px-3 py-2">
                            <select
                              data-testid={`import-map-${i}`}
                              className={`w-full px-2 py-1 bg-surface-2 border border-border rounded ${mapping[i] === 'ignore' ? 'text-text-muted' : 'text-text-primary'}`}
                              value={mapping[i] || 'ignore'}
                              onChange={(e) => setMapping((m) => m.map((t, j) => (j === i ? e.target.value : t)))}
                            >
                              {builtin.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                              <optgroup label="Custom fields">
                                {custom.map((k) => <option key={k} value={`custom:${k}`}>{k}{info.customFields.includes(k) ? '' : ' (new)'}</option>)}
                              </optgroup>
                            </select>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Plan */}
            <div className="flex-1 min-w-0 flex flex-col min-h-0">
              <div className="px-4 py-3 border-b border-border text-xs flex gap-4 items-center" data-testid="import-counts">
                {plan ? (
                  <>
                    <span className="text-emerald-400">{plan.counts.create} new</span>
                    <span className="text-sky-400">{plan.counts.update} updated</span>
                    <span className="text-text-muted">{plan.counts.skip} skipped</span>
                    {plan.counts.empty > 0 && <span className="text-text-muted">{plan.counts.empty} empty rows ignored</span>}
                  </>
                ) : <span className="text-text-muted">…</span>}
              </div>
              <div className="flex-1 min-h-0 flex">
                <div className="flex-1 overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-surface-1">
                      <tr className="text-text-muted text-left border-b border-border">
                        <th className="px-3 py-2 font-medium w-12">Row</th>
                        <th className="px-3 py-2 font-medium w-20">Action</th>
                        <th className="px-3 py-2 font-medium">Card</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan?.rows.map((r) => (
                        <tr
                          key={r.line}
                          data-plan-row={r.line}
                          onClick={() => setSelected(r.line)}
                          className={`border-b border-border cursor-pointer ${selected === r.line ? 'bg-accent/15' : 'hover:bg-surface-2'}`}
                        >
                          <td className="px-3 py-1.5 text-text-muted">{r.line}</td>
                          <td className="px-3 py-1.5"><span className={`px-2 py-0.5 rounded ${ACTION_STYLE[r.action]}`}>{r.action}</span></td>
                          <td className="px-3 py-1.5">
                            <span className="text-text-primary">{r.name || '—'}</span>
                            {r.problems.map((p) => <span key={p} className="ml-2 text-danger">⚠ {p}</span>)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {plan && plan.totalRows > plan.rows.length && <p className="px-3 py-2 text-xs text-text-muted">Showing the first {plan.rows.length} of {plan.totalRows} rows.</p>}
                </div>
                <div className="w-[300px] flex-shrink-0 border-l border-border p-4 overflow-auto bg-surface-0/40">
                  <PlannedCardRender row={selectedRow} projectId={projectId} />
                </div>
              </div>
            </div>
          </div>
        )}

        {result && (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-sm" data-testid="import-result">
            <p className="text-text-primary text-base">Import finished</p>
            <p className="text-emerald-400">{result.created} cards added</p>
            <p className="text-sky-400">{result.updated} cards updated</p>
            {result.skipped > 0 && <p className="text-text-muted">{result.skipped} rows skipped</p>}
          </div>
        )}

        <div className="flex items-center gap-2 px-5 py-3 border-t border-border">
          {error && <p className="text-xs text-danger flex-1" data-testid="import-error">{error}</p>}
          <div className="flex-1" />
          {info && !result && (
            <button onClick={() => { setInfo(null); setPlan(null) }} className="px-3 py-1.5 text-sm rounded bg-surface-2 hover:bg-surface-3 text-text-secondary">Choose another file</button>
          )}
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded bg-surface-2 hover:bg-surface-3 text-text-secondary">{result ? 'Close' : 'Cancel'}</button>
          {info && !result && (
            <button
              onClick={commit}
              disabled={busy || !plan || plan.counts.create + plan.counts.update === 0}
              data-testid="import-commit"
              className="px-3 py-1.5 text-sm rounded bg-accent text-white hover:brightness-110 disabled:opacity-40"
            >
              Import {plan ? plan.counts.create + plan.counts.update : ''} cards
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
