# Progress dan Pekerjaan Berikutnya

Terakhir diperbarui: 2026-07-26 UTC

## Status Aktif

- Process entry point: `node dist/app/server.js` pada port `3001`.
- Status script memvalidasi PID command, Git release revision, build timestamp, entry point, readiness, serta expected/applied schema identity; PID hidup saja tidak dianggap deployment sehat.
- Application schema aktif: **v4** (`feature_schema_ownership_registry`); migration v1–v4 tercatat satu kali dan SQLite `quick_check` menghasilkan `ok`.
- Deployment Termux terakhir diverifikasi **readiness OK** pada 2026-07-26 UTC.
- Snapshot quality gate 2026-07-26: `npm run check` lulus dengan **184 test**, coverage line **88,61%**, branch **72,76%**, function **88,15%**. Jumlah test ini adalah snapshot bertanggal; hasil CI terbaru tetap menjadi sumber utama.
- `npm audit --omit=dev`: 0 vulnerability.
- Live execution tetap **disabled**, emergency kill switch tetap **engaged**, signing/broadcast tidak tersedia, dan lifecycle tetap `SHADOW` pada run ID 2 yang belum qualified.
- Strategi full-range aktif tetap `lifecycle-v2.1`; accounting fee memakai `v3-fee-growth-v1`.
- Checklist release, deteksi stale deployment, rollback, dan validasi safety tersedia di [`docs/runbook-termux-release.md`](docs/runbook-termux-release.md).

## Arsip Milestone Historis

Bagian di bawah adalah catatan kondisi ketika milestone lama selesai. Path seperti `src/server-bnb.ts`/`src/bnb-app.ts`, migration v1–v3, jumlah test, coverage, dan status deployment di bagian ini **historis**, bukan petunjuk operasional atau kondisi source aktif. Gunakan **Status Aktif**, runbook release, dan hasil CI terbaru untuk kondisi sekarang.

## P0 — Selesai

- [x] Mengganti forecast fee full-range dari pro-rata TVL menjadi share active liquidity V3.
- [x] Mengganti fee outcome dan paper position menjadi delta `feeGrowthGlobal` × liquidity posisi.
- [x] Menyimpan checkpoint block, fee growth, liquidity, dan accounting version.
- [x] Menjadikan sinyal `baseline-v1.0` dan `lifecycle-v2.0` hanya diagnostik.
- [x] Membatasi Shadow qualification ke `lifecycle-v2.1`/model kompatibel dan `v3-fee-growth-v1`.
- [x] Membatalkan posisi paper legacy yang tidak mempunyai checkpoint valid.
- [x] Reset Shadow run lama dan memulai run ID 2 secara teraudit.
- [x] Menyimpan immutable mint plan dan mengikat receipt ke proposal, wallet, block, calldata, amount, serta deadline.
- [x] Menyimpan immutable exit plan dan memverifikasi receipt sesuai urutan transaksi.
- [x] Menutup posisi LIVE dan menyimpan realized P&L secara atomik setelah exit terverifikasi.
- [x] Membuat daily-loss gate membaca settlement loss aktual.
- [x] Membuat backup sebelum migrasi:
      `backups/bnb-viewer-pre-p0-2026-07-24T20-50-57-971Z.sqlite`.

## P1 — Selesai (2026-07-24 UTC)

### 1. Timeout dan single-flight request

**Prioritas tertinggi P1.**

- [x] Tambahkan `AbortSignal.timeout()` pada DexScreener.
- [x] Buat single-flight untuk fetch DexScreener berdasarkan cache key.
- [x] Buat single-flight untuk pembacaan state on-chain.
- [x] Pastikan cache miss paralel tidak menghasilkan request upstream ganda.
- [x] Tambahkan retry terbatas dengan exponential backoff dan jitter.
- [x] Bedakan error timeout, HTTP upstream, RPC malformed, dan network failure.

**File utama:**

- `src/dexscreener.ts`
- `src/server-bnb.ts`
- `src/pancakeswap-v3-onchain.ts`

