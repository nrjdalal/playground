import { existsSync } from "node:fs"

import { listening } from "@/lib/dev/proxy"
import { settledWithin } from "@/lib/settle"

// The machine onboarding's checks read: a tool on PATH, a fixed path's presence, a loopback port taking a connection, and a fixed argv's answer within 5 seconds. checks.ts names the tools and builds every argv; this file names none, so the cmux boundary holds.

export type Reader = {
  exists: (path: string) => boolean
  has: (tool: string) => boolean
  listens: (port: number) => Promise<boolean>
  run: (argv: string[]) => Promise<{ code: number; stdout: string }>
}

const TIMEOUT_MS = 5000

export const machine: Reader = {
  exists: (path) => existsSync(path),
  has: (tool) => Bun.which(tool) !== null,
  listens: (port) => listening(port),
  run: async (argv) => {
    const child = Bun.spawn(argv, {
      stderr: "ignore",
      stdin: "ignore",
      stdout: "pipe",
      timeout: TIMEOUT_MS,
    })
    const settled = await settledWithin(
      Promise.all([new Response(child.stdout).text(), child.exited]),
      TIMEOUT_MS + 1000,
    )
    return settled ? { code: settled[1], stdout: settled[0] } : { code: 1, stdout: "" }
  },
}
