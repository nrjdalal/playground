import { type Settings, slackSettings } from "@packages/settings"

import { noScopeHolds } from "./orgs"

// What a core command says when this Mac lacks a service it reaches, told apart by what is set up: Slack by its settings, the vault by the skill a scope holds.
export const SLACK_NOT_SET_UP =
  "Slack is not set up here: reach the owner through the Inbox with bun run ask new (an update)"
const VAULT_NOT_INSTALLED =
  "the vault is not installed: install an extension that holds the vault skill and link it to * (playground ext link <name> '*')"

// Slack is set up when the owner's DM and member id are, the two a post to the owner needs.
export const slackSetUp = (settings: Settings): boolean =>
  Boolean(slackSettings.get(settings, "slack.dmChannel")) &&
  Boolean(slackSettings.get(settings, "slack.dmOwner"))

// whichSkill's refusal for the vault, its no-scope case said as what to install; a policy's or a login's refusal reads as it is.
export const vaultRefusal = (refusal: string): string =>
  refusal === noScopeHolds("vault") ? VAULT_NOT_INSTALLED : refusal
