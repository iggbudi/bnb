# Forward Run — Hasil, Metode, dan Analisis Metode Saat Ini

> Dokumen: hasil **Perp Paper** (directional-paper) strategi `directional-momentum-v1.0` pada run forward live,
> metode yang dijalankan, dan analisis kritis terhadap metode tersebut (termasuk eksperimen varian).
> Data: `data/bnb-viewer.sqlite` per 2026-08-03T16:20Z (server, 1 menit per snapshot WBNB/USDT).
> Run aktif: **run 2 FORWARD** (sejak 26 Jul 2026, ~203 jam / 8,5 hari berjalan).

---

## 1. Ringkasan

| Metrik | Run 1 BACKTEST (18–26 Jul) | Run 2 FORWARD (26 Jul–sekarang) |
|---|---|---|
| Periode | 189,8 jam (8 hari) | 202,8 jam (8,5 hari, masih aktif) |
| Modal awal | US$50 | US$50 |
| Ekuitas akhir | $43,72 (realized) | $41,65 realized / **$42,44 mark** |
| Return | **−12,56%** | **−15,11%** (mark) |
| Puncak ekuitas | $50,00 | $50,82 |
| Max drawdown | 14,98% | **19,74%** |
| Posisi | 40 (13W/27L) | 53 (16W/36L, 1 open LONG) |
| Win rate | 32,5% | 30,8% |
| Realized PnL | −$6,28 | **−$8,29** |
| Total fee | $5,10 | **$6,47** (incl. posisi open) |
| Avg win / avg loss | +$0,39 / −$0,42 | +$0,61 / −$0,50 |
| Avg hold | 3,6 jam | 3,0 jam |

Kesimpulan singkat: **strategi merugi di kedua mode; forward lebih buruk daripada backtest**.
Penyebab dominan adalah kebocoran pada exit `OPPOSING_SIGNAL` (whipsaw) di pasar range 570–595,
ditambah beban fee leverage 5×. Eksperimen varian menunjukkan exit lawan di harga breakeven
memangkas kerugian ~60% tanpa mengurangi jumlah trade (lihat bagian 5).

---

## 2. Metode

### 2.1 Strategi: `directional-momentum-v1.0`

Sinyal dihitung per menit dari harga close WBNB/USDT (pool PancakeSwap V3), dengan konfigurasi:

| Parameter | Nilai | Arti |
|---|---|---|
| `initialCapitalUsd` | 50 | Modal simulasi |
| `leverage` | 5 | 5× |
| `marginFraction` | 0,5 | 50% saldo dipakai margin |
| `takerFeeBps` | 5,5 | Fee taker masuk/keluar |
| `slippageBps` | 2 | Slippage asumsi |
| `fastEmaPoints` / `slowEmaPoints` | 20 / 60 | EMA cepat/lambat |
| `shortMomentumPoints` / `longMomentumPoints` | 15 / 60 | Return 15m / 60m |
| `minimumShortMomentum` / `minimumLongMomentum` | 0,0008 / 0,002 | Ambang momentum |
| `minimumTrendGap` | 0,0003 | Ambang gap EMA fast/slow |
| `minimumStopDistance` / `maximumStopDistance` | 0,006 / 0,02 | Jarak SL dinamis (klamp) |
| `volatilityStopMultiplier` | 2,5 | SL = vol × 2,5 × √60 |
| `rewardRiskRatio` | 2 | TP = 2× jarak SL |
| `trailingActivationR` / `trailingDistanceR` | 1 / 0,75 | Trailing stop |
| `maximumHoldMinutes` | 1440 | Batas hold 24 jam |
| `cooldownMinutes` | 15 | Cooldown antar posisi |
| `fundingRate8h` | 0 | Funding diasumsikan 0 |

**Syarat entry LONG** (SHORT = kebalikan):
`returnShort ≥ 0,0008` **dan** `returnLong ≥ 0,002` **dan** `trendGap ≥ 0,0003` **dan**
`harga ≥ EMA20` **dan** `RSI14 ∈ [52, 82]`.

