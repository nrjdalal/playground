import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { InboxItem } from "../../../../../../api/hono/src/lib/dashboard/inbox"
import { DashboardContext } from "../../../../../../web/next/src/components/dashboard/dashboard"
import {
  AskChoices,
  FOLDS_OPEN,
  InboxCard,
  NewPill,
  ShelfDismiss,
  ShelfLabel,
} from "../../../../../../web/next/src/components/dashboard/inbox"
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
} from "../../../../../../web/next/src/components/ui/accordion"
import {
  Questionnaire,
  QuestionnaireItem,
} from "../../../../../../web/next/src/components/ui/questionnaire"
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

const decision = {
  answer: null,
  createdAt: "2026-10-12T10:00:00.000Z",
  delivery: null,
  from: "ops",
  id: "id-41",
  kind: "decision",
  preview: { prs: [{ number: 270, title: "x" }], sha: "3f9a2c1", type: "ship" },
  readAt: null,
  ref: 41,
  status: "open",
  title: "Ship canary 3f9a2c1 to main?",
  updatedAt: "2026-10-12T10:00:00.000Z",
  version: 0,
} as InboxItem

const render = (paused: boolean, item: InboxItem = decision, updated = false) =>
  renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(
        DashboardContext,
        { value: { workers: [] } as unknown as DashboardContext },
        createElement(InboxCard, {
          item,
          marked: false,
          now: Date.parse("2026-10-12T10:25:00.000Z"),
          paused,
          updated,
        }),
      ),
    ),
  )

// the opening tag of the button whose words hold the label
const named = (html: string, label: string): string =>
  html
    .split("<button")
    .slice(1)
    // by its words, or by its name alone for an icon button (Snooze, Archive)
    .find((button) => {
      const own = button.split("</button>")[0]!
      return own.includes(`>${label}`) || own.split(">")[0]!.includes(`aria-label="${label}"`)
    })
    ?.split(">")[0] ?? ""

// The delivery line names its poster by its label, and the label keeps the raw session name on hover, as the sender label does. The dashboard here holds no live session, so the poster reads as plain text with its hover.
describe("a delivered answer's poster", () => {
  const answered = {
    ...decision,
    answer: {
      at: "2026-10-12T10:05:00.000Z",
      choice: "approve",
      ackedAt: "2026-10-12T10:06:00.000Z",
    },
    delivery: {
      at: "2026-10-12T10:05:01.000Z",
      status: "delivered",
      via: "session",
    },
    status: "approved",
  } as InboxItem

  test("is shown by its label with the raw name on hover", () => {
    const html = render(false, answered)
    expect(html).toContain("Delivered to")
    expect(html).toContain('aria-description="ops"')
  })

  test("is the session that took the answer when the poster had ended, with its raw name on hover", () => {
    const html = render(false, {
      ...answered,
      delivery: { ...answered.delivery, to: "dispatcher" },
    } as InboxItem)
    expect(html).toContain('aria-description="dispatcher"')
  })
})

describe("a card that just moved under him", () => {
  test("pauses Approve, Deny and Archive, still focusable and saying why", () => {
    const html = render(true)
    for (const label of ["Approve", "Deny", "Archive"]) {
      const tag = named(html, label)
      expect(tag).toContain('aria-disabled="true"')
      expect(tag).not.toContain("title=")
      // the first tooltip after the button's opening tag is its own
      expect(tipsOf(html.split(tag)[1] ?? "")[0]).toBe(
        "This item just moved: its buttons wake in a moment",
      )
      expect(tag).not.toMatch(/\sdisabled=""/)
    }
  })

  test("offers them as usual when it has not moved", () => {
    const html = render(false)
    for (const label of ["Approve", "Deny", "Archive"]) {
      expect(named(html, label)).not.toContain("aria-disabled")
    }
  })
})

describe("a card's change and colour: its updated time, and colour for its kind and state", () => {
  const sending = {
    ...decision,
    answer: { at: "2026-10-12T10:20:00.000Z", choice: "approve" },
    delivery: { status: "pending" },
    status: "approved",
    updatedAt: "2026-10-12T10:20:00.000Z",
  } as InboxItem

  test("an open decision wears its kind's colour on its icon", () => {
    const html = render(false)
    expect(html).toContain("remixicon size-3.5 text-warning")
    expect(html).not.toContain("updated ")
  })

  test("the band's one time reads posted, or updated once changed, then read on hover once read, before its tick", () => {
    const open = render(false)
    expect(open).toMatch(/>posted [^<]+</)
    expect(open).not.toContain(">read ")
    const changed = render(false, sending)
    expect(changed).toMatch(/>updated 5 min\. ago</)
    const read = render(false, { ...sending, readAt: "2026-10-12T10:24:00.000Z" } as InboxItem)
    expect(read).toMatch(/class="hidden group-hover\/time:inline">read 1 min\. ago</)
    expect(read).toContain("cursor-default select-none")
    expect(read.indexOf(">updated 5 min. ago<")).toBeLessThan(read.indexOf('aria-label="Read"'))
  })

  test("a changed item says when it last changed, the one time on its line, and reads Updated only when told it changed since his last look", () => {
    const html = render(false, sending, true)
    expect(html).toContain('dateTime="2026-10-12T10:20:00.000Z"')
    expect(html).toContain("updated 5 min. ago")
    expect(html).not.toContain(`dateTime="${sending.createdAt}"`)
    expect(html).toContain(">Updated</span>")
    expect(render(false, sending, false)).not.toContain(">Updated</span>")
  })

  test("a go being carried out draws the sidebar's blue spinner, turning only where motion is allowed, its result line blue", () => {
    const html = render(false, sending)
    expect(html).toContain("remixicon size-4 text-info motion-safe:animate-spin")
    expect(html).toContain("min-w-0 text-xs text-info")
  })

  test("an unread alert wears red on its icon, never its kind's green", () => {
    const alert = {
      ...decision,
      kind: "update",
      preview: { outcome: "alert" },
      status: "done",
      title: "Disk is nearly full",
    } as InboxItem
    const html = render(false, alert)
    expect(html).toContain("remixicon size-3.5 text-destructive")
    expect(html).not.toContain("text-success")
  })

  test("the kind icon rides the muted band, the state icon the title's first line, each in a LEAD box so the icons align and their words start level", () => {
    const lead = '<span class="flex h-lh w-4 shrink-0 items-center justify-center">'
    for (const html of [render(false), render(false, sending)]) {
      expect(html).toMatch(
        /<p class="bg-muted [^"]*px-\(--pane-x\)[^"]*"><span class="flex h-lh w-4 shrink-0 items-center justify-center me-0\.5"><svg [^>]*class="remixicon size-3\.5 text-warning"/,
      )
      expect(html.split(lead).find((part) => part.startsWith("<svg"))).toMatch(
        /^<svg [^>]*class="remixicon size-4 /,
      )
    }
  })

  test("each dispatcher's name takes its own tone in the band, blue for Alpha and purple for Bravo", () => {
    const from = (who: string) => render(false, { ...decision, from: who } as InboxItem)
    expect(from("dispatcher")).toMatch(/class="text-info"[^>]*>Alpha</)
    expect(from("dispatcher-2")).toMatch(/class="text-bravo"[^>]*>Bravo</)
    expect(from("alpha")).not.toContain('text-info"')
  })

  test("a card takes focus from script alone, so taking the pill can hand focus to it", () => {
    const card =
      render(false).split('role="listitem"')[0]!.split("<div").at(-1)! +
      render(false).split('role="listitem"')[1]!.split(">")[0]!
    expect(card).toContain('tabindex="-1"')
  })

  test("an open decision draws the sidebar's orange eye beside its title", () => {
    expect(render(false)).toContain("remixicon size-4 text-caution")
  })

  test("Dismiss sits in the footer row left of Reply, an answered card's result above the row", () => {
    const html = render(false, sending)
    const dismiss = named(html, "Dismiss")
    expect(dismiss).not.toBe("")
    const reply = html.indexOf('aria-label="Chat about #i41"')
    expect(reply).toBeGreaterThan(-1)
    expect(html.indexOf("Being carried out")).toBeLessThan(html.indexOf(dismiss))
    expect(html.indexOf(dismiss)).toBeLessThan(reply)
  })
})

