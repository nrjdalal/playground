import { z } from "zod"

// By relative path, as settings.ts imports, since tests outside the package import this file.
import { defineSettings } from "./settings"

const email = z.string().email()
// A short name a person gives an account, and the Keychain item a GLM key is kept under.
const label = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9._-]*$/,
    "a label of lowercase letters, digits, dots, dashes and underscores",
  )

// One Claude account the factory spends, keyed by its email (provider unset reads as claude): an ending one names its plan's end (null until known) and may lead the ending ones; a renewing one its billing day (null until known); the near-limit marks count it when nearLimit is set; its week's reset day and hour (UTC) stand in for a reading that gives none.
const claudeAccount = z.strictObject({
  email,
  ends: z.string().datetime({ offset: true }).nullable().optional(),
  endsFirst: z.boolean().optional(),
  label: label.optional(),
  nearLimit: z.boolean().optional(),
  provider: z.literal("claude").optional(),
  renews: z.number().int().min(1).max(31).nullable().optional(),
  weekReset: z
    .strictObject({ hour: z.number().min(0).lt(24), weekday: z.number().int().min(0).max(6) })
    .optional(),
})

// One Z.ai GLM key the factory spends, keyed by its label.
const glmAccount = z.strictObject({ label, provider: z.literal("glm") })

const account = z.union([claudeAccount, glmAccount])

export type Account = z.infer<typeof account>
export type Provider = "claude" | "glm"

// A row's provider, claude when it names none.
export const providerOf = (row: { provider?: string }): Provider =>
  row.provider === "glm" ? "glm" : "claude"

// The key a row is listed, logged in and kept in the Keychain by: a Claude row's email, a GLM row's label.
export const accountKey = (row: { email?: string; label?: string; provider?: string }): string =>
  (providerOf(row) === "glm" ? row.label : row.email) ?? ""

// The rows of one provider, in the setting's order.
export const accountsOf = <Row extends { provider?: string }>(
  rows: Row[],
  provider: Provider,
): Row[] => rows.filter((row) => providerOf(row) === provider)

// The accounts the factory moves between, the Keychain service their tokens are kept under, the model the usage scripts probe each one with, and the account whose full week the ops tick tells everyone about; none is set on a fresh install, so the usage scripts count only the login they read.
export const accountSettings = defineSettings({
  "models.probe": {
    default: "claude-haiku-4-5",
    description:
      "The model the usage scripts send one 1-token call to, as an account's own token, to read its 5-hour and week use from the reply's rate-limit headers.",
    schema: z.string().min(1),
  },
  "usage.accounts": {
    default: [],
    description:
      "The accounts the factory spends, any number of each provider: a Claude row by its email, in the order the login flip reads them, with its plan's end or billing day, whether the near-limit marks count it, and its week's reset; a GLM row (provider glm) by its label, the Keychain item its key is kept under.",
    schema: z
      .array(account)
      .refine(
        (rows) =>
          new Set(rows.map((row) => `${providerOf(row)}:${accountKey(row)}`)).size === rows.length,
        "each account is listed once",
      ),
  },
  "usage.keychainService": {
    default: "playground-claude-oauth",
    description:
      "The macOS Keychain service each account's long-lived token is kept under, one item an account by its email: spawn.sh's --account and the usage probes read it.",
    schema: z.string().regex(/^[A-Za-z0-9._-]+$/, "a Keychain service name"),
  },
  "usage.switchAccount": {
    default: "",
    description:
      "The account whose full week the ops tick tells the dispatchers and leads about, so the factory moves off it; empty for none.",
    schema: z.union([email, z.literal("")]),
  },
})
