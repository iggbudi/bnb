# Paper Trading — Hasil Analisis (18 Jul – 3 Agu 2026)

> Ringkasan hasil seluruh sistem paper trading di proyek ini: **Paper Agent (LP full-range)**,
> **Aggressive Paper (concentrated high-risk)**, dan **Directional/Perp Paper (long/short 5×)**.
> Data: `data/bnb-viewer.sqlite` per 2026-08-03T21:28Z. Semua simulasi **tanpa API key trading**
> dan **tanpa live execution** (execution tetap `LOCKED`).
> Detail mendalam directional ada di [`fwdrun.md`](fwdrun.md).

---

## 1. Ringkasan Tiga Sistem

| Sistem | Modal | Strategi | Status | Hasil kumulatif |
|---|---|---|---|---|
| Paper Agent (LP) | US$100 (simulasi) | Full-range LP counterfactual + sinyal per jam | Aktif sejak 18 Jul | 31 entry paper, **31/31 positif** (avg +1,59%/7 hari) |
| Aggressive Paper | US$50 (kompaun) | Concentrated V3 high-risk, target +10%, stop −5% | 5 posisi selesai | **−0,48%** (−$0,24) |
| Directional/Perp | US$50 ×2 run | Long/short leverage 5× per menit | Backtest selesai; forward aktif | Backtest **−12,56%**; forward **−15,11%** (mark) |

---

## 2. Paper Agent — LP Full-Range (US$100)

### 2.1 Aktivitas
- Keputusan per jam: **394** (18 Jul 12:30 → 3 Agu 21:00) — `WAIT` 363, `ENTER_FULL_RANGE` 31.
- Refleksi AI: 73 (semua `correct`, confidence high) — pola konsisten: entry hanya dibenarkan bila
  keunggulan bruto menutup biaya lifecycle.
- **Model learning: belum ada** — masih fase pengumpulan sampel terlabel (lihat bagian 2.4).

### 2.2 Hasil outcome counterfactual (seluruh keputusan, termasuk WAIT)

| Horizon | Dievaluasi | Avg return | Menang | Total PnL (kontrafaktual) |
|---|---|---|---|---|
| 1 jam | 392 | +0,005% | 208/392 (53%) | +$2,10 |
| 6 jam | 388 | +0,032% | 209/388 (54%) | +$12,53 |
| 24 jam | 370 | +0,113% | 197/370 (53%) | +$41,72 |
| 168 jam (7 hari) | 224 | +0,733% | 164/224 (73%) | +$164,08 |

> Catatan: outcome WAIT adalah **kontrafaktual** (berapa return LP bila sempat masuk), bukan ekuitas nyata.

### 2.3 Entry paper nyata (31 sinyal ENTER_FULL_RANGE)

| Horizon 168h | n | Avg return | Menang |
|---|---|---|---|
| ENTER_FULL_RANGE | 31 | **+1,585%** | **31/31 (100%)** |
| WAIT (kontrafaktual) | 193 | +0,596% | 133/193 (69%) |

Kesimpulan sementara: sinyal entry model penuh-range selama ini **selalu positif** pada horizon 7 hari
(+1,585% rata-rata), dan unggul dibanding kontrafaktual WAIT (+0,596%). Namun ini masih **sampel kecil
(31) dan tanpa model terlatih** — evidence resmi tetap `INSUFFICIENT_SAMPLE` sampai ≥30 posisi selesai
dan ≥30 hari kalender.

### 2.4 Status learning
- Sampel terlabel masih **sebagian kecil** dari target (fase `COLLECTING_DATA`) — model logistic
  regression belum pernah lolos gate pelatihan (`paper_agent_models` kosong).
- Assessment outcome: 764 `CORRECT`, 486 `ABSTAINED_SAFETY`, 124 `INCORRECT`, 3 `SKIPPED_DATA_GAP`.

---

## 3. Aggressive Paper — Concentrated High-Risk (US$50)

### 3.1 Portofolio (5 posisi, semuanya `NO_FEASIBLE_RECENTER`)