describe("one action where two overlapped, and Draft where the app has a draft API", () => {
  const update = {
    ...decision,
    kind: "update",
    preview: { outcome: "merged" },
    status: "done",
  } as InboxItem
  const draft = (link: string) =>
    ({
      ...decision,
      kind: "draft",
      preview: { link, text: "hi", to: "Merritt DM" },
    }) as InboxItem

  test("a card's answer names the updatedAt it showed, so the API refuses one to words its poster edited since", () => {
    const card = readFileSync(join(web, "src/components/dashboard/inbox.tsx"), "utf8")
    const client = readFileSync(join(web, "src/lib/inbox.ts"), "utf8")
    expect(card).toContain("answerItem(item, action, text, note.trim() || undefined)")
    expect(client).toContain("json: { action, note, seen: updatedAt, text }")
  })

  test("an unread update's line ends in a single tick, Mark as read; once read, a muted double tick named Read, and Dismiss stays", () => {
    const html = render(false, update)
    expect(named(html, "Dismiss")).not.toBe("")
    expect(named(html, "Mark as read")).not.toBe("")
    const seen = render(false, { ...update, readAt: "2026-10-12T10:05:00.000Z" })
    expect(named(seen, "Mark as read")).toBe("")
    expect(seen).toContain('aria-label="Read"')
    expect(named(seen, "Dismiss")).not.toBe("")
  })

  test("Dismiss is an icon button, named in its label", () => {
    const dismiss = named(render(false, update), "Dismiss")
    expect(dismiss.split(">")[0]).toContain('aria-label="Dismiss"')
    expect(dismiss.split("</button>")[0]).not.toContain(">Dismiss")
  })

  test("a Slack draft offers Send, Draft and Discard", () => {
    const html = render(false, draft("https://app.slack.com/client/T0000000000/D0MADEUP11"))
    expect(named(html, "Send")).not.toBe("")
    expect(named(html, "Draft")).not.toBe("")
    expect(named(html, "Discard")).not.toBe("")
  })

  test("a Linear comment offers no Draft, since Linear's API creates none", () => {
    const html = render(false, draft("https://linear.app/acme/issue/DUNE-1/x"))
    expect(named(html, "Send")).not.toBe("")
    expect(named(html, "Draft")).toBe("")
  })
})

// A dashboard user, 23 Oct: "When I'm done with it, there's no way to expand that window back up or even edit it".
describe("a card a chat reply collapsed", () => {
  const replied = (ackedAt?: string) =>
    ({
      ...decision,
      answer: { at: "2026-10-12T10:05:00.000Z", choice: "replied", ...(ackedAt && { ackedAt }) },
      kind: "draft",
      preview: {
        link: "https://app.slack.com/client/T0000000000/D0MADEUP11",
        text: "hi",
        to: "Merritt DM",
      },
    }) as InboxItem
  const toggle = (html: string) =>
    html
      .split("<button")
      .slice(1)
      .find((button) => button.includes('aria-label="Show actions"'))
      ?.split(">")[0] ?? ""

  test("reads as being worked on, folded: no Send, Draft, Discard or Snooze, and Show actions to open it, on E too", () => {
    const html = render(false, replied())
    expect(html).toContain("is on it…")
    for (const label of ["Send", "Draft", "Discard", "Snooze"]) expect(named(html, label)).toBe("")
    expect(toggle(html)).toContain('aria-expanded="false"')
    expect(toggle(html)).toContain('aria-keyshortcuts="E"')
  })

  test("an open card, or a reply its poster closed, offers no Show actions", () => {
    expect(toggle(render(false, { ...replied(), answer: null } as InboxItem))).toBe("")
    expect(toggle(render(false, replied("2026-10-12T10:06:00.000Z")))).toBe("")
  })
})

