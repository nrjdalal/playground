import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { check } from "../../../scripts/hooks/no-bare-slack-link"

const root = join(import.meta.dir, "..", "..", "..")
const script = join(root, "scripts", "hooks", "no-bare-slack-link.ts")
const PR = "https://github.com/acme/app/pull/12"
const CHANNEL = "C0EXAMPLE01"
const SIGNATURE = "_Sent via Playground_"

const input = (toolInput: Record<string, unknown>, tool = "mcp__slack-shared__chat_post_message") =>
  JSON.stringify({ hook_event_name: "PreToolUse", tool_input: toolInput, tool_name: tool })
const post = (toolInput: Record<string, unknown>, tool?: string) => check(input(toolInput, tool))
const chip = (url: string) => ({
  type: "link",
  url,
  text: url.replace("https://", ""),
  truncated: true,
})
const section = (...elements: Record<string, unknown>[]) => [
  { type: "rich_text", elements: [{ type: "rich_text_section", elements }] },
]
const chips = (...urls: string[]) =>
  section(...urls.flatMap((url) => [chip(url), { type: "text", text: "\n" }]))

describe("a post whose link is not a link chip is refused, with the fix", () => {
  test("a bare URL in text", () => {
    const reason = post({ channel: "C0EXAMPLE02", text: `Please review ${PR}` })
    expect(reason).toContain("no-bare-slack-link hook refused chat_post_message")
    expect(reason).toContain(PR)
    expect(reason).toContain(
      `{"type":"link","url":"${PR}","text":"github.com/acme/app/pull/12","truncated":true}`,
    )
    expect(reason).toContain("keep text as the plain fallback")
  })

  test("Slack's <url|label> form with no chip", () => {
    expect(post({ channel: "D1", text: `Please review <${PR}|#12>` })).toContain(PR)
  })

  test("a chip for one URL leaves the other refused", () => {
    const other = "https://github.com/acme/app/pull/13"
    const reason = post({ blocks: chips(PR), channel: "D1", text: `${PR}\n${other}` })
    expect(reason).toContain(other)
    expect(reason).not.toContain(`holds ${PR}`)
  })

  test("chat_update", () => {
    expect(
      post({ channel: "D1", text: `Updated: ${PR}`, ts: "1.2" }, "mcp__Slack__chat_update"),
    ).toContain("refused chat_update")
  })

  test("a bare URL in markdown_text, which can carry no chip, is refused with the fix", () => {
    const reason = post({ channel: "D1", markdown_text: `Please review ${PR}` })
    expect(reason).toContain(PR)
    expect(reason).toContain("keep text as the plain fallback")
    expect(reason).toContain("not markdown_text")
  })

  test("a bare URL in a block or attachment text field", () => {
    const section = [{ type: "section", text: { type: "mrkdwn", text: `See ${PR}` } }]
    expect(post({ blocks: section, channel: "D1", text: "See the PR" })).toContain(PR)
    expect(post({ attachments: [{ text: PR }], channel: "D1" })).toContain(PR)
  })

  test("a bare URL in an attachment's pretext or field value", () => {
    expect(post({ attachments: [{ pretext: PR }], channel: "D1" })).toContain(PR)
    expect(
      post({ attachments: [{ fields: [{ title: "PR", value: PR }] }], channel: "D1" }),
    ).toContain(PR)
  })

  test("a bare URL in an attachment's title, footer, author_name or fallback, its title_link aside", () => {
    for (const field of ["title", "footer", "author_name", "fallback"])
      expect(post({ attachments: [{ [field]: PR }], channel: "D1" })).toContain(PR)
    const linked = { image_url: PR, title: "The PR", title_link: PR }
    expect(post({ attachments: [linked], channel: "D1" })).toBeUndefined()
  })

  test("a link element with no text, with truncated missing or false, or with text not its URL", () => {
    const without = (name: string) =>
      Object.fromEntries(Object.entries(chip(PR)).filter(([k]) => k !== name))
    for (const element of [
      { type: "link", url: PR },
      without("text"),
      without("truncated"),
      { ...chip(PR), truncated: false },
      { ...chip(PR), text: "the PR" },
      { ...chip(PR), text: "github.com/acme/app/pull/13" },
    ]) {
      const reason = post({ blocks: section(element), channel: "D1", text: PR })
      expect(reason).toContain("with its text and truncated exactly as shown")
    }
  })

  test("a url-only link element beside words that name no URL, or with no text at all", () => {
    const bare = section({ type: "link", url: PR })
    expect(post({ blocks: bare, channel: "D1", text: "Please review the PR" })).toContain(PR)
    expect(post({ blocks: bare, channel: "D1" })).toContain(PR)
  })

  test("a chip whose path differs in case", () => {
    const upper = "https://x.io/ABC"
    expect(post({ blocks: chips(upper), channel: "D1", text: "https://x.io/abc" })).toContain(
      "https://x.io/abc",
    )
  })

  test("an uppercase scheme", () => {
    expect(post({ channel: "D1", text: "HTTPS://github.com/acme/app/pull/12" })).toContain(
      "HTTPS://github.com/acme/app/pull/12",
    )
  })

  test("a backticked URL with no chip, its suggested chip holding no backtick", () => {
    const reason = post({ channel: "D1", text: `Please review \`${PR}\`` })
    expect(reason).toContain(`"url":"${PR}"`)
    expect(reason).not.toContain("`")
  })

  test("a signed post to #dispatcher with a bare URL", () => {
    expect(post({ channel: CHANNEL, text: `Please review ${PR}\n${SIGNATURE}` })).toContain(PR)
  })

  test("blocks as a JSON string with no chip for the URL", () => {
    const blocks = JSON.stringify(chips("https://example.com/other"))
    expect(post({ blocks, channel: "D1", text: PR })).toContain(PR)
  })
})

