import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { SQL } from "bun"

import {
  answerInputSchema,
  checkAnswer,
  deliveryText,
  inboxCount,
  inboxInputSchema,
  type Delivery,
  type InboxItem,
  inboxOrder,
  isGo,
  savesDraft,
} from "../../../../../../api/hono/src/lib/dashboard/inbox"

const CHANNEL = "https://app.slack.com/client/T0000000000/C0MADEUP01"
const SLACK = {
  link: CHANNEL,
  text: "hi Merritt, the fix is on staging.",
  to: "@Merritt",
  type: "slack",
}

const PREVIEWS = {
  ask: { text: "Port DUNE-1401's fix to staging and main.", type: "ask" },
  budget: { amount: "$40", type: "budget", why: "A second account for a week" },
  delete: { type: "delete", what: "47 stale worktrees", why: "They hold 30 GB" },
  schema: { shape: "inbox_item(id text, ref integer)", type: "schema" },
  ship: {
    link: "https://github.com/acme/app/compare/main...3f9a2c1",
    prs: [{ number: 270, title: "Changelog entries read as text" }],
    sha: "3f9a2c1",
    type: "ship",
  },
  slack: SLACK,
  ticket: {
    body: "Totals differ after export.",
    noLink: "The team has no project for it yet",
    team: "AI Platform",
    title: "Export totals",
    type: "ticket",
  },
}

const decision = (preview: object) => ({ from: "ops", preview, title: "Ship canary to main?" })

describe("what bun run ask takes", () => {
  test("a decision for each kind of approval, a decision being the kind when none is named", () => {
    for (const [type, preview] of Object.entries(PREVIEWS)) {
      const parsed = inboxInputSchema.safeParse(decision(preview))
      expect(parsed.success, type).toBe(true)
      expect(parsed.data?.kind, type).toBe("decision")
    }
  })

  test("an ask may label what Approve and Deny do, one line each, beside its words (#790)", () => {
    const parsed = inboxInputSchema.safeParse(
      decision({
        ...PREVIEWS.ask,
        approve: "I port the fix to staging and main.",
        deny: "The port waits; nothing moves.",
      }),
    )
    expect(parsed.success).toBe(true)
    expect(parsed.data?.preview).toMatchObject({
      approve: "I port the fix to staging and main.",
      deny: "The port waits; nothing moves.",
    })
    // the labels are optional, so an old-shape ask still posts
    expect(inboxInputSchema.safeParse(decision(PREVIEWS.ask)).success).toBe(true)
    // each label is one short line
    expect(
      inboxInputSchema.safeParse(decision({ ...PREVIEWS.ask, approve: "two\nlines" })).success,
    ).toBe(false)
    expect(
      inboxInputSchema.safeParse(decision({ ...PREVIEWS.ask, deny: "x".repeat(201) })).success,
    ).toBe(false)
  })

  test("a draft is a recipient and the words, and an update an outcome with an optional link", () => {
    expect(
      inboxInputSchema.safeParse({
        from: "dispatcher",
        kind: "draft",
        preview: { link: CHANNEL, text: "hi Merritt", to: "@Merritt" },
        title: "Ask Merritt to try the export fix",
      }).success,
    ).toBe(true)
    for (const outcome of ["alert", "decision", "finding", "merged", "shipped"]) {
      const parsed = inboxInputSchema.safeParse({
        from: "builder",
        kind: "update",
        preview: { link: "https://github.com/o/r/pull/270", outcome },
        title: "Merged: changelog entries read as text",
      })
      expect(parsed.success, outcome).toBe(true)
    }
  })

  test("an update may carry an approve page the owner opens in the browser, https alone", () => {
    const update = (approve: string) =>
      inboxInputSchema.safeParse({
        from: "Yard",
        kind: "update",
        preview: { approve, outcome: "decision", text: "a held post" },
        title: "Your steps post in #ops waits for your approval on Yard",
      }).success
    expect(update("https://yard.example/yard/approve/m1")).toBe(true)
    expect(update("javascript:alert(1)")).toBe(false)
  })

  test("a draft may link the thread it replies in, https alone", () => {
    const draft = (link: string) =>
      inboxInputSchema.safeParse({
        from: "dispatcher",
        kind: "draft",
        preview: { link, text: "on it", to: "Cameron's thread" },
        title: "Reply to Cameron",
      }).success
    expect(draft("https://linear.app/acme/issue/DUNE-2186/x")).toBe(true)
    expect(
      draft(
        "https://app.slack.com/client/T0000000000/C0MADEUP01/thread/C0MADEUP01-1700000000.000100",
      ),
    ).toBe(true)
    expect(draft("http://linear.app/acme/issue/DUNE-2186")).toBe(false)
    expect(draft("https://acme.slack.com/archives/C0MADEUP01/p1700000000000100")).toBe(false)
  })

  test("a draft, or a slack, ship or ticket decision, names where it lands upfront, or why it cannot yet", () => {
    // the link leads, so the owner sees where a reply goes before reading the rest
    const draft = (preview: object) =>
      inboxInputSchema.safeParse({
        from: "dispatcher",
        kind: "draft",
        preview: { text: "hi", to: "@Merritt", ...preview },
        title: "Ask Merritt",
      }).success
    expect(draft({})).toBe(false)
    expect(draft({ link: CHANNEL })).toBe(true)
    expect(draft({ noLink: "A new DM nobody can open yet" })).toBe(true)
    expect(draft({ link: CHANNEL, noLink: "both" })).toBe(false)
    expect(draft({ link: "http://app.slack.com/client/T0000000000/C0MADEUP01" })).toBe(false)
    for (const type of ["slack", "ship", "ticket"] as const) {
      const { link: _link, noLink: _noLink, ...bare } = PREVIEWS[type] as Record<string, unknown>
      expect(inboxInputSchema.safeParse(decision(bare)).success, type).toBe(false)
      expect(
        inboxInputSchema.safeParse(decision({ ...bare, noLink: "None yet" })).success,
        type,
      ).toBe(true)
    }
    for (const type of ["ask", "budget", "delete", "schema"] as const) {
      expect(inboxInputSchema.safeParse(decision(PREVIEWS[type])).success, type).toBe(true)
    }
  })

  test("refuses a decision with no preview, or one of a kind Merritt does not approve", () => {
    expect(inboxInputSchema.safeParse({ from: "ops", title: "Go?" }).success).toBe(false)
    expect(inboxInputSchema.safeParse(decision({ type: "merge" })).success).toBe(false)
    // a plain ask is its words alone: none, an empty one or one with options is refused
    expect(inboxInputSchema.safeParse(decision({ type: "ask" })).success).toBe(false)
    expect(inboxInputSchema.safeParse(decision({ text: " ", type: "ask" })).success).toBe(false)
    expect(
      inboxInputSchema.safeParse(decision({ ...PREVIEWS.ask, options: ["Port", "Wait"] })).success,
    ).toBe(false)
    // the old ask's options are not a decision's preview
    expect(
      inboxInputSchema.safeParse({ ...decision(SLACK), options: [{ label: "Yes" }] }).success,
    ).toBe(false)
  })

  test("refuses an update that is progress rather than an outcome", () => {
    for (const outcome of ["progress", "eta", "started", undefined]) {
      expect(
        inboxInputSchema.safeParse({
          from: "worker-greed",
          kind: "update",
          preview: { outcome },
          title: "Round 2 started",
        }).success,
        String(outcome),
      ).toBe(false)
    }
  })

  test("takes an update that shows something read-only: an ask's text and files, no Approve (PG-2489)", () => {
    const shown = (preview: object) =>
      inboxInputSchema.safeParse({
        from: "builder",
        kind: "update",
        preview: { outcome: "finding", ...preview },
        title: "The table you asked for",
      }).success
    const file = {
      id: "0b7c4e2a-1f3d-4c5e-8a9b-2d6f7e8a9b0c.png",
      kind: "image",
      name: "table.png",
    }
    expect(shown({ attachments: [file], text: "| a | b |\n| - | - |\n| 1 | 2 |" })).toBe(true)
    expect(shown({ text: "" })).toBe(false)
    expect(shown({ attachments: [] })).toBe(false)
  })

  test("refuses a title over one line, a link that is not http, and an unknown key", () => {
    expect(inboxInputSchema.safeParse({ ...decision(SLACK), title: "a\nb" }).success).toBe(false)
    expect(
      inboxInputSchema.safeParse({
        from: "builder",
        kind: "update",
        preview: { link: "javascript:alert(1)", outcome: "merged" },
        title: "Merged",
      }).success,
    ).toBe(false)
    expect(inboxInputSchema.safeParse({ ...decision(SLACK), context: "x" }).success).toBe(false)
  })

  test("refuses an archives-style Slack link anywhere in an item, naming the converter", () => {
    const archives = "https://acme.slack.com/archives/C0MADEUP01/p1700000000000100"
    for (const input of [
      decision({ ...SLACK, text: `see ${archives}` }),
      { ...decision(SLACK), title: `Reply in ${archives}` },
      {
        from: "dispatcher",
        kind: "draft",
        preview: { link: CHANNEL, text: archives, to: "@Merritt" },
        title: "Ask",
      },
      {
        from: "builder",
        kind: "update",
        preview: { link: archives, outcome: "finding" },
        title: "F",
      },
    ]) {
      const parsed = inboxInputSchema.safeParse(input)
      expect(parsed.success).toBe(false)
      expect(parsed.error?.issues.map((issue) => issue.message).join()).toContain(
        "never .../archives/...",
      )
    }
    const app =
      "https://app.slack.com/client/T0000000000/C0MADEUP01/thread/C0MADEUP01-1700000000.000100"
    expect(inboxInputSchema.safeParse(decision({ ...SLACK, text: `see ${app}` })).success).toBe(
      true,
    )
  })

  test("refuses a raw Slack mention token anywhere in an item, naming readable names as the fix", () => {
    // a tag names who it reaches, never a bare handle the owner has to decode
    const draft = (text: string, to = "@Farley") => ({
      from: "dispatcher",
      kind: "draft",
      preview: { link: CHANNEL, text, to },
      title: "Ask Farley",
    })
    for (const token of [
      "<@U0EXAMPLE02>",
      "<@W0A1HBY26MQ|farley>",
      "<!subteam^S0A1HBY26MQ>",
      "<!subteam^S0A1HBY26MQ|@octo-avery>",
      "<!here>",
      "<!channel>",
      "<!everyone>",
      "<#C0MADEUP01>",
      "<#C0MADEUP01|peer-review-chat>",
    ]) {
      for (const input of [
        draft(`hey ${token}, can you help approve this?`),
        draft("hey", token),
        decision({ ...SLACK, text: `cc ${token}` }),
        { ...decision(SLACK), title: `Ask ${token}` },
      ]) {
        const parsed = inboxInputSchema.safeParse(input)
        expect(parsed.success, token).toBe(false)
        expect(parsed.error?.issues.map((issue) => issue.message).join(), token).toContain(
          "write mentions as readable names (@name, @team-name)",
        )
      }
    }
    for (const text of [
      "hey @Farley @octo-avery, can you help approve these? #peer-review-chat",
      `see ${CHANNEL} and https://github.com/o/r/pull/1`,
      "a <b>tag</b> and a <https://example.com|link>",
    ]) {
      expect(inboxInputSchema.safeParse(draft(text)).success, text).toBe(true)
    }
  })

  test("a draft, or a slack decision, speaks in the owner's voice: I, never we, and code or a quote is someone else's words (#674)", () => {
    // the owner speaks as I, me, my; never we, us, our, our side or the team
    const draft = (text: string) =>
      inboxInputSchema.safeParse({
        from: "dispatcher",
        kind: "draft",
        preview: { link: CHANNEL, text, to: "@Merritt" },
        title: "Ask Merritt",
      })
    for (const [text, word] of [
      ["we will ship it", "we"],
      ["it reached us late", "us"],
      ["our side is done", "our"],
      ["the latest build is ours", "ours"],
      ["handled by ourselves alone", "ourselves"],
      ["We will ship it", "We"],
      ["OUR side is done", "OUR"],
      ["It is OURS", "OURS"],
      ["by OURSELVES alone", "OURSELVES"],
    ] as const) {
      const parsed = draft(`${text}.`)
      expect(parsed.success, text).toBe(false)
      expect(parsed.error?.issues.at(-1)?.message, text).toContain(`Found "${word}"`)
    }
    // the all-caps US is the country, not the pronoun, so it passes; the other words refuse in every case
    for (const fine of ["the US team grows", "US-east is up", "the US and the EU signed"]) {
      expect(draft(`${fine}.`).success, fine).toBe(true)
    }
    // a match a hyphen follows reads as a compound's half, a region name, not the pronoun (us-east-1)
    for (const fine of ["the region is us-east-1", "us-east-1 is up", "our-side is ready"]) {
      expect(draft(`${fine}.`).success, fine).toBe(true)
    }
    // a word inside a longer word is not the owner's voice
    for (const fine of ["trust the build", "two hours in", "as usual", "user asked"]) {
      expect(draft(`${fine}.`).success, fine).toBe(true)
    }
    // a link is an address, not a voice: bare, or Slack's <url|label>
    for (const fine of [
      "read https://acme.com/about-us first",
      "the deck lives at https://acme.com/us/en/ now",
      "<https://acme.com|our roadmap> has it",
    ]) {
      expect(draft(`${fine}.`).success, fine).toBe(true)
    }
    // code and quoted words are someone else's words
    expect(draft("run `we` twice.").success).toBe(true)
    expect(draft("```\nwe are the setup\n```").success).toBe(true)
    expect(draft('he said "we will look into it".').success).toBe(true)
    expect(draft("> we said so\nI will check.").success).toBe(true)
    // a slack decision's words are checked the same way
    expect(
      inboxInputSchema.safeParse(decision({ ...SLACK, text: "hi Merritt, we fixed it." })).success,
    ).toBe(false)
    // other kinds and previews are unaffected
    expect(
      inboxInputSchema.safeParse(decision({ ...PREVIEWS.ask, text: "we will port it now." }))
        .success,
    ).toBe(true)
    expect(
      inboxInputSchema.safeParse(
        decision({ ...PREVIEWS.delete, what: "our stale worktrees", why: "they hold 30 GB" }),
      ).success,
    ).toBe(true)
    expect(
      inboxInputSchema.safeParse({
        from: "builder",
        kind: "update",
        preview: { outcome: "alert" },
        title: "the Mac is on battery",
      }).success,
    ).toBe(true)
    // only the words are the owner's voice: a clean draft passes, its recipient's short name unchecked
    expect(
      inboxInputSchema.safeParse({
        from: "dispatcher",
        kind: "draft",
        preview: { link: CHANNEL, text: "I will send it shortly.", to: "our thread" },
        title: "Ask Merritt",
      }).success,
    ).toBe(true)
  })

  test("a draft or a slack decision may carry its thread so far, one gist line a message, and no raw mention in it (#2287)", () => {
    const thread = [
      { said: "The export stops at 100 rows; we need all of them.", who: "Merritt" },
      { said: "Can it reach staging today?", who: "@Farley" },
    ]
    const draft = (preview: object) => ({
      from: "dispatcher",
      kind: "draft",
      preview: {
        link: CHANNEL,
        text: "hi Merritt, the fix is on staging.",
        to: "@Merritt",
        ...preview,
      },
      title: "Reply to Merritt",
    })
    // the other side's gist is their words, not the owner's voice, so their "we" passes
    for (const input of [draft({ thread }), decision({ ...SLACK, thread })]) {
      const parsed = inboxInputSchema.safeParse(input)
      expect(parsed.success).toBe(true)
      expect(parsed.data?.preview).toMatchObject({ thread })
    }
    // optional, so an item without one posts as before
    expect(inboxInputSchema.safeParse(draft({})).success).toBe(true)
    for (const bad of [
      [],
      Array.from({ length: 13 }, () => thread[0]),
      [{ said: "two\nlines", who: "Merritt" }],
      [{ said: "x".repeat(201), who: "Merritt" }],
      [{ said: "ok", who: "Merritt", ts: "1700000000.000100" }],
      [{ said: "ok" }],
    ]) {
      expect(inboxInputSchema.safeParse(draft({ thread: bad })).success, JSON.stringify(bad)).toBe(
        false,
      )
    }
    // an ask carries no thread
    expect(inboxInputSchema.safeParse(decision({ ...PREVIEWS.ask, thread })).success).toBe(false)
    for (const line of [
      { said: "cc <@U0EXAMPLE02>", who: "Merritt" },
      { said: "ok", who: "<@U0EXAMPLE02>" },
      { said: "<!here> look", who: "Merritt" },
    ]) {
      const parsed = inboxInputSchema.safeParse(draft({ thread: [line] }))
      expect(parsed.success).toBe(false)
      expect(parsed.error?.issues.map((issue) => issue.message).join()).toContain(
        "write mentions as readable names",
      )
    }
  })
})

