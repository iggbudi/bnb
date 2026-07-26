# Rencana Vertical Slicing BNB LP Analyzer

## 1. Tujuan

Mengubah struktur aplikasi dari kumpulan modul teknis di root `src/` menjadi **modular monolith berbasis fitur**, tanpa mengubah perilaku bisnis, kontrak API, schema SQLite, jadwal worker, atau tampilan dashboard.

Hasil akhirnya harus membuat perubahan pada satu fitur terlokalisasi dalam satu slice, sementara kode yang benar-benar generik ditempatkan di `shared/` dan composition root ditempatkan di `app/`.

## Status Implementasi

Terakhir diperbarui: 2026-07-26 UTC.

- [x] Fase 0 — baseline dan architecture guardrails.
- [x] Fase 1 — composition root, konfigurasi, HTTP app factory, container, scheduler registration, dan process bootstrap telah dipindahkan ke `src/app/`.
- [x] Fase 2 — route seluruh 8 slice selesai diekstrak ke `src/features/`.
- [x] Fase 3 — domain logic, application service/use case, CLI directional, adapter execution, dan test terkait telah dipindahkan ke slice pemiliknya; orchestration runtime telah dibungkus service ber-Dependency Injection.
- [x] Fase 4 — persistence, connection factory, schema ownership contribution, dan migration registry selesai dipisahkan.
- [x] Fase 5 — scheduler task contribution dan metadata readiness selesai dipisahkan.
- [x] Fase 6 — frontend dimodularisasi per fitur dengan bootstrap tunggal.
- [x] Fase 7 — boundary enforcement, cleanup compatibility layer, dan dokumentasi arsitektur selesai.

Catatan akhir: seluruh route bisnis, domain logic, application orchestration, persistence, definisi scheduler, dan renderer/polling dashboard sudah dimiliki feature slice. `src/app/` menjadi composition root dan process/CLI entry point; `src/shared/` hanya berisi concern teknis netral. Frontend memakai helper di `public/shared/`, modul di `public/features/`, serta satu `public/app.js` untuk tab, refresh, dan compatibility handler DOM. Runner serta connection policy SQLite berada di `shared/database`, sedangkan registry migration berada di `app/migrations.ts`. Seluruh root compatibility wrapper dan re-export sementara sudah dihapus setelah npm script, background process, test, dan caller internal bermigrasi ke entry point final.

## 2. Prinsip dan Batasan

1. Refactor dilakukan bertahap; `npm run check` wajib lulus pada setiap tahap.
2. Tidak ada perubahan endpoint, bentuk response, environment variable, interval scheduler, atau perilaku strategi selama pemindahan.
3. Tidak ada rename tabel/kolom atau migration destruktif. Migration yang sudah diterapkan harus tetap memiliki versi dan isi yang kompatibel.
4. Setiap slice memiliki route, application service/use case, domain logic, persistence, dan test miliknya sendiri jika komponen tersebut memang dibutuhkan.
5. Slice tidak boleh mengimpor file internal slice lain secara langsung.
6. Komunikasi antarslice dilakukan melalui public API slice (`index.ts`), interface/port, atau event yang didefinisikan secara eksplisit.
7. `shared/` hanya berisi kode yang netral terhadap bisnis. Kode tidak dipindahkan ke `shared/` hanya karena dipakai dua tempat.
8. `app/` hanya bertugas melakukan composition/wiring, konfigurasi HTTP, lifecycle proses, dan registrasi scheduler.
9. File dipindahkan bersama test-nya agar ownership tetap jelas.
10. Dashboard dapat tetap berupa static frontend, tetapi script perlu dipecah berdasarkan fitur dan memiliki bootstrap tunggal.

## 3. Target Slice

Direncanakan **8 vertical slice**, ditambah `shared/` dan `app/`.

### 3.1 `market-data`

Tanggung jawab:

- Mengambil data Dexscreener dan state on-chain PancakeSwap V3.
- Menyimpan snapshot pasar dan snapshot on-chain.
- Menyediakan history, statistik, pool state, serta capture task.

Kandidat file saat ini:

- `dexscreener.ts`
- `snapshot-store.ts` dan test
- `onchain-store.ts` dan test
- Market, history, statistics, dan on-chain route sudah berada di `src/features/market-data/`
- Capture orchestration berada di `src/features/market-data/application/market-data-service.ts`; definisi task dimiliki slice dan dikumpulkan composition root

Public API slice:

- `MarketDataService`
- `SnapshotRepository`/`OnchainRepository` ports jika dibutuhkan slice lain
- `registerMarketDataRoutes()`
- `createMarketDataTasks()`

### 3.2 `lp-analysis`

Tanggung jawab:

- Kalkulasi AMM dan concentrated liquidity.
- Simulasi LP dan proyeksi fee.
- Analisis AI untuk pool, tanpa mengelola lifecycle posisi.

Kandidat file saat ini:

