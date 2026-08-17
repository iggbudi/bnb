# Rencana Implementasi — Rekomendasi Evaluasi Agent (17 Agu 2026)

> Rencana aksi berdasarkan evaluasi di [`agent-evaluation.md`](agent-evaluation.md).
> Tujuan: (1) menghentikan pendarahan directional, (2) menguji ulang dengan hipotesis edge yang
> berbeda, (3) memperbaiki pipeline learning yang selama 30 hari belum pernah menghasilkan model,
> (4) meningkatkan kualitas data untuk validasi yang sah. Semua tetap **paper trading** —
> kill switch execution tetap LOCKED.

---

## Ringkasan Akar Masalah (bukti dari DB, 17 Agu)

| # | Masalah | Bukti |
|---|---|---|
| M1 | Run directional forward −28,6%, maxDD 30% | `directional_paper_runs` run 2: $35,69/$35,74, bleed ~−$0,45/hari |
| M2 | Exit breakeven → mesin fee, win rate 9,7% | 54/62 exit `OPPOSING_SIGNAL` @ breakeven, rugi = fee round-trip; hanya 6/62 win |
| M3 | Sinyal SHORT rusak di semua rezim | SHORT −$5,39 vs LONG −$0,88 (pasca-3 Agu); −$5,33 vs −$2,66 (pra-3 Agu) |
| M4 | **Semua sampel training label 0 (0 positif dari 391)** | `paper_agent_models`: positive_rows=0; label = `economic_difference_vs_hold ≥ 0.01` → semua negatif |
| M5 | **Semua 31 keputusan ENTER dikeluarkan dari training** | `paper_agent_outcome_interpretations`: classification=`DIAGNOSTIC_EARLY`, trainable=0 (strategyVersion lama, bukan `lifecycle-v2.1`) |
| M6 | **Entry tidak pernah layak secara ekonomi di skala $100** | econ_edge ENTER 168h = −0,03…−0,06 (gas BSC ≈ $2,8 > LP profit ~$1–2,5) |
| M7 | Gap data 11 Agu (server mati) | 416 snapshot vs ~1.440; SL −$2,12 tercatat hari itu |

> M4+M5+M6 adalah **kegagalan struktural learning**: bukan sekadar imbalance kelas — label secara
> matematis tidak mungkin positif dengan definisi saat ini. Gate `INSUFFICIENT_CLASS_DIVERSITY`
> bekerja benar; definisi label-nya yang salah sasaran.

---

## Fase 0 — Guardrail Darurat ✅ SELESAI (commit Fase 0)

**Tujuan**: hentikan akumulasi kerugian paper dan cegah kerugian lebih jauh.

### 0.1 Pause run directional forward ✅
- `DIRECTIONAL_PAPER_ENABLED=false` di `.env` (dengan catatan alasan), service perlu restart.
- Run 2 tidak dihapus; status tetap ACTIVE di DB, hanya tidak diproses. Bisa resume kapan saja.

### 0.2 Circuit breaker drawdown ✅
- **File**: `directional-strategy.ts` (config `maxDrawdownHaltPercent` default 0, `shortEnabled` default true),
  `directional-paper-manager.ts` (logika), `directional-paper-store.ts` (`pauseRun` → status `PAUSED`).
- **Catatan**: status `PAUSED` sudah ada di schema (tidak perlu migration); `idx_directional_one_active_forward`
  hanya mengunci satu run FORWARD ACTIVE sehingga run baru bisa dibuat setelah pause.
- Logika di `processDirectionalSnapshot`:
  - Bila `maxDrawdownPercent ≥ ambang`: tutup posisi terbuka di mark (reason `MAX_DRAWDOWN_HALT`),
    tandai run `PAUSED`, hentikan entry baru.
  - Bila `shortEnabled=false`: `ENTER_SHORT` → `WAIT` dengan reason `SHORT_DISABLED_BY_CONFIG`.
- Env baru: `DIRECTIONAL_MAX_DRAWDOWN_PERCENT` (default 25, 0=nonaktif), `DIRECTIONAL_SHORT_ENABLED` (default true).
- **Tes**: 4 baru (config x2, strategy validation, manager: halt + short-disabled) — total suite 191 hijau, lint/build bersih.

