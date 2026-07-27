import sqlite3, time, statistics, random
random.seed(3)

def bench(db, sql, params=(), n=12):
    t=[]
    for _ in range(n):
        s=time.perf_counter(); db.execute(sql, params).fetchall(); t.append((time.perf_counter()-s)*1000)
    return min(t), statistics.median(t), max(t)

for nama in ["kecil_90","menengah_90","besar_90"]:
    db=sqlite3.connect(nama+".db")
    db.execute("PRAGMA cache_size=-8000")   # 8 MB cache — konservatif untuk tablet
    nv=db.execute("SELECT COUNT(*) FROM item_variation").fetchone()[0]
    nm=db.execute("SELECT COUNT(*) FROM stock_movement").fetchone()[0]
    no=db.execute('SELECT COUNT(*) FROM "order"').fetchone()[0]
    t=db.execute("SELECT tenant_id FROM item").fetchone()[0]
    o=db.execute('SELECT outlet_id FROM "order"').fetchone()[0]
    print(f"\n=== {nama}  ({nv:,} variation · {nm:,} movement · {no:,} order) ===")

    q1="""SELECT variation_id, SUM(delta)/1000.0 FROM stock_movement
          WHERE tenant_id=? AND outlet_id=? GROUP BY variation_id"""
    a=bench(db,q1,(t,o)); print(f"  stok SELURUH katalog       min {a[0]:7.1f} med {a[1]:7.1f} max {a[2]:7.1f} ms   target <200")

    v=db.execute("SELECT id FROM item_variation LIMIT 1").fetchone()[0]
    q2="""SELECT SUM(delta)/1000.0 FROM stock_movement
          WHERE tenant_id=? AND outlet_id=? AND variation_id=?"""
    a=bench(db,q2,(t,o,v)); print(f"  stok SATU produk           min {a[0]:7.1f} med {a[1]:7.1f} max {a[2]:7.1f} ms")

    q3="SELECT i.id,i.name,v.price FROM item i JOIN item_variation v ON v.item_id=i.id WHERE i.name LIKE ? LIMIT 50"
    a=bench(db,q3,('%Latte%',)); print(f"  cari produk (LIKE)         min {a[0]:7.1f} med {a[1]:7.1f} max {a[2]:7.1f} ms   target <150")

    bc=db.execute("SELECT barcode FROM item_variation WHERE barcode IS NOT NULL LIMIT 1").fetchone()[0]
    a=bench(db,"SELECT * FROM item_variation WHERE barcode=?",(bc,))
    print(f"  scan barcode               min {a[0]:7.1f} med {a[1]:7.1f} max {a[2]:7.1f} ms")

    bd=db.execute('SELECT business_date FROM "order" ORDER BY business_date DESC LIMIT 1').fetchone()[0]
    q5="""SELECT COUNT(*), SUM(total), SUM(tax_amount) FROM "order"
          WHERE tenant_id=? AND outlet_id=? AND business_date=? AND status IN ('paid','closed','refunded')"""
    a=bench(db,q5,(t,o,bd)); print(f"  laporan harian             min {a[0]:7.1f} med {a[1]:7.1f} max {a[2]:7.1f} ms")

    q6="""SELECT ol.variation_id, ol.item_name, SUM(ol.quantity)/1000.0 q, SUM(ol.line_total) rev
          FROM order_line ol JOIN "order" o ON o.id=ol.order_id
          WHERE o.tenant_id=? AND o.outlet_id=? AND o.business_date>=?
          GROUP BY ol.variation_id ORDER BY rev DESC LIMIT 20"""
    d30=db.execute('SELECT MIN(business_date) FROM (SELECT DISTINCT business_date FROM "order" ORDER BY business_date DESC LIMIT 30)').fetchone()[0]
    a=bench(db,q6,(t,o,d30),n=6); print(f"  laporan produk 30 hari     min {a[0]:7.1f} med {a[1]:7.1f} max {a[2]:7.1f} ms")

    rn=db.execute('SELECT receipt_number FROM "order" ORDER BY RANDOM() LIMIT 1').fetchone()[0]
    a=bench(db,'SELECT * FROM "order" WHERE receipt_number=?',(rn,))
    print(f"  cari struk utk refund      min {a[0]:7.1f} med {a[1]:7.1f} max {a[2]:7.1f} ms")
    db.close()