**Kriteria selesai:**

- Request upstream yang hang berhenti sesuai timeout.
- Sepuluh request paralel hanya memicu satu request upstream per key.
- Seluruh caller menerima hasil/error yang sama tanpa unhandled rejection.
- Ada unit test timeout, deduplication, retry, dan pemulihan setelah error.

### 2. Cegah scheduler overlap

- [x] Tambahkan running lock untuk snapshot market.
- [x] Tambahkan running lock untuk snapshot on-chain.
- [x] Tambahkan running lock untuk paper lifecycle dan outcome evaluator.
- [x] Catat status `RUNNING`, `LAST_SUCCESS`, `LAST_ERROR`, dan durasi siklus.
- [x] Pastikan satu siklus lambat tidak membuat backlog timer.

**File utama:** `src/server-bnb.ts`

**Kriteria selesai:**

- Tidak ada dua siklus scheduler sejenis yang berjalan bersamaan.
- Siklus yang dilewati tercatat sebagai `ALREADY_RUNNING`, bukan error.
- Status scheduler tersedia melalui endpoint health/readiness.

### 3. Rate limiting dan perlindungan endpoint mahal

- [x] Tambahkan rate limit global yang konservatif.
- [x] Tambahkan limit lebih ketat untuk `POST /api/lp-analysis`.
- [x] Tambahkan concurrency lock untuk request OpenAI.
- [x] Batasi request RPC-heavy seperti `/api/onchain/pool` dan `/api/simulate`.
- [x] Tambahkan body-size limit eksplisit pada `express.json()`.
- [x] Jangan rate-limit exit risk-reduction sampai tidak dapat digunakan saat darurat; gunakan limit admin terpisah.

**Kriteria selesai:**

- Request berlebih mendapat HTTP `429` dan `Retry-After`.
- Cache miss AI paralel tidak memicu biaya OpenAI ganda.
- Endpoint exit admin tetap dapat digunakan secara aman saat emergency stop aktif.

### 4. Deployment hardening

- [x] Tambahkan security headers dengan Helmet atau middleware setara.
- [x] Konfigurasikan allowlist CORS melalui environment variable.
- [x] Tambahkan konfigurasi host listen eksplisit.
- [x] Tambahkan `trust proxy` hanya jika reverse proxy benar-benar digunakan.
- [x] Pastikan error API tidak membocorkan URL RPC, credential, atau response sensitif.
- [x] Dokumentasikan mode localhost, LAN, dan reverse proxy.

**Environment yang direncanakan:**

```env
HOST=127.0.0.1
CORS_ALLOWED_ORIGINS=http://127.0.0.1:3001,http://localhost:3001
API_RATE_LIMIT_PER_MINUTE=120
AI_RATE_LIMIT_PER_15_MINUTES=4
```

### 5. Graceful shutdown dan health model

- [x] Pisahkan `/api/health/live` dan `/api/health/ready`.
- [x] Readiness harus memeriksa SQLite, scheduler, dan freshness data penting.
- [x] Tangani `SIGTERM` dan `SIGINT`.
- [x] Hentikan timer sebelum proses keluar.
- [x] Tunggu request/siklus aktif selesai dengan timeout.
- [x] Tutup seluruh koneksi SQLite secara tertib.

**Kriteria selesai:**

- `npm run background:stop` tidak memerlukan `SIGKILL` dalam kondisi normal.
- Restart tidak meninggalkan scheduler ganda atau transaksi SQLite terbuka.

### Verifikasi P1

- Build dan **120/120 test** lulus, termasuk timeout/error classification, single-flight 10 caller, retry/recovery, scheduler overlap, rate limiter, concurrency gate, dan OpenAI lock.
- Smoke test membuktikan security headers, model health terpisah, status scheduler, serta graceful `SIGTERM` tanpa `SIGKILL`.
- Deployment aktif di `127.0.0.1:3001`; readiness seluruhnya hijau setelah startup.
- CORS origin yang tidak diizinkan ditolak HTTP `400` tanpa stack/credential leak.
- Live execution tetap `false`, execution mode `LOCKED`, kill switch engaged, dan broadcast tidak tersedia.
- Shadow run tetap ID `2`, `errorHours = 0`, belum qualified.