describe("an ask to quit, restart, close or stop something (#1274)", () => {
  const QUIT = { text: "Quit cmux, then open it again.", type: "ask" }
  const CHECKED = "None: no ops job, process or session runs under cmux; /api/health reads ok"

  test("is refused until it names what was checked, and the refusal names the checks", () => {
    const parsed = inboxInputSchema.safeParse({ ...decision(QUIT), title: "Quit cmux?" })
    expect(parsed.success).toBe(false)
    const message = parsed.error?.issues.map((issue) => issue.message).join("\n") ?? ""
    for (const check of ["checked", "jobs.json", "processes", "sessions", "/api/health"]) {
      expect(message, check).toContain(check)
    }
  })

  test("posts once it carries checked, one line", () => {
    const parsed = inboxInputSchema.safeParse(decision({ ...QUIT, checked: CHECKED }))
    expect(parsed.success).toBe(true)
    expect(parsed.data?.preview).toMatchObject({ checked: CHECKED })
    expect(inboxInputSchema.safeParse(decision({ ...QUIT, checked: "none\nreally" })).success).toBe(
      false,
    )
  })

  test("reads every verb, in its title and its labels too", () => {
    for (const text of ["Restart the dashboard.", "Close Docker.", "Stop OrbStack."]) {
      expect(inboxInputSchema.safeParse(decision({ text, type: "ask" })).success, text).toBe(false)
    }
    expect(
      inboxInputSchema.safeParse({ ...decision(PREVIEWS.ask), title: "Restart the Mac?" }).success,
    ).toBe(false)
    expect(
      inboxInputSchema.safeParse(decision({ ...PREVIEWS.ask, approve: "You quit cmux." })).success,
    ).toBe(false)
    expect(
      inboxInputSchema.safeParse(
        decision({
          approve: "Done",
          deny: "Can't stop OrbStack",
          text: "Free memory.",
          type: "ask",
        }),
      ).success,
    ).toBe(false)
  })

  test("reads any form of the four verbs that still asks", () => {
    for (const text of [
      "Approve once you have restarted cmux.",
      "Approve once you've closed Docker.",
      "Approve once you’ve closed Docker.",
      "Try restarting cmux, then approve.",
      "Approve after quitting cmux.",
      "You: stopped OrbStack yet? Approve once done.",
      "Once cmux is restarted, approve.",
      "Has cmux been restarted? Approve.",
      "Get cmux restarted, then approve.",
      "Restarting cmux clears it; approve when done.",
      "Approve when you're done restarting cmux.",
      "Approve once you had closed Docker.",
      "Port the fix after the dashboard restarted and then restart cmux.",
      "Get the dashboard restarted, then approve.",
      "Have the app closed, then approve.",
      "Approve once you have the dashboard stopped.",
      "Is the dashboard stopped yet? Approve when it is.",
      "Make the app quit, then approve.",
    ]) {
      expect(inboxInputSchema.safeParse(decision({ text, type: "ask" })).success, text).toBe(false)
    }
  })

  test("passes an ask that only mentions a restart in passing", () => {
    for (const text of [
      "Port the fix after the dashboard restarted.",
      "Port the fix since the app quit.",
      "Retry because the server stopped.",
    ]) {
      expect(inboxInputSchema.safeParse(decision({ text, type: "ask" })).success, text).toBe(true)
    }
  })
})

const item = (over: Partial<InboxItem> & Pick<InboxItem, "kind">): InboxItem =>
  ({
    answer: null,
    createdAt: "2026-10-07T10:00:00.000Z",
    delivery: null,
    from: "ops",
    id: `id-${over.ref ?? 1}`,
    preview:
      over.kind === "update"
        ? { outcome: "merged" }
        : over.kind === "draft"
          ? { text: "hi", to: "@Merritt" }
          : SLACK,
    readAt: null,
    ref: 1,
    status: over.kind === "update" ? "done" : "open",
    title: "A title",
    updatedAt: "2026-10-07T10:00:00.000Z",
    version: 0,
    ...over,
  }) as InboxItem

