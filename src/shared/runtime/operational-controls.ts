import type { ScheduledTaskDefinition, ScheduledTaskMetadata } from './scheduled-task.js';

export interface SchedulerStatus {
  name: string;
  state: 'IDLE' | 'RUNNING';
  startedAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  lastDurationMs: number | null;
  skippedAlreadyRunning: number;
}

export class SchedulerRegistry {
  private readonly statuses = new Map<string, SchedulerStatus>();
  private readonly taskMetadata = new Map<string, ScheduledTaskMetadata>();
  private readonly active = new Set<Promise<unknown>>();

  registerTasks(tasks: readonly ScheduledTaskDefinition[]): void {
    const names = new Set<string>();
    for (const task of tasks) {
      if (names.has(task.name) || this.taskMetadata.has(task.name)) {
        throw new Error(`Scheduled task "${task.name}" is already registered`);
      }
      if (
        !task.name ||
        !task.label ||
        !Number.isFinite(task.intervalMs) ||
        task.intervalMs <= 0 ||
        !Number.isFinite(task.registrationOrder)
      ) {
        throw new Error(`Scheduled task "${task.name}" has invalid metadata`);
      }
      names.add(task.name);
    }
    for (const { run: _run, ...metadata } of tasks) {
      this.taskMetadata.set(metadata.name, { ...metadata });
    }
  }

  listTaskMetadata(): ScheduledTaskMetadata[] {
    return [...this.taskMetadata.values()].map(metadata => ({ ...metadata }));
  }

  private statusFor(name: string): SchedulerStatus {
    let status = this.statuses.get(name);
    if (!status) {
      status = {
        name,
        state: 'IDLE',
        startedAt: null,
        lastSuccessAt: null,
        lastErrorAt: null,
        lastError: null,
        lastDurationMs: null,
        skippedAlreadyRunning: 0,
      };
      this.statuses.set(name, status);
    }
    return status;
  }

  run<T>(
    name: string,
    task: () => Promise<T> | T
  ): Promise<{ status: 'COMPLETED'; value: T } | { status: 'ALREADY_RUNNING' }> {
    const scheduler = this.statusFor(name);
    if (scheduler.state === 'RUNNING') {
      scheduler.skippedAlreadyRunning++;
      return Promise.resolve({ status: 'ALREADY_RUNNING' });
    }

    const started = Date.now();
    scheduler.state = 'RUNNING';
    scheduler.startedAt = new Date(started).toISOString();
    const execution = Promise.resolve()
      .then(task)
      .then(value => {
        scheduler.lastSuccessAt = new Date().toISOString();
        scheduler.lastError = null;
        return { status: 'COMPLETED' as const, value };
      })
      .catch(error => {
        scheduler.lastErrorAt = new Date().toISOString();
        scheduler.lastError = error instanceof Error ? error.message : 'Unknown scheduler error';
        throw error;
      })
      .finally(() => {
        scheduler.state = 'IDLE';
        scheduler.startedAt = null;
        scheduler.lastDurationMs = Date.now() - started;
        this.active.delete(execution);
      });
    this.active.add(execution);
    return execution;
  }

  list(): SchedulerStatus[] {
    return [...this.statuses.values()].map(status => ({ ...status }));
  }

  async waitForIdle(timeoutMs: number): Promise<boolean> {
    if (this.active.size === 0) return true;
    let timeout: NodeJS.Timeout | undefined;
    const expired = new Promise<false>(resolve => {
      timeout = setTimeout(() => resolve(false), timeoutMs);
      timeout.unref?.();
    });
    const idle = Promise.allSettled([...this.active]).then(() => true as const);
    const result = await Promise.race([idle, expired]);
    if (timeout) clearTimeout(timeout);
    return result;
  }
}

export class AsyncLock {
  private tail: Promise<void> = Promise.resolve();
  private running = 0;

  async run<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>(resolve => {
      release = resolve;
    });
    await previous;
    this.running++;
    try {
      return await task();
    } finally {
      this.running--;
      release();
    }
  }

  get active(): number {
    return this.running;
  }
}

export class ConcurrencyGate {
  private running = 0;

  constructor(private readonly maximum: number) {
    if (!Number.isInteger(maximum) || maximum < 1) throw new Error('Concurrency maximum must be positive');
  }

  tryAcquire(): (() => void) | null {
    if (this.running >= this.maximum) return null;
    this.running++;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.running--;
      }
    };
  }

  get active(): number {
    return this.running;
  }
}

interface RateWindow {
  count: number;
  resetAt: number;
}

export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, RateWindow>();

  constructor(
    private readonly maximum: number,
    private readonly windowMs: number
  ) {
    if (!Number.isInteger(maximum) || maximum < 1 || windowMs < 1) {
      throw new Error('Rate limit configuration must be positive');
    }
  }

  consume(key: string, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
    let window = this.windows.get(key);
    if (!window || now >= window.resetAt) {
      window = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, window);
    }
    window.count++;
    return {
      allowed: window.count <= this.maximum,
      retryAfterSeconds: Math.max(1, Math.ceil((window.resetAt - now) / 1_000)),
    };
  }
}
