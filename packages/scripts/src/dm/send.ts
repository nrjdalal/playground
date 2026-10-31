import { dataDirOf } from "@packages/env/data-dir"
import { readPolicy, slackSettings } from "@packages/settings"

import { check } from "../../../../scripts/hooks/no-playground-leak"
import { call, history, type Message, PLAYGROUND, type Slack, slackOf, USER } from "./slack"

type Io = {
  body: string
  channel: string
  leak: (body: string) => Promise<string | undefined>
  owner: string
  slack: Slack
}

const ours = (m: Message | undefined, owner: string, text: string) =>
  m?.user === owner && !m.subtype && m.text === text

const post = async (slack: Slack, channel: string, text: string) =>
  (await call(slack, "chat.postMessage", { channel, text })).ts!

// One reply to the owner in three posts, one at a time so they land in order: the PLAYGROUND line, the body, the USER line. It refuses a body no-playground-leak refuses, posting nothing.
export async function send({ body, channel, leak, owner, slack }: Io): Promise<string> {
  const refusal = await leak(body)
  if (refusal) throw new Error(refusal)
  const [before, latest] = await history(slack, { channel, limit: "2" })
  const last = latest ?? before
  // our last reply's USER line becomes this reply's PLAYGROUND line only while it is still the DM's latest message; a lone PLAYGROUND line a repair left opens this reply as it is
  let mark: string | undefined = last?.ts
  if (ours(last, owner, USER) || ours(last, owner, PLAYGROUND)) {
    if (last!.text === USER)
      await call(slack, "chat.update", { channel, text: PLAYGROUND, ts: last!.ts })
    mark = latest ? before?.ts : undefined
  } else await post(slack, channel, PLAYGROUND)
  const bodyTs = await post(slack, channel, body)
  const userTs = await post(slack, channel, USER)
  // an owner message that landed between the body and the USER line: the body ends with the USER line instead, and the USER post opens our reply to it
  const between = await history(slack, {
    channel,
    inclusive: "false",
    latest: userTs,
    oldest: bodyTs,
  })
  if (between.some((m) => m.user === owner && !m.subtype)) {
    await call(slack, "chat.update", { channel, text: `${body}\n${USER}`, ts: bodyTs })
    await call(slack, "chat.update", { channel, text: PLAYGROUND, ts: userTs })
  }
  if (mark) await call(slack, "conversations.mark", { channel, ts: mark })
  return bodyTs
}

// The check no-playground-leak runs on the same post through the Slack tools, so dm send refuses what the hook refuses.
export const leakOf = (channel: string) => (body: string) =>
  check(
    JSON.stringify({
      tool_input: { channel, text: body },
      tool_name: "mcp__slack-shared__chat_post_message",
    }),
  )

// its errors as one plain line, which dm send's caller reads whole
const main = async () => {
  const file = process.argv[2]
  const token = process.env.SLACK_TOKEN
  if (!file || !token)
    throw new Error("usage: SLACK_TOKEN=<token> send.ts <file>, run by playground dm send")
  const policy = await readPolicy(dataDirOf(process.env))
  if (policy.refusal !== undefined) throw new Error(`the settings refuse: ${policy.refusal}`)
  const channel = slackSettings.get(policy.settings, "slack.dmChannel")
  const owner = slackSettings.get(policy.settings, "slack.dmOwner")
  if (!channel || !owner) throw new Error("slack.dmChannel and slack.dmOwner must both be set")
  const ts = await send({
    body: (await Bun.file(file).text()).trimEnd(),
    channel,
    leak: leakOf(channel),
    owner,
    slack: slackOf(token),
  })
  console.log(`dm send: posted, body at ${ts}`)
}

if (import.meta.main)
  await main().catch((error: Error) => {
    console.error(`error: ${error.message}`)
    process.exit(1)
  })