describe("an answer", () => {
  test("approves, denies or edits a decision, and Edit needs the words", () => {
    const open = item({ kind: "decision" })
    expect(checkAnswer(open, { action: "approve" })).toEqual({
      answer: { choice: "approve" },
      status: "approved",
    })
    expect(checkAnswer(open, { action: "deny" })).toEqual({
      answer: { choice: "deny" },
      status: "denied",
    })
    expect(checkAnswer(open, { action: "edit", text: "Say tomorrow" })).toEqual({
      answer: { choice: "edit", editedText: "Say tomorrow" },
      status: "approved",
    })
    expect(checkAnswer(open, { action: "edit" })).toHaveProperty("message")
    expect(checkAnswer(open, { action: "send" })).toHaveProperty("message")
  })

  test("sends a draft as written or as changed, or discards it", () => {
    const draft = item({ kind: "draft" })
    expect(checkAnswer(draft, { action: "send", text: "hi" })).toEqual({
      answer: { choice: "send" },
      status: "sent",
    })
    expect(checkAnswer(draft, { action: "send", text: "hello" })).toEqual({
      answer: { choice: "send", editedText: "hello" },
      status: "sent",
    })
    expect(checkAnswer(draft, { action: "discard" })).toEqual({
      answer: { choice: "discard" },
      status: "discarded",
    })
    expect(checkAnswer(draft, { action: "approve" })).toHaveProperty("message")
  })

  test("saves a Slack draft as a draft in Slack, as written or as changed, and refuses it where the app has no draft API (#652)", () => {
    const slack = item({ kind: "draft" })
    expect(checkAnswer(slack, { action: "draft", text: "hi" })).toEqual({
      answer: { choice: "draft" },
      status: "drafted",
    })
    expect(checkAnswer(slack, { action: "draft", text: "hello" })).toEqual({
      answer: { choice: "draft", editedText: "hello" },
      status: "drafted",
    })
    expect(checkAnswer(slack, { action: "draft", text: "" })).toHaveProperty("message")
    const linear = item({
      kind: "draft",
      preview: { link: "https://linear.app/acme/issue/DUNE-1/x", text: "hi", to: "DUNE-1" },
    })
    expect(checkAnswer(linear, { action: "draft" })).toHaveProperty("message")
    expect(checkAnswer(linear, { action: "send" })).toEqual({
      answer: { choice: "send" },
      status: "sent",
    })
    expect(checkAnswer(item({ kind: "decision" }), { action: "draft" })).toHaveProperty("message")
    expect(savesDraft({ link: CHANNEL, text: "hi", to: "@Merritt" })).toBe(true)
    expect(savesDraft({ noLink: "a new DM", text: "hi", to: "@Merritt" })).toBe(true)
    expect(
      savesDraft({ link: "https://linear.app/acme/issue/DUNE-1/x", text: "hi", to: "x" }),
    ).toBe(false)
    // a draft is a go: its poster closes it with the channel link the draft tool returns
    expect(isGo("draft")).toBe(true)
  })

  test("Clear sets a decision aside for later: a status of its own, neither a deny nor a discard, and never a go", () => {
    expect(checkAnswer(item({ kind: "decision" }), { action: "clear" })).toEqual({
      answer: { choice: "clear" },
      status: "cleared",
    })
    expect(isGo("clear")).toBe(false)
    // a draft's own Discard already says no, so a draft is never cleared
    expect(checkAnswer(item({ kind: "draft" }), { action: "clear" })).toHaveProperty("message")
    expect(checkAnswer(item({ kind: "update" }), { action: "clear" })).toHaveProperty("message")
  })

  test("his note goes with every answer, and stays off a refused one", () => {
    for (const [kind, action] of [
      ["decision", "approve"],
      ["decision", "clear"],
      ["decision", "deny"],
      ["draft", "discard"],
      ["draft", "draft"],
      ["draft", "send"],
    ] as const) {
      expect(checkAnswer(item({ kind }), { action, note: " after the demo " })).toMatchObject({
        answer: { choice: action, note: "after the demo" },
      })
    }
    expect(
      checkAnswer(item({ kind: "decision" }), { action: "edit", note: "x", text: "Wait" }),
    ).toMatchObject({ answer: { editedText: "Wait", note: "x" }, status: "approved" })
    // an empty note adds nothing
    expect(checkAnswer(item({ kind: "decision" }), { action: "approve", note: "  " })).toEqual({
      answer: { choice: "approve" },
      status: "approved",
    })
    expect(checkAnswer(item({ kind: "update" }), { action: "approve", note: "x" })).toEqual({
      message: "An update is read, not answered",
    })
    expect(answerInputSchema.safeParse({ action: "approve", note: "x".repeat(4000) }).success).toBe(
      true,
    )
    expect(answerInputSchema.safeParse({ action: "approve", note: "x".repeat(4001) }).success).toBe(
      false,
    )
  })

  test("leaves an update and an answered item alone", () => {
    expect(checkAnswer(item({ kind: "update" }), { action: "approve" })).toHaveProperty("message")
    expect(
      checkAnswer(item({ kind: "decision", status: "approved" }), { action: "deny" }),
    ).toHaveProperty("message")
  })

  test("names slack.linkConverter and slack.sendServer once the extensions' policy sets them", async () => {
    const data = mkdtempSync(join(tmpdir(), "inbox-slack-"))
    await Bun.write(
      join(data, "extensions", "policy.json"),
      JSON.stringify({
        values: { "slack.linkConverter": "made-up-convert", "slack.sendServer": "made-up-slack" },
      }),
    )
    const was = process.env.PLAYGROUND_DATA_DIR
    process.env.PLAYGROUND_DATA_DIR = data
    try {
      const it = { id: "abc", ref: 41, title: "T" }
      expect(deliveryText(it, { choice: "draft" })).toContain(
        "rewritten to the app form by piping it to made-up-convert (ack refuses",
      )
      const parsed = inboxInputSchema.safeParse({
        from: "builder",
        kind: "update",
        preview: { link: "https://acme.slack.com/archives/C1/p1", outcome: "finding" },
        title: "F",
      })
      expect(parsed.error?.issues.map((issue) => issue.message).join()).toContain(
        "never .../archives/...; rewrite it with made-up-convert",
      )
    } finally {
      if (was === undefined) delete process.env.PLAYGROUND_DATA_DIR
      else process.env.PLAYGROUND_DATA_DIR = was
      rmSync(data, { force: true, recursive: true })
    }
  })

  test("reaches its poster as a line naming the item, its tag and what to do", () => {
    const it = { id: "abc", ref: 41, title: "Ship canary 3f9a2c1 to main?" }
    expect(deliveryText(it, { choice: "approve" })).toBe(
      'Inbox #i41 (abc) "Ship canary 3f9a2c1 to main?": Approved. Carry it out.',
    )
    expect(deliveryText(it, { choice: "edit", editedText: "Wait for #299" })).toContain(
      "Carry it out with these: Wait for #299",
    )
    expect(deliveryText(it, { choice: "deny" })).toContain("Do not carry it out")
    expect(deliveryText(it, { choice: "send" })).toContain("Send it as written")
    expect(deliveryText(it, { choice: "send", editedText: "hey" })).toContain("as: hey")
    expect(deliveryText(it, { choice: "discard" })).toContain("Do not send it")
    // a clear keeps what is moving and holds only the item's new step, so it reads as neither a deny nor a discard
    const cleared = deliveryText(it, { choice: "clear" })
    expect(cleared).toContain("Cleared for now: the owner will talk more about it later.")
    expect(cleared).toContain("Whatever is already in motion stays in motion")
    expect(cleared).not.toMatch(/Denied|Discarded|Do not carry it out/)
    // his note follows the answer on a line of its own, and only when there is one
    expect(deliveryText(it, { choice: "deny", note: "ask again next week" })).toBe(
      'Inbox #i41 (abc) "Ship canary 3f9a2c1 to main?": Denied. Do not carry it out.\nThe owner\'s note: ask again next week',
    )
    expect(deliveryText(it, { choice: "deny" })).not.toContain("note")
    // the poster reads only this line, so it names the tool and how to close the item
    expect(deliveryText(it, { choice: "draft" })).toBe(
      'Inbox #i41 (abc) "Ship canary 3f9a2c1 to main?": Save it as a Slack draft as written, with slack_send_message_draft, then bun run ask ack it with the channel_link that returns, in its app form (ack refuses the archives form), or with --no-link and why when Slack refuses (draft_already_exists: that conversation holds a draft already). Do not send it.',
    )
    expect(deliveryText(it, { choice: "draft", editedText: "hey" })).toMatch(
      /Save it as a Slack draft with slack_send_message_draft, .* Do not send it\. Save it with changes, as: hey$/,
    )
  })
})

describe("the list", () => {
  test("puts what needs him first, then unread updates, then the rest, each newest first (#i545)", () => {
    const items = [
      item({ kind: "update", readAt: "2026-10-07T11:00:00.000Z", ref: 1 }),
      item({ kind: "decision", ref: 2 }),
      item({ kind: "update", ref: 3 }),
      item({ kind: "draft", ref: 4 }),
      item({ kind: "update", ref: 5 }),
      item({ kind: "decision", ref: 6, status: "approved" }),
    ]
    expect(inboxOrder(items).map((i) => i.ref)).toEqual([4, 2, 5, 3, 6, 1])
    expect(inboxCount(items)).toBe(4)
  })

  test("an answer that failed to send needs him, newest first among what does, until he dismisses it", () => {
    const failed = { code: "CMUX_FAILED", reason: "no answer from cmux", status: "failed" } as const
    const answer = { at: "2026-10-07T11:00:00.000Z", choice: "send" } as const
    const items = [
      item({ kind: "update", ref: 3 }),
      item({ kind: "decision", ref: 5 }),
      item({ answer, delivery: failed, kind: "draft", ref: 4, status: "sent" }),
      item({
        answer: { ...answer, dismissedAt: "2026-10-07T12:00:00.000Z" },
        delivery: failed,
        kind: "draft",
        ref: 2,
        status: "sent",
      }),
    ]
    expect(inboxOrder(items).map((i) => i.ref)).toEqual([5, 4, 3, 2])
    expect(inboxCount(items)).toBe(3)
  })

  test("an item he replied to in chat leaves the count and what needs him, but stays in the list until its poster closes it", () => {
    const items = [
      item({ kind: "decision", ref: 2 }),
      item({
        answer: { at: "2026-10-07T11:00:00.000Z", choice: "replied" },
        kind: "decision",
        ref: 7,
      }),
      item({ kind: "update", ref: 3 }),
    ]
    expect(inboxCount(items)).toBe(2)
    expect(inboxOrder(items).map((i) => i.ref)).toEqual([2, 3, 7])
  })

  test("a scheduled item is out of the count and what needs him until its time passes, then back (Schedule)", () => {
    const snoozed = {
      answer: { snoozedUntil: "2026-10-07T12:00:00.000Z" },
      kind: "decision",
      ref: 2,
    } as const
    const items = [
      item(snoozed),
      item({ kind: "decision", ref: 3 }),
      item({ kind: "decision", ref: 4 }),
    ]
    const before = new Date("2026-10-07T11:00:00.000Z")
    expect(inboxCount(items, before)).toBe(2)
    // asleep it leaves what needs him; awake it asks again, newest first
    expect(inboxOrder(items, before).map((i) => i.ref)).toEqual([4, 3, 2])
    const after = new Date("2026-10-07T12:00:00.000Z")
    expect(inboxCount(items, after)).toBe(3)
    expect(inboxOrder(items, after).map((i) => i.ref)).toEqual([4, 3, 2])
  })
})

// The store against a throwaway Postgres in Docker published on 127.0.0.1 only, migrated as the dashboard's is, so the table's own rules hold. Skipped where Docker is not running.
const MIGRATIONS = join(import.meta.dir, "../../../../../../packages/db/drizzle")
// made at run time, so no password is ever written into the repo
const PASSWORD = crypto.randomUUID()

const dockerUp = (): boolean =>
  Bun.which("docker") !== null &&
  Bun.spawnSync(["docker", "info"], { stderr: "ignore", stdout: "ignore" }).exitCode === 0

