/**
 * When you tap a fan tile in the Home app it writes Active=1 and RotationSpeed=NN as two
 * separate characteristic writes a few milliseconds apart. Sending two RF/HTTP commands for
 * that is at best wasteful and at worst wrong (TurnOn resets some fans to their last speed,
 * then SetSpeed changes it again → visible flicker). This collects writes that arrive within
 * a short window and hands them to one applier as a single object.
 */
export class WriteCoalescer<T extends object> {
  private pending: Partial<T> = {};
  private timer: NodeJS.Timeout | undefined;
  private waiters: Array<{ resolve: () => void; reject: (e: unknown) => void }> = [];
  private applying: Promise<void> | undefined;

  constructor(
    private readonly apply: (changes: Partial<T>) => Promise<void>,
    private readonly windowMs = 60,
  ) {}

  /** Queue a change; resolves when the batch containing it has been applied (or rejects). */
  write<K extends keyof T>(key: K, value: T[K]): Promise<void> {
    this.pending[key] = value;
    return new Promise<void>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      if (!this.timer) {
        this.timer = setTimeout(() => void this.flush(), this.windowMs);
        this.timer.unref?.();
      }
    });
  }

  private async flush(): Promise<void> {
    this.timer = undefined;
    // Serialize batches: if one is still being applied, wait for it so commands stay ordered.
    if (this.applying) {
      await this.applying.catch(() => undefined);
    }
    const changes = this.pending;
    const waiters = this.waiters;
    this.pending = {};
    this.waiters = [];
    this.applying = this.apply(changes);
    try {
      await this.applying;
      waiters.forEach((w) => w.resolve());
    } catch (err) {
      waiters.forEach((w) => w.reject(err));
    } finally {
      this.applying = undefined;
    }
  }
}