describe("a decision's labelled Approve and Deny options", () => {
  const labelled = {
    ...decision,
    id: "id-90",
    preview: {
      approve: "The port ships to staging and main.",
      deny: "The port waits; nothing moves.",
      text: "Port the fix to staging and main.",
      type: "ask",
    },
  } as InboxItem
  const unlabelled = {
    ...decision,
    id: "id-91",
    preview: { text: "Port the fix to staging and main.", type: "ask" },
  } as InboxItem

  test("a labelled ask renders each option with what it does, on the Questionnaire, and the On Approve line goes", () => {
    const html = render(false, labelled)
    expect(html).toContain('data-slot="questionnaire-choice"')
    expect(html).toContain("The port ships to staging and main.")
    expect(html).toContain("The port waits; nothing moves.")
    expect(html).toContain(">Approve</span>")
    expect(html).toContain(">Deny</span>")
    expect(html).not.toContain("On Approve,")
  })

  test("a labelled ask shows its text in the card's description, above its choices", () => {
    const html = render(false, labelled)
    const described = html.split('data-slot="questionnaire-description"')[1] ?? ""
    expect(described.split('data-slot="questionnaire-choice"')[0]).toContain(
      "Port the fix to staging and main.",
    )
  })

  test("an ask with no labels renders as it does today", () => {
    const html = render(false, unlabelled)
    expect(html).toContain("On Approve,")
    expect(html).toContain("does this:")
    expect(html).not.toContain('data-slot="questionnaire-choice"')
  })

  test("its Archive button says why on hover while the card is paused, as its siblings do", () => {
    const tag = named(render(true, labelled), "Archive")
    expect(tag).not.toBe("")
    expect(tipsOf(render(true, labelled).split(tag)[1] ?? "")[0]).toBe(
      "This item just moved: its buttons wake in a moment",
    )
  })
})

// Questionnaire counts a disabled choice as no answer, so disabling the picked side on a busy card (its answer on its way, or just moved under him) read as unanswered after Send's own check, and both choices drew red with aria-invalid until the card settled.
describe("a labelled ask's choices while the card is busy", () => {
  const labels = { approve: "Ship it", deny: "Hold it" }
  const choices = (state: { busy: boolean; paused: boolean }) =>
    renderToStaticMarkup(
      createElement(
        Questionnaire,
        null,
        createElement(
          QuestionnaireItem,
          { name: "question" },
          createElement(AskChoices, {
            ...state,
            labels,
            pick: "approve",
            setPick: () => undefined,
          }),
        ),
      ),
    )
  const radios = (html: string) => html.match(/<input[^>]*>/g) ?? []
  const group = (html: string) =>
    html.match(/<[^>]*data-slot="questionnaire-choices"[^>]*>/)?.[0] ?? ""
  // AskChoices holds no hooks, so it is called as a function and each choice's change fired as a click or a key would fire it
  type Choice = { props: { children: { props: { onChange: () => void } } } }
  const picked = (busy: boolean) => {
    const picks: string[] = []
    const element = AskChoices({
      busy,
      labels,
      paused: false,
      pick: "approve",
      setPick: (side) => picks.push(side),
    })
    for (const choice of element.props.children as Choice[]) choice.props.children.props.onChange()
    return picks
  }

  for (const [state, why] of [
    [{ busy: true, paused: false }, "while its answer is on its way"],
    [{ busy: true, paused: true }, "on a card that just moved under him"],
  ] as const) {
    test(`stay enabled ${why}, so the picked side still counts, dimmed under a busy group that takes no pointer`, () => {
      const html = choices(state)
      expect(radios(html)).toHaveLength(2)
      for (const radio of radios(html)) expect(radio).not.toMatch(/\sdisabled=""/)
      expect(group(html)).toContain('aria-busy="true"')
      expect(group(html)).toContain("pointer-events-none")
    })
  }

  test("a click or a key on a busy card leaves the pick as it was, and takes either side on an idle one", () => {
    expect(picked(true)).toEqual([])
    expect(picked(false)).toEqual(["approve", "deny"])
  })

  test("an idle card's group reads neither busy nor dimmed", () => {
    const html = choices({ busy: false, paused: false })
    expect(group(html)).not.toBe("")
    expect(group(html)).not.toContain("aria-busy")
    expect(group(html)).not.toContain("opacity-50")
  })
})

// The picker only opens to a click, which this server-render harness cannot replay, so its closes are pinned on the component's own source.
describe("a picked time never opens a row nothing closes", () => {
  const source = readFileSync(
    join(import.meta.dir, "../../../../../../web/next/src/components/dashboard/inbox.tsx"),
    "utf8",
  )
  const picker = source.slice(
    source.indexOf("{picking && !done && !folded && schedulable(item) && ("),
    source.indexOf("{error && <p"),
  )
  const schedule = source.slice(
    source.indexOf("function Schedule"),
    source.indexOf("function InboxCard"),
  )

  test("the row closes three ways: Escape on the input, Set (which schedules first), and Cancel", () => {
    expect([...picker.matchAll(/closePicking/g)]).toHaveLength(3)
    expect(picker).toContain('if (event.key === "Escape") closePicking()')
    expect(picker).toContain("onClick={closePicking}")
    expect(picker).toContain("Cancel")
  })

  test("Schedule takes the picking state through setPicking alone, and renders the menu directly", () => {
    expect(schedule).toContain("setPicking: (picking: boolean) => void")
    expect(schedule).not.toContain("<>")
    expect(schedule).not.toContain("</>")
  })
})

// Schedule's row once had no render test: breaking its guard left every test green. These two rows hold it from both sides.
describe("Schedule's row", () => {
  test("an open ask offers Snooze", () => {
    expect(named(render(false), "Snooze")).not.toBe("")
  })

  test("a card's Mark as read only marks it seen, answering and dismissing nothing, and an ask once read keeps its buttons but the ✓✓", () => {
    const source = readFileSync(join(web, "src/components/dashboard/inbox.tsx"), "utf8")
    const at = source.indexOf('aria-label="Mark as read"')
    const click = source.slice(at, source.indexOf("</button>", at))
    expect(click).toContain("onClick={onRead}")
    expect(source).toContain("onRead={() => read()}")
    expect(source).toContain(
      "const read = () => (unread && !paused ? void settle(() => markRead([item.id])) : undefined)",
    )
    expect(source).not.toContain('answerItem(item.id, "read"')
    expect(source).not.toContain('answerItem(item, "read"')
    const seen = render(false, { ...decision, readAt: "2026-10-12T10:05:00.000Z" } as InboxItem)
    expect(named(seen, "Mark as read")).toBe("")
    expect(seen).toContain('aria-label="Read"')
    for (const label of ["Approve", "Deny", "Archive", "Snooze"])
      expect(named(seen, label)).not.toBe("")
  })

  test("the comment box reads Add an optional comment, named Comment, the same gap-2 below the choices as between them", () => {
    const source = readFileSync(join(web, "src/components/dashboard/inbox.tsx"), "utf8")
    expect(source).toContain(
      '<CardContent className="mt-[calc(--spacing(2)-var(--card-spacing))]">',
    )
    const html = render(false)
    expect(html).toContain('placeholder="Add an optional comment"')
    expect(html).toContain('aria-label="Comment"')
  })

  test("an unread ask keeps its light and draws no unread dot, which stays an update's", () => {
    expect(render(false)).not.toContain("bg-primary size-2 rounded-full")
    expect(
      render(false, {
        ...decision,
        kind: "update",
        preview: { outcome: "merged" },
        status: "done",
      } as InboxItem),
    ).toContain("bg-primary size-2 rounded-full")
  })

  test("an open decision's Mark as read is the single tick on its kind line, out of the footer, where Archive leads Snooze", () => {
    const html = render(false)
    const read = named(html, "Mark as read")
    expect(read).not.toBe("")
    const footer = html.indexOf("ml-auto flex shrink-0 gap-2")
    expect(html.indexOf(read)).toBeLessThan(footer)
    expect(html.slice(footer)).not.toContain('aria-label="Mark as read"')
    expect(html.indexOf(named(html, "Archive"))).toBeLessThan(html.indexOf(named(html, "Snooze")))
  })

  test("an answered one does not", () => {
    const answered = {
      ...decision,
      answer: { at: "2026-10-12T10:05:00.000Z", choice: "approve" },
      status: "approved",
    } as InboxItem
    expect(named(render(false, answered), "Snooze")).toBe("")
    expect(named(render(false, answered), "Mark as read")).toBe("")
  })
})

