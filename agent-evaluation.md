# Evaluasi Keputusan Trading Agent (18 Jul – 17 Agu 2026)

> Evaluasi menyeluruh hasil pengambilan keputusan trading ketiga sistem agent di proyek ini:
> **Paper Agent (LP full-range)**, **Aggressive Paper (concentrated)**, dan **Directional/Perp Paper (long/short 5×)**.
> Data: `data/bnb-viewer.sqlite` per 2026-08-17T23:02Z (run forward masih ACTIVE).
> Execution tetap `LOCKED` (kill switch engaged) — seluruh hasil adalah paper/simulasi, tanpa uang nyata.
> Dokumen ini memperbarui dan melampaui [`paper-trading-results.md`](paper-trading-results.md) (per 3 Agu) dan [`fwdrun.md`](fwdrun.md) (per 3 Agu).
>
> **Status tindak lanjut**: implementasi rekomendasi di [`agent-evaluation-plan.md`](agent-evaluation-plan.md).
> Fase 0 (guardrail + pause) selesai 17 Agu (commit `d5ccf06`); Fase 1 (v1.1 long-only) **REJECTED**
> oleh gate backtest — lihat [`fwdrun.md`](fwdrun.md) §7; Fase 2 (learning: label gross + gate
> proporsional + inferensi cost-aware) selesai 17 Agu. Directional tetap PAUSED.

---

## 1. Ringkasan Eksekutif

| Sistem | Modal | Periode | Hasil kumulatif | Verdict |
|---|---|---|---|---|
| Directional/Perp (run 2 FORWARD) | US$50 | 26 Jul – 17 Agu (22,7 hari, aktif) | **−28,6%** (mark), MaxDD 30,1% | ❌ **Merugi konsisten, tanpa edge** |
| Paper Agent (LP full-range) | US$100 | 18 Jul – 17 Agu (30 hari) | 31 entry, semua positif bruto; **edge ekonomi negatif** | ⚠️ Sinyal positif bruto, **tidak layak secara ekonomi** |
| Aggressive Paper | US$50 (kompaun) | 20 Jul – 8 Agu (7 posisi) | **+0,94%** ($50,00 → $50,47) | ✅ Nyaris impas, defensif |

**Kesimpulan utama: tidak ada agent yang terbukti profitable secara ekonomi setelah 30 hari data.**
Keputusan entry directional tidak memiliki predictive edge (EV negatif di semua konfigurasi yang diuji);
perbaikan exit (breakeven) hanya mengubah strategi dari "rugi whipsaw" menjadi "mesin fee dengan win rate 9,7%".

---

## 2. Evaluasi Directional/Perp Paper — Fokus Utama

### 2.1 Hasil agregat (3 run)

| Run | Mode | Periode | Ekuitas akhir | Return | MaxDD | Posisi | Win rate | Fee |
|---|---|---|---|---|---|---|---|---|
| 1 | BACKTEST (baseline) | 18–26 Jul | $43,72 | **−12,56%** | 15,0% | 40 | 32,5% | $5,10 |
| 2 | FORWARD (baseline → breakeven 3 Agu) | 26 Jul – 17 Agu | $35,69 realized / $35,74 mark | **−28,6%** | **30,1%** | 117 | ~20% | **$13,43** |
| 3 | BACKTEST (dengan breakeven) | 18 Jul – 3 Agu | $44,57 | **−10,85%** | 15,9% | — | — | — |

> Breakeven exit memperbaiki backtest (−12,56% → −10,85%) tetapi **tidak menyelamatkan run forward**.
> Run 2 telah kehilangan **28,6% modal** dan drawdown menembus 30% — melampaui batas stop keras sistem lain (−5%).

### 2.2 Perbandingan sebelum vs sesudah breakeven (run 2)

| Fase | Periode | Posisi | Realized PnL | Fee | Win rate | Exit OPPOSING_SIGNAL |
|---|---|---|---|---|---|---|
| Sebelum (whipsaw @ market) | 26 Jul – 3 Agu | 54 | **−$7,99** | $6,64 | 31,5% | 46 (85%) |
| Sesudah (whipsaw @ breakeven) | 3 Agu – 17 Agu | 63 (62 tertutup) | **−$6,27** | $6,79 | **9,7%** | 54 (87%) |

**Temuan kunci fase sesudah breakeven (per-alasan):**

| Close reason | n | PnL | Catatan |
|---|---|---|---|
| OPPOSING_SIGNAL (breakeven) | 54 | −$6,96 | Semua rugi kecil ≈ fee round-trip (~$0,11–0,14/posisi) |
| TRAILING_STOP | 4 | +$1,20 | Satu-satunya sumber win |
| TAKE_PROFIT | 2 | +$2,60 | Sangat jarang tercapai |
| STOP_LOSS | 2 | −$3,11 | Termasuk SHORT −$2,12 dipegang 24 jam ke arah salah |

### 2.3 Mengapa masih rugi padahal pasar naik?

