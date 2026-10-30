import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { ModePicker } from "../../../../../../web/next/src/components/dashboard/mode-picker"
import { MODE_LABELS, type modePicker } from "../../../../../../web/next/src/lib/permission-mode"
import { tipsOf } from "../../tooltips"

// React and React Query resolve from the web app's own packages, which this directory cannot see; the calls the test makes are typed here rather than through a path into node_modules.
type Node = unknown
type CreateElement = (type: unknown, props?: unknown, ...children: Node[]) => Node
const web = join(import.meta.dir, "../../../../../../web/next")
const { createElement } = (await import(Bun.resolveSync("react", web))) as {
  createElement: CreateElement
}
const { renderToStaticMarkup } = (await import(Bun.resolveSync("react-dom/server", web))) as {
  renderToStaticMarkup: (node: Node) => string
}
const { QueryClient, QueryClientProvider } = (await import(
  Bun.resolveSync("@tanstack/react-query", web)
)) as { QueryClient: new () => unknown; QueryClientProvider: unknown }

// Worker's type comes through the lib, as dashboard.test.ts takes it: the API's workers module resolves its own @/ paths, which the web's config cannot.
type Worker = Parameters<typeof modePicker>[0]

const worker = (overrides: Partial<Worker> = {}): Worker => ({
  cwd: "/tmp",
  effort: null,
  eta: null,
  failed: false,
  feed: [],
  lastActiveAt: null,
  lifecycle: "idle",
  light: "idle",
  model: null,
  name: "probe-sdk",
  questions: [],
  role: "other",
  sessionId: "s-sdk",
  startedAt: null,
  task: null,
  tasks: [],
  title: null,
  updatedAt: null,
  workspace: null,
  ...overrides,
})

const hosted = (mode: NonNullable<Worker["permissionMode"]>) =>
  worker({ hosted: true, permissionMode: mode })

const render = (approvals: boolean, of: Worker) =>
  renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(ModePicker, { approvals, worker: of }),
    ),
  )

describe("ModePicker", () => {
  test("a session with a terminal of its own shows none", () => {
    expect(render(true, worker())).toBe("")
  })

  for (const [mode, label] of Object.entries(MODE_LABELS)) {
    test(`it shows ${mode} by its words, and takes a pick while approvals are on`, () => {
      const html = render(true, hosted(mode as keyof typeof MODE_LABELS))
      // the name carries the mode, which a screen reader hears whatever the description says
      const trigger =
        html.match(new RegExp(`<button[^>]*aria-label="Permission mode: ${label}"[^>]*>`))?.[0] ??
        ""
      expect(trigger).not.toBe("")
      expect(trigger).not.toContain(` disabled=""`)
      expect(html).toContain(`>${label}<`)
    })
  }

  test("with approvals off it shows the mode, stays in the tab order and says why, and takes no pick", () => {
    const html = render(false, hosted("bypassPermissions"))
    const trigger =
      html.match(/<button[^>]*aria-label="Permission mode: Bypass permissions"[^>]*>/)?.[0] ?? ""
    expect(trigger).not.toBe("")
    expect(trigger).not.toContain(` disabled=""`)
    expect(trigger).not.toContain(`tabindex="-1"`)
    expect(trigger).toContain(`aria-description="Approvals are off"`)
    expect(trigger).not.toContain("title=")
    expect(tipsOf(html)).toContain("Bypass permissions mode. Approvals are off")
    expect(html).toContain(">Bypass permissions<")
  })

  // AI Elements' Prompt Input picks from a dropdown radio group; Base UI renders an open menu alone, so its read-only list is read from the source
  test("its list is a dropdown radio group, which takes no pick while approvals are off", async () => {
    const source = await Bun.file(join(web, "src/components/dashboard/mode-picker.tsx")).text()
    expect(source).toContain("<DropdownMenuRadioGroup")
    expect(source).toContain("disabled={picker.readOnly}")
    expect(source).not.toContain("Select")
  })
})
