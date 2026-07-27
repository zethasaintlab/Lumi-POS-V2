Toggle on/off untuk setelan modul. Track 44px. Selalu dampingi dengan label + deskripsi.

```jsx
<div className="row between">
  <div><div className="t-body-md">Enable Reservation Module</div><div className="t-caption">Izinkan tamu memesan meja di muka.</div></div>
  <Switch checked={on} onChange={setOn} ariaLabel="Enable Reservation Module" />
</div>
```