// A settled card's result once sat in the footer row between Dismiss and Reply, and a long line wrapped between the two buttons: the result reads above the row now, and Dismiss stands directly left of Reply in it.
describe("a settled card's footer", () => {
  const settled = {
    ...decision,
    answer: {
      at: "2026-10-12T10:05:00.000Z",
      by: "ops",
      choice: "settled",
      note: "Dismissed by the poster once the restart went out and the task moved to the runner that took the rename, so this item's whole story runs long enough to wrap over two lines at any width.",
    },
    status: "done",
  } as InboxItem

  test("the result sits above the footer row and Dismiss stands in the row, left of Reply", () => {
    const html = render(false, settled)
    const resultAt = html.indexOf("Answered by")
    const footerAt = html.indexOf('data-slot="card-footer"')
    const dismissAt = html.indexOf(named(html, "Dismiss"))
    const replyAt = html.indexOf('aria-description="Chat about it"')
    expect(resultAt).toBeGreaterThan(-1)
    expect(footerAt).toBeGreaterThan(-1)
    expect(dismissAt).toBeGreaterThan(-1)
    expect(replyAt).toBeGreaterThan(-1)
    expect(resultAt, "the result reads above the footer row").toBeLessThan(footerAt)
    expect(dismissAt, "Dismiss sits in the footer row").toBeGreaterThan(footerAt)
    expect(dismissAt, "Dismiss stands left of Reply").toBeLessThan(replyAt)
    expect(
      html.slice(dismissAt, replyAt).indexOf("<p "),
      "no result line between the two buttons",
    ).toBe(-1)
  })

  test("the poster's settle reason reads once, in the result, never as Your note, since he never wrote it", () => {
    const html = render(false, settled)
    expect(html).not.toContain("Your note")
    const approved = {
      ...decision,
      answer: { at: "2026-10-12T10:05:00.000Z", choice: "approve", note: "Ship it after lunch." },
      status: "done",
    } as InboxItem
    expect(render(false, approved)).toContain("Your note: Ship it after lunch.")
  })
})

// Dismiss belongs in Reply's row (#i510): it moves into the right-hand group, directly left of Reply, out of the footer's left end.
describe("a settled card's right-hand group", () => {
  const settled = {
    ...decision,
    answer: {
      at: "2026-10-12T10:05:00.000Z",
      by: "ops",
      choice: "settled",
      note: "Settled by the poster, so the card offers Dismiss and Reply alone.",
    },
    status: "done",
  } as InboxItem

  test("Dismiss stands inside Reply's own group, directly before it", () => {
    const html = render(false, settled)
    const groupAt = html.indexOf("ml-auto")
    const dismissAt = html.indexOf(named(html, "Dismiss"))
    const replyAt = html.indexOf('aria-label="Chat about #i41"')
    expect(groupAt).toBeGreaterThan(-1)
    expect(dismissAt).toBeGreaterThan(-1)
    expect(replyAt).toBeGreaterThan(-1)
    expect(dismissAt, "Dismiss sits after the group opens, inside it").toBeGreaterThan(groupAt)
    expect(dismissAt, "Dismiss stands left of Reply").toBeLessThan(replyAt)
    expect(
      html.slice(dismissAt, replyAt).split("<button").length - 1,
      "the only button between Dismiss and Reply is Reply's own",
    ).toBe(1)
  })
})

