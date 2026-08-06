# Visualisasi Arsitektur (Mermaid)

Diagram arsitektur `bnb-lp-analyzer` dalam format Mermaid. Preview di editor yang
mendukung Mermaid (VS Code + extension, GitHub, Typora, atau
[mermaid.live](https://mermaid.live)).

Ringkasan tekstual: [`architecture.md`](architecture.md) ·
Keputusan arsitektur: [`adr/0001-vertical-slice-modular-monolith.md`](adr/0001-vertical-slice-modular-monolith.md) ·
Graf dependensi: [`feature-dependency-graph.md`](feature-dependency-graph.md)

---

## 1. Lapisan Utama & Arah Dependensi

```mermaid
flowchart TB
    subgraph UI["public/ (Frontend statis, tanpa bundler)"]
        APPJS["public/app.js<br/>bootstrap tunggal + polling"]
        FE["public/features/*<br/>renderer per fitur"]
        SH["public/shared/*<br/>api-client, format"]
        APPJS --> FE
        FE --> SH
    end

    subgraph CORE["src/app/ (Composition Root)"]
        SVR["server.ts<br/>entry point + graceful shutdown"]
        RT["runtime.ts<br/>wiring service & route"]
        CT["container.ts<br/>BnbServiceContainer"]
        CFG["config.ts<br/>env → config"]
        MIG["migrations.ts<br/>v1–v4 + schema registry"]
        SCH["scheduled-tasks.ts<br/>agregasi scheduler"]
        SVR --> RT
        RT --> CT
        RT --> CFG
        CT --> MIG
        RT --> SCH
    end

    subgraph FEATURES["src/features/* (8 slice)"]
        MD["market-data"]
        LA["lp-analysis"]
        PA["paper-agent"]
        AP["aggressive-paper"]
        DP["directional-paper"]
        LE["learning"]
        LE2["lp-execution"]
        OP["operations"]
    end

    subgraph SHARED["src/shared/ (concern netral)"]
        DB["database/<br/>SQLite + migration runner"]
        HTTP["http/<br/>errors, validation"]
        RT2["runtime/<br/>scheduler, lock, rate limit, resilience"]
    end

    CORE --> FEATURES
    FEATURES --> SHARED
    UI --> CORE
    CORE --> UI
```

---

## 2. Startup & Lifecycle Proses

```mermaid
flowchart LR
    A["npm run dev /<br/>node dist/app/server.js"] --> B["dotenv + config.ts"]
    B --> C["create-app.ts<br/>Express + security headers + rate limiter"]
    C --> D["database-bootstrap.ts<br/>reconcile schema contribution<br/>→ migration v1–v4 (transaksional)"]
    D --> E["container.ts<br/>buka 9 store SQLite"]
    E --> F["runtime.ts<br/>konstruksi 8 service + DI"]
    F --> G["register 8 route group"]
    F --> H["register-schedulers.ts<br/>SchedulerRegistry"]
    G --> I["listen(port)"]
    H --> I

    I --> J["SIGTERM/SIGINT"]
    J --> K["schedulerController.stop()"]
    J --> L["server.close()<br/>drain HTTP + scheduler<br/>(timeout SHUTDOWN_TIMEOUT_MS)"]
    K --> M["closeStores()<br/>tutup store terbalik"]
    L --> M
```

---

## 3. Graf Dependensi Runtime Antar-Slice

Edge divalidasi oleh `src/architecture.test.ts`; graf wajib acyclic.

```mermaid
flowchart LR
    MD["market-data"] --> LA["lp-analysis"]
    DP["directional-paper"] --> MD
    AP["aggressive-paper"] --> LA
    LE2["lp-execution"] --> LA
    PA["paper-agent"] --> LA
    PA --> LE["learning"]
    OP["operations"]

    style MD fill:#1f2937,stroke:#60a5fa,color:#f8fafc
    style LA fill:#1f2937,stroke:#60a5fa,color:#f8fafc
    style DP fill:#1f2937,stroke:#60a5fa,color:#f8fafc
    style AP fill:#1f2937,stroke:#60a5fa,color:#f8fafc
    style LE2 fill:#1f2937,stroke:#60a5fa,color:#f8fafc
    style PA fill:#1f2937,stroke:#60a5fa,color:#f8fafc
    style LE fill:#1f2937,stroke:#60a5fa,color:#f8fafc
    style OP fill:#1f2937,stroke:#60a5fa,color:#f8fafc
```

Catatan: pembacaan on-chain dimiliki `market-data`; primitive LP/lifecycle cost dimiliki
`lp-analysis`; orchestration paper-position diinjeksikan `app` → `paper-agent` sehingga
tidak ada edge balik ke `lp-execution`. Ada juga edge type-only (lihat
[`feature-dependency-graph.md`](feature-dependency-graph.md)).

---

## 4. Struktur Internal Satu Slice (contoh: `paper-agent`)

Pola yang sama berlaku untuk semua slice: `domain/` murni, `application/` orkestrasi,
`infrastructure/` SQLite & adapter, `http/` route.

```mermaid
flowchart TB
    subgraph PA["src/features/paper-agent/"]
        IDX["index.ts<br/>(kontrak publik slice)"]
        DOM["domain/<br/>paper-agent.ts, outcome-assessment,<br/>outcome-interpretation (murni, tanpa IO)"]
        APP["application/<br/>paper-agent-service, evaluator,<br/>reflection, scheduled-tasks.ts"]
        INF["infrastructure/<br/>agent-store.ts (façade)<br/>+ 4 repository SQLite<br/>+ schema.ts"]
        HTTP["http/routes.ts<br/>(parse & mapping, tanpa SQL)"]
        PORTS["application/ports.ts<br/>(port milik consumer)"]
    end

    IDX --> DOM
    IDX --> APP
    IDX --> INF
    IDX --> HTTP
    APP --> DOM
    APP --> PORTS
    INF --> DOM

    subgraph OUT["Consumer lain (dipakai lewat index.ts)"]
        LA["lp-analysis"]
        LE["learning"]
        MD["market-data"]
        LX["lp-execution"]
    end

    APP -. "implementasi port di-inject<br/>oleh src/app/runtime.ts" .-> OUT
    OUT -. "pakai PaperAgentService/<br/>AgentStore via index.ts" .-> IDX
```

---

## 5. Scheduler & Task Periodik

```mermaid
flowchart LR
    subgraph F["Tiap feature mengekspor ScheduledTaskDefinition"]
        T1["market-data tasks (1m)"]
        T2["paper-agent: paper-lifecycle,<br/>paper-outcome (1m), reflection (1h)"]
        T3["aggressive-paper tasks"]
        T4["directional-paper tasks (1m)"]
        T5["learning tasks"]
        T6["lp-execution tasks"]
        T7["operations tasks"]
    end

    A["src/app/scheduled-tasks.ts<br/>agregasi + sort registrationOrder"] --> R["SchedulerRegistry<br/>(shared/runtime)"]

    F --> A

    R --> S["run(name, task)"]
    S --> G{"sudah RUNNING?"}
    G -- "ya" --> H["skip: ALREADY_RUNNING<br/>(+1 skippedAlreadyRunning)"]
    G -- "tidak" --> I["eksekusi + catat status/<br/>lastSuccess/lastError/duration"]
    I --> J["readiness critical?<br/>→ /api/health/ready"]
    R --> K["waitForIdle(timeout)<br/>saat shutdown"]
```

---

## 6. Alur HTTP Request

```mermaid
flowchart LR
    Q["Request"] --> H["Security headers<br/>CSP, X-Frame, nosniff"]
    H --> C["CORS check<br/>(allowlist origin)"]
    C --> B["JSON body limit 32 KiB"]
    B --> R{"path /api/*?<br/>& bukan /health"}
    R -- "ya" --> RL["Rate limiter fixed-window<br/>global 120/mnt<br/>AI 4/15mnt<br/>exit-admin 60/mnt (terpisah)"]
    RL -- "allowed" --> RPC{"route RPC-heavy?"}
    RL -- "429 + Retry-After" --> E["JSON error"]
    RPC -- "ya" --> G["ConcurrencyGate<br/>(max RPC_HEAVY_CONCURRENCY)"]
    RPC -- "tidak" --> RT["route feature<br/>(http/routes.ts)"]
    G -- "penuh → 429" --> E
    G -- "ada slot" --> RT
    RT --> SV["application service<br/>(use case + DI port)"]
    SV --> ST["infrastructure store<br/>(SQLite WAL)"]
    ST --> D["data/bnb-viewer.sqlite"]
    SV --> UP["adapter upstream:<br/>DexScreener / RPC PancakeSwap V3"]
```

---

## 7. Position Lifecycle (State Machine, `lp-execution`)

```mermaid
stateDiagram-v2
    [*] --> PENDING_ENTRY: sinyal ENTER_FULL_RANGE<br/>(maks 1 posisi aktif, unique partial index)
    PENDING_ENTRY --> OPEN: mint settlement<br/>(confirmation ≥ threshold)
    OPEN --> PENDING_EXIT: hari ke-14 / sinyal exit / stop-loss
    PENDING_EXIT --> CLOSED: withdraw settlement
    OPEN --> EMERGENCY_EXITED: kondisi darurat
    PENDING_ENTRY --> EMERGENCY_EXITED: gagal settle
    CLOSED --> [*]: cooldown entry 24 jam
    EMERGENCY_EXITED --> [*]

    note right of OPEN
      mark-to-market tiap jam via delta
      feeGrowthGlobal V3 on-chain
    end note
```

---

## 8. Database & Migration

```mermaid
flowchart TB
    subgraph SRC["Schema contribution per feature (src/features/*/infrastructure/schema.ts)"]
        S1["marketDataSchema"]
        S2["paperAgentSchema"]
        S3["aggressivePaperSchema"]
        S4["directionalPaperSchema"]
        S5["learningSchema"]
        S6["lpExecutionSchema"]
    end

    A["src/app/migrations.ts"] --> M1["migration v1:<br/>baseline application_metadata"]
    A --> M2["migration v2:<br/>operational indexes"]
    A --> M3["migration v3:<br/>directional perpetual ledger"]
    A --> M4["migration v4:<br/>feature_schema_ownership_registry<br/>(reconcile semua kontribusi)"]

    SRC --> M4

    M1 --> RUN["SchemaMigrationRunner<br/>(shared/database/migration-runner.ts)"]
    M2 --> RUN
    M3 --> RUN
    M4 --> RUN

    RUN --> BOOT["database-bootstrap.ts<br/>(sebelum container membuka store)"]
    BOOT --> ST["BnbServiceContainer<br/>buka 9 store, validasi schema"]
    ST --> SQL["data/bnb-viewer.sqlite<br/>WAL, busy_timeout 5s"]
```

---

## 9. Guardrails Otomatis (CI)

```mermaid
flowchart LR
    A["npm run check"] --> L["ESLint + Prettier"]
    L --> B["tsc build"]
    B --> T["Semua test (node:test)"]
    T --> C["Coverage:<br/>lines ≥75% · funcs ≥75% · branches ≥65%"]
    T --> AT["architecture.test.ts<br/>arah dependensi, no deep import,<br/>domain bebas Express/SQLite/scheduler"]
    T --> DT["documentation.test.ts<br/>link lokal valid, graf dependensi sinkron,<br/>runbook release lengkap"]
    C --> OK["✅ CI green"]
    AT --> OK
    DT --> OK
```
