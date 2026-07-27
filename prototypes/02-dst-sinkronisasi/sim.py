"""
Deterministic Simulation Testing — lapisan sinkronisasi Lumi POS.

Memodelkan protokol dari /product/specs/spec-h-sinkronisasi.md:
  - outbox_local persisten dengan idempotency key di-generate SAAT ITEM DIBUAT
  - server dedup lewat tabel idempotency_key (kembalikan respons asli)
  - transaksi append-only, ID client-generated
  - nomor struk K{device}-{tanggal}-{urutan}, counter lokal

Seluruh keacakan dikendalikan satu seed. Bug yang ditemukan dapat direproduksi persis.
"""
from dataclasses import dataclass, field
from typing import Optional
import random, json, hashlib

# ---------------------------------------------------------------- konfigurasi bug
class Bug:
    """Mode cacat yang dapat dinyalakan untuk membuktikan harness mendeteksinya."""
    NONE                  = "none"
    REGEN_IDEM_ON_RETRY   = "regen_idem_on_retry"    # klien buat key baru tiap retry
    SERVER_IDEM_AFTER_TX  = "server_idem_after_tx"   # key ditulis di transaksi terpisah
    SEQ_FROM_SERVER       = "seq_from_server"        # nomor struk diminta ke server
    OUTBOX_IN_MEMORY      = "outbox_in_memory"       # antrean hilang saat crash
    VOID_AS_UPDATE        = "void_as_update"         # void mengubah order, bukan append (langgar KEP-17)

@dataclass
class Order:
    id: str
    device: str
    business_date: str
    sequence: int
    receipt: str
    total: int
    idem: str

# ---------------------------------------------------------------- server
class Server:
    def __init__(self, bug, rnd):
        self.orders: dict[str, Order] = {}
        self.idem: dict[str, str] = {}         # key -> order_id
        self.idem_hash: dict[str, str] = {}    # key -> request hash
        self.bug = bug
        self.rnd = rnd
        self.seq_counter: dict[tuple, int] = {}
        self.rejected_422 = 0
        self.dupe_writes = 0
        self.first_write: dict[str, tuple] = {}   # oid -> snapshot pertama
        self.mutations = 0
        self.idem_per_order: dict[str, set] = {}  # oid -> {idem keys}
        self.writes = 0
        self.voided = set()

    def next_seq(self, device, bd):
        k = (device, bd)
        self.seq_counter[k] = self.seq_counter.get(k, 0) + 1
        return self.seq_counter[k]

    def void(self, oid: str, bug):
        o = self.orders.get(oid)
        if not o: return
        if bug == Bug.VOID_AS_UPDATE:
            # CACAT: mengubah record yang seharusnya immutable
            self.orders[oid] = Order(o.id, o.device, o.business_date, o.sequence,
                                     o.receipt, 0, o.idem)
            snap = (o.device, o.business_date, o.sequence, o.receipt, 0)
            if self.first_write.get(oid) != snap:
                self.mutations += 1
        else:
            # BENAR: append record void terpisah; asli tidak disentuh
            vid = oid + "-V"
            if vid not in self.orders:
                self.orders[vid] = Order(vid, o.device, o.business_date, o.sequence,
                                         o.receipt + "-VOID", -o.total, o.idem + "-V")
                self.voided.add(oid)

    def upload(self, payload: dict) -> dict:
        idem = payload["idem"]
        h = hashlib.sha256(json.dumps(
            {k: v for k, v in payload.items() if k != "idem"}, sort_keys=True
        ).encode()).hexdigest()[:12]

        # --- cek idempotency ---
        if idem in self.idem:
            if self.idem_hash[idem] != h:
                self.rejected_422 += 1
                return {"status": 422, "error": "idempotency key reuse with different body"}
            return {"status": 200, "order_id": self.idem[idem], "replayed": True}

        oid = payload["id"]
        if oid in self.orders:
            # ID sudah ada tapi key belum tercatat -> jaring pengaman constraint DB
            if self.bug == Bug.VOID_AS_UPDATE:
                # cacat nyata: server menimpa record yang seharusnya append-only
                o2 = Order(id=oid, device=payload["device"],
                    business_date=payload["business_date"], sequence=payload["sequence"],
                    receipt=payload["receipt"], total=payload["total"] + 1, idem=idem)
                self.orders[oid] = o2
                snap2 = (o2.device, o2.business_date, o2.sequence, o2.receipt, o2.total)
                if self.first_write.get(oid) != snap2:
                    self.mutations += 1
                self.dupe_writes += 1
                self.idem[idem] = oid; self.idem_hash[idem] = h
                return {"status": 200, "order_id": oid, "replayed": True}
            else:
                self.idem[idem] = oid; self.idem_hash[idem] = h
                self.idem_per_order.setdefault(oid, set()).add(idem)
                return {"status": 200, "order_id": oid, "replayed": True}

        o = Order(id=oid, device=payload["device"], business_date=payload["business_date"],
                  sequence=payload["sequence"], receipt=payload["receipt"],
                  total=payload["total"], idem=idem)
        self.orders[oid] = o
        self.writes += 1
        snap = (o.device, o.business_date, o.sequence, o.receipt, o.total)
        if oid in self.first_write:
            if self.first_write[oid] != snap:
                self.mutations += 1
        else:
            self.first_write[oid] = snap

        if self.bug == Bug.SERVER_IDEM_AFTER_TX:
            # transaksi terpisah: bisa gagal setelah order tertulis
            if self.rnd.random() < 0.30:
                return {"status": 500, "error": "crash setelah order, sebelum idem key"}
        self.idem[idem] = oid; self.idem_hash[idem] = h
        self.idem_per_order.setdefault(oid, set()).add(idem)
        return {"status": 200, "order_id": oid, "replayed": False}