### 2.2 Siklus posisi (lifecycle)

- **Entry**: margin = saldo × 0,5 → notional = margin × 5; fee entry dipotong dari saldo.
  TP/SL dinamis dari volatilitas 60 menit; liquidation sintetis = entry ∓ (1/leverage − maintenance 0,005).
- **Setiap menit**: update trailing stop, evaluasi mark-to-market (unrealized − fee keluar − funding),
  update equity/drawdown.
- **Exit** (urutan prioritas):
  1. `LIQUIDATION` (harga menyentuh liquidation sintetis)
  2. `STOP_LOSS` (sentuh SL)
  3. `TRAILING_STOP` (sentuh trailing, setelah aktivasi 1R, jarak 0,75R)
  4. `TAKE_PROFIT` (sentuh TP 2R)
  5. `OPPOSING_SIGNAL` — sinyal entry berlawanan muncul dengan confidence ≥ 0,65
  6. `MAX_HOLD` (≥ 1440 menit)
  7. `BACKTEST_END` (akhir run, khusus backtest)
- **Pencatatan**: seluruh keputusan, posisi, fill, dan evaluasi disimpan di tabel
  `directional_paper_decisions/positions/fills/evaluations` (auditable).

### 2.3 Batasan simulasi (penting untuk interpretasi)

- Satu harga **close per menit** — tanpa high/low intramenit → sentuhan TP/SL intramenit tidak terdeteksi.
- Tanpa **mark/index price, order book, funding perp native** (funding = 0).
- Slippage flat 2bps, fee taker 5,5bps tetap.

---

## 3. Hasil Live (Forward, Run 2)

### 3.1 Ekuitas

Kurva ekuitas nyaris monoton turun (diambil dari evaluasi per posisi):

| Tanggal | Ekuitas |
|---|---|
| 27 Jul | $50,38 (puncak) |
| 28 Jul | $47,37 |
| 29 Jul | $43,97 |
| 30 Jul | $43,74 |
| 31 Jul | $41,63 (titik terendah) |
| 1 Agu | $41,39 |
| 2 Agu | $42,29 |
| 3 Agu | $42,44 |

Puncak $50,82 di awal, lalu drawdown maksimum **19,74%** (31 Jul–1 Agu), pulih sebagian ke $42,44.

### 3.2 Distribusi exit (52 posisi tertutup)

| Reason | Jumlah | PnL |
|---|---|---|
| `OPPOSING_SIGNAL` | **44 (85%)** | **−$11,09** |
| `TAKE_PROFIT` | 4 | +$5,14 |
| `TRAILING_STOP` | 2 | +$0,15 |
| `STOP_LOSS` | 2 | −$2,50 |

### 3.3 Per sisi & keputusan

- LONG: 27 trade → −$3,10 (9W/18L) · SHORT: 25 trade → **−$5,19** (7W/18L).
- Keputusan: 9.438 HOLD, 2.562 WAIT, 28 OPEN_LONG, 25 OPEN_SHORT, 52 CLOSE; 9.490 evaluasi MTM.
- Posisi terbuka saat laporan: **LONG** (entry $588,28; unrealized +$0,74; TP $603,13; SL $580,85; liq $473,56).

---

## 4. Analisis Metode Saat Ini

### 4.1 Diagnosis utama

1. **Whipsaw di pasar range.** Harga WBNB/USDT bergerak sideways 570–595 (+4,3%) selama periode.
   85% exit terjadi karena sinyal lawan (`OPPOSING_SIGNAL`) — posisi dibalik saat momentum berbalik,
   mayoritas pada harga yang lebih buruk → kebocoran **−$11,09**. TAKE_PROFIT hanya tercapai 4× dari 53 posisi.
2. **Edge nyaris nol.** Avg win +$0,61 vs avg loss −$0,50 (ratio ~1,2), jauh dari target reward:risk 2.
   SHORT secara konsisten lebih buruk (−$5,19) daripada LONG (−$3,10).