**Pasar setelah 3 Agu justru UPTREND 588 → 620 (+5,4%)** — kondisi ideal untuk strategi momentum LONG.
Namun:

1. **Win rate kolaps ke 9,7%** — breakeven exit menutup posisi pada momentum dip sesaat, lalu tren
   berlanjut *tanpa* posisi. Dari 62 posisi, hanya 6 yang mencapai TP/trailing.
2. **40% entry tetap SHORT selama uptrend** (31 dari 62) — sinyal momentum short tidak menyaring arah
   tren; SHORT menyumbang −$5,39 dari −$6,27 (LONG hanya −$0,88).
3. **Strategi menjadi mesin fee**: 54× fee round-trip ≈ $6,0 + 2 SL −$3,11 + win kecil +$3,80.
   Hanya **2 dari 14 hari** setelah 3 Agu yang realized PnL-nya positif (5 Agu +$0,40; 8 Agu +$0,97).
4. **Break-even win rate yang dibutuhkan ≈ 16%** (avg win +$0,63 vs biaya rugi ~$0,12), aktual 9,7% →
   EV per trade negatif struktural.

### 2.4 Diagnosa keputusan agent (entry vs exit)

- **Keputusan ENTRY**: tidak memiliki edge. Sinyal `directional-momentum-v1.0` menembak ~4,4 kali/hari
  dengan win rate 10–30% di semua rezim (range maupun tren). Backtest 7 varian (fwdrun.md §5) tidak
  menemukan satu pun filter entry yang membuat strategi profitabel; varian terbaik (V5, breakeven +
  momentum 2×) hanya impas dengan sampel 9–20 trade.
- **Keputusan EXIT**: iterasi whipsaw → breakeven adalah perbaikan nyata (kerugian whipsaw −$11 → −$7
  per fase), tetapi berubah menjadi masalah baru: memangkas winner. Kombinasi entry lemah + exit breakeven
  = tidak ada mekanisme yang menghasilkan win.
- **Keputusan SISI (long/short)**: asimetri persisten — SHORT selalu lebih buruk di kedua fase
  (−$5,33 vs −$2,66 sebelum; −$5,39 vs −$0,88 sesudah). Sinyal short tidak berfungsi di pasar yang
  dominan naik.

### 2.5 Data & operasional

- Run 2: 117 posisi, 116 tertutup, 233 fills, 31.197 keputusan (24.418 HOLD, 6.779 WAIT, 59 OPEN_LONG,
  58 OPEN_SHORT, 116 CLOSE).
- Gap data 11 Agu (hanya 416 snapshot vs ~1.440; server sempat mati karena bug start script) — hari itu
  satu-satunya SL besar (−$2,12) tercatat.
- Posisi terbuka saat laporan: SHORT #250 entry $605,36 (TP $598,09 / SL $608,99), unrealized +$0,10.

---

## 3. Evaluasi Paper Agent (LP Full-Range)

### 3.1 Aktivitas 30 hari (714 keputusan)

| Aksi | n | Alasan |
|---|---|---|
| WAIT | 683 (96%) | 541 `LIFECYCLE_EDGE_TOO_LOW`, 142 `DATA_INSUFFICIENT` |
| ENTER_FULL_RANGE | 31 | 22 `LIFECYCLE_CONDITIONS_MET`, 9 `BASELINE_CONDITIONS_MET` |

### 3.2 Hasil outcome 168 jam (7 hari)

| Aksi | n | Avg LP return | Benar (ekonomis) | Decision reward |
|---|---|---|---|---|
| ENTER_FULL_RANGE | 31 | **+1,585%** | **9/31 (29%)** | **−0,0019** |
| WAIT (kontrafaktual) | 511 | +0,977% | 98/511 | −0,0064 |

### 3.3 Interpretasi kritis

- **Sinyal entry masih 31/31 positif secara bruto (+1,585%)**, tetapi edge atas WAIT **menyempit**
  dari +0,99pp (3 Agu) menjadi **+0,61pp** — karena pasar naik, LP yang *tidak* masuk pun untung (+0,977%).
- **Secara ekonomi, entry TIDAK dibenarkan**: hanya 9/31 dinilai `correct` setelah dikurangi biaya
  lifecycle (gas masuk+keluar, slippage); decision reward ENTER negatif (−0,0019). Artinya: keuntungan LP
  bruto lebih kecil daripada biaya aktual membuka/menutup posisi.
- **Keputusan agent justru benar untuk mayoritas kasus**: abstain (WAIT) adalah pilihan rasional karena
  edge bruto tidak menutup biaya. Ini konsisten dengan refleksi AI: 369 refleksi, semua `correct`.
- **Learning masih gagal menghasilkan model**: 3 model logistic ditolak (15–17 Agu) dengan alasan
  `INSUFFICIENT_CLASS_DIVERSITY` — data terlabel ~94% satu kelas (WAIT-correct), sehingga klasifier tidak
  bisa belajar. Assessment: 1.946 CORRECT, 124 INCORRECT, 543 ABSTAINED_SAFETY, 61 SKIPPED_DATA_GAP.

