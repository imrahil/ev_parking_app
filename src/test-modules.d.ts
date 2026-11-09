// The contract tests run the real worker in-process (see src/worker.test.ts).
// It is plain JS, so give its modules loose types here.
declare module '*/worker/src/worker.js' {
  const worker: {
    fetch(request: Request, env: unknown): Promise<Response>
    scheduled(event: { scheduledTime: number }, env: unknown): Promise<void>
  }

  export default worker

  export class WriteBudget {
    constructor(state: { storage: { get(key: string): Promise<unknown>; put(key: string, value: unknown): Promise<void> } })
    fetch(request: Request): Promise<Response>
  }
}

declare module '*/worker/test/helpers.mjs' {
  /** In-memory stand-in for the KV binding; `store` holds the raw values. */
  export function makeKV(initial?: Record<string, string>): {
    store: Map<string, string>
    get(key: string, type?: string): Promise<unknown>
    put(key: string, value: string, opts?: unknown): Promise<void>
    delete(key: string): Promise<void>
    list(opts?: { prefix?: string; limit?: number }): Promise<{ keys: { name: string }[] }>
  }

  /** The real WriteBudget over in-memory storage, shaped like the DO binding. */
  export function makeBudget(): unknown
}

declare module '*/worker/src/push.js' {
  export function subId(endpoint: string): Promise<string>
}
