# Arsitektur Vertical Slice

Aplikasi menggunakan **modular monolith berbasis fitur**. Semua fitur berjalan dalam satu proses dan satu database SQLite, tetapi ownership kode dan dependensinya dipisahkan secara eksplisit.

Keputusan arsitektur dicatat di [ADR-0001](adr/0001-vertical-slice-modular-monolith.md).

## Arah Dependensi

```text
app -> features -> shared
```

- `src/app/` adalah composition root: konfigurasi, wiring service, registrasi HTTP/scheduler, migration registry, entry point server, dan entry point CLI.
- `src/features/<slice>/` memiliki domain, application service, persistence, HTTP, task scheduler, CLI, serta test fiturnya.
- `src/shared/` hanya berisi concern teknis netral seperti koneksi/migration runner SQLite, validasi HTTP, error sanitization, concurrency, resilience, dan tipe scheduler.
- `public/app.js` adalah bootstrap frontend tunggal; `public/features/` memiliki renderer fitur dan `public/shared/` memiliki helper netral.

Sebuah feature tidak boleh mengimpor `app/`. Komunikasi antarslice harus melalui `features/<slice>/index.ts`, bukan deep import ke direktori internal slice lain. `shared/` tidak boleh bergantung pada `app/` atau feature.

## Delapan Slice

| Slice               | Ownership utama                                                    |
| ------------------- | ------------------------------------------------------------------ |
| `market-data`       | DexScreener, snapshot market/on-chain, history, statistics         |
| `lp-analysis`       | AMM, IL, concentrated liquidity, fee projection, AI analysis       |
| `paper-agent`       | Keputusan hourly, outcome, evaluasi, refleksi                      |
| `aggressive-paper`  | Concentrated paper portfolio dan lifecycle agresif                 |
| `directional-paper` | Strategi long/short, forward simulation, backtest, CLI             |
| `learning`          | Training, validation gate, model aktif, lifecycle activation store |
| `lp-execution`      | Position lifecycle, shadow gate, proposal, mint/exit, audit        |
| `operations`        | Health/readiness dan storage maintenance                           |

## Public Contract dan Consumer-owned Ports

`index.ts` tiap slice tetap menjadi API lintas-slice/composition yang minimal. Kontrak utama saat ini:

| Slice               | Public composition contract                                                                 | Consumer-owned port penting                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `market-data`       | `MarketDataService`, stores/read models, route/task registrar, schema contribution          | Menjadi implementasi `MarketHistoryReader`, `CurrentPoolStateReader`, dan `MarketCapturePort` milik consumer          |
| `lp-analysis`       | `LpAnalysisService`, kalkulasi pure LP/IL/fee, route/task registrar                         | `MarketHistoryReader`, `CurrentPoolStateReader`, `PaperAnalysisReader`, `ActiveModelReader`, `ExecutionStatusReader`  |
| `paper-agent`       | `PaperAgentService`, `AgentStore`, route/task registrar, schema contribution                | `PaperAgentRepository`, `MarketHistoryReader`, `ActiveModelReader`, `PositionLifecyclePort`, `ShadowValidationWriter` |
| `aggressive-paper`  | `AggressivePaperService`, `AggressivePaperStore`, route/task registrar, schema contribution | Service dipakai melalui `AggressivePaperLifecyclePort` milik `paper-agent`                                            |
| `directional-paper` | `DirectionalPaperService`, store, route/task registrar, backtest CLI, schema contribution   | Market reader disuntikkan melalui composition root                                                                    |
| `learning`          | `LearningService`, `LifecycleActivationStore`, route/task registrar, schema contribution    | Menjadi implementasi `ActiveModelReader` dan lifecycle activation port milik consumer                                 |
| `lp-execution`      | `ExecutionService`, lifecycle use case, stores, route/task registrar, schema contribution   | `PaperDecisionReader`, `ActiveModelReader`, `CurrentPoolHealthReader`, repository/readiness/lifecycle ports           |
| `operations`        | `OperationsService`, `StorageMaintenanceService`, route/task registrar                      | Readiness dependencies disuntikkan composition root                                                                   |

