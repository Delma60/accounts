// apps/accounts-ui/src/components/ui/field.tsx
import type { InputHTMLAttributes } from 'react'

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
  hint?: string
}

export function Field({ label, error, hint, id, ...inputProps }: FieldProps) {
  const inputId = id ?? label.toLowerCase().replace(/\s+/g, '-')

  return (
    <div className="field">
      <label htmlFor={inputId} className="field-label">
        {label}
      </label>
      {hint && <p className="field-hint">{hint}</p>}
      <input
        id={inputId}
        className={`field-input${error ? ' field-input--error' : ''}`}
        aria-invalid={!!error}
        aria-describedby={error ? `${inputId}-error` : undefined}
        {...inputProps}
      />
      {error && (
        <p id={`${inputId}-error`} className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}