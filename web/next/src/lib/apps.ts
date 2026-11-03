import { arrayMove } from "@dnd-kit/sortable"
import { features } from "@packages/config/site"
import {
  RiHistoryLine,
  RiImageLine,
  RiLineChartLine,
  RiRoadMapLine,
  type RemixiconComponentType,
} from "@remixicon/react"
import { useSyncExternalStore } from "react"

// id is the skill's name, which actions and the API name it by, or for an app no skill is behind (Usage) its title's word lowercased; segment is its route under /dashboard/apps; title is its display name, one capitalised word for what it shows, without the skill's light- prefix.
type AppEntry = {
  description: string
  icon: RemixiconComponentType
  id: string
  segment: string
  title: string
}

// The dashboard's apps: tools that show what a skill or the sessions produced, beside the workers rather than among them. The aside's app squares and Apps tab, the Apps home and each app's own page header all read from here, so an app is named and described once. A new app is one entry here, its page under app/(protected)/dashboard/apps/<segment>/, its view in VIEWS in components/apps/app-pane.tsx, and its row in the pages of packages/scripts/src/verify/dashboard-map.json.
const ENTRIES = [
  {
    description: "What changed, newest first: every merge, version, rule and setting in one line.",
    icon: RiHistoryLine,
    id: "changelog",
    segment: "changelog",
    title: "Changelog",
  },
  {
    description: "What is going on and why, in plain words, and what each lane builds next.",
    icon: RiRoadMapLine,
    id: "plan",
    segment: "plan",
    title: "Plan",
  },
  {
    description: "The images and live pages agents make for your choices, grouped by topic.",
    icon: RiImageLine,
    id: "previews",
    segment: "previews",
    title: "Previews",
  },
  {
    description: "What the factory spends, by agent, model, hour and merged PR.",
    icon: RiLineChartLine,
    id: "usage",
    segment: "usage",
    title: "Usage",
  },
] as const satisfies readonly AppEntry[]

export type DashboardAppId = (typeof ENTRIES)[number]["id"]

export type DashboardApp = AppEntry & { href: string; id: DashboardAppId }

// Every app: each page reads its own header from here.
export const APPS: DashboardApp[] = ENTRIES.map((app) => ({
  ...app,
  href: `/dashboard/apps/${app.segment}`,
}))

// A plugin's app shows only while its default switch is on (features in packages/config's site.ts); the API's env override, which the web cannot read, answers 404 and the app reads as empty.
export const shown = (
  app: Pick<DashboardApp, "id">,
  flags: Pick<typeof features, "changelog"> = features,
): boolean => app.id !== "changelog" || flags.changelog

// Apps set aside until they are built again, their pages still at their routes but out of the aside and the Apps home.
export const PARKED_APPS: readonly DashboardAppId[] = ["plan", "previews", "usage"]

// The apps the aside and the Apps home list, parked ones never.
export const dashboardApps = (): DashboardApp[] =>
  APPS.filter((app) => shown(app) && !PARKED_APPS.includes(app.id))

// The app squares' one shape, which every icon tab in the aside draws.
export const APP_SQUARE =
  "size-8 justify-center p-0 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"

// An app by its id; an id the registry lacks is a bug, so it fails loudly rather than leaving a page without its description.
export const appById = (id: DashboardAppId): DashboardApp => {
  const app = APPS.find((candidate) => candidate.id === id)
  if (!app) throw new Error(`No app with id ${id}`)
  return app
}

// Your apps' order and the ones you hid, from the aside's Apps tab, per browser (#i787).
export const APP_PREFS_KEY = "dashboard.apps.v1"

export type AppPrefs = { hidden: DashboardAppId[]; order: DashboardAppId[] }

const NO_PREFS: AppPrefs = { hidden: [], order: [] }

const ids = (value: unknown): DashboardAppId[] =>
  Array.isArray(value)
    ? value.filter((id): id is DashboardAppId => APPS.some((app) => app.id === id))
    : []

// Pure: a stored value's prefs, each list keeping only ids an app has; anything else reads as none.
export function parseAppPrefs(raw: string | null): AppPrefs {
  try {
    const value: unknown = raw ? JSON.parse(raw) : null
    if (!value || typeof value !== "object") return NO_PREFS
    const { hidden, order } = value as Record<string, unknown>
    return { hidden: ids(hidden), order: ids(order) }
  } catch {
    return NO_PREFS
  }
}

// Pure: every app in your order, one your order does not name after it in apps.ts order.
export const arrangeApps = <T extends Pick<DashboardApp, "id">>(
  apps: T[],
  prefs: AppPrefs,
): T[] => {
  const at = (app: T) => {
    const i = prefs.order.indexOf(app.id)
    return i < 0 ? prefs.order.length + apps.indexOf(app) : i
  }
  return apps.toSorted((a, b) => at(a) - at(b))
}

// Pure: the apps whose squares show, in your order.
export const shownApps = <T extends Pick<DashboardApp, "id">>(apps: T[], prefs: AppPrefs): T[] =>
  arrangeApps(apps, prefs).filter((app) => !prefs.hidden.includes(app.id))

// Pure: shows a hidden app, or hides a shown one.
export const toggleApp = (prefs: AppPrefs, id: DashboardAppId): AppPrefs => ({
  ...prefs,
  hidden: prefs.hidden.includes(id)
    ? prefs.hidden.filter((other) => other !== id)
    : [...prefs.hidden, id],
})

// Pure: a drop moves one app in the list as shown, and the whole list becomes your order, an app the list leaves out (a parked one, such as Plan) keeping its place after it.
export const moveApp = (
  prefs: AppPrefs,
  shown: DashboardAppId[],
  from: number,
  to: number,
): AppPrefs => ({
  ...prefs,
  order: [...arrayMove(shown, from, to), ...prefs.order.filter((id) => !shown.includes(id))],
})

// kept in the tab too, so a browser that refuses storage still keeps your picks until a reload; the same object while the stored text is the same, as useSyncExternalStore needs; a key cleared in another tab clears them here too
let inTab: AppPrefs = NO_PREFS
let inTabRaw: string | null = null

export function readAppPrefs(storage: () => Storage = () => localStorage): AppPrefs {
  try {
    const raw = storage().getItem(APP_PREFS_KEY)
    if (raw !== inTabRaw) {
      inTab = raw === null ? NO_PREFS : parseAppPrefs(raw)
      inTabRaw = raw
    }
  } catch {}
  return inTab
}

// written in this tab; another tab's write arrives as the storage event
const EVENT = "playground:apps"

export function writeAppPrefs(prefs: AppPrefs, storage: () => Storage = () => localStorage) {
  inTab = prefs
  const raw = JSON.stringify(prefs)
  try {
    storage().setItem(APP_PREFS_KEY, raw)
    inTabRaw = raw
  } catch {
    // a refused write (a full quota) leaves the stored text, which the next read must not take for a change
    try {
      inTabRaw = storage().getItem(APP_PREFS_KEY)
    } catch {}
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT))
}

const onPrefsChange = (change: () => void) => {
  window.addEventListener(EVENT, change)
  window.addEventListener("storage", change)
  return () => {
    window.removeEventListener(EVENT, change)
    window.removeEventListener("storage", change)
  }
}

// Your prefs, the same in the tab bar and the Apps tab, and in every open tab of this browser; the server, which has no storage, reads none.
export const useAppPrefs = (): AppPrefs =>
  useSyncExternalStore(
    onPrefsChange,
    () => readAppPrefs(),
    () => NO_PREFS,
  )