## Monitoring yang Harus Berjalan Setelah P1

- [ ] Pantau Shadow run ID 2 setiap hari.
- [ ] Pastikan `errorHours` tetap 0.
- [ ] Pastikan posisi baru memakai `accountingVersion = v3-fee-growth-v1`.
- [ ] Bandingkan fee increment paper dengan delta fee-growth on-chain.
- [ ] Jangan mengaktifkan `PAPER_ACTIVE` sebelum satu posisi kompatibel selesai 14 hari.
- [ ] Jangan mengaktifkan live execution meskipun adapter berstatus ready.

Endpoint monitoring:

```text
GET /api/shadow/status
GET /api/shadow/observations?limit=336
GET /api/positions/status
GET /api/agent/status
GET /api/execution/status
```

## P2 — Selesai (2026-07-24 UTC)

- [x] Pecah `src/server-bnb.ts` menjadi app, routes, services, dan schedulers.
- [x] Hilangkan side effect `listen()`/timer ketika app di-import oleh test.
- [x] Tambahkan HTTP integration test untuk route admin dan public.
- [x] Pecah `public/index.html` menjadi HTML, CSS, API client, dan dashboard modules.
- [x] Tambahkan migration framework/version table untuk schema SQLite.
- [x] Tambahkan lint, formatting, coverage report, dan CI.

### Verifikasi P2

- `src/server-bnb.ts` sekarang hanya bootstrap listener/shutdown; aplikasi, system routes, service container, dan scheduler berada di modul terpisah.
- Import `src/bnb-app.ts` tidak membuka port atau timer; integration test menjalankan app pada ephemeral port dan menutup seluruh store.
- HTTP integration test memverifikasi public health/history/security headers, execution fail-closed, admin unauthorized, exit-admin unauthorized, dan CORS sanitization.
- Frontend aktif dari empat aset terpisah: `index.html`, `styles.css`, `api-client.js`, dan `dashboard.js`.
- SQLite mempunyai `schema_migrations` versi 1–2; migrasi idempotent dan rollback atomik diuji.
- `npm run check` lulus: ESLint, Prettier, build, **125/125 test**, dan coverage threshold.
- Coverage total: line **79,24%**, branch **69,86%**, function **79,84%**.
- GitHub Actions CI tersedia di `.github/workflows/ci.yml`.
- Backup pra-migrasi: `backups/bnb-viewer-pre-p2-2026-07-24T21-39-10-624Z.sqlite`.
- Deployment sehat di `127.0.0.1:3001`; readiness memverifikasi schema migration versi 2.

## P3 — Selesai (2026-07-24 UTC)

- [x] Terapkan retention snapshot 30–90 hari.
- [x] Terapkan retention backup 14–30 file.
- [x] Tambahkan WAL checkpoint dan statistik ukuran database.
- [x] Sinkronkan `README.md`, `WIKI.md`, `.env.example`, dan status API.
- [x] Buat runbook restore backup dan recovery RPC outage.

### Verifikasi P3

- Maintenance storage berjalan saat startup dan setiap 24 jam dengan lock scheduler `storage-maintenance`.
- Policy aktif: snapshot market/on-chain **60 hari** dan maksimum **21 backup harian**; environment di-clamp ke 30–90 hari dan 14–30 file.
- Backup dibuat sebelum retention snapshot; hanya backup harian bernama `bnb-viewer-YYYY-MM-DD.sqlite` yang dipangkas. Backup audit `pre-*` dilindungi.
- WAL checkpoint `PASSIVE` sukses: `busy=0`, 6/6 frame ter-checkpoint pada deployment awal.
- `GET /api/operations/storage` melaporkan policy, ukuran main/WAL/SHM, page/free-page, backup, dan hasil maintenance tanpa membocorkan path database.
- `npm run check` lulus dengan **129/129 test**; coverage line **79,57%**, branch **70,24%**, function **80,57%**.
- `npm audit --omit=dev`: 0 vulnerability; SQLite `quick_check`: `ok`.
- `README.md`, `WIKI.md`, `.env.example`, dan endpoint API telah sinkron.
- Runbook tersedia di `docs/runbook-storage-and-rpc-recovery.md`.
- Backup pra-P3: `backups/bnb-viewer-pre-p3-2026-07-24T21-53-49-417Z.sqlite`.
- Deployment sehat di `127.0.0.1:3001`; storage maintenance `lastError=null`, Shadow run 2 `errorHours=0`.