---

## 4. Evaluasi Aggressive Paper (Concentrated High-Risk)

| # | Buka → Tutup | Invest | NLV akhir | Return | Fee |
|---|---|---|---|---|---|
| 1 | 20–21 Jul | $50,00 | $50,14 | +0,28% | $0,08 |
| 2 | 21–22 Jul | $50,14 | $49,57 | −1,13% | $0,11 |
| 3 | 22–24 Jul | $49,57 | $49,13 | −0,89% | $0,56 |
| 4 | 24–26 Jul | $49,13 | $49,29 | +0,33% | $0,09 |
| 5 | 28–30 Jul | $49,29 | $49,76 | +0,96% | $0,42 |
| 6 | 4 Agu | $49,76 | $49,98 | +0,43% | $0,19 |
| 7 | 5–8 Agu | $49,98 | $50,47 | +0,99% | $0,41 |

- **Kumulatif: $50,00 → $50,47 (+0,94%)** — berbalik positif dari −0,48% (3 Agu).
- Semua posisi keluar karena `NO_FEASIBLE_RECENTER` (defensif); target +10% tidak pernah tercapai;
  hard stop −5% tidak pernah tersentuh.
- Verdict: strategi "parkir uang + fee kecil" — risiko rendah, return mendekati nol, tidak layak
  diaktifkan sebagai penghasil profit, tetapi aman sebagai benchmark defensif.

---

## 5. Kesimpulan Lintas Sistem

1. **Directional: gagal.** 30 hari, 3 run, 7 varian backtest — **tidak ada konfigurasi yang profitabel**.
   Run aktif −28,6% dan masih berdarah ~−$0,45/hari. Entry tanpa edge + exit breakeven = mesin fee
   dengan win rate 9,7%. Sinyal short rusak di pasar naik.
2. **LP Paper: sinyal positif tetapi bukan keunggulan.** Entry 31/31 positif bruto adalah artefak pasar
   naik (WAIT juga +0,98%); secara ekonomi entry merugi setelah biaya lifecycle. Agent abstain 96% —
   perilaku benar, tapi belum ada model terlatih untuk membuktikan edge.
3. **Aggressive: impas defensif.** +0,94% dalam 30 hari, tanpa risiko berarti — bukan strategi profit.
4. **Learning pipeline belum menghasilkan apa pun** dalam 30 hari: gate `INSUFFICIENT_CLASS_DIVERSITY`
   memblokir semua model karena distribusi kelas terlalu timpang.
5. **Keamanan terjaga**: execution tetap LOCKED; kerugian seluruhnya kertas.

---

## 6. Rekomendasi

1. **Hentikan/pause run directional forward (prioritas tertinggi).** Ekuitas −28,6%, MaxDD 30%,
   bleed ~−$0,45/hari tanpa tanda pemulihan. Lanjut berjalan hanya mengumpulkan data kerugian yang sama.
   Jika ingin tetap mengumpulkan data, reset ke modal baru dan aktifkan **pembatasan arah** (mis. hanya
   LONG di pasar dengan slope EMA naik) — SHORT terbukti merugi di semua fase.
2. **Jangan tambah varian parameter directional** sebelum ada hipotesis edge yang berbeda, bukan sekadar
   tuning: sinyal entry saat ini tidak membedakan rezim pasar (range vs tren) dan menembak terlalu sering.
   Uji coba varian berikutnya harus memakai **data high/low intramenit** dan **feed perp native
   (funding, mark/index)** sesuai batasan yang terdokumentasi — simulasi close-only saat ini bias
   konservatif terhadap TP/SL intramenit.
3. **Paper Agent: perbaiki pipeline learning dulu.** Masalah bukan pada agent (abstain sudah tepat)
   melainkan pada gate pelatihan: distribusi kelas perlu diseimbangkan (undersample WAIT / upsample
   ENTER, atau gunakan threshold ekonomi berbasis biaya lifecycle sebagai label), agar model yang
   terlatih bisa diuji. Sebelum itu, jangan interpretasikan 31/31 sebagai bukti edge.
4. **Aggressive: biarkan sebagai benchmark defensif**, jangan diaktifkan dengan uang nyata sampai ada
   skenario yang menghasilkan return signifikan di atas biaya.
5. **Tetap jaga kill switch LOCKED** — belum ada sistem yang memenuhi evidence resmi
   (`INSUFFICIENT_SAMPLE`: <30 posisi selesai *dan* <30 hari) untuk layak live.

---

## 7. Referensi

- Data: `data/bnb-viewer.sqlite` — `directional_paper_*`, `paper_agent_*`, `aggressive_paper_*`
- Analisis sebelumnya: [`paper-trading-results.md`](paper-trading-results.md), [`fwdrun.md`](fwdrun.md)
- Backtest varian: `run/backtest-variants.ts` (folder `run/` di-gitignore)
- Konfigurasi strategi: `src/features/directional-paper/domain/directional-strategy.ts` (flags
  `opposingExitAtBreakeven`, `run/` config forward)
