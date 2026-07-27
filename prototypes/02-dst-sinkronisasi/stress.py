"""Validasi akhir mode benar pada kondisi jaringan yang jauh lebih buruk."""
import sim, itertools
skenario = [
    ("normal   ", 0.15, 0.12, 0.08, 3),
    ("buruk    ", 0.35, 0.30, 0.20, 3),
    ("ekstrem  ", 0.55, 0.50, 0.35, 5),
    ("bencana  ", 0.70, 0.65, 0.50, 8),
]
print(f"{'jaringan':<10}{'drop_req':>9}{'drop_res':>9}{'dup':>7}{'dev':>5}{'iterasi':>9}{'GAGAL':>7}")
print("-"*56)
for nama, pq, ps, pd, nd in skenario:
    gagal = 0; N = 300
    for seed in range(N):
        rnd = sim.random.Random(seed)
        srv = sim.Server(sim.Bug.NONE, rnd)
        net = sim.Network(rnd, pq, ps, pd)
        devs = [sim.Device(f"K{i+1}", srv, sim.Bug.NONE, rnd) for i in range(nd)]
        bd = "2026-07-27"
        for t in range(400):
            for d in devs:
                if rnd.random() < 0.10: d.online = not d.online
                if rnd.random() < 0.55: d.make_sale(bd, rnd.randrange(15000,250000,500))
                if rnd.random() < 0.03: d.crash()
                if rnd.random() < 0.05 and d.online:
                    s2=[i.entity_id for i in d.outbox if i.sent]
                    if s2: srv.void(rnd.choice(s2), sim.Bug.NONE)
                d.flush(net)
        for d in devs: d.online = True
        for _ in range(150):
            for d in devs: d.flush(net)
        f,_,_ = sim.check(srv, devs)
        if f: gagal += 1
    print(f"{nama:<10}{pq:>9.0%}{ps:>9.0%}{pd:>7.0%}{nd:>5}{N:>9}{gagal:>7}")