// The Inbox is one accordion: the open items' row, then a row for each shelf.
describe("the Inbox as one accordion: the open items, then Snoozed, Archived and Done", () => {
  const source = readFileSync(join(web, "src/components/dashboard/inbox.tsx"), "utf8")
  const shelf = (count: number) =>
    renderToStaticMarkup(
      createElement(
        Accordion,
        { multiple: true },
        createElement(
          AccordionItem,
          { disabled: count === 0, value: "Snoozed" },
          createElement(
            AccordionTrigger,
            null,
            createElement(ShelfLabel, { count, icon: () => null, label: "Snoozed" }),
          ),
        ),
      ),
    )

  test("a shelf's row reads its name, then its count as a mono outline label", () => {
    const html = shelf(3)
    const badge = /<span [^>]*data-slot="badge"[^>]*>3<\/span>/.exec(html)?.[0] ?? ""
    expect(badge).toContain('data-variant="outline"')
    expect(badge).toContain("font-mono")
    expect(html.indexOf("Snoozed")).toBeLessThan(html.indexOf(badge))
  })

  test("an empty shelf's row is grayed and shut, and one with items opens", () => {
    const trigger = (html: string) =>
      /<button [^>]*data-slot="accordion-trigger"[^>]*>/.exec(html)?.[0] ?? ""
    expect(trigger(shelf(0))).toContain('disabled=""')
    expect(trigger(shelf(2))).not.toContain('disabled=""')
  })

  test("the rows run open items, In progress, Snoozed, Archived, Done, and the snoozed come from the API's own list, never items", () => {
    expect(source).toContain('<AccordionItem value="open" disabled={rows.length === 0}')
    const order = ['["In progress"', '["Snoozed"', '["Archived"', '["Done"'].map((row) =>
      source.indexOf(row),
    )
    expect(order.every((at) => at > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(source).toContain("const snoozed = data?.snoozed ?? []")
    expect(source).toContain("const summary = inboxSummary(shown)")
  })

  test("the open items start open and the shelves shut, and taking the pill or a link to a folded card opens the list", () => {
    expect(FOLDS_OPEN).toEqual({ open: true })
    expect(source).toContain("const [listOpen, setListOpen] = useState<boolean>(FOLDS_OPEN.open)")
    expect(source).toContain("const [shelvesOpen, setShelvesOpen] = useState<string[]>([])")
    expect(source).toContain('...(listOpen && rows.length > 0 ? ["open"] : []),')
    expect(source).toMatch(/const take = \(\) => \{\n\s+setListOpen\(true\)/)
    expect(source).toMatch(/if \(!listOpen && rows\.some\([^\n]*\) \{\n\s+setListOpen\(true\)/)
  })

  test("an empty row is never open: with no items, no row shows on a blank panel, and the open list keeps his choice for when items come", () => {
    expect(source).toContain('...(listOpen && rows.length > 0 ? ["open"] : []),')
    expect(source).toContain(
      '...shelvesOpen.filter((key) => key === "Preview" || (shelfSizes[key] ?? 0) > 0),',
    )
    expect(source).toContain('if (rows.length > 0) setListOpen(value.includes("open"))')
  })

  test("an archived card takes Dismiss on its shelf, and the Archived row empties in one click", () => {
    expect(source).toContain('{(!done || item.status === "cleared") && dismissable(item) && (')
    expect(source).toContain(
      'label === "Archived" ? "Dismiss all archived" : "Mark all done as read"',
    )
    expect(source).toContain("ids={shelf.filter(dismissable).map((item) => item.id)}")
    expect(source).toContain("onDismiss={(ids) => void bulk(() => dismissItems(ids))}")
  })

  test("Done's ✓✓ marks every item in it read, and is gone once all are", () => {
    expect(source).toContain(
      '{label !== "Snoozed" && label !== "In progress" && shelf.length > 0 && (',
    )
    const button = (ids: string[]) =>
      /<button[^>]*>/.exec(
        renderToStaticMarkup(
          createElement(ShelfDismiss, {
            disabled: false,
            ids,
            label: "Mark all done as read",
            onDismiss: () => {},
          }),
        ),
      )?.[0] ?? ""
    expect(button(["a", "b"])).toContain('aria-label="Mark all done as read"')
    expect(button(["a", "b"])).not.toContain(' disabled=""')
    expect(button([])).toBe("")
  })

  test("Done with nothing left to read reads muted as an empty shelf, yet still opens, full again on hover or while open", () => {
    expect(source).toMatch(
      /label === "Done" &&\n\s+shelf\.filter\(dismissable\)\.length === 0 &&\n\s+"opacity-50 hover:opacity-100 aria-expanded:opacity-100"/,
    )
    expect(source).toContain("disabled={shelf.length === 0}")
  })

  test("every shelf counts what it holds, Done its history too, and Done tells a screen reader how many are unread", () => {
    expect(source).toContain("count={shelf.length}")
    expect(source).toContain(
      'unread={label === "Done" ? shelf.filter(dismissable).length : undefined}',
    )
    const html = renderToStaticMarkup(
      createElement(ShelfLabel, { count: 4, icon: () => null, label: "Done", unread: 0 }),
    )
    expect(html).toMatch(/data-slot="badge"[^>]*>4<\/span>/)
    expect(html).toMatch(/<span class="sr-only">, (<!-- -->)?0(<!-- -->)? unread<\/span>/)
  })

  test("each row ends in its ShelfMark, the open row and every shelf, and In progress offers no ✓ since its poster closes it", () => {
    expect(source).toContain("<ShelfMark empty={shown.length === 0} />")
    expect(source).toContain("<ShelfMark empty={shelf.length === 0} />")
    expect(source).toContain(
      '{label !== "Snoozed" && label !== "In progress" && shelf.length > 0 && (',
    )
  })

  test("the open row reads Inbox and its own count as the shelves do, zero included, the summary kept for a screen reader", () => {
    expect(source).toMatch(
      />\n\s+Inbox\n\s+<\/span>\n\s+<span className="sr-only">\{summary \?\? "All caught up"\}<\/span>/,
    )
    expect(source).toMatch(
      /<\/span>\n\s+\{\/\*[^\n]*\*\/\}\n\s+<Badge variant="outline" className="text-2xs h-4 px-1\.5 font-mono tabular-nums">\n\s+\{shown\.length\}/,
    )
  })

  test("a fold keeps the open cards mounted, so what a card holds (a draft typed) is still there when the list opens again", () => {
    expect(source).toContain("<AccordionContent keepMounted className={SHELF_PANEL}>")
  })

  test("the open row's tick is a single ✓ while anything is unread, and a muted ✓✓ All read once all is, the shelves' ✓ too", () => {
    const actions = source.slice(source.indexOf("const actions ="), source.indexOf("const bulk ="))
    expect(actions).toContain("const actions = (pill || rows.length > 0) && (")
    expect(actions).toMatch(
      /\{clearing === 0 \? \(\n\s+<span[^>]*>\n\s+<RiCheckDoubleLine className="size-3" aria-label="All read" \/>/,
    )
    expect(actions).toContain("<RiCheckLine />")
    const shelf = source.slice(
      source.indexOf("export function ShelfDismiss"),
      source.indexOf("export function ShelfDismiss") + 900,
    )
    expect(shelf).toContain("<RiCheckLine />")
  })

  test("Mark all as read is a bare icon button laid over the open row, named and hinted, outside the trigger: it marks every unread item seen and answers and dismisses none", () => {
    const actions = source.slice(source.indexOf("const actions ="), source.indexOf("const bulk ="))
    expect(actions).toContain('aria-label="Mark all as read"')
    expect(actions).toContain('size="icon-xs"')
    expect(actions).toContain('variant="ghost"')
    expect(actions).toContain(
      "<Hint content={`Mark all as read: ${clearing} stay in the list until done`}>",
    )
    expect(actions).toContain("void bulk(() => markRead(unreadIds))")
    expect(actions).not.toContain("dismissItems")
    expect(actions).not.toContain("answerItem")
    expect(source).toContain(
      '.filter((item) => item.readAt === null && (item.kind === "update" || item.status === "open"))',
    )
    expect(source).toContain('pill ? "pr-40" : rows.length > 0 && "pr-10",')
    // the header holds it beside the trigger, never inside it, so pressing it never folds the row
    expect(source).toMatch(/\{props\.children\}\n\s+\{actions\}\n\s+<\/h3>/)
  })

  // 1 new update follows the Dismiss all pattern, in white
  test("the new-update pill is an xs Button at its own radius, white, the open row's one call to act", () => {
    type Element = { props: Record<string, unknown> }
    const pill = (
      [NewPill({ count: 2, leaving: false, onTake: () => {} })] as unknown as Element[]
    ).find((e) => "size" in e.props)
    expect(pill?.props.size).toBe("xs")
    expect(pill?.props.variant).toBeUndefined()
    expect(String(pill?.props.className)).not.toContain("rounded-full")
  })

  test("the note's least height follows its card's first choice as that grows, and is one line with no choices", () => {
    const note = source.slice(source.indexOf("function NoteBox"), source.indexOf("const GLIDE_MS"))
    expect(note).toContain('.querySelector<HTMLElement>("[data-slot=questionnaire-choices] > *")')
    expect(note).toContain("new ResizeObserver(")
    expect(note).toContain("area.style.minHeight = `${choice.offsetHeight}px`")
    expect(note).toContain("observer.observe(choice)")
    // with no choices (a draft), as tall as an Approve choice
    expect(note).toContain('className={cn("min-h-14 py-2", BOX)}')
  })

  test("inbox.tsx draws no Marker of its own and no second fold: the accordion is its one", () => {
    expect(source).not.toContain("<Marker")
    expect(source).not.toContain("<Collapsible")
    expect(source.match(/<Accordion\b/g)?.length).toBe(1)
  })
})

// The space below Done holds a preview tab for active development.
describe("the Preview row under Done", () => {
  const source = readFileSync(join(web, "src/components/dashboard/inbox.tsx"), "utf8")
  const row = source.slice(source.indexOf('<AccordionItem value="Preview"'))

  test("reads Preview with no count, as a shelf row reads its name", () => {
    const html = renderToStaticMarkup(
      createElement(ShelfLabel, { icon: () => null, label: "Preview" }),
    )
    expect(html).toContain("Preview")
    expect(html).not.toContain('data-slot="badge"')
  })

  test("is the accordion's last row, after Done, and holds the preview pane", () => {
    expect(source.indexOf('["Done", RiCheckDoubleLine, done, true]')).toBeLessThan(
      source.indexOf('<AccordionItem value="Preview"'),
    )
    expect(row.slice(0, row.indexOf("</AccordionItem>"))).toContain("<PreviewPane />")
    expect(row.indexOf("</AccordionItem>")).toBeLessThan(row.indexOf("</Accordion>"))
  })

  test("is always there, even with an empty Inbox, and starts shut but opens whatever the shelves hold", () => {
    expect(row.slice(0, row.indexOf(">"))).not.toContain("disabled")
    expect(source).not.toContain("if (items.length === 0)")
    expect(source).toContain(
      '...shelvesOpen.filter((key) => key === "Preview" || (shelfSizes[key] ?? 0) > 0)',
    )
    expect(source).toContain("const [shelvesOpen, setShelvesOpen] = useState<string[]>([])")
  })
})

// The inbox's text takes shadcn's AI Elements (https://ui.shadcn.com/docs/components/base/questionnaire): every card is one question on shadcn's Questionnaire, composed with the Card's slots as shadcn's own card example does.
describe("every kind of card on the Questionnaire", () => {
  const draft = {
    ...decision,
    kind: "draft",
    preview: {
      link: "https://app.slack.com/client/T0000000000/D0MADEUP11",
      text: "hi",
      to: "Merritt DM",
    },
  } as InboxItem
  const update = {
    ...decision,
    kind: "update",
    preview: { outcome: "merged" },
    status: "done",
    title: "Merged: changelog entries read as text",
  } as InboxItem
  const failed = {
    ...decision,
    answer: { at: "2026-10-12T10:05:00.000Z", choice: "approve" },
    delivery: { code: "NOT_FOUND", reason: "No live session is named ops.", status: "failed" },
    status: "approved",
  } as InboxItem
  const doneCard = (item: InboxItem) =>
    renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(
          DashboardContext,
          { value: { workers: [] } as unknown as DashboardContext },
          createElement(InboxCard, {
            done: true,
            item,
            marked: false,
            now: Date.parse("2026-10-12T10:25:00.000Z"),
            paused: false,
            updated: false,
          }),
        ),
      ),
    )

  // the card's one question: the form, its shown item, and the title that names it
  const question = (html: string, title: string) => {
    expect(html).toContain('data-slot="questionnaire"')
    const item = /<fieldset [^>]*data-slot="questionnaire-item"[^>]*>/.exec(html)?.[0] ?? ""
    expect(item).toContain("data-active")
    expect(item).not.toContain("hidden")
    const labelledBy = /aria-labelledby="([^"]+)"/.exec(item)?.[1]
    const heading = new RegExp(`<div data-slot="questionnaire-title"[^>]*id="${labelledBy}"[^>]*>`)
    expect(html).toMatch(heading)
    expect(html.split(heading)[1]).toContain(title)
  }
  const description = (html: string) =>
    html.split('data-slot="questionnaire-description"')[1]?.split("</div>")[0] ?? ""
  // the description's own opening tag
  const descriptionTag = (html: string) =>
    /<[a-z]+ [^>]*data-slot="questionnaire-description"[^>]*>/.exec(html)?.[0] ?? ""

  test("a decision's title is the question and what Approve does is its description", () => {
    const html = render(false)
    question(html, "Ship canary 3f9a2c1 to main?")
    expect(description(html)).toContain("On Approve, main moves to")
  })

  test("a Slack decision's words stay plain text, line breaks kept and nothing rendered, so what is sent is what was read", () => {
    const slack = {
      ...decision,
      preview: {
        link: "https://app.slack.com/client/T0000000000/D0MADEUP11",
        text: "hey **merritt**\nsee [the fix](https://example.com)",
        to: "@Merritt",
        type: "slack",
      },
    } as InboxItem
    const html = render(false, slack)
    expect(description(html)).toContain("hey **merritt**\nsee [the fix](https://example.com)")
    expect(description(html)).toContain("whitespace-pre-wrap")
    expect(description(html)).not.toContain("<strong")
  })

  test("a Slack decision's thread so far leads it, each gist rendered as transcript text under who said it, the reply still plain", () => {
    const slack = {
      ...decision,
      preview: {
        link: "https://app.slack.com/client/T0000000000/D0MADEUP11",
        text: "on it, **merritt**",
        thread: [{ said: "the export ends at **100** rows", who: "Merritt" }],
        to: "@Merritt",
        type: "slack",
      },
    } as InboxItem
    // the gist's markdown holds divs of its own, so the description is read past its first </div>
    const html = render(false, slack).split('data-slot="questionnaire-description"')[1] ?? ""
    const [soFar = "", reply = ""] = html.split("On Approve")
    expect(soFar).toContain("So far")
    expect(soFar).toContain("Merritt:</span>")
    expect(soFar).toContain(`data-streamdown="strong"`)
    expect(reply).toContain("on it, **merritt**")
    expect(reply).not.toContain("data-streamdown")
  })

  test("a labelled ask is shadcn's questionnaire card: numbered choices, and Send as Submit in the footer's actions inside the form", () => {
    const labelled = {
      ...decision,
      preview: { approve: "It ships.", deny: "It waits.", text: "Ship it.", type: "ask" },
    } as InboxItem
    const html = render(false, labelled)
    question(html, "Ship canary 3f9a2c1 to main?")
    expect(html.split("<form").length - 1).toBe(1)
    expect(/<form [^>]*>/.exec(html)?.[0]).toContain('data-shortcuts="numbers"')
    const [inside, outside] = html.split("</form>")
    expect(inside!.split("</fieldset>")[0]).toContain('data-slot="questionnaire-choice"')
    const actions =
      inside!.split('data-slot="card-footer"')[1]?.split('data-slot="questionnaire-actions"')[1] ??
      ""
    expect(named(actions, "Send")).toContain('data-slot="questionnaire-submit"')
    expect(named(actions, "Send")).toContain('type="submit"')
    for (const label of ["Archive", "Snooze", "Dismiss"]) {
      if (named(actions, label)) expect(named(actions, label)).toContain('type="button"')
    }
    // no Edit: the note carries any change
    expect(named(actions, "Edit")).toBe("")
    expect(named(actions, "Archive")).not.toBe("")
    expect(outside).not.toContain('data-slot="card-footer"')
  })

  test("a labelled ask with no side picked offers Send off, saying why, at the footer's left end, and never the Questionnaire's error", () => {
    const labelled = {
      ...decision,
      preview: { approve: "It ships.", deny: "It waits.", text: "Ship it.", type: "ask" },
    } as InboxItem
    const html = render(false, labelled)
    const send = named(html, "Send")
    expect(send).toContain('aria-disabled="true"')
    expect(send).not.toMatch(/\sdisabled=""/)
    expect(send).toContain('aria-description="Pick Approve or Deny first"')
    expect(tipsOf(html.split(send)[1] ?? "")[0]).toBe("Pick Approve or Deny first")
    expect(html).not.toContain('data-slot="questionnaire-error"')
    for (const [choice] of html.matchAll(/<input [^>]*type="radio"[^>]*>/g)) {
      expect(choice).not.toMatch(/\srequired=""/)
    }
    const actions = html.split('data-slot="questionnaire-actions"')[1] ?? ""
    const buttons = [...actions.matchAll(/<button[^>]*>[\s\S]*?<\/button>/g)].map(([b]) => b)
    expect(buttons[0]).toContain('data-slot="questionnaire-submit"')
    expect(buttons[1]).toContain('aria-label="Archive"')
    expect(/data-slot="questionnaire-actions" class="([^"]*)"/.exec(html)?.[1]).toMatch(
      /\bflex flex-wrap\b/,
    )
  })

  test("a labelled ask that just moved holds its choices, so the number keys pick nothing, and its Send, still focusable and saying why", () => {
    const labelled = {
      ...decision,
      preview: { approve: "It ships.", deny: "It waits.", text: "Ship it.", type: "ask" },
    } as InboxItem
    const html = render(true, labelled)
    // the choices stay enabled so a checked card never reads unanswered: their group takes no pointer and reads busy, and their change is ignored, so a number key picks nothing
    const choices = [...html.matchAll(/<input [^>]*type="radio"[^>]*>/g)].map(([tag]) => tag)
    expect(choices).toHaveLength(2)
    for (const choice of choices) expect(choice).not.toMatch(/\sdisabled=""/)
    expect(html).toMatch(
      /<[^>]*data-slot="questionnaire-choices"[^>]*aria-busy="true"[^>]*>|<[^>]*aria-busy="true"[^>]*data-slot="questionnaire-choices"[^>]*>/,
    )
    const send = named(html, "Send")
    expect(send).toContain('aria-disabled="true"')
    expect(send).not.toMatch(/\sdisabled=""/)
    expect(tipsOf(html.split(send)[1] ?? "")[0]).toBe(
      "This item just moved: its buttons wake in a moment",
    )
  })

  test("the footer sits outside the form, so a key pressed on its buttons or its time field never submits the question", () => {
    for (const html of [render(false), render(false, draft), render(false, failed)]) {
      const [inside, outside] = html.split("</form>")
      expect(inside).not.toContain('data-slot="card-footer"')
      expect(outside).toContain('data-slot="card-footer"')
    }
  })

  test("a draft is a question whose words he edits in place", () => {
    const html = render(false, draft)
    question(html, "Ship canary 3f9a2c1 to main?")
    expect(html.split("</fieldset>")[0]).toContain('aria-label="Message to Merritt DM"')
  })

  test("a draft with a thread so far shows it above Your reply, and one without shows neither", () => {
    const threaded = render(false, {
      ...draft,
      preview: {
        link: "https://app.slack.com/client/T0000000000/D0MADEUP11",
        text: "hi",
        thread: [{ said: "can you try the export again?", who: "Merritt" }],
        to: "Merritt DM",
      },
    } as InboxItem)
    expect(threaded.indexOf("So far")).toBeGreaterThan(-1)
    expect(threaded.indexOf("So far")).toBeLessThan(threaded.indexOf("Your reply"))
    expect(threaded.indexOf("Your reply")).toBeLessThan(
      threaded.indexOf('aria-label="Message to Merritt DM"'),
    )
    const plain = render(false, draft)
    expect(plain).not.toContain("So far")
    expect(plain).not.toContain("Your reply")
  })

  test("an update is a question with its title alone", () => {
    const html = render(false, update)
    question(html, "Merged: changelog entries read as text")
    expect(html).not.toContain('data-slot="questionnaire-description"')
  })

  test("a failed send's result is its description, in red, with Retry", () => {
    const html = render(false, failed)
    question(html, "Ship canary 3f9a2c1 to main?")
    expect(description(html)).toContain("Send failed: No live session is named ops.")
    expect(descriptionTag(html)).toContain("text-destructive")
    expect(named(html, "Retry")).not.toBe("")
  })

  test("a card in Done is the same question, with no gray behind it", () => {
    const html = doneCard(update)
    question(html, "Merged: changelog entries read as text")
    expect(html).not.toContain("bg-muted/40")
  })

  test("no card wears a coloured left edge, in any state, since a thick coloured border reads as noise", () => {
    const alert = {
      ...update,
      preview: { outcome: "alert" },
      title: "Disk is nearly full",
    } as InboxItem
    for (const html of [
      render(false),
      render(false, draft),
      render(false, update),
      render(false, alert),
      render(false, failed),
      doneCard(update),
    ]) {
      expect(html).not.toMatch(/before:(bg-|w-|absolute)/)
      // only the quoted words' neutral rule, never a coloured edge on the card
      for (const edge of html.match(/border-l-\S+/g) ?? []) expect(edge).toBe("border-l-2")
      expect(html).not.toMatch(/border-l-2[^"]*border-(caution|destructive|info|success|warning)/)
    }
  })
})

describe("an ask's text renders as chat does", () => {
  const ask = (text: string) =>
    ({ ...decision, id: "id-92", preview: { text, type: "ask" } }) as InboxItem

  test("a fenced block shows as a highlighted code block with its copy button", () => {
    const html = render(false, ask("Run this:\n\n```ts\nconst a = 1\n```"))
    expect(html.match(/data-slot="code-block"/g)).toHaveLength(1)
    expect(html).toContain('data-slot="code-block-copy-button"')
    expect(html).toContain("Run this:")
  })

  test('code reads at the small size and wraps, as the owner asked ("the font is too large in codeblock")', () => {
    const html = render(false, ask("```ts\nconst a = 1\n```"))
    expect(html).toContain('data-slot="code-block" data-variant="default" data-size="sm"')
    expect(html).toContain('data-wrap="true"')
  })

  test('a drawing never wraps, its font fitting its widest line to the card ("should be width aware ascii\'s and all")', () => {
    const html = render(false, ask("```text\n+----+\n| ok |\n+----+\n```"))
    expect(html).not.toContain('data-wrap="true"')
    expect(html).toMatch(/data-slot="code-block"[^>]*@container/)
  })

  test('a drawing\'s rows sit close so box-drawing lines join, while code keeps its spacing ("looks right but not connected, ascii art would be hard this way")', () => {
    expect(render(false, ask("```\n┌─┐\n└─┘\n```"))).toMatch(/<pre [^>]*leading-\[1\.3\]/)
    expect(render(false, ask("```ts\nconst a = 1\n```"))).not.toContain("leading-[1.3]")
  })

  test("a code block takes the table's border, not the input's brighter one (\"the codeblock border color is brighter than table and image/file border\")", () => {
    const block = /<div [^>]*data-slot="code-block"[^>]*>/.exec(
      render(false, ask("```ts\nconst a = 1\n```")),
    )?.[0]
    expect(block).toContain("border-border")
    expect(block).not.toContain("border-input")
  })

  test("plain text keeps its words and every line break, with no code block", () => {
    const html = render(false, ask("First line\nSecond line"))
    expect(html).not.toContain('data-slot="code-block"')
    expect(html).toMatch(/First line<br\/>\s*Second line/)
  })
})

// a card that only shows something asks nothing, so it carries no Approve or Deny
describe("a read-only card: an update that shows an ask's text and files", () => {
  const update = {
    ...decision,
    id: "id-93",
    kind: "update",
    preview: { outcome: "finding" },
    status: "done",
  } as InboxItem
  const shown = {
    ...update,
    preview: {
      attachments: [
        { id: "0b7c4e2a-1f3d-4c5e-8a9b-2d6f7e8a9b0c.png", kind: "image", name: "table.png" },
      ],
      outcome: "finding",
      text: "The table you asked for:\n\n```ts\nconst rows = 3\n```",
    },
  } as InboxItem

  test("renders its words as an ask's, with its file, and no Approve, Deny or On Approve line", () => {
    const html = render(false, shown)
    expect(html).toContain("The table you asked for:")
    expect(html.match(/data-slot="code-block"/g)).toHaveLength(1)
    expect(html).toContain('data-slot="attachment-thumbs"')
    expect(html).toContain("table.png")
    expect(html).not.toContain("On Approve")
    expect(html).not.toContain(">Approve<")
    expect(html).not.toContain(">Deny<")
    expect(html).not.toContain('data-slot="questionnaire-choice"')
    expect(named(html, "Mark as read")).not.toBe("")
    expect(named(html, "Dismiss")).not.toBe("")
  })

  test("an update with no words or files renders as it does today", () => {
    const html = render(false, update)
    expect(html).not.toContain('data-slot="questionnaire-description"')
    expect(html).not.toContain('data-slot="attachment-thumbs"')
  })

  test("a labelled ask still shows its Approve and Deny", () => {
    const html = render(false, {
      ...decision,
      preview: { approve: "Ships.", deny: "Waits.", text: "Ship it?", type: "ask" },
    } as InboxItem)
    expect(html).toContain(">Approve</span>")
    expect(html).toContain(">Deny</span>")
  })
})

// Images and code blocks keep the same gap as the rest.
describe("an ask's files in its card", () => {
  test("sit gap-3 below the words, as the choices sit below them (their gap-3 apart is the thumbnails' own)", async () => {
    const source = await Bun.file(join(web, "src/components/dashboard/inbox.tsx")).text()
    expect(source).toContain(
      'className="flex flex-col gap-1 text-xs [&>[data-slot=attachment-thumbs]]:mt-2"',
    )
  })
})

describe("a held Yard post's card", () => {
  test("its Approve is a link that opens Yard's approve page in a new tab, never an answer", () => {
    const html = render(false, {
      ...decision,
      kind: "update",
      preview: {
        approve: "https://yard.example/yard/approve/m1",
        outcome: "decision",
        text: "run it",
      },
      status: "done",
    } as InboxItem)
    expect(html).toMatch(
      /<a [^>]*href="https:\/\/yard.example\/yard\/approve\/m1"[^>]*target="_blank"[^>]*>.*?Approve<\/a>/,
    )
  })
})
