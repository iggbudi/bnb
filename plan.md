# Rencana Vertical Slicing BNB LP Analyzer

## 1. Tujuan

Mengubah struktur aplikasi dari kumpulan modul teknis di root `src/` menjadi **modular monolith berbasis fitur**, tanpa mengubah perilaku bisnis, kontrak API, schema SQLite, jadwal worker, atau tampilan dashboard.

Hasil akhirnya harus membuat perubahan pada satu fitur terlokalisasi dalam satu slice, sementara kode yang benar-benar generik ditempatkan di `shared/` dan composition root ditempatkan di `app/`.

## Status Implementasi

Terakhir diperbarui: 2026-07-26 UTC.

- [x] Fase 0 — baseline dan architecture guardrails.
- [x] Fase 1 — composition root, konfigurasi, HTTP app factory, container, scheduler registration, dan process bootstrap telah dipindahkan ke `src/app/`.
- [ ] Fase 2 — sedang berjalan; route `directional-paper`, `aggressive-paper`, `operations`, dan `market-data` selesai diekstrak (4 dari 8 slice), berikutnya `paper-agent`.
- [ ] Fase 3–7 — belum dimulai.

Catatan transisi: route dan orchestration lama sementara berada di `src/app/runtime.ts`. File root `bnb-app.ts`, `bnb-services.ts`, `bnb-schedulers.ts`, dan `server-bnb.ts` hanya menjadi compatibility wrapper. Route akan keluar dari runtime secara bertahap pada Fase 2.

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
- Capture task/orchestration masih berada di `src/app/runtime.ts`

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
- Route analisis terkait dari `src/app/runtime.ts`

Public API slice:

- Fungsi kalkulasi/domain yang digunakan slice agent dan execution
- `LpAnalysisService`
- `registerLpAnalysisRoutes()`

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
- Bagian task dan route paper agent dari `src/app/runtime.ts`

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
- Task/orchestration masih berada di `src/app/runtime.ts`; dashboard masih di `public/dashboard.js`

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
- Task/orchestration masih berada di `src/app/runtime.ts`; dashboard masih di `public/dashboard.js`

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
- Bagian training/model route/task dari `src/app/runtime.ts`

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
- Bagian admin/position/execution route dan task dari `src/app/runtime.ts`

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
- Readiness builder dan storage task masih berada di `src/app/runtime.ts`

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
- [ ] `paper-agent`
- [ ] `learning`
- [ ] `lp-analysis`
- [ ] `lp-execution`

Untuk setiap slice:

- [ ] Buat `register<Feature>Routes(app, dependencies)`.
- [ ] Pindahkan handler dari `src/app/runtime.ts` tanpa mengubah URL/status/JSON.
- [ ] Bentuk DTO/response mapper di dalam slice.
- [ ] Pindahkan integration/dashboard test terkait.
- [ ] Jalankan test slice dan `npm run check`.

Kriteria selesai:

- Composition root hanya memanggil fungsi registrasi route.
- Tidak ada route bisnis yang didefinisikan langsung di composition root.

### Fase 3 — Pindahkan Domain dan Application Service

Untuk setiap slice:

- [ ] Pindahkan strategi, kalkulasi, manager, evaluator, dan use case ke folder slice.
- [ ] Pisahkan fungsi pure domain dari orchestration yang memakai store/waktu/environment.
- [ ] Bungkus kumpulan fungsi orchestration menjadi service/use case dengan dependency injection eksplisit.
- [ ] Hapus akses langsung `process.env` dari domain; injeksikan config tervalidasi.
- [ ] Pindahkan test berdampingan dengan owner fitur.
- [ ] Ekspor hanya public contract melalui `index.ts`.

Kriteria selesai:

- Setiap fitur dapat dipahami dari satu direktori.
- Domain logic tidak bergantung pada Express atau SQLite.
- `npm run check` lulus setelah tiap slice.

### Fase 4 — Pindahkan Persistence dan Kepemilikan Schema

- [ ] Pindahkan setiap store ke `features/<slice>/infrastructure/`.
- [ ] Satukan database connection factory agar store tidak menciptakan kebijakan koneksi berbeda-beda.
- [ ] Pertahankan tabel dan query behavior yang ada.
- [ ] Setiap slice mengekspor migration/schema contribution.
- [ ] Runner mengumpulkan migration contribution dalam urutan versi yang tetap deterministik.
- [ ] Jangan mengubah migration lama yang mungkin sudah diterapkan pada database pengguna.
- [ ] Tambahkan test bahwa database lama dapat dibuka dan migration idempotent.
- [ ] Jalankan `PRAGMA quick_check` pada fixture hasil migration.

