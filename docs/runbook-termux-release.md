# Runbook Release Termux dan Pemulihan Stale Deployment

Runbook ini adalah prosedur aktif untuk release BNB LP Analyzer di Termux. Prinsip wajib: **backup dahulu, satu process saja, migration additive, dan execution tetap fail-closed**. Service tidak boleh diekspos langsung ke internet.

## Identitas yang Wajib Cocok

Deployment sehat harus melaporkan dan memvalidasi:

- process command `node dist/app/server.js`;
- Git revision yang sama dengan `git rev-parse HEAD`;
- build timestamp yang diinjeksikan `scripts/start-background.sh`;
- expected dan applied application schema version yang sama;
- readiness seluruh critical check hijau.

`scripts/status-background.sh` memeriksa seluruh identitas tersebut. PID yang hidup atau liveness HTTP saja tidak cukup.

## 1. Preflight dan Safety Baseline

```bash
cd /data/data/com.termux/files/home/bnb
git status --short --branch
npm run background:status
curl -fsS http://127.0.0.1:3001/api/health/ready > logs/pre-release-readiness.json
curl -fsS http://127.0.0.1:3001/api/execution/status > logs/pre-release-execution.json
curl -fsS http://127.0.0.1:3001/api/shadow/status > logs/pre-release-shadow.json
```

Sebelum lanjut, pastikan:

- working tree hanya berisi perubahan release yang memang akan di-build;
- live execution `false`, mode execution `LOCKED`, kill switch engaged;
- server tidak memiliki private key, signing authority, atau broadcast authority;
- lifecycle mode dan Shadow run ID telah dicatat agar drift terlihat setelah restart.

Jangan memakai release untuk melepas safety gate atau mereset Shadow.

## 2. Buat dan Verifikasi Backup Konsisten

`cp` langsung pada database WAL yang aktif tidak menjamin backup konsisten. Gunakan SQLite backup API:

```bash
STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
BACKUP="backups/bnb-viewer-pre-release-${STAMP}.sqlite"
node --input-type=module - "$BACKUP" <<'NODE'
import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

const target = process.argv[2];
const source = resolve(process.env.SQLITE_PATH || 'data/bnb-viewer.sqlite');
mkdirSync(dirname(target), { recursive: true });
const database = new DatabaseSync(source);
try {
  await backup(database, target);
} finally {
  database.close();
}
console.log(target);
NODE

node - "$BACKUP" <<'NODE'
const { DatabaseSync } = require('node:sqlite');
const database = new DatabaseSync(process.argv[2], { readOnly: true });
console.log(database.prepare('PRAGMA quick_check').get());
console.log(database.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all());
database.close();
NODE
rm -f "$BACKUP-wal" "$BACKUP-shm"
```

Pembukaan backup WAL-mode untuk verifikasi dapat membuat sidecar kosong; hapus hanya sidecar milik **backup yang sudah ditutup**, bukan sidecar database aktif. Jangan lanjut jika `quick_check` bukan `ok`. Simpan path backup di catatan release.

## 3. Quality Gate dan Build

```bash
npm ci
npm run check
npm audit --omit=dev
```

`npm run check` sudah mencakup lint, format check, TypeScript build, test, coverage threshold, architecture graph, dan documentation guardrail. Jangan mengandalkan test count hard-coded; gunakan hasil command/CI untuk revision yang akan dirilis.

## 4. Stop, Start, dan Cegah Process Ganda

```bash
npm run background:stop
npm run background:status || true
npm run background:start
```

`background:start` membangun source aktif lalu menginjeksikan `BNB_RELEASE_REVISION` dan `BNB_BUILD_TIMESTAMP`. Jangan menjalankan `node dist/...` manual bersamaan dengan script background.

Jika stop melampaui graceful timeout, simpan log dan cari request/scheduler macet sebelum start ulang. Pastikan tidak ada listener/process lama yang tertinggal:

```bash
cat run/server.pid
ps -A -o pid,args | grep '[n]ode dist/app/server.js'
```

Harus ada tepat satu process aplikasi.

## 5. Validasi Identity, Migration, dan Readiness

```bash
npm run background:status
curl -fsS http://127.0.0.1:3001/api/health/live
curl -fsS http://127.0.0.1:3001/api/health/ready
node --input-type=module <<'NODE'
import 'dotenv/config';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const database = new DatabaseSync(resolve(process.env.SQLITE_PATH || 'data/bnb-viewer.sqlite'));
console.log(database.prepare('PRAGMA quick_check').get());
console.log(database.prepare(`
  SELECT version, name, COUNT(*) AS count
  FROM schema_migrations
  GROUP BY version, name
  ORDER BY version
`).all());
database.close();
NODE
```

Validasi wajib:

1. status menunjukkan revision HEAD, `dist/app/server.js`, schema expected/applied sama, dan `readiness OK`;
2. setiap migration version tercatat tepat satu kali;
3. `PRAGMA quick_check` menghasilkan `ok`;
4. freshness market/on-chain pulih dan seluruh critical scheduler sehat;
5. tidak ada scheduler yang berjalan ganda.

## 6. Validasi Execution Safety

```bash
curl -fsS http://127.0.0.1:3001/api/execution/status
curl -fsS http://127.0.0.1:3001/api/shadow/status
curl -fsS http://127.0.0.1:3001/api/lifecycle/activation
```

Bandingkan dengan baseline preflight. Release dinyatakan gagal bila live execution aktif tanpa prosedur terpisah, kill switch lepas, signing/broadcast tersedia, lifecycle berubah, atau Shadow run berubah tanpa tindakan teraudit.

## 7. Deteksi dan Pemulihan Stale Deployment

Gejala stale:

- `background:status` melaporkan command/entry point mismatch;
- revision deployment berbeda dari HEAD;
- expected/applied schema berbeda;
- process hidup tetapi readiness gagal.

Pemulihan standar:

```bash
npm run background:stop
rm -f run/server.pid  # hanya jika PID file terbukti stale dan process-nya sudah tidak ada
npm run background:start
npm run background:status
```

Jangan mengubah expected schema secara manual agar status hijau. Jika migration gagal, hentikan process, simpan database/log untuk investigasi, dan gunakan prosedur rollback.

## 8. Rollback

### Rollback code tanpa restore data

Gunakan bila schema baru tetap backward-compatible:

```bash
npm run background:stop
git checkout <revision-sebelumnya>
npm ci
npm run build
npm run background:start
npm run background:status
```

Jangan menurunkan atau menghapus row `schema_migrations`. Pastikan revision lama memang kompatibel dengan schema yang sudah diterapkan.

### Rollback database

Gunakan hanya bila audit menyatakan database hasil release tidak dapat dipakai. Ikuti prosedur restore di [`runbook-storage-and-rpc-recovery.md`](runbook-storage-and-rpc-recovery.md), gunakan backup `pre-release`, dan simpan database gagal untuk investigasi. Setelah restore, ulangi validasi identity, migration, readiness, execution safety, dan Shadow.

## 9. Batas Jaringan

- Default wajib `HOST=127.0.0.1`.
- `HOST=0.0.0.0` hanya untuk LAN tepercaya dengan firewall/perlindungan perangkat; jangan membuka port langsung ke internet.
- Reverse proxy harus tepercaya, melakukan terminasi TLS, dan menjadi satu-satunya pihak yang membuat `TRUST_PROXY=true` aman.
- Deployment multi-instance membutuhkan shared rate limiter; limiter bawaan hanya process-local.
