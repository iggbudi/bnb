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
- Backup SQLite saat startup dan setiap 24 jam.
- Simulator full-range 50/50 dan kalkulator impermanent loss.
- Analisis opsional GPT-5.6 Sol dengan reasoning medium dan konteks histori.
- Portfolio paper concentrated agresif bermodal awal US$50 dengan target +10%, stop −5%, fee on-chain, recenter terkendali, dan P&L aktual non-overlap.
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
│   ├── server-bnb.ts          # Bootstrap listener dan shutdown
│   ├── bnb-app.ts             # Express app/runtime tanpa listen atau timer
│   ├── bnb-routes.ts          # System routes dan frontend/error fallback
│   ├── bnb-services.ts        # Lifecycle seluruh SQLite store
│   ├── bnb-schedulers.ts      # Timer dan initial background cycles
│   ├── schema-migrations.ts   # Migrasi SQLite berurutan dan idempotent
│   ├── dexscreener.ts         # Integrasi DexScreener
│   ├── amm.ts                 # IL dan analisis AMM
│   ├── snapshot-store.ts      # SQLite, statistik, chart, backup
│   ├── openai-analysis.ts     # GPT structured analysis
│   └── *.test.ts
├── public/
│   ├── index.html
│   ├── styles.css
│   ├── api-client.js
│   └── dashboard.js
├── scripts/                   # Background lifecycle untuk Termux
├── .github/workflows/ci.yml   # Lint, format, build, test, coverage, audit
├── data/                      # Database lokal, git-ignored
├── backups/                   # Backup harian, git-ignored
└── package.json
```

## API

Base URL default: `http://localhost:3001`

| Method | Endpoint                                 | Keterangan                                       |
| ------ | ---------------------------------------- | ------------------------------------------------ |
| GET    | `/api/health/live`                       | Liveness proses                                  |
| GET    | `/api/health/ready`                      | SQLite, migrasi, freshness, dan scheduler        |
| GET    | `/api/wbnbusdt`                          | Snapshot WBNB/USDT terbaru                       |
| GET    | `/api/history?hours=24&limit=1440`       | Histori mentah                                   |
| GET    | `/api/history/chart?hours=24&points=240` | Histori downsampled                              |
| GET    | `/api/history/stats`                     | Statistik 1h/24h/7d/30d                          |
| GET    | `/api/simulate?amount=50`                | Estimasi LP full-range                           |
| GET    | `/api/il?from=550&to=600&invest=50`      | Kalkulator IL                                    |
| GET    | `/api/agent/high-risk-plan`              | Proyeksi range agresif saat ini                  |
| GET    | `/api/agent/aggressive-performance`      | P&L portfolio paper agresif dan lifecycle aktual |
| GET    | `/api/agent/aggressive-positions/:id`    | Detail satu posisi agresif                       |
| POST   | `/api/lp-analysis`                       | Analisis AI on-demand                            |

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

Tidak ada penghapusan history otomatis.

## Konfigurasi

```env
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6-sol
SQLITE_PATH=data/bnb-viewer.sqlite
SQLITE_BACKUP_DIR=backups
PORT=3001
AGGRESSIVE_PAPER_ENABLED=true
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

## Batasan

- DexScreener bukan sumber on-chain langsung dan dapat terlambat.
- Simulator utama tetap memodelkan posisi full-range; High Risk / High Gain planner di dashboard Agent menghitung kandidat concentrated range untuk target 10% net per 30 hari.
- Planner concentrated memasukkan haircut fee 30%, protocol fee, gas lifecycle, maksimal empat recenter, slippage 10 bps per recenter, occupancy harga 24 jam, dan stress harga ±5%; angka planner tetap proyeksi.
- Panel Performa Paper Agresif berbeda dari proyeksi: ia mengelola satu portfolio aktual, memakai fee-growth on-chain hanya saat in-range, serta mencatat perubahan token, gas, slippage, stop, dan recenter. Data awal belum membuktikan target bulanan.
- Fee share simulator memakai liquidity aktif on-chain pada snapshot saat ini. Perubahan liquidity ketika harga melintasi tick belum dapat diprediksi.
- APR memakai volume 24 jam terakhir sebagai proyeksi sederhana dan tidak menjamin return berikutnya.
- Pool 0,01% bergantung pada volume tinggi untuk menghasilkan fee.
- WBNB memiliki nilai 1:1 terhadap BNB tetapi digunakan sebagai token BEP-20.
- USDT memiliki risiko issuer, regulasi, dan depeg.
- Analisis AI bersifat edukatif, bukan nasihat investasi.
