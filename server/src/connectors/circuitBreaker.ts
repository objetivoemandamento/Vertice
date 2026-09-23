type State = "closed"|"open"|"half-open";

export class CircuitBreaker {
  private state: State = "closed";
  private failures = 0;
  private openedAt = 0;
  constructor(private readonly threshold = 5, private readonly cooldownMs = 30000) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      if (Date.now() - this.openedAt < this.cooldownMs) throw new Error("CONNECTOR_CIRCUIT_OPEN");
      this.state = "half-open";
    }
    try {
      const result = await fn();
      this.failures = 0;
      this.state = "closed";
      return result;
    } catch (error) {
      this.failures += 1;
      if (this.failures >= this.threshold) {
        this.state = "open";
        this.openedAt = Date.now();
      }
      throw error;
    }
  }
}