- `amm.ts` dan test
- `concentrated-liquidity.ts` dan test
- `full-range-fee.ts` dan test
- `lp-simulator.ts` dan test
- `openai-analysis.ts` dan test
- Simulation, AI analysis, dan impermanent-loss route sudah berada di `src/features/lp-analysis/`
- Projection, simulation, dan AI cache orchestration berada di `src/features/lp-analysis/application/lp-analysis-service.ts`
- Slice mengekspor task contribution kosong karena belum memiliki worker periodik mandiri

Public API slice:

- Fungsi kalkulasi/domain yang digunakan slice agent dan execution
- `LpAnalysisService`
- `registerLpAnalysisRoutes()`
- `createLpAnalysisTasks()`

### 3.3 `paper-agent`

Tanggung jawab:

- Keputusan paper LP hourly.
- Penyimpanan keputusan dan outcome immutable.
- Evaluasi, interpretasi outcome, dan refleksi agent.
- API status, decisions, outcomes, performance, dan reflections.

Kandidat file saat ini:

- `paper-agent.ts` dan test
- `paper-agent-evaluator.ts` dan test
- `agent-store.ts` dan test
- `outcome-assessment.ts` dan test
- `outcome-interpretation.ts` dan test
- `agent-reflection.ts` dan test
- Status, decisions, outcomes, performance, dan reflection route sudah berada di `src/features/paper-agent/`
- Decision, outcome evaluation, dan reflection orchestration berada di `src/features/paper-agent/application/paper-agent-service.ts`; definisi ketiga task dimiliki slice

Public API slice:

- `PaperAgentService`
- `PaperAgentReader` untuk kebutuhan learning
- `registerPaperAgentRoutes()`
- `createPaperAgentTasks()`

### 3.4 `aggressive-paper`

Tanggung jawab:

- High-risk concentrated LP planning.
- Portfolio paper agresif dan lifecycle posisi.
- Ledger fee, recenter, target, stop, cooldown, dan performa.
- API dan bagian dashboard aggressive paper.

Kandidat file saat ini:

- `high-risk-strategy.ts` dan test
- `aggressive-paper-manager.ts` dan test
- `aggressive-paper-store.ts`
- `aggressive-paper-dashboard.test.ts`
- Route dan test HTTP sudah berada di `src/features/aggressive-paper/`
- Lifecycle orchestration dipicu oleh task paper-agent; slice mengekspor contribution kosong karena tidak memiliki timer mandiri
- Renderer portfolio agresif berada di `public/features/aggressive-paper.js`

Public API slice:

- `AggressivePaperService`
- `registerAggressivePaperRoutes()`
- `createAggressivePaperTasks()`

### 3.5 `directional-paper`

Tanggung jawab:

- Strategi directional long/short.
- Forward paper simulation dan backtest.
- Run, decision, position, fill, evaluation, PnL, dan drawdown.
- API, dashboard, scheduler task, serta CLI backtest.

Kandidat file saat ini:

- `directional-strategy.ts` dan test
- `directional-paper-manager.ts` dan test
- `directional-paper-store.ts`
- `directional-paper-dashboard.test.ts`
- `directional-backtest-cli.ts`
- Route dan test HTTP sudah berada di `src/features/directional-paper/`
- Lifecycle orchestration dan task contribution berada di application service slice; renderer dashboard berada di `public/features/directional-paper.js`

Public API slice:

- `DirectionalPaperService`
- `registerDirectionalPaperRoutes()`
- `createDirectionalPaperTasks()`
- `runDirectionalBacktestCli()`
- Fungsi schema untuk migration tetap diekspos secara eksplisit

### 3.6 `learning`

Tanggung jawab:

- Training model, validation gate, versioning, dan active model.
- Lifecycle activation/qualification yang terkait dengan kelayakan model/paper stage.
- API model dan task learning.

Kandidat file saat ini:

- `learning-model.ts` dan test
- `lifecycle-activation-store.ts` dan test
- `learning-content.test.ts`
- Model status/history route sudah berada di `src/features/learning/`
- Training orchestration berada di `src/features/learning/application/learning-service.ts`; lifecycle activation dimiliki execution service

Public API slice:

- `LearningService`
- `ActiveModelReader`
- `registerLearningRoutes()`
- `createLearningTasks()`

### 3.7 `lp-execution`

Tanggung jawab:

- Control plane eksekusi LP dan readiness gate khusus execution.
- Proposal, approval, mint, tracking posisi, exit, settlement, dan audit.
- Paper position lifecycle dan shadow validation yang memvalidasi jalur menuju execution.

Kandidat file saat ini:

- `execution-control.ts` dan test
- `execution-store.ts` dan test
- `pancakeswap-v3-execution.ts` dan test
- `pancakeswap-v3-exit.ts` dan test
- `pancakeswap-v3-exit-tracker.ts` dan test
- `pancakeswap-v3-position-tracker.ts` dan test
- `pancakeswap-v3-onchain.ts` dan test jika khusus adapter execution; reader umum tetap di `market-data`
- `paper-position-manager.ts` dan test
- `position-lifecycle.ts` dan test
- `position-store.ts` dan test
- `shadow-mode-store.ts` dan test
- `position-dashboard.test.ts`
- Lifecycle, shadow, position, proposal, mint, exit, settlement, dan audit route sudah berada di `src/features/lp-execution/`
- Execution readiness dan lifecycle orchestration berada di `src/features/lp-execution/application/execution-service.ts`

