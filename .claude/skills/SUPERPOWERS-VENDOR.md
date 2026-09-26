# Superpowers — salinan vendor

Skill di direktori ini (kecuali berkas ini) adalah salinan **apa adanya** dari
plugin Superpowers.

| | |
|---|---|
| Sumber | `obra/superpowers` (https://github.com/obra/superpowers), lewat marketplace `obra/superpowers-marketplace` |
| Versi | 6.4.2 |
| Disalin | 26 September 2026 |
| Lisensi | MIT, Copyright (c) 2025 Jesse Vincent — `SUPERPOWERS-LICENSE` |
| Keputusan | user, 26 September 2026 (kampanye "Hidupkan desain LumiPOS", Bagian 0 opsi b) |

## Kenapa disalin, bukan dipasang sebagai plugin

Plugin terpasang di `~/.claude` milik container, dan container session cloud
diganti di tengah pekerjaan. Salinan di repo termuat di setiap session cloud
tanpa langkah pemasangan.

## ⛔ Yang TIDAK ikut tersalin

1. **Hook `SessionStart` plugin.** Plugin aslinya menyuntikkan isi
   `using-superpowers/SKILL.md` ke konteks di awal setiap session. Salinan ini
   tidak membawanya. Penggantinya adalah `CLAUDE.md` § Workflow Superpowers,
   yang mewajibkan `using-superpowers` dimuat di awal setiap session.
2. **Awalan `superpowers:`.** Skill proyek dimuat dengan nama direktorinya
   (`brainstorming`, `writing-plans`, …), bukan `superpowers:brainstorming`.
   Teks di dalam `SKILL.md` masih merujuk `superpowers:<nama>` — rujukan itu
   berarti skill `<nama>` di direktori ini. Teksnya sengaja tidak disunting.

## Aturan

- **Jangan sunting berkas di sini.** Perbedaan antara aturan skill dan aturan
  repo diputuskan di `CLAUDE.md`, yang menang atas skill (skill
  `using-superpowers` sendiri menyatakannya).
- **Salinan ini tidak ikut pembaruan plugin.** Memperbaruinya harus disengaja:
  1. Pasang versi baru di container: `claude plugin marketplace add
     obra/superpowers-marketplace` lalu `claude plugin install
     superpowers@superpowers-marketplace`.
  2. Salin `~/.claude/plugins/cache/superpowers-marketplace/superpowers/<versi>/skills/.`
     ke `.claude/skills/` dan `LICENSE` ke `SUPERPOWERS-LICENSE`.
  3. Periksa bit eksekusi di index git (`git ls-files -s .claude/skills`,
     mode `100755`) untuk `subagent-driven-development/scripts/*`,
     `executing-plans/scripts/*`, `brainstorming/scripts/*.sh`.
  4. Perbarui versi dan tanggal di berkas ini. Satu commit tersendiri.
  5. Copot plugin lagi (`claude plugin uninstall superpowers@superpowers-marketplace`)
     supaya skill tidak termuat dua kali dengan dua nama.
