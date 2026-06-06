export type CircuitState = 'closed' | 'open' | 'half-open';

export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private state: CircuitState = 'closed';

  constructor(
    private readonly failureThreshold: number,
    private readonly cooldownMs: number,
    private readonly now: () => number = Date.now
  ) {}

  canRequest(): boolean {
    if (this.state !== 'open') return true;
    if (this.now() - this.openedAt >= this.cooldownMs) {
      this.state = 'half-open';
      return true;
    }
    return false;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.failures >= this.failureThreshold) {
      this.state = 'open';
      this.openedAt = this.now();
    }
  }

  snapshot(): { state: CircuitState; failures: number; openedAt?: number } {
    return {
      state: this.state,
      failures: this.failures,
      openedAt: this.state === 'open' ? this.openedAt : undefined
    };
  }
}
