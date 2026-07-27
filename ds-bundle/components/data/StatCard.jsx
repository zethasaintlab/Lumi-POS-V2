import React from 'react';
import { Icon } from '../forms/Icon.jsx';

/* Kartu statistik KPI. Garis-atas aksen menandai identitas modul (tone).
   Angka besar tabular. Delta opsional (naik=success, turun=danger). */
const TONE = {
  accent: 'var(--accent)', success: 'var(--success)', warning: 'var(--warning)',
  danger: 'var(--danger)', info: 'var(--info)', violet: 'var(--violet)', neutral: 'var(--border-strong)',
};
const SOFT = {
  accent: 'var(--accent-soft)', success: 'var(--success-soft)', warning: 'var(--warning-soft)',
  danger: 'var(--danger-soft)', info: 'var(--info-soft)', violet: 'var(--violet-soft)', neutral: 'var(--surface-alt)',
};

export function StatCard({ label, value, icon, tone = 'accent', delta, deltaDir, hint }) {
  return (
    <div className="stat" style={{ '--stat-accent': TONE[tone] }}>
      <div className="row between" style={{ marginBottom: 'var(--space-2)' }}>
        <span className="t-caption" style={{ textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</span>
        {icon && <span style={{ display: 'grid', placeItems: 'center', width: 28, height: 28, borderRadius: 8, background: SOFT[tone], color: TONE[tone] }}>{icon}</span>}
      </div>
      <div className="t-title-lg num">{value}</div>
      {delta != null && <div className="t-caption" style={{ marginTop: 2, color: deltaDir === 'down' ? 'var(--danger)' : 'var(--success)', fontWeight: 'var(--weight-medium)' }}>{deltaDir === 'down' ? '↓' : '↑'} {delta}</div>}
      {hint && <div className="t-caption" style={{ marginTop: 2 }}>{hint}</div>}
    </div>
  );
}
