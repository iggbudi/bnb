# Runbook Storage, Restore Backup, dan RPC Outage

Dokumen ini untuk operator BNB LP Analyzer. Semua prosedur mempertahankan prinsip fail-closed: **jangan mengaktifkan live execution, jangan melepas kill switch, dan jangan mereset Shadow hanya untuk membuat readiness hijau**.

## 1. Pemeriksaan Harian

```bash
npm run background:status
curl -fsS http://127.0.0.1:3001/api/health/ready
curl -fsS http://127.0.0.1:3001/api/operations/storage
curl -fsS http://127.0.0.1:3001/api/shadow/status
```

Pastikan:

- `checks.sqlite`, `checks.schemaMigrations`, `checks.schedulers`, dan freshness bernilai `ready=true`.
- Scheduler `storage-maintenance` memiliki `lastSuccessAt` dan `lastError=null`.
- `lastResult.walCheckpoint.busy=0` atau kembali 0 pada siklus berikutnya.
- `dailyFiles` tidak melebihi `BACKUP_RETENTION_FILES`.
- Shadow `errorHours=0`; outage upstream tidak boleh disamarkan sebagai bukti valid.

## 2. Kebijakan Retention

- `SNAPSHOT_RETENTION_DAYS`: 30–90 hari, default 60.
- `BACKUP_RETENTION_FILES`: 14–30 backup harian, default 21.
- Hanya file bernama `bnb-viewer-YYYY-MM-DD.sqlite` yang dipangkas otomatis.
- Backup audit seperti `bnb-viewer-pre-p0-*` dan `bnb-viewer-pre-p2-*` dilindungi dari retention otomatis.
- Maintenance harian membuat backup konsisten **sebelum** menghapus snapshot lama, lalu menjalankan WAL checkpoint `PASSIVE`.

Perubahan nilai dilakukan di `.env`, kemudian restart tertib:

```bash
npm run background:stop
npm run background:start
curl -fsS http://127.0.0.1:3001/api/health/ready
```

## 3. Restore Backup SQLite

### 3.1 Pilih dan verifikasi backup tanpa menyentuh database aktif

```bash
cd /data/data/com.termux/files/home/bnb
ls -lh backups/*.sqlite
BACKUP="backups/bnb-viewer-YYYY-MM-DD.sqlite"
node - "$BACKUP" <<'NODE'
const { DatabaseSync } = require('node:sqlite');
const path = process.argv[2];
const database = new DatabaseSync(path, { readOnly: true });
console.log(database.prepare('PRAGMA quick_check').get());
console.log(database.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all());
database.close();
NODE
```

Lanjutkan hanya jika `quick_check` menghasilkan `ok`. Backup lama yang belum mempunyai `schema_migrations` boleh dipulihkan, tetapi startup berikutnya harus menerapkan migrasi dan readiness harus kembali hijau.

### 3.2 Hentikan server dan simpan database rusak/bermasalah

```bash
npm run background:stop
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
cp -p data/bnb-viewer.sqlite "backups/bnb-viewer-before-restore-${STAMP}.sqlite"
```

Pastikan proses benar-benar berhenti sebelum mengganti file:

```bash
npm run background:status || true
```

### 3.3 Pulihkan file utama

```bash
cp -p "$BACKUP" data/bnb-viewer.sqlite.restore
mv data/bnb-viewer.sqlite.restore data/bnb-viewer.sqlite
rm -f data/bnb-viewer.sqlite-wal data/bnb-viewer.sqlite-shm
```

Jangan menyalin database aktif ketika server masih berjalan. Jangan memulihkan hanya file `-wal` atau `-shm` dari waktu berbeda.

### 3.4 Start dan validasi

```bash
npm run background:start
curl -fsS http://127.0.0.1:3001/api/health/live
curl -fsS http://127.0.0.1:3001/api/health/ready
curl -fsS http://127.0.0.1:3001/api/execution/status
curl -fsS http://127.0.0.1:3001/api/shadow/status
```

Validasi wajib:

1. SQLite `quick_check=ok` dan schema migration berada pada versi aplikasi saat ini.
2. Live execution tetap `false`, mode `LOCKED`, kill switch engaged, dan broadcast tidak tersedia.
3. Tinjau run Shadow yang dipulihkan. Jangan menggabungkan atau backdate observasi yang hilang.
4. Jika backup mengembalikan accounting/strategy lama, lakukan audit kompatibilitas sebelum memakai bukti Shadow. Reset hanya melalui endpoint/prosedur teraudit dengan alasan yang benar.

### 3.5 Rollback restore

Jika hasil restore gagal, hentikan server dan kembalikan file `bnb-viewer-before-restore-*` dengan prosedur yang sama. Simpan kedua file untuk investigasi; jangan menimpa backup sumber.

## 4. Recovery BSC RPC Outage

### 4.1 Gejala

- `/api/health/live` tetap 200 tetapi `/api/health/ready` menjadi 503.
- `onchainFreshness.ready=false` atau scheduler `onchain-snapshot`/`paper-lifecycle` mempunyai `lastError`.
- Endpoint `/api/onchain/pool` mengembalikan typed timeout, HTTP upstream, malformed RPC, atau network error.

### 4.2 Tindakan awal

1. Jangan mengaktifkan live execution atau `PAPER_ACTIVE` untuk melewati outage.
2. Jangan menghapus error Shadow dan jangan membuat checkpoint fee buatan.
3. Periksa konektivitas tanpa mencetak credential RPC:

```bash
node --input-type=module <<'NODE'
import 'dotenv/config';
const response = await fetch(process.env.BSC_RPC_URL, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
  signal: AbortSignal.timeout(10_000),
});
const body = await response.json();
console.log({ httpStatus: response.status, chainId: body.result, rpcErrorCode: body.error?.code });
NODE
```

Chain ID BSC mainnet harus `0x38`. Jangan menampilkan `BSC_RPC_URL` bila URL mengandung token.

### 4.3 Ganti endpoint RPC

- Pilih endpoint BSC mainnet tepercaya yang mendukung JSON-RPC batch.
- Ubah hanya `BSC_RPC_URL` di `.env`; jangan menaruh credential di dokumentasi, log, query browser, atau Git.
- Restart tertib:

```bash
npm run background:stop
npm run background:start
```

### 4.4 Validasi pemulihan

```bash
curl -fsS http://127.0.0.1:3001/api/onchain/pool
curl -fsS http://127.0.0.1:3001/api/health/ready
curl -fsS http://127.0.0.1:3001/api/shadow/status
```

Pastikan chain ID 56, pool/token/fee contract tervalidasi, snapshot on-chain kembali fresh, dan scheduler kembali sukses. Jam yang kehilangan checkpoint tetap menjadi gap/error sesuai lifecycle; jangan direkonstruksi dari data saat ini.

### 4.5 Eskalasi

Jika beberapa RPC tepercaya gagal atau memberikan block/ABI malformed:

- Pertahankan server dalam mode read-only/fail-closed.
- Simpan timestamp outage dan kategori error, tanpa URL/credential.
- Bandingkan block number dari dua provider sebelum menerima provider baru.
- Jangan menjalankan mint/exit verification yang bergantung pada receipt sampai RPC konsisten. Jalur exit tetap tersedia untuk persiapan, tetapi verifikasi on-chain harus fail closed.