# ---------------------------------------------------------------- perangkat
@dataclass
class OutboxItem:
    entity_id: str
    payload: dict
    idem: str
    attempts: int = 0
    sent: bool = False

class Device:
    def __init__(self, code, server, bug, rnd):
        self.code = code
        self.server = server
        self.bug = bug
        self.rnd = rnd
        self.online = True
        self.outbox: list[OutboxItem] = []
        self.local_orders: dict[str, Order] = {}
        self.seq: dict[str, int] = {}
        self.uid = 0
        self.attempted = 0
        self.blocked_offline = 0
        self.voided_local = set()

    def _ulid(self):
        self.uid += 1
        return f"{self.code}-{self.uid:08d}"

    def make_sale(self, bd: str, total: int):
        self.attempted += 1
        if self.bug == Bug.SEQ_FROM_SERVER:
            if not self.online:
                self.blocked_offline += 1
                return None                      # cacat: tidak bisa jualan offline
            s = self.server.next_seq(self.code, bd)
        else:
            self.seq[bd] = self.seq.get(bd, 0) + 1
            s = self.seq[bd]
        oid = self._ulid()
        receipt = f"{self.code}-{bd.replace('-','')}-{s:04d}"
        o = Order(oid, self.code, bd, s, receipt, total, idem=self._ulid()+"-I")
        self.local_orders[oid] = o
        payload = dict(id=oid, device=self.code, business_date=bd, sequence=s,
                       receipt=receipt, total=total, idem=o.idem)
        self.outbox.append(OutboxItem(oid, payload, o.idem))
        return o

    def crash(self):
        """Aplikasi mati. Outbox persisten bertahan; in-memory hilang."""
        if self.bug == Bug.OUTBOX_IN_MEMORY:
            self.outbox = [i for i in self.outbox if i.sent]

    def flush(self, net):
        if not self.online:
            return
        for item in list(self.outbox):
            if item.sent:
                continue
            item.attempts += 1
            if self.bug == Bug.REGEN_IDEM_ON_RETRY and item.attempts > 1:
                item.idem = self._ulid()+"-I"
                item.payload = {**item.payload, "idem": item.idem}
            res = net.send(self.server, item.payload)
            if res is None:                       # respons hilang
                continue
            if res["status"] == 200:
                item.sent = True
            elif res["status"] == 422:
                item.sent = True                  # ditolak permanen; jangan retry selamanya

# ---------------------------------------------------------------- jaringan
class Network:
    def __init__(self, rnd, p_drop_req, p_drop_res, p_dup):
        self.rnd = rnd; self.pdq = p_drop_req; self.pds = p_drop_res; self.pdup = p_dup

    def send(self, server, payload):
        if self.rnd.random() < self.pdq:
            return None                            # request tidak sampai
        res = server.upload(payload)
        if self.rnd.random() < self.pdup:
            server.upload(payload)                 # duplikat sampai ke server
        if self.rnd.random() < self.pds:
            return None                            # server proses, klien tidak tahu
        return res

