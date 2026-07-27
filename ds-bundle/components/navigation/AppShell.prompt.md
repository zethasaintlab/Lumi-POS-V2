Kerangka layar admin: sidebar berkelompok (dengan ikon), topbar breadcrumb, area konten scroll. Nav diberikan konsumen sebagai daftar grup.

```jsx
<AppShell
  brand={{ name: 'The Cafe by ORIGEN' }}
  user={{ name: 'Super Admin User', role: 'Super Admin' }}
  active="dashboard" onNavigate={setActive} breadcrumb="Dashboard"
  nav={[
    { items: [{ id:'dashboard', label:'Dashboard', icon:'dashboard' }] },
    { group:'Operations', items:[{ id:'pos', label:'Open Register (POS)', icon:'register' }, { id:'kds', label:'Kitchen Display', icon:'chef' }] },
  ]}>
  {content}
</AppShell>
```

Link aktif memakai `aria-current="page"` (aksen-soft). Ikon dari set `Icon`.
