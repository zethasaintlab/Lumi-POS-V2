"""Isi skema dengan data sintetis realistis, ukur ukuran DB per jendela riwayat."""
import sqlite3, os, random, json, string, sys
from datetime import datetime, timedelta

random.seed(7)
ALPHA = string.ascii_uppercase + string.digits
def ulid(): return ''.join(random.choices(ALPHA, k=26))

KATEGORI = ["Kopi","Non-Kopi","Makanan Berat","Snack","Pastry","Minuman Botol"]
NAMA = ["Kopi Susu Gula Aren","Americano","Cappuccino","Latte","Matcha Latte","Chocolate",
        "Nasi Goreng Spesial","Mie Goreng","Croissant Butter","Pain au Chocolat",
        "Roti Bakar Cokelat","Kentang Goreng","Air Mineral","Teh Botol","Es Teh Manis"]

def buat_katalog(db, tenant, n_produk):
    cats = []
    for c in KATEGORI:
        cid = ulid(); cats.append(cid)
        db.execute("INSERT INTO category VALUES (?,?,?,?,?,?,?)", (cid,tenant,c,None,0,None,None))
    varis = []
    for i in range(n_produk):
        iid = ulid()
        nama = f"{random.choice(NAMA)} {i}"
        db.execute("INSERT INTO item VALUES (?,?,?,?,?,?,?,?)",
                   (iid,tenant,nama,random.choice(cats),None,None,i,None))
        # 60% produk punya 1 variation, 40% punya 2-3
        nv = 1 if random.random() < 0.6 else random.randint(2,3)
        for v in range(nv):
            vid = ulid(); varis.append((vid, nama, random.randrange(15000,85000,500)))
            db.execute("INSERT INTO item_variation VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                       (vid,iid,["Regular","Large","Small"][v],f"SKU-{i}-{v}",
                        f"899{i:06d}{v}",varis[-1][2],int(varis[-1][2]*0.35),
                        'pcs','pcs',1000,1,v,None))
    # modifier
    for m in range(8):
        mlid = ulid()
        db.execute("INSERT INTO modifier_list VALUES (?,?,?,?,?,?,?,?,?)",
                   (mlid,tenant,f"Pilihan {m}",'multi',0,3,0,0,None))
        for k in range(random.randint(3,6)):
            db.execute("INSERT INTO modifier VALUES (?,?,?,?,?,?,?)",
                       (ulid(),mlid,f"Opsi {k}",random.choice([0,3000,5000,8000]),0,k,None))
    db.execute("INSERT INTO tax_rate VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
               (ulid(),tenant,None,"PBJT 10%","pbjt",1000,0,'subtotal','3273','all','all_items',None,'2026-01-01',None))
    return varis

