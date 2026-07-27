Bilah tab. `variant="pill"` untuk tab di dalam panel; `variant="underline"` untuk tab header halaman (Settings, Access Control).

```jsx
<Tabs variant="underline" value={tab} onChange={setTab}
  tabs={['Users', 'Roles', 'Permissions']} />
<Tabs value={sub} onChange={setSub}
  tabs={[{value:'roster',label:'Roster Board'},{value:'swap',label:'Swap Requests',badge:2}]} />
```
