// The settings keys a guard reads to allow or deny a call, and the ticket card's, which turn on what the factory shows, A to Z: no-extensions-write refuses a session's write of each (its GUARD_KEYS, which its test holds equal to this list), and of every jobs.<name>, and a guard decision's Approve in the Inbox is the owner's way to set one.
export const GUARD_SETTING_KEYS = [
  "ext.links",
  "ext.order",
  "ext.repos",
  "factory.archiveRepo",
  "factory.publicRepo",
  "glm.readOnlyLoad5",
  "live.branch",
  "owner.names",
  "paths.codeRoot",
  "sessions.aliases",
  "sessions.names",
  "slack.gatedSends",
  "ticketCard.approvals",
  "ticketCard.deployedStates",
  "ticketCard.diaryDir",
  "ticketCard.linesFile",
  "ticketCard.linkBase",
  "ticketCard.prefixes",
  "ticketCard.reopenedFile",
  "ticketCard.skipsFile",
  "ticketCard.title",
  "ticketCard.verdictsFile",
  "ticketCard.window",
  "usage.keychainService",
] as const

export type GuardSettingKey = (typeof GUARD_SETTING_KEYS)[number]
