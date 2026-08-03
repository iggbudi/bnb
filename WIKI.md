# WBNB/USDT LP Analyzer — Wiki

Aplikasi edukasi untuk memantau dan menganalisis pool **WBNB/USDT PancakeSwap V3** di **BNB Smart Chain**.

## Pool yang Dipantau

| Properti     | Nilai                                        |
| ------------ | -------------------------------------------- |
| Pair         | WBNB/USDT                                    |
| DEX          | PancakeSwap V3                               |
| Chain        | BNB Smart Chain (`bsc`)                      |
| Pair address | `0x172fcD41E0913e95784454622d1c3724f546f849` |
| Fee tier     | 0,01% (`fee() = 100`)                        |
| Data source  | DexScreener pair API                         |

Fee tier diverifikasi langsung melalui fungsi `fee()` pada contract pool. Pool dipilih karena memiliki likuiditas dan volume tinggi di antara pool PancakeSwap V3 WBNB/USDT saat setup.

## Fitur

- Overview harga BNB, TVL, volume, fee, APR, transaksi, dan komposisi pool.
- Snapshot SQLite setiap menit, walaupun browser ditutup.
- Grafik dan statistik histori 1 jam, 24 jam, 7 hari, dan 30 hari.
- Maintenance storage saat startup dan setiap 24 jam: backup SQLite, retention snapshot, WAL checkpoint, dan retention backup.
- Simulator full-range 50/50 dan kalkulator impermanent loss.
- Analisis opsional GPT-5.6 Sol dengan reasoning medium dan konteks histori.
- Portfolio paper concentrated agresif bermodal awal US$50 dengan target +10%, stop −5%, fee on-chain, recenter terkendali, dan P&L aktual non-overlap.
- Agent directional paper long/short bermodal awal US$50 dan leverage 5×, dengan keputusan per menit, TP/SL, trailing stop, liquidation sintetis, fee, slippage, backtest, dan forward simulation tanpa API key trading; seluruh statusnya berada pada tab khusus **Perp Paper**. Konfigurasi `opposingExitAtBreakeven` (default off) membuat exit `OPPOSING_SIGNAL` terjadi di harga entry (breakeven) alih-alih harga pasar — tersedia di CLI backtest via `--breakeven`.
- Materi Belajar tentang HOLD vs LP, full-range vs agresif, out-of-range, recenter, risiko, dan cara membaca performa.

## Tech Stack

- Node.js >= 22.5
- Express + TypeScript
- Vanilla HTML/CSS/JavaScript
- Built-in `node:sqlite`
- DexScreener API
- OpenAI Responses API (opsional)

## Struktur

```text
bnb/
├── src/
│   ├── app/                   # Composition, config, migration/task registry, entry point
│   ├── features/              # Delapan vertical slice dan public API masing-masing
│   │   ├── market-data/
│   │   ├── lp-analysis/
│   │   ├── paper-agent/
│   │   ├── aggressive-paper/
│   │   ├── directional-paper/
│   │   ├── learning/
│   │   ├── lp-execution/
│   │   └── operations/
│   ├── shared/                # Database, HTTP, dan runtime primitives netral
│   └── *.test.ts              # Integration/architecture test lintas aplikasi
├── public/
│   ├── index.html
│   ├── styles.css
│   ├── app.js                # Bootstrap tab dan refresh lifecycle
│   ├── shared/               # API client dan helper format
│   └── features/             # Renderer/polling per fitur dashboard
├── scripts/                   # Background lifecycle untuk Termux
├── .github/workflows/ci.yml   # Lint, format, build, test, coverage, audit
├── data/                      # Database lokal, git-ignored
├── backups/                   # Backup harian, git-ignored
└── package.json
```

Detail boundary, public port, layer, schema bootstrap sebelum store, dan langkah menambah slice tersedia di [`docs/architecture.md`](docs/architecture.md). Graph runtime/type-only aktif berada di [`docs/feature-dependency-graph.md`](docs/feature-dependency-graph.md). Keputusan modular monolith dicatat di [`ADR-0001`](docs/adr/0001-vertical-slice-modular-monolith.md).

## API

Base URL default: `http://localhost:3001`

| Method | Endpoint                                 | Keterangan                                         |
| ------ | ---------------------------------------- | -------------------------------------------------- |
| GET    | `/api/health/live`                       | Liveness proses                                    |
| GET    | `/api/health/ready`                      | SQLite, migrasi, freshness, dan scheduler          |
| GET    | `/api/wbnbusdt`                          | Snapshot WBNB/USDT terbaru                         |
| GET    | `/api/history?hours=24&limit=1440`       | Histori mentah                                     |
| GET    | `/api/history/chart?hours=24&points=240` | Histori downsampled                                |
| GET    | `/api/history/stats`                     | Statistik 1h/24h/7d/30d                            |
| GET    | `/api/operations/storage`                | Retention, ukuran DB, WAL, dan backup              |
| GET    | `/api/simulate?amount=50`                | Estimasi LP full-range                             |
| GET    | `/api/il?from=550&to=600&invest=50`      | Kalkulator IL                                      |
| GET    | `/api/agent/high-risk-plan`              | Proyeksi range agresif saat ini                    |
| GET    | `/api/agent/aggressive-performance`      | P&L portfolio paper agresif dan lifecycle aktual   |
| GET    | `/api/agent/aggressive-positions/:id`    | Detail satu posisi agresif                         |
| GET    | `/api/agent/directional-performance`     | Equity, drawdown, posisi, dan keputusan long/short |
| GET    | `/api/agent/directional-positions/:id`   | Fill dan evaluasi satu posisi directional          |
| POST   | `/api/lp-analysis`                       | Analisis AI on-demand                              |