describe("a post whose every link is a chip, or that a hook should not judge, passes", () => {
  test("a chip for every URL", () => {
    expect(post({ blocks: chips(PR), channel: "D1", text: `Please review ${PR}` })).toBeUndefined()
  })

  test("a chip whose URL carries another URL in its query", () => {
    const nested = "https://x.io/a?to=https://y.io/b"
    expect(post({ blocks: chips(nested), channel: "D1", text: nested })).toBeUndefined()
  })

  test("several chipped URLs in one post", () => {
    const other = "https://github.com/acme/app/pull/13"
    expect(
      post({ blocks: chips(PR, other), channel: "D1", text: `${PR}\n${other}` }),
    ).toBeUndefined()
  })

  test("chips nested in a rich_text_list", () => {
    const other = "https://github.com/acme/app/pull/13"
    const list = [
      {
        type: "rich_text",
        elements: [
          {
            type: "rich_text_list",
            style: "bullet",
            elements: chips(PR, other)[0].elements,
          },
        ],
      },
    ]
    expect(post({ blocks: list, channel: "D1", text: `${PR}\n${other}` })).toBeUndefined()
  })

  test("a chip whose scheme and host differ in case", () => {
    expect(
      post({ blocks: chips(PR), channel: "D1", text: "HTTPS://GitHub.com/acme/app/pull/12" }),
    ).toBeUndefined()
  })

  test("a chip in Slack's <url|label> form", () => {
    expect(post({ blocks: chips(PR), channel: "D1", text: `<${PR}|#12>` })).toBeUndefined()
  })

  test("a chip whose URL differs by a trailing slash", () => {
    expect(post({ blocks: chips(`${PR}/`), channel: "D1", text: `${PR}.` })).toBeUndefined()
  })

  test("blocks as a JSON string", () => {
    expect(post({ blocks: JSON.stringify(chips(PR)), channel: "D1", text: PR })).toBeUndefined()
  })

  test("a chipped URL in backticks, angle brackets or a label", () => {
    for (const text of [`\`${PR}\``, `<${PR}>`, `<${PR}|#12>`, `(${PR})~`, `{${PR}}`])
      expect(post({ blocks: chips(PR), channel: "D1", text })).toBeUndefined()
  })

  test("a chipped URL in markdown_text", () => {
    expect(post({ blocks: chips(PR), channel: "D1", markdown_text: PR })).toBeUndefined()
  })

  test("text with no URL", () => {
    expect(post({ channel: "D1", text: "Thanks for the review!" })).toBeUndefined()
  })

  test("a tool that is not Slack's", () => {
    expect(
      post({ channel: "D1", text: PR }, "mcp__github-shared__chat_post_message"),
    ).toBeUndefined()
    expect(post({ channel: "D1", text: PR }, "mcp__slack-shared__chat_delete")).toBeUndefined()
  })

  test("input it cannot read", () => {
    expect(check("not json")).toBeUndefined()
    expect(post({ blocks: "[not json", channel: "D1", text: PR })).toBeUndefined()
  })
})

test("the script exits 2 with the reason on stderr", async () => {
  const proc = Bun.spawn(["bun", "--no-env-file", script], {
    env: { ...process.env, PLAYGROUND_ROLE: "worker" },
    stderr: "pipe",
    stdin: new Blob([input({ channel: "D1", text: PR })]),
  })
  expect(await proc.exited).toBe(2)
  expect(await new Response(proc.stderr).text()).toContain("no-bare-slack-link hook refused")
})

test("a session outside the factory passes", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => k !== "PLAYGROUND_ROLE"),
  )
  const proc = Bun.spawn(["bun", "--no-env-file", script], {
    env,
    stderr: "pipe",
    stdin: new Blob([input({ channel: "D1", text: PR })]),
  })
  expect(await proc.exited).toBe(0)
})
