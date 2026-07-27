"""Uji presisi tipe kuantitas: REAL vs INTEGER x1000.
Skenario nyata retail Indonesia: beras per kg, daging per ons, bumbu per gram."""
import sqlite3
from decimal import Decimal

db = sqlite3.connect(":memory:")
db.execute("CREATE TABLE t_real (id INTEGER PRIMARY KEY, qty REAL, price INTEGER)")
db.execute("CREATE TABLE t_int  (id INTEGER PRIMARY KEY, qty INTEGER, price INTEGER)")  # qty x1000

# Kasus uji: kuantitas yang benar-benar muncul di retail
kasus = [
    ("0.1 kg  @ Rp 15.000/kg", 0.1,   15000),
    ("0.25 kg @ Rp 15.000/kg", 0.25,  15000),
    ("0.3 kg  @ Rp 15.000/kg", 0.3,   15000),
    ("0.7 kg  @ Rp 89.000/kg", 0.7,   89000),
    ("1.15 kg @ Rp 67.500/kg", 1.15,  67500),
    ("2.35 kg @ Rp 12.300/kg", 2.35,  12300),
    ("0.005 kg (5 gram)      ", 0.005, 850000),
]

print(f"{'kasus':<26} {'REAL':>14} {'INT x1000':>14} {'exact':>14}  {'REAL ok':>8}")
print("-" * 84)

gagal_real = 0
for label, q, harga in kasus:
    # REAL
    db.execute("DELETE FROM t_real"); db.execute("DELETE FROM t_int")
    db.execute("INSERT INTO t_real VALUES (1, ?, ?)", (q, harga))
    db.execute("INSERT INTO t_int  VALUES (1, ?, ?)", (round(q * 1000), harga))

    r_real = db.execute("SELECT CAST(ROUND(qty * price) AS INTEGER) FROM t_real").fetchone()[0]
    r_int  = db.execute("SELECT CAST(ROUND(qty * price / 1000.0) AS INTEGER) FROM t_int").fetchone()[0]
    exact  = int((Decimal(str(q)) * Decimal(harga)).quantize(Decimal("1")))

    ok = "ya" if r_real == exact else "TIDAK"
    if r_real != exact:
        gagal_real += 1
    print(f"{label:<26} {r_real:>14,} {r_int:>14,} {exact:>14,}  {ok:>8}")

print()
# Uji akumulasi: 500 baris 0.1 kg -> seharusnya tepat 50 kg
db.execute("DELETE FROM t_real"); db.execute("DELETE FROM t_int")
for i in range(500):
    db.execute("INSERT INTO t_real VALUES (?, ?, ?)", (i, 0.1, 15000))
    db.execute("INSERT INTO t_int  VALUES (?, ?, ?)", (i, 100, 15000))

s_real = db.execute("SELECT SUM(qty) FROM t_real").fetchone()[0]
s_int  = db.execute("SELECT SUM(qty)/1000.0 FROM t_int").fetchone()[0]
print("AKUMULASI 500 x 0.1 kg (stok ledger — kasus paling relevan):")
print(f"  REAL      : {s_real!r}")
print(f"  INT x1000 : {s_int!r}")
print(f"  seharusnya: 50.0")
print(f"  REAL tepat: {'ya' if s_real == 50.0 else 'TIDAK — drift ' + repr(s_real - 50.0)}")
print()
print(f"RINGKASAN: {gagal_real}/{len(kasus)} kasus perkalian REAL menyimpang dari nilai eksak")
