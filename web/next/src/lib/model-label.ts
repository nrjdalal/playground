// Pure, with no app import, so verify's checks read the same labels the dashboard draws.
import { DISPATCHER_SLOT_LABELS } from "@packages/config/kinds"

type ModelFacts = { effort: string | null; model: string | null }

const MODEL_FAMILIES: Record<string, string> = {
  fable: "Fable",
  haiku: "Haiku",
  opus: "Opus",
  sonnet: "Sonnet",
}

const MODEL_ID = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:\[[^\]]*\])?$/

const GLM_ID = /^glm-(\d+\.\d+)((?:-[a-z]+)*)(?:\[[^\]]*\])?$/

const capitalise = (word: string): string => `${word.charAt(0).toUpperCase()}${word.slice(1)}`

// Pure: a model id as people say it (claude-opus-5-5 reads Opus 5.5, claude-haiku-4-5-20251001 Haiku 4.5, glm-5.3-flash GLM 5.3 Flash), else the id as written; null when none is known.
export const modelName = (model: string | null): string | null => {
  if (!model) return null
  const glm = GLM_ID.exec(model)
  if (glm)
    return ["GLM", glm[1], ...(glm[2] ?? "").split("-").filter(Boolean).map(capitalise)].join(" ")
  const match = MODEL_ID.exec(model)
  const family = match ? MODEL_FAMILIES[match[1] ?? ""] : undefined
  if (!match || !family) return model
  return `${family} ${match[2]}${match[3] ? `.${match[3]}` : ""}`
}

// Pure: whether a model id is one of Z.ai's GLM models, whose usage the Claude windows do not reflect.
export const isGlmModel = (model: string | null): boolean => Boolean(model && GLM_ID.test(model))

// A model's maker, whose logo its row draws (PROVIDER_ICONS).
export type Provider = "anthropic" | "zai"

// Pure: who makes a model, for its row's logo: Anthropic for a Claude id, Z.ai for a GLM one, else null.
export const providerOf = (model: string | null): Provider | null =>
  model?.startsWith("claude-") ? "anthropic" : isGlmModel(model) ? "zai" : null

// Pure: a dispatcher no label names (chatLabel's fallback), from its newest reply alone: that reply's model and effort, each word capitalised (Opus 5.5 High, GLM 5.3 Flash High). With no reply read yet, or its session down, the slot's label: Alpha for the primary, Bravo for the other.
export const dispatcherLabel = (facts: ModelFacts | null, primary: boolean): string => {
  const name = facts ? modelName(facts.model) : null
  if (!name) return DISPATCHER_SLOT_LABELS[primary ? 0 : 1]
  return facts?.effort ? `${name} ${capitalise(facts.effort)}` : name
}
