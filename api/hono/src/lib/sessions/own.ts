import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { sessionStateDir } from "@packages/config/session-state"
import { z } from "zod"

import { readsLive } from "@/lib/dashboard/fixture"
import { type RegistryFile, registeredSessionsOf } from "@/lib/dashboard/peers"
import { dataDir } from "@/lib/sessions/paths"

// Which of the machine's Claude sessions a stack shows. cmux and every other terminal run sessions Playground never started (the owner's own, another checkout's factory), so a stack that reads this machine shows Playground's own alone, unless it opts in to every one: the Sessions pages through the ingest and System's sampler ask here, and the board shows Playground's own alone either way.

// The file in the hosted session's folder (PLAYGROUND_SDK_PROBE_DIR) that names its session, so the API resumes it after a restart rather than starting another (sdk.ts).
export const SESSION_FILE = ".sdk-session"

// Pure: whether a stack opts in to every session on the machine, read as the env schema's stringbool reads it, so the launcher, which reads the raw setting, and the API agree; a value it cannot read keeps them out.
export const allSessions = (value: string | undefined): boolean =>
  z.stringbool().safeParse(value).data === true

// Whether this process shows every session: a fixture's are all made up, and a stack that reads this machine shows them all only once it opts in.
export const everySession = (): boolean =>
  !readsLive() || allSessions(process.env.PLAYGROUND_ALL_SESSIONS)

const hostedId = (): string | null => {
  const dir = process.env.PLAYGROUND_SDK_PROBE_DIR
  const file = dir ? join(dir, SESSION_FILE) : null
  return file && existsSync(file) ? readFileSync(file, "utf8").trim() || null : null
}

// Playground's own session: one its own hooks recorded, as session-state/<id>.json in its data folder (the session-state hook writes it from a session's first prompt, and only for a session on Playground's settings or in its checkout), or the one it hosts on the Agent SDK. Every session counts on a stack that shows them all.
export const isOwnSession = (sessionId: string): boolean =>
  everySession() ||
  existsSync(join(sessionStateDir(dataDir()), `${sessionId}.json`)) ||
  sessionId === hostedId()

// The registry's live sessions that are Playground's own.
export const ownRegistered = (files: RegistryFile[] | null) =>
  registeredSessionsOf(files).filter((session) => isOwnSession(session.sessionId))
