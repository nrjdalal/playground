import { describe, expect, test } from "bun:test"

import {
  isExcluded,
  plan,
  renamePath,
  renameText,
} from "../../../../../packages/scripts/src/rename/rules"
import { OLD } from "../../../../old-names"

describe("renameText", () => {
  test("renames the word in every case form, plurals included", () => {
    expect(renameText("the desk, The Desk, DESK, two desks")).toBe(
      "the dashboard, The Dashboard, DASHBOARD, two dashboards",
    )
  })

  test("renames camelCase and snake_case parts", () => {
    expect(renameText("deskSource() requireDeskWrite use_desk_x DeskRule")).toBe(
      "dashboardSource() requireDashboardWrite use_dashboard_x DashboardRule",
    )
  })

  test("leaves longer words alone", () => {
    expect(renameText("desktop Desktop DESKTOP helpdesk")).toBe("desktop Desktop DESKTOP helpdesk")
  })

  test("renames paths", () => {
    expect(renameText('import { x } from "@/lib/desk/fixture"')).toBe(
      'import { x } from "@/lib/dashboard/fixture"',
    )
  })

  test("moves the dashboard's routes under /api/v1", () => {
    expect(
      renameText(
        'fetch("/api/desk/workers"); "/api/desk"; `${api}/api/inbox/i1` /api/sessions /api/apps',
      ),
    ).toBe(
      'fetch("/api/v1/workers"); "/api/v1"; `${api}/api/v1/inbox/i1` /api/v1/sessions /api/v1/apps',
    )
    expect(
      renameText(
        "apiClient.desk.workers.$get() apiClient.inbox[':id'] apiClient.apps.plan (typeof apiClient.sessions)",
      ),
    ).toBe(
      "apiClient.v1.workers.$get() apiClient.v1.inbox[':id'] apiClient.v1.apps.plan (typeof apiClient.v1.sessions)",
    )
  })

  test("leaves the routes that stay outside /api/v1", () => {
    const text = "/api/auth /api/agents/sign-in-as /api/openapi.json /api/v1/user /api/inboxes"
    expect(renameText(text)).toBe(text)
  })

  test(`renames DESK_ and ${OLD.dispatcher.toUpperCase()}_ env names to PLAYGROUND_`, () => {
    expect(
      renameText(
        `process.env.DESK_FIXTURE \${${OLD.dispatcher.toUpperCase()}_ROLE:-} DESK_HERDR_<x>`,
      ),
    ).toBe("process.env.PLAYGROUND_FIXTURE ${PLAYGROUND_ROLE:-} PLAYGROUND_HERDR_<x>")
  })

  test("leaves an env wildcard that names the old names", () => {
    expect(renameText(`"DESK_*", "${OLD.dispatcher.toUpperCase()}_*"`)).toBe(
      `"DESK_*", "${OLD.dispatcher.toUpperCase()}_*"`,
    )
  })

  test("renames a DESK_ constant by the word rule", () => {
    expect(renameText("DESK_MAP DESK_RULES SOME_DESK_THING")).toBe(
      "DASHBOARD_MAP DASHBOARD_RULES SOME_DASHBOARD_THING",
    )
  })

  test("keeps an old env name on a line that already reads its new one", () => {
    const line = `os.environ.get("PLAYGROUND_REPO") or os.environ.get("${OLD.dispatcher.toUpperCase()}_REPO")`
    expect(renameText(line)).toBe(line)
    expect(renameText(String.raw`"playground-a-db\nlightman-b-db"`)).toBe(
      String.raw`"playground-a-db\nplayground-b-db"`,
    )
  })

  test("moves a reference to a collision path to its mapped path", () => {
    expect(renameText('from "@/components/desk/sidebar"')).toBe(
      'from "@/components/dashboard/app-sidebar"',
    )
    expect(renameText("web/next/src/components/desk/sidebar.tsx")).toBe(
      "web/next/src/components/dashboard/app-sidebar.tsx",
    )
  })

  test("renames the product's name and the identifiers that name it", () => {
    expect(renameText("_Sent via LightMan_, two LightMans")).toBe(
      "_Sent via Playground_, two Playgrounds",
    )
    expect(
      renameText(`~/.claude/${OLD.dispatcher}/roster.json and $HOME/.claude/${OLD.dispatcher}`),
    ).toBe("~/.playground/roster.json and $HOME/.playground")
    expect(
      renameText(
        `join(home, ".claude", "${OLD.dispatcher}") and os.path.join(h, '.claude', '${OLD.dispatcher}')`,
      ),
    ).toBe("join(home, \".playground\") and os.path.join(h, '.playground')")
    expect(
      renameText(
        `docker rm -fv ${OLD.dispatcher}-<worktree>-db ${OLD.dispatcher}-db ${OLD.dispatcher}-a-redis`,
      ),
    ).toBe("docker rm -fv playground-<worktree>-db playground-db playground-a-redis")
    expect(
      renameText(`https://desk.api.${OLD.dispatcher}.localhost com.${OLD.dispatcher}.ops-awake`),
    ).toBe("https://desk.api.playground.localhost com.playground.ops-awake")
    expect(renameText(`bunx portless get api.${OLD.dispatcher}`)).toBe(
      "bunx portless get api.playground",
    )
    expect(
      renameText(
        `skills/playground/${OLD.dispatcher}-factory/SKILL.md no-${OLD.dispatcher}-leak.ts`,
      ),
    ).toBe("skills/playground/playground-factory/SKILL.md no-playground-leak.ts")
    expect(
      renameText(
        `\`${OLD.dispatcher} page <path>\`, \`${OLD.dispatcher} --help\`, "../${OLD.dispatcher}/probe"`,
      ),
    ).toBe('`playground page <path>`, `playground --help`, "../playground/probe"')
  })

  test("leaves a session's name, the repo and the checkout as they are", () => {
    const text = `to: ${OLD.dispatcher}; acme/archive; ~/acme/archive; "name": "${OLD.dispatcher}"; ${OLD.dispatcher}-2`
    expect(renameText(text)).toBe(text)
  })

  test("keeps an old name on a line that already holds its new one", () => {
    const line = "/_?Sent via (LightMan|Playground)_?$/"
    expect(renameText(line)).toBe(line)
  })

  test("takes only the rules named", () => {
    const text = `DESK_FIXTURE in the desk at ~/.claude/${OLD.dispatcher}, DESK_MAP`
    expect(renameText(text, new Set(["env"]))).toBe(
      `PLAYGROUND_FIXTURE in the desk at ~/.claude/${OLD.dispatcher}, DESK_MAP`,
    )
    expect(renameText(text, new Set(["word"]))).toBe(
      `DESK_FIXTURE in the dashboard at ~/.claude/${OLD.dispatcher}, DASHBOARD_MAP`,
    )
    expect(renameText(text, new Set(["product"]))).toBe(
      "DESK_FIXTURE in the desk at ~/.playground, DESK_MAP",
    )
  })

  // The live names (LIVE_NAMES): the guards on the live database and checkout, the ops-desk job jobs.json runs and the state it keeps, the owner's stored drafts and choices, and the desk:* scripts the verbs step renames.
  test("keeps the names a running machine already holds", () => {
    const kept = [
      `database: "${OLD.dispatcher}-desk-db"`,
      'branch: "live/desk"',
      String.raw`/^branch refs\/heads\/live\/desk$/m`,
      "~/acme/archive/.claude/worktrees/desk/packages",
      `https://desk.api.playground.localhost and desk.${OLD.dispatcher}.localhost`,
      "its own `desk.`-prefixed names",
      'join(main, ".claude", "worktrees", "desk") and where in ("canary", "desk")',
      String.raw`"\${STUB_BRANCH:-live/desk}" "a-db\nlightman-desk-db\n"`,
    ]
    for (const line of kept) expect(renameText(line)).toBe(line)
    // the ops job, its files and processes, the stored names and the old script names move now, their old names read by fallbacks or moved by the switch's migration
    const moved: [string, string][] = [
      [
        String.raw`/ops\/desk\/run\.sh/ /desk\.message/`,
        String.raw`/ops\/dashboard\/run\.sh/ /dashboard\.message/`,
      ],
      [
        'join(ops, "ops-desk.json") and job.stop === "desk"',
        'join(ops, "ops-dashboard.json") and job.stop === "dashboard"',
      ],
      [
        "$S/desk-dev.pid, procs.sh stop desk-ingest, desk-db",
        "$S/dashboard-dev.pid, procs.sh stop dashboard-ingest, dashboard-db",
      ],
      ['"desk.composer" and bun run desk:ask', '"dashboard.composer" and bun run dashboard:ask'],
    ]
    for (const [line, renamed] of moved) expect(renameText(line)).toBe(renamed)
    expect(renamePath("scripts/ops/desk/supervisor.sh")).toBe("scripts/ops/dashboard/supervisor.sh")
    expect(
      renameText(
        `LIVE_DESK = { branch: "live/desk", database: "${OLD.dispatcher}-desk-db" } on the desk`,
      ),
    ).toBe(
      `LIVE_DASHBOARD = { branch: "live/desk", database: "${OLD.dispatcher}-desk-db" } on the dashboard`,
    )
  })

  test("keeps an old data folder, bin or label on a line that already names its new one", () => {
    const line = `[ -d "$HOME/.claude/${OLD.dispatcher}" ] && ln -s "$HOME/.claude/${OLD.dispatcher}" "$HOME/.playground"; com.playground.ops-awake com.${OLD.dispatcher}.ops-awake`
    expect(renameText(line)).toBe(line)
  })

  test("reads a name after an escape like \\n as a word's start", () => {
    expect(
      renameText(String.raw`"${OLD.dispatcher}-a-db\n${OLD.dispatcher}-b-db\ndesk\tDESK_FIXTURE"`),
    ).toBe(String.raw`"playground-a-db\nplayground-b-db\ndashboard\tPLAYGROUND_FIXTURE"`)
  })

  test("moves a collision path's references only where the path ends", () => {
    expect(
      renameText('from "@/components/desk/sidebar" and "components/desk/sidebar-footer.test.ts"'),
    ).toBe(
      'from "@/components/dashboard/app-sidebar" and "components/dashboard/sidebar-footer.test.ts"',
    )
  })

  test("a second run changes nothing", () => {
    const text = [
      `the desk at /api/desk/ws and /api/inbox reads DESK_LIVE_READS and ${OLD.dispatcher.toUpperCase()}_ROLE`,
      "apiClient.desk.ws apiClient.sessions.$get",
      'import { DeskView } from "@/components/desk/desk-view"',
      'from "@/components/desk/sidebar"',
      `os.environ.get("${OLD.dispatcher.toUpperCase()}_REPO")`,
      "LightMan at ~/.claude/lightman, lightman-desk-db, `lightman page`",
    ].join("\n")
    const once = renameText(text)
    expect(renameText(once)).toBe(once)
  })
})

