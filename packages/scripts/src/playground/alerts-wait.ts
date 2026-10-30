// playground alerts-wait <name>: a manager's background wait on the stuck alerts the session-state hook queues for it, so it wakes within a second or two rather than after the relay's own turn (74s measured on 26 Oct, against the owner's 30s). It reads ops-stuck-alert.jsonl from a byte cursor of its own per name, prints the first new line addressed to the name, and exits; the relay still sends every line, as the backstop.
import { mkdir } from "node:fs/promises"
import { join } from "node:path"

import { ALERT_JOB } from "../stuck-alert"

export async function alertsWait(name: string, outbox: string, pollMs = 1000): Promise<string> {
  const file = join(outbox, `ops-${ALERT_JOB}.jsonl`)
  const cursorPath = join(outbox, "alerts-wait", name)
  const cursor = Bun.file(cursorPath)
  let at = (await cursor.exists())
    ? Number(await cursor.text()) || 0
    : await Bun.file(file)
        .exists()
        .then((exists) => (exists ? Bun.file(file).size : 0))
  for (;;) {
    const size = Bun.file(file).size
    if (size < at) at = 0
    if (size > at) {
      const chunk = await Bun.file(file).slice(at, size).text()
      const whole = chunk.slice(0, chunk.lastIndexOf("\n") + 1)
      let offset = at
      for (const line of whole.split("\n").slice(0, -1)) {
        offset += Buffer.byteLength(line) + 1
        let entry: { at?: string; text?: string; to?: string }
        try {
          entry = JSON.parse(line)
        } catch {
          continue
        }
        if (entry.to !== name) continue
        await mkdir(join(outbox, "alerts-wait"), { recursive: true })
        await Bun.write(cursorPath, String(offset))
        return `${entry.at ?? ""} ${entry.text ?? ""}`
      }
      at = offset
    }
    await Bun.sleep(pollMs)
  }
}
