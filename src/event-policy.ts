const LAYOUT_METRICS = new Set(["bounds", "scaleFactor", "rotation"]);

export function shouldReflowForDisplayMetrics(changedMetrics: readonly string[]): boolean {
  return changedMetrics.some((metric) => LAYOUT_METRICS.has(metric));
}

export function boundsDiffer(
  current: { x: number; y: number; width: number; height: number },
  next: { x: number; y: number; width: number; height: number },
  tolerance = 1
): boolean {
  return Math.abs(current.x - next.x) > tolerance
    || Math.abs(current.y - next.y) > tolerance
    || Math.abs(current.width - next.width) > tolerance
    || Math.abs(current.height - next.height) > tolerance;
}

export class NativeReflowGuard {
  private suppressUntil = 0;
  private queued = false;

  suppress(now: number, durationMs: number): void {
    this.suppressUntil = Math.max(this.suppressUntil, now + durationMs);
  }

  tryQueue(now: number): boolean {
    if (this.queued || now < this.suppressUntil) return false;
    this.queued = true;
    return true;
  }

  release(): void {
    this.queued = false;
  }

  canRun(now: number): boolean {
    return now >= this.suppressUntil;
  }
}

export class ReflowCircuitBreaker {
  private attempts: number[] = [];

  constructor(
    private readonly limit = 6,
    private readonly windowMs = 2000
  ) {}

  record(now: number): boolean {
    this.attempts = this.attempts.filter((timestamp) => now - timestamp <= this.windowMs);
    this.attempts.push(now);
    return this.attempts.length <= this.limit;
  }

  reset(): void {
    this.attempts = [];
  }
}
