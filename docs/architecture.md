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
- feature store memakai connection policy SQLite bersama;
- root `src/` hanya berisi test lintas aplikasi.

CI menjalankan guardrail tersebut melalui `npm run check` bersama lint, format, build, seluruh test, dan coverage threshold.
