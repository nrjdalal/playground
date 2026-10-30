import {
  DISPATCHER_SLOT_LABELS,
  dispatcherLabelOfName,
  isManagerKind,
  kindOfName,
  type ManagerKind,
  managerKindOfName,
  ROSTER_ROLE_OF_KIND,
  type RosterKind,
} from "@packages/config/kinds"
import { site } from "@packages/config/site"

import { dispatcherLabel } from "./model-label"

// What is not a name, so is shown as written: an address (a peer's `uds:` socket) or an opaque id (a subagent's `a1e70e17b7e32f9a6`).
const NOT_A_NAME = /[:/]|^a?[0-9a-f]{16,}$/

// One word as people read it: the product's name as site.ts spells it, with a capital M, else its first letter capitalised.
const capitalise = (word: string): string =>
  word.toLowerCase() === site.name.toLowerCase()
    ? site.name
    : `${word.charAt(0).toUpperCase()}${word.slice(1)}`

// A manager and a dispatcher read by role, never by name.
const MANAGER_LABELS: Record<ManagerKind, string> = {
  builder: "Builder",
  ops: "Ops",
  optimizer: "Optimizer",
  planner: "Planner",
}

// The dispatchers' names in slot order, as the dashboard's frame gives them (setDispatcherOrder), so an `<id>-dispatcher` reads its slot's label.
let dispatcherOrder: readonly string[] = []

// Set from each dashboard frame's dispatchers, the primary's name first, before the board draws.
export const setDispatcherOrder = (names: readonly string[]): void => {
  dispatcherOrder = names
}

// A dispatcher's label: its slot's in the dashboard's order, else its set name's (dispatcherLabelOfName), else the first slot's, which an `<id>-dispatcher` holds by default.
const dispatcherRole = (name: string): string => {
  const slot = dispatcherOrder.indexOf(name)
  return DISPATCHER_SLOT_LABELS[slot] ?? dispatcherLabelOfName(name) ?? DISPATCHER_SLOT_LABELS[0]
}

// A manager's role word, by its kind or else its name, so a builder under any name reads Builder; a dispatcher's, a set name or an `<id>-dispatcher`, Alpha or Bravo by its slot; null for any other session, a dispatcher under another name (PLAYGROUND_DISPATCHER) included, which its chat names by its model.
export const roleLabel = (name: string, kind: RosterKind | null = null): string | null => {
  const manager = isManagerKind(kind) ? kind : managerKindOfName(name)
  if (manager) return MANAGER_LABELS[manager]
  return dispatcherLabelOfName(name) || kindOfName(name) === "dispatcher"
    ? dispatcherRole(name)
    : null
}

// A role word the label leaves to the sidebar's group and the raw name on hover; a reviewer or tester keeps its role, since it shares its worker's sin (ReviewerEnvy).
const ROLE_WORD = /^(?:consultant|probe|runner|worker)[-_\s]+(?=[^-_\s])/i

// An `<id>-<kind>` name without its kind, left to the sidebar's group as a role word is, so `k3m9px-worker` reads "K3m9px"; a reviewer or tester keeps its role, as above. kindOfName reads an old name's prefix as its kind too, and an id holds no vowel, so it never starts with a kind.
export const withoutIdKind = (name: string): string => {
  const kind = kindOfName(name)
  return kind && kind !== "reviewer" && kind !== "tester" && !name.startsWith(`${kind}-`)
    ? name.slice(0, -`-${kind}`.length)
    : name
}

// A session's name as people read it, one word with no @: a manager's or a dispatcher's role word (roleLabel), else the role word or an id's kind dropped and each dash- or space-separated word capitalised and joined, so `worker-gluttony` reads "Gluttony", `brave-otter` "BraveOtter" and `builder` "Builder".
export const agentLabel = (name: string): string =>
  NOT_A_NAME.test(name)
    ? name
    : (roleLabel(name) ?? mention(withoutIdKind(name).replace(ROLE_WORD, "")))

// A name as one word, every word kept: `runner-pride` reads "RunnerPride".
export const mention = (name: string): string => {
  const words = name.split(/[-_\s]+/).filter(Boolean)
  return words.length ? words.map(capitalise).join("") : name
}

// What a session's label is read from: the board's facts about it (the API's Agent).
export type LabelFacts = {
  branchTicket: string | null
  kind: RosterKind | null
  name: string
  pr: { number: number } | null
  task: string | null
  ticket: string | null
  title: string | null
  worker: string | null
}

// A label in parts, so a row can colour its pull request's number: a manager's role word or the dispatcher's label alone (title), else the kind with the ticket and the pull request the work has so far.
export type LabelParts =
  | { kind: RosterKind; pr: number | null; ticket: string | null }
  | { title: string }

// Pure: a session's label in parts, or null for one with no kind, which keeps its name. A manager reads its role word, by its kind (roleLabel). A reviewer or tester takes its worker's ticket and pull request, through the roster's worker key, so a worker and its checkers read `AB-262#7 Worker`, `AB-262#7 Reviewer` and `AB-262#7 Tester`; the ticket comes from the branch first (the API's branchTicket), else the roster.
export const labelParts = (
  agent: LabelFacts,
  workerOf: (name: string) => LabelFacts | undefined,
): LabelParts | null => {
  const { kind } = agent
  if (!kind) return null
  if (ROSTER_ROLE_OF_KIND[kind] === "manager")
    return { title: roleLabel(agent.name, kind) ?? agentLabel(agent.name) }
  const checker = kind === "reviewer" || kind === "tester"
  const work = (checker && agent.worker ? workerOf(agent.worker) : undefined) ?? agent
  return { kind, pr: work.pr?.number ?? null, ticket: work.branchTicket ?? work.ticket }
}

