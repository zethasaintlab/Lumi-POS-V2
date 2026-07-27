import React from 'react';

/* Bilah tab. Dua varian: 'pill' (berkotak, di dalam panel) dan
   'underline' (garis-bawah, untuk header halaman seperti Settings /
   Access Control). Tab aktif = aksen. */
export function Tabs({ tabs, value, onChange, variant = 'pill', ariaLabel }) {
  return (
    <div className={variant === 'underline' ? 'tabs tabs-underline' : 'tabs'} role="tablist" aria-label={ariaLabel}>
      {tabs.map((t) => {
        const val = typeof t === 'string' ? t : t.value;
        const lbl = typeof t === 'string' ? t : t.label;
        const badge = typeof t === 'object' ? t.badge : undefined;
        return (
          <button key={val} role="tab" aria-selected={value === val} onClick={() => onChange?.(val)}>
            {lbl}
            {badge != null && <span className="badge badge-accent" style={{ marginLeft: 'var(--space-2)' }}>{badge}</span>}
          </button>
        );
      })}
    </div>
  );
}
