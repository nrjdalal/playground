import { check } from "./no-extensions-write"

declare const self: Worker

// Runs the hook's check off the main thread, so a step the deadline cannot interrupt never blocks the thread that refuses.
self.onmessage = async (
  event: MessageEvent<{ environment: Record<string, string | undefined>; raw: string }>,
) => {
  self.postMessage(await check(event.data.raw, event.data.environment))
}
