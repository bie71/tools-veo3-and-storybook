export interface QueueSnapshot {
  activeTaskId: string | null;
  queuedIds: string[];
  delayRemainingMs: number | null;
}

interface QueueTask<T> {
  id: string;
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  description?: string;
  enqueuedAt: number;
}

interface QueueMeta {
  description?: string;
}

export interface QueueJob<T> {
  id: string;
  promise: Promise<T>;
}

const now = () => Date.now();

export class RequestQueue {
  private readonly delayMs: number;
  private readonly listeners = new Set<(snapshot: QueueSnapshot) => void>();
  private readonly tasks: QueueTask<unknown>[] = [];
  private activeTask: QueueTask<unknown> | null = null;
  private delayRemainingMs: number | null = null;
  private countdownTimer: number | null = null;
  private countdownTimeout: number | null = null;
  private processing = false;

  constructor(delayMs: number) {
    this.delayMs = Math.max(0, delayMs || 0);
  }

  enqueue<T>(run: () => Promise<T>, meta: QueueMeta = {}): QueueJob<T> {
    const id = crypto.randomUUID();
    const task: QueueTask<T> = {
      id,
      run,
      resolve: () => undefined as unknown as T,
      reject: () => undefined,
      description: meta.description,
      enqueuedAt: now(),
    };

    const promise = new Promise<T>((resolve, reject) => {
      (task as QueueTask<T>).resolve = resolve;
      (task as QueueTask<T>).reject = reject;
    });

    this.tasks.push(task);
    this.notify();
    void this.processNext();

    return { id, promise };
  }

  subscribe(listener: (snapshot: QueueSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(): QueueSnapshot {
    return {
      activeTaskId: this.activeTask?.id ?? null,
      queuedIds: this.tasks.map((task) => task.id),
      delayRemainingMs: this.delayRemainingMs,
    };
  }

  private notify() {
    const snapshot = this.snapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }

  private async processNext(): Promise<void> {
    if (this.processing) {
      return;
    }

    this.processing = true;

    try {
      while (!this.activeTask && this.tasks.length) {
        this.activeTask = this.tasks.shift() ?? null;
        this.notify();

        if (!this.activeTask) {
          break;
        }

        try {
          const result = await this.activeTask.run();
          (this.activeTask as QueueTask<unknown>).resolve(result);
        } catch (error) {
          this.activeTask.reject(error);
        } finally {
          this.activeTask = null;
          this.notify();
        }

        if (this.tasks.length && this.delayMs > 0) {
          await this.waitWithCountdown(this.delayMs);
        }
      }
    } finally {
      this.processing = false;
    }

    if (!this.tasks.length) {
      this.clearCountdown();
    }
  }

  private waitWithCountdown(ms: number): Promise<void> {
    this.clearCountdown();
    this.delayRemainingMs = ms;
    this.notify();

    return new Promise((resolve) => {
      const startedAt = now();

      const tick = () => {
        const elapsed = now() - startedAt;
        this.delayRemainingMs = Math.max(0, ms - elapsed);
        this.notify();
        if (this.delayRemainingMs <= 0 && this.countdownTimer !== null) {
          window.clearInterval(this.countdownTimer);
          this.countdownTimer = null;
        }
      };

      if (ms >= 1000) {
        this.countdownTimer = window.setInterval(tick, 500);
      }

      this.countdownTimeout = window.setTimeout(() => {
        this.clearCountdown();
        resolve();
      }, ms);
    });
  }

  private clearCountdown() {
    if (this.countdownTimer !== null) {
      window.clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    if (this.countdownTimeout !== null) {
      window.clearTimeout(this.countdownTimeout);
      this.countdownTimeout = null;
    }
    if (this.delayRemainingMs !== null) {
      this.delayRemainingMs = null;
      this.notify();
    }
  }
}
