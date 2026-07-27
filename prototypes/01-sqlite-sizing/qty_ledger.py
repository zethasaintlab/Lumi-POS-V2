"""Kasus yang sebenarnya menentukan: stok sebagai SUM(delta) pada ledger besar."""
import sqlite3, random
random.seed(42)

db = sqlite3.connect(":memory:")
db.execute("CREATE TABLE mv_real (variation_id TEXT, delta REAL)")
db.execute("CREATE TABLE mv_int  (variation_id TEXT, delta INTEGER)")  # x1000

# Skenario: 1 produk beras, terima 1000 kg, lalu terjual habis dalam pecahan acak
terima = 1000.0
db.execute("INSERT INTO mv_real VALUES ('beras', ?)", (terima,))
db.execute("INSERT INTO mv_int  VALUES ('beras', ?)", (round(terima*1000),))

sisa = terima
n = 0
pecahan = [0.1,0.25,0.3,0.5,0.75,1.0,1.5,2.0,0.2,0.35]
while sisa > 0:
    q = min(random.choice(pecahan), sisa)
    db.execute("INSERT INTO mv_real VALUES ('beras', ?)", (-q,))
    db.execute("INSERT INTO mv_int  VALUES ('beras', ?)", (-round(q*1000),))
    sisa = round(sisa - q, 3)
    n += 1

s_real = db.execute("SELECT SUM(delta) FROM mv_real").fetchone()[0]
s_int  = db.execute("SELECT SUM(delta) FROM mv_int").fetchone()[0]

print(f"Skenario: terima 1000 kg, terjual habis dalam {n} transaksi pecahan")
print(f"  Stok akhir REAL      : {s_real!r}")
print(f"  Stok akhir INT x1000 : {s_int/1000!r}  (raw: {s_int})")
print()

print("UJI YANG MENENTUKAN — perbandingan kesetaraan:")
r1 = db.execute("SELECT COUNT(*) FROM (SELECT SUM(delta) s FROM mv_real) WHERE s = 0").fetchone()[0]
r2 = db.execute("SELECT COUNT(*) FROM (SELECT SUM(delta) s FROM mv_int)  WHERE s = 0").fetchone()[0]
print(f"  REAL      → 'WHERE stok = 0' cocok? {'YA' if r1 else 'TIDAK  ← query stok habis GAGAL'}")
print(f"  INT x1000 → 'WHERE stok = 0' cocok? {'YA' if r2 else 'TIDAK'}")
print()

print("UJI TAMPILAN — apa yang dilihat merchant:")
print(f"  REAL      : '{s_real} kg'")
print(f"  INT x1000 : '{s_int/1000} kg'")
print()

# Skala ledger besar: 500.000 movement (ambang snapshot di ERD)
print("SKALA LEDGER 500.000 movement (ambang snapshot di ERD):")
db2 = sqlite3.connect(":memory:")
db2.execute("CREATE TABLE m_real (delta REAL)")
db2.execute("CREATE TABLE m_int  (delta INTEGER)")
rows_r = [(0.1,)] * 500_000
rows_i = [(100,)] * 500_000
db2.executemany("INSERT INTO m_real VALUES (?)", rows_r)
db2.executemany("INSERT INTO m_int  VALUES (?)", rows_i)
a = db2.execute("SELECT SUM(delta) FROM m_real").fetchone()[0]
b = db2.execute("SELECT SUM(delta) FROM m_int").fetchone()[0]
print(f"  REAL      : {a!r}   (seharusnya 50000.0, drift {a-50000.0:+.3e})")
print(f"  INT x1000 : {b/1000!r}")