| # | Buka → Tutup | Invest | NLV akhir | Return posisi |
|---|---|---|---|---|
| 1 | 20–21 Jul | $50,00 | $50,14 | +0,28% |
| 2 | 21–22 Jul | $50,14 | $49,57 | −1,13% |
| 3 | 22–24 Jul | $49,57 | $49,13 | −0,89% |
| 4 | 24–26 Jul | $49,13 | $49,29 | +0,33% |
| 5 | 28–30 Jul | $49,29 | $49,76 | +0,96% |

- **Kumulatif: $50,00 → $49,76 (−0,48%, −$0,24)** — kerugian kecil, tidak pernah menyentuh hard stop −5%.
- Target +10% (masing-masing $55 dst.) **tidak pernah tercapai**; semua posisi keluar karena
  `NO_FEASIBLE_RECENTER` (harga keluar range dan recenter berikutnya tidak layak setelah haircut fee/gas).
- Aksi: 192 `WAIT`, 135 `HOLD`, 5 `ENTER`, 5 `EXIT`, 2 `RECENTER`.
- Fee terkumpul per posisi $0,04–$0,56; occupancy bervariasi (0–100%).
- **Belum ada posisi yang menang** terhadap target +10%; 2 dari 5 posisi menang tipis (+0,3%; +1,0%).

Kesimpulan: strategi defensif (keluar cepat saat recenter tak layak) mencegah loss besar tetapi juga
tidak pernah mencapai target; hasil nyaris impas dengan bias kecil negatif pada periode range ini.

---

## 4. Directional / Perp Paper — Long/Short 5× (US$50)

### 4.1 Hasil

| Run | Periode | Ekuitas akhir | Return | MaxDD | Posisi | Win rate | Realized | Fee |
|---|---|---|---|---|---|---|---|---|
| 1 BACKTEST | 18–26 Jul | $43,72 | **−12,56%** | 15,0% | 40 | 32,5% | −$6,28 | $5,10 |
| 2 FORWARD | 26 Jul–sekarang | $42,44 (mark) | **−15,11%** | 19,7% | 53 | 30,8% | −$8,29 | $6,47 |

### 4.2 Diagnosis singkat
- 85% exit forward karena **`OPPOSING_SIGNAL` (whipsaw)** di pasar range 570–595 → kebocoran −$11,09.
- Avg win +$0,61 vs avg loss −$0,50 (edge nyaris nol); fee $6,47 ≈ 78% kerugian.
- SHORT konsisten lebih buruk (−$5,19) daripada LONG (−$3,10).

### 4.3 Tindak lanjut yang sudah diterapkan
- Backtest 6 varian (lihat [`fwdrun.md`](fwdrun.md) bagian 5): exit sinyal lawan di **breakeven**
  memangkas kerugian ~60% tanpa mengurangi jumlah trade.
- **Sudah diaktifkan live (3 Agu, commit `e9794a3`)**: `opposingExitAtBreakeven=true` pada run forward
  via rekonsiliasi config (run tetap sama, riwayat utuh).

---

## 5. Kesimpulan Lintas Sistem

1. **LP full-range (paper agent)**: satu-satunya yang konsisten positif sejauh ini — 31/31 entry menang
   (+1,59% per 7 hari), tapi sampel kecil dan tanpa model.
2. **Aggressive concentrated**: nyaris impas (−0,48%), defensif terhadap downside, target +10% belum
   pernah tercapai.
3. **Directional perp**: merugi di kedua mode (backtest −12,6%, forward −15,1%); penyebab dominan
   whipsaw exit sinyal lawan di pasar range — sudah dimitigasi dengan breakeven exit.
4. **Belum ada sistem yang berhak dianggap profitable** secara statistik: sampel pendek (≤8,5 hari),
   periode didominasi pasar range WBNB/USDT 570–595, dan simulasi belum memakai feed perp native
   (high/low intramenit, mark/index, order book, funding).

---

## 6. Referensi

- Detail directional: [`fwdrun.md`](fwdrun.md)
- Skrip backtest varian: `run/backtest-variants.ts` (folder `run/` di-gitignore)
- Dataset: `data/bnb-viewer.sqlite` — tabel `paper_agent_*`, `aggressive_paper_*`, `directional_paper_*`
