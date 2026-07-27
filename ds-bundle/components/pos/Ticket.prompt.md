Tiket order di Kitchen Display, dirancang terbaca dari 2 meter di dalam kontainer `.kds-scale`. Fulfillment per item; status order diturunkan dari item.

```jsx
<div className="kds-scale">
  <Ticket code="A04" orderNo="ORD-0231" orderType="Dine In" waited="12m 04s" late
    items={[{qty:2,name:'Americano',note:'Extra shot'},{qty:1,name:'Butter Croissant'}]}
    status="queued" primaryLabel="Mulai Proses" onPrimary={start} />
</div>
```

`late` menambah border + badge peringatan. `doneCount` menampilkan "N dari M item selesai". `status`: queued / processing / ready.