describe.skipIf(!dockerUp())("the inbox store", () => {
  let container = ""
  let store: typeof import("../../../../../../api/hono/src/lib/dashboard/inbox")
  let db: ReturnType<typeof import("../../../../../../packages/db/dist/index.mjs").createDatabase>
  const actor = { email: "owner@local.host", id: "owner" }

  beforeAll(async () => {
    container = Bun.spawnSync([
      "docker",
      "run",
      "-d",
      "--rm",
      "-e",
      `POSTGRES_PASSWORD=${PASSWORD}`,
      "-p",
      "127.0.0.1::5432",
      "postgres:18-alpine",
    ])
      .stdout.toString()
      .trim()
    const port = Bun.spawnSync(["docker", "port", container, "5432/tcp"])
      .stdout.toString()
      .trim()
      .split(":")
      .at(-1)
    const url = `postgres://postgres:${PASSWORD}@127.0.0.1:${port}/postgres`
    let admin: SQL | null = null
    for (let i = 0; i < 60; i++) {
      try {
        admin = new SQL(url, { max: 1 })
        await admin`select 1`
        break
      } catch {
        await Bun.sleep(500)
      }
    }
    const journal = await Bun.file(join(MIGRATIONS, "meta/_journal.json")).json()
    for (const { tag } of journal.entries as { tag: string }[]) {
      for (const statement of (await Bun.file(join(MIGRATIONS, `${tag}.sql`)).text()).split(
        "--> statement-breakpoint",
      )) {
        if (statement.trim()) await admin!.unsafe(statement)
      }
    }
    await admin!.close()
    store = await import("../../../../../../api/hono/src/lib/dashboard/inbox")
    db = (await import("../../../../../../packages/db/dist/index.mjs")).createDatabase(url)
  }, 60_000)

  afterAll(() => {
    if (container)
      Bun.spawnSync(["docker", "rm", "-f", "-v", container], { stderr: "ignore", stdout: "ignore" })
  })

  const post = async (input: object) => {
    const posted = await store.postItem(db, input)
    if (!posted.ok) throw new Error(posted.message)
    return posted.item
  }

  test("an item gets a tag that counts up, and is found by its id or its tag", async () => {
    const a = await post(decision(SLACK))
    const b = await post(decision(PREVIEWS.ship))
    expect(b.ref).toBe(a.ref + 1)
    expect(a.status).toBe("open")
    expect((await store.getItem(db, a.id))?.id).toBe(a.id)
    expect((await store.getItem(db, `#i${b.ref}`))?.id).toBe(b.id)
    expect((await store.getItem(db, `i${b.ref}`))?.id).toBe(b.id)
    expect(await store.getItem(db, "#i999999")).toBeNull()
  })

  test("Approve hands the item to the session that posted it, and the dashboard sends nothing itself", async () => {
    const posted = await post(decision(SLACK))
    const sent: Delivery[] = []
    const answered = await store.answerItem(
      db,
      posted.id,
      { action: "approve" },
      {
        actor,
        deliver: async (delivery) => {
          sent.push(delivery)
          return { at: "2026-10-07T12:00:00.000Z", ok: true, sessionId: "s1" }
        },
      },
    )
    expect(answered.ok).toBe(true)
    // one delivery, to the poster, never to the Slack recipient the preview names
    expect(sent).toHaveLength(1)
    expect(sent[0]?.to).toBe("ops")
    expect(sent[0]?.text).toContain(`#i${posted.ref}`)
    if (!answered.ok) return
    expect(answered.item.status).toBe("approved")
    expect(answered.item.answer).toMatchObject({ choice: "approve" })
    expect(answered.item.delivery).toEqual({
      at: "2026-10-07T12:00:00.000Z",
      status: "delivered",
      to: "ops",
      via: "session",
    })
  })

  test("a second answer is refused, so a double click cannot answer twice", async () => {
    const posted = await post(decision(PREVIEWS.delete))
    const [one, two] = await Promise.all([
      store.answerItem(db, posted.id, { action: "approve" }, { actor }),
      store.answerItem(db, posted.id, { action: "deny" }, { actor }),
    ])
    expect([one.ok, two.ok].sort()).toEqual([false, true])
    const again = await store.answerItem(db, posted.id, { action: "deny" }, { actor })
    expect(again).toMatchObject({ code: "CONFLICT", ok: false })
  })

  test("Dismiss records the moment in an answered item's answer, so it stays in Done after a reload, and leaves an open decision or draft", async () => {
    const answered = await post(decision(PREVIEWS.budget))
    await store.answerItem(db, answered.id, { action: "deny" }, { actor })
    const open = await post(decision(PREVIEWS.schema))
    const draft = await post({
      from: "dispatcher",
      kind: "draft",
      preview: { link: CHANNEL, text: "hi Merritt", to: "@Merritt" },
      title: "Ask Merritt",
    })
    const at = new Date("2026-10-07T12:00:00.000Z")
    expect(await store.dismissItems(db, [answered.id, open.id, draft.id], at)).toBe(1)
    const after = await store.getItem(db, answered.id)
    expect(after?.answer).toMatchObject({ choice: "deny", dismissedAt: at.toISOString() })
    expect(after?.status).toBe("denied")
    expect((await store.getItem(db, open.id))?.answer).toBeNull()
    expect((await store.getItem(db, draft.id))?.answer).toBeNull()
    expect((await store.getItem(db, draft.id))?.status).toBe("open")
    // a second dismissal changes nothing, and the list a reload reads carries it
    expect(await store.dismissItems(db, [answered.id])).toBe(0)
    const listed = (await store.listItems(db, at)).items.find((item) => item.id === answered.id)
    expect(listed?.answer).toMatchObject({ dismissedAt: at.toISOString() })
  })

  // Mark as read keeps the message as it is and drops the double tick.
  test("Mark all as read marks every unread ask, draft and update seen, answering and dismissing none, so each stays as it is", async () => {
    const ask = await post(decision(PREVIEWS.ask))
    const draft = await post({
      from: "dispatcher",
      kind: "draft",
      preview: { link: CHANNEL, text: "hi Merritt", to: "@Merritt" },
      title: "Ask Merritt",
    })
    const update = await post({
      from: "builder",
      kind: "update",
      preview: { outcome: "merged" },
      title: "Merged",
    })
    const at = new Date()
    expect(await store.markRead(db, [ask.id, draft.id, update.id], at)).toBe(3)
    const listed = (await store.listItems(db, at)).items.filter((item) =>
      [ask.id, draft.id, update.id].includes(item.id),
    )
    expect(listed).toHaveLength(3)
    for (const item of listed) expect(item.readAt).toBe(at.toISOString())
    for (const item of [ask, draft].map((posted) => listed.find((i) => i.id === posted.id)))
      expect(item).toMatchObject({ answer: null, status: "open" })
  })

  // a reviewer: a read moved updatedAt, so a card read a second on flipped from posted to updated
  test("Mark as read leaves an ask's updatedAt as posted, so its card never reads updated, while an update's moves", async () => {
    const ask = await post(decision(PREVIEWS.ask))
    const update = await post({
      from: "builder",
      kind: "update",
      preview: { outcome: "merged" },
      title: "Merged",
    })
    const later = new Date(Date.parse(ask.createdAt) + 5000)
    expect(await store.markRead(db, [ask.id, update.id], later)).toBe(2)
    const listed = (await store.listItems(db, later)).items
    const read = listed.find((item) => item.id === ask.id)
    expect(read?.updatedAt).toBe(ask.updatedAt)
    expect(read?.readAt).toBe(later.toISOString())
    expect(listed.find((item) => item.id === update.id)?.updatedAt).toBe(later.toISOString())
  })

  // An item answered from chat can still be dismissed.
  test("Dismiss takes an item he replied to in chat, still open, and keeps the reply for its poster", async () => {
    const posted = await post(decision(PREVIEWS.budget))
    const repliedAt = new Date("2026-10-07T11:00:00.000Z")
    await store.recordReply(db, posted.ref, repliedAt)
    const at = new Date("2026-10-07T12:00:00.000Z")
    expect(await store.dismissItems(db, [posted.id], at)).toBe(1)
    const after = await store.getItem(db, posted.id)
    expect(after?.answer).toEqual({
      at: repliedAt.toISOString(),
      choice: "replied",
      dismissedAt: at.toISOString(),
    })
    expect(after?.status).toBe("open")
    expect(await store.dismissItems(db, [posted.id])).toBe(0)
  })

  test("Dismiss takes an update, read or not: it records the moment, marks it read and keeps the time it was read", async () => {
    const posted = () =>
      post({ from: "builder", kind: "update", preview: { outcome: "merged" }, title: "Merged" })
    const unread = await posted()
    const read = await posted()
    const readAt = new Date("2026-10-07T11:00:00.000Z")
    await store.markRead(db, [read.id], readAt)
    const at = new Date("2026-10-07T12:00:00.000Z")
    expect(await store.dismissItems(db, [unread.id, read.id], at)).toBe(2)
    const gone = await store.getItem(db, unread.id)
    expect(gone?.answer).toEqual({ dismissedAt: at.toISOString() })
    expect(gone?.readAt).toBe(at.toISOString())
    expect(gone?.status).toBe("done")
    const kept = await store.getItem(db, read.id)
    expect(kept?.answer).toEqual({ dismissedAt: at.toISOString() })
    expect(kept?.readAt).toBe(readAt.toISOString())
    // a second dismissal changes nothing, and the poster's ack still finds no answer on it
    expect(await store.dismissItems(db, [unread.id])).toBe(0)
    expect(await store.ackItem(db, unread.id)).toMatchObject({ code: "CONFLICT", ok: false })
  })

  test("the poster settles its own open item, which then takes no answer; an answered one or an update is refused", async () => {
    const posted = await post(decision(PREVIEWS.ticket))
    const at = new Date("2026-10-07T12:00:00.000Z")
    const settled = await store.settleItem(db, `#i${posted.ref}`, {
      note: "Filed by hand",
      now: at,
    })
    expect(settled.ok).toBe(true)
    if (!settled.ok) return
    expect(settled.item.status).toBe("done")
    expect(settled.item.answer).toEqual({
      at: at.toISOString(),
      by: "ops",
      choice: "settled",
      dismissedAt: at.toISOString(),
      note: "Filed by hand",
    })
    expect(settled.item.delivery).toBeNull()
    expect(await store.answerItem(db, posted.id, { action: "approve" }, { actor })).toMatchObject({
      code: "CONFLICT",
      ok: false,
    })
    expect(await store.settleItem(db, posted.id)).toMatchObject({ code: "CONFLICT", ok: false })
    const answered = await post(decision(PREVIEWS.budget))
    await store.answerItem(db, answered.id, { action: "approve" }, { actor })
    expect(await store.settleItem(db, answered.id)).toMatchObject({ code: "CONFLICT", ok: false })
    const update = await post({
      from: "builder",
      kind: "update",
      preview: { outcome: "finding" },
      title: "Found",
    })
    await store.markRead(db, [update.id])
    expect(await store.settleItem(db, update.id)).toMatchObject({
      code: "VALIDATION_ERROR",
      ok: false,
    })
    expect(
      await store.settleItem(db, (await post(decision(SLACK))).id, { note: "two\nlines" }),
    ).toMatchObject({ code: "VALIDATION_ERROR", ok: false })
    expect(
      await store.settleItem(db, (await post(decision(SLACK))).id, {
        note: "Sent in https://acme.slack.com/archives/C0MADEUP01",
      }),
    ).toMatchObject({ code: "VALIDATION_ERROR", ok: false })
  })

  test("the poster edits its own open item in place, bumping updatedAt and version; another session's, an answered or closed item and a bad shape are refused (PG-2547)", async () => {
    const posted = await post(decision(SLACK))
    const at = new Date(Date.parse(posted.updatedAt) + 60_000)
    const edited = await store.editItem(
      db,
      `#i${posted.ref}`,
      {
        ...decision({ ...SLACK, text: "hi Merritt, the fix is live." }),
        title: "Send Merritt the live note?",
      },
      at,
    )
    expect(edited.ok).toBe(true)
    if (!edited.ok) return
    expect(edited.item).toMatchObject({
      id: posted.id,
      preview: { text: "hi Merritt, the fix is live." },
      status: "open",
      title: "Send Merritt the live note?",
      updatedAt: at.toISOString(),
      version: posted.version + 1,
    })
    expect((await store.editItem(db, posted.id, decision(SLACK)))?.ok).toBe(true)
    // another session's item, a change of kind and a bad shape are refused, leaving the item as it was
    expect(
      await store.editItem(db, posted.id, { ...decision(SLACK), from: "builder" }),
    ).toMatchObject({ code: "CONFLICT", ok: false })
    expect(
      await store.editItem(db, posted.id, {
        ...decision(SLACK),
        kind: "update",
        preview: { outcome: "finding" },
      }),
    ).toMatchObject({ code: "VALIDATION_ERROR", ok: false })
    expect(
      await store.editItem(db, posted.id, { ...decision(SLACK), preview: { type: "slack" } }),
    ).toMatchObject({ code: "VALIDATION_ERROR", ok: false })
    expect(await store.editItem(db, "#i999999", decision(SLACK))).toMatchObject({
      code: "NOT_FOUND",
      ok: false,
    })
    // an answered decision and a settled one are refused
    await store.answerItem(db, posted.id, { action: "approve" }, { actor })
    expect(await store.editItem(db, posted.id, decision(SLACK))).toMatchObject({
      code: "CONFLICT",
      ok: false,
    })
    const settled = await post(decision(SLACK))
    await store.settleItem(db, settled.id)
    expect(await store.editItem(db, settled.id, decision(SLACK))).toMatchObject({
      code: "CONFLICT",
      ok: false,
    })
    // an update edits while it stands, and is refused once dismissed
    const progress = {
      from: "builder",
      kind: "update",
      preview: { outcome: "finding", text: "40%" },
      title: "Round 2",
    }
    const update = await post(progress)
    const moved = await store.editItem(db, update.id, {
      ...progress,
      preview: { outcome: "finding", text: "80%" },
    })
    expect(moved).toMatchObject({ item: { preview: { text: "80%" }, status: "done" }, ok: true })
    await store.dismissItems(db, [update.id])
    expect(await store.editItem(db, update.id, progress)).toMatchObject({
      code: "CONFLICT",
      ok: false,
    })
  })

  test("an answer to a card its poster edited since he read it is refused, and one to the card as it stands lands (PG-2547)", async () => {
    // seen is compared as the stored string, so two edits inside one millisecond would read the same; negligible for a CLI write
    const posted = await post(decision(SLACK))
    const edited = await store.editItem(
      db,
      posted.id,
      decision({ ...SLACK, text: "hi Merritt, a different message." }),
      new Date(Date.parse(posted.updatedAt) + 60_000),
    )
    if (!edited.ok) throw new Error(edited.message)
    expect(
      await store.answerItem(
        db,
        posted.id,
        { action: "approve", seen: posted.updatedAt },
        { actor },
      ),
    ).toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("changed since"),
      ok: false,
    })
    expect((await store.getItem(db, posted.id))?.status).toBe("open")
    const answered = await store.answerItem(
      db,
      posted.id,
      { action: "approve", seen: edited.item.updatedAt },
      { actor },
    )
    expect(answered).toMatchObject({ item: { status: "approved" }, ok: true })
  })

  test("an item put away with Snooze edits as an open one, while one he replied to in chat is refused (PG-2547)", async () => {
    const snoozed = await post(decision(SLACK))
    const scheduled = await store.scheduleItem(
      db,
      snoozed.id,
      new Date(Date.now() + 3_600_000).toISOString(),
    )
    if (!scheduled.ok) throw new Error(scheduled.message)
    expect(await store.editItem(db, snoozed.id, decision(SLACK))).toMatchObject({
      item: { answer: { snoozedUntil: expect.any(String) }, status: "open" },
      ok: true,
    })
    // settled, so no open item sleeps past the other tests' clocks
    expect(await store.settleItem(db, snoozed.id)).toMatchObject({ ok: true })
    const replied = await post(decision(SLACK))
    await store.recordReply(db, replied.ref)
    expect(await store.editItem(db, replied.id, decision(SLACK))).toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("replied to in chat"),
      ok: false,
    })
  })

  test("a chat reply keeps his words after the tag, so the card says what is being done", async () => {
    const posted = await post(decision(PREVIEWS.budget))
    const at = new Date("2026-10-07T12:00:00.000Z")
    const recorded = await store.recordReply(
      db,
      posted.ref,
      at,
      `re #i${posted.ref}:  tomorrow,\n after the standup`,
    )
    expect(recorded?.answer).toEqual({
      at: at.toISOString(),
      choice: "replied",
      said: "tomorrow, after the standup",
    })
    expect(store.saidOf(`re #i${posted.ref}`)).toBeUndefined()
    expect(store.saidOf("x".repeat(400))).toHaveLength(280)
  })

  test("a chat reply records itself on the open item, which then waits on its poster alone", async () => {
    const posted = await post(decision(PREVIEWS.budget))
    const at = new Date("2026-10-07T12:00:00.000Z")
    const recorded = await store.recordReply(db, posted.ref, at)
    if (!recorded) throw new Error("the reply was not recorded")
    expect(recorded.answer).toEqual({ at: at.toISOString(), choice: "replied" })
    expect(recorded.status).toBe("open")
    expect(recorded.delivery).toBeNull()
    // it stays in the list, but the count and what needs him leave it
    const listed = await store.listItems(db, at)
    expect(listed.items.map((i) => i.id)).toContain(posted.id)
    expect(listed.count).toBe(store.inboxCount(listed.items))
    expect(listed.items.filter(store.deliveryFailed)).toHaveLength(0)
    // a second reply, an answered item, an update and an unknown tag take none
    expect(await store.recordReply(db, posted.ref, new Date(at.getTime() + 60_000))).toBeNull()
    const other = await post(decision(PREVIEWS.delete))
    await store.answerItem(db, other.id, { action: "approve" }, { actor })
    expect(await store.recordReply(db, other.ref, at)).toBeNull()
    const update = await post({
      from: "builder",
      kind: "update",
      preview: { outcome: "merged" },
      title: "Merged",
    })
    expect(await store.recordReply(db, update.ref, at)).toBeNull()
    expect(await store.recordReply(db, 999999, at)).toBeNull()
    await store.markRead(db, [update.id])
    // its poster closes it: a chat reply is no go, so a bare ack closes it, and its delivery is done by the CLI
    const closed = await store.ackItem(db, posted.id, { now: new Date(at.getTime() + 60_000) })
    if (!closed.ok) throw new Error(closed.message)
    expect(closed.item.answer).toMatchObject({
      ackedAt: "2026-10-07T12:01:00.000Z",
      choice: "replied",
    })
    expect(closed.item.delivery).toMatchObject({ status: "delivered", via: "cli" })
    // and a settle still takes one its poster decided another way
    const settled = await post(decision(PREVIEWS.schema))
    await store.recordReply(db, settled.ref, at)
    const done = await store.settleItem(db, settled.id, { note: "Decided another way" })
    expect(done.ok && done.item.status).toBe("done")
    expect(done.ok && done.item.answer).toMatchObject({ choice: "settled" })
  })

  test("an answered item its poster closes moves to Done at once; one not carried out yet stays (PG-2502)", async () => {
    const at = new Date("2026-10-28T19:00:00.000Z")
    const answered = async (preview: object, action: "approve" | "deny") => {
      const posted = await post(decision(preview))
      await store.answerItem(db, posted.id, { action }, { actor })
      return (await store.getItem(db, posted.id))!
    }
    const dismissed = (item: { answer: unknown } | null | undefined) =>
      (item?.answer as { dismissedAt?: string } | null)?.dismissedAt
    // bun run ask ack: a go closed with where it landed
    const go = await answered(PREVIEWS.delete, "approve")
    const acked = await store.ackItem(db, go.id, { link: CHANNEL, now: at })
    if (!acked.ok) throw new Error(acked.message)
    expect(dismissed(acked.item)).toBe(at.toISOString())
    // bun run ask get --ack: a deny, which reading carries out
    const denied = await answered(PREVIEWS.budget, "deny")
    expect(dismissed(await store.readAnswer(db, denied, at))).toBe(at.toISOString())
    // bun run ask ack on a chat reply, which skips In progress for Done
    const replied = await post(decision(PREVIEWS.ticket))
    await store.recordReply(db, replied.ref, new Date(at.getTime() - 60_000))
    const closed = await store.ackItem(db, replied.id, { now: at })
    if (!closed.ok) throw new Error(closed.message)
    expect(dismissed(closed.item)).toBe(at.toISOString())
    // bun run ask settle: the poster decided it another way
    const open = await post(decision(PREVIEWS.schema))
    const settled = await store.settleItem(db, open.id, { now: at })
    if (!settled.ok) throw new Error(settled.message)
    expect(dismissed(settled.item)).toBe(at.toISOString())
    // a go read but not carried out, and an answer no one closed, stay in the list
    const read = await answered(PREVIEWS.delete, "approve")
    await store.readAnswer(db, read, at)
    expect(dismissed(await store.getItem(db, read.id))).toBeUndefined()
    const waiting = await answered(PREVIEWS.ask, "approve")
    expect(dismissed(await store.getItem(db, waiting.id))).toBeUndefined()
    // one he set aside stays on the Archived shelf, its read closing it without a Dismiss
    const aside = await post(decision(PREVIEWS.ship))
    await store.answerItem(db, aside.id, { action: "clear" }, { actor })
    await store.readAnswer(db, (await store.getItem(db, aside.id))!, at)
    expect(dismissed(await store.getItem(db, aside.id))).toBeUndefined()
    // his own earlier Dismiss keeps its time
    const early = await answered(PREVIEWS.budget, "deny")
    const before = new Date(at.getTime() - 60_000)
    await store.dismissItems(db, [early.id], before)
    await store.ackItem(db, early.id, { now: at })
    expect(dismissed(await store.getItem(db, early.id))).toBe(before.toISOString())
  })

  test("a settle takes no reply its poster closed, and keeps its link (PG-2444)", async () => {
    const posted = await post(decision(PREVIEWS.budget))
    const at = new Date("2026-10-28T03:00:00.000Z")
    await store.recordReply(db, posted.ref, at)
    const closed = await store.ackItem(db, posted.id, {
      link: CHANNEL,
      now: new Date(at.getTime() + 60_000),
    })
    if (!closed.ok) throw new Error(closed.message)
    expect(await store.settleItem(db, posted.id, { note: "Decided another way" })).toMatchObject({
      code: "CONFLICT",
      message: "This item is already answered",
      ok: false,
    })
    const after = await store.getItem(db, posted.id)
    expect(after?.status).toBe("open")
    expect(after?.answer).toEqual(closed.item.answer)
    expect(after?.answer).toMatchObject({ link: CHANNEL })
    const bare = await post(decision(PREVIEWS.schema))
    await store.recordReply(db, bare.ref, at)
    const bareClosed = await store.ackItem(db, bare.id, { now: new Date(at.getTime() + 60_000) })
    if (!bareClosed.ok) throw new Error(bareClosed.message)
    expect(await store.settleItem(db, bare.id, { note: "Decided another way" })).toMatchObject({
      code: "CONFLICT",
      ok: false,
    })
    expect((await store.getItem(db, bare.id))?.answer).toEqual(bareClosed.item.answer)
  })

  test("a replied item leaves the list once its week is up, as an answered one does", async () => {
    const posted = await post(decision(PREVIEWS.ticket))
    await store.recordReply(db, posted.ref, new Date(Date.now() - 8 * 24 * 60 * 60 * 1000))
    expect((await store.listItems(db)).items.map((i) => i.id)).not.toContain(posted.id)
  })

  // The replied-wait guard in listItems's what-needs-him query is visible only through the rest list's cap: without the guard a fresh replied item rides the uncapped needs-him side and never drops off, with it the 200 fresher rows push it out.
  test("a fresh replied item drops off the list once the rest side's 200 rows are full", async () => {
    const posted = await post(decision(PREVIEWS.ticket))
    await store.recordReply(db, posted.ref)
    const updates: string[] = []
    for (let i = 0; i < 200; i++) {
      const update = await post({
        from: "builder",
        kind: "update",
        preview: { outcome: "merged" },
        title: `Merged ${i}`,
      })
      updates.push(update.id)
    }
    expect((await store.listItems(db)).items.map((i) => i.id)).not.toContain(posted.id)
    // read the 200 back, so the store's later tests see no unread pile of ours
    expect(await store.markRead(db, updates)).toBe(200)
  })

  // An item he opened again from its card after a chat reply: its poster reads one answer, the one that replaced the reply, and is chased for that alone.
  describe("an answer from the card over a chat reply its poster has not closed (PG-1790)", () => {
    const replyTo = async () => {
      const posted = await post({
        from: "dispatcher",
        kind: "draft",
        preview: { link: CHANNEL, text: "hi Merritt", to: "@Merritt" },
        title: "Ask Merritt",
      })
      const at = new Date()
      await store.recordReply(db, posted.ref, at)
      const stale = async () =>
        (
          await store.staleItems(db, {
            minutes: 15,
            now: new Date(at.getTime() + 16 * 60_000),
            since: new Date(at.getTime() - 60_000),
          })
        ).find((i) => i.id === posted.id)
      return { posted, stale }
    }

    test("Send replaces the reply: its poster reads Send, and is chased for Send alone", async () => {
      const { posted, stale } = await replyTo()
      const sent = await store.answerItem(db, posted.id, { action: "send" }, { actor })
      if (!sent.ok) throw new Error(sent.message)
      expect(sent.item.status).toBe("sent")
      expect((await store.getItem(db, posted.id))?.answer).toMatchObject({ choice: "send" })
      expect((await stale())?.answer).toMatchObject({ choice: "send" })
    })

    test("Schedule replaces the reply: its poster reads no answer, and is chased for none, until he answers", async () => {
      const { posted, stale } = await replyTo()
      // a year out, so a later test listing a week ahead still finds it asleep
      const at = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
      const scheduled = await store.scheduleItem(db, posted.id, at)
      if (!scheduled.ok) throw new Error(scheduled.message)
      expect(scheduled.item.status).toBe("open")
      expect((await store.getItem(db, posted.id))?.answer).toEqual({ snoozedUntil: at })
      expect(await stale()).toBeUndefined()
    })

    test("a reply its poster closed takes no Schedule", async () => {
      const { posted } = await replyTo()
      await store.ackItem(db, posted.id, { link: CHANNEL })
      const at = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
      expect(await store.scheduleItem(db, posted.id, at)).toMatchObject({
        code: "CONFLICT",
        message: "This item already has your answer",
      })
    })
  })

  test("the stale read still chases a replied item until its poster closes it", async () => {
    const posted = await post(decision(PREVIEWS.ship))
    const at = new Date()
    await store.recordReply(db, posted.ref, at)
    const stale = async () =>
      (
        await store.staleItems(db, {
          minutes: 15,
          now: new Date(at.getTime() + 16 * 60_000),
          since: new Date(at.getTime() - 60_000),
        })
      ).map((i) => i.id)
    expect(await stale()).toContain(posted.id)
    await store.ackItem(db, posted.id, { link: "https://github.com/acme/app/pull/270" })
    expect(await stale()).not.toContain(posted.id)
  })

  test("the poster resolves its own alert update; another session, a non-alert item and an unknown id are refused (#658)", async () => {
    const alert = async () => {
      const posted = await post({
        from: "ops",
        kind: "update",
        preview: { outcome: "alert" },
        title: "The Mac is on battery",
      })
      return posted
    }
    const posted = await alert()
    const at = new Date("2026-10-07T12:00:00.000Z")
    const resolved = await store.resolveItem(db, `#i${posted.ref}`, {
      by: "ops",
      note: "Plugged in",
      now: at,
    })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.item.readAt).toBe(at.toISOString())
    expect(resolved.item.answer).toEqual({
      at: at.toISOString(),
      by: "ops",
      choice: "resolved",
      note: "Plugged in",
    })
    // a resolved alert stays resolved: a second resolve is refused
    expect(await store.resolveItem(db, posted.id, { by: "ops", now: at })).toMatchObject({
      code: "CONFLICT",
      ok: false,
    })
    // another session's resolve is refused, naming who posted it
    const other = await alert()
    expect(await store.resolveItem(db, other.id, { by: "builder" })).toMatchObject({
      code: "CONFLICT",
      message: "Only ops, which posted it, resolves this alert",
      ok: false,
    })
    // a decision settles, it does not resolve; a non-alert update is read or dismissed
    expect(
      await store.resolveItem(db, (await post(decision(PREVIEWS.budget))).id, { by: "ops" }),
    ).toMatchObject({ code: "VALIDATION_ERROR", ok: false })
    const finding = await post({
      from: "builder",
      kind: "update",
      preview: { outcome: "finding" },
      title: "Found",
    })
    expect(await store.resolveItem(db, finding.id, { by: "builder" })).toMatchObject({
      code: "VALIDATION_ERROR",
      ok: false,
    })
    expect(await store.resolveItem(db, "#i999999", { by: "ops" })).toMatchObject({
      code: "NOT_FOUND",
      ok: false,
    })
    // the note is one line, and never an archives-style Slack link
    const long = await alert()
    expect(await store.resolveItem(db, long.id, { by: "ops", note: "two\nlines" })).toMatchObject({
      code: "VALIDATION_ERROR",
      ok: false,
    })
    const archived = await alert()
    expect(
      await store.resolveItem(db, archived.id, {
        by: "ops",
        note: "see https://acme.slack.com/archives/C0MADEUP01",
      }),
    ).toMatchObject({ code: "VALIDATION_ERROR", ok: false })
    // nothing here leaves an update unread
    await store.markRead(db, [other.id, finding.id, long.id, archived.id])
  })

  test("ack and settle store where the answer was carried out, and take an https URL alone", async () => {
    const draft = await post({
      from: "dispatcher",
      kind: "draft",
      preview: { link: CHANNEL, text: "hi", to: "@Merritt" },
      title: "Ask Merritt",
    })
    await store.answerItem(db, draft.id, { action: "send" }, { actor })
    const permalink =
      "https://app.slack.com/client/T0000000000/C0MADEUP01/thread/C0MADEUP01-1700000000.000100"
    for (const bad of [
      "http://app.slack.com/client/T0000000000/C0MADEUP01",
      "https://acme.slack.com/archives/C0MADEUP01/p1700000000000100",
      "not a url",
      "javascript:alert(1)",
    ]) {
      expect(await store.ackItem(db, draft.id, { link: bad })).toMatchObject({
        code: "VALIDATION_ERROR",
        ok: false,
      })
    }
    const acked = await store.ackItem(db, draft.id, { link: permalink })
    expect(acked.ok && acked.item.answer).toMatchObject({ choice: "send", link: permalink })
    expect(acked.ok && acked.item.delivery?.status).toBe("delivered")
    const ticket = await post(decision(PREVIEWS.ticket))
    expect(await store.settleItem(db, ticket.id, { link: "ftp://linear.app/x" })).toMatchObject({
      code: "VALIDATION_ERROR",
      ok: false,
    })
    const settled = await store.settleItem(db, ticket.id, {
      link: "https://linear.app/team/issue/CEDAR-1",
    })
    expect(settled.ok && settled.item.answer).toMatchObject({
      choice: "settled",
      link: "https://linear.app/team/issue/CEDAR-1",
    })
  })

  test("a link's label is kept beside it, needs the link, and is one line", async () => {
    const ticket = await post(decision(PREVIEWS.ticket))
    await store.answerItem(db, ticket.id, { action: "approve" }, { actor })
    const link = "https://linear.app/acme/issue/DUNE-2186"
    expect(await store.ackItem(db, ticket.id, { label: "Filed DUNE-2186" })).toMatchObject({
      code: "VALIDATION_ERROR",
      ok: false,
    })
    expect(
      await store.ackItem(db, ticket.id, {
        label: "Sent in https://acme.slack.com/archives/C0MADEUP01",
        link: "https://app.slack.com/client/T0000000000/C0MADEUP01",
      }),
    ).toMatchObject({ code: "VALIDATION_ERROR", ok: false })
    expect(await store.ackItem(db, ticket.id, { label: "two\nlines", link })).toMatchObject({
      code: "VALIDATION_ERROR",
      ok: false,
    })
    const acked = await store.ackItem(db, ticket.id, { label: " Filed DUNE-2186 ", link })
    expect(acked.ok && acked.item.answer).toMatchObject({ link, linkLabel: "Filed DUNE-2186" })
    const other = await post(decision(PREVIEWS.delete))
    const settled = await store.settleItem(db, other.id, {
      label: "Closed acme/app#12",
      link: "https://github.com/acme/app/pull/12",
    })
    expect(settled.ok && settled.item.answer).toMatchObject({
      choice: "settled",
      linkLabel: "Closed acme/app#12",
    })
  })

  test("a re-ack with a new link and no label drops the old link's label, so the card names the new link", async () => {
    const ticket = await post(decision(PREVIEWS.ticket))
    await store.answerItem(db, ticket.id, { action: "approve" }, { actor })
    await store.ackItem(db, ticket.id, {
      label: "Filed DUNE-2186",
      link: "https://linear.app/acme/issue/DUNE-2186",
    })
    const again = await store.ackItem(db, ticket.id, {
      link: "https://linear.app/acme/issue/DUNE-2187",
    })
    expect(again.ok && again.item.answer).toMatchObject({
      link: "https://linear.app/acme/issue/DUNE-2187",
    })
    expect(again.ok && again.item.answer && "linkLabel" in again.item.answer).toBe(false)
  })

  test("a failed delivery is recorded, and the poster's ack marks it read", async () => {
    const posted = await post({
      from: "dispatcher",
      kind: "draft",
      preview: { link: CHANNEL, text: "hi", to: "@Merritt" },
      title: "Ask Merritt",
    })
    const answered = await store.answerItem(
      db,
      posted.id,
      { action: "send", text: "hi there" },
      {
        actor,
        deliver: async () => ({
          code: "NOT_FOUND",
          ok: false,
          reason: "no session named dispatcher",
        }),
      },
    )
    if (!answered.ok) throw new Error(answered.message)
    expect(answered.item.status).toBe("sent")
    expect(answered.item.answer).toMatchObject({ editedText: "hi there" })
    expect(answered.item.delivery).toMatchObject({ code: "NOT_FOUND", status: "failed" })
    const acked = await store.ackItem(db, `#i${posted.ref}`, { link: CHANNEL })
    if (!acked.ok) throw new Error(acked.message)
    expect(acked.item.delivery).toMatchObject({ status: "delivered", via: "cli" })
  })

  const gone = async (delivery: Delivery) => ({
    code: "NOT_FOUND",
    ok: false as const,
    reason: `No live session is named ${delivery.to}.`,
  })

  // the poster "worker-eod" has ended; any other session takes the answer
  const afterPoster = async (delivery: Delivery) =>
    delivery.to === "worker-eod"
      ? gone(delivery)
      : { at: "2026-10-26T06:00:00.000Z", ok: true as const, sessionId: "s1" }

  test("an answer to a poster that has ended goes to the dispatcher, with the item, its kind, the answer and the preview text, and does not read failed", async () => {
    const posted = await post({
      from: "worker-eod",
      kind: "draft",
      preview: { link: CHANNEL, text: "hi Merritt, the fix is on staging.", to: "@Merritt" },
      title: "Tell Merritt",
    })
    const sent: Delivery[] = []
    const answered = await store.answerItem(
      db,
      posted.id,
      { action: "send", text: "hi Merritt, it is live." },
      {
        actor,
        deliver: async (delivery) => {
          sent.push(delivery)
          return afterPoster(delivery)
        },
        dispatcher: "dispatcher",
      },
    )
    if (!answered.ok) throw new Error(answered.message)
    expect(sent.map((d) => d.to)).toEqual(["worker-eod", "dispatcher"])
    const relay = sent[1]?.text ?? ""
    expect(relay).toContain(`#i${posted.ref}`)
    expect(relay).toContain("draft")
    expect(relay).toContain("worker-eod has ended")
    expect(relay).toContain("goes out through your Slack tool")
    expect(relay).toContain("bun run ask ack")
    expect(relay).toContain("hi Merritt, it is live.")
    expect(relay).toContain("hi Merritt, the fix is on staging.")
    expect(answered.item.delivery).toEqual({
      at: "2026-10-26T06:00:00.000Z",
      status: "delivered",
      to: "dispatcher",
      via: "session",
    })
    expect(store.deliveryFailed(answered.item)).toBe(false)
  })

  test("an answer to a poster that is live goes to the poster alone", async () => {
    const posted = await post({
      from: "worker-eod",
      kind: "draft",
      preview: { link: CHANNEL, text: "hi", to: "@Merritt" },
      title: "Tell Merritt",
    })
    const sent: Delivery[] = []
    const answered = await store.answerItem(
      db,
      posted.id,
      { action: "send" },
      {
        actor,
        deliver: async (delivery) => {
          sent.push(delivery)
          return { at: "2026-10-26T06:00:00.000Z", ok: true, sessionId: "s1" }
        },
        dispatcher: "dispatcher",
      },
    )
    expect(answered.ok).toBe(true)
    expect(sent.map((d) => d.to)).toEqual(["worker-eod"])
    expect(sent[0]?.text).not.toContain("has ended")
    expect(answered.ok && answered.item.delivery).toMatchObject({ to: "worker-eod" })
  })

  test("a dispatcher that cannot be reached either leaves the answer failed, with Retry", async () => {
    const posted = await post({ ...decision(PREVIEWS.delete), from: "worker-eod" })
    const answered = await store.answerItem(
      db,
      posted.id,
      { action: "approve" },
      { actor, deliver: gone, dispatcher: "dispatcher" },
    )
    if (!answered.ok) throw new Error(answered.message)
    expect(answered.item.delivery).toMatchObject({ code: "NOT_FOUND", status: "failed" })
    expect(store.retryable(answered.item)).toBe(true)
    await store.dismissItems(db, [posted.id])
  })

  test("a NOT_FOUND from a live session is not relayed, and stays failed with Retry", async () => {
    const posted = await post({ ...decision(PREVIEWS.delete), from: "worker-eod" })
    const sent: Delivery[] = []
    const answered = await store.answerItem(
      db,
      posted.id,
      { action: "approve" },
      {
        actor,
        deliver: async (delivery) => {
          sent.push(delivery)
          return {
            code: "NOT_FOUND",
            ok: false as const,
            reason: `${delivery.to} now names another session. Send it again.`,
          }
        },
        dispatcher: "dispatcher",
      },
    )
    if (!answered.ok) throw new Error(answered.message)
    expect(sent.map((d) => d.to)).toEqual(["worker-eod"])
    expect(store.retryable(answered.item)).toBe(true)
    await store.dismissItems(db, [posted.id])
  })

  test("a poster whose Claude is gone from its pane reaches the dispatcher too", async () => {
    const posted = await post({ ...decision(PREVIEWS.delete), from: "worker-eod" })
    const sent: Delivery[] = []
    const answered = await store.answerItem(
      db,
      posted.id,
      { action: "approve" },
      {
        actor,
        deliver: async (delivery) => {
          sent.push(delivery)
          return delivery.to === "worker-eod"
            ? {
                code: "NOT_FOUND",
                ok: false as const,
                reason: `${delivery.to}'s Claude is not running in its pane any more.`,
              }
            : { at: "2026-10-26T06:00:00.000Z", ok: true as const, sessionId: "s1" }
        },
        dispatcher: "dispatcher",
      },
    )
    if (!answered.ok) throw new Error(answered.message)
    expect(sent.map((d) => d.to)).toEqual(["worker-eod", "dispatcher"])
    expect(answered.item.delivery).toMatchObject({ status: "delivered" })
  })

  test("a deny to an ended poster reaches the dispatcher as an item to close, not a go to carry out", async () => {
    const posted = await post({ ...decision(PREVIEWS.delete), from: "worker-eod" })
    const sent: Delivery[] = []
    await store.answerItem(
      db,
      posted.id,
      { action: "deny" },
      {
        actor,
        deliver: async (delivery) => {
          sent.push(delivery)
          return afterPoster(delivery)
        },
        dispatcher: "dispatcher",
      },
    )
    expect(sent.map((d) => d.to)).toEqual(["worker-eod", "dispatcher"])
    expect(sent[1]?.text).toContain("nothing is carried out")
    expect(sent[1]?.text).not.toContain("you carry this out")
  })

  test("a clear reaches its poster as set aside, not denied, and its poster's read closes it as a non-go", async () => {
    const posted = await post(decision(PREVIEWS.ticket))
    const sent: Delivery[] = []
    const answered = await store.answerItem(
      db,
      posted.id,
      { action: "clear" },
      {
        actor,
        deliver: async (delivery) => {
          sent.push(delivery)
          return { at: "2026-10-07T12:00:00.000Z", ok: true as const, sessionId: "s1" }
        },
      },
    )
    if (!answered.ok) throw new Error(answered.message)
    expect(answered.item.status).toBe("cleared")
    expect(sent[0]?.text).toContain("Cleared for now")
    expect(sent[0]?.text).not.toContain("Denied")
    // a go would wait on bun run ask ack with a link; a clear closes on the poster's read, as a deny does
    const read = await store.readAnswer(db, answered.item, new Date("2026-10-07T12:01:00.000Z"))
    expect(read.answer).toMatchObject({ ackedAt: "2026-10-07T12:01:00.000Z", choice: "clear" })
    expect(await store.ackItem(db, posted.id, { noLink: "nothing landed" })).toMatchObject({
      ok: false,
    })
  })

  test("Retry on an answer that failed for an ended poster reaches the dispatcher", async () => {
    const posted = await post({
      from: "worker-eod",
      kind: "draft",
      preview: { link: CHANNEL, text: "hi Merritt", to: "@Merritt" },
      title: "Tell Merritt",
    })
    const failed = await store.answerItem(
      db,
      posted.id,
      { action: "send" },
      { actor, deliver: gone },
    )
    if (!failed.ok) throw new Error(failed.message)
    expect(failed.item.delivery).toMatchObject({ code: "NOT_FOUND", status: "failed" })
    const sent: Delivery[] = []
    const retried = await store.retryDelivery(db, posted.id, {
      actor,
      deliver: async (delivery) => {
        sent.push(delivery)
        return afterPoster(delivery)
      },
      dispatcher: "dispatcher",
    })
    if (!retried.ok) throw new Error(retried.message)
    expect(sent.map((d) => d.to)).toEqual(["worker-eod", "dispatcher"])
    expect(retried.item.delivery).toMatchObject({ status: "delivered", via: "session" })
  })

  test("deliver.ts still words an ended poster the way the relay reads it", async () => {
    const source = await Bun.file(
      join(import.meta.dir, "../../../../../../api/hono/src/lib/dashboard/deliver.ts"),
    ).text()
    expect(source).toContain("No live session is named ${to}.")
    expect(source).toContain("Claude is not running in its pane any more.")
  })

  test("an item the dispatcher itself posted is not relayed to itself", async () => {
    const posted = await post({ ...decision(PREVIEWS.delete), from: "dispatcher" })
    const sent: Delivery[] = []
    await store.answerItem(
      db,
      posted.id,
      { action: "approve" },
      {
        actor,
        deliver: async (delivery) => {
          sent.push(delivery)
          return gone(delivery)
        },
        dispatcher: "dispatcher",
      },
    )
    expect(sent.map((d) => d.to)).toEqual(["dispatcher"])
    await store.dismissItems(db, [posted.id])
  })

  const failing = async () => ({
    code: "CMUX_FAILED",
    ok: false as const,
    reason: "cmux sessions failed: no answer from cmux",
  })

  test("an answer that failed to send stays in the list and its count past a week, until he dismisses it", async () => {
    const posted = await post(decision(PREVIEWS.delete))
    const answered = await store.answerItem(
      db,
      posted.id,
      { action: "approve" },
      { actor, deliver: failing },
    )
    if (!answered.ok) throw new Error(answered.message)
    expect(answered.item.status).toBe("approved")
    expect(answered.item.delivery).toMatchObject({ code: "CMUX_FAILED", status: "failed" })
    const later = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000)
    const list = await store.listItems(db, later)
    expect(list.items.map((i) => i.id)).toContain(posted.id)
    expect(list.count).toBe(store.inboxCount(list.items))
    expect(list.items.filter(store.deliveryFailed).map((i) => i.id)).toEqual([posted.id])
    expect(await store.dismissItems(db, [posted.id])).toBe(1)
    expect((await store.listItems(db, later)).items.map((i) => i.id)).not.toContain(posted.id)
  })

  test("a set-aside item stays in the list past a week, for the Archived shelf, and never counts", async () => {
    const posted = await post(decision(PREVIEWS.ship))
    const delivered = async () => ({
      at: new Date().toISOString(),
      ok: true as const,
      sessionId: "s1",
    })
    const cleared = await store.answerItem(
      db,
      posted.id,
      { action: "clear" },
      { actor, deliver: delivered },
    )
    if (!cleared.ok) throw new Error(cleared.message)
    await store.readAnswer(db, cleared.item)
    const later = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000)
    const list = await store.listItems(db, later)
    expect(list.items.filter((i) => i.id === posted.id)).toHaveLength(1)
    expect(list.snoozed.map((i) => i.id)).not.toContain(posted.id)
    expect(list.count).toBe(store.inboxCount(list.items, later))
    // dismissed, it goes to Done, which keeps a week as every settled item does
    expect(await store.dismissItems(db, [posted.id])).toBe(1)
    expect((await store.listItems(db, later)).items.map((i) => i.id)).not.toContain(posted.id)
  })

  test("Retry types the answer again and records the new result, once however often it is clicked", async () => {
    const posted = await post(decision(SLACK))
    await store.answerItem(db, posted.id, { action: "approve" }, { actor, deliver: failing })
    const again = await store.retryDelivery(db, posted.id, { actor, deliver: failing })
    expect(again.ok && again.item.delivery).toMatchObject({ code: "CMUX_FAILED", status: "failed" })
    const sent: Delivery[] = []
    const deliver = async (delivery: Delivery) => {
      sent.push(delivery)
      return { at: "2026-10-12T07:00:00.000Z", ok: true as const, sessionId: "s1" }
    }
    const [first, second] = await Promise.all([
      store.retryDelivery(db, posted.id, { actor, deliver }),
      store.retryDelivery(db, posted.id, { actor, deliver }),
    ])
    expect([first.ok, second.ok].sort()).toEqual([false, true])
    expect(sent).toHaveLength(1)
    expect(sent[0]?.text).toContain("Approved. Carry it out.")
    expect(sent[0]?.to).toBe("ops")
    const item = await store.getItem(db, posted.id)
    expect(item?.delivery).toMatchObject({ status: "delivered", via: "session" })
    expect(item && store.deliveryFailed(item)).toBe(false)
    expect(await store.retryDelivery(db, posted.id, { actor, deliver })).toMatchObject({
      code: "CONFLICT",
      ok: false,
    })
  })

  test("the stale read lists an answer its poster has not acked after the minutes given, not before, and not once acked", async () => {
    const posted = await post(decision(PREVIEWS.budget))
    const at = new Date()
    await store.answerItem(db, posted.id, { action: "approve" }, { actor, now: at })
    const since = new Date(at.getTime() - 60_000)
    const stale = async (minutesLater: number) =>
      (
        await store.staleItems(db, {
          minutes: 15,
          now: new Date(at.getTime() + minutesLater * 60_000),
          since,
        })
      ).map((i) => i.id)
    expect(await stale(14)).not.toContain(posted.id)
    expect(await stale(16)).toContain(posted.id)
    // an answer before --since is left out, so answers acked before acks were stamped never show
    expect(
      (
        await store.staleItems(db, {
          minutes: 15,
          now: new Date(at.getTime() + 16 * 60_000),
          since: new Date(at.getTime() + 1),
        })
      ).map((i) => i.id),
    ).not.toContain(posted.id)
    await store.ackItem(db, posted.id, { noLink: "A budget has no page" })
    expect(await stale(16)).not.toContain(posted.id)
  })

  test("the stale read keeps an answer typed into its session until the poster acks it, and drops a failed one he dismissed", async () => {
    const typed = await post(decision(PREVIEWS.ship))
    const failed = await post(decision(PREVIEWS.ticket))
    const at = new Date()
    await store.answerItem(
      db,
      typed.id,
      { action: "approve" },
      {
        actor,
        deliver: async () => ({ at: at.toISOString(), ok: true, sessionId: "s1" }),
        now: at,
      },
    )
    await store.answerItem(
      db,
      failed.id,
      { action: "approve" },
      { actor, deliver: failing, now: at },
    )
    const stale = async () =>
      (
        await store.staleItems(db, {
          minutes: 15,
          now: new Date(at.getTime() + 16 * 60_000),
          since: new Date(at.getTime() - 60_000),
        })
      ).map((i) => i.id)
    expect(await stale()).toEqual(expect.arrayContaining([typed.id, failed.id]))
    await store.ackItem(db, typed.id, { link: "https://github.com/acme/app/pull/270" })
    expect((await store.getItem(db, typed.id))?.delivery).toMatchObject({ via: "session" })
    expect(await stale()).not.toContain(typed.id)
    // he dismissed it from its failed state, so nobody is chased to carry it out, and Retry is refused
    await store.dismissItems(db, [failed.id])
    expect(await stale()).not.toContain(failed.id)
    expect(
      await store.retryDelivery(db, failed.id, {
        actor,
        deliver: async () => ({ at: at.toISOString(), ok: true, sessionId: "s1" }),
      }),
    ).toMatchObject({ code: "CONFLICT", ok: false })
  })

  test("Retry is refused once typing may have begun, since the answer may already be in the session", async () => {
    for (const code of ["INTERRUPTED", "ERROR"]) {
      const posted = await post(decision(PREVIEWS.budget))
      await store.answerItem(
        db,
        posted.id,
        { action: "approve" },
        { actor, deliver: async () => ({ code, ok: false, reason: "cut off" }) },
      )
      const item = await store.getItem(db, posted.id)
      expect(item && store.retryable(item), code).toBe(false)
      const sent: Delivery[] = []
      const retried = await store.retryDelivery(db, posted.id, {
        actor,
        deliver: async (delivery) => {
          sent.push(delivery)
          return { at: "x", ok: true, sessionId: "s1" }
        },
      })
      expect(retried, code).toMatchObject({ code: "CONFLICT", ok: false })
      expect(sent).toHaveLength(0)
      await store.dismissItems(db, [posted.id])
    }
  })

  test("an ack after the answer was typed into its session stamps it, which keeps the first time", async () => {
    const posted = await post(decision(PREVIEWS.ship))
    await store.answerItem(
      db,
      posted.id,
      { action: "approve" },
      {
        actor,
        deliver: async () => ({ at: "2026-10-12T07:00:00.000Z", ok: true, sessionId: "s1" }),
      },
    )
    const link = "https://github.com/acme/app/pull/270"
    const first = await store.ackItem(db, posted.id, {
      link,
      now: new Date("2026-10-12T07:01:00Z"),
    })
    const second = await store.ackItem(db, posted.id, {
      link,
      now: new Date("2026-10-12T07:09:00Z"),
    })
    expect(first.ok && first.item.answer).toMatchObject({ ackedAt: "2026-10-12T07:01:00.000Z" })
    expect(second.ok && second.item.answer).toMatchObject({ ackedAt: "2026-10-12T07:01:00.000Z" })
    expect(second.ok && second.item.delivery).toMatchObject({ via: "session" })
  })

  test("a go closes only with where it landed or why there is none; reading it does not close it, while reading a deny does", async () => {
    // any link leads the same way, GitHub, Slack or Linear, not Slack alone
    const go = await post(decision(PREVIEWS.budget))
    const no = await post(decision(PREVIEWS.delete))
    const at = new Date()
    await store.answerItem(db, go.id, { action: "approve" }, { actor, now: at })
    await store.answerItem(db, no.id, { action: "deny" }, { actor, now: at })
    const stale = async () =>
      (
        await store.staleItems(db, {
          minutes: 0,
          now: new Date(at.getTime() + 1000),
          since: new Date(at.getTime() - 1000),
        })
      ).map((i) => i.id)
    const read = await store.readAnswer(db, (await store.getItem(db, go.id))!)
    expect(read.delivery).toMatchObject({ status: "delivered", via: "cli" })
    await store.readAnswer(db, (await store.getItem(db, no.id))!)
    expect(await stale()).toContain(go.id)
    expect(await stale()).not.toContain(no.id)
    expect(await store.ackItem(db, go.id)).toMatchObject({ code: "VALIDATION_ERROR", ok: false })
    expect(await store.ackItem(db, go.id, { link: CHANNEL, noLink: "both" })).toMatchObject({
      code: "VALIDATION_ERROR",
      ok: false,
    })
    expect(await store.ackItem(db, go.id, { noLink: "a\nb" })).toMatchObject({
      code: "VALIDATION_ERROR",
      ok: false,
    })
    // --no-link fits a go alone, and only one with no link recorded
    expect(await store.ackItem(db, no.id, { noLink: "x" })).toMatchObject({
      code: "VALIDATION_ERROR",
      ok: false,
    })
    const closed = await store.ackItem(db, go.id, { noLink: "A budget has no page" })
    expect(closed.ok && closed.item.answer).toMatchObject({ noLink: "A budget has no page" })
    expect(closed.ok && closed.item.answer && "ackedAt" in closed.item.answer).toBe(true)
    expect(await stale()).not.toContain(go.id)
    const linked = await post(decision(PREVIEWS.ship))
    await store.answerItem(db, linked.id, { action: "approve" }, { actor, now: at })
    await store.ackItem(db, linked.id, { link: "https://github.com/acme/app/pull/270" })
    expect(await store.ackItem(db, linked.id, { noLink: "x" })).toMatchObject({
      code: "CONFLICT",
      ok: false,
    })
    // and the other order: a go closed with no link takes no link after
    expect(await store.ackItem(db, go.id, { link: CHANNEL })).toMatchObject({
      code: "CONFLICT",
      ok: false,
    })
    expect(await store.ackItem(db, go.id, { noLink: "" })).toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("not empty"),
    })
  })

  test("the stale read lists an answer never read from before acks were stamped, but not one read or delivered then", async () => {
    const before = new Date(store.ACKS_STAMPED_FROM.getTime() - 60 * 60_000)
    const unread = await post(decision(PREVIEWS.budget))
    const read = await post(decision(PREVIEWS.budget))
    await store.answerItem(db, unread.id, { action: "approve" }, { actor, now: before })
    await store.answerItem(db, read.id, { action: "approve" }, { actor, now: before })
    await store.readAnswer(db, (await store.getItem(db, read.id))!, before)
    const listed = (
      await store.staleItems(db, {
        minutes: 15,
        since: new Date(before.getTime() - 60_000),
      })
    ).map((i) => i.id)
    expect(listed).toContain(unread.id)
    expect(listed).not.toContain(read.id)
    await store.ackItem(db, unread.id, { noLink: "A budget has no page" })
  })

  test("a reply reads like a go: reading it does not close it, a plain ack does", async () => {
    // his `re #iN` takes the item off his hands, and it waits on its poster closing it (the sweep keeps chasing)
    const replied = await post(decision(PREVIEWS.delete))
    const at = new Date()
    await store.recordReply(db, replied.ref, at)
    const stale = async () =>
      (
        await store.staleItems(db, {
          minutes: 0,
          now: new Date(at.getTime() + 1000),
          since: new Date(at.getTime() - 1000),
        })
      ).map((i) => i.id)
    const read = await store.readAnswer(db, (await store.getItem(db, replied.id))!)
    expect(read.delivery).toMatchObject({ status: "delivered", via: "cli" })
    expect(await stale()).toContain(replied.id)
    const closed = await store.ackItem(db, replied.id)
    expect(closed.ok && closed.item.answer).toMatchObject({ ackedAt: expect.any(String) })
    expect(await stale()).not.toContain(replied.id)
  })

  test("an open item has nothing to ack", async () => {
    const posted = await post(decision(PREVIEWS.budget))
    expect(await store.ackItem(db, posted.id)).toMatchObject({ code: "CONFLICT", ok: false })
  })

  test("an update starts unread, and reading the ones named takes them off the count, never another", async () => {
    const update = (title: string) =>
      post({ from: "builder", kind: "update", preview: { outcome: "merged" }, title })
    const one = await update("Merged: one")
    const two = await update("Merged: two")
    const three = await update("Merged: three")
    expect(one.readAt).toBeNull()
    expect(await store.markRead(db, [one.id])).toBe(1)
    expect(await store.markRead(db, [one.id])).toBe(0)
    const list = await store.listItems(db)
    const unread = list.items
      .filter((i) => i.kind === "update" && i.readAt === null)
      .map((i) => i.id)
    expect(unread).toEqual([three.id, two.id])
    // only the updates named are marked, so one that arrived since stays unread
    const later = await update("Merged: after the screen was read")
    expect(await store.markRead(db, unread)).toBe(2)
    expect(await store.markRead(db, [])).toBe(0)
    expect((await store.getItem(db, three.id))?.readAt).not.toBeNull()
    expect((await store.getItem(db, later.id))?.readAt).toBeNull()
    await store.markRead(db, [later.id])
  })

  test("an open decision marked read stays open and answerable, only seen", async () => {
    const ask = await post(decision(SLACK))
    expect(await store.markRead(db, [ask.id])).toBe(1)
    const read = await store.getItem(db, ask.id)
    expect(read?.readAt).not.toBeNull()
    expect(read?.status).toBe("open")
    expect(read?.answer).toBeNull()
    expect((await store.listItems(db)).items.map((i) => i.id)).toContain(ask.id)
  })

  test("an update takes no answer, which is a bad request rather than a conflict", async () => {
    const update = await post({
      from: "builder",
      kind: "update",
      preview: { outcome: "alert" },
      title: "Alert: x",
    })
    const answered = await store.answerItem(db, update.id, { action: "approve" }, { actor })
    expect(answered).toMatchObject({ code: "VALIDATION_ERROR", ok: false })
    await store.markRead(db, [update.id])
  })

  test("no pile of unread updates pushes an open decision out of the list or its count", async () => {
    const open = await post(decision(PREVIEWS.schema))
    const pile = []
    for (let i = 0; i < 205; i++) {
      pile.push(
        await post({
          from: "builder",
          kind: "update",
          preview: { outcome: "finding" },
          title: `Finding ${i}`,
        }),
      )
    }
    const list = await store.listItems(db)
    expect(list.items.map((i) => i.id)).toContain(open.id)
    expect(list.items[0]?.status).toBe("open")
    await store.markRead(db, pile.map((i) => i.id).slice(0, 200))
    await store.markRead(db, pile.map((i) => i.id).slice(200))
  }, 60_000)

  test("the list counts what needs him and keeps answered items a week", async () => {
    const list = await store.listItems(db)
    expect(list.count).toBe(store.inboxCount(list.items))
    const later = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000)
    const old = await store.listItems(db, later)
    expect(
      old.items.every(
        (i) =>
          i.status === "open" ||
          // a set-aside item stays, however old, for the Archived shelf
          i.status === "cleared" ||
          (i.kind === "update" && i.readAt === null) ||
          store.deliveryFailed(i),
      ),
    ).toBe(true)
  })

  test("Schedule pushes an open decision out of the list and the count until its time, then back", async () => {
    const posted = await post(decision(PREVIEWS.ship))
    const now = new Date("2026-10-07T11:00:00.000Z")
    const at = "2026-10-08T09:00:00.000Z"
    const base = await store.listItems(db, now)
    const scheduled = await store.scheduleItem(db, posted.id, at, { now })
    if (!scheduled.ok) throw new Error(scheduled.message)
    expect(scheduled.item.status).toBe("open")
    expect(store.snoozedUntil(scheduled.item, now)).toBe(at)
    expect(store.snoozedUntil(scheduled.item, new Date(at))).toBeNull()
    const held = await store.listItems(db, now)
    expect(held.items.map((i) => i.id)).not.toContain(posted.id)
    expect(held.count).toBe(base.count - 1)
    // asleep, it comes apart from items, for the Snoozed shelf alone, so no reader of items takes it as waiting
    expect(held.snoozed.map((i) => i.id)).toContain(posted.id)
    const awake = await store.listItems(db, new Date("2026-10-08T09:00:00.000Z"))
    expect(awake.items.map((i) => i.id)).toContain(posted.id)
    expect(awake.snoozed.map((i) => i.id)).not.toContain(posted.id)
    expect(awake.count).toBe(base.count)
    // a second schedule moves the time
    const moved = await store.scheduleItem(db, posted.id, "2026-10-09T09:00:00.000Z", { now })
    if (!moved.ok) throw new Error(moved.message)
    expect(store.snoozedUntil(moved.item, now)).toBe("2026-10-09T09:00:00.000Z")
  })

  test("Schedule refuses an update, an answered item and a time that has passed", async () => {
    const at = "2026-10-08T09:00:00.000Z"
    const update = await post({
      from: "builder",
      kind: "update",
      preview: { outcome: "merged" },
      title: "Merged",
    })
    expect((await store.scheduleItem(db, update.id, at)).ok).toBe(false)
    const posted = await post(decision(PREVIEWS.ask))
    const answered = await store.answerItem(db, posted.id, { action: "approve" }, { actor })
    if (!answered.ok) throw new Error(answered.message)
    expect((await store.scheduleItem(db, answered.item.id, at)).ok).toBe(false)
    const open = await post(decision(PREVIEWS.ask))
    const late = await store.scheduleItem(db, open.id, "2026-10-07T10:00:00.000Z")
    expect(late.ok).toBe(false)
    expect(await store.scheduleItem(db, "no-such-id", at)).toMatchObject({ code: "NOT_FOUND" })
  })

  test("an answer wakes a scheduled item and carries it out as usual", async () => {
    const posted = await post(decision(PREVIEWS.ship))
    await store.scheduleItem(db, posted.id, "2026-10-08T09:00:00.000Z", {
      now: new Date("2026-10-07T11:00:00.000Z"),
    })
    const sent: Delivery[] = []
    const answered = await store.answerItem(
      db,
      posted.id,
      { action: "approve" },
      {
        actor,
        deliver: (d) => (
          sent.push(d),
          Promise.resolve({ at: "2026-10-07T11:05:00Z", ok: true, sessionId: "s1" })
        ),
      },
    )
    if (!answered.ok) throw new Error(answered.message)
    expect(answered.item.answer).toMatchObject({ choice: "approve" })
    expect(store.snoozedUntil(answered.item, new Date("2026-10-07T11:00:00.000Z"))).toBeNull()
    expect(sent).toHaveLength(1)
  })

  test("a chat reply takes a scheduled item off the schedule, and the poster's ack refuses one with no answer", async () => {
    const posted = await post(decision(PREVIEWS.ask))
    await store.scheduleItem(db, posted.id, "2026-10-08T09:00:00.000Z", {
      now: new Date("2026-10-07T11:00:00.000Z"),
    })
    const replied = await store.recordReply(db, posted.ref)
    expect(replied?.answer).toMatchObject({ choice: "replied" })
    const acked = await store.ackItem(db, posted.id, {
      link: "https://github.com/acme/app/pull/270",
    })
    expect(acked.ok).toBe(true)
    const sleeping = await post(decision(PREVIEWS.ask))
    const scheduled = await store.scheduleItem(db, sleeping.id, "2026-10-08T09:00:00.000Z", {
      now: new Date("2026-10-07T11:00:00.000Z"),
    })
    expect(scheduled.ok).toBe(true)
    expect(
      await store.ackItem(db, sleeping.id, { link: "https://github.com/acme/app/pull/271" }),
    ).toMatchObject({ code: "CONFLICT" })
  })

  test("the sweep skips a scheduled item until its time brings it back", async () => {
    const posted = await post(decision(PREVIEWS.ask))
    const now = new Date("2026-10-07T11:00:00.000Z")
    await store.scheduleItem(db, posted.id, "2026-10-08T09:00:00.000Z", { now })
    expect(
      await store.staleItems(db, {
        minutes: 15,
        now,
        since: new Date("2026-10-07T10:00:00.000Z"),
      }),
    ).toEqual([])
  })
})