3. **Fee signifikan.** $6,47 fee ≈ 78% dari kerugian realized. Dengan leverage 5× (notional ~$105–115 per
   posisi) dan 53 posisi dalam 8,5 hari, churn tinggi menggerus ekuitas walau hasil bruto hampir impas.
4. **Drawdown dekat batas.** MaxDD 19,7% dari modal $50 — melampaui level hard stop umum (−5% seperti paper
   agresif).

### 4.2 Mengapa backtest ≠ forward

Keduanya merugi, tapi dengan pola berbeda: backtest TP hanya 1× sedangkan forward TP 4× — karena
jendela data dan fase pasar berbeda (backtest sebagian besar tren naik awal, forward murni range).
Yang konsisten: `OPPOSING_SIGNAL` mendominasi di keduanya (34/40 dan 44/52) dan menjadi sumber kerugian
terbesar. Run backtest dan forward memakai modal awal terpisah ($50 masing-masing), jadi kerugian tidak
terkompaun antar-run.

---

## 5. Eksperimen Varian (Backtest)

### 5.1 Metodologi

Harness in-memory **meniru persis** `processDirectionalSnapshot`/`runDirectionalBacktest` (entry, fee,
slippage, trailing, TP/SL/liquidation, cooldown, max hold, exit). **Validasi**: baseline mereproduksi
angka run live persis (run 1: $43,72 / −$6,28 / 40 trade / fee $5,10; run 2: $42,44 / −$8,29 / 52 trade /
fee $6,47). Varian:

- **V1**: hilangkan exit `OPPOSING_SIGNAL` (hanya TP/SL/trailing/max hold).
- **V2**: `OPPOSING_SIGNAL` tetap dipakai, tapi exit di harga entry (breakeven).
- **V3**: momentum 2× lebih ketat (minShort 0,0016; minLong 0,004; trendGap 0,0006).
- **V4**: filter slope EMA20 (naik untuk LONG, turun untuk SHORT) pada entry.
- **V5**: V2 + V3 digabung.
- **V6**: V2 + momentum 1,5× (minShort 0,0012; minLong 0,003; trendGap 0,00045).

Skrip: `run/backtest-variants.ts` (folder `run/` di-gitignore).

### 5.2 Hasil — Window FORWARD (26 Jul–3 Agu, sama dgn run live)

| Varian | Return | MaxDD | Trades | Realized | Fee |
|---|---|---|---|---|---|
| **Baseline** | **−15,11%** | 19,7% | 52 | −$8,29 | $6,47 |
| V1 tanpa exit lawan | −8,32% | 13,0% | 15 | −$4,65 | $2,01 |
| **V2 exit breakeven** | **−5,88%** | 12,6% | 52 | −$3,75 | $6,82 |
| V3 momentum 2× | −12,08% | 19,7% | 20 | −$6,57 | $2,47 |
| V4 slope EMA | −15,89% | 20,4% | 52 | −$8,67 | $6,43 |
| **V5 V2+V3** | **−0,27%** | 11,1% | 20 | −$0,74 | $2,67 |
| V6 breakeven + 1,5× | −13,98% | 16,8% | 36 | −$7,51 | $4,55 |

### 5.3 Hasil — Window BACKTEST (18–26 Jul, sama dgn run 1)

| Varian | Return | MaxDD | Trades | Realized |
|---|---|---|---|---|
| Baseline | −12,56% | 15,0% | 40 | −$6,28 |
| V1 | −7,38% | 12,8% | 14 | −$3,69 |
| V2 | −4,77% | 8,6% | 40 | −$2,38 |
| V3 | −4,16% | 11,3% | 9 | −$2,08 |
| V4 | −12,56% | 15,0% | 40 | −$6,28 |
| **V5** | **+0,50%** | 7,6% | 9 | +$0,25 |
| V6 | −2,86% | 8,3% | 19 | −$1,43 |

### 5.4 Interpretasi

