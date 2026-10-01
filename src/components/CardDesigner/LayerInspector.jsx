import { useMemo, useRef } from 'react'
import { useStore } from '../../store'
import { findLayer, updateLayer, updateMeta, updateBackground, setTemplateProp } from './editor/templateOps'
import { Field, NumberField, TextField, SelectField, ColorField, Section } from './editor/fields'

// Card columns the renderer can bind (electron/cardDesigner/bind.js CARD_COLUMNS).
const CARD_FIELDS = ['name', 'type', 'set_name', 'rarity', 'cost', 'power', 'toughness', 'rules_text', 'flavor_text', 'tags', 'image_path', 'notes', 'id']

// Families available on a stock Windows install, plus generic fallbacks. Weight/style words
// ("Bold", "Italic", "Semibold") are appended to the family name, e.g. "Georgia Bold".
const FONT_SUGGESTIONS = [
  'Segoe UI', 'Segoe UI Semibold', 'Segoe UI Bold', 'Segoe UI Light', 'Segoe UI Italic',
  'Georgia', 'Georgia Bold', 'Georgia Italic', 'Cambria', 'Cambria Bold', 'Constantia', 'Constantia Bold',
  'Palatino Linotype', 'Palatino Linotype Bold', 'Book Antiqua', 'Times New Roman', 'Times New Roman Bold',
  'Arial', 'Arial Bold', 'Arial Black', 'Bahnschrift', 'Calibri', 'Calibri Bold', 'Candara', 'Corbel',
  'Trebuchet MS', 'Verdana', 'Tahoma', 'Impact', 'Consolas', 'Gabriola', 'Segoe Print', 'Segoe Script',
  'sans-serif', 'serif', 'monospace',
]

// Physical card sizes; pixel size follows the template's dpi.
const SIZE_PRESETS = [
  ['standard', 'Standard 63 × 88 mm', 63, 88],
  ['tarot', 'Tarot 70 × 120 mm', 70, 120],
  ['mini', 'Mini 44 × 63 mm', 44, 63],
  ['square', 'Square 70 × 70 mm', 70, 70],
]
const mmToPx = (mm, dpi) => Math.round((mm / 25.4) * dpi)

const ALIGN_9 = [
  ['left top', 'center top', 'right top'],
  ['left middle', 'center center', 'right middle'],
  ['left bottom', 'center bottom', 'right bottom'],
]

function useBindableFields() {
  const cards = useStore((s) => s.cards)
  return useMemo(() => {
    const custom = new Set()
    for (const c of cards) for (const k of Object.keys(c.custom_fields || {})) custom.add(k)
    return [...CARD_FIELDS, ...[...custom].filter((k) => !CARD_FIELDS.includes(k)).sort()]
  }, [cards])
}

function InsertField({ fields, onInsert }) {
  return (
    <select
      className="w-full px-2 py-1 bg-surface-2 border border-border rounded text-xs text-text-secondary focus:outline-none focus:border-accent"
      value=""
      onChange={(e) => { if (e.target.value) onInsert(`{{${e.target.value}}}`) }}
    >
      <option value="">Insert card field…</option>
      {fields.map((f) => <option key={f} value={f}>{`{{${f}}}`}</option>)}
    </select>
  )
}

function AlignGrid({ value, onChange }) {
  const current = String(value || 'center center').replace('center middle', 'center center')
  return (
    <div className="grid grid-cols-3 gap-0.5 w-16">
      {ALIGN_9.flat().map((a) => (
        <button
          key={a}
          type="button"
          title={a}
          onClick={() => onChange(a)}
          className={`h-4 rounded-sm ${current === a || (a === 'center center' && current === 'center middle') ? 'bg-accent' : 'bg-surface-3 hover:bg-surface-4'}`}
        />
      ))}
    </div>
  )
}

