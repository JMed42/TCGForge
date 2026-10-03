import { useEffect, useState } from 'react'

// Small controlled inputs for the inspector. Each commits on every valid change; the store
// merges rapid edits of the same field into one undo step (see `edit(..., { key })`).

const inputClass =
  'w-full px-2 py-1 bg-surface-2 border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent'

export function Field({ label, children, wide = false }) {
  return (
    <label className={`flex flex-col gap-1 ${wide ? 'col-span-2' : ''}`}>
      <span className="text-[10px] uppercase tracking-wide text-text-muted">{label}</span>
      {children}
    </label>
  )
}

// Number input that tolerates intermediate text ("-", "1.") while typing.
export function NumberField({ label, value, onChange, step = 1, min, max, wide, testid }) {
  const [text, setText] = useState(value ?? '')
  useEffect(() => { setText(value ?? '') }, [value])
  return (
    <Field label={label} wide={wide}>
      <input
        type="number"
        data-testid={testid}
        className={inputClass}
        value={text}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          setText(e.target.value)
          if (e.target.value === '') return
          const n = Number(e.target.value)
          if (Number.isFinite(n)) onChange(n)
        }}
        onBlur={() => setText(value ?? '')}
      />
    </Field>
  )
}

export function TextField({ label, value, onChange, placeholder, list, wide, mono, testid }) {
  return (
    <Field label={label} wide={wide}>
      <input
        data-testid={testid}
        className={`${inputClass} ${mono ? 'font-mono' : ''}`}
        value={value ?? ''}
        placeholder={placeholder}
        list={list}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  )
}

export function SelectField({ label, value, onChange, options, wide, testid }) {
  return (
    <Field label={label} wide={wide}>
      <select data-testid={testid} className={inputClass} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => {
          const [v, text] = Array.isArray(o) ? o : [o, o]
          return <option key={v} value={v}>{text}</option>
        })}
      </select>
    </Field>
  )
}

// #rgb / #rrggbb for the native picker; other CSS colours are kept as typed.
function toPickerHex(value) {
  const v = String(value || '').trim()
  if (/^#[0-9a-f]{6}$/i.test(v)) return v
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`
  return '#000000'
}

export function ColorField({ label, value, onChange, allowNone = false, wide }) {
  const none = !value
  return (
    <Field label={label} wide={wide}>
      <div className="flex items-center gap-1">
        <input
          type="color"
          className="w-7 h-7 flex-none bg-transparent border border-border rounded cursor-pointer disabled:opacity-30"
          value={toPickerHex(value)}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          className={`${inputClass} font-mono`}
          value={value ?? ''}
          placeholder={allowNone ? 'none' : '#000000'}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
        {allowNone && !none && (
          <button type="button" title="No colour" className="text-[10px] text-text-muted hover:text-text-primary px-1" onClick={() => onChange('')}>
            ✕
          </button>
        )}
      </div>
    </Field>
  )
}

export function Section({ title, children, right }) {
  return (
    <div className="px-4 py-3 border-b border-border">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">{title}</h4>
        {right}
      </div>
      <div className="grid grid-cols-2 gap-2">{children}</div>
    </div>
  )
}
