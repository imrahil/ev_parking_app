// The contract tests run the real worker in-process (see src/worker.test.ts).
// It is plain JS, so give its modules loose types here.
declare module '*/worker/src/worker.js' {
  const worker: {
    fetch(request: Request, env: unknown): Promise<Response>
    scheduled(event: { scheduledTime: number }, env: unknown): Promise<void>
  }

  export default worker
}

declare module '*/worker/src/push.js' {
  export function subId(endpoint: string): Promise<string>
}