Public API slice:

- `ExecutionService`
- `PositionLifecycleService`
- `registerExecutionRoutes()`
- `createExecutionTasks()`

### 3.8 `operations`

Tanggung jawab:

- Health/readiness agregat aplikasi.
- Storage maintenance, backup, retention, resilience, dan operational controls.
- Status scheduler dan endpoint operasional yang tidak dimiliki slice bisnis tertentu.

Kandidat file saat ini:

- `storage-maintenance.ts` dan test
- `operational-controls.ts` dan test
- `upstream-resilience.ts` dan test
- Health, readiness, dan storage route sudah berada di `src/features/operations/`
- Readiness builder dan storage orchestration berada di `src/features/operations/application/operations-service.ts`

Public API slice:

- `OperationsService`
- `registerOperationsRoutes()`
- `createOperationsTasks()`

## 4. Area Non-Slice

### 4.1 `shared/`

Hanya untuk concern teknis lintas fitur:

```text
src/shared/
  database/
    connection.ts
    migrations.ts
  http/
    errors.ts
    responses.ts
    validation.ts
  runtime/
    async-lock.ts
    concurrency-gate.ts
    rate-limiter.ts
    scheduler-registry.ts
  types/
```

Kandidat awal:

- `validation.ts`
- Primitive scheduler/concurrency dari `operational-controls.ts` jika benar-benar generik
- Tipe infrastruktur dari `types.ts`; tipe bisnis harus masuk ke slice pemiliknya

### 4.2 `app/`

Composition root dan proses aplikasi:

```text
src/app/
  create-app.ts
  container.ts
  register-routes.ts
  register-schedulers.ts
  config.ts
  readiness.ts
  shutdown.ts
  server.ts
```

`app/` boleh mengimpor public API semua slice. Slice tidak boleh mengimpor `app/`.

## 5. Struktur Direktori Target

```text
src/
  app/
    config.ts
    container.ts
    create-app.ts
    register-routes.ts
    register-schedulers.ts
    server.ts

  features/
    market-data/
      domain/
      application/
      infrastructure/
      http/
      index.ts
      *.test.ts

    lp-analysis/
      domain/
      application/
      http/
      index.ts
      *.test.ts

    paper-agent/
      domain/
      application/
      infrastructure/
      http/
      index.ts
      *.test.ts

    aggressive-paper/
      domain/
      application/
      infrastructure/
      http/
      index.ts
      *.test.ts

    directional-paper/
      domain/
      application/
      infrastructure/
      http/
      cli/
      index.ts
      *.test.ts

    learning/
      domain/
      application/
      infrastructure/
      http/
      index.ts
      *.test.ts

    lp-execution/
      domain/
      application/
      infrastructure/
      http/
      index.ts
      *.test.ts

    operations/
      application/
      infrastructure/
      http/
      index.ts
      *.test.ts

  shared/
    database/
    http/
    runtime/
    types/

public/
  app.js
  shared/
  features/
    market-data.js
    paper-agent.js
    aggressive-paper.js
    directional-paper.js
    execution.js
```

Subdirektori `domain/application/infrastructure/http` tidak wajib dibuat jika hanya menghasilkan file kosong atau satu file. Kedalaman struktur harus mengikuti kompleksitas aktual.

## 6. Aturan Dependensi

Arah dependensi yang diizinkan:

```text
app -> features -> shared
```

Aturan rinci:

1. `app` dapat mengimpor `features/*/index.ts` dan `shared`.
2. Sebuah slice hanya dapat mengimpor public API slice lain, bukan path internalnya.
3. Domain tidak boleh mengimpor Express, SQLite, environment variable, atau scheduler.
4. HTTP handler memanggil application service; handler tidak boleh menjalankan SQL atau rumus bisnis.
5. Store/repository mengimplementasikan port yang dimiliki application/domain slice.
6. Scheduler hanya memicu use case yang sama dengan jalur manual/API; logika bisnis tidak ditulis di registrasi timer.
7. Schema dimiliki slice, sedangkan runner migration berada di `shared/database` atau `app`.
8. Cross-slice database query dihindari. Jika dibutuhkan, slice pemilik data menyediakan reader interface.
9. Hindari barrel export internal yang terlalu luas; `index.ts` hanya mengekspor kontrak publik.
10. Tambahkan lint/import-boundary check setelah struktur stabil untuk mencegah pelanggaran dependensi.

## 7. Kontrak Antarslice yang Perlu Dibentuk

Sebelum memindahkan file, ekstrak interface minimal berikut:

```ts
interface MarketHistoryReader {
  getHistory(hours: number, limit: number): readonly MarketSnapshot[];
  getStatistics(): readonly MarketPeriodStatistics[];
}

interface CurrentPoolStateReader {
  getLatest(): OnchainPoolState | null;
}

interface PaperDecisionReader {
  getTrainingExamples(...args: unknown[]): readonly TrainingExample[];
}

interface ActiveModelReader {
  getActiveModel(): ActiveModel | null;
}

interface ReadinessContributor {
  name: string;
  check(now: Date): ReadinessCheck | Promise<ReadinessCheck>;
}

interface ScheduledTaskDefinition {
  name: string;
  label: string;
  intervalMs: number;
  run(): void | Promise<void>;
  runOnStartup?: boolean;
}
```