function TemplateSettings({ draft, edit }) {
  const { meta } = draft
  const bg = draft.background || {}
  const preset = SIZE_PRESETS.find(([, , w, h]) => mmToPx(w, meta.dpi) === meta.width && mmToPx(h, meta.dpi) === meta.height)
  const mm = (px) => ((px / meta.dpi) * 25.4).toFixed(1)
  const set = (key, mutator) => edit(mutator, { key: `template.${key}` })

  return (
    <>
      <Section title="Template">
        <TextField wide label="Name" value={meta.name} onChange={(v) => set('name', (t) => updateMeta(t, { name: v }))} />
        <SelectField
          wide
          label="Card size"
          value={preset ? preset[0] : 'custom'}
          options={[...SIZE_PRESETS.map(([k, label]) => [k, label]), ['custom', 'Custom']]}
          onChange={(k) => {
            const p = SIZE_PRESETS.find(([key]) => key === k)
            if (p) set('size', (t) => updateMeta(t, { width: mmToPx(p[2], meta.dpi), height: mmToPx(p[3], meta.dpi) }))
          }}
        />
        <NumberField label={`Width px (${mm(meta.width)} mm)`} value={meta.width} min={1} onChange={(v) => set('width', (t) => updateMeta(t, { width: v }))} />
        <NumberField label={`Height px (${mm(meta.height)} mm)`} value={meta.height} min={1} onChange={(v) => set('height', (t) => updateMeta(t, { height: v }))} />
        <NumberField label="DPI" value={meta.dpi} min={1} onChange={(v) => set('dpi', (t) => updateMeta(t, { dpi: v }))} />
        <NumberField label="Corner radius" value={draft.cornerRadius ?? 24} min={0} onChange={(v) => set('radius', (t) => setTemplateProp(t, 'cornerRadius', v))} />
        <p className="col-span-2 text-[10px] text-text-muted leading-snug">
          Positions are pixels at the template DPI. Changing size or DPI does not move layers.
        </p>
      </Section>
      <Section title="Background">
        <ColorField wide label="Colour" value={bg.color} onChange={(v) => set('bg.color', (t) => updateBackground(t, { color: v }))} />
        <TextField wide mono label="Image (asset path)" value={bg.image} placeholder="assets/background.png" onChange={(v) => set('bg.image', (t) => updateBackground(t, { image: v }))} />
        <SelectField label="Fit" value={bg.fit || 'cover'} options={['cover', 'contain', 'stretch', 'tile']} onChange={(v) => set('bg.fit', (t) => updateBackground(t, { fit: v }))} />
      </Section>
      <p className="px-4 py-3 text-[11px] text-text-muted">Select a layer on the card or in the list to edit it.</p>
    </>
  )
}

