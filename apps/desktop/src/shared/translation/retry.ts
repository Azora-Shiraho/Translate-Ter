import { ProviderError } from './types';

export type RetryOptions = {
  maxRetries: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
  jitterRatio: number;
  signal?: AbortSignal;
};

export async function retryWithBackoff<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions
): Promise<T> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt <= options.maxRetries) {
    try {
      return await operation(attempt + 1);
    } catch (error) {
      lastError = error;
      const retryable = error instanceof ProviderError ? error.retryable : true;
      if (!retryable || attempt === options.maxRetries) {
        throw error;
      }
      const providerDelay = error instanceof ProviderError ? error.retryAfterMs : undefined;
      const delayMs = providerDelay ?? computeBackoffMs(attempt, options);
      await sleep(delayMs, options.signal);
      attempt += 1;
    }
  }

  throw lastError;
}

export function computeBackoffMs(attemptZeroBased: number, options: Pick<RetryOptions, 'initialBackoffMs' | 'maxBackoffMs' | 'jitterRatio'>): number {
  const base = Math.min(options.maxBackoffMs, options.initialBackoffMs * 2 ** attemptZeroBased);
  const jitter = base * options.jitterRatio;
  const min = base - jitter;
  const max = base + jitter;
  return Math.round(min + Math.random() * (max - min));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true }
    );
  });
}
