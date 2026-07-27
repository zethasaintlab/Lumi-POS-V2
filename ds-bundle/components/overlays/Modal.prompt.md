Modal umum untuk form & detail (New Customer, Add Table). Untuk void/refund/tutup kas pakai `ConfirmDialog`.

```jsx
<Modal title="New Customer" open={open} onClose={close}
  footer={<><Button variant="ghost" fullWidth onClick={close}>Cancel</Button><Button variant="primary" fullWidth>Create Customer</Button></>}>
  <Field label="Name" required placeholder="Customer name" />
  <div className="row" style={{gap:12}}><Field label="Phone" placeholder="08xxxxxxxx" /><Field label="Email" placeholder="email@example.com" /></div>
</Modal>
```