export default function LayerInspector() {
  const { draft, selectedLayerId, edit } = useStore()
  const fields = useBindableFields()
  const valueRef = useRef(null)
  if (!draft) return null
  const layer = selectedLayerId && findLayer(draft, selectedLayerId)
  if (!layer) return <div className="flex-1 overflow-y-auto"><TemplateSettings draft={draft} edit={edit} /></div>

  const id = layer.id
  const set = (prop, value) => edit((t) => updateLayer(t, id, { [prop]: value }), { key: `${id}.${prop}` })
  const isText = layer.type === 'text'
  const isImage = layer.type === 'image' || layer.type === 'icon'
  const isShape = layer.type === 'shape'

  const insertIntoValue = (token) => {
    const el = valueRef.current
    const current = String(layer.value ?? '')
    const at = el ? el.selectionStart ?? current.length : current.length
    edit((t) => updateLayer(t, id, { value: current.slice(0, at) + token + current.slice(at) }))
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <Section title={`${layer.type} layer`}>
        <Field wide label="Layer id">
          <span className="px-2 py-1 text-xs font-mono text-text-primary truncate" title="Double-click the layer in the list to rename">{id}</span>
        </Field>
        <NumberField label="X" value={layer.x} onChange={(v) => set('x', v)} />
        <NumberField label="Y" value={layer.y} onChange={(v) => set('y', v)} />
        <NumberField label="Width" value={layer.width} min={1} onChange={(v) => set('width', v)} />
        <NumberField label="Height" value={layer.height} min={1} onChange={(v) => set('height', v)} />
        <NumberField label="Opacity %" value={Math.round((layer.opacity ?? 1) * 100)} min={0} max={100} onChange={(v) => set('opacity', Math.max(0, Math.min(100, v)) / 100)} />
        <NumberField label="Corner radius" value={layer.cornerRadius ?? 0} min={0} onChange={(v) => set('cornerRadius', v)} />
      </Section>

      {isText && (
        <Section title="Text">
          <Field wide label="Value">
            <textarea
              ref={valueRef}
              rows={3}
              spellCheck={false}
              value={layer.value ?? ''}
              onChange={(e) => set('value', e.target.value)}
              className="w-full px-2 py-1 bg-surface-2 border border-border rounded text-xs text-text-primary font-mono resize-y focus:outline-none focus:border-accent"
            />
          </Field>
          <div className="col-span-2"><InsertField fields={fields} onInsert={insertIntoValue} /></div>
          <TextField wide label="Font" list="designer-fonts" value={layer.font} onChange={(v) => set('font', v)} />
          <datalist id="designer-fonts">{FONT_SUGGESTIONS.map((f) => <option key={f} value={f} />)}</datalist>
          <NumberField label="Size px" value={layer.fontSize ?? 16} min={1} onChange={(v) => set('fontSize', v)} />
          <ColorField label="Colour" value={layer.color} onChange={(v) => set('color', v)} />
          <SelectField label="Align" value={layer.align || 'left'} options={['left', 'center', 'right']} onChange={(v) => set('align', v)} />
          <SelectField label="Vertical" value={layer.valign || 'top'} options={['top', 'middle', 'bottom']} onChange={(v) => set('valign', v)} />
          <SelectField
            label="Overflow"
            value={layer.overflow || 'wrap'}
            options={[['shrink', 'Shrink to fit'], ['wrap', 'Wrap'], ['clip', 'Clip (one line)']]}
            onChange={(v) => set('overflow', v)}
          />
          <NumberField label="Line height" value={layer.lineHeight ?? 1.2} step={0.05} min={0.5} onChange={(v) => set('lineHeight', v)} />
          {layer.overflow === 'shrink' && (
            <NumberField
              wide
              label={`Min size px (default ${Math.round((6 * draft.meta.dpi) / 72)} = 6 pt)`}
              value={layer.minFontSize ?? ''}
              min={1}
              onChange={(v) => set('minFontSize', v)}
            />
          )}
        </Section>
      )}

      {isImage && (
        <Section title="Image">
          <TextField
            wide
            mono
            label="Source (card field or asset path)"
            list="designer-image-sources"
            value={layer.source}
            placeholder="{{image_path}}"
            onChange={(v) => set('source', v)}
          />
          <datalist id="designer-image-sources">
            {fields.map((f) => <option key={f} value={`{{${f}}}`} />)}
          </datalist>
          <SelectField label="Fit" value={layer.fit || 'cover'} options={['cover', 'contain', 'stretch', 'tile']} onChange={(v) => set('fit', v)} />
          <Field label="Anchor">
            <AlignGrid value={layer.align} onChange={(v) => set('align', v)} />
          </Field>
        </Section>
      )}

      {isShape && (
        <Section title="Shape">
          <SelectField wide label="Shape" value={layer.shape || 'rect'} options={['rect', 'circle', 'ellipse']} onChange={(v) => set('shape', v)} />
          <ColorField wide allowNone label="Fill" value={layer.fill} onChange={(v) => set('fill', v)} />
          <ColorField wide allowNone label="Stroke" value={layer.stroke} onChange={(v) => set('stroke', v)} />
          <NumberField label="Stroke width" value={layer.strokeWidth ?? 0} min={0} onChange={(v) => set('strokeWidth', v)} />
        </Section>
      )}
    </div>
  )
}