def isi_transaksi(db, tenant, outlet, device, varis, hari, order_per_hari):
    hlc = 0
    mulai = datetime(2026,7,27) - timedelta(days=hari)
    for d in range(hari):
        tgl = mulai + timedelta(days=d)
        bd = tgl.strftime("%Y-%m-%d")
        shift = ulid()
        db.execute("INSERT INTO cash_drawer_shift VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                   (shift,tenant,outlet,device,bd,'closed',500000,'u1',bd+"T07:00:00Z",
                    2450000,2485000,-35000,'[]','shortage',None,'u1','u2',bd+"T15:00:00Z"))
        db.execute("INSERT INTO cash_movement VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                   (ulid(),shift,'opening_float',500000,None,'bank',None,None,'u1',bd+"T07:00:00Z",None,hlc))
        for s in range(order_per_hari):
            hlc += 1
            oid = ulid(); cid = ulid()
            jam = 7 + (s * 10 // order_per_hari)
            ts = f"{bd}T{jam:02d}:{random.randint(0,59):02d}:00Z"
            nline = random.choices([1,2,3,4,5,6],[.22,.28,.22,.14,.09,.05])[0]
            sub = 0; lines = []
            for _ in range(nline):
                vid, nama, harga = random.choice(varis)
                qty = random.choices([1000,2000,3000],[.75,.2,.05])[0]
                mods = []
                if random.random() < 0.35:
                    for _ in range(random.randint(1,2)):
                        mods.append({"name":f"Opsi {random.randint(0,5)}","price":random.choice([3000,5000,8000]),"qty":1})
                mtot = sum(m["price"] for m in mods) * (qty//1000)
                lt = harga*(qty//1000) + mtot
                sub += lt
                lines.append((vid,nama,harga,qty,mods,lt))
            disc = int(sub*0.1) if random.random()<0.12 else 0
            base = sub - disc
            svc = 0
            taxb = base + svc
            tax = round(taxb*0.10)
            total = taxb + tax
            rnd = (-total) % 100
            due = total + rnd
            db.execute('INSERT INTO "order" VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                       (oid,tenant,outlet,device,shift,f"K1-{bd.replace('-','')}-{s+1:04d}",bd,s+1,
                        'closed','takeaway',None,sub,disc,svc,tax,rnd,total,due,0,None,'u1',ts,ts,hlc))
            db.execute('INSERT INTO "check" VALUES (?,?,?,?,?)', (cid,oid,None,sub,total))
            for (vid,nama,harga,qty,mods,lt) in lines:
                lid = ulid()
                db.execute("INSERT INTO order_line VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                           (lid,oid,cid,vid,nama,'Regular',harga,qty,
                            json.dumps(mods,separators=(',',':')) if mods else None,
                            0,None,1000,round(lt*0.10),0,int(harga*0.35),lt))
                for m in mods:
                    db.execute("INSERT INTO order_line_modifier VALUES (?,?,?,?,?,?)",
                               (ulid(),lid,None,m["name"],m["price"],1000))
                db.execute("INSERT INTO stock_movement VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                           (ulid(),tenant,outlet,device,vid,'sale',-qty,oid,None,None,None,None,'u1',ts,ts,hlc))
            met = random.choices(['cash','qris_dynamic','card_edc'],[.45,.42,.13])[0]
            db.execute("INSERT INTO payment VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                       (ulid(),oid,cid,met,due,due+5000 if met=='cash' else None,
                        5000 if met=='cash' else None,'confirmed',None,None,None,None,None,None,None,0,
                        None if met=='cash' else round(due*0.007),ts))
            if met=='cash':
                db.execute("INSERT INTO cash_movement VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                           (ulid(),shift,'sale',due,oid,'sales_revenue',None,None,'u1',ts,ts,hlc))
            # audit: hanya event yang benar-benar dicatat (bukan tiap penjualan)
            if random.random() < 0.06:
                db.execute("INSERT INTO audit_event VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                           (ulid(),tenant,outlet,device,'u1','u2','discount_applied','order',oid,
                            None,None,'promo',None,ts,ts,hlc))
        db.execute("INSERT INTO audit_event VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                   (ulid(),tenant,outlet,device,'u1',None,'shift_closed','shift',shift,
                    None,None,None,None,bd+"T15:00:00Z",None,hlc))

def bangun(nama, n_produk, order_per_hari, hari):
    path = f"/tmp/proto/{nama}.db"
    if os.path.exists(path): os.remove(path)
    db = sqlite3.connect(path)
    db.executescript(open("/tmp/proto/schema.sql").read())
    t,o,d = ulid(),ulid(),ulid()
    varis = buat_katalog(db, t, n_produk)
    isi_transaksi(db, t, o, d, varis, hari, order_per_hari)
    db.commit()
    db.execute("PRAGMA optimize"); db.execute("VACUUM"); db.commit()
    n_order = db.execute('SELECT COUNT(*) FROM "order"').fetchone()[0]
    n_line  = db.execute("SELECT COUNT(*) FROM order_line").fetchone()[0]
    n_mv    = db.execute("SELECT COUNT(*) FROM stock_movement").fetchone()[0]
    n_var   = db.execute("SELECT COUNT(*) FROM item_variation").fetchone()[0]
    db.close()
    size = os.path.getsize(path)
    return dict(nama=nama,path=path,mb=size/1048576,order=n_order,line=n_line,mv=n_mv,var=n_var,
                produk=n_produk,opd=order_per_hari,hari=hari)

if __name__ == "__main__":
    skenario = [
        ("kecil_30",   200,  150,  30),
        ("kecil_90",   200,  150,  90),
        ("kecil_180",  200,  150, 180),
        ("menengah_30",  800, 300,  30),
        ("menengah_90",  800, 300,  90),
        ("menengah_180", 800, 300, 180),
        ("besar_90",    2000, 500,  90),
        ("besar_180",   2000, 500, 180),
        ("ekstrem_90",  5000, 800,  90),
    ]
    print(f"{'skenario':<14}{'produk':>7}{'var':>7}{'ord/hr':>8}{'hari':>6}{'orders':>9}{'lines':>9}{'movements':>11}{'UKURAN':>10}")
    print("-"*82)
    hasil = []
    for s in skenario:
        r = bangun(*s); hasil.append(r)
        print(f"{r['nama']:<14}{r['produk']:>7}{r['var']:>7}{r['opd']:>8}{r['hari']:>6}"
              f"{r['order']:>9,}{r['line']:>9,}{r['mv']:>11,}{r['mb']:>9.1f}MB")
    import pickle; pickle.dump(hasil, open("/tmp/proto/hasil.pkl","wb"))
