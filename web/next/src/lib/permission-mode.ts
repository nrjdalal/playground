import type { Worker } from "@api/hono"
import { PERMISSION_MODE_LABELS } from "@packages/config/console"

import { apiClient, unwrap } from "@/lib/api/client"

export type PermissionMode = NonNullable<Worker["permissionMode"]>

// Each mode in words, in the order Claude Code's Shift+Tab cycles them, which the composer's picker lists; the console's activity names them the same way.
export const MODE_LABELS: Record<PermissionMode, string> = PERMISSION_MODE_LABELS

// Pure: the composer's mode picker for a session, or null for one with none. Only a session the dashboard hosts has one; it is read-only while approvals are off, as the API then refuses a change.
export function modePicker(
  worker: Worker,
  approvals: boolean,
): { mode: PermissionMode; readOnly: boolean } | null {
  if (!worker.hosted || !worker.permissionMode) return null
  return { mode: worker.permissionMode, readOnly: !approvals }
}

// A pick not yet on the session's row: the mode picked, and the mode the row showed when it was picked.
export type PendingMode = { from: PermissionMode; to: PermissionMode }

// Pure: the mode the picker shows. A pick shows from the moment it is made until the row reports a mode other than the one it was picked over, since the row takes the new mode only on the board's next frame, after the request has answered.
export const shownMode = (pending: PendingMode | null, reported: PermissionMode): PermissionMode =>
  pending && reported === pending.from ? pending.to : reported

// Changes a hosted session's mode through the API, which records it in the console's activity.
export async function changeMode(sessionId: string, mode: PermissionMode) {
  return unwrap(
    apiClient.v1.workers[":sessionId"].mode.$post({ json: { mode }, param: { sessionId } }),
  )
}