1. **Exit adalah kuncinya, bukan filter entry.**
   - V3 (momentum 2× ketat, exit lama) tetap rugi −12% di forward → whipsaw tidak hilang karena
     `OPPOSING_SIGNAL` tetap exit di harga buruk.
   - V4 (slope EMA) tidak mengubah apa pun di backtest dan sedikit memperburuk forward → filter entry
     saat ini bukan penyebab utama.
2. **V2 (exit lawan di breakeven) = perubahan paling efektif per unit risiko.**
   - Jumlah trade **tidak berkurang** (52 → 52), tapi kerugian turun ~60% di kedua window
     (−15,1% → −5,9% forward; −12,6% → −4,8% backtest) dan maxDD turun drastis (19,7% → 12,6%;
     15,0% → 8,6%). Kerugian whipsaw −$11,09 menyusut menjadi ~−$6,77 (sisa dari fee round-trip).
3. **V5 (breakeven + momentum 2×) angka terbaik, tapi sampel kecil.**
   - Forward −0,27% dan backtest +0,50% (net positif), maxDD < 12%. Namun trade turun ke 9–20 →
     rentan overfit terhadap periode range ini. Layak diuji lanjut hanya setelah V2 berjalan beberapa minggu.
4. **V6 mengejutkan**: "tengah-tengah" (1,5× + breakeven) justru buruk di forward (−13,98%) — menegaskan
   bahwa kombinasi parameter non-linear dan perlu divalidasi per window, bukan diinterpolasi.

---

## 6. Rekomendasi

1. **Prioritas 1 — ubah exit `OPPOSING_SIGNAL` menjadi breakeven (V2).** Implementasi sebagai flag config
   (`opposingExitAtBreakeven`, default off → on) di `directional-paper-manager.ts`; efek konsisten dan
   besar di kedua window tanpa mengurangi kesempatan trade. Tidak menyentuh run forward yang sedang berjalan
   sampai konfigurasi diaktifkan.
2. **Prioritas 2 — evaluasi V5 setelah V2 tervalidasi live beberapa minggu** (perlu jendela data lebih
   panjang untuk menilai ketahanan dengan trade sedikit).
3. **Bukan rekomendasi:** V1 (tanpa exit lawan — posisi menggantung, SL lebih sering tersentuh),
   V4 (tidak efektif).
4. **Catatan operasional:** karena simulasi tanpa high/low intramenit, hasil cenderung konservatif untuk
   TP/SL intramenit; bila live execution dibuka nanti, validasi ulang dengan feed perp native
   (mark/index, funding, order book) sesuai batasan yang terdokumentasi di README/WIKI.

### Status implementasi

- **Diterapkan (2026-08-03):** flag config `opposingExitAtBreakeven` (default `false` = perilaku lama)
  di `directional-strategy.ts`; `closeMarkForReason` di `directional-paper-manager.ts` menutup posisi di
  harga entry saat `OPPOSING_SIGNAL` bila flag aktif; CLI backtest mendukung `--breakeven`
  (`npm run backtest:directional -- --hours 1440 --breakeven`).
- Run forward yang sedang berjalan **tidak berubah** sampai flag diaktifkan pada konfigurasi forward
  (saat ini default `false`).
- Verifikasi: 2 tes baru (default market exit vs breakeven exit), seluruh suite 186 tes lolos,
  lint + build bersih.

---

## 7. Fase 1 — Backtest v1.1 (breakeven + long-only), 17 Agu 2026

> Keputusan gate Fase 1 (dari `agent-evaluation-plan.md`): **v1.1 GAGAL kriteria kelayakan —
> run forward TIDAK diluncurkan.** Data: `data/bnb-viewer.sqlite` per 2026-08-17T23:29Z.
> Harness: `run/backtest-variants.ts` (validasi baseline reproduksi angka live persis).

### 7.1 Konteks

Evaluasi 30 hari (`agent-evaluation.md`) menyimpulkan SHORT merugi di semua rezim
(forward run 2: SHORT −$5,39 vs LONG −$0,88 pasca-3 Agu). Hipotesis v1.1: buang sisi SHORT
(`shortEnabled=false`) sambil mempertahankan exit breakeven (V2), modal baru $50.

