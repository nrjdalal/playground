import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import {
  COMPOSER_ID,
  composerId,
  sendsOnEnter,
} from "../../../../../../web/next/src/components/dashboard/composer"

// React resolves from the web app's own packages, which this directory cannot see; the calls the test makes are typed here rather than through a path into node_modules.
type Node = unknown
type CreateElement = (type: unknown, props?: unknown, ...children: Node[]) => Node
const web = join(import.meta.dir, "../../../../../../web/next")
const { createElement } = (await import(Bun.resolveSync("react", web))) as {
  createElement: CreateElement
}
const { renderToStaticMarkup } = (await import(Bun.resolveSync("react-dom/server", web))) as {
  renderToStaticMarkup: (node: Node) => string
}

type Form = {
  getFieldValue: (name: "text") => string
  mount: () => void
  reset: (values?: { text: string }, opts?: { keepDefaultValues?: boolean }) => void
  update: (options: { defaultValues: { text: string } }) => void
}
const { FormApi } = (await import(Bun.resolveSync("@tanstack/react-form", web))) as {
  FormApi: new (options: { defaultValues: { text: string } }) => Form
}

const enter = (keys: Partial<Parameters<typeof sendsOnEnter>[0]> = {}) => ({
  ctrlKey: false,
  isComposing: false,
  key: "Enter",
  keyCode: 13,
  metaKey: false,
  shiftKey: false,
  ...keys,
})

describe("sendsOnEnter", () => {
  test("Enter sends and Shift+Enter adds a line", () => {
    expect(sendsOnEnter(enter())).toBe(true)
    expect(sendsOnEnter(enter({ shiftKey: true }))).toBe(false)
    expect(sendsOnEnter(enter({ key: "a", keyCode: 65 }))).toBe(false)
  })

  test("the Enter that commits an IME candidate sends nothing, Safari's keyCode 229 included", () => {
    expect(sendsOnEnter(enter({ isComposing: true }))).toBe(false)
    expect(sendsOnEnter(enter({ keyCode: 229 }))).toBe(false)
  })

  test("on a touch keyboard Enter adds a line, and Cmd or Ctrl+Enter still sends", () => {
    expect(sendsOnEnter(enter(), true)).toBe(false)
    expect(sendsOnEnter(enter({ metaKey: true }), true)).toBe(true)
    expect(sendsOnEnter(enter({ ctrlKey: true }), true)).toBe(true)
  })
})

// The composer's form starts from a restored draft as its defaults: a plain reset would put the draft back, and so would new defaults on the next render, so a send resets to empty while keeping the defaults it was made with.
describe("a send's reset", () => {
  test("empties the box and stays empty when the next render passes the same defaults", () => {
    const defaultValues = { text: "restored draft" }
    const form = new FormApi({ defaultValues })
    form.mount()
    form.reset({ text: "" }, { keepDefaultValues: true })
    form.update({ defaultValues })
    expect(form.getFieldValue("text")).toBe("")
  })

  test("a plain reset would put the restored draft back", () => {
    const form = new FormApi({ defaultValues: { text: "restored draft" } })
    form.mount()
    form.reset()
    expect(form.getFieldValue("text")).toBe("restored draft")
  })
})

