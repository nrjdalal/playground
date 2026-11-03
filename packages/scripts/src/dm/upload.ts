import { basename, extname } from "node:path"

import { check as publicLeak } from "../../../../scripts/hooks/no-public-leak"
import { leakOf } from "./send"
import { call, type Slack, slackOf } from "./slack"

// The byte post to the URL Slack hands back, which takes no token.
export type Put = (url: string, bytes: Uint8Array) => Promise<{ ok: boolean; status: number }>

export type UploadFile = { bytes: Uint8Array; name: string }

const putOf = (): Put => async (url, bytes) => {
  const res = await fetch(url, { body: bytes, method: "POST", signal: AbortSignal.timeout(60_000) })
  return { ok: res.ok, status: res.status }
}

// Slack's three external-upload steps: an upload URL for each file, its bytes posted there, then one complete that shares them all into the channel, in the thread when one is named. Any step Slack refuses throws, and a file whose bytes did not land shares nothing.
export async function upload({
  channel,
  files,
  put,
  slack,
  thread,
}: {
  channel: string
  files: UploadFile[]
  put: Put
  slack: Slack
  thread?: string
}): Promise<number> {
  const shared: { id: string; title: string }[] = []
  for (const file of files) {
    const reply = await call(slack, "files.getUploadURLExternal", {
      filename: file.name,
      length: String(file.bytes.length),
    })
    const posted = await put(reply.upload_url!, file.bytes)
    if (!posted.ok)
      throw new Error(`the bytes of ${file.name} did not upload: HTTP ${posted.status}`)
    shared.push({ id: reply.file_id!, title: file.name })
  }
  await call(slack, "files.completeUploadExternal", {
    channel_id: channel,
    files: JSON.stringify(shared),
    ...(thread ? { thread_ts: thread } : {}),
  })
  return files.length
}

// What dm upload reads on its stdin: where the files go, and each file's path with the name it shows in Slack.
export type Spec = { channel: string; files: { name: string; path: string }[]; thread?: string }

const PICTURES = new Set([".gif", ".jpg", ".jpeg", ".pdf", ".png", ".webp"])

// The guards dm send runs on a post (no-playground-leak), and no-public-leak, on each file's name and, for a text file, its words, as one post to the channel would carry them.
const guarded = async (channel: string, file: UploadFile): Promise<string | undefined> => {
  const text = PICTURES.has(extname(file.name).toLowerCase())
    ? file.name
    : `${file.name}\n${new TextDecoder().decode(file.bytes)}`
  const raw = JSON.stringify({
    tool_input: { channel, text },
    tool_name: "mcp__slack-shared__chat_post_message",
  })
  return (await leakOf(channel)(text)) ?? (await publicLeak(raw))
}

// its errors as one plain line, which the dashboard shows as the send's reason
const main = async () => {
  const token = process.env.SLACK_TOKEN
  if (!token)
    throw new Error("usage: SLACK_TOKEN=<token> upload.ts < spec, run by playground dm upload")
  const spec = JSON.parse(await Bun.stdin.text()) as Spec
  const files: UploadFile[] = []
  for (const { name, path } of spec.files) {
    const file = Bun.file(path)
    if (!(await file.exists())) throw new Error(`${name} is gone from the attachments folder`)
    files.push({ bytes: new Uint8Array(await file.arrayBuffer()), name: basename(name) })
  }
  for (const file of files) {
    const refusal = await guarded(spec.channel, file)
    if (refusal) throw new Error(`${file.name}: ${refusal}`)
  }
  const count = await upload({
    channel: spec.channel,
    files,
    put: putOf(),
    slack: slackOf(token),
    thread: spec.thread,
  })
  console.log(`dm upload: shared ${count} files`)
}

if (import.meta.main)
  await main().catch((error: Error) => {
    console.error(`error: ${error.message}`)
    process.exit(1)
  })