# ---------------------------------------------------------------- simulasi
def run(seed=0, bug=Bug.NONE, n_dev=3, n_tick=400, verbose=False):
    rnd = random.Random(seed)
    srv = Server(bug, rnd)
    net = Network(rnd, p_drop_req=0.15, p_drop_res=0.12, p_dup=0.08)
    devs = [Device(f"K{i+1}", srv, bug, rnd) for i in range(n_dev)]
    bd = "2026-07-27"

    for t in range(n_tick):
        for d in devs:
            if rnd.random() < 0.10:
                d.online = not d.online            # putus/sambung
            if rnd.random() < 0.55:
                d.make_sale(bd, rnd.randrange(15000, 250000, 500))
            if rnd.random() < 0.03:
                d.crash()
            if rnd.random() < 0.05 and d.online:
                synced = [i.entity_id for i in d.outbox if i.sent]
                if synced:
                    tgt = rnd.choice(synced)
                    srv.void(tgt, bug)
                    if bug != Bug.VOID_AS_UPDATE:
                        d.voided_local.add(tgt)
            d.flush(net)

    # fase pemulihan: semua online, flush sampai konvergen
    for d in devs:
        d.online = True
    for _ in range(80):
        for d in devs:
            d.flush(net)

    return srv, devs

# ---------------------------------------------------------------- invariant
def check(srv, devs):
    fails = []
    created = {}
    for d in devs:
        for oid, o in d.local_orders.items():
            created[oid] = o

    # I1 konservasi — setiap order yang dibuat perangkat ada di server
    server_asli = {k: v for k, v in srv.orders.items() if not k.endswith("-V")}
    hilang = [oid for oid in created if oid not in server_asli]
    if hilang:
        fails.append(f"I1 KONSERVASI: {len(hilang)} order hilang (contoh {hilang[:2]})")

    # I2 tanpa duplikasi — tidak ada order server yang tidak dikenali perangkat,
    #    dan tidak ada dua entri server untuk satu order logis (receipt sama)
    by_receipt = {}
    for o in server_asli.values():
        by_receipt.setdefault(o.receipt, []).append(o.id)
    dup = {r: ids for r, ids in by_receipt.items() if len(ids) > 1}
    if dup:
        contoh = list(dup.items())[:2]
        fails.append(f"I2 DUPLIKASI: {len(dup)} nomor struk punya >1 order server ({contoh})")

    # I3 konvergensi — himpunan server == himpunan gabungan perangkat
    if set(server_asli) != set(created):
        extra = set(server_asli) - set(created)
        if extra:
            fails.append(f"I3 KONVERGENSI: {len(extra)} order di server tidak ada di perangkat mana pun")

    # I4 monotonisitas nomor struk per (device, tanggal)
    for d in devs:
        seqs = sorted((o.sequence for o in d.local_orders.values()))
        if seqs != list(range(1, len(seqs)+1)):
            fails.append(f"I4 MONOTONISITAS: {d.code} nomor tidak berurutan rapat")

    # I5 konservasi uang
    tot_dev = sum(o.total for o in created.values())
    tot_srv = sum(o.total for o in server_asli.values())
    if tot_dev != tot_srv:
        fails.append(f"I5 UANG: perangkat Rp{tot_dev:,} vs server Rp{tot_srv:,} (selisih Rp{tot_srv-tot_dev:,})")

    # I6 kemampuan jual offline — penjualan tidak boleh gagal karena tidak ada koneksi
    blocked = sum(d.blocked_offline for d in devs)
    attempted = sum(d.attempted for d in devs)
    if blocked:
        fails.append(f"I6 OFFLINE: {blocked}/{attempted} penjualan GAGAL karena perangkat offline")

    # I7 immutabilitas — record server tidak boleh berubah setelah tulis pertama
    if srv.mutations:
        fails.append(f"I7 IMMUTABILITAS: {srv.mutations} record server dimutasi setelah tulis pertama")

    # I8 higienis idempotency — satu order tidak boleh punya banyak idem key
    banyak = {o: k for o, k in srv.idem_per_order.items() if len(k) > 1}
    if banyak:
        fails.append(f"I8 IDEMPOTENCY: {len(banyak)} order punya >1 idempotency key "
                     f"(dedup bergantung pada PK, bukan pada key)")

    return fails, len(created), len(server_asli)

if __name__ == "__main__":
    import sys
    bug = sys.argv[1] if len(sys.argv) > 1 else Bug.NONE
    n   = int(sys.argv[2]) if len(sys.argv) > 2 else 200
    gagal_seed = []
    for seed in range(n):
        srv, devs = run(seed=seed, bug=bug)
        f, nc, ns = check(srv, devs)
        if f:
            gagal_seed.append((seed, f, nc, ns))
    print(f"mode={bug:<24} iterasi={n:<5} GAGAL={len(gagal_seed):<5} lolos={n-len(gagal_seed)}")
    for seed, f, nc, ns in gagal_seed[:3]:
        print(f"   seed={seed}  dibuat={nc} di_server={ns}")
        for x in f: print(f"      • {x}")
