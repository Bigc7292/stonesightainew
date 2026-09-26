/**
 * Tiny in-memory job store for long-running generations (Cosmos video takes
 * minutes — longer than proxies and browsers like to hold a request open).
 *
 * Jobs are scoped to the user that created them and expire after an hour.
 * For multi-instance deployments swap this for Redis or a Supabase table.
 */
import crypto from "crypto";

export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export interface Job<T> {
  id: string;
  userId: string;
  status: JobStatus;
  createdAt: number;
  updatedAt: number;
  result?: T;
  error?: string;
}

const TTL_MS = 60 * 60 * 1000;

export class JobStore<T> {
  private jobs = new Map<string, Job<T>>();

  create(userId: string): Job<T> {
    this.sweep();
    const now = Date.now();
    const job: Job<T> = { id: crypto.randomUUID(), userId, status: "queued", createdAt: now, updatedAt: now };
    this.jobs.set(job.id, job);
    return job;
  }

  get(id: string, userId: string): Job<T> | undefined {
    const job = this.jobs.get(id);
    return job && job.userId === userId ? job : undefined;
  }

  update(id: string, patch: Partial<Omit<Job<T>, "id" | "userId" | "createdAt">>) {
    const job = this.jobs.get(id);
    if (job) Object.assign(job, patch, { updatedAt: Date.now() });
  }

  /** Runs `work` in the background and records its outcome on the job. */
  run(job: Job<T>, work: () => Promise<T>) {
    this.update(job.id, { status: "running" });
    work()
      .then((result) => this.update(job.id, { status: "succeeded", result }))
      .catch((error: unknown) =>
        this.update(job.id, {
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
  }

  private sweep() {
    const cutoff = Date.now() - TTL_MS;
    for (const [id, job] of this.jobs) if (job.updatedAt < cutoff) this.jobs.delete(id);
  }
}