### 0.3 Dokumentasi & commit ✅
- Update `agent-evaluation.md` (status), `fwdrun.md` (hasil fase breakeven), README/WIKI (config baru),
  plan ini. Commit + push.

**Done**: run berhenti memproses; guardrail aktif di kode; docs sinkron; `npm run check` lolos.

---

## Fase 1 — Eksperimen Directional v1.1: LONG-only + Breakeven ✅ SELESAI — GATE REJECTED

**Tujuan**: uji hipotesis *baru* — bukan tuning: buang sisi SHORT yang terbukti rusak (M3),
pertahankan breakeven (V2) yang memangkas kerugian whipsaw, dengan modal segar.

### 1.1 Backtest validasi v1.1 ✅
- `run/backtest-variants.ts` diperluas: opsi `shortEnabled` + `maxDrawdownHaltPercent`;
  window forward diperpanjang ke 17 Agu; varian v1.1 (+halt 20/25%), kontrol Baseline/V2/V4.
- Hasil lengkap di [`fwdrun.md`](fwdrun.md) §7. Ringkas:

| Kriteria kelayakan | Target | v1.1 aktual | Status |
|---|---|---|---|
| Return window backtest | ≥ 0% | **−4,51%** | ❌ |
| Return window forward | ≥ −12,6% | **−20,54%** | ❌ |
| MaxDD ≤ 12% | ≤ 12% | 23,0% | ❌ |
| Trades ≥ 20/window | ≥ 20 | **14** (backtest) | ❌ |

- **Verdict: REJECTED — run forward v1.1 TIDAK diluncurkan.** Long-only memperbaiki win rate
  (9,5% → 43,6%) dan fee ($14,48 → $4,87) tetapi kebocoran pindah ke STOP_LOSS (18× −$19,32
  di forward): sinyal entry tetap tanpa edge.

### 1.2 Keputusan strategis
- Keluarga `directional-momentum-v1.0` **dinyatakan tidak layak** di semua konfigurasi (30 hari,
  range & tren). Tidak ada varian parameter berikutnya.
- Directional tetap PAUSED; guardrail Fase 0 tetap aktif untuk eksperimen masa depan.
- Prasyarat eksperimen berikutnya: Fase 3 (feed intramenit + funding/mark) DAN hipotesis sinyal
  baru — bukan tuning.
- Prioritas pindah ke **Fase 2 (learning paper agent)** yang independen.

### 1.3 Yang TIDAK dilakukan
- Tidak ada tuning momentum/EMA/RSI; tidak ada aktivasi live execution; kill switch tetap LOCKED.

**Done**: backtest v1.1 terdokumentasi; run forward v1.1 aktif dgn guardrail; evaluasi mingguan terjadwal.

---

## Fase 2 — Perbaikan Pipeline Learning ✅ SELESAI (commit Fase 2)

**Tujuan**: mengubah learning dari "mustahil menghasilkan model" menjadi pipeline yang bisa
mempelajari *edge bruto* dan menerapkan *biaya* saat inferensi.

### 2.1 Ubah target training: gross, bukan net ✅
- **Label training** di `agent-learning-repository.getLearningExamples()`:
  `label = gross_difference_vs_hold ≥ MINIMUM_ACTIONABLE_EDGE_USD` (bukan economic).
  Data nyata 17 Agu: **159/391 (40,7%) positif** (sebelumnya 0/391 — degenerasi M4).
- **Inferensi** di `applyLearningModel`: gate biaya lifecycle — ENTER hanya bila
  `predictedNetEdge7d ≥ MINIMUM_ACTIONABLE_EDGE_USD` (net = gross − cost, dihitung dari fitur
  yang sudah ada). Kebenaran ekonomi dipertahankan; hard safety (LIFECYCLE_EDGE_TOO_LOW) tetap
  dijaga. Konstanta ambang dimirror lokal agar edge runtime `learning → paper-agent` tidak
  terbentuk (graf dependensi runtime harus asiklik — `src/architecture.test.ts`).
