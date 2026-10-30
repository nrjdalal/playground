import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { site } from "../../../../packages/config/src/site"
import { dataDir } from "../../../../packages/env/src/data-dir"
import { ownerSettings } from "../../../../packages/settings/src/owner"
import { readPolicy } from "../../../../packages/settings/src/rendered"
import { OLD } from "../../../old-names"

const REPO = join(import.meta.dir, "../../../..")

// Names that keep the old word for now (the UI says Dashboard; routes and commands may stay): API paths (an old one alone, as old-paths.ts mounts it, included), the desk.* names stored before the rename (activity ids and browser keys), module paths (by alias or relative), the live desk's branch, the fixture's folder and the page's `data-desk-page` attribute.
const NAMES = [
  /\/api\/desk[\w/:.-]*/gi,
  /^\/desk$/g,
  /\bdesk\.[a-z]+\b/g,
  /@\/(?:components|lib|routers|middlewares)\/[\w/.-]*desk[\w/.-]*/g,
  /(?:\.\.?\/)+(?:[\w-]+\/)*desk\/[\w/.-]*/g,
  /\blive\/desk\b/g,
  /\bdesk-fixture\b/g,
  /\bdata-desk-page\b/g,
]

// Code that names things rather than saying them, cut out before any copy is read, each only where it lives: in the API, a router's mount path and the API reference's tags; in the web app, a react-query key.
const API_NAMING = [/\.route\(\s*"\/[\w-]+"/g, /\btags:\s*\[[^\]]*\]/g]
const WEB_NAMING = [/\b[A-Z_]+_QUERY_KEY\s*=\s*\[[^\]]*\]/g]

// Where copy a person reads is written: the web app's own code, and the API, whose refusals and errors the web shows as they are. The API's bin/ scripts, and the dev launcher's lib/dev/ checks they print, go to a terminal, not the app, so they are left out.
const SOURCES = [
  {
    dir: "web/next/src",
    glob: "**/*.{ts,tsx}",
    naming: WEB_NAMING,
    skip: (file: string) => file.startsWith("components/ui/"),
  },
  {
    dir: "api/hono/src",
    glob: "**/*.ts",
    naming: API_NAMING,
    skip: (file: string) => file.startsWith("bin/") || file.startsWith("lib/dev/"),
  },
]

const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1")

