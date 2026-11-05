import { describe, expect, test } from "bun:test"

import { READ_ONLY_LINE } from "../../../../../../web/next/src/lib/relay"

const read = (file: string) => Bun.file(`web/next/src/components/dashboard/${file}`).text()

// the hosted build's relay carries reads alone, so its composer and write buttons offered sends that never arrived
describe("the hosted dashboard is read-only", () => {
  test("the composer gives way to the one read-only line on the hosted build, and stays whole on a local stack", async () => {
    const source = await read("composer.tsx")
    expect(source).toContain(
      'config.hosted ? <ReadOnlyLine className="mb-2 py-2" /> : <WritableComposer {...props} />',
    )
    expect(READ_ONLY_LINE).toBe("Read-only on Yard: send from your Mac")
  })

  test("the Inbox shows the line once, and its cards hold no footer, note box, read tick or bulk buttons", async () => {
    const source = await read("inbox.tsx")
    expect(source).toContain("{config.hosted && <ReadOnlyLine />}")
    expect(source).toContain("const footer = config.hosted ? null : (")
    expect(source).toContain("{unread && !config.hosted ? (")
    expect(source).toMatch(/!folded &&\s+!config\.hosted && \(/)
    expect(source).toContain("{config.hosted ? null : clearing === 0 ? (")
    expect(source).toMatch(/shelf\.length > 0 &&\s+!config\.hosted && \(/)
  })

  test("every other write button on the dashboard stands down on the hosted build", async () => {
    const writes: [string, string][] = [
      ["app-sidebar.tsx", "i === 0 && !muted && !config.hosted ? ("],
      ["app-sidebar.tsx", "!message || config.hosted) return null"],
      ["dashboard-view.tsx", "{list.start && config.hosted && <ReadOnlyLine />}"],
      ["login-expired.tsx", '<ReadOnlyLine className="mt-2" />'],
      ["needs-you-card.tsx", "if (config.hosted) return READ_ONLY_LINE"],
      ["pages.tsx", "onDelete={config.hosted ? undefined : setDeleting}"],
      ["preview-pane.tsx", "{shown?.vibe && shown.path && !config.hosted && ("],
      ["preview-pane.tsx", "{!config.hosted && ("],
      ["preview-pane.tsx", "{config.hosted ? (\n                <ReadOnlyLine />"],
      ["worker-stream.tsx", "onAnswer={config.hosted ? null : item.need.onAnswer}"],
      ["worker-stream.tsx", "{failed && !config.hosted ? ("],
    ]
    for (const [file, line] of writes) expect(await read(file)).toContain(line)
  })
})
