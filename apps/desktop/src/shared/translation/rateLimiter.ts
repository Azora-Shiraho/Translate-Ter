export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerMs: number,
    now: number = Date.now()
  ) {
    if (capacity <= 0 || refillPerMs <= 0) {
      throw new Error('TokenBucket capacity and refill rate must be positive.');
    }
    this.tokens = capacity;
    this.lastRefill = now;
  }

  available(now: number = Date.now()): number {
    this.refill(now);
    return this.tokens;
  }

  async take(count: number, signal?: AbortSignal): Promise<void> {
    if (count > this.capacity) {
      throw new Error(`Requested ${count} tokens but bucket capacity is ${this.capacity}.`);
    }

    while (this.available() < count) {
      const missing = count - this.tokens;
      const waitMs = Math.max(1, Math.ceil(missing / this.refillPerMs));
      await sleep(waitMs, signal);
    }

    this.tokens -= count;
  }

  tryTake(count: number, now: number = Date.now()): boolean {
    if (count > this.capacity) return false;
    if (this.available(now) < count) return false;
    this.tokens -= count;
    return true;
  }

  private refill(now: number): void {
    if (now <= this.lastRefill) return;
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
    this.lastRefill = now;
  }
}

export function estimateTextTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
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
