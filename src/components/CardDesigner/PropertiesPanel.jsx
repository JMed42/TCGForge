import { useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../../store'
import { isContainer } from '../../designer/schema/types.ts'
import { bindableFields } from '../../designer/expr/scope.ts'
import { bindingFields } from '../../cardModel/model'
import { anchorsOf, setAnchors, setUnits } from '../../designer/layout/frame.ts'
import { absoluteBox, findRef, parentBoxOf } from '../../designer/layout/tree.ts'
import { getLayer, setSize, updateLayer } from '../../designer/editor/ops.ts'
import { useProjectFonts } from '../../designer/render/useProjectFonts.ts'
import { Field, NumberField, TextField, SelectField, ColorField, Section } from './editor/fields'
import BindingInput from './BindingInput'
import { describeFit } from '../../designer/fit/summary.ts'
import { textIdsOf } from './WorstCase'
import { useLibrary } from '../../designer/library/LibraryContext.ts'

// The fit of the selected text (or of the text in the selected stack) on the sample card, from
// DesignerFitProbe: measured the same way as the Fit column.
function FitReadout({ layer, card }) {
  const designerFit = useStore((s) => s.designerFit)
  const ids = textIdsOf(layer)
  if (!ids.length || !designerFit || designerFit.cardId !== (card?.id ?? null)) return null
  const tone = { overflow: 'text-danger', shrunk: 'text-amber-400', hidden: 'text-text-muted', fits: 'text-success' }
  return (
    <div className="col-span-2 text-[11px] space-y-0.5" data-testid="fit-readout">
      <p className="text-text-muted">On {card ? <span className="text-text-secondary">{card.name}</span> : 'this preview'}:</p>
      {ids.map((id) => {
        const r = designerFit.results[id]
        return (
          <p key={id} className={r ? tone[r.status] : 'text-text-muted'} data-fit-readout={id}>
            {ids.length > 1 ? `${id}: ` : ''}{r ? describeFit(r) : 'not on this card (its condition hides it, or it has no text)'}
          </p>
        )
      })}
    </div>
  )
}

// Physical card sizes (spec open question: poker first).
const SIZE_PRESETS = [
  ['poker', 'Poker 63 × 88 mm', 63, 88],
  ['tarot', 'Tarot 70 × 120 mm', 70, 120],
  ['mini', 'Mini 44 × 63 mm', 44, 63],
  ['square', 'Square 70 × 70 mm', 70, 70],
]

const FONT_SUGGESTIONS = [
  'Segoe UI', 'Georgia', 'Cambria', 'Constantia', 'Palatino Linotype', 'Book Antiqua', 'Times New Roman',
  'Arial', 'Arial Black', 'Bahnschrift', 'Calibri', 'Candara', 'Corbel', 'Trebuchet MS', 'Verdana', 'Tahoma',
  'Impact', 'Consolas', 'Gabriola', 'Segoe Print', 'Segoe Script', 'sans-serif', 'serif', 'monospace',
]

const OBJECT_POSITIONS = [
  ['0% 0%', '50% 0%', '100% 0%'],
  ['0% 50%', '50% 50%', '100% 50%'],
  ['0% 100%', '50% 100%', '100% 100%'],
]

function AnchorPicker({ axis, value, onChange }) {
  const options = axis === 'h' ? [['left', 'Left'], ['right', 'Right'], ['stretch', 'Stretch']] : [['top', 'Top'], ['bottom', 'Bottom'], ['stretch', 'Stretch']]
  return (
    <div className="flex rounded overflow-hidden border border-border" data-testid={`anchor-${axis}`}>
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          data-anchor={v}
          onClick={() => onChange(v)}
          className={`flex-1 px-1 py-0.5 text-[11px] ${value === v ? 'bg-accent text-white' : 'bg-surface-2 text-text-secondary hover:bg-surface-3'}`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

// A frame length: number (mm) or "N%". Edited as a number in its current unit.
function LengthField({ label, value, onChange, testid }) {
  const pct = typeof value === 'string' && value.endsWith('%')
  const num = value === undefined ? '' : pct ? parseFloat(value) : value
  return (
    <div data-testid={testid}>
      <NumberField label={`${label} (${pct ? '%' : 'mm'})`} value={num} step={pct ? 1 : 0.5} onChange={(n) => onChange(pct ? `${n}%` : n)} />
    </div>
  )
}

function FrameSection({ draft, layer, edit }) {
  const parent = parentBoxOf(draft, layer.id)
  const ref = findRef(draft, layer.id)
  const parentLayer = ref?.parentId ? getLayer(draft, ref.parentId) : null
  if (!parent) {
    // Flow child of a stack: only the main-axis size can be set.
    const horizontal = parentLayer?.direction === 'horizontal'
    const key = horizontal ? 'width' : 'height'
    return (
      <Section title="Size in stack">
        <NumberField
          wide
          label={`${horizontal ? 'Width' : 'Height'} (mm, empty = fit content)`}
          value={layer.frame?.[key] ?? ''}
          step={0.5}
          onChange={(n) => edit((t) => updateLayer(t, layer.id, { frame: { [key]: n } }), { key: `${layer.id}.frame.${key}` })}
        />
        <p className="col-span-2 text-[10px] text-text-muted">Stack children flow in order; reorder them in the layer list.</p>
      </Section>
    )
  }
  const anchors = anchorsOf(layer.frame)
  const f = layer.frame || {}
  const pct = Object.values(f).some((v) => typeof v === 'string')
  const abs = absoluteBox(draft, layer.id)
  const set = (k, v) => edit((t) => updateLayer(t, layer.id, { frame: { ...(getLayer(t, layer.id).frame || {}), [k]: v } }), { key: `${layer.id}.frame.${k}` })
  const hKeys = anchors.h === 'stretch' ? ['left', 'right'] : anchors.h === 'right' ? ['right', 'width'] : ['left', 'width']
  const vKeys = anchors.v === 'stretch' ? ['top', 'bottom'] : anchors.v === 'bottom' ? ['bottom', 'height'] : ['top', 'height']
  const names = { left: 'Left', right: 'Right', width: 'Width', top: 'Top', bottom: 'Bottom', height: 'Height' }
  return (
    <Section
      title="Frame"
      right={(
        <div className="flex rounded overflow-hidden border border-border" data-testid="frame-units">
          {['mm', '%'].map((u) => (
            <button
              key={u}
              type="button"
              data-unit={u}
              onClick={() => edit((t) => updateLayer(t, layer.id, { frame: setUnits(getLayer(t, layer.id).frame, parent, u) }))}
              className={`px-1.5 text-[10px] ${(u === '%') === pct ? 'bg-accent text-white' : 'bg-surface-2 text-text-secondary'}`}
            >
              {u}
            </button>
          ))}
        </div>
      )}
    >
      <Field wide label="Horizontal anchor">
        <AnchorPicker axis="h" value={anchors.h} onChange={(h) => edit((t) => updateLayer(t, layer.id, { frame: setAnchors(getLayer(t, layer.id).frame, parent, { ...anchors, h }) }))} />
      </Field>
      {hKeys.map((k) => <LengthField key={k} label={names[k]} value={f[k]} onChange={(v) => set(k, v)} testid={`frame-${k}`} />)}
      <Field wide label="Vertical anchor">
        <AnchorPicker axis="v" value={anchors.v} onChange={(v) => edit((t) => updateLayer(t, layer.id, { frame: setAnchors(getLayer(t, layer.id).frame, parent, { ...anchors, v }) }))} />
      </Field>
      {vKeys.map((k) => <LengthField key={k} label={names[k]} value={f[k]} onChange={(v) => set(k, v)} testid={`frame-${k}`} />)}
      {abs && (
        <p className="col-span-2 text-[10px] text-text-muted tabular-nums" data-testid="frame-abs">
          On the card: x {abs.x.toFixed(2)} · y {abs.y.toFixed(2)} · {abs.w.toFixed(2)} × {abs.h.toFixed(2)} mm
        </p>
      )}
    </Section>
  )
}

function TemplateSettings({ draft, edit }) {
  const s = draft.size
  const preset = SIZE_PRESETS.find(([, , w, h]) => w === s.widthMm && h === s.heightMm)
  const setSz = (k, v) => edit((t) => setSize(t, { [k]: v }), { key: `size.${k}` })
  return (
    <>
      <Section title="Template">
        <TextField wide label="Name" value={draft.name || ''} onChange={(v) => edit((t) => ({ ...t, name: v }), { key: 'template.name' })} />
        <SelectField
          wide
          label="Card size"
          value={preset ? preset[0] : 'custom'}
          options={[...SIZE_PRESETS.map(([k, label]) => [k, label]), ['custom', 'Custom']]}
          onChange={(k) => {
            const p = SIZE_PRESETS.find(([key]) => key === k)
            if (p) edit((t) => setSize(t, { widthMm: p[2], heightMm: p[3] }))
          }}
        />
        <NumberField label="Width (mm)" value={s.widthMm} min={1} step={0.5} onChange={(v) => setSz('widthMm', v)} />
        <NumberField label="Height (mm)" value={s.heightMm} min={1} step={0.5} onChange={(v) => setSz('heightMm', v)} />
        <NumberField label="Bleed (mm)" value={s.bleedMm} min={0} step={0.5} onChange={(v) => setSz('bleedMm', v)} />
        <NumberField label="Safe zone (mm)" value={s.safeMm} min={0} step={0.5} onChange={(v) => setSz('safeMm', v)} />
        <NumberField label="Corner radius (mm)" value={s.cornerRadiusMm ?? 0} min={0} step={0.5} onChange={(v) => setSz('cornerRadiusMm', v)} />
        <p className="col-span-2 text-[10px] text-text-muted leading-snug">
          Changing the size reflows the layout: layers keep their distance from the edges they're anchored to, and stretched layers grow.
        </p>
      </Section>
      <p className="px-4 py-3 text-[11px] text-text-muted">Select a layer on the card or in the list to edit it.</p>
    </>
  )
}

// Put a fixed image (a frame, an icon) on an image layer: paste it or choose a file. The file is
// copied into the project's assets/images folder and the layer's source points at it.
function TemplateImageButtons({ projectId, layerId, onPath }) {
  const [note, setNote] = useState(null)
  const fileRef = useRef(null)
  const done = (res) => {
    if (res?.empty) { setNote('No image on the clipboard.'); return }
    if (res?.path) { onPath(res.path); setNote(null) }
  }
  const fail = (err) => setNote(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
  const paste = () => window.api.pasteImageFromClipboard(projectId, { folder: 'images', name: layerId }).then(done, fail)
  const onFile = (file) => {
    if (!file) return
    let p = null
    try { p = window.api.pathForFile(file) } catch { p = null }
    if (!p) { setNote('Could not read that file.'); return }
    window.api.importCardArt(projectId, p, { folder: 'images' }).then(done, fail)
  }
  return (
    <div className="col-span-2 space-y-1">
      <div className="flex gap-2">
        <button type="button" data-testid="layer-paste-image" onClick={paste} className="px-2 py-1 text-xs rounded bg-surface-2 hover:bg-surface-3 text-text-secondary">Paste image</button>
        <button type="button" onClick={() => fileRef.current?.click()} className="px-2 py-1 text-xs rounded bg-surface-2 hover:bg-surface-3 text-text-secondary">Choose image…</button>
        <input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.gif" className="hidden" data-testid="layer-image-file" onChange={(e) => { onFile(e.target.files[0]); e.target.value = '' }} />
      </div>
      <p className="text-[10px] text-text-muted">For frames and icons that are the same on every card. Card art uses a binding such as {'{{image_path}}'} instead.</p>
      {note && <p className="text-[10px] text-danger" data-testid="layer-image-note">{note}</p>}
    </div>
  )
}

export default function PropertiesPanel() {
  const { draft, selectedIds, edit, cards, previewCardId, activeProjectId, assetVersions, cardModel } = useStore(useShallow((s) => ({
    draft: s.draft, selectedIds: s.selectedIds, edit: s.edit, cards: s.cards, previewCardId: s.previewCardId,
    activeProjectId: s.activeProjectId, assetVersions: s.assetVersions, cardModel: s.cardModel,
  })))
  const fields = useMemo(() => (cardModel.fields.length ? bindingFields(cardModel) : bindableFields(cards)), [cardModel, cards])
  const fonts = useProjectFonts(activeProjectId, assetVersions)
  const library = useLibrary()
  const openLibrary = useStore((s) => s.openLibrary)
  const card = cards.find((c) => c.id === previewCardId) || null
  if (!draft) return null
  if (selectedIds.length > 1) {
    return (
      <div className="flex-1 overflow-y-auto px-4 py-3 text-xs text-text-secondary" data-testid="properties-panel">
        {selectedIds.length} layers selected. Use the canvas toolbar to align, distribute or group them.
      </div>
    )
  }
  const layer = selectedIds.length === 1 ? getLayer(draft, selectedIds[0]) : null
  if (!layer) return <div className="flex-1 overflow-y-auto" data-testid="properties-panel"><TemplateSettings draft={draft} edit={edit} /></div>

  const id = layer.id
  const set = (prop, value) => edit((t) => updateLayer(t, id, { [prop]: value }), { key: `${id}.${prop}` })
  const setIn = (group, prop, value) => edit((t) => {
    const cur = getLayer(t, id)[group] || {}
    const next = { ...cur, [prop]: value }
    if (value === '' || value === undefined) delete next[prop]
    return updateLayer(t, id, { [group]: next })
  }, { key: `${id}.${group}.${prop}` })
  const style = layer.style || {}
  const fit = layer.fit || {}
  const isText = layer.type === 'text' || layer.type === 'richText'
  const strategy = fit.strategy || []
  const toggleStrategy = (s) => setIn('fit', 'strategy', ['shrink', 'tightenLeading', 'hide'].filter((x) => (x === s ? !strategy.includes(s) : strategy.includes(x))))

  return (
    <div className="flex-1 overflow-y-auto" data-testid="properties-panel">
      <div className="px-4 pt-3 text-[11px] text-text-secondary">
        <span className="uppercase tracking-wide">{layer.type}</span> · <span className="font-mono text-text-primary">{id}</span>
      </div>

      <FrameSection draft={draft} layer={layer} edit={edit} />

      <Section title="Visibility">
        <Field wide label="Show when (visibleIf)">
          <BindingInput bare testid="visible-if" value={layer.visibleIf} onChange={(v) => set('visibleIf', v || undefined)} fields={fields} card={card} placeholder='e.g. card_type == "Unit"' />
        </Field>
        <NumberField label="Opacity %" value={Math.round((layer.opacity ?? 1) * 100)} min={0} max={100} onChange={(v) => set('opacity', Math.max(0, Math.min(100, v)) / 100)} />
        {findRef(draft, id)?.parentId && getLayer(draft, findRef(draft, id).parentId)?.type === 'stack' && (
          <>
            <NumberField label="Priority (stack)" value={layer.priority ?? ''} min={0} onChange={(v) => set('priority', v)} />
            <p className="col-span-2 text-[10px] text-text-muted leading-snug" data-testid="priority-help">
              When the stack is full, higher numbers give way first: e.g. flavor text 2, card text 1.
            </p>
          </>
        )}
      </Section>

      {isText && (
        <Section title={layer.type === 'richText' ? 'Rich text' : 'Text'}>
          <Field wide label={layer.type === 'richText' ? 'Text (**bold**, *italic*)' : 'Text'}>
            <BindingInput multiline symbols testid="text-value" value={layer.text} onChange={(v) => set('text', v)} fields={fields} card={card} />
          </Field>
          <TextField wide label="Font" list="designer-fonts" value={style.font} onChange={(v) => setIn('style', 'font', v)} />
          <datalist id="designer-fonts">
            {[...new Set([...fonts.fonts.map((f) => f.family), ...FONT_SUGGESTIONS])].map((f) => <option key={f} value={f} />)}
          </datalist>
          <NumberField label="Size (pt)" value={style.sizePt ?? 9} min={1} step={0.5} onChange={(v) => setIn('style', 'sizePt', v)} />
          <SelectField label="Weight" value={String(style.weight ?? 400)} options={[['300', 'Light'], ['400', 'Regular'], ['600', 'Semibold'], ['700', 'Bold'], ['900', 'Black']]} onChange={(v) => setIn('style', 'weight', Number(v))} />
          <ColorField label="Colour" value={style.color} onChange={(v) => setIn('style', 'color', v)} />
          <SelectField label="Italic" value={style.italic ? 'yes' : 'no'} options={[['no', 'No'], ['yes', 'Yes']]} onChange={(v) => setIn('style', 'italic', v === 'yes' || undefined)} />
          <SelectField label="Align" value={style.align || 'left'} options={['left', 'center', 'right']} onChange={(v) => setIn('style', 'align', v)} />
          <SelectField label="Vertical" value={style.valign || 'top'} options={['top', 'middle', 'bottom']} onChange={(v) => setIn('style', 'valign', v)} />
          <NumberField label="Line height" value={style.lineHeight ?? 1.2} step={0.05} min={0.5} onChange={(v) => setIn('style', 'lineHeight', v)} />
          <SelectField label="Wrap" value={style.wrap === false ? 'no' : 'yes'} options={[['yes', 'Wrap lines'], ['no', 'Single line']]} onChange={(v) => setIn('style', 'wrap', v === 'no' ? false : undefined)} />
          <Field wide label="Fit when it doesn't fit">
            <div className="flex gap-3 text-xs text-text-secondary" data-testid="fit-strategy">
              {[['shrink', 'Shrink'], ['tightenLeading', 'Tighten leading'], ['hide', 'Hide']].map(([s, label]) => (
                <label key={s} className="flex items-center gap-1">
                  <input type="checkbox" checked={strategy.includes(s)} onChange={() => toggleStrategy(s)} /> {label}
                </label>
              ))}
            </div>
          </Field>
          <NumberField label="Min size (pt)" value={fit.minPt ?? ''} min={1} step={0.5} onChange={(v) => setIn('fit', 'minPt', v)} />
          <NumberField label="Max size (pt)" value={fit.maxPt ?? ''} min={1} step={0.5} onChange={(v) => setIn('fit', 'maxPt', v)} />
          <p className="col-span-2 text-[10px] text-text-muted leading-snug" data-testid="fit-help">
            In this order: shrink down to the min size, tighten the line spacing, then hide. Text that still
            doesn't fit is flagged as overflow in the Cards screen's Fit column.
          </p>
          <Field wide label="Keywords">
            <span className="flex items-center gap-1.5 text-xs text-text-secondary normal-case" title="Keywords from the Library get their reminder text in this layer, on cards where reminder text is shown">
              <input type="checkbox" data-testid="layer-keywords" checked={Boolean(layer.keywords)} onChange={(e) => set('keywords', e.target.checked || undefined)} />
              Add reminder text after keywords{library.keywords.length ? ` (${library.keywords.length} in the Library)` : ''}
            </span>
          </Field>
          <FitReadout layer={layer} card={card} />
        </Section>
      )}

      {layer.type === 'image' && (
        <Section title="Image">
          <Field wide label="Source (asset path or binding)">
            <BindingInput testid="image-src" value={layer.src} onChange={(v) => set('src', v)} fields={fields} card={card} placeholder="{{image_path}} or assets/frames/ember.png" />
          </Field>
          <TemplateImageButtons projectId={activeProjectId} layerId={layer.id} onPath={(p) => set('src', p)} />
          <SelectField label="Fit" value={layer.objectFit || 'cover'} options={['cover', 'contain', 'fill', 'tile']} onChange={(v) => set('objectFit', v)} />
          <SelectField label="When missing" value={layer.placeholder || 'proxy'} options={[['proxy', 'Grey placeholder'], ['none', 'Nothing']]} onChange={(v) => set('placeholder', v)} />
          <Field label="Anchor">
            <div className="grid grid-cols-3 gap-0.5 w-16">
              {OBJECT_POSITIONS.flat().map((p) => (
                <button key={p} type="button" title={p} onClick={() => set('objectPosition', p)} className={`h-4 rounded-sm ${(layer.objectPosition || '50% 50%') === p ? 'bg-accent' : 'bg-surface-3 hover:bg-surface-4'}`} />
              ))}
            </div>
          </Field>
          <NumberField label="Corner radius (mm)" value={layer.radiusMm ?? 0} min={0} step={0.5} onChange={(v) => set('radiusMm', v)} />
        </Section>
      )}

      {layer.type === 'shape' && (
        <Section title="Shape">
          <SelectField wide label="Shape" value={layer.shape} options={[['rect', 'Rectangle'], ['roundRect', 'Rounded rectangle'], ['ellipse', 'Ellipse']]} onChange={(v) => set('shape', v)} />
          <ColorField wide allowNone label="Fill" value={layer.fill} onChange={(v) => set('fill', v || undefined)} />
          <ColorField wide allowNone label="Stroke" value={layer.stroke} onChange={(v) => set('stroke', v || undefined)} />
          <NumberField label="Stroke (mm)" value={layer.strokeMm ?? 0} min={0} step={0.1} onChange={(v) => set('strokeMm', v)} />
          {layer.shape === 'roundRect' && <NumberField label="Radius (mm)" value={layer.radiusMm ?? 0} min={0} step={0.5} onChange={(v) => set('radiusMm', v)} />}
        </Section>
      )}

      {layer.type === 'stack' && (
        <Section title="Stack">
          <div className="col-span-2 rounded bg-sky-500/10 border border-sky-500/30 px-2 py-1.5 text-[11px] leading-snug text-text-secondary" data-testid="stack-help">
            A stack places the layers inside it one after another, top to bottom (or left to right).
            Each one takes the height its text needs, so when a card's text is longer, everything
            below it moves down instead of overlapping. Typical use: card text with a flavor line
            under it. Add layers into the stack by selecting it and using <strong>Add</strong> in the Layers panel, or drag
            them onto it; their order in the list is their order on the card.
          </div>
          <SelectField label="Direction" value={layer.direction || 'vertical'} options={['vertical', 'horizontal']} onChange={(v) => set('direction', v)} />
          <NumberField label="Gap (mm)" value={layer.gapMm ?? 0} min={0} step={0.5} onChange={(v) => set('gapMm', v)} />
          <SelectField
            wide
            label="When the text doesn't fit"
            value={layer.fitOrder || 'shrinkFirst'}
            options={[['shrinkFirst', 'Shrink text first, then hide'], ['hideFirst', 'Hide first (highest priority number), then shrink']]}
            onChange={(v) => set('fitOrder', v === 'shrinkFirst' ? undefined : v)}
          />
          <p className="col-span-2 text-[10px] text-text-muted leading-snug">
            Text that sizes to its content shrinks to its min size, tightens its line spacing, and layers set to
            Hide drop out, highest priority number first. Each layer's own fit settings say what it may do.
          </p>
          <FitReadout layer={layer} card={card} />
        </Section>
      )}

      {layer.type === 'iconRepeat' && (
        <Section title="Icon repeat">
          <p className="col-span-2 text-[10px] text-text-muted leading-snug" data-testid="icon-repeat-help">
            Draws a Library symbol N times, e.g. one pip per point of cost. Each icon is as tall as the
            layer (as wide, top to bottom); when N don't fit, they move closer together.
          </p>
          <Field wide label="Count (expression)">
            <BindingInput bare testid="icon-count" value={layer.count} onChange={(v) => set('count', v)} fields={fields} card={card} placeholder="e.g. cost" />
          </Field>
          <TextField wide label="Icon (symbol shortcode, or a {{binding}})" list="designer-symbols" value={layer.icon} onChange={(v) => set('icon', v.trim().replace(/^\{([^{}]+)\}$/, '$1'))} testid="icon-symbol" />
          <datalist id="designer-symbols">
            {[...library.symbols.keys()].map((code) => <option key={code} value={code} />)}
          </datalist>
          <SelectField label="Direction" value={layer.direction || 'ltr'} options={[['ltr', 'Left to right'], ['rtl', 'Right to left'], ['ttb', 'Top to bottom'], ['btt', 'Bottom to top']]} onChange={(v) => set('direction', v)} testid="icon-direction" />
          <NumberField label="Gap (mm)" value={layer.gapMm ?? 0.5} min={0} step={0.25} onChange={(v) => set('gapMm', v)} testid="icon-gap" />
          <p className="col-span-2 text-[10px] text-text-muted leading-snug">
            {library.symbols.size ? `Symbols: ${[...library.symbols.keys()].join(', ')}. ` : 'No symbols yet. '}
            <button className="text-accent hover:underline" onClick={() => openLibrary('symbols')} data-testid="icon-manage">Manage symbols in the Library</button>
          </p>
        </Section>
      )}

      {isContainer(layer) && (
        <p className="px-4 py-2 text-[10px] text-text-muted">{layer.children.length} child layer(s). Double-click it on the canvas to edit inside.</p>
      )}
    </div>
  )
}