describe("renamePath", () => {
  test("renames each segment", () => {
    expect(renamePath("api/hono/src/lib/desk/desk-map.json")).toBe(
      "api/hono/src/lib/dashboard/dashboard-map.json",
    )
    expect(renamePath(".agents/desk/stack.md")).toBe(".agents/dashboard/stack.md")
    expect(renamePath(`packages/scripts/src/${OLD.dispatcher}/cli.ts`)).toBe(
      "packages/scripts/src/playground/cli.ts",
    )
    expect(renamePath(`scripts/hooks/no-${OLD.dispatcher}-leak.ts`)).toBe(
      "scripts/hooks/no-playground-leak.ts",
    )
    expect(renamePath(`docs/playground/${OLD.dispatcher}-factory.md`)).toBe(
      "docs/playground/playground-factory.md",
    )
  })

  test("maps the two known collisions", () => {
    expect(renamePath("web/next/src/components/desk/sidebar.tsx")).toBe(
      "web/next/src/components/dashboard/app-sidebar.tsx",
    )
    expect(renamePath("tests/web/next/src/components/desk/sidebar.test.ts")).toBe(
      "tests/web/next/src/components/dashboard/app-sidebar.test.ts",
    )
  })
})

describe("plan", () => {
  test("refuses a move onto a tracked path", () => {
    const result = plan([
      { path: "a/desk/x.ts", text: "" },
      { path: "a/dashboard/x.ts", text: "" },
    ])
    expect(result.collisions).toEqual(["a/desk/x.ts -> a/dashboard/x.ts"])
  })

  test("lists moves and edits, and skips excluded files", () => {
    const result = plan([
      { path: "lib/desk.ts", text: "export const desk = 1" },
      { path: "CHANGELOG.md", text: "the desk" },
      { path: "logo.png", text: null },
    ])
    expect(result.moves).toEqual([{ from: "lib/desk.ts", to: "lib/dashboard.ts" }])
    expect(result.edits).toEqual([{ path: "lib/desk.ts", text: "export const dashboard = 1" }])
    expect(result.collisions).toEqual([])
  })

  test("renames a package's name only in its package.json", () => {
    const result = plan([
      { path: "package.json", text: `{ "name": "${OLD.dispatcher}" }` },
      { path: "api/hono/src/fixtures/desk.json", text: `{ "name": "${OLD.dispatcher}" }` },
    ])
    expect(result.edits).toEqual([{ path: "package.json", text: '{ "name": "playground" }' }])
  })

  test("excludes history, lockfiles, migrations, vendored skills and itself", () => {
    for (const path of [
      "CHANGELOG.md",
      ".github/notes/plans/x.md",
      "bun.lock",
      "packages/db/drizzle/0001_x.sql",
      ".agents/skills/portless/SKILL.md",
      "skills/zerostarter/portless/SKILL.md",
      "packages/scripts/src/rename/rules.ts",
      "extensions/core/lists/playground-terms.json",
    ])
      expect(isExcluded(path)).toBe(true)
    expect(isExcluded("api/hono/src/lib/desk/fixture.ts")).toBe(false)
  })
})