- **Sampel ENTER lama** (M5): TIDAK dimasukkan — keputusan terdokumentasi: semua 31 ENTER
  adalah `DIAGNOSTIC_EARLY` (accounting pra-`lifecycle-v2.1`), dan gross edge-nya juga dominan
  negatif/nol; memasukkannya menambah noise tanpa menambah kelas positif yang sah.

### 2.2 Gate klasifikasi yang lebih adil ✅
- `minimumClassRows(n) = max(10, floor(2% × n))` — proporsional, bukan absolut 10;
  metrik `positiveRate` ditambahkan ke walk-forward metrics & status learning.
- **Hasil validasi data nyata (17 Agu, 391 sampel)**: gate keragaman **LOLOS** (159/232),
  namun **walk-forward gate menolak jujur**: accuracy 40,1% vs baseline 59,2%, brier 0,49 →
  fitur saat ini belum memprediksi edge gross lebih baik dari mayoritas (WAIT).
  Ini adalah hasil pipeline yang benar: label tidak lagi degenerasi, metrik kelas terlihat,
  dan penolakan terdokumentasi (sesuai DoD Fase 2).
- `MIN_CLASS_ROWS=10` absolut → proporsional (mis. `max(10, 2% sampel)`), agar gate tidak menolak
  kelas minoritas kecil tapi sah; pertahankan `WALK_FORWARD_GATES` (accuracy ≥ baseline + 2pp, brier < 0.25).
- Tambah metrik `positiveRate` di status learning utk visibilitas distribusi kelas.

### 2.3 Opsional — skala modal simulasi (keputusan user) ⏳ DITUNDA
- Gas BSC (~$2,8) mendominasi $100 → secara ekonomi *tidak ada* entry yang layak (M6). Opsi:
  - (a) naikkan `initialCapitalUsd` paper agent ke $1000 (gas jadi ~0,3%),
  - (b) pertahankan $100 dan terima verdict "never enter" sbg hasil yang benar,
  - (c) hitung biaya sebagai persentase (bukan USD absolut) — mengubah semantik `MINIMUM_ACTIONABLE_EDGE_USD`.
- Rekomendasi awal: (a). **Keputusan ditunda** — melihat hasil walk-forward (fitur belum
  memprediksi gross edge), menaikkan modal saja tidak akan membuat model lolos; prioritas
  berikutnya adalah fitur/feed (Fase 3) bukan skala modal.

### 2.4 Tes ✅
- Learning-model.test.ts: gate proporsional (sparse → REJECTED, diverse → lolos keragaman),
  positiveRate, inferensi cost gate (net < ambang → WAIT, net ≥ ambang → ENTER).
- agent-store.test.ts: interpretation gross positif + economic negatif → label 1 (membuktikan
  label gross).
- Regresi: suite penuh **193 hijau**, lint/build/prettier bersih.

**Done (per 17 Agu)**: label tidak lagi degenerasi (40,7% positif), gate proporsional, metrik
kelas terlihat; walk-forward menolak model dengan alasan terdokumentasi (fitur belum cukup) —
sesuai klausa DoD.

---

## Fase 3 — Kualitas Data & Feed (scope besar, sub-proyek terpisah)

**Batasan yang sudah terdokumentasi (fwdrun.md §2.3)**: close-only per menit (tanpa high/low
intramenit), funding=0, tanpa mark/index dan order book.

- **3.1** High/low intramenit utk deteksi TP/SL intra-bar (memengaruhi semua angka directional —
  hasil saat ini bias konservatif untuk TP dan optimis untuk SL).
- **3.2** Feed perp native: mark/index price, funding nyata (funding 0 saat ini mengabaikan biaya
  carry pada posisi SHORT berhari-hari), depth order book utk slippage dinamis.
- **3.3** Resilensi collector: gap data (11 Agu, 416 snapshot) harus menghasilkan
  `SKIPPED_DATA_GAP` alih-alih memproses window parsial.

Tidak mem-block Fase 1–2; hasil Fase 1 harus divalidasi ulang setelah 3.1–3.2 selesai
(angka bisa berubah signifikan).

