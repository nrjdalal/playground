import { z } from "zod"

import { apiClient, unwrap } from "@/lib/api/client"

// The two settings Settings > Privacy holds: the names you go by, and the archive repository whose links are private history; trace-count counts nothing while either is unset.
export const PRIVACY_KEYS = { archive: "factory.archiveRepo", names: "owner.names" } as const

export type PrivacyKey = (typeof PRIVACY_KEYS)[keyof typeof PRIVACY_KEYS]

export const privacyQueryKey = (key: PrivacyKey) => ["setting", key] as const

const NAME = /^[a-z0-9][a-z0-9._-]*$/

// Pure: the names as typed, one list: split at commas and spaces, lowercase, each once.
export const namesOf = (text: string): string[] => [
  ...new Set(
    text
      .toLowerCase()
      .split(/[\s,]+/)
      .filter(Boolean),
  ),
]

// The Privacy form: names as one line, the archive as owner/name or empty, each checked as its setting's schema checks it.
export const privacyFormSchema = z.object({
  archive: z
    .string()
    .trim()
    .regex(/^(?:[A-Za-z0-9-]+\/[A-Za-z0-9._-]+)?$/, "A repository as owner/name"),
  names: z
    .string()
    .refine(
      (text) => namesOf(text).every((name) => NAME.test(name)),
      "Letters, digits, dots, dashes and underscores, separated by commas",
    ),
})

export type PrivacyForm = z.input<typeof privacyFormSchema>

// Pure: each field's setting and value, in key order.
export const privacyValues = (form: PrivacyForm) => [
  { key: PRIVACY_KEYS.archive, value: form.archive.trim() },
  { key: PRIVACY_KEYS.names, value: namesOf(form.names) },
]

// Pure: what PUT /api/v1/settings/:key takes to save one field at your login's scope.
export const privacyWrite = (key: PrivacyKey, value: string | string[], scope: string) => ({
  json: { by: "Settings", reason: `Set ${key} in Settings > Privacy`, scope, value },
  param: { key },
})

// GET one setting's value as a session of your login reads it.
export const readPrivacySetting = async (key: PrivacyKey): Promise<unknown> => {
  const { data, error } = await unwrap(
    apiClient.v1.settings[":key"].$get({ param: { key }, query: {} }),
  )
  if (error) throw new Error(error.message)
  return data.value
}

// PUT one field's setting at your login's scope.
export const savePrivacySetting = async (
  key: PrivacyKey,
  value: string | string[],
  scope: string,
) => {
  const { error } = await unwrap(
    apiClient.v1.settings[":key"].$put(privacyWrite(key, value, scope)),
  )
  if (error) throw new Error(error.message)
}