Nama dan tipe final harus mengikuti model aktual. Tujuannya adalah menghilangkan kebutuhan slice untuk mengetahui class store atau internal runtime slice lain.

## 8. Tahapan Implementasi

### Fase 0 — Baseline dan Guardrails

- [x] Pastikan working tree bersih.
- [x] Jalankan dan catat baseline `npm run check`.
- [x] Catat daftar endpoint dan contoh response utama sebagai compatibility baseline di `docs/vertical-slicing-baseline.md`.
- [x] Catat daftar scheduler, interval, dan status readiness.
- [x] Catat `APPLICATION_SCHEMA_VERSION`, daftar tabel, index, dan hasil `PRAGMA quick_check`.
- [x] Tambahkan architecture test sederhana untuk mendeteksi import terlarang setelah folder baru tersedia.
- [x] Putuskan tidak memakai path alias pada tahap ini; relative import dipertahankan agar risiko konfigurasi rendah.

Kriteria selesai:

- Baseline test, API, scheduler, dan schema terdokumentasi.
- Tidak ada perubahan behavior.

### Fase 1 — Pisahkan Composition Root

Target utama: mengecilkan `bnb-app.ts` tanpa memindahkan domain dahulu.

- [x] Pindahkan pembuatan Express app ke `src/app/create-app.ts`.
- [x] Pindahkan `BnbServiceContainer` ke `src/app/container.ts`.
- [x] Pindahkan konfigurasi environment terpusat ke `src/app/config.ts`.
- [x] Pindahkan registrasi scheduler ke `src/app/register-schedulers.ts`.
- [x] Pindahkan bootstrap `server-bnb.ts` ke `src/app/server.ts`, lalu pertahankan wrapper kompatibel karena script masih menunjuk file lama.
- [x] Jadikan `bnb-app.ts` wrapper sementara; runtime transisi berada di `src/app/runtime.ts`.

Kriteria selesai:

- `bnb-app.ts` tidak lagi menjadi tempat seluruh route, task, dan business logic.
- Startup/shutdown dan scheduler tetap identik.
- `npm run check` lulus.

### Fase 2 — Ekstrak Route per Slice

Urutan dan kemajuan ekstraksi:

- [x] `directional-paper`
- [x] `aggressive-paper`
- [x] `operations`
- [x] `market-data`
- [x] `paper-agent`
- [x] `learning`
- [x] `lp-analysis`
- [x] `lp-execution`

Untuk setiap slice:

- [x] Buat `register<Feature>Routes(app, dependencies)`.
- [x] Pindahkan handler dari `src/app/runtime.ts` tanpa mengubah URL/status/JSON.
- [x] Bentuk DTO/response mapper di dalam slice.
- [x] Pindahkan atau tambahkan integration/dashboard test terkait.
- [x] Jalankan test slice dan `npm run check`.

Kriteria selesai:

- Composition root hanya memanggil fungsi registrasi route.
- Tidak ada route bisnis yang didefinisikan langsung di composition root.

### Fase 3 — Pindahkan Domain dan Application Service

Untuk setiap slice:

- [x] Pindahkan strategi, kalkulasi, manager, evaluator, dan use case ke folder slice.
- [x] Pisahkan fungsi pure domain dari orchestration yang memakai store/waktu/environment.
- [x] Bungkus kumpulan fungsi orchestration menjadi service/use case dengan dependency injection eksplisit.
- [x] Hapus akses langsung `process.env` dari domain; injeksikan config tervalidasi.
- [x] Pindahkan test berdampingan dengan owner fitur.
- [x] Ekspor hanya public contract melalui `index.ts`.

Kriteria selesai:

- [x] Setiap fitur dapat dipahami dari satu direktori.
- [x] Domain logic tidak bergantung pada Express atau SQLite.
- [x] `npm run check` lulus setelah pemindahan Fase 3.

### Fase 4 — Pindahkan Persistence dan Kepemilikan Schema

- [x] Pindahkan setiap store ke `features/<slice>/infrastructure/`.
- [x] Satukan database connection factory agar store tidak menciptakan kebijakan koneksi berbeda-beda.
- [x] Pertahankan tabel dan query behavior yang ada.
- [x] Setiap slice mengekspor migration/schema contribution.
- [x] Runner mengumpulkan migration contribution dalam urutan versi yang tetap deterministik.
- [x] Jangan mengubah migration lama yang mungkin sudah diterapkan pada database pengguna.
- [x] Tambahkan test bahwa database lama dapat dibuka dan migration idempotent.
- [x] Jalankan `PRAGMA quick_check` pada fixture hasil migration.

Kriteria selesai:

