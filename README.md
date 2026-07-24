# 📊 WBNB/USDT LP Analyzer

Web app khusus untuk analisis **WBNB/USDT** di PancakeSwap V3 BNB Smart Chain.

Pool: `0x172fcD41E0913e95784454622d1c3724f546f849` · fee tier **0,01%** (`fee() = 100`).

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Konfigurasi OpenAI
cp .env.example .env
# Isi OPENAI_API_KEY di .env

# Run development server
npm run dev

# Buka browser: http://localhost:3001
```

## 🔄 Background Mode (Termux)

```bash
npm run background:start   # build dan jalankan di background
npm run background:status  # cek PID dan health endpoint
npm run background:logs    # ikuti server log
npm run background:stop    # hentikan background server
```

Script boot tersedia di `~/.termux/boot/start-bnb-viewer.sh`. Install **Termux:Boot dari sumber/signing yang sama dengan aplikasi Termux**, buka sekali, dan nonaktifkan battery optimization. Instalasi ini memakai Termux GitHub build, sehingga add-on harus memakai APK `github.debug` dari GitHub Releases—jangan mencampurnya dengan build F-Droid.

## 🔒 Mode Deployment

- **Localhost (default):** `HOST=127.0.0.1`; origin browser localhost dicantumkan di `CORS_ALLOWED_ORIGINS`.
- **LAN tepercaya:** gunakan `HOST=0.0.0.0`, tambahkan origin UI LAN secara eksplisit, dan lindungi perangkat/firewall. Jangan membuka port langsung ke internet.
- **Reverse proxy:** tetap utamakan bind localhost, terminasi TLS di proxy, dan set `TRUST_PROXY=true` hanya bila tepat satu proxy tepercaya berada di depan aplikasi. Jangan percaya header forwarded dari jaringan publik.
- API memakai security headers, body limit 32 KiB, rate limit global/AI, limit concurrency RPC, dan limit admin exit terpisah agar jalur pengurangan risiko tidak ikut habis oleh trafik publik.
- Probe: `/api/health/live` hanya memeriksa proses; `/api/health/ready` memeriksa SQLite, freshness market/on-chain, scheduler macet, dan status shutdown.

## 🧱 Struktur Aplikasi dan Quality Gates

- `src/server-bnb.ts` hanya melakukan bootstrap listen dan graceful shutdown.
- `src/bnb-app.ts` merakit aplikasi HTTP dan runtime tanpa memulai listener atau timer ketika di-import oleh test.
- `src/bnb-routes.ts`, `src/bnb-services.ts`, dan `src/bnb-schedulers.ts` memisahkan system routes, lifecycle store/service, dan scheduler.
- `src/schema-migrations.ts` menjalankan migrasi SQLite berurutan dan idempotent melalui tabel `schema_migrations`; kegagalan satu migrasi di-rollback atomik.
- Frontend dipisah menjadi `public/index.html`, `public/styles.css`, `public/api-client.js`, dan `public/dashboard.js`.
- `npm run check` menjalankan ESLint, Prettier check, TypeScript build, seluruh unit/integration test, dan coverage threshold. Workflow yang sama tersedia di `.github/workflows/ci.yml`.

## 🎯 Fitur

### 1. 📊 Overview

- Harga BNB real-time
- Pool metrics (TVL, Volume, Fee, APR)
- Pool composition (WBNB & USDT)
- Price change (1h, 6h, 24h)
- Grafik histori harga, TVL, dan APR untuk 1 jam hingga 30 hari
- Statistik coverage, perubahan, dan rata-rata historis
- Analisis kelayakan GPT-5.6 Sol prompt v2.7 dengan pemisahan pool feasibility, paper-agent readiness, execution readiness, dan safety blockers

### 2. 💰 LP Simulator

- Simulasi full-range 50/50 berdasarkan investasi
- Porsi fee memakai liquidity aktif PancakeSwap V3 on-chain, bukan pro-rata TVL
- Protocol fee PancakeSwap dan estimasi gas entry/exit ikut diperhitungkan
- P/L terhadap modal dipisahkan dari selisih performa terhadap HOLD
- IL scenarios untuk berbagai perubahan harga

### 3. 💧 IL Calculator

- Hitung Impermanent Loss
- Bandingkan Hold vs LP

### 4. 🧠 Paper Agent Fase 1–5

- Membuat maksimal satu keputusan immutable setiap jam
- Modal simulasi tetap US$100 dengan aksi operasional `WAIT` atau `ENTER_FULL_RANGE`
- High Risk / High Gain planner menghitung concentrated range terlebar yang masih menargetkan 10% net per 30 hari setelah haircut fee, protocol fee, gas, maksimal empat recenter, dan slippage
- Portfolio paper agresif terpisah memakai modal awal US$50, satu posisi aktual tanpa sinyal overlap, target +10%, hard stop −5%, konfirmasi out-of-range 60 menit, maksimal empat recenter, dan exit setelah dua siklus recenter merugi
- Estimasi fee paper teramati memakai delta `feeGrowthGlobal` on-chain dikalikan occupancy in-range; nilai token mengikuti kurva concentrated V3 dan seluruh gas/slippage masuk net liquidation value
- Modal net dikompaun antar-siklus setelah cooldown 6 jam; exit risiko memakai cooldown 24 jam; live concentrated execution tetap dinonaktifkan
- Menyimpan fitur pasar, prediksi fee/IL, confidence, alasan, dan versi strategi ke SQLite
- Lifecycle baseline v2.1 hanya dapat entry setelah coverage histori 7 hari mencapai 80% dan proyeksi fee dari share active liquidity V3 menutup IL stress, gas entry/exit, serta minimum edge US$0,01
- Mengevaluasi sinyal secara otomatis setelah 1h, 6h, 24h, dan 7d
- Raw outcome dan economic assessment v1 tetap immutable untuk audit
- Lifecycle interpretation v2 menjadikan 1h/6h/24h `DIAGNOSTIC_EARLY`; hanya 168h dari kebijakan lifecycle-v2/model kompatibel menjadi verdict entry untuk akurasi, training, reward, dan refleksi; sinyal baseline-v1 historis tetap diagnostik
- Jalur default dimulai/berakhir dengan USDT/WBNB seimbang: mint/withdraw dihitung dengan gas 600k/800k unit tanpa slippage swap implisit; slippage hanya dihitung jika proposal meminta swap opsional
- `WAIT/DATA_INSUFFICIENT` serta invalid-data waits diklasifikasikan `ABSTAINED_SAFETY`, bukan salah; dikeluarkan dari denominator akurasi, training, dan refleksi
- Evaluasi membutuhkan coverage snapshot minimal 80%; gap data ditandai dan tidak layak untuk training
- Dashboard web menampilkan status, sinyal terbaru, performa per horizon, outcome, dan 24 sinyal terakhir
- Logistic regression transparan dilatih dari verdict entry 168h dengan purged expanding walk-forward validation
- Aktivasi otomatis membutuhkan ≥336 verdict, dua kelas ≥10 sampel, akurasi ≥55%, unggul ≥2% dari baseline, Brier score <0,25, dan purge overlap 168 baris
- Retraining dilakukan setiap tambahan 24 outcome; kandidat harus memperbaiki model aktif minimal 1%
- Hard safety gate tetap berlaku dan tidak dapat dioverride model
- GPT membuat refleksi terstruktur hanya dari verdict entry 168h: apa yang benar/salah, error prediksi, lesson, dan future checks
- Memori refleksi disimpan di SQLite dan dimasukkan sebagai konteks kualitatif pada keputusan serta analisis AI berikutnya
- Refleksi tidak memiliki decision authority dan tidak dapat mengubah hard safety gate atau mengaktifkan model
- Masih paper mode; model learning baru aktif otomatis setelah seluruh gate terpenuhi

#### Position Lifecycle — Tahap A–G

- Schema additive `paper_positions`, `position_actions`, `position_evaluations`, dan `position_events`
- State machine: `PENDING_ENTRY → OPEN → PENDING_EXIT → CLOSED/EMERGENCY_EXITED`
- Maksimal satu posisi aktif dijaga oleh unique partial index SQLite
- Sinyal hourly `ENTER_FULL_RANGE` membuka satu paper position; sinyal berikutnya menjadi lifecycle `HOLD`
- Mark-to-market dicatat per jam; fee full-range berasal dari delta `feeGrowthGlobal` V3 dan liquidity posisi dengan checkpoint block yang auditable, bukan pro-rata TVL
- Gas entry dicatat satu kali, gas per jam selalu nol, dan estimasi gas exit masuk net P&L
- Review hari ke-7 mempertahankan paper position; hari ke-14 menutupnya untuk lifecycle label
- Cooldown entry baru 24 jam setelah posisi ditutup
- Tab **Position** menampilkan progress 7/14 hari, mark-to-market, gas lifecycle, token composition, action timeline, evaluations, dan audit transisi
- Dashboard memilih posisi aktif atau histori terbaru dan refresh otomatis setiap menit
- Receipt mint external-wallet diverifikasi terhadap chain 56, status sukses, immutable plan hash/reference block, proposal/wallet/amount/deadline binding, Position Manager resmi, calldata full-range, NFT `Transfer`, `IncreaseLiquidity`, dan minimum 3 konfirmasi
- Setelah verifikasi, `ownerOf(tokenId)` dan `positions(tokenId)` menyimpan owner, liquidity, ticks, fee-growth checkpoint, token owed, actual amount, serta actual gas; paper shadow position dari decision yang sama dipromosikan menjadi LIVE agar tidak menduplikasi posisi aktif
- Exit LIVE memakai proposal terpisah dengan approval manual, expiry, verifikasi ulang owner/liquidity, slippage 0,1–5%, dan deadline maksimum 30 menit
- Planner menghasilkan dan menyimpan immutable calldata unsigned berurutan untuk `decreaseLiquidity`, `collect`, optional `burn`, serta optional approve + exact-input WBNB→USDT melalui PancakeSwap V3 SwapRouter resmi
- Emergency stop tidak menghalangi persiapan exit yang mengurangi risiko; semua transaksi tetap harus ditandatangani satu per satu oleh owner wallet; receipt berurutan kemudian diverifikasi untuk menutup posisi dan mengisi realized P&L/daily-loss gate
- Stage F dipatok ke mode DB-backed `SHADOW` minimal 14 hari; setiap jam menyimpan heartbeat sinyal/action/position/evaluation secara idempotent
- Shadow gate membutuhkan durasi 336 jam, coverage ≥95%, tanpa processing error, minimal satu paper position selesai 14 hari, dan final evaluation valid; reset beralasan memulai periode baru tanpa backdate
- Stage G menyediakan aktivasi eksplisit `SHADOW → PAPER_ACTIVE` yang hanya menerima run qualified, Bearer admin token, alasan, dan `confirmPaperOnly=true`
- Aktivasi hanya mengubah paper lifecycle; tidak mengubah live flag, kill switch, signer, broadcast, atau safety gate execution
- Kehilangan shadow qualification setelah aktivasi memicu fail-closed rollback otomatis ke `SHADOW`; rollback manual juga tersedia dan teraudit
- `SHADOW_VALIDATION_NOT_QUALIFIED` dan `PAPER_LIFECYCLE_NOT_ACTIVE` menjadi blocker live-entry tambahan; exit yang mengurangi risiko tetap terpisah
- `POSITION_LIFECYCLE_ENABLED=true`; status saat ini tetap SHADOW karena Stage F belum qualified

### 5. ⛓️ PancakeSwap V3 On-chain (Fase 6)

- Membaca pool langsung dari BSC RPC pada block yang konsisten
- Memverifikasi chain ID, token0 USDT, token1 WBNB, fee 100, tick spacing, slot0, current tick, active liquidity, dan lock state
- Menghitung range tick/harga ±2%, ±5%, ±10% beserta status in-range
- Membaca feeGrowthGlobal dan feeGrowthInside checkpoint untuk setiap range
- Menyimpan histori tick/liquidity/fee growth/gas setiap lima menit
- Mengestimasi biaya mint/rebalance dari gas price dengan asumsi unit gas konservatif
- Adapter bersifat read-only; fee checkpoint bukan fee milik posisi tanpa NFT/liquidity dan baseline feeGrowthLast

### 6. 🔐 Live Execution Control (Fase 7)

- Default `LOCKED` dengan emergency stop aktif
- Readiness gate: feature flag, admin token, adapter transaksi on-chain, model aktif, ≥336 verdict entry 168h, akurasi 168h ≥60%, keputusan model terbaru, dan daily-loss limit
- Batas modal, batas loss harian, expiry proposal, manual approval, dan audit SQLite
- Server tidak menerima/menyimpan private key atau seed phrase
- Setelah approval, adapter dapat menyiapkan calldata unsigned untuk approve USDT, approve WBNB, dan mint full-range di PancakeSwap V3 Position Manager resmi
- Wallet balance/allowance dibaca on-chain; slippage dibatasi 10–500 bps dan plan memakai deadline 10 menit
- Signing dan broadcast hanya melalui external wallet; server tetap tidak memiliki private key
- Agent belum dilatih untuk concentrated range, sehingga execution adapter hanya mengizinkan full-range yang konsisten dengan paper outcome

### 7. 📖 Belajar

- Dua jalur paper: full-range US$100 dan portfolio concentrated agresif bermodal awal US$50
- Cara agent memilih range ±0,25–2% untuk target 10% net, tanpa menjanjikan hasil
- Lifecycle agresif: fee-growth on-chain, occupancy, perubahan komposisi token, konfirmasi out-of-range 60 menit, recenter, target, stop, dan cooldown
- Cara membedakan proyeksi planner, diagnostik sinyal overlap, dan P&L portfolio aktual
- Risiko out-of-range, gas, slippage, smart contract, API, dan stablecoin
- Rutinitas membaca data quality, nilai jika exit, net P&L, fee, biaya, recenter, serta max drawdown

## 📖 API Endpoints

| Endpoint                                                  | Description                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `/api/health/live`                                        | Liveness proses tanpa dependency check                                               |
| `/api/health/ready`                                       | Readiness SQLite, freshness data, scheduler, dan shutdown                            |
| `/api/wbnbusdt`                                           | Data WBNB/USDT terkini dan simpan snapshot per menit                                 |
| `/api/history?hours=24&limit=1440`                        | Histori mentah dari SQLite                                                           |
| `/api/history/chart?hours=24&points=240`                  | Histori yang di-downsample untuk grafik                                              |
| `/api/history/stats`                                      | Statistik agregat 1h, 24h, 7d, dan 30d                                               |
| `/api/onchain/pool`                                       | State pool V3, range tick, fee growth, dan estimasi gas                              |
| `/api/onchain/history?limit=100`                          | Histori snapshot read-only on-chain                                                  |
| `/api/simulate?amount=10000`                              | Simulasi LP                                                                          |
| `/api/positions/status`                                   | Status, policy, latest action, dan posisi aktif lifecycle Tahap C                    |
| `/api/positions/:id`                                      | Detail posisi, NFT live, exit proposals, actions, evaluations, dan event timeline    |
| `/api/lifecycle/activation`                               | State, eligibility, dan audit aktivasi paper Stage G                                 |
| `POST /api/lifecycle/activate-paper`                      | Aktivasi paper-only setelah Stage F qualified; membutuhkan admin token               |
| `POST /api/lifecycle/return-to-shadow`                    | Rollback manual fail-closed; optional reset shadow run                               |
| `/api/shadow/status`                                      | Progress, coverage, blocker, dan qualification Stage F                               |
| `/api/shadow/observations?limit=336`                      | Heartbeat hourly shadow run aktif                                                    |
| `POST /api/shadow/reset`                                  | Reset beralasan ke run 14 hari baru; membutuhkan admin token                         |
| `/api/agent/status`                                       | Status dan keputusan terbaru paper agent                                             |
| `/api/agent/high-risk-plan`                               | Proyeksi range concentrated agresif saat ini                                         |
| `/api/agent/aggressive-performance`                       | P&L portfolio paper agresif, posisi, evaluasi, fee, biaya, drawdown, dan aksi        |
| `/api/agent/aggressive-positions/:id`                     | Detail lifecycle satu posisi paper agresif                                           |
| `/api/agent/decisions?limit=24`                           | Histori keputusan paper agent terbaru                                                |
| `/api/agent/outcomes?horizon=168&limit=100`               | Raw outcome immutable + legacy assessment + lifecycle interpretation beserta sinyal  |
| `/api/agent/performance?horizon=168`                      | Verdict 7d, diagnostics, abstention, lifecycle cost, reward, dan regret              |
| `/api/agent/models`                                       | Progress training, gate aktivasi, model aktif, dan histori versi model               |
| `/api/agent/reflections?limit=20`                         | Status worker dan memori refleksi verdict entry 168h                                 |
| `/api/execution/status`                                   | Readiness, blocker, emergency stop, limit, dan proposal                              |
| `/api/execution/audit?limit=50`                           | Audit control plane execution                                                        |
| `POST /api/execution/kill-switch`                         | Ubah emergency stop; membutuhkan Bearer admin token                                  |
| `POST /api/execution/proposals`                           | Buat proposal jika seluruh gate lulus; membutuhkan admin token                       |
| `POST /api/execution/proposals/:id/review`                | Approve/reject manual tanpa signing/broadcast                                        |
| `POST /api/execution/proposals/:id/transaction-plan`      | Siapkan approve + mint calldata unsigned dan ikat proposal ke wallet                 |
| `POST /api/execution/proposals/:id/mint-receipt`          | Verifikasi tx hash mint, receipt, NFT ownership, dan `positions(tokenId)`            |
| `POST /api/execution/exit-proposals`                      | Buat proposal exit untuk posisi LIVE terverifikasi                                   |
| `POST /api/execution/exit-proposals/:id/review`           | Approve/reject proposal exit secara manual                                           |
| `POST /api/execution/exit-proposals/:id/transaction-plan` | Siapkan dan simpan immutable calldata unsigned decrease, collect, optional burn/swap |
| `POST /api/execution/exit-proposals/:id/receipts`         | Verifikasi receipt exit berurutan, tutup posisi LIVE, dan settle realized P&L        |
| `POST /api/lp-analysis`                                   | Analisis kelayakan LP dengan OpenAI                                                  |
| `/api/il?from=550&to=600&invest=50`                       | Hitung IL                                                                            |

## 🔧 Tech Stack

- **Backend:** Express + TypeScript
- **Frontend:** Vanilla HTML/CSS/JS
- **API:** DexScreener dan BNB Smart Chain JSON-RPC read-only
- **AI:** OpenAI Responses API, GPT-5.6 Sol, reasoning medium
- **Database:** SQLite melalui modul bawaan `node:sqlite`
- **Cache:** Data pool 1 menit; analisis AI 15 menit
- **Persistence:** Server menyimpan snapshot saat startup dan setiap menit, maksimal satu record per menit
- **Paper agent:** Scheduler diperiksa setiap menit dan menyimpan maksimal satu sinyal full-range per jam (`lifecycle-v2.1`)
- **Aggressive paper:** Ledger SQLite terpisah (`concentrated-aggressive-v1.0`) mengelola satu portfolio US$50 dan mengevaluasinya per jam dari state on-chain
- **Position lifecycle:** Tahap G full-range control plane terpasang, tetapi runtime tetap SHADOW sampai Stage F qualified dan aktivasi paper-only disetujui eksplisit
- **Outcome evaluator:** Memeriksa keputusan jatuh tempo setiap menit; fee counterfactual full-range dihitung dari delta `feeGrowthGlobal` V3 dan liquidity posisi antara checkpoint entry/target
- **Learning engine:** Logistic regression tanpa framework eksternal, standardisasi train-only, purged expanding walk-forward validation, L2 regularization, dan model versioning SQLite
- **Reflection engine:** OpenAI structured output untuk kritik verdict entry 168h; maksimal tiga outcome pending diproses per siklus per jam
- **On-chain adapter:** Raw JSON-RPC/ABI read-only tanpa dependency Web3, cache 1 menit, snapshot 5 menit
- **Execution control:** SQLite emergency stop/proposal/audit, constant-time admin token comparison, default locked, unsigned Pancake V3 full-range calldata, tanpa wallet signer
- **Backup:** Backup SQLite konsisten dibuat saat startup dan setiap 24 jam di `backups/`; history tidak dihapus otomatis

## 📊 Data Source

Data market diambil dari **DexScreener API**:

- Real-time price
- Pool metrics
- Volume & liquidity
- Transaction counts

Data contract dibaca dari **BNB Smart Chain JSON-RPC**:

- slot0/current tick dan active liquidity
- fee growth global/inside
- tick boundary dan gas price
- Seluruh panggilan bersifat read-only `eth_call`

## 💡 Strategi LP

### Concentrated Liquidity (PancakeSwap V3)

| Strategi | Range | Karakteristik                                     |
| -------- | ----- | ------------------------------------------------- |
| Lebar    | ±10%  | Lebih lama in-range, efisiensi modal lebih rendah |
| Menengah | ±5%   | Kompromi durasi dan konsentrasi modal             |
| Sempit   | ±2%   | Lebih cepat out-of-range, perlu monitoring aktif  |

### Tips

1. Monitor harga setiap hari
2. Rebalance kalau keluar range
3. Compound fee ke posisi
4. Sisakan BNB untuk gas dan hitung biaya rebalance

## ⚠️ Disclaimer

- Tool ini untuk **belajar**, bukan nasihat investasi
- Data dari API publik, bisa ada delay
- APR adalah **estimasi**, bukan jaminan
- **Selalu DYOR** (Do Your Own Research)

---

**Selamat belajar! 🚀**
