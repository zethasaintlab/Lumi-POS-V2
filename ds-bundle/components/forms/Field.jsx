import React from 'react';

/* Field teks dengan label + state error opsional. Tinggi minimum 44px
   (target sentuh). `size="lg"` = 56px, angka besar rata kanan — untuk
   input nominal uang (uang diterima, hitungan laci). `prefix` menaruh
   penanda "Rp" di dalam field tanpa mengganggu tabular-nums. */
export function Field({
  label,
  id,
  size = 'md',
  error,
  prefix,
  as = 'input',
  className = '',
  required = false,
  ...rest
}) {
  const multiline = as === 'textarea';
  const inputCls = [
    'field',
    size === 'lg' ? 'field-lg' : '',
    error ? 'field-invalid' : '',
    className,
  ].filter(Boolean).join(' ');
  const shared = {
    id,
    className: inputCls,
    'aria-invalid': error ? 'true' : undefined,
    'aria-describedby': error && id ? `${id}-err` : undefined,
    ...rest,
  };
  const input = multiline
    ? <textarea {...shared} style={{ minHeight: 80, padding: 'var(--space-3)', resize: 'vertical', lineHeight: 'var(--leading-body)', ...(rest.style || {}) }} />
    : <input {...shared} />;
  return (
    <div className="stack">
      {label && (
        <label className="label" htmlFor={id}>
          {label}{required && <span style={{ color: 'var(--danger)' }}> *</span>}
        </label>
      )}
      {prefix ? (
        <div style={{ position: 'relative' }}>
          <span style={{
            position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
            color: 'var(--ink-subtle)', fontSize: 'var(--text-title)',
          }}>{prefix}</span>
          {React.cloneElement(input, {
            style: { paddingLeft: 56, ...(rest.style || {}) },
          })}
        </div>
      ) : input}
      {error && <span className="field-error" id={id ? `${id}-err` : undefined}>{error}</span>}
    </div>
  );
}
