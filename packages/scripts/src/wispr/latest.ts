import { Database } from "bun:sqlite"
import {
  constants,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

const HELP = `bun run wispr:latest [--since <iso>] [--live]

Prints Wispr Flow's newest ended meeting as plain text, or with --since every meeting that ended
after that time, oldest first. --live adds a meeting still being recorded, marked partial.
Each meeting is a header (title, end time) and one "[mm:ss] Speaker: text" line per utterance,
from its refined transcript, else the live one, marked not refined yet. It reads a clone of Wispr
Flow's database, removed once read, so it never writes to Wispr Flow's files or waits on its locks.
A transcript is private: it goes to stdout only.`

const WISPR_DIR = join(homedir(), "Library", "Application Support", "Wispr Flow")

export type Transcript = {
  endedAt: number | null
  lines: string[]
  refined: boolean
  title: string
}

type Meeting = {
  endedAt: number | null
  id: string
  speakerMap: string | null
  title: string
  transcriptReady: number
}

type SpeakerMap = {
  assignments?: Record<string, { consensus?: string | null }>
  people?: Record<string, { name?: string }>
}

type Utterance = { speaker?: { id?: number; name?: string }; text?: string; timestamp?: string }

const nameOf = (map: SpeakerMap, speaker: Utterance["speaker"]): string => {
  const person = map.assignments?.[String(speaker?.id)]?.consensus
  return (person && map.people?.[person]?.name) || speaker?.name || `Speaker ${speaker?.id ?? "?"}`
}

const parseMap = (text: string | null): SpeakerMap => {
  try {
    return text ? (JSON.parse(text) as SpeakerMap) : {}
  } catch {
    return {}
  }
}

const linesOf = (file: string, map: SpeakerMap): string[] =>
  readFileSync(file, "utf8")
    .split("\n")
    .flatMap((raw) => {
      let line: Utterance | null
      try {
        line = JSON.parse(raw) as Utterance | null
      } catch {
        return []
      }
      if (typeof line?.text !== "string" || !line.text.trim()) return []
      return [`[${line.timestamp ?? "--:--"}] ${nameOf(map, line.speaker)}: ${line.text.trim()}`]
    })

const stamp = (path: string): string =>
  [path, `${path}-wal`]
    .map((file) => {
      const stat = statSync(file, { bigint: true, throwIfNoEntry: false })
      return stat ? `${stat.size}:${stat.mtimeNs}` : "-"
    })
    .join(" ")

export const readTranscripts = (
  dir: string,
  { live = false, since }: { live?: boolean; since?: Date } = {},
): Transcript[] => {
  const path = join(dir, "flow.sqlite")
  if (!existsSync(path)) throw new Error(`no Wispr Flow database at ${path}`)
  const copy = mkdtempSync(join(tmpdir(), "wispr-"))
  let meetings: Meeting[]
  try {
    for (let tries = 1; ; tries++) {
      const before = stamp(path)
      if (existsSync(`${path}-wal`))
        copyFileSync(`${path}-wal`, join(copy, "flow.sqlite-wal"), constants.COPYFILE_FICLONE)
      copyFileSync(path, join(copy, "flow.sqlite"), constants.COPYFILE_FICLONE)
      // A write between the two clones can pair a database and a -wal from different moments.
      if (stamp(path) === before) break
      rmSync(join(copy, "flow.sqlite-wal"), { force: true })
      if (tries === 5) throw new Error("Wispr Flow kept writing while it was read; try again")
    }
    const db = new Database(join(copy, "flow.sqlite"))
    const ended = since
      ? "endedAt > $since"
      : "endedAt = (select max(endedAt) from Meetings where isDeleted = 0)"
    meetings = db
      .query(
        `select id, title, endedAt, transcriptReady, speakerMap from Meetings
         where isDeleted = 0 and (${ended}${live ? " or endedAt is null" : ""})
         order by endedAt is null, endedAt`,
      )
      .all(since ? { $since: since.getTime() } : {}) as Meeting[]
    db.close()
  } finally {
    rmSync(copy, { force: true, recursive: true })
  }
  return meetings.map((meeting) => {
    const folder = join(dir, "meetings", meeting.id)
    const refined = meeting.transcriptReady === 1 && existsSync(join(folder, "refined.ndjson"))
    const file = join(folder, refined ? "refined.ndjson" : "live.ndjson")
    return {
      endedAt: meeting.endedAt,
      lines: existsSync(file) ? linesOf(file, parseMap(meeting.speakerMap)) : [],
      refined,
      title: meeting.title,
    }
  })
}

export const render = (transcript: Transcript): string => {
  const notes = [
    transcript.endedAt === null
      ? "in progress, partial"
      : `ended ${new Date(transcript.endedAt).toISOString()}`,
    ...(transcript.refined ? [] : ["live transcript, not refined yet"]),
    ...(transcript.lines.length ? [] : ["no transcript lines"]),
  ]
  return [`# ${transcript.title}`, notes.join(" · "), "", ...transcript.lines].join("\n")
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP)
    process.exit(0)
  }
  const at = args.indexOf("--since")
  const since = at === -1 ? undefined : new Date(args[at + 1] ?? "")
  const unknown = args.filter(
    (arg, i) => !["--live", "--since"].includes(arg) && (at === -1 || i !== at + 1),
  )
  if (unknown.length || (since && Number.isNaN(since.getTime()))) {
    console.error(
      `wispr: ${unknown.length ? `unknown argument ${unknown[0]}` : "--since needs an ISO time"}\n\n${HELP}`,
    )
    process.exit(1)
  }
  try {
    const transcripts = readTranscripts(WISPR_DIR, { live: args.includes("--live"), since })
    if (transcripts.length) console.log(transcripts.map(render).join("\n\n"))
    else console.error("wispr: no meeting found")
  } catch (error) {
    console.error(`wispr: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