## P4 — Selesai (2026-07-26 UTC)

- [x] Menambahkan schema migration v3 untuk ledger directional paper yang additive tanpa mengubah `pool_snapshots` atau tabel LP.
- [x] Menambahkan run `BACKTEST` dan `FORWARD`, keputusan per menit, posisi long/short, fill, fee, slippage, TP, SL, trailing stop, liquidation sintetis, cooldown, maximum hold, mark-to-market, equity, serta drawdown.
- [x] Menggunakan modal awal US$50, leverage 5×, margin 50%, dan maksimum satu posisi per run; live execution selalu `false` dan tidak ada API key trading.
- [x] Menambahkan scheduler `directional-paper`, readiness telemetry, endpoint performa/detail posisi, tab navigasi khusus **Perp Paper**, CLI backtest, dokumentasi, dan test.
- [x] Menambahkan coverage gate 80% agar gap histori tidak dianggap sebagai rangkaian menit yang kontinu.
- [x] Membuat backup konsisten `backups/bnb-viewer-pre-directional-2026-07-26T05-28-40-605Z.sqlite`.

### Verifikasi P4

- `npm run check` lulus dengan **137/137 test** dan coverage total di atas threshold.
- SQLite migration aktif pada versi 3 dan `PRAGMA quick_check` menghasilkan `ok`.
- Backtest awal mereplay 11.329 sampled close dari 2026-07-18 sampai 2026-07-26: 40 posisi selesai, win rate 32,5%, return net −12,56%, max drawdown 14,98%, dan fee US$5,10.
- Hasil negatif disimpan apa adanya sebagai baseline; tidak dilakukan tuning pada sampel yang sama agar tidak menyamarkan overfitting.
- Forward paper run ID 2 aktif dengan modal US$50; keputusan awal `WAIT/NO_DIRECTIONAL_EDGE`.
- Keterbatasan eksplisit: data hanya sampled close pool per menit, bukan OHLC/perpetual native; tidak ada high/low intramenit, mark/index spread, order book, atau funding exchange. Funding sementara diasumsikan 0.

## Perintah Verifikasi Aktif

```bash
npm run check
npm audit --omit=dev
npm run background:status
curl -fsS http://127.0.0.1:3001/api/health/live
curl -fsS http://127.0.0.1:3001/api/health/ready
curl -fsS http://127.0.0.1:3001/api/operations/storage
curl -fsS http://127.0.0.1:3001/api/execution/status
```

`npm run background:status` wajib gagal jika revision, entry point `dist/app/server.js`, expected schema, applied schema, atau readiness tidak cocok. Prosedur release lengkap tidak boleh digantikan hanya dengan command probe di atas.

## Aturan Keselamatan

1. `LIVE_EXECUTION_ENABLED` tetap `false` sampai ada prosedur aktivasi terpisah yang disetujui; release dokumentasi/refactor tidak boleh mengubahnya.
2. Kill switch tetap engaged kecuali ada prosedur aktivasi terpisah yang disetujui.
3. Jangan pernah menyimpan private key atau seed phrase di server.
4. Exit yang mengurangi risiko harus tetap tersedia ketika entry terkunci.
5. Setiap perubahan accounting harus membatalkan atau mereset bukti Shadow yang tidak kompatibel.
