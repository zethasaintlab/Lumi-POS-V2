A loading placeholder shaped like the content it will become - a product-card skeleton is card-shaped, a QRIS skeleton is the QR code's grid. Never a generic circular spinner anywhere in LumiPOS.

```jsx
<SkeletonLoader shape="qr" />
<SkeletonLoader shape="card" count={4} />
```