Port didefinisikan oleh consumer di `application/ports.ts` dan di-wire di `src/app/`; port tidak dipindahkan ke `shared/` hanya karena melintasi slice. Concrete repository internal dan adapter receipt/RPC tidak diekspor dari public index.

## Layer Dalam Slice

Subdirektori dibuat hanya saat kompleksitas memerlukannya:

- `domain/`: aturan dan perhitungan bisnis murni. Dilarang bergantung pada Express, SQLite, scheduler, `process.env`, atau `app/`.
- `application/`: use case, orchestration, service, serta task contribution.
- `infrastructure/`: SQLite store dan adapter upstream/on-chain.
- `http/`: route, parsing request, dan response mapping.
- `cli/`: implementasi CLI yang dimiliki fitur.
- `index.ts`: kontrak publik slice untuk composition root dan slice lain.

HTTP handler tidak menjalankan SQL atau menyalin rumus bisnis. Scheduler hanya memanggil method application service. Store memakai connection policy dari `src/shared/database/connection.ts`.

## Composition dan Kontribusi

- Route feature diregistrasi oleh `src/app/runtime.ts` melalui public API setiap slice.
- Schema dimiliki feature dan dikumpulkan secara deterministik di `src/app/migrations.ts`.
- `src/app/database-bootstrap.ts` merekonsiliasi feature schema contribution secara transaksional lalu menjalankan migration immutable v1–v4 **sebelum** container membuka store. Constructor store production hanya membuka dan memvalidasi schema.
- Store besar tetap mempunyai façade publik stabil, sedangkan query/invariant dikelompokkan pada repository internal per aggregate/use case; transaction boundary lintas tabel tidak dipindahkan atau dipecah.
- `ScheduledTaskDefinition` dimiliki feature dan dikumpulkan di `src/app/scheduled-tasks.ts`.
- Readiness critical scheduler berasal dari metadata task yang sama, bukan daftar nama terpisah.
- Startup proses berada di `src/app/server.ts`; CLI backtest dikomposisi oleh `src/app/directional-backtest.ts`.

## Menambah Slice atau Fitur

1. Buat `src/features/<nama>/` dan `index.ts` dengan kontrak publik minimal.
2. Tempatkan aturan murni di `domain/`; jangan mengakses Express, SQLite, timer, atau environment.
3. Buat application service dengan dependency injection eksplisit.
4. Implementasikan store/adapter di `infrastructure/` dan ekspor schema contribution bila memiliki tabel.
5. Buat registrasi route di `http/`; gunakan helper netral dari `shared/http/`.
6. Ekspor task contribution bila membutuhkan worker periodik.
7. Tambahkan wiring hanya di `src/app/`.
8. Tambahkan renderer di `public/features/` bila memiliki UI; polling tetap dipicu `public/app.js`.
9. Letakkan test berdampingan dengan owner fitur dan jalankan `npm run check`.
10. Jangan membuat re-export kompatibilitas baru di root `src/`.

## Guardrails Otomatis

`src/architecture.test.ts` memeriksa bahwa:

- `app/` hanya mengakses public API feature;
- tidak ada deep import antarslice atau import feature ke `app/`;
- `shared/` tidak bergantung pada app/feature;
- domain bebas dari Express, SQLite, scheduler, dan environment variable;
- feature store memakai connection policy SQLite bersama dan startup production mendahulukan bootstrap schema;
- root `src/` hanya berisi test lintas aplikasi.

`src/documentation.test.ts` memeriksa local Markdown link, sinkronisasi dependency graph dengan source, dokumentasi public port, final entry point/schema identity, checklist release, dan larangan direct internet exposure.

CI menjalankan guardrail tersebut melalui `npm run check` bersama lint, format, build, seluruh test, dan coverage threshold.