## Formula Utama

Untuk portfolio awal 50% WBNB dan 50% USDT:

```text
ratio      = harga_baru / harga_awal
HOLD value = investasi × (1 + ratio) / 2
LP value   = investasi × √ratio
IL loss    = HOLD value − LP value
IL %       = 1 − 2√ratio / (1 + ratio)
```

Estimasi fee dan APR:

```text
fee 24h = volume 24h × 0,0001
APR     = fee 24h × 365 / TVL × 100
```

Nilai tersebut adalah estimasi gross dan tidak memasukkan gas, perubahan TVL, waktu out-of-range, reward farm, atau biaya rebalance.

## SQLite

Database default:

```text
data/bnb-viewer.sqlite
```

Snapshot memiliki unique key per menit. Request berulang dalam menit yang sama melakukan upsert, bukan membuat duplikat.

Backup default:

```text
backups/bnb-viewer-YYYY-MM-DD.sqlite
```

Snapshot market dan on-chain di luar `SNAPSHOT_RETENTION_DAYS` dihapus otomatis setelah backup konsisten dibuat. Rentang konfigurasi yang diterima 30–90 hari. WAL menjalankan checkpoint `PASSIVE`; backup harian dibatasi 14–30 file, sedangkan backup audit bernama `pre-*` dipertahankan.

## Konfigurasi

```env
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6-sol
SQLITE_PATH=data/bnb-viewer.sqlite
SQLITE_BACKUP_DIR=backups
SNAPSHOT_RETENTION_DAYS=60
BACKUP_RETENTION_FILES=21
PORT=3001
HOST=127.0.0.1
CORS_ALLOWED_ORIGINS=http://127.0.0.1:3001,http://localhost:3001
TRUST_PROXY=false
AGGRESSIVE_PAPER_ENABLED=true
DIRECTIONAL_PAPER_ENABLED=true
LIVE_EXECUTION_ENABLED=false
```

`OPENAI_API_KEY` boleh kosong. Fitur live data, SQLite, simulator, dan IL tetap berfungsi tanpa OpenAI.

## Development

```bash
cd ~/bnb
npm install
npm test
npm run dev
```

Buka `http://localhost:3001`.

## Background Termux

```bash
npm run background:start
npm run background:status
npm run background:logs
npm run background:stop
```

Boot script: `~/.termux/boot/start-bnb-viewer.sh`.

Status background memvalidasi process command `node dist/app/server.js`, Git revision, build timestamp, expected/applied schema, dan readiness. Source saat ini memakai application schema v4 (`feature_schema_ownership_registry`); expected version dibaca dari build, bukan di-hard-code pada script. PID hidup saja tidak membuktikan deployment terbaru.

## Runbook Operasional

- Backup/build/stop/start, deteksi stale deployment, validasi migration/readiness/execution safety, dan rollback Termux: [`docs/runbook-termux-release.md`](docs/runbook-termux-release.md).
- Restore backup SQLite, rollback restore, pemeriksaan retention, dan recovery BSC RPC outage: [`docs/runbook-storage-and-rpc-recovery.md`](docs/runbook-storage-and-rpc-recovery.md).

Default deployment hanya localhost. `HOST=0.0.0.0` dibolehkan khusus LAN tepercaya yang dilindungi; jangan membuka service langsung ke internet. `TRUST_PROXY=true` hanya untuk satu reverse proxy tepercaya yang melakukan terminasi TLS dan normalisasi alamat client.

## Batasan

- DexScreener bukan sumber on-chain langsung dan dapat terlambat.
- Simulator utama tetap memodelkan posisi full-range; High Risk / High Gain planner di dashboard Agent menghitung kandidat concentrated range untuk target 10% net per 30 hari.
- Planner concentrated `conservative-7d-v2` memasukkan haircut fee 30%, protocol fee, gas lifecycle, maksimal empat recenter, slippage 10 bps per recenter, occupancy harga 7 hari, volume terendah antara kondisi 24 jam saat ini dan rata-rata rolling 7 hari, serta stress harga ±5%; angka planner tetap proyeksi.
- Panel Performa Paper Agresif berbeda dari proyeksi: ia mengelola satu portfolio aktual, memakai fee-growth on-chain hanya saat in-range, serta mencatat perubahan token, gas, slippage, stop, dan recenter. Dashboard membandingkan forecast dengan hasil siklus, tetapi evidence tetap `INSUFFICIENT_SAMPLE` sebelum minimal 30 posisi selesai dan 30 hari kalender; metrik ini tidak memiliki execution authority.
- Fee share simulator memakai liquidity aktif on-chain pada snapshot saat ini. Perubahan liquidity ketika harga melintasi tick belum dapat diprediksi.
- Directional paper memakai satu sampled close pool per menit, bukan candle OHLC atau feed perpetual native. Karena itu sentuhan TP/SL intramenit, mark/index spread, order book, dan funding exchange tidak tersedia; funding sementara diasumsikan 0.
- APR memakai volume 24 jam terakhir sebagai proyeksi sederhana dan tidak menjamin return berikutnya.
- Pool 0,01% bergantung pada volume tinggi untuk menghasilkan fee.
- WBNB memiliki nilai 1:1 terhadap BNB tetapi digunakan sebagai token BEP-20.
- USDT memiliki risiko issuer, regulasi, dan depeg.
- Analisis AI bersifat edukatif, bukan nasihat investasi.