- [x] Ownership tabel jelas per slice.
- [x] `APPLICATION_SCHEMA_VERSION` dan compatibility database tetap benar.
- [x] Tidak ada data migration destruktif.

### Fase 5 — Ubah Scheduler Menjadi Task Contribution

- [x] Setiap slice mengekspor daftar `ScheduledTaskDefinition`.
- [x] `app/register-schedulers.ts` hanya mengumpulkan dan menjalankan definisi tersebut.
- [x] Pertahankan nama task, interval, overlap protection, logging, dan `runOnStartup` persis seperti baseline.
- [x] Readiness scheduler menggunakan metadata task yang sama agar daftar tidak diduplikasi.
- [x] Tambahkan test bahwa semua task wajib terdaftar satu kali.

Kriteria selesai:

- [x] Menambah worker fitur baru tidak membutuhkan modifikasi business logic di composition root.
- [x] Scheduler registry tetap menjadi concern aplikasi/operasional.

### Fase 6 — Modularisasi Frontend

- [x] Pertahankan `index.html` dan kontrak DOM terlebih dahulu.
- [x] Ekstrak helper fetch/format/render generik ke `public/shared/`.
- [x] Pindahkan render dan polling directional, aggressive, agent, market, dan execution ke modul fitur.
- [x] Gunakan satu `public/app.js` sebagai bootstrap tab dan refresh lifecycle.
- [x] Hindari state global lintas fitur; gunakan fungsi init/dispose atau object module.
- [x] Pertahankan selector DOM, label, dan endpoint selama fase refactor.
- [x] Perbarui dashboard tests agar memvalidasi wiring modul.

Kriteria selesai:

- [x] Perubahan dashboard satu slice tidak memerlukan editing satu file `dashboard.js` besar.
- [x] UI dan polling behavior tidak berubah.

### Fase 7 — Enforce Boundary dan Bersihkan Compatibility Layer

- [x] Tambahkan ESLint rule atau architecture test untuk melarang deep import antarslice.
- [x] Larang import dari `app/` ke dalam `features/`.
- [x] Larang import Express/SQLite di folder domain.
- [x] Hapus wrapper dan re-export sementara setelah seluruh pemanggil bermigrasi.
- [x] Kurangi `types.ts` global dengan memindahkan tipe ke slice pemilik.
- [x] Perbarui README/WIKI dengan arsitektur dan cara menambah slice.
- [x] Tambahkan Architecture Decision Record singkat untuk aturan vertical slicing.

Kriteria selesai:

- [x] Boundary tervalidasi otomatis di CI.
- [x] Tidak ada file bisnis atau compatibility entry point tersisa di root `src/`.

## 9. Strategi Commit

Gunakan commit kecil dan dapat di-review. Contoh urutan:

1. `test: capture architecture compatibility baseline`
2. `refactor: extract application composition root`
3. `refactor: slice directional paper feature`
4. `refactor: slice aggressive paper feature`
5. `refactor: slice operations and market data`
6. `refactor: slice paper agent and learning`
7. `refactor: slice LP analysis and execution`
8. `refactor: modularize dashboard features`
9. `chore: enforce feature dependency boundaries`
10. `docs: document vertical slice architecture`

Hindari satu commit yang sekaligus memindahkan seluruh repo karena rename detection, review, dan pelacakan regression akan sulit.

## 10. Verifikasi per Slice

Setelah memindahkan satu slice, lakukan:

```bash
npm run lint
npm run format:check
npm run build
npm test
npm run test:coverage
```

Selain itu verifikasi:

- Endpoint lama tetap tersedia dan response kompatibel.
- Scheduler task tetap muncul dengan nama dan interval yang sama.
- Tidak ada task yang berjalan dua kali saat startup.
- Store menggunakan database yang sama dan menutup connection saat shutdown.
- Migration tetap idempotent.
- CLI directional masih berjalan melalui `npm run backtest:directional`.
- Dashboard tidak menghasilkan error browser dan seluruh tab masih melakukan fetch.
- Coverage tidak turun di bawah threshold proyek.

## 11. Risiko dan Mitigasi

### Risiko: circular dependency antarslice

Mitigasi:

- Definisikan reader/port kecil.
- Tempatkan composition di `app`, bukan saling membuat service di dalam slice.
- Gunakan public API slice saja.

### Risiko: perubahan behavior tersembunyi saat memindahkan handler

Mitigasi:

- Tambahkan characterization/integration test sebelum move.
- Lakukan move mekanis dahulu, cleanup sesudahnya dalam commit terpisah.

### Risiko: migration SQLite berubah urutan atau diterapkan ulang

Mitigasi:

- Jangan mengedit version migration lama.
- Pertahankan registry migration deterministik.
- Test database kosong dan database versi sebelumnya.

### Risiko: scheduler terdaftar ganda

Mitigasi:

- Satu aggregation point di `app/register-schedulers.ts`.
- Validasi nama task unik.
- Test startup task count.

### Risiko: `shared/` menjadi tempat pembuangan

Mitigasi:

- Kode masuk `shared/` hanya jika netral bisnis dan benar-benar dipakai beberapa slice.
- Tipe bisnis tetap dimiliki slice dan diekspor melalui kontrak publik.