Kriteria selesai:

- Ownership tabel jelas per slice.
- `APPLICATION_SCHEMA_VERSION` dan compatibility database tetap benar.
- Tidak ada data migration destruktif.

### Fase 5 — Ubah Scheduler Menjadi Task Contribution

- [ ] Setiap slice mengekspor daftar `ScheduledTaskDefinition`.
- [ ] `app/register-schedulers.ts` hanya mengumpulkan dan menjalankan definisi tersebut.
- [ ] Pertahankan nama task, interval, overlap protection, logging, dan `runOnStartup` persis seperti baseline.
- [ ] Readiness scheduler menggunakan metadata task yang sama agar daftar tidak diduplikasi.
- [ ] Tambahkan test bahwa semua task wajib terdaftar satu kali.

Kriteria selesai:

- Menambah worker fitur baru tidak membutuhkan modifikasi business logic di composition root.
- Scheduler registry tetap menjadi concern aplikasi/operasional.

### Fase 6 — Modularisasi Frontend

- [ ] Pertahankan `index.html` dan kontrak DOM terlebih dahulu.
- [ ] Ekstrak helper fetch/format/render generik ke `public/shared/`.
- [ ] Pindahkan render dan polling directional, aggressive, agent, market, dan execution ke modul fitur.
- [ ] Gunakan satu `public/app.js` sebagai bootstrap tab dan refresh lifecycle.
- [ ] Hindari state global lintas fitur; gunakan fungsi init/dispose atau object module.
- [ ] Pertahankan selector DOM, label, dan endpoint selama fase refactor.
- [ ] Perbarui dashboard tests agar memvalidasi wiring modul.

Kriteria selesai:

- Perubahan dashboard satu slice tidak memerlukan editing satu file `dashboard.js` besar.
- UI dan polling behavior tidak berubah.

### Fase 7 — Enforce Boundary dan Bersihkan Compatibility Layer

- [ ] Tambahkan ESLint rule atau architecture test untuk melarang deep import antarslice.
- [ ] Larang import dari `app/` ke dalam `features/`.
- [ ] Larang import Express/SQLite di folder domain.
- [ ] Hapus wrapper dan re-export sementara setelah seluruh pemanggil bermigrasi.
- [ ] Kurangi `types.ts` global dengan memindahkan tipe ke slice pemilik.
- [ ] Perbarui README/WIKI dengan arsitektur dan cara menambah slice.
- [ ] Tambahkan Architecture Decision Record singkat untuk aturan vertical slicing.

Kriteria selesai:

- Boundary tervalidasi otomatis di CI.
- Tidak ada file bisnis tersisa di root `src/` kecuali compatibility entry point yang memang diperlukan.

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

- [ ] Delapan slice memiliki direktori dan public API yang jelas.
- [ ] `app/` hanya melakukan composition, route aggregation, scheduler aggregation, startup, dan shutdown.
- [ ] Route, task, domain logic, persistence, serta test suatu fitur berada dalam slice yang sama.
- [ ] Tidak ada deep import antarslice.
- [ ] Domain tidak bergantung pada Express, SQLite, scheduler, atau environment variable.
- [ ] API, schema database, environment variable, scheduler, dan UI tetap backward-compatible.
- [ ] `npm run check` lulus dengan seluruh test dan coverage threshold.
- [ ] SQLite migration tests serta `PRAGMA quick_check` lulus.
- [ ] Architecture boundary diperiksa otomatis oleh CI.
- [ ] Dokumentasi arsitektur dan panduan menambah fitur telah diperbarui.

## 13. Urutan Eksekusi yang Direkomendasikan

Mulai dari **directional-paper** sebagai pilot slice karena batas fiturnya paling jelas dan sudah memiliki strategy, manager, store, CLI, API, scheduler, dashboard, serta test. Setelah pola terbukti, gunakan pola yang sama untuk `aggressive-paper`. Jangan memulai dari `lp-execution` karena slice tersebut memiliki dependency dan risiko operasional paling tinggi.

Estimasi hasil akhir yang sehat bukan sekadar memindahkan file, melainkan membuat setiap fitur dapat dikembangkan melalui satu public contract dengan wiring terpusat dan dependency yang dapat diuji.
