import { z } from "zod"

import type { Kind } from "./settings"

// A revision's content, one shape for a write through the API and a revision in an export: every kind may carry each part, and its own part must hold something (a list its value, a skill its folder's files, a script its body or its folder's files, every other kind its body).
export const contentFields = {
  body: z.string().nullable(),
  files: z.record(z.string(), z.string()).nullable(),
  meta: z.record(z.string(), z.unknown()).nullable(),
  value: z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]).nullable(),
}

const hasFiles = (files: Record<string, string> | null) =>
  files !== null && Object.keys(files).length > 0

const requiredPart = (kind: Kind) =>
  kind === "list"
    ? { value: contentFields.value.refine((value) => value !== null, "a list holds a value") }
    : kind === "skill"
      ? {
          files: contentFields.files.refine(hasFiles, "a skill holds its folder's files"),
        }
      : {
          body: contentFields.body.refine(
            (body) => body !== null && body.trim() !== "",
            `a ${kind} holds a body`,
          ),
        }

export const contentSchemaFor = (kind: Kind) =>
  kind === "script"
    ? z
        .object(contentFields)
        .refine(
          (content) => hasFiles(content.files) || (content.body ?? "").trim() !== "",
          "a script holds a body or its folder's files",
        )
    : z.object({ ...contentFields, ...requiredPart(kind) })

// What is wrong with a revision's content for its kind, or undefined when nothing is.
export const contentProblem = (kind: Kind, content: unknown): string | undefined => {
  const parsed = contentSchemaFor(kind).safeParse(content)
  return parsed.success ? undefined : parsed.error.issues[0]!.message
}
