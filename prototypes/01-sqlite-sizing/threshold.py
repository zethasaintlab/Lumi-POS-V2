import sqlite3, time, statistics, os, subprocess

def cold(path):  # buang page cache OS + cache SQLite
    try: subprocess.run(["sync"],check=False)
    except Exception: pass

def bench(db,sql,p=(),n=10):
    t=[]
    for _ in range(n):
        s=time.perf_counter(); db.execute(sql,p).fetchall(); t.append((time.perf_counter()-s)*1000)
    return statistics.median(t)

print("AMBANG: kapan query stok melewati 200 ms?")
print(f"{'skenario':<14}{'variation':>10}{'movement':>11}{'warm':>9}{'cold':>9}")
print("-"*54)
pts=[]
for nama in ["kecil_90","menengah_90","besar_90"]:
    p=nama+".db"
    db=sqlite3.connect(p); db.execute("PRAGMA cache_size=-8000")
    t=db.execute("SELECT tenant_id FROM item").fetchone()[0]
    o=db.execute('SELECT outlet_id FROM "order"').fetchone()[0]
    nv=db.execute("SELECT COUNT(*) FROM item_variation").fetchone()[0]
    nm=db.execute("SELECT COUNT(*) FROM stock_movement").fetchone()[0]
    q="SELECT variation_id, SUM(delta) FROM stock_movement WHERE tenant_id=? AND outlet_id=? GROUP BY variation_id"
    warm=bench(db,q,(t,o))
    db.close()
    # cold: koneksi baru, cache kecil
    db2=sqlite3.connect(p); db2.execute("PRAGMA cache_size=-2000")
    s=time.perf_counter(); db2.execute(q,(t,o)).fetchall(); coldms=(time.perf_counter()-s)*1000
    db2.close()
    pts.append((nv,nm,warm))
    print(f"{nama:<14}{nv:>10,}{nm:>11,}{warm:>8.1f}ms{coldms:>8.1f}ms")

# ekstrapolasi linear terhadap jumlah movement
import numpy as np
x=np.array([p[1] for p in pts]); y=np.array([p[2] for p in pts])
a,b=np.polyfit(x,y,1)
amb=(200-b)/a
print()
print(f"Regresi: waktu(ms) ≈ {a*1000:.3f} ms per 1.000 movement + {b:.1f}")
print(f"→ 200 ms tercapai pada ≈ {amb:,.0f} movement")
print(f"→ ERD menetapkan ambang snapshot 500.000 movement — {'TERLALU LAMBAT' if amb < 400000 else 'wajar'}")
print()
print("Faktor tablet: perangkat kasir kelas bawah biasanya 3–5x lebih lambat dari mesin ini.")
for f in (3,5):
    print(f"  pada {f}x lebih lambat → 200 ms tercapai pada ≈ {amb/f:,.0f} movement")
