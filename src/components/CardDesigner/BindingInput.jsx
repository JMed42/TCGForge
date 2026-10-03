import { useMemo, useRef } from 'react'
import { interpolate, condition, FUNCTION_NAMES } from '../../designer/expr/expr.ts'
import { cardScope } from '../../designer/expr/scope.ts'
import { useLibrary } from '../../designer/library/LibraryContext.ts'

const inputClass =
  'w-full px-2 py-1 bg-surface-2 border border-border rounded text-xs text-text-primary font-mono focus:outline-none focus:border-accent'

const FUNCTION_SNIPPETS = {
  if: 'if(cond, a, b)', upper: 'upper(x)', lower: 'lower(x)', trim: 'trim(x)', len: 'len(x)', concat: 'concat(a, b)',
  contains: 'contains(text, "word")', replace: 'replace(text, "a", "b")', round: 'round(x, 1)', floor: 'floor(x)', ceil: 'ceil(x)',
  min: 'min(a, b)', max: 'max(a, b)', number: 'number(x)', string: 'string(x)', default: 'default(x, "—")',
}

/**
 * A string property with {{expression}} bindings (or, with `bare`, a bare expression such as
 * visibleIf). The picker inserts project fields and whitelisted functions at the caret; the line
 * below shows the result for the current sample card, or the error.
 */
export default function BindingInput({ value, onChange, fields, card, multiline = false, bare = false, placeholder, testid }) {
  const ref = useRef(null)
  const library = useLibrary()
  const scope = useMemo(() => cardScope(card, library.variables), [card, library])
  const variables = Object.keys(library.variables)
  const preview = useMemo(() => {
    const v = value ?? ''
    if (bare) {
      if (!v.trim()) return { text: 'always', ok: true }
      const r = condition(v, scope)
      return r.error ? { text: r.error, ok: false } : { text: r.value ? 'true — shown for this card' : 'false — hidden for this card', ok: true }
    }
    if (!v.includes('{{')) return null
    const r = interpolate(v, scope)
    return r.errors.length ? { text: r.errors[0], ok: false } : { text: r.text === '' ? '(empty)' : r.text, ok: true }
  }, [value, scope, bare])

  const insert = (token) => {
    const el = ref.current
    const v = value ?? ''
    const start = el?.selectionStart ?? v.length
    const end = el?.selectionEnd ?? v.length
    const piece = bare ? token : `{{${token}}}`
    onChange(v.slice(0, start) + piece + v.slice(end))
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      const caret = start + piece.length
      el.setSelectionRange(caret, caret)
    })
  }

  const Input = multiline ? 'textarea' : 'input'
  return (
    <div className="space-y-1">
      <Input
        ref={ref}
        data-testid={testid}
        rows={multiline ? 3 : undefined}
        className={`${inputClass} ${multiline ? 'resize-y' : ''}`}
        value={value ?? ''}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
      <select
        className="w-full px-2 py-1 bg-surface-2 border border-border rounded text-[11px] text-text-secondary focus:outline-none focus:border-accent"
        value=""
        onChange={(e) => { if (e.target.value) insert(e.target.value) }}
        data-testid={testid ? `${testid}-picker` : undefined}
      >
        <option value="">{bare ? 'Insert field or function…' : 'Insert binding…'}</option>
        <optgroup label="Card fields">
          {fields.map((f) => {
            const key = typeof f === 'string' ? f : f.key
            const label = typeof f === 'string' ? '' : f.label
            const token = bare ? key : `{{${key}}}`
            return <option key={key} value={key}>{label && label !== key ? `${label}  ${token}` : token}</option>
          })}
        </optgroup>
        {variables.length > 0 && (
          <optgroup label="Variables (Library)">
            {variables.map((key) => <option key={key} value={key}>{bare ? key : `{{${key}}}`}  = {library.variables[key]}</option>)}
          </optgroup>
        )}
        <optgroup label="Functions">
          {FUNCTION_NAMES.map((fn) => <option key={fn} value={FUNCTION_SNIPPETS[fn] || `${fn}()`}>{FUNCTION_SNIPPETS[fn] || `${fn}()`}</option>)}
        </optgroup>
      </select>
      {preview && (
        <p className={`text-[10px] truncate ${preview.ok ? 'text-text-muted' : 'text-danger'}`} title={preview.text} data-testid={testid ? `${testid}-preview` : undefined}>
          {preview.ok ? '→ ' : '⚠ '}{preview.text}
        </p>
      )}
    </div>
  )
}
