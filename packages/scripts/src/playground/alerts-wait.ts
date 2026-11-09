// playground alerts-wait <name>: a manager's background wait on the queue its alerts come on (ops-stuck-alert.jsonl, where a session's own hook queues its stuck alerts and ops-tick's relay watch queues its late-stop line), so it wakes within a second or two rather than after the relay's own turn (74s measured on 26 Oct, against the owner's 30s). It reads ops-stuck-alert.jsonl from a byte cursor of its own per name, prints the first new line addressed to the name, and exits; the relay still sends every line, as the backstop. It keeps its pid in alerts-wait/<name>.pid while it waits, so stuck-alert can tell a manager with no waiter from one with.
import { mkdir, unlink } from "node:fs/promises"
import { join } from "node:path"

import { ALERT_JOB, WAITER_GRACE_MS, waiterPidPath } from "../stuck-alert"

// An alert queued WAITER_GRACE_MS before the wait began is past answering, since a prompt times out in 120s: a waiter started after days down skips its backlog rather than replaying it one run at a time (62 alerts on 7 Nov).

export async function alertsWait(
  name: string,
  outbox: string,
  pollMs = 1000,
  began = new Date(),
): Promise<string> {
  const file = join(outbox, `ops-${ALERT_JOB}.jsonl`)
  const cursorPath = join(outbox, "alerts-wait", name)
  await mkdir(join(outbox, "alerts-wait"), { recursive: true })
  await Bun.write(waiterPidPath(outbox, name), String(process.pid))
  const cursor = Bun.file(cursorPath)
  let at = (await cursor.exists())
    ? Number(await cursor.text()) || 0
    : await Bun.file(file)
        .exists()
        .then((exists) => (exists ? Bun.file(file).size : 0))
  let skipped = 0
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
        if (began.getTime() - Date.parse(entry.at ?? "") > WAITER_GRACE_MS) {
          skipped++
          continue
        }
        await Bun.write(cursorPath, String(offset))
        await unlink(waiterPidPath(outbox, name)).catch(() => {})
        const note = skipped
          ? `(skipped ${skipped} older alert${skipped === 1 ? "" : "s"}, queued over ${WAITER_GRACE_MS / 60_000} minutes before this wait began; the relay sent each) `
          : ""
        return `${note}${entry.at ?? ""} ${entry.text ?? ""}`
      }
      if (skipped) await Bun.write(cursorPath, String(offset))
      at = offset
    }
    await Bun.sleep(pollMs)
  }
}
