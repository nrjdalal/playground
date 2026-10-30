// The console's shared vocabulary, here rather than in @packages/db or @packages/auth because both of those sit above this package and the web cannot import either without dragging a database driver or an auth runtime into its build.
// The actions the console records. Alphabetical, and the value is what the column stores, so adding one here and giving it a label in the console is the whole job.
export const ACTIVITY_ACTIONS = [
  "allowlist.add",
  "allowlist.remove",
  "dashboard.answer",
  "dashboard.message",
  "dashboard.mode",
  "role.change",
  "user.ban",
  "user.unban",
  "waitlist.remove",
] as const

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number]

// The dashboard's actions as rows written before the rename store them, so a reader takes both.
export const OLD_ACTIVITY_ACTIONS: Record<string, ActivityAction> = {
  "desk.answer": "dashboard.answer",
  "desk.message": "dashboard.message",
  "desk.mode": "dashboard.mode",
}

// An action and the old names its rows may still hold.
export const storedAs = (action: ActivityAction): string[] => [
  action,
  ...Object.keys(OLD_ACTIVITY_ACTIONS).filter((old) => OLD_ACTIVITY_ACTIONS[old] === action),
]

// A hosted session's permission modes in words, in the order Claude Code's Shift+Tab cycles them: the composer's picker lists them, and a dashboard.mode row names them, so the two read alike.
export const PERMISSION_MODE_LABELS = {
  default: "Default",
  acceptEdits: "Accept edits",
  plan: "Plan",
  bypassPermissions: "Bypass permissions",
} as const

// A session nothing names, as people read it (the owner's ask: give the random ids a name): `session <folder>`, from the folder it runs in, since its first ask already shows beside its name wherever it is listed. Leading with the word keeps it from matching a role by name or prefix (a folder named dispatcher, worker-x or probe-x), so it is always other. null with no folder.
export const folderName = (cwd: string | null): string | null => {
  const folder = (cwd ?? "").split("/").filter(Boolean).at(-1)
  return folder ? `session ${folder}` : null
}

// The most ids one set route will take. Shared rather than only enforced server side: the console's tables load more as you scroll and select-all takes every loaded row, so the client has to know where to split a selection rather than discover the limit as a rejected request.
export const MAX_BATCH = 100
