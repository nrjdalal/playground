import { join } from "node:path"

import { type Settings, slackSettings } from "@packages/settings"

import { noScopeHolds, type OrgsIo, whichSkill } from "./orgs"

// What a core command says when this Mac lacks Slack, told apart by what is set up: the owner's DM in the settings, and the bundled slack extension turned on in ext.bundled.
export const SLACK_NOT_SET_UP =
  "Slack is not set up here: reach the owner through the Inbox with bun run ask new (an update)"

// Slack is set up when the owner's DM and member id are, the two a post to the owner needs.
export const slackSetUp = (settings: Settings): boolean =>
  Boolean(slackSettings.get(settings, "slack.dmChannel")) &&
  Boolean(slackSettings.get(settings, "slack.dmOwner"))

// One of the slack skill's scripts, from whichever scope holds the skill (the bundled slack extension once ext.bundled turns it on); none holding it reads as Slack not set up here, and a policy's or a login's refusal as it is.
export const slackScript = async (
  io: OrgsIo,
  name: string,
): Promise<{ refusal?: undefined; script: string } | { refusal: string }> => {
  const slack = await whichSkill(io, "slack")
  if (slack.refusal === undefined) return { script: join(slack.dir, "scripts", name) }
  return { refusal: slack.refusal === noScopeHolds("slack") ? SLACK_NOT_SET_UP : slack.refusal }
}
