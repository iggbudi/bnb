export type UpstreamErrorCode =
  'UPSTREAM_TIMEOUT' | 'UPSTREAM_HTTP' | 'UPSTREAM_MALFORMED' | 'UPSTREAM_NETWORK';

export class UpstreamError extends Error {
  constructor(
    public readonly code: UpstreamErrorCode,
    message: string,
    public readonly status?: number,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = 'UpstreamError';
  }
}

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  random?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

const defaultSleep = (milliseconds: number) =>
  new Promise<void>(resolve => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref?.();
  });

export function classifyUpstreamError(error: unknown): UpstreamError {
  if (error instanceof UpstreamError) return error;
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return new UpstreamError('UPSTREAM_TIMEOUT', 'Upstream request timed out', undefined, { cause: error });
  }
  if (error instanceof SyntaxError) {
    return new UpstreamError('UPSTREAM_MALFORMED', 'Upstream returned malformed JSON', undefined, {
      cause: error,
    });
  }
  return new UpstreamError('UPSTREAM_NETWORK', 'Upstream network request failed', undefined, {
    cause: error,
  });
}

export function isRetryableUpstreamError(error: unknown): boolean {
  const classified = classifyUpstreamError(error);
  return (
    classified.code === 'UPSTREAM_TIMEOUT' ||
    classified.code === 'UPSTREAM_NETWORK' ||
    (classified.code === 'UPSTREAM_HTTP' &&
      (classified.status === 408 ||
        classified.status === 429 ||
        (classified.status !== undefined && classified.status >= 500)))
  );
}

export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, Math.floor(options.attempts ?? 3));
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 200);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 2_000);
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const classified = classifyUpstreamError(error);
      if (attempt >= attempts || !isRetryableUpstreamError(classified)) throw classified;
      const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const jittered = Math.round(exponential * (0.5 + Math.max(0, Math.min(1, random()))));
      await sleep(jittered);
    }
  }
}

export class SingleFlight {
  private readonly active = new Map<string, Promise<unknown>>();

  run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const existing = this.active.get(key);
    if (existing) return existing as Promise<T>;

    const promise = Promise.resolve().then(operation);
    this.active.set(key, promise);
    void promise.then(
      () => this.active.delete(key),
      () => this.active.delete(key)
    );
    return promise;
  }

  get size(): number {
    return this.active.size;
  }
}

export async function fetchJsonWithRetry<T>(
  url: string,
  init: RequestInit,
  options: RetryOptions & { timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<T> {
  const timeoutMs = Math.max(1, options.timeoutMs ?? 10_000);
  const fetchImpl = options.fetchImpl ?? fetch;
  return withRetry(async () => {
    let response: Response;
    try {
      response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      throw classifyUpstreamError(error);
    }
    if (!response.ok) {
      throw new UpstreamError(
        'UPSTREAM_HTTP',
        `Upstream HTTP request failed with status ${response.status}`,
        response.status
      );
    }
    try {
      return (await response.json()) as T;
    } catch (error) {
      throw new UpstreamError('UPSTREAM_MALFORMED', 'Upstream returned malformed JSON', undefined, {
        cause: error,
      });
    }
  }, options);
}