// A regex literal where an expression starts, which can hold a quote or a backtick that would pair with the next string's.
const REGEX_LITERAL =
  /(?<=[=(,:?&|!]\s*|\breturn\s+)\/(?![/*])(?:[^/\\\n[]|\\.|\[(?:[^\]\\\n]|\\.)*\])+\/[dgimsuvy]*/g

// Every string literal, and in a .tsx file every run of JSX text with its {expressions} taken out.
const copyIn = (text: string, naming: RegExp[], jsx: boolean): string[] => {
  const code = naming.reduce(
    (rest, name) => rest.replace(name, ""),
    stripComments(text).replace(REGEX_LITERAL, "/regex/"),
  )
  const strings = [
    ...code.matchAll(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g),
  ].map(([literal]) => literal.slice(1, -1))
  const jsxText = jsx
    ? [...code.matchAll(/>([^<>]*)</g)].map(([, inner]) =>
        (inner ?? "").replace(/\{[^{}]*\}/g, " "),
      )
    : []
  return [...strings, ...jsxText]
}

const saysDesk = (copy: string) =>
  /\bdesk\b/i.test(NAMES.reduce((rest, name) => rest.replace(name, ""), copy.trim()))

// The product is spelled Playground: any other casing is a misspelling, and so is the lowercase handle used as a word in a sentence; a handle on its own (`OLD.dispatcher`), or inside a host, a path, a key or a command, is a name.
const misspellsPlayground = (copy: string) => {
  const prose = copy
    .replace(new RegExp(String.raw`-{1,2}\w+[ =]${OLD.dispatcher}\b`, "g"), "")
    .trim()
  return (
    new RegExp(String.raw`\b${OLD.dispatcher}\b`, "i").test(
      prose.replace(new RegExp(String.raw`\bPlayground\b|\b${OLD.dispatcher}\b`, "g"), ""),
    ) ||
    (/\s/.test(prose) &&
      new RegExp(
        String.raw`(?:^|[\s(])${OLD.dispatcher}(?:'s|&apos;s)?(?=[\s),;!?]|[.:]?$|\.\s)`,
      ).test(prose))
  )
}

// The owner's names come from the data folder's owner.names at run time, so this file holds none.
const policy = await readPolicy(dataDir())
const OWNER_NAMES = policy.settings ? ownerSettings.get(policy.settings, "owner.names") : []
if (OWNER_NAMES.length === 0)
  console.warn("ui-copy: owner.names is unset, so the name scan reads no owner name")

// The app speaks to you, the signed-in owner, so anyone can run it: copy names no person, no org and no factory role, and takes the product's name from site.ts.
const namesOf = (owner: string[]) => {
  const name = ["Acme", ...owner.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))].join("|")
  const re = new RegExp(
    `(?<!\\w)(?:${name})(?!\\w)|\\blight(?:boy|kid|man)\\b|\\b(?:probe|reviewer|runner|tester|worker)-(?:<|&lt;)`,
    "i",
  )
  const oldKey = new RegExp(String.raw`\b${OLD.dispatcher}:[\w-]+`, "g")
  return (copy: string) => re.test(copy.replace(oldKey, ""))
}
const namesSomeone = namesOf(OWNER_NAMES)

// Copy that another slice of the rename rewrites, held here until that slice deletes its lines: a hit in the file that holds the words. A later slice moves the data folder.
const LATER_SLICES: [slice: string, file: string, words: string][] = []

const heldForLater = (file: string, copy: string) =>
  LATER_SLICES.some(([, path, words]) => path === file && copy.includes(words))

describe("UI copy", () => {
  test("no page or component names a person, the org or a factory role", async () => {
    const hits = new Set<string>()
    const held = new Set<string>()
    for await (const file of new Bun.Glob("**/*.{ts,tsx}").scan({
      cwd: join(REPO, "web/next/src"),
    })) {
      if (file.startsWith("components/ui/")) continue
      const text = await Bun.file(join(REPO, "web/next/src", file)).text()
      for (const copy of copyIn(text, WEB_NAMING, file.endsWith(".tsx")))
        if (!namesSomeone(copy)) continue
        else if (heldForLater(file, copy)) held.add(`${file}: ${copy}`)
        else hits.add(`${file}: ${copy.trim().replace(/\s+/g, " ")}`)
    }
    expect([...hits]).toEqual([])
    // A held line its slice rewrote holds nothing now, so its entry goes with it.
    const stale = LATER_SLICES.filter(
      ([, file, words]) =>
        ![...held].some((hit) => hit.startsWith(`${file}: `) && hit.includes(words)),
    )
    expect(stale).toEqual([])
  })

  test("the name scan tells copy from a name", () => {
    const scan = namesOf(["quilla"])
    const named = [
      `<p>Templates arrive by a PR to LightMan.</p>`,
      `const why = "Ask ${OLD.builder} first"`,
      `<p>LightBoy's loop writes it</p>`,
      `const owner = "For Quilla"`,
      `<p>Skills for Acme work</p>`,
      `<p>Review is the reviewer-&lt;sin&gt; sessions' calls</p>`,
      `const role = "a worker-<sin> session"`,
      "const CODE = /`([^`]+)`/g\nconst line = `Quilla: ${action}`",
    ]
    for (const sample of named) expect(copyIn(sample, WEB_NAMING, true).some(scan)).toBe(true)
    const names = [
      `const key = "${OLD.dispatcher}:linear-view"`,
      `<p>Ask your build lead.</p>`,
      `const cls = "group/worker-row"`,
    ]
    for (const sample of names) expect(copyIn(sample, WEB_NAMING, true).some(scan)).toBe(false)
  })

  test("no page, component or API message a person reads says desk", async () => {
    const hits: string[] = []
    for (const { dir, glob, naming, skip } of SOURCES) {
      for await (const file of new Bun.Glob(glob).scan({
        cwd: join(REPO, dir),
      })) {
        if (skip(file)) continue
        const text = await Bun.file(join(REPO, dir, file)).text()
        for (const copy of copyIn(text, naming, file.endsWith(".tsx")))
          if (saysDesk(copy)) hits.push(`${dir}/${file}: ${copy.trim()}`)
      }
    }
    expect(hits).toEqual([])
  })

  test("no page, component or API message a person reads spells Playground any other way", async () => {
    const hits: string[] = []
    for (const { dir, glob, naming, skip } of SOURCES) {
      for await (const file of new Bun.Glob(glob).scan({
        cwd: join(REPO, dir),
      })) {
        if (skip(file)) continue
        const text = await Bun.file(join(REPO, dir, file)).text()
        for (const copy of copyIn(text, naming, file.endsWith(".tsx")))
          if (misspellsPlayground(copy)) hits.push(`${dir}/${file}: ${copy.trim()}`)
      }
    }
    expect(hits).toEqual([])
    expect(site.name).toBe("Playground")
    for (const copy of [site.description, site.tagline])
      expect(misspellsPlayground(copy)).toBe(false)
  })

  test("the Playground scan tells a misspelling from a name", () => {
    const misspelt = [
      `<p>Lightman is live</p>`,
      `const title = "Sessions are for ${OLD.dispatcher}'s owner"`,
      `<p>No session runs, and ${OLD.dispatcher}&apos;s roster lists no one.</p>`,
      `<p>Templates arrive by a PR to ${OLD.dispatcher}.</p>`,
      `const why = "Ask ${OLD.dispatcher} first"`,
      `const shout = "${OLD.dispatcher.toUpperCase()}"`,
    ]
    for (const sample of misspelt)
      expect(copyIn(sample, WEB_NAMING, true).some(misspellsPlayground)).toBe(true)
    const names = [
      `const DISPATCHER = "${OLD.dispatcher}"`,
      `const key = "${OLD.dispatcher}:linear-view"`,
      `const url = "https://playground.localhost"`,
      `const repo = "acme/archive"`,
      `const run = "claude -n ${OLD.dispatcher}"`,
      `<p>Playground's roster lists no one.</p>`,
    ]
    for (const sample of names)
      expect(copyIn(sample, WEB_NAMING, true).some(misspellsPlayground)).toBe(false)
  })

  test("the site's own description and tagline do not say desk", () => {
    expect(`${site.description} ${site.tagline}`).not.toMatch(/\bdesk\b/i)
  })

  test("the scan finds desk where it hides: beside an expression, in a constant, a template, a single-quoted prop, a toast, or naming code outside the app that names with it", () => {
    const web = [
      `<p>Answer it in {name}'s terminal: the desk does not answer</p>`,
      `const DESCRIPTION = "Every session on the desk"`,
      "const why = `The desk cannot read ${x}`",
      `<Empty title='The desk is empty' />`,
      `toast.add({ title: "Sent from the desk" })`,
      `<span>{ok ? "Live" : "Desk down"}</span>`,
      `<span>Desk</span>`,
      `<SidebarMenuButton tooltip="Desk">`,
      `<PageHeader title="Desk" />`,
      `const key = ["desk", "workers"]`,
      `const post = { tags: ["Desk tips"] }`,
    ]
    for (const sample of web) expect(copyIn(sample, WEB_NAMING, true).some(saysDesk)).toBe(true)
    const api = [`app.route("/desk", router).get("/", (c) => c.text("desk"))`]
    for (const sample of api) expect(copyIn(sample, API_NAMING, false).some(saysDesk)).toBe(true)
  })

  test("names that keep the word are not copy", () => {
    const web = [
      `fetch("/api/v1/workers")`,
      `import { useDesk } from "@/components/desk/desk"`,
      `const action = "desk.message"`,
      `import { configDir } from "../desk/fixture"`,
      `const branch = "live/desk"`,
      `join(root, ".turbo", "desk-fixture")`,
      `export const AGENTS_QUERY_KEY = ["desk", "agents"] as const`,
    ]
    for (const sample of web) expect(copyIn(sample, WEB_NAMING, true).some(saysDesk)).toBe(false)
    const api = [
      `describeRoute({ tags: ["Desk"], summary: "Sessions" })`,
      `.route("/desk", deskRouter)`,
    ]
    for (const sample of api) expect(copyIn(sample, API_NAMING, false).some(saysDesk)).toBe(false)
  })
})
