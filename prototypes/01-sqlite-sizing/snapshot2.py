import sqlite3, time, statistics, shutil, os, random
src="besar_90.db"; dst="besar_90_s2.db"
if os.path.exists(dst): os.remove(dst)
shutil.copy(src,dst)
db=sqlite3.connect(dst); db.execute("PRAGMA cache_size=-8000")
t=db.execute("SELECT tenant_id FROM item").fetchone()[0]
o=db.execute('SELECT outlet_id FROM "order"').fetchone()[0]
def bench(sql,p=(),n=10):
    r=[]
    for _ in range(n):
        s=time.perf_counter(); db.execute(sql,p).fetchall(); r.append((time.perf_counter()-s)*1000)
    return statistics.median(r)

q_agg="SELECT variation_id, SUM(delta) FROM stock_movement WHERE tenant_id=? AND outlet_id=? GROUP BY variation_id"
before=bench(q_agg,(t,o))

db.executescript("""
CREATE TABLE stock_snapshot (
  tenant_id TEXT NOT NULL, outlet_id TEXT NOT NULL, variation_id TEXT NOT NULL,
  balance INTEGER NOT NULL, checkpoint_hlc INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, outlet_id, variation_id)) WITHOUT ROWID;
CREATE INDEX ix_mv_hlc ON stock_movement(tenant_id, outlet_id, hlc);
""")
cp=db.execute("SELECT MAX(hlc) FROM stock_movement").fetchone()[0]
s=time.perf_counter()
db.execute("""INSERT INTO stock_snapshot SELECT tenant_id,outlet_id,variation_id,SUM(delta),?
              FROM stock_movement WHERE hlc<=? GROUP BY tenant_id,outlet_id,variation_id""",(cp,cp))
db.commit(); build=(time.perf_counter()-s)*1000

q_snap="""SELECT s.variation_id, s.balance + COALESCE(d.delta,0) FROM stock_snapshot s
LEFT JOIN (SELECT variation_id, SUM(delta) delta FROM stock_movement
           WHERE tenant_id=? AND outlet_id=? AND hlc>? GROUP BY variation_id) d
  ON d.variation_id=s.variation_id WHERE s.tenant_id=? AND s.outlet_id=?"""
a0=bench(q_snap,(t,o,cp,t,o))

random.seed(1)
vs=[r[0] for r in db.execute("SELECT variation_id FROM stock_snapshot LIMIT 500")]
for i in range(1382):
    db.execute("INSERT INTO stock_movement VALUES (?,?,?,?,?,'sale',?,NULL,NULL,NULL,NULL,NULL,'u1','2026-07-27T10:00:00Z',NULL,?)",
               (f"N{i:025d}",t,o,'d',random.choice(vs),-1000,cp+i+1))
db.commit()
a1=bench(q_snap,(t,o,cp,t,o))

print("SNAPSHOT + INDEX hlc — besar_90 (3.203 variation · 124.389 movement)")
print(f"  agregasi langsung                    : {before:7.1f} ms")
print(f"  snapshot, 0 movement sejak checkpoint: {a0:7.1f} ms   ({before/a0:5.1f}x lebih cepat)")
print(f"  snapshot, 1 hari (1.382 movement)    : {a1:7.1f} ms   ({before/a1:5.1f}x lebih cepat)")
print(f"  biaya rebuild snapshot               : {build:7.1f} ms")
print()
print("PROYEKSI pada tablet 5x lebih lambat:")
print(f"  agregasi langsung : {before*5:7.1f} ms   {'MELEWATI 200ms' if before*5>200 else 'ok'}")
print(f"  dengan snapshot   : {a1*5:7.1f} ms   {'MELEWATI 200ms' if a1*5>200 else 'ok'}")
db.close(); os.remove(dst)
