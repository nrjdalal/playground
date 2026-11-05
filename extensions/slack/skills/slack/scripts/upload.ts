import { join } from "node:path"

import { REPO } from "../../../../../packages/scripts/src/ops-job/job"
import { check as publicLeak } from "../../../../../scripts/hooks/no-public-leak"
import { leakOf } from "./send"
import { call, type Slack, slackOf, tokenOf } from "./slack"

// The byte post to the URL Slack hands back, which takes no token.
export type Put = (
  url: string,
  bytes: Uint8Array<ArrayBuffer>,
) => Promise<{ ok: boolean; status: number }>

// A file to share: the name it shows in Slack, its bytes, and whether those bytes are text, so its words are guarded as a post's.
export type UploadFile = { bytes: Uint8Array<ArrayBuffer>; name: string; text: boolean }

export const putOf = (): Put => async (url, bytes) => {
  const res = await fetch(url, {
    body: new Blob([bytes]),
    method: "POST",
    signal: AbortSignal.timeout(60_000),
  })
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

export type Check = (raw: string) => Promise<string | undefined>

// The guards dm send runs on a post (no-playground-leak), and no-public-leak, on a file as one post to the channel would carry it: its name, and a text file's words too.
export async function guarded(
  channel: string,
  file: UploadFile,
  checks: { playground: (text: string) => Promise<string | undefined>; public: Check } = {
    playground: leakOf(channel),
    public: publicLeak,
  },
): Promise<string | undefined> {
  const text = file.text ? `${file.name}\n${new TextDecoder().decode(file.bytes)}` : file.name
  const raw = JSON.stringify({
    tool_input: { channel, text },
    tool_name: "mcp__slack-shared__chat_post_message",
  })
  return (await checks.playground(text)) ?? (await checks.public(raw))
}

// What the API's dashboard-upload.ts prints for one answered item: the place and the files read from the item itself.
export type Spec = {
  channel: string
  files: { bytes: string; name: string; text: boolean }[]
  thread?: string
}

// The spec of one item, read by this checkout's dashboard-upload.ts from its own database, in a process that never holds the token.
export const specOf = async (id: string): Promise<Spec> => {
  const child = Bun.spawn(["bun", join(REPO, "api/hono/src/bin/dashboard-upload.ts"), id], {
    cwd: REPO,
    stderr: "pipe",
    stdin: "ignore",
    stdout: "pipe",
  })
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (code !== 0) throw new Error(err.trim().split("\n").at(-1) || `dashboard-upload exit ${code}`)
  return JSON.parse(out) as Spec
}

// Shares one answered Inbox item's files, named by its id alone: the place and the files come from the item, every file is guarded before any is shared, and a refused one shares nothing.
export async function share(
  id: string,
  {
    check = guarded,
    put,
    read = specOf,
    slack,
  }: { check?: typeof guarded; put: Put; read?: (id: string) => Promise<Spec>; slack: Slack },
): Promise<number> {
  const spec = await read(id)
  const files = spec.files.map((file) => ({
    bytes: Uint8Array.from(Buffer.from(file.bytes, "base64")),
    name: file.name,
    text: file.text,
  }))
  for (const file of files) {
    const refusal = await check(spec.channel, file)
    if (refusal) throw new Error(`${file.name}: ${refusal}`)
  }
  return upload({ channel: spec.channel, files, put, slack, thread: spec.thread })
}

// its errors as one plain line, which the dashboard shows as the send's reason
if (import.meta.main) {
  const [id, ...extra] = process.argv.slice(2)
  try {
    if (!id || extra.length)
      throw new Error("usage: upload.ts <inbox item id>, run by playground dm upload")
    const count = await share(id, { put: putOf(), slack: slackOf(await tokenOf()) })
    console.log(`dm upload: shared ${count} files`)
  } catch (error) {
    console.error(`error: ${(error as Error).message}`)
    process.exit(1)
  }
}
