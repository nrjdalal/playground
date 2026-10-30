import { z } from "zod"

import { defineSettings } from "@/settings"

const id = z.string().regex(/^[a-z0-9][a-z0-9.-]*$/, "a model id, such as claude-opus-5-5")

// The models sessions run on: adding one is a settings write, never a PR. spawn.sh reads these at each start, playground add checks --model against models.claude.
export const modelSettings = defineSettings({
  "models.checker": {
    default: "claude-opus-5-5",
    description:
      "The Claude model a reviewer or a tester runs on, and the one --model it takes, since its verdict gates a merge.",
    schema: id,
  },
  "models.claude": {
    default: ["claude-opus-5-5", "claude-fable-5-1", "claude-sonnet-5-5", "claude-haiku-5-5"],
    description: "The Claude models spawn.sh and playground add take with --model.",
    schema: z.array(id).min(1),
  },
  "models.default": {
    default: "claude-opus-5-5",
    description: "The Claude model a session runs on when its start names no --model.",
    schema: id,
  },
  "models.glm": {
    default: "glm-5.3-flash",
    description:
      "The GLM model a --backend glm session runs on, every model Claude Code asks for mapped to it.",
    schema: id,
  },
  "models.glmKeychainService": {
    default: "playground-glm",
    description:
      "The Keychain service a --backend glm session's Z.ai key is kept under, one item a usage.accounts GLM row by its label.",
    schema: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "a Keychain service name, such as playground-glm"),
  },
})