### 7.2 Hasil

**Window BACKTEST (18–26 Jul, sama dengan run 1):**

| Varian | Return | MaxDD | Trades | Win rate | Realized | Fee |
|---|---|---|---|---|---|---|
| Baseline | −12,56% | 15,0% | 40 | 32,5% | −$6,28 | $5,10 |
| V2 breakeven | −4,77% | 8,6% | 40 | 15,0% | −$2,38 | $5,28 |
| **v1.1 long-only** | **−4,51%** | **9,6%** | **14** | 50,0% | −$2,25 | $1,85 |

**Window FORWARD (26 Jul – 17 Agu, sama dengan run 2):**

| Varian | Return | MaxDD | Trades | Win rate | Realized | Fee |
|---|---|---|---|---|---|---|
| Baseline | −39,17% | 40,3% | 116 | 27,6% | −$19,48 | $12,81 |
| V2 breakeven | −22,07% | 23,5% | 116 | 9,5% | −$10,91 | $14,48 |
| **v1.1 long-only** | **−20,54%** | **23,0%** | 39 | 43,6% | −$10,27 | $4,87 |
| v1.1 + halt 20% | −18,81% | 20,1% | 35 | 42,9% | −$9,41 | $4,43 |

### 7.3 Evaluasi terhadap kriteria kelayakan (harus SEMUA terpenuhi)

| Kriteria | Target | v1.1 aktual | Status |
|---|---|---|---|
| Return window backtest | ≥ 0% | **−4,51%** | ❌ |
| Return window forward | ≥ −12,6% | **−20,54%** | ❌ |
| MaxDD ≤ 12% | ≤ 12% | 23,0% (forward) | ❌ |
| Trades ≥ 20/window | ≥ 20 | **14** (backtest) | ❌ |

**Verdict: REJECTED — semua kriteria gagal. Run forward v1.1 tidak diluncurkan.**

### 7.4 Diagnosis

1. **Long-only membantu tapi tidak cukup.** vs V2 (short ON): forward −22,07% → −20,54%,
   win rate 9,5% → 43,6%, fee $14,48 → $4,87. SHORT memang penguras fee — tetapi membuang SHORT
   saja tidak menciptakan edge.
2. **Kebocoran pindah dari whipsaw ke STOP_LOSS.** Dengan exit breakeven, `OPPOSING_SIGNAL` tidak
   lagi rugi pasar; posisi bertahan sampai SL tersentuh: forward v1.1 = **18× STOP_LOSS −$19,32**
   (dominasi). Entry momentum terjadi di ekstrem lokal → SL volatilitas tersentuh pada pullback.
3. **Trade berkurang drastis (116 → 39) tapi tetap negatif** — bukan masalah frekuensi; sinyal entry
   tidak punya predictive edge (sama seperti kesimpulan fwdrun.md §4 dan evaluasi 30 hari).
4. **Kesimpulan:** keluarga strategi `directional-momentum-v1.0` (entry EMA/momentum/RSI + TP/SL
   volatilitas + trailing) **tidak menunjukkan edge di konfigurasi mana pun** selama 30 hari,
   di pasar range maupun tren. Eksperimen parameter tambahan dihentikan (sesuai rekomendasi
   `agent-evaluation.md` §6.2).

### 7.5 Tindak lanjut

- Directional tetap PAUSED (`DIRECTIONAL_PAPER_ENABLED=false`), guardrail Fase 0 aktif
  (circuit breaker 25%, long-only siap via env).
- Eksperimen directional berikutnya **tidak** boleh berupa varian parameter lagi; prasyaratnya:
  (a) feed high/low intramenit + funding/mark perp nyata (Fase 3) untuk memvalidasi ulang
  TP/SL/slippage yang saat ini hanya close-per-menit, dan (b) hipotesis sinyal yang berbeda.
- Prioritas berpindah ke Fase 2 (perbaikan pipeline learning paper agent) yang independen.
