import { join } from "node:path"

import { type Settings, slackSettings } from "@packages/settings"

import { noScopeHolds, type OrgsIo, whichSkill } from "./orgs"

// What a core command says when this Mac lacks a service it reaches, told apart by what is set up: Slack by the owner's DM in the settings and the bundled slack extension in ext.bundled, the vault by the skill a scope holds.
export const SLACK_NOT_SET_UP =
  "Slack is not set up here: reach the owner through the Inbox with bun run ask new (an update)"
const VAULT_NOT_INSTALLED =
  "the vault is not installed: install an extension that holds the vault skill and link it to * (playground ext link <name> '*')"

// Slack is set up when the owner's DM and member id are, the two a post to the owner needs.
export const slackSetUp = (settings: Settings): boolean =>
  Boolean(slackSettings.get(settings, "slack.dmChannel")) &&
  Boolean(slackSettings.get(settings, "slack.dmOwner"))

// One of the slack skill's scripts, from whichever scope holds the skill (the bundled slack extension once ext.bundled turns it on); none holding it reads as Slack not set up here, a scope's slack skill without the script names that scope, and a policy's or a login's refusal reads as it is.
export const slackScript = async (
  io: OrgsIo,
  name: string,
): Promise<{ refusal?: undefined; script: string } | { refusal: string }> => {
  const slack = await whichSkill(io, "slack")
  if (slack.refusal !== undefined)
    return { refusal: slack.refusal === noScopeHolds("slack") ? SLACK_NOT_SET_UP : slack.refusal }
  const script = join(slack.dir, "scripts", name)
  if (await Bun.file(script).exists()) return { script }
  return {
    refusal: `the slack skill in the scope ${slack.from} holds no scripts/${name}, and it takes the bundled slack extension's place`,
  }
}

// whichSkill's refusal for the vault, its no-scope case said as what to install; a policy's or a login's refusal reads as it is.
export const vaultRefusal = (refusal: string): string =>
  refusal === noScopeHolds("vault") ? VAULT_NOT_INSTALLED : refusal