### Risiko: frontend module loading tidak kompatibel

Mitigasi:

- Konfirmasi target browser/WebView Termux.
- Bila ES module belum aman, gunakan beberapa script berurutan atau bundling minimal tanpa mengubah deployment terlebih dahulu.

## 12. Definition of Done

Vertical slicing dianggap selesai ketika:

- [x] Delapan slice memiliki direktori dan public API yang jelas.
- [x] `app/` hanya melakukan composition, route aggregation, scheduler aggregation, startup, shutdown, dan process/CLI entry point.
- [x] Route, task, domain logic, persistence, serta test suatu fitur berada dalam slice yang sama.
- [x] Tidak ada deep import antarslice.
- [x] Domain tidak bergantung pada Express, SQLite, scheduler, atau environment variable.
- [x] API, schema database, environment variable, scheduler, dan UI tetap backward-compatible.
- [x] `npm run check` lulus dengan seluruh test dan coverage threshold.
- [x] SQLite migration tests serta `PRAGMA quick_check` lulus.
- [x] Architecture boundary diperiksa otomatis oleh CI.
- [x] Dokumentasi arsitektur dan panduan menambah fitur telah diperbarui.

## 13. Urutan Eksekusi yang Direkomendasikan

Mulai dari **directional-paper** sebagai pilot slice karena batas fiturnya paling jelas dan sudah memiliki strategy, manager, store, CLI, API, scheduler, dashboard, serta test. Setelah pola terbukti, gunakan pola yang sama untuk `aggressive-paper`. Jangan memulai dari `lp-execution` karena slice tersebut memiliki dependency dan risiko operasional paling tinggi.

Estimasi hasil akhir yang sehat bukan sekadar memindahkan file, melainkan membuat setiap fitur dapat dikembangkan melalui satu public contract dengan wiring terpusat dan dependency yang dapat diuji.

## 14. Backlog Pasca-Vertical-Slicing (P0–P3)

Analisis 2026-07-26 menemukan bahwa struktur akhir sudah sehat dan `npm run check` lulus dengan 161 test, coverage line 84,91%, branch 71,91%, serta function 85,70%. Backlog berikut menangani deployment drift, jalur execution berisiko tinggi, coupling antarslice, lifecycle database, dan dokumentasi tanpa mengubah strategi bisnis atau safety gate.

Aturan untuk seluruh prioritas:

1. Pertahankan endpoint, bentuk response, environment variable, interval scheduler, schema/data, dan perilaku UI kecuali perubahan additive yang terdokumentasi.
2. Live execution harus tetap disabled, emergency stop tetap engaged, dan server tetap tidak memiliki signing/broadcast authority selama pekerjaan.
3. Buat backup konsisten sebelum perubahan startup atau migration dan jangan mengedit migration v1–v4 yang sudah dapat diterapkan.
4. Setiap tahap wajib menjalankan `npm run check`, `npm audit --omit=dev`, migration compatibility test, `PRAGMA quick_check`, serta smoke test background process.
5. Refactor structural dan perubahan behavior/hardening harus dipisahkan dalam commit yang dapat di-review.

### P0 — Sinkronkan Deployment Aktif dengan Source

Temuan audit:

- Background PID aktif masih menjalankan entry point lama `node dist/server-bnb.js` yang sudah dihapus.
- Source dan script final menggunakan `node dist/app/server.js`.
- Database/deployment aktif masih melaporkan migration v3, sedangkan source terbaru mempunyai migration v4 `feature_schema_ownership_registry`.
- `scripts/status-background.sh` hanya memeriksa PID dan liveness sehingga tidak mendeteksi proses/build lama.

Pekerjaan:

- [x] Buat backup pra-deployment dan catat versi migration, safety flags, serta status shadow/lifecycle sebelum restart.
- [x] Hentikan proses lama secara graceful dan pastikan tidak ada listener atau scheduler ganda yang tertinggal.
- [x] Build lalu jalankan server melalui `dist/app/server.js` menggunakan script background final.
- [x] Verifikasi migration v4 diterapkan tepat sekali dan `PRAGMA quick_check` menghasilkan `ok`.
- [x] Verifikasi liveness, readiness, freshness market/on-chain, seluruh scheduler, dan storage maintenance kembali sehat.
- [x] Verifikasi live execution tetap disabled, kill switch tetap engaged, mode lifecycle tidak berubah secara tidak sengaja, dan signing/broadcast tetap tidak tersedia.
- [x] Tambahkan release/build identity dan expected schema version pada status operasional secara additive.
- [x] Perkuat `scripts/status-background.sh` agar memvalidasi command/entry point dan schema/build identity, bukan hanya PID serta `/api/health/live`.
- [x] Tambahkan test script/status yang gagal ketika PID hidup tetapi menjalankan entry point atau schema version yang tidak sesuai.

Kriteria selesai:

- [x] Proses aktif terbukti menjalankan `dist/app/server.js`.
- [x] Readiness melaporkan migration v4 dan seluruh check wajib hijau.
- [x] Status script menolak stale deployment.
- [x] Tidak ada perubahan pada data paper/shadow, execution control, atau kontrak API yang sudah ada.