---

## Fase 4 — Ops & Dashboard ✅ SELESAI (commit Fase 4)

- **4.1** Metrik evaluasi directional di halaman Perp Paper: **Avg Win / Avg Loss, EV per trade
  (net), Avg Hold, Total Fee** ditambahkan ke kartu Forward; kartu baru **Kurva Ekuitas vs Harga**
  (SVG dua seri dinormalisasi, harian saat posisi terbuka — semantik jujur). Backend:
  `getPerformance` diperluas (`totalWinningPnlUsd`, `totalLosingPnlUsd`, `avgWinUsd`, `avgLossUsd`,
  `expectedValuePerTradeUsd`, `avgHoldHours`) + `getEquityCurve(runId, 30)` di store; status API
  menambah `equityCurve`. Contoh nilai nyata run 2: avgWin +$0,61, avgLoss −$0,30,
  EV −$0,12/trade, avgHold 3,7 jam.
- **4.2** Aggressive: `annualizedReturnPercent` ditambahkan (portfolio return di-annualisasi dgn
  hari kalender teramati) + kartu metrik di halaman; nilai nyata **+12,9%** (total +0,94%/29 hari,
  sampel 7 posisi — tetap benchmark defensif, bukan sinyal live).
- **4.3** README/WIKI sudah sinkron (guardrail env + catatan directional di WIKI; plan ini
  mencatat status ketiga sistem).
- **4.4** Kill switch tetap LOCKED; `execution_audit` tidak berubah.

**Fase 3 (feed high/low + funding perp) belum dikerjakan** — scope besar, butuh keputusan sumber
data eksternal (mis. Binance klines/futures API) dan tidak mem-block Fase 0–2 & 4.

---

## Urutan & Dependensi (per 17 Agu 2026)

```
Fase 0 (guardrail + pause)  ──►  Fase 1 (v1.1 backtest) → GATE REJECTED, forward tidak diluncurkan
        │
        └─► Fase 2 (learning)   ── SELESAI: label gross + gate proporsional + cost-aware
        └─► Fase 3 (feed)       ── berikutnya; prasyarat eksperimen directional & model LP
        └─► Fase 4 (ops/UI)     ── setelah Fase 0
```

## Definition of Done (keseluruhan, status per 17 Agu 2026)

1. ✅ Tidak ada lagi kerugian paper yang berjalan tanpa guardrail (circuit breaker aktif).
2. ✅ Eksperimen directional berikutnya divalidasi walk-forward dua window dgn kriteria tertulis —
   **v1.1 REJECTED, tidak diluncurkan**; keluarga v1.0 ditutup, menunggu Fase 3 + sinyal baru.
   Fase 4 menyediakan metrik evaluasi (avg win/loss, EV, kurva ekuitas) di dashboard.
3. ✅ Learning punya label yang bisa dipelajari (gross + biaya di inferensi) dan gate
   proporsional — **walk-forward menolak model dgn alasan terdokumentasi (fitur belum cukup,
   accuracy 40,1% < baseline 59,2%)**; metrik kelas (positiveRate) terlihat di status.
4. ⏳ Semua angka divalidasi ulang dengan feed high/low & funding (Fase 3).
5. ✅ `npm run check` hijau; docs sinkron; setiap fase = 1 commit dengan pesan jelas.

## Risiko

| Risiko | Mitigasi |
|---|---|
| ~~v1.1 (long-only) juga rugi~~ → TERJADI | Kriteria gate menolak v1.1 (−20,5% forward); forward tidak diluncurkan |
| ~~Overfit v1.1~~ → TERJADI (14 trade backtest) | Wajib ≥20 trade/window + dua window; v1.1 gagal kriterium trade |
| Label gross menyesatkan (entry tak layak) | Biaya tetap diterapkan di inferensi; verdict ekonomi tidak berubah |
| Feed Fase 3 mengubah angka lama | Semua dokumen menandai "per 17 Agu, close-only" |
| Perubahan schema (status run) | Status PAUSED sudah ada di schema — tanpa migration baru |
