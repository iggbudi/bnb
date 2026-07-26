# Vertical Slicing Compatibility Baseline

Baseline ini dicatat sebelum pemisahan composition root dan dipakai untuk memastikan refactor vertical slicing tidak mengubah kontrak runtime. **Seluruh path, port, dan versi schema di dokumen ini adalah snapshot historis pra-refactor, bukan status deployment aktif atau petunjuk startup.** Status aktif berada di `progress.md`; runbook aktif berada di [`runbook-termux-release.md`](runbook-termux-release.md).

## Runtime

- Historical entry point: `src/server-bnb.ts`
- Historical host default: `127.0.0.1`
- Historical port default: `3000`
- Historical database default: `data/bnb-viewer.sqlite`
- Historical application schema version: `3`
- Live execution tetap dikendalikan oleh `LIVE_EXECUTION_ENABLED` dan default-nya nonaktif.

## Kontrak Response Utama

Response sukses menggunakan envelope berikut kecuali endpoint lama yang mempunyai kontrak spesifik:

```json
{
  "success": true,
  "data": {},
  "timestamp": "ISO-8601"
}
```

Response gagal menggunakan envelope:

```json
{
  "success": false,
  "error": "safe public message",
  "timestamp": "ISO-8601"
}
```

Readiness merespons HTTP `200` ketika seluruh critical check sehat dan `503` jika tidak. Route admin execution tetap membutuhkan Bearer token.

## Endpoint

### Health dan operasi

- `GET /api/health`
- `GET /api/health/live`
- `GET /api/health/ready`
- `GET /api/operations/storage`

### Market data dan analisis LP

- `GET /api/wbnbusdt`
- `GET /api/history`
- `GET /api/history/chart`
- `GET /api/history/stats`
- `GET /api/onchain/pool`
- `GET /api/onchain/history`
- `GET /api/simulate`
- `GET /api/il`
- `POST /api/lp-analysis`

### Paper agent dan learning

- `GET /api/agent/status`
- `GET /api/agent/decisions`
- `GET /api/agent/outcomes`
- `GET /api/agent/performance`
- `GET /api/agent/models`
- `GET /api/agent/reflections`
- `GET /api/agent/high-risk-plan`

### Aggressive dan directional paper

- `GET /api/agent/aggressive-performance`
- `GET /api/agent/aggressive-positions/:id`
- `GET /api/agent/directional-performance`
- `GET /api/agent/directional-positions/:id`

### Position lifecycle dan shadow validation

- `GET /api/lifecycle/activation`
- `POST /api/lifecycle/activate-paper`
- `POST /api/lifecycle/return-to-shadow`
- `GET /api/shadow/status`
- `GET /api/shadow/observations`
- `POST /api/shadow/reset`
- `GET /api/positions/status`
- `GET /api/positions/:id`

### Execution control plane

- `GET /api/execution/status`
- `GET /api/execution/audit`
- `POST /api/execution/kill-switch`
- `POST /api/execution/proposals`
- `POST /api/execution/proposals/:id/review`
- `POST /api/execution/proposals/:id/transaction-plan`
- `POST /api/execution/proposals/:id/mint-receipt`
- `POST /api/execution/exit-proposals`
- `POST /api/execution/exit-proposals/:id/review`
- `POST /api/execution/exit-proposals/:id/transaction-plan`
- `POST /api/execution/exit-proposals/:id/receipts`

## Scheduler

| Nama task                      | Interval | Startup |
| ------------------------------ | -------- | ------- |
| market-snapshot                | 1 menit  | Ya      |
| onchain-snapshot               | 5 menit  | Ya      |
| execution-adapter-verification | 1 jam    | Ya      |
| paper-lifecycle                | 1 menit  | Ya      |
| directional-paper              | 1 menit  | Ya      |
| paper-outcome                  | 1 menit  | Ya      |
| learning                       | 1 jam    | Ya      |
| reflection                     | 1 jam    | Ya      |
| storage-maintenance            | 24 jam   | Ya      |

Seluruh task dijalankan melalui `SchedulerRegistry`, sehingga overlap task dengan nama yang sama tetap dicegah.

## SQLite

Sebelum refactor (historis):

- `APPLICATION_SCHEMA_VERSION = 3`
- `PRAGMA quick_check = ok`
- Migration tetap berurutan dan additive.

Tabel aplikasi:

```text
aggressive_paper_actions
aggressive_paper_evaluations
aggressive_paper_positions
application_metadata
directional_paper_decisions
directional_paper_evaluations
directional_paper_fills
directional_paper_positions
directional_paper_runs
execution_audit
execution_control
execution_exit_plans
execution_exit_settlements
execution_mint_plans
execution_proposals
execution_transactions
execution_wallet_bindings
exit_execution_proposals
lifecycle_activation_events
lifecycle_activation_state
lifecycle_shadow_observations
lifecycle_shadow_runs
live_position_nfts
onchain_pool_snapshots
paper_agent_decisions
paper_agent_models
paper_agent_outcome_assessments
paper_agent_outcome_interpretations
paper_agent_outcomes
paper_agent_reflections
paper_positions
pool_snapshots
position_actions
position_evaluations
position_events
schema_migrations
```

## Guardrails

- `src/architecture.test.ts` menjaga agar composition root tidak memakai wrapper kompatibilitas.
- Setelah `src/features/` dibuat, test yang sama melarang feature mengimpor `app/` dan deep import internal slice lain.
- Folder `domain/` slice dilarang bergantung pada Express, SQLite, environment variable, atau `app/`.
- Relative import dipertahankan; path alias belum ditambahkan agar risiko perubahan build tetap rendah.