describe("the composer's sources", () => {
  const read = (path: string) => Bun.file(join(web, "src/components", path)).text()

  // AI Elements' Prompt Input whole, an InputGroup in one form, with our sending, files and drafts behind it
  test("the composer is Prompt Input, still sending through the outbox with its own attachments", async () => {
    const composer = await read("dashboard/composer.tsx")
    expect(composer).toContain('from "@/components/ui/input-group"')
    expect(composer.match(/<form[\s>]/g)?.length).toBe(1)
    expect(composer).toContain('<InputGroup className="border-border">')
    expect(composer).toContain('<InputGroupAddon align="block-start"')
    expect(composer).toMatch(/<InputGroupAddon\s+align="block-end"/)
    expect(composer).toMatch(/<InputGroupButton\s[^>]*type="submit"/)
    expect(composer).toContain("aria-label={`Send to ${label}`}")
    expect(composer).toContain("outbox.send(worker.name")
    expect(composer).toContain("useAttachments(keep, saved?.attachments)")
    expect(composer).toContain("<AttachmentChips")
  })

  test("its box grows with what is typed up to 40% of the view, then scrolls", async () => {
    const box =
      (await read("dashboard/composer.tsx")).match(/<InputGroupTextarea[\s\S]*?\/>/)?.[0] ?? ""
    expect(box).toContain("field-sizing-content")
    expect(box).toContain("max-h-[40vh]")
    expect(box).toContain("overflow-y-auto")
    expect(box).not.toContain("field-sizing-fixed")
  })

  // a reviewer: the empty box is one line over 28px icon buttons, as tall as the music player, and the mode menu's label button keeps its own size
  test("it starts one line tall over 28px icon buttons, the mode menu left at its size", async () => {
    const composer = await read("dashboard/composer.tsx")
    expect(composer.match(/<InputGroupTextarea[\s\S]*?\/>/)?.[0]).toContain("rows={1}")
    const row =
      composer.match(/<InputGroupAddon\s+align="block-end"\s+className="([^"]*)"/)?.[1] ?? ""
    expect(row).toContain("[&_button[data-size=icon-sm]]:size-7")
    expect(row).not.toContain("[&_button]:")
  })

  // a tester: flush on the window's bottom edge, the stock box's rounded bottom and focus ring were cut
  test("it keeps 8px under its box, level with the music player, and on a phone 8px over the tab bar", async () => {
    const group =
      (await read("dashboard/composer.tsx")).match(/<FieldGroup className="([^"]*)"/)?.[1] ?? ""
    expect(group.split(" ")).toEqual(["mb-2"])
  })

  test("Enter sends through the form, after the / menu has had its keys", async () => {
    const composer = await read("dashboard/composer.tsx")
    const keys = composer.slice(composer.indexOf("const onKeyDown"))
    expect(keys.indexOf("if (onMenuKey(event)) return")).toBeLessThan(keys.indexOf("sendsOnEnter("))
    expect(keys).toContain("event.currentTarget.form?.requestSubmit()")
    expect(keys).toContain("}, touch)")
  })

  test("it starts from the session's saved draft, saves its own edits, and a send leaves an empty box", async () => {
    const composer = await read("dashboard/composer.tsx")
    expect(composer).toContain("readDrafts()[keep]")
    expect(composer).toContain("draftSaver(keep, saved)")
    expect(composer).toContain("save({ attachments: refs, text })")
    expect(composer).toContain('formApi.reset({ text: "" }, { keepDefaultValues: true })')
  })

  test("a thread's view keeps its own draft and files, apart from the full chat's", async () => {
    const composer = await read("dashboard/composer.tsx")
    expect(composer).toContain("const keep = threadId ? `${worker.name}#${threadId}` : worker.name")
  })

  // A click on Send left focus on the button, where a dictation app's next Cmd+V lands nowhere; bun run verify send-focus drives it in a browser
  test("a send puts the cursor back in the box, however it was sent", async () => {
    const composer = await read("dashboard/composer.tsx")
    const submit = composer.slice(composer.indexOf("onSubmit: ({ formApi, value })"))
    expect(submit.slice(0, submit.indexOf("  },\n  })"))).toContain("box.current?.focus()")
  })

  // review round 1: a refused send (an empty box, a trailing backslash, files still uploading) returns early, so a focus after the send would leave the cursor on the button there
  test("a refused send puts the cursor back in the box too", async () => {
    const composer = await read("dashboard/composer.tsx")
    const submit = composer.slice(composer.indexOf("onSubmit: ({ formApi, value })"))
    const focus = submit.indexOf("box.current?.focus()")
    expect(focus).toBeGreaterThan(-1)
    expect(focus).toBeLessThan(submit.indexOf("return"))
  })

  test("a send drops one trailing backslash, which Enter would take as a line continuation, and refuses one a drop leaves behind", async () => {
    const composer = await read("dashboard/composer.tsx")
    expect(composer).toContain("const words = submittable(value.text)")
    // judged on what the send would carry, so a lone backslash sends nothing
    expect(composer).toContain("text: withReply(words, picked, skills)")
    // the refusal judges the words as the typing will hold them, trimmed, so x\ \ is refused, not typed as x\
    expect(composer).toContain("comparable(words).endsWith")
  })

  // a dispatcher reads Alpha or Bravo, so its box reads Message Alpha
  test("its placeholder names the session as its chat does: a dispatcher by its label, never its name", async () => {
    const composer = await read("dashboard/composer.tsx")
    expect(composer).toContain("const label = chatLabel(worker, dispatcher)")
    expect(composer).toContain("`Message ${label}`")
    expect(composer).not.toContain("agentLabel(worker.name)")
  })

  test("its words are 14 (text-sm) from md up, never 12", async () => {
    const composer = await read("dashboard/composer.tsx")
    const box = composer.match(/<InputGroupTextarea[\s\S]*?\/>/)?.[0] ?? ""
    expect(box).toContain("id={id}")
    expect(box).not.toContain("text-xs")
    const { InputGroupTextarea } =
      await import("../../../../../../web/next/src/components/ui/input-group")
    const html = renderToStaticMarkup(
      createElement(InputGroupTextarea, { readOnly: true, value: "" }),
    )
    expect(html).toContain("md:text-sm")
    expect(html).not.toContain("text-xs")
  })

  // New thread is a circular icon button, the same size as Attach beside it
  test("New thread is Attach's round icon button, its on state filled apart from the box and from Send", async () => {
    const composer = await read("dashboard/composer.tsx")
    const button = (label: string) =>
      composer.match(
        new RegExp(`<InputGroupButton\\s+aria-label="${label}"[\\s\\S]*?</InputGroupButton>`),
      )?.[0] ?? ""
    const thread = button("New thread")
    expect(thread).toContain("aria-pressed={newThread}")
    expect(thread).toMatch(
      />\s*\{newThread \? <RiChatThreadFill \/> : <RiChatThreadLine \/>\}\s*<\/InputGroupButton>$/,
    )
    const { InputGroupButton } =
      await import("../../../../../../web/next/src/components/ui/input-group")
    const classes = (source: string, pressed?: boolean) => {
      const prop = (name: string) => source.match(new RegExp(`${name}="([^"]*)"`))?.[1]
      const props = {
        "aria-pressed": pressed,
        className: prop("className"),
        size: prop("size"),
        variant: prop("variant"),
      }
      return (
        renderToStaticMarkup(createElement(InputGroupButton, props))
          .match(/class="([^"]*)"/)?.[1]
          .split(" ") ?? []
      )
    }
    const attach = classes(button("Attach files"))
    const own = classes(thread, true)
    expect(attach).toEqual(expect.arrayContaining(["size-8", "rounded-full"]))
    expect(own).toEqual(expect.arrayContaining(attach))
    // the stock toggle's bg-muted reads as off on the box's own fill, and Send already wears bg-primary
    expect(own).toEqual(
      expect.arrayContaining(["aria-pressed:bg-input", "dark:aria-pressed:bg-input"]),
    )
  })

  test("its icons are Remix: no lucide icon", async () => {
    for (const path of ["dashboard/composer.tsx", "dashboard/mode-picker.tsx"]) {
      expect(await read(path)).not.toContain("lucide")
    }
  })
})

// Two boxes share a page once the aside holds Playground's chat beside a session's own, so each takes its own id, and an Inbox card's Chat about it finds Playground's by the bare one.
describe("composerId", () => {
  const dispatcher = { name: "dispatcher", role: "dispatcher" as const }
  test("Playground's own box keeps the bare id", () => {
    expect(composerId(dispatcher, "dispatcher")).toBe(COMPOSER_ID)
  })
  test("another session's box and the second dispatcher's take their name after it", () => {
    expect(composerId({ name: "worker-a", role: "worker" as const }, "dispatcher")).toBe(
      "composer-worker-a",
    )
    expect(composerId({ name: "dispatcher-2", role: "dispatcher" as const }, "dispatcher")).toBe(
      "composer-dispatcher-2",
    )
  })
  test("a thread's box takes its thread after the name, Playground's included", () => {
    expect(composerId(dispatcher, "dispatcher", "j5y2")).toBe("composer-dispatcher-j5y2")
  })
})
