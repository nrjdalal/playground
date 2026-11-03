import { join } from "node:path"

import { findAttachment } from "@/lib/dashboard/attachments"
import { checkoutRoot, readsLive } from "@/lib/dashboard/fixture"
import type { Upload } from "@/lib/dashboard/inbox"

// A Slack send's files, shared by `playground dm upload` from the API's own checkout, so the Slack token stays in that run's process (vault) and never passes through a session or an argv. A stack that does not read this machine (a fixture's, a test's) shares nothing, since its items are made up.
export const slackUpload =
  ({ live = readsLive(), root = checkoutRoot() } = {}): Upload =>
  async (place, files) => {
    if (!live) return
    if (!root) throw new Error("this API has no checkout to run dm upload from")
    const found = []
    for (const file of files) {
      const kept = await findAttachment(file.id)
      if (!kept) throw new Error(`${file.name} is gone from the attachments folder`)
      found.push({ name: file.name, path: kept.path })
    }
    const child = Bun.spawn(["bun", join(root, "packages/scripts/src/dm/cli.ts"), "upload"], {
      stderr: "pipe",
      stdin: new TextEncoder().encode(JSON.stringify({ ...place, files: found })),
      stdout: "ignore",
    })
    const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited])
    if (code !== 0)
      throw new Error(
        stderr
          .trim()
          .split("\n")
          .at(-1)
          ?.replace(/^error: /, "") || `exit ${code}`,
      )
  }
