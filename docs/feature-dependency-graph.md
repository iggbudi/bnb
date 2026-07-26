# Feature Dependency Graph

Snapshot aktif setelah P2 (2026-07-26). `src/architecture.test.ts` memvalidasi edge ini dan menolak runtime cycle atau edge baru yang belum direview. Pemecahan repository P2 tidak menambah edge antarslice.

## Runtime edges

```text
aggressive-paper -> lp-analysis
directional-paper -> market-data
lp-analysis -> market-data
lp-execution -> lp-analysis
paper-agent -> learning
paper-agent -> lp-analysis
```

Graph runtime bersifat acyclic. Pembacaan on-chain PancakeSwap V3 dimiliki `market-data`; primitive liquidity dan lifecycle cost dimiliki `lp-analysis`; orchestration paper-position diinjeksikan oleh `app` ke `paper-agent` sehingga tidak membentuk dependency balik ke `lp-execution`.

## Type-only edges

```text
aggressive-paper -> market-data
directional-paper -> market-data
learning -> paper-agent
lp-analysis -> learning
lp-analysis -> market-data
lp-analysis -> paper-agent
lp-execution -> learning
lp-execution -> market-data
lp-execution -> paper-agent
operations -> directional-paper
operations -> market-data
operations -> paper-agent
paper-agent -> aggressive-paper
paper-agent -> learning
paper-agent -> lp-execution
paper-agent -> market-data
```

Type-only edge tidak menghasilkan module loading pada runtime. Edge tersebut tetap dicatat agar coupling kontrak terlihat. Consumer mendefinisikan port kecil di `application/ports.ts`; `src/app/` menyuntikkan implementasinya tanpa memindahkan kontrak bisnis ke `shared/`.

## Public API policy

- Feature consumer hanya mengimpor `features/<slice>/index.ts`.
- Public index menggunakan explicit named exports; wildcard export dilarang.
- Concrete store hanya diekspor jika dibutuhkan composition root atau test yang membuat fixture nyata; repository aggregate internal di belakang façade store tidak diekspor.
- Adapter RPC, receipt verifier, dan detail infrastructure lain tidak menjadi public API slice.