Catatan penyelesaian 2026-07-26 UTC:

- Backup konsisten dibuat di `backups/bnb-viewer-pre-deployment-p0-2026-07-26T15-07-00Z.sqlite`; baseline pra-restart disimpan di log operasional lokal.
- Proses legacy dihentikan secara graceful dan diganti satu proses `node dist/app/server.js`.
- Migration v4 tercatat satu kali, `PRAGMA quick_check` menghasilkan `ok`, seluruh readiness check hijau, dan sembilan scheduler kembali `IDLE` tanpa error.
- Execution tetap `LOCKED`: live execution disabled, emergency stop engaged, lifecycle tetap `SHADOW`, shadow run tetap id 2, serta signing/broadcast tidak tersedia.
- `npm run check` lulus dengan 162 test, `npm audit --omit=dev` melaporkan 0 vulnerability, migration compatibility test lulus, dan smoke test deployment lulus.

### P1 — Tutup Risiko Execution dan Dependency Antarslice

#### P1.1 Coverage jalur execution kritis

Coverage agregat sudah kuat, tetapi audit menunjukkan:

- `src/features/lp-execution/http/execution-routes.ts`: line 38,92%, branch 29,63%.
- `src/features/lp-execution/infrastructure/pancakeswap-v3-onchain.ts`: line 60%.
- Test route saat ini terutama mencakup read path dan penolakan write tanpa otorisasi.

Pekerjaan:

- [ ] Tambahkan integration test authenticated untuk kill switch, proposal entry, review, immutable transaction plan, dan mint receipt.
- [ ] Tambahkan integration test authenticated untuk exit proposal, review, immutable exit plan, ordered receipts, settlement, dan realized-loss update.
- [ ] Uji payload malformed, token salah, proposal expired, replay/idempotency, state transition ilegal, wallet mismatch, chain mismatch, calldata mismatch, deadline, receipt gagal, dan konfirmasi kurang.
- [ ] Uji kegagalan/timeout RPC pada setiap tahap dan pastikan adapter serta execution readiness selalu fail-closed.
- [ ] Gunakan fake RPC/store deterministik; test tidak boleh membutuhkan jaringan, wallet, private key, signing, atau broadcast nyata.
- [ ] Tambahkan regression test bahwa emergency stop tidak dapat dibypass untuk entry tetapi tidak memblokir jalur exit pengurang risiko yang terotorisasi.
- [ ] Naikkan coverage file execution route dan adapter berdasarkan branch keamanan yang bermakna, bukan sekadar mengejar aggregate threshold.

#### P1.2 Hilangkan cycle dan perkecil public API slice

Temuan audit:

- Guardrail melarang deep import, tetapi belum melarang dependency cycle antarslice.
- `market-data` memakai utility runtime dari `lp-execution`, sementara `lp-execution` bergantung kembali pada `market-data`.
- `lp-analysis`, `paper-agent`, `learning`, dan `lp-execution` memiliki dependency dua arah melalui public barrel.
- Banyak `index.ts` memakai `export *` dan mengekspos domain, application, serta infrastructure sekaligus.

Pekerjaan:

- [ ] Catat dependency graph runtime dan type-only saat ini sebagai baseline otomatis.
- [ ] Definisikan port kecil pada consumer untuk market history, current pool state, paper decision, active model, lifecycle, dan execution status.
- [ ] Inject implementasi port di `src/app/`; hindari application service bergantung langsung pada concrete store slice lain.
- [ ] Putus cycle `market-data <-> lp-execution` terlebih dahulu dengan memindahkan primitive/read adapter pool PancakeSwap ke owner yang tepat tanpa membuat business dumping ground di `shared/`.
- [ ] Putus cycle `lp-analysis <-> paper-agent/lp-execution` dan `paper-agent <-> learning/lp-execution` secara bertahap melalui kontrak eksplisit atau orchestration di `app/`.
- [ ] Ganti wildcard barrel dengan export eksplisit dan public contract minimal.
- [ ] Tambahkan architecture test yang menolak runtime cycle, concrete infrastructure export yang tidak disetujui, dan penambahan dependency edge di luar allowlist transisi.
- [ ] Hapus allowlist transisi setelah graph menjadi acyclic.

Kriteria selesai:

- Seluruh branch execution yang berdampak pada otorisasi, uang, state transition, atau receipt mempunyai test positif dan negatif.
- Tidak ada runtime cycle antarslice.
- `index.ts` hanya mengekspor kontrak yang dibutuhkan consumer.
- `npm run check` dan seluruh compatibility baseline tetap lulus.

### P2 — Rapikan Lifecycle Database dan Hotspot Maintainability

#### P2.1 Satu jalur bootstrap schema

Temuan audit:

- Constructor store masih menjalankan DDL/schema ensure.
- `BnbServiceContainer` membuka beberapa store sebelum application migration dijalankan.
- Schema contribution di migration registry dan schema creation di constructor membentuk dua jalur inisialisasi.

Pekerjaan:

