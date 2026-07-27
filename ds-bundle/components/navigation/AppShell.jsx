import React from 'react';
import { Icon } from '../forms/Icon.jsx';
import { Avatar } from '../data/Avatar.jsx';

/* App shell admin: sidebar berkelompok + topbar breadcrumb + area konten.
   Nav diberikan konsumen (produk ini diturunkan dari alur kerja, bukan dari
   satu-menu-per-tabel). `nav` = daftar { group, items:[{id,label,icon}] }. */
export function AppShell({ brand, nav = [], active, onNavigate, user, breadcrumb, children }) {
  return (
    <div className="shell">
      <aside className="shell-side">
        <div className="shell-brand">
          {brand?.logo || <span style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--accent)', color: 'var(--on-accent)', display: 'grid', placeItems: 'center', fontWeight: 600, flex: 'none' }}>{(brand?.name || 'R')[0]}</span>}
          <span className="t-body-md truncate">{brand?.name || 'The Cafe by ORIGEN'}</span>
        </div>
        <nav className="shell-nav">
          {nav.map((grp) => (
            <div key={grp.group || 'top'}>
              {grp.group && <div className="shell-group">{grp.group}</div>}
              {grp.items.map((it) => (
                <button key={it.id} className="shell-link" aria-current={active === it.id ? 'page' : undefined} onClick={() => onNavigate?.(it.id)}>
                  {it.icon && <Icon name={it.icon} size={18} />}
                  <span className="truncate">{it.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="shell-user">
          <Avatar name={user?.name || 'User'} size={32} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="t-body-md truncate">{user?.name || 'User'}</div>
            {user?.role && <div className="t-caption truncate">{user.role}</div>}
          </div>
          <Icon name="chevron-down" size={16} />
        </div>
      </aside>
      <main className="shell-main">
        {breadcrumb && (
          <div className="shell-top">
            <Icon name="dashboard" size={14} />
            {(Array.isArray(breadcrumb) ? breadcrumb : [breadcrumb]).map((b, i, arr) => (
              <React.Fragment key={i}>
                <span style={i === arr.length - 1 ? { color: 'var(--ink)' } : undefined}>{b}</span>
                {i < arr.length - 1 && <Icon name="chevron-right" size={12} />}
              </React.Fragment>
            ))}
          </div>
        )}
        <div className="shell-body">{children}</div>
      </main>
    </div>
  );
}
