import "@packages/env/aliases"
import { mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"

import { withPortlessCa } from "../portless-ca"
import { asideBar } from "./aside-bar"
import { changelogEntry } from "./changelog-entry"
import {
  Browser,
  checkPage,
  cls,
  clsChat,
  CLS_NO_ROSTER_ROUTES,
  CLS_ROUTES,
  cursor,
  dashboardSocket,
  ended,
  fixtureOnly,
  health,
  type Label,
  LABELS,
  map,
  problems,
  readCheck,
  readOnlyChat,
  resolveExpectation,
  type Result,
  screenshot,
  SHOT_VIEWPORTS,
  signIn,
  signOut,
  strayRoutes,
  system,
  type Target,
  THEMES,
  VIEWPORTS,
} from "./checks"
import { NO_ROSTER_SCRIPT, OBSERVER_SCRIPT, SECOND_DOWN_SCRIPT } from "./cls-observer"
import { EXTENSION_NODE_SCRIPT, extensionNode } from "./extension-node"
import { facets } from "./facets"
import { FOCUS_PAGES, focusMarksPage } from "./focus-marks"
import { DASHBOARD_MAP } from "./map"
import { RAIL_PAGES, rail } from "./rail"
import { replyFocus } from "./reply-focus"
import { rowsFit } from "./row-fit"
import { sendFocus } from "./send-focus"
import { sendTop } from "./send-top"
import { slashMenu } from "./slash-menu"
import { tooltips } from "./tooltips"
import { TYPING_LAG_SCRIPT, typingLag } from "./typing-lag"
import { uploadKeep } from "./upload-keep"

await withPortlessCa()

const USAGE = `Usage: bun run verify [check] [route...] [options]

Checks (default: all)
  aside-bar     on /dashboard at 1440x900, the Inbox, Pages and each app pane, each scrolled
                to its end, keep their last line above the tab bar floating over the aside's
                bottom, and no layer of a pane paints over it; at 390x844 that bar, in its own row, holds Menu as its last square and clears
                the composer; at both, every square has a name and Tab reaches the bar before
                the panes
  health        /api/health answers ok and reports the expected version
  problems      /api/health flags nothing: today, a database it cannot reach, named with
                the route's own error
  signin        the agent sign-in works and /api/v1/user is LocalAgent
  ws            the dashboard's WebSocket sends a well-formed workers frame
  system        the machine's room for more workers, idle dev stacks, the usage windows and
                what did not read, as the Dashboard's System panel shows them: what a lead
                reads before it spawns
  ended <name>  the session reads Ended as the Dashboard shows it: the roster's ended and no
                live session of its name (a herdr session's included), failing while live
                sessions or a herdr server could not be read; what a lead outside herdr
                reads to confirm a herdr session's end
  pages         each route stays on its route, shows the dashboard map's heading (on /dashboard,
                the label of the dispatcher the API names), logs no error, draws only mapped
                sidebar groups and has no sideways scroll at 1280
  extension-node
                each route at 1280 loads with a screen recorder extension's node in body, a div
                with a shadow root as Scrnli adds it while the page streams, after the theme
                script, and Next's dev overlay counts no issue
  reply-focus   on /dashboard at 1280x800, Chat about it on an Inbox card puts focus in Playground's
                box in the click's own frame, so a paste sent at once lands there; it posts the
                card into this checkout's database with bun run ask and settles it after, so it
                needs a fixture stack whose database is this checkout's own (all skips it on
                any other)
  send-focus    on /dashboard at 1280x800, a real click on Send leaves focus in Playground's box
                0.5s after a send it refuses (a trailing backslash) and 0.5, 2 and 6s after one
                it sends, so a dictation app's paste then lands there; it sends one message to
                the fixture's session, so only on a fixture stack
  typing-lag    on /dashboard at 1280x800, types a sentence into Playground's box while a workers
                frame of 20 sessions arrives each second and a peer's transcript grows ten lines a
                second, and fails when the page's own work on a key (the wait for the main
                thread, its handlers and its frame's render) runs past 50ms at the 95th
                percentile (RAIL), reporting keydown to paint beside it unjudged; it writes into
                the fixture's transcripts and empties the box after, so only on this checkout's
                own fixture stack
  rows          on /dashboard, at the stock sidebar width and at 11rem, every menu row above
                the footer is 32px, every row's and member row's words fit its box and none
                runs past its padded edge, no first-line label ends in an ellipsis at the
                stock width, and no row covers another, so a row never grows or draws over
                its neighbours
  screenshots   each route, full page, at 1280x800, 1782x972 and 390x844, light then dark
                (named -dark), named before-* or after-* by --label; only on a stack whose
                /api/health reports dashboard: fixture, since any other shows live sessions
  cls           each route loads cold (storage, page cookies and HTTP cache cleared) then warm
                with no layout shift over 0.001 that input did not cause, naming each element
                that moved; with /dashboard, a chat view with no composer loads too, and the
                chat's Checkpoint bar moves nothing as it turns Reading, shows and hides Scroll
                to end, jumps up and turns Watching; /dashboard/system loads again as a stack
                with no roster file shows it, and each route again with the second dispatcher
                on the roster but down; only on a fixture stack (all skips it on any other)
  facets        on the Changelog page at 1280x800 and 390x844, every faceted filter's
                counts end at one x, a right-aligned column; it opens each and picks nothing
  focus-marks   on each dashboard page at 1280, every focusable control focused as a key would
                shows it with no ring: a lit border or a fill; it names each that
                shows nothing; not in all
  map           the dashboard map matches the code: its pages, sidebar groups and API routes, and
                each page's shows is a list with no empty entry, sorted A to Z
  cursor        on /dashboard at 1280, Send and Attach show the pointer, a plain disabled button
                not-allowed, and the sidebar rail keeps its resize cursor; with no live
                dispatcher it skips Send and Attach and says so
  rail          on /dashboard and /docs at 1280, a click on the sidebar rail collapses the
                sidebar, a second click on the collapsed rail expands it, and Cmd+B does both
  send-top      where a second dispatcher is live, its chat's composer reads Message and the
                chat's heading, its model and no session name, and a send there is Delivered;
                the stream starts at the page's top edge; in each of the chat's two modes
                at 1280x800 and 390x844. Reading: a message sent from Playground's chat
                rests 12px below its top with nothing of the step before showing, to an idle
                session once Delivered, showing Scroll to end in no frame of it, and a second
                one while it waits Queued and once Delivered; the up arrow rests his previous
                message there too; rows landing above his queued send leave it at rest; his
                scroll up 150ms after a send, by wheel or by a scrollbar drag longer than his
                hand's window, leaves the view where he put it for 3s; a view
                he scrolls away stays put, the reply included, as does one he pages up with a
                row's button focused; his send keeps the top through a reply, and holds its rest
                every frame through a peer message and a reply past the screen; his scroll up,
                then a peer message and rows, leaves the view where he put it; Scroll to end
                stays Reading, the view held and the toggle counting what lands below; his send
                holds its rest within 2px every frame as the status line comes and goes, and
                keeps the top as a turn ends past the screen or with its status line
                mid-screen; his wheel down after his send, then a row, leaves the view where he
                put it; a turn grown past the screen by tool rows, his wheel mid-turn, leaves
                only 36px under its last row. Watching: a click turns it on, a send lands at the
                end, a long turn reads behind and then Watching with the view at the end, never
                moving up on its own, his scroll up just after a send turns Reading and nothing
                moves the view down for 3s, his scroll up turns Reading, his own scroll back to the end
                turns Watching, and Scroll to end while behind jumps to live and stays Watching.
                After the first send it writes an earlier turn of
                420 tool calls into the session, past the stream's 400-entry limit as Playground's
                live one always is, and fails when the stream never shows it, or when a tool
                row he opens in it closes as new steps push its oldest out; Load older then
                pages back to that turn's prompt, the row he opened still open.
                It types into the fixture's dispatcher, writes its reply into this checkout's
                fixture and fills this checkout's database with one plain bun run ingest, so it
                needs a fixture stack whose database is this checkout's own (with --web and
                --api, the reply checks skip)
  changelog-entry
                at 390x844, a Changelog link naming a merge older than its newest change
                (?entry=pr-209) opens the phone's drawer on that change at first load, and Escape
                closes it and drops ?entry= from the URL; it needs such a merge (on a fixture
                stack, run bun run changelog fixture first)
  slash-menu    on /dashboard at 1280x800 and 390x844, / in Playground's box opens a menu at most
                7 rows tall, its rows one height, that scrolls inside itself, never runs past
                the composer's edges, and keeps the skill the arrows reach whole in it, after
                ArrowDown to the last skill, once more back to the first, and with a / typed
                mid-line near the box's right edge; it closes the menu and empties the box,
                sending nothing; only on a fixture stack, whose skills overflow it (all skips
                it on any other)
  tooltips      every page in the dashboard map at 1280 leaves no browser title box (an element's
                title but a frame's, or an svg <title>, that has words), and on /dashboard
                the dispatcher's usage tooltip opens on hover after the shared delay
                (TOOLTIP_DELAY_MS, 1s) and within 300ms of it, and the GitHub icon's on
                Tab within 300ms
  upload-keep   on /dashboard at 1280x800, an image pasted into Playground's box while its upload
                gets no answer (the route refused at the browser, as while the API restarts)
                keeps its chip, keeps it through a reload, and uploads once the route answers;
                it removes the chip after, sending nothing; only on a fixture stack
  all           health, signin, ws, system, pages, extension-node, cls, cursor, rail,
                reply-focus, slash-menu, tooltips and map

ended takes one session name. pages, extension-node, screenshots and tooltips take routes
(/dashboard/apps); with none, every page in the dashboard map whose route has no [dynamic]
segment, which needs a concrete route to open. cls takes routes too; with none, /dashboard
(the sidebar) and /dashboard/system. Any other check refuses a word after it: run one check
a call, or all.

Options
  --web <url>      the web base URL, given with --api (default: this worktree's stack, from portless)
  --api <url>      the API base URL
  --expect <rev>   the commit or version /api/health must report (default: HEAD)
  --label <side>   screenshots: before (the change's base) or after (the change), required
  --out <dir>      where screenshots go (default: <tmp>/playground-verify)
  --json           print the results as JSON

Beyond the agent sign-in, which it signs out of again, and send-top, send-focus, slash-menu,
reply-focus, typing-lag and upload-keep, which a stack that reads live data refuses, it only reads, so it is safe against the live dashboard.`

const parse = () => {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        api: { type: "string" },
        expect: { default: "HEAD", type: "string" },
        help: { short: "h", type: "boolean" },
        json: { type: "boolean" },
        label: { type: "string" },
        out: { default: join(tmpdir(), "playground-verify"), type: "string" },
        web: { type: "string" },
      },
    })
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`)
    process.exit(1)
  }
}

const { positionals, values } = parse()

const read = readCheck(positionals)
if (values.help || !read) {
  console.log(USAGE)
  process.exit(values.help ? 0 : 1)
}
const { check, routes } = read

const stray = strayRoutes(check, routes)
if (stray) {
  console.error(`${stray}\n\n${USAGE}`)
  process.exit(1)
}

const label = LABELS.find((side) => side === values.label)
if (check === "screenshots" && !label) {
  console.error(`screenshots needs --label before or --label after\n\n${USAGE}`)
  process.exit(1)
}

const portless = (name: string): string => {
  const proc = Bun.spawnSync(["bunx", "portless", "get", name], { stderr: "ignore" })
  const url = proc.stdout.toString().trim()
  if (proc.exitCode !== 0 || !url) {
    console.error(
      `No stack for this worktree (bunx portless get ${name}): start it (dev skill), or pass --web and --api`,
    )
    process.exit(1)
  }
  return url
}

const target = (): Target => {
  if (Boolean(values.web) !== Boolean(values.api)) {
    console.error("Pass --web and --api together: one stack's web and API")
    process.exit(1)
  }
  const strip = (url: string) => url.replace(/\/+$/, "")
  return values.web && values.api
    ? { api: strip(values.api), web: strip(values.web) }
    : { api: strip(portless("api.playground")), web: strip(portless("playground")) }
}

// A check that throws (a stack that is down, agent-browser missing) fails as itself rather than ending the run.
const guard = async (name: string, run: () => Promise<Result | Result[]>): Promise<Result[]> => {
  try {
    return [await run()].flat()
  } catch (error) {
    return [
      { check: name, detail: error instanceof Error ? error.message : String(error), ok: false },
    ]
  }
}

const pageRoutes = routes.length
  ? routes
  : DASHBOARD_MAP.pages.map((page) => page.route).filter((route) => !route.includes("["))
const pageFor = (route: string) =>
  DASHBOARD_MAP.pages.find((page) => page.route === new URL(route, "http://dashboard").pathname)

// What the run has signed into, undone however it ends: a check undoes its own when it finishes, and an interrupt undoes whatever is still open before it exits, so no session or browser outlives the run.
const cleanups = new Set<() => Promise<void>>()
const interrupted = async () => {
  await Promise.all([...cleanups].map((cleanup) => cleanup().catch(() => undefined)))
  process.exit(130)
}
process.once("SIGINT", interrupted)
process.once("SIGTERM", interrupted)

const holding = async <T>(cleanup: () => Promise<void>, run: () => Promise<T>): Promise<T> => {
  cleanups.add(cleanup)
  try {
    return await run()
  } finally {
    cleanups.delete(cleanup)
    await cleanup()
  }
}

const browse = (
  at: Target,
  name: string,
  run: (browser: Browser) => Promise<Result[]>,
  scripts: string[] = [],
): Promise<Result[]> => {
  const browser = new Browser(scripts, name)
  return holding(
    async () => {
      await browser.signOut(at)
      await browser.close()
    },
    () => run(browser),
  )
}

const pages = (at: Target) =>
  guard("pages", () =>
    browse(at, "pages", async (browser) => {
      await browser.viewport(VIEWPORTS[0]!)
      await browser.signIn(at)
      const results: Result[] = []
      for (const route of pageRoutes) {
        results.push(
          ...(await guard(`page ${route}`, () => checkPage(browser, at, route, pageFor(route)))),
        )
      }
      results.push(...(await guard("rows", () => rowsFit(browser, at))))
      return results
    }),
  )

const screenshots = (at: Target, label: Label) =>
  guard("screenshots", async () => {
    const source = await fixtureOnly(at)
    if (!source.ok) return source
    return browse(at, "screenshots", async (browser) => {
      await mkdir(values.out, { recursive: true })
      await browser.signIn(at)
      const results: Result[] = []
      for (const theme of THEMES) {
        for (const viewport of SHOT_VIEWPORTS) {
          for (const route of pageRoutes) {
            results.push(
              ...(await guard(`screenshot ${route}`, () =>
                screenshot(browser, at, route, viewport, values.out, label, theme),
              )),
            )
          }
        }
      }
      return results
    })
  })

// Each route loads cold then warm in a browser of its own, whose init scripts (the observer, and for a no-roster load the agents read without its roster) set what it sees; a result names its case after the load.
const shiftsIn = async (
  at: Target,
  scripts: string[],
  name: string,
  list: string[],
  suffix = "",
  chat = false,
) =>
  !list.length
    ? []
    : browse(
        at,
        name,
        async (browser) => {
          await browser.viewport(VIEWPORTS[1]!)
          await browser.signIn(at)
          const results: Result[] = []
          const loads = async (route: string) => {
            for (const load of ["cold", "warm"] as const) {
              const check = `cls ${route} ${load}${suffix}`
              results.push(
                ...(await guard(check, async () => ({
                  ...(await cls(browser, at, route, load)),
                  check,
                }))),
              )
            }
          }
          for (const route of list) await loads(route)
          // the chat's Checkpoint bar: under a view with no composer, and as it changes
          if (chat && list.includes("/dashboard")) {
            const view = await readOnlyChat(browser, at)
            if (view) await loads(view)
            else
              results.push({
                check: `cls read-only chat${suffix}`,
                detail: "the board holds no session but a dispatcher",
                ok: false,
              })
            results.push(...(await guard("cls /dashboard chat bar", () => clsChat(browser, at))))
          }
          return results
        },
        scripts,
      )

// The init scripts are files because agent-browser takes one by path; they go when the run does. The routes a roster changes load again as a stack with no roster file would show them, and every route again as one whose second dispatcher is on the roster but down (its stored sidebar holds no row for it). Within all, a stack that reads live data (the live dashboard) skips it rather than failing.
const layoutShifts = (at: Target, inAll = false) =>
  guard("cls", async () => {
    const source = await fixtureOnly(at, "cls")
    if (!source.ok)
      return inAll ? { ...source, detail: `skipped: ${source.detail}`, ok: true } : source
    const observer = join(tmpdir(), `playground-verify-cls-${process.pid}.js`)
    const noRoster = join(tmpdir(), `playground-verify-cls-no-roster-${process.pid}.js`)
    const secondDown = join(tmpdir(), `playground-verify-cls-second-down-${process.pid}.js`)
    await Bun.write(observer, OBSERVER_SCRIPT)
    await Bun.write(noRoster, NO_ROSTER_SCRIPT)
    await Bun.write(secondDown, SECOND_DOWN_SCRIPT)
    const asked = routes.length ? routes : CLS_ROUTES
    return holding(
      async () => {
        await Bun.file(observer).delete()
        await Bun.file(noRoster).delete()
        await Bun.file(secondDown).delete()
      },
      async () => [
        ...(await shiftsIn(at, [observer], "cls", asked, "", true)),
        ...(await shiftsIn(
          at,
          [observer, noRoster],
          "cls-no-roster",
          asked.filter((route) => CLS_NO_ROSTER_ROUTES.includes(route)),
          " (no roster)",
        )),
        ...(await shiftsIn(
          at,
          [observer, secondDown],
          "cls-second-down",
          asked,
          " (second dispatcher down)",
        )),
      ],
    )
  })

// The phone's width as well as the dashboard's, since the composer and the stream share a short screen there.
const CHAT_VIEWPORTS = [VIEWPORTS[0]!, { height: 844, width: 390 }]

// The fixture's scratch folder the reply checks write to, as the launcher names it (fixtureDir in api/hono/src/lib/dashboard/fixture.ts): only this checkout's own stack's, so a stack named by --web and --api skips them.
const ROOT = join(import.meta.dir, "../../../..")
const fixture =
  values.web || values.api
    ? null
    : process.env.PLAYGROUND_FIXTURE_DIR
      ? resolve(ROOT, process.env.PLAYGROUND_FIXTURE_DIR)
      : join(ROOT, ".turbo/dashboard-fixture")

const sendTops = (at: Target) =>
  guard("send-top", async () => {
    const source = await fixtureOnly(at, "send-top")
    if (!source.ok) return source
    return browse(at, "send-top", async (browser) => {
      await browser.signIn(at)
      const results: Result[] = []
      for (const viewport of CHAT_VIEWPORTS) {
        results.push(
          ...(await guard(`send-top ${viewport.width}`, () =>
            sendTop(browser, at, viewport, fixture),
          )),
        )
      }
      return results
    })
  })

const slashMenus = (at: Target, inAll = false) =>
  guard("slash-menu", async () => {
    const source = await fixtureOnly(at, "slash-menu")
    if (!source.ok)
      return inAll ? { ...source, detail: `skipped: ${source.detail}`, ok: true } : source
    return browse(at, "slash-menu", async (browser) => {
      await browser.signIn(at)
      const results: Result[] = []
      for (const viewport of CHAT_VIEWPORTS)
        results.push(...(await slashMenu(browser, at, viewport)))
      return results
    })
  })

const replyFocuses = (at: Target, inAll = false) =>
  guard("reply-focus", async () => {
    const source = fixture
      ? await fixtureOnly(at, "reply-focus")
      : {
          check: "reply-focus",
          detail: "needs this checkout's own stack, not --web and --api",
          ok: false,
        }
    if (!source.ok)
      return inAll ? { ...source, detail: `skipped: ${source.detail}`, ok: true } : source
    return browse(at, "reply-focus", async (browser) => {
      await browser.signIn(at)
      return [await replyFocus(browser, at)]
    })
  })

const sendFocuses = (at: Target) =>
  guard("send-focus", async () => {
    const source = await fixtureOnly(at, "send-focus")
    if (!source.ok) return source
    return browse(at, "send-focus", async (browser) => {
      await browser.signIn(at)
      return sendFocus(browser, at)
    })
  })

// The script is a file because agent-browser takes one by path; it goes when the run does. It writes into the fixture's transcripts, so only this checkout's own stack.
const typingLags = (at: Target) =>
  guard("typing-lag", async () => {
    if (!fixture)
      return {
        check: "typing-lag",
        detail: "needs this checkout's own stack, not --web and --api",
        ok: false,
      }
    const source = await fixtureOnly(at, "typing-lag")
    if (!source.ok) return source
    const script = join(tmpdir(), `playground-verify-typing-lag-${process.pid}.js`)
    await Bun.write(script, TYPING_LAG_SCRIPT)
    return holding(
      () => Bun.file(script).delete(),
      () =>
        browse(
          at,
          "typing-lag",
          async (browser) => {
            await browser.signIn(at)
            return [await typingLag(browser, at, fixture)]
          },
          [script],
        ),
    )
  })

const uploadKeeps = (at: Target) =>
  guard("upload-keep", async () => {
    const source = await fixtureOnly(at, "upload-keep")
    if (!source.ok) return source
    return browse(at, "upload-keep", async (browser) => {
      await browser.signIn(at)
      return uploadKeep(browser, at)
    })
  })

// A wide screen, where the bar floats over the panes, and a phone, where it keeps a row of its own.
const ASIDE_VIEWPORTS = [
  { height: 900, width: 1440 },
  { height: 844, width: 390 },
]

const asideBars = (at: Target) =>
  guard("aside-bar", async () =>
    browse(at, "aside-bar", async (browser) => {
      await browser.signIn(at)
      const results: Result[] = []
      for (const viewport of ASIDE_VIEWPORTS)
        results.push(...(await asideBar(browser, at, viewport)))
      return results
    }),
  )

const changelogEntries = (at: Target) =>
  guard("changelog-entry", async () =>
    browse(at, "changelog-entry", async (browser) => {
      await browser.signIn(at)
      return [await changelogEntry(browser, at)]
    }),
  )

const facetChecks = (at: Target) =>
  guard("facets", async () =>
    browse(at, "facets", async (browser) => {
      await browser.signIn(at)
      const results: Result[] = []
      for (const viewport of CHAT_VIEWPORTS) results.push(...(await facets(browser, at, viewport)))
      return results
    }),
  )

const cursors = (at: Target) =>
  guard("cursor", async () =>
    browse(at, "cursor", async (browser) => {
      await browser.signIn(at)
      return [await cursor(browser, at)]
    }),
  )

const focusMarkChecks = (at: Target) =>
  guard("focus-marks", async () =>
    browse(at, "focus-marks", async (browser) => {
      await browser.signIn(at)
      const results: Result[] = []
      for (const page of FOCUS_PAGES) results.push(await focusMarksPage(browser, at, page))
      return results
    }),
  )

const rails = (at: Target) =>
  guard("rail", async () =>
    browse(at, "rail", async (browser) => {
      await browser.signIn(at)
      const results: Result[] = []
      for (const page of RAIL_PAGES) results.push(await rail(browser, at, page))
      return results
    }),
  )

// The node goes in through an init script, a file because agent-browser takes one by path; it goes when the check does.
const extensionNodeChecks = (at: Target) =>
  guard("extension-node", async () => {
    const script = join(tmpdir(), `playground-verify-extension-node-${process.pid}.js`)
    await Bun.write(script, EXTENSION_NODE_SCRIPT)
    return holding(
      () => Bun.file(script).delete(),
      () =>
        browse(
          at,
          "extension-node",
          async (browser) => {
            await browser.signIn(at)
            const results: Result[] = []
            for (const route of pageRoutes) results.push(await extensionNode(browser, at, route))
            return results
          },
          [script],
        ),
    )
  })

const tooltipChecks = (at: Target) =>
  guard("tooltips", async () =>
    browse(at, "tooltips", async (browser) => {
      await browser.signIn(at)
      return tooltips(browser, at, pageRoutes)
    }),
  )

const results: Result[] = []
if (check === "map") results.push(...(await guard("map", map)))
else {
  const at = target()
  if (check === "health" || check === "all") {
    results.push(...(await guard("health", () => health(at, resolveExpectation(values.expect)))))
  }
  // The WebSocket and the system route need the session the sign-in mints, so they sign in first and report it too.
  if (
    check === "ended" ||
    check === "signin" ||
    check === "ws" ||
    check === "system" ||
    check === "all"
  ) {
    let cookie = ""
    await holding(
      async () => {
        if (cookie) await signOut(at, cookie)
      },
      async () => {
        results.push(
          ...(await guard("signin", async () => {
            const signed = await signIn(at)
            cookie = signed.cookie
            return signed.result
          })),
        )
        if ((check === "ws" || check === "all") && cookie) {
          results.push(...(await guard("ws", () => dashboardSocket(at, cookie))))
        }
        if ((check === "system" || check === "all") && cookie) {
          results.push(...(await guard("system", () => system(at, cookie))))
        }
        if (check === "ended" && cookie) {
          results.push(...(await guard("ended", () => ended(at, cookie, routes[0]!))))
        }
      },
    )
  }
  if (check === "pages" || check === "all") results.push(...(await pages(at)))
  if (check === "extension-node" || check === "all")
    results.push(...(await extensionNodeChecks(at)))
  if (check === "problems") results.push(...(await guard("problems", () => problems(at))))
  if (check === "rows")
    results.push(
      ...(await guard("rows", () =>
        browse(at, "rows", async (browser) => {
          await browser.viewport(VIEWPORTS[0]!)
          await browser.signIn(at)
          return [await rowsFit(browser, at)]
        }),
      )),
    )
  if (check === "screenshots" && label) results.push(...(await screenshots(at, label)))
  if (check === "send-top") results.push(...(await sendTops(at)))
  if (check === "send-focus") results.push(...(await sendFocuses(at)))
  if (check === "typing-lag") results.push(...(await typingLags(at)))
  if (check === "aside-bar") results.push(...(await asideBars(at)))
  if (check === "changelog-entry") results.push(...(await changelogEntries(at)))
  if (check === "cls" || check === "all") results.push(...(await layoutShifts(at, check === "all")))
  if (check === "cursor" || check === "all") results.push(...(await cursors(at)))
  if (check === "rail" || check === "all") results.push(...(await rails(at)))
  if (check === "facets") results.push(...(await facetChecks(at)))
  if (check === "focus-marks") results.push(...(await focusMarkChecks(at)))
  if (check === "reply-focus" || check === "all") {
    results.push(...(await replyFocuses(at, check === "all")))
  }
  if (check === "slash-menu" || check === "all") {
    results.push(...(await slashMenus(at, check === "all")))
  }
  if (check === "tooltips" || check === "all") results.push(...(await tooltipChecks(at)))
  if (check === "upload-keep") results.push(...(await uploadKeeps(at)))
  if (check === "all") results.push(...(await guard("map", map)))
}

if (values.json) console.log(JSON.stringify(results, null, 2))
else
  for (const { check: name, detail, ok } of results)
    console.log(`${ok ? "✓" : "✗"} ${name}  ${detail}`)
process.exit(results.every((result) => result.ok) ? 0 : 1)