// A kind as a label closes on it, its role word: `Worker`, `Reviewer`.
export const kindWord = (kind: RosterKind): string => capitalise(kind)

// Pure: a label's text from its parts as plain text, the format RowFirst in the sidebar draws in parts to colour the number: a manager's role word, else `<ticket>#<pr> <Kind>` with whichever of the two it has (`AB-164#7 Worker`, `AB-164 Worker`), or null with neither, where the session's title leads and its kind follows (` · <kind>`).
export const labelText = (parts: LabelParts): string | null => {
  if ("title" in parts) return parts.title
  if (!parts.ticket && parts.pr === null) return null
  return `${parts.ticket ?? ""}${parts.pr !== null ? `#${parts.pr}` : ""} ${kindWord(parts.kind)}`
}

// Pure: labelOf in two parts, its text and the kind that follows a title, so a cell that cuts the text keeps the kind whole (a follow-up: a long first ask hid "· reviewer").
export const labelSplit = (
  agent: LabelFacts,
  workerOf: (name: string) => LabelFacts | undefined,
): { kind: RosterKind | null; text: string } => {
  const parts = labelParts(agent, workerOf)
  if (!parts) return { kind: null, text: agentLabel(agent.name) }
  if ("title" in parts) return { kind: null, text: parts.title }
  const text = labelText(parts)
  return text
    ? { kind: null, text }
    : { kind: parts.kind, text: agent.title ?? agent.task ?? "No task yet" }
}

// Pure: the label people read for a session, computed on every read and never stored, so it follows the work: labelText, else its title or first ask (No task yet with neither, as its sidebar row reads) then ` · <kind>`, and a session with no kind by its name (agentLabel).
export const labelOf = (
  agent: LabelFacts,
  workerOf: (name: string) => LabelFacts | undefined,
): string => {
  const { kind, text } = labelSplit(agent, workerOf)
  return kind ? `${text} · ${kind}` : text
}

// The dashboard home's heading while the primary dispatcher's chat cannot open: its slot's label, Alpha, never the name the API gives; none until the API has named it.
export const homeTitle = (dispatcher: string | null): string | null =>
  dispatcher === null ? null : dispatcherLabel(null, true)

// A session as its chat names it, in its heading and its composer: a dispatcher by its label, Alpha or Bravo, else by its model (dispatcherLabel), the primary's or the second's, whose name the API gives as primary; any other session by its label.
export const chatLabel = (
  worker: { effort: string | null; model: string | null; name: string; role: string },
  primary: string | null,
): string =>
  worker.role === "dispatcher"
    ? (roleLabel(worker.name) ??
      dispatcherLabel(worker, primary === null || worker.name === primary))
    : agentLabel(worker.name)

// A peer's message that opens with its sender's own name or label ("builder: done", "Builder: done", "@Builder: done") drops it, since the label above the message already names the sender.
export const withoutSenderName = (text: string, sender: string): string => {
  const match = /^\s*@?([\w-]+)[ \t]*:[ \t]*(?:\r?\n)?/.exec(text)
  if (!match) return text
  const said = (match[1] ?? "").toLowerCase()
  const own = said === sender.toLowerCase() || said === agentLabel(sender).toLowerCase()
  return own ? text.slice(match[0].length) : text
}

type MdNode = { children?: MdNode[]; type: string; url?: string; value?: string }

// An @Name in a session's words, written as its label or its raw name in any case; its trailing hyphen is not part of it.
const MENTION = /(^|[^\w@])@([A-Za-z0-9][\w-]*[A-Za-z0-9]|[A-Za-z0-9])/g

// A remark plugin that turns each @Name a session wrote into a link to that agent's view, as the sender label links: href gives the view for a mention that names a live agent, else null and the words stay as written. Code and the text of a link are left alone.
export const remarkMentions =
  (href: (mention: string) => string | null) => () => (tree: MdNode) => {
    const walk = (node: MdNode) => {
      if (!node.children || node.type === "link" || node.type === "linkReference") return
      node.children = node.children.flatMap((child): MdNode[] => {
        if (child.type !== "text") {
          walk(child)
          return [child]
        }
        const value = child.value ?? ""
        const parts: MdNode[] = []
        let last = 0
        for (const match of value.matchAll(MENTION)) {
          const url = href(match[2] ?? "")
          if (!url) continue
          const start = (match.index ?? 0) + (match[1] ?? "").length
          if (start > last) parts.push({ type: "text", value: value.slice(last, start) })
          const mention = `@${match[2]}`
          parts.push({ children: [{ type: "text", value: mention }], type: "link", url })
          last = start + mention.length
        }
        if (!parts.length) return [child]
        if (last < value.length) parts.push({ type: "text", value: value.slice(last) })
        return parts
      })
    }
    walk(tree)
  }

// A recipient as SendMessage takes it may carry its ` [ref]`; the session it names goes by the name alone.
export const withoutRef = (to: string): string => to.trim().replace(/\s*\[[^\]]*\]$/, "")

// A SendMessage step reads `to <recipient>: <first line>`, the recipient optionally carrying its ` [ref]`; split, so the recipient can be shown by its label.
export const messageRecipient = (text: string): { rest: string; to: string } | null => {
  const match = /^to (\S+(?: \[[^\]]+\])?): ([\s\S]*)$/.exec(text)
  return match ? { rest: match[2] ?? "", to: match[1] ?? "" } : null
}