- [ ] Tambahkan characterization test untuk database kosong, database legacy tanpa registry, serta database migration v1, v2, v3, dan v4.
- [ ] Bentuk factory startup yang menyelesaikan bootstrap/migration sebelum store dan service dibuat.
- [ ] Gunakan feature schema contribution sebagai satu sumber definisi schema tanpa mengubah migration v1–v4 yang sudah tercatat.
- [ ] Setelah bootstrap terpusat terbukti kompatibel, ubah constructor store agar membuka serta memvalidasi schema, bukan melakukan migration tersembunyi.
- [ ] Pastikan kegagalan migration menutup seluruh connection dan tidak meninggalkan container setengah terinisialisasi.
- [ ] Uji startup paralel/restart, idempotency, rollback, index reconciliation, foreign key policy, WAL, dan database lama hasil backup.

#### P2.2 Pecah modul besar berdasarkan use case

Hotspot saat audit:

- `agent-store.ts`: 1.289 baris.
- `execution-store.ts`: 1.155 baris.
- `position-store.ts`: 1.065 baris.
- `aggressive-paper-store.ts`: 800 baris.
- `execution-routes.ts`: 686 baris.

Pekerjaan:

- [ ] Pecah execution HTTP menjadi control, entry proposal, mint settlement, exit proposal, dan exit settlement route registrar.
- [ ] Pecah store berdasarkan aggregate/repository yang mempunyai transaksi dan invariants jelas; jangan membagi hanya berdasarkan jumlah baris.
- [ ] Pertahankan transaksi atomik lintas tabel melalui unit-of-work atau transaction boundary yang eksplisit.
- [ ] Pertahankan façade/public contract sementara selama caller dimigrasikan, lalu hapus compatibility layer pada akhir tahap.
- [ ] Tambahkan test transaksi dan invariant sebelum memindahkan query.

#### P2.3 Bound resource operasional

- [ ] Tambahkan expiry cleanup atau bounded LRU pada key `FixedWindowRateLimiter` agar `Map` tidak tumbuh tanpa batas.
- [ ] Uji banyak IP/key, reset window, cleanup, `Retry-After`, dan mode `TRUST_PROXY`.
- [ ] Dokumentasikan bahwa limiter tetap process-local dan deployment multi-instance membutuhkan shared limiter.

Kriteria selesai:

- Migration selesai sebelum store digunakan dan hanya ada satu jalur perubahan schema.
- Database kosong serta seluruh versi fixture lama dapat startup secara idempotent.
- Hotspot terpecah tanpa mengubah transaksi, endpoint, atau safety behavior.
- Rate limiter mempunyai batas memori yang teruji.

### P3 — Sinkronkan Dokumentasi dan Guardrail Operasional

Temuan audit:

- Bagian status teratas `progress.md` masih melaporkan 137 test dan migration v3.
- Beberapa referensi aktif masih menyebut `src/server-bnb.ts`, `src/bnb-app.ts`, atau path sebelum vertical slicing.
- Catatan milestone historis bercampur dengan status deployment saat ini.

Pekerjaan:

- [ ] Perbarui status aktif di `progress.md` setelah P0 selesai: entry point, migration, jumlah test, coverage, dan health deployment.
- [ ] Tandai path/count lama sebagai catatan historis atau ganti hanya bagian yang mengklaim sebagai kondisi aktif.
- [ ] Sinkronkan `README.md`, `WIKI.md`, architecture docs, runbook, dan `.env.example` dengan build/schema identity serta prosedur deteksi stale deployment.
- [ ] Perbarui diagram dependency setelah P1 dan dokumentasikan public port setiap slice.
- [ ] Hindari hard-coded test count pada status permanen bila mudah basi; tautkan ke hasil CI atau tulis tanggal snapshot dengan jelas.
- [ ] Tambahkan checklist release Termux: backup, build, stop, start, process identity, migration, readiness, execution safety, dan rollback.
- [ ] Verifikasi dokumentasi tidak menyarankan membuka service langsung ke internet; mode LAN/reverse proxy harus tetap eksplisit sebagai deployment tepercaya.

Kriteria selesai:

- Tidak ada status aktif yang menunjuk entry point atau migration lama.
- Runbook dapat mendeteksi dan memulihkan stale deployment tanpa menebak-nebak.
- Dokumentasi arsitektur sesuai dengan dependency graph dan public API aktual.
- Seluruh link, command, format, dan quality gate dokumentasi lulus di CI.

### Urutan Pelaksanaan P0–P3

1. Selesaikan P0 sebelum refactor lain agar pengujian operasional memakai build yang benar.
2. Kerjakan P1.1 sebelum memecah execution route/store agar test menjadi safety net.
3. Kerjakan P1.2 per cycle kecil dan commit terpisah; jangan melakukan big-bang rewrite.
4. Kerjakan P2.1 sebelum P2.2 supaya lifecycle database stabil sebelum repository dipecah.
5. Kerjakan P2.3 secara independen setelah test limiter tersedia.
6. Tutup dengan P3 berdasarkan kondisi akhir yang benar-benar terdeploy.
