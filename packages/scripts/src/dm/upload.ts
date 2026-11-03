import { check as publicLeak } from "../../../../scripts/hooks/no-public-leak"
import { leakOf } from "./send"
import { call, type Slack } from "./slack"

// The byte post to the URL Slack hands back, which takes no token.
export type Put = (
  url: string,
  bytes: Uint8Array<ArrayBuffer>,
) => Promise<{ ok: boolean; status: number }>

// A file to share: the name it shows in Slack, its bytes, and whether those bytes are text, so its words are guarded as a post's.
export type UploadFile = { bytes: Uint8Array<ArrayBuffer>; name: string; text: boolean }

export const putOf =
  (): Put =>
  async (url, bytes) => {
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
    if (!posted.ok) throw new Error(`the bytes of ${file.name} did not upload: HTTP ${posted.status}`)
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
