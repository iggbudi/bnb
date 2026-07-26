# ADR-0001: Modular Monolith Berbasis Vertical Slice

- Status: Accepted
- Tanggal: 2026-07-26

## Konteks

Kode awal mengelompokkan domain, store, route, scheduler, dan tipe berdasarkan concern teknis di root `src/`. Perubahan satu fitur sering menyentuh banyak file lintas root, composition bercampur dengan business logic, dan ownership schema/scheduler tidak eksplisit. Aplikasi tetap perlu berjalan sebagai satu proses ringan di Termux dengan satu SQLite database dan tanpa bundler frontend.

## Keputusan

Gunakan modular monolith dengan arah dependensi:

```text
app -> features -> shared
```

Delapan feature slice memiliki domain, application service, infrastructure, HTTP, task, CLI, dan test masing-masing. `index.ts` adalah satu-satunya jalur antarslice. Composition, migration/task aggregation, startup, dan shutdown berada di `src/app/`. Concern teknis netral berada di `src/shared/`.

Frontend mengikuti ownership yang sama melalui `public/features/`, helper di `public/shared/`, dan bootstrap tunggal `public/app.js`. Classic deferred scripts dipertahankan agar deployment tanpa build frontend tetap kompatibel.

Boundary divalidasi oleh architecture test di CI. Root compatibility re-export dihapus setelah seluruh caller dan process script memakai entry point final.

## Konsekuensi

### Positif

- Perubahan fitur terlokalisasi dan ownership route/store/schema/task/UI jelas.
- Composition serta lifecycle proses dapat dipahami tanpa membaca detail domain.
- Deep import dan ketergantungan infrastruktur dari domain terdeteksi otomatis.
- Deployment tetap sederhana: satu proses Node.js, satu SQLite database, dan static frontend tanpa bundler.

### Trade-off

- Beberapa kontrak antarslice tetap diperlukan karena use case LP saling berhubungan.
- Public API slice harus dijaga kecil dan stabil agar tidak menjadi barrel internal umum.
- Penambahan slice membutuhkan wiring eksplisit di composition root.
- Classic frontend modules membutuhkan namespace bootstrap dan compatibility handler untuk DOM yang masih memakai inline `onclick`.

## Alternatif yang Ditolak

- Microservices: menambah deployment, jaringan, observability, dan konsistensi data yang tidak sebanding dengan skala aplikasi.
- Satu folder teknis global: sederhana pada awalnya tetapi mempertahankan ownership fitur yang kabur.
- Path alias dan frontend bundler saat refactor: menambah perubahan konfigurasi dan risiko deployment tanpa memberi manfaat yang diperlukan untuk boundary saat ini.
