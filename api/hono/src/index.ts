import { env } from "@packages/env/api-hono"

import { entryOf } from "@/lib/entry"

// Which app this process serves, decided once at boot (lib/entry.ts): the hosted build imports hosted.ts alone, so no local route, nor a package behind one, ever loads there; the local dashboard imports local.ts.
const entry = entryOf({ hosted: env.PLAYGROUND_HOSTED, vercel: process.env.VERCEL })
if (typeof entry === "object") {
  console.error(`refused: ${entry.refused}`)
  process.exit(1)
}

const served = entry === "hosted" ? await import("@/hosted") : await import("@/local")

export const app = served.app
export default served.default
export type * from "@/local"
