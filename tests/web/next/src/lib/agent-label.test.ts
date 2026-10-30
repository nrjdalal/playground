import { describe, expect, test } from "bun:test"

import { site } from "../../../../../packages/config/src/site"
import {
  agentLabel,
  chatLabel,
  homeTitle,
  labelOf,
  type LabelFacts,
  labelSplit,
  labelText,
  mention,
  setDispatcherOrder,
  messageRecipient,
  remarkMentions,
  withoutRef,
  withoutSenderName,
} from "../../../../../web/next/src/lib/agent-label"

const facts = (name: string, fields: Partial<LabelFacts> = {}): LabelFacts => ({
  branchTicket: null,
  kind: null,
  name,
  pr: null,
  task: null,
  ticket: null,
  title: null,
  worker: null,
  ...fields,
})

// the label follows the work, computed on every read from the board's facts; it closes on its role word, `<ticket>#<pr> <Kind>`, a worker's included.
describe("labelOf", () => {
  const none = () => undefined

  test("a worker's ticket and pull request read <ticket>#<pr> Worker", () => {
    const worker = facts("k3v9q2-worker", {
      kind: "worker",
      pr: { number: 118 },
      ticket: "PG-14",
    })
    expect(labelOf(worker, none)).toBe("PG-14#118 Worker")
  })

  test("a pull request alone reads #<pr> Worker, a ticket alone <ticket> Worker", () => {
    expect(labelOf(facts("a", { kind: "worker", pr: { number: 173 } }), none)).toBe("#173 Worker")
    expect(labelOf(facts("a", { kind: "worker", ticket: "PG-14" }), none)).toBe("PG-14 Worker")
  })

  test("the branch names the ticket before the roster does", () => {
    const worker = facts("a", { branchTicket: "PG-12", kind: "worker", ticket: "CEDAR-1" })
    expect(labelOf(worker, none)).toBe("PG-12 Worker")
  })

  test("before a ticket or a pull request, a session reads its title, else its first ask, then its kind", () => {
    expect(
      labelOf(facts("a", { kind: "worker", task: "Fix the rows", title: "Row wrap" }), none),
    ).toBe("Row wrap · worker")
    expect(labelOf(facts("a", { kind: "worker", task: "Fix the rows" }), none)).toBe(
      "Fix the rows · worker",
    )
    expect(labelOf(facts("a", { kind: "runner", task: "Keep the dashboard up" }), none)).toBe(
      "Keep the dashboard up · runner",
    )
  })

  test("a reviewer and a tester take their worker's ticket and pull request", () => {
    const worker = facts("k3v9q2-worker", {
      branchTicket: "PG-12",
      kind: "worker",
      pr: { number: 118 },
    })
    const workerOf = (name: string) => (name === worker.name ? worker : undefined)
    expect(
      labelOf(facts("b7k2mq-reviewer", { kind: "reviewer", worker: worker.name }), workerOf),
    ).toBe("PG-12#118 Reviewer")
    expect(labelOf(facts("b7k2mq-tester", { kind: "tester", worker: worker.name }), workerOf)).toBe(
      "PG-12#118 Tester",
    )
  })

  test("a checker whose worker the board does not hold reads its own facts", () => {
    const reviewer = facts("b7k2mq-reviewer", {
      kind: "reviewer",
      pr: { number: 9 },
      worker: "gone",
    })
    expect(labelOf(reviewer, none)).toBe("#9 Reviewer")
  })

  // A session reads by its role, never a light- name, and the two dispatchers read Alpha and Bravo.
  test("a manager reads its role word from its kind, and the dispatchers read Alpha and Bravo", () => {
    const names = [
      ["builder", "builder", "Builder"],
      ["ops", "ops", "Ops"],
      ["planner", "planner", "Planner"],
      ["optimizer", "optimizer", "Optimizer"],
      ["k3m9px-builder", "builder", "Builder"],
      ["dispatcher", "dispatcher", "Alpha"],
      ["dispatcher-2", "dispatcher", "Bravo"],
      ["m4n7vw-dispatcher", "dispatcher", "Alpha"],
      ["x7mh4d-ops", null, "Ops"],
      ["q8r2tx-planner", null, "Planner"],
      ["k3v9q2-optimizer", null, "Optimizer"],
    ] as const
    for (const [name, kind, label] of names)
      expect(labelOf(facts(name, { kind, pr: { number: 1 } }), none)).toBe(label)
  })

  test("a session with no kind keeps its name, and a kind with no task reads as its sidebar row does", () => {
    expect(labelOf(facts("worker-greed", { pr: { number: 197 } }), none)).toBe("Greed")
    expect(labelOf(facts("worker-glm-flash", { kind: "worker" }), none)).toBe(
      "No task yet · worker",
    )
    expect(labelOf(facts("b7k2mq-reviewer", { kind: "reviewer" }), none)).toBe(
      "No task yet · reviewer",
    )
  })
})

// A follow-up: a cell that cuts a long first ask keeps the kind after it whole.
describe("labelSplit", () => {
  const none = () => undefined

  test("a title or first ask keeps its kind apart, which labelOf joins with ` · `", () => {
    const ask = "Review the pull request that moves every reader of a name to its kind"
    const reviewer = facts("b7k2mq-reviewer", { kind: "reviewer", task: ask })
    expect(labelSplit(reviewer, none)).toEqual({ kind: "reviewer", text: ask })
    expect(labelOf(reviewer, none)).toBe(`${ask} · reviewer`)
  })

  test("a label with ids, a manager's name and a name carry no kind apart; a worker's title keeps its kind", () => {
    const worker = facts("a", { kind: "worker", pr: { number: 173 }, ticket: "PG-12" })
    expect(labelSplit(worker, none)).toEqual({ kind: null, text: "PG-12#173 Worker" })
    expect(labelSplit(facts("builder", { kind: "builder" }), none)).toEqual({
      kind: null,
      text: "Builder",
    })
    expect(labelSplit(facts("a", { kind: "worker", title: "Row wrap" }), none)).toEqual({
      kind: "worker",
      text: "Row wrap",
    })
    expect(labelSplit(facts("worker-greed"), none)).toEqual({ kind: null, text: "Greed" })
  })
})

describe("labelText", () => {
  test("is the one format: a manager's name, else the ids the label has and its role word, else none", () => {
    expect(labelText({ title: "Builder" })).toBe("Builder")
    expect(labelText({ kind: "worker", pr: 118, ticket: "PG-14" })).toBe("PG-14#118 Worker")
    expect(labelText({ kind: "worker", pr: null, ticket: "PG-14" })).toBe("PG-14 Worker")
    expect(labelText({ kind: "reviewer", pr: 118, ticket: "PG-14" })).toBe("PG-14#118 Reviewer")
    expect(labelText({ kind: "tester", pr: 118, ticket: "PG-14" })).toBe("PG-14#118 Tester")
    expect(labelText({ kind: "runner", pr: 173, ticket: null })).toBe("#173 Runner")
    expect(labelText({ kind: "worker", pr: null, ticket: null })).toBeNull()
  })
})

// A name reads as one word per name, its parts joined and capitalised, with no @.
describe("agentLabel", () => {
  test("spells the product's name as site.ts does, and no other word that shares its start", () => {
    expect(mention(site.name.toLowerCase())).toBe(site.name)
    expect(agentLabel(`${site.name.toLowerCase()}-dashboard`)).toBe(`${site.name}Dashboard`)
    expect(agentLabel("lightning")).toBe("Lightning")
    expect(agentLabel("worker-lighthouse")).toBe("Lighthouse")
    expect(agentLabel("light")).toBe("Light")
  })

  // a dispatcher's slot reads Alpha or Bravo, live or not
  test("the home's heading with no dispatcher live names its slot's label, never the name the API gives, and none before it gives one", () => {
    expect(homeTitle("dispatcher")).toBe("Alpha")
    expect(homeTitle("boss")).toBe("Alpha")
    expect(homeTitle(null)).toBeNull()
  })

  // "the sidebar, chat headings, sender labels and step lines read Alpha for dispatcher and Bravo for dispatcher-2"
  test("a chat's label: a dispatcher's Alpha or Bravo, else its model, with no session name; any other session's by its name", () => {
    const opus = {
      effort: "high",
      model: "claude-opus-5-5",
      name: "dispatcher",
      role: "dispatcher" as const,
    }
    const glm = {
      effort: "high",
      model: "glm-5.3-flash",
      name: "dispatcher-2",
      role: "dispatcher" as const,
    }
    expect(chatLabel(opus, "dispatcher")).toBe("Alpha")
    expect(chatLabel(glm, "dispatcher")).toBe("Bravo")
    setDispatcherOrder(["m4n7vw-dispatcher", "q8r2tx-dispatcher"])
    expect(chatLabel({ ...opus, name: "m4n7vw-dispatcher" }, "m4n7vw-dispatcher")).toBe("Alpha")
    expect(chatLabel({ ...glm, name: "q8r2tx-dispatcher" }, "m4n7vw-dispatcher")).toBe("Bravo")
    setDispatcherOrder([])
    // a dispatcher under a name no label holds (PLAYGROUND_DISPATCHER) reads by its model, never its name
    expect(chatLabel({ ...opus, name: "dashboard" }, "dashboard")).toBe("Opus 5.5 High")
    expect(chatLabel({ ...glm, name: "dashboard-2" }, "dashboard")).toBe("GLM 5.3 Flash High")
    expect(chatLabel({ ...glm, model: null, name: "dashboard-2" }, "dashboard")).toBe("Bravo")
    expect(chatLabel({ ...opus, model: null, name: "dashboard" }, "dashboard")).toBe("Alpha")
    for (const label of [chatLabel(opus, "dispatcher"), chatLabel(glm, "dispatcher")])
      expect(label.toLowerCase()).not.toContain("dispatcher")
    expect(chatLabel({ ...opus, name: "worker-greed", role: "worker" }, "dispatcher")).toBe("Greed")
  })

  test("a session's name reads as one word, with no @", () => {
    expect(agentLabel("brave-otter")).toBe("BraveOtter")
  })

  // A session reads by its role, never a light- name.
  test("a manager's or a dispatcher's name alone reads its role word", () => {
    expect(agentLabel("builder")).toBe("Builder")
    expect(agentLabel("ops")).toBe("Ops")
    expect(agentLabel("planner")).toBe("Planner")
    expect(agentLabel("optimizer")).toBe("Optimizer")
    expect(agentLabel("dispatcher")).toBe("Alpha")
    expect(agentLabel("dispatcher-2")).toBe("Bravo")
  })

  // an `<id>-<kind>` manager or dispatcher reads its role label, never its id.
  test("a manager's or a dispatcher's <id>-<kind> name reads its role label, a dispatcher's by its slot", () => {
    for (const [name, label] of [
      ["k3m9px-builder", "Builder"],
      ["x7mh4d-ops", "Ops"],
      ["q8r2tx-planner", "Planner"],
      ["k3v9q2-optimizer", "Optimizer"],
      ["m4n7vw-dispatcher", "Alpha"],
    ])
      expect(agentLabel(name)).toBe(label)
    setDispatcherOrder(["m4n7vw-dispatcher", "q8r2tx-dispatcher"])
    expect(agentLabel("q8r2tx-dispatcher")).toBe("Bravo")
    expect(agentLabel("m4n7vw-dispatcher")).toBe("Alpha")
    setDispatcherOrder([])
  })

  test("a role word the sidebar's group already says is dropped", () => {
    expect(agentLabel("worker-greed")).toBe("Greed")
    expect(agentLabel("worker-gluttony")).toBe("Gluttony")
    expect(agentLabel("runner-pride")).toBe("Pride")
    expect(agentLabel("probe-paste")).toBe("Paste")
    expect(agentLabel("consultant-sloth")).toBe("Sloth")
    expect(agentLabel("Worker-Lust")).toBe("Lust")
    expect(agentLabel("worker-labels-2")).toBe("Labels2")
  })

  test("an <id>-<kind> name drops its kind as an old name drops its role word", () => {
    expect(agentLabel("k3m9px-worker")).toBe("K3m9px")
    expect(agentLabel("b7k2mq-runner")).toBe("B7k2mq")
    expect(agentLabel("h4t8wz-probe")).toBe("H4t8wz")
    expect(agentLabel("night-worker")).toBe("NightWorker")
  })

  test("a reviewer or tester keeps its role, since it shares its worker's sin", () => {
    expect(agentLabel("reviewer-envy")).toBe("ReviewerEnvy")
    expect(agentLabel("tester-gluttony-97")).toBe("TesterGluttony97")
    expect(agentLabel("k3m9px-reviewer")).toBe("K3m9pxReviewer")
    expect(agentLabel("k3m9px-tester")).toBe("K3m9pxTester")
  })

  test("a role word alone, or one not at the start, is the name", () => {
    expect(agentLabel("worker")).toBe("Worker")
    expect(agentLabel("worker-")).toBe("Worker")
    expect(agentLabel("lead-worker")).toBe("LeadWorker")
    expect(agentLabel("workers-greed")).toBe("WorkersGreed")
  })

  test("a word that names an Object property is capitalised like any other", () => {
    expect(agentLabel("constructor")).toBe("Constructor")
    expect(agentLabel("worker-toString")).toBe("ToString")
    expect(agentLabel("__proto__")).toBe("Proto")
  })

  test("any other name is joined word by word, keeping the rest of each word", () => {
    expect(agentLabel("session 1b9436d3")).toBe("Session1b9436d3")
    expect(agentLabel("my_odd--name")).toBe("MyOddName")
    expect(agentLabel("greed")).toBe("Greed")
  })

  test("an address, an opaque id or no words at all is not a name, so it stays as it is", () => {
    expect(agentLabel("uds:/tmp/cc-socks/23210.sock")).toBe("uds:/tmp/cc-socks/23210.sock")
    expect(agentLabel("a1e70e17b7e32f9a6")).toBe("a1e70e17b7e32f9a6")
    expect(agentLabel("--")).toBe("--")
  })
})

describe("mention", () => {
  test("keeps every word, a role word included", () => {
    expect(mention("runner-pride")).toBe("RunnerPride")
    expect(mention("builder")).toBe("Builder")
  })
})

// The label already names the sender, so the text does not repeat it.
describe("withoutSenderName", () => {
  test("a message opening with its sender's own name drops it", () => {
    expect(withoutSenderName("builder: merged #197", "builder")).toBe("merged #197")
    expect(withoutSenderName("@Builder: merged", "builder")).toBe("merged")
    expect(withoutSenderName("BUILDER:\nmerged", "builder")).toBe("merged")
    expect(withoutSenderName("greed: done", "worker-greed")).toBe("done")
    expect(withoutSenderName("worker-greed: done", "worker-greed")).toBe("done")
  })

  test("only the name's own line break goes, so an indented code block keeps its indent", () => {
    expect(withoutSenderName("builder:\n    bun run test", "builder")).toBe("    bun run test")
  })

  test("another name, or the name later in the message, stays", () => {
    expect(withoutSenderName("ops: done", "builder")).toBe("ops: done")
    expect(withoutSenderName("ask builder: done", "builder")).toBe("ask builder: done")
    expect(withoutSenderName("builder said done", "builder")).toBe("builder said done")
  })
})

type Node = { children?: Node[]; type: string; url?: string; value?: string }

const linkify = (tree: Node, live: Record<string, string>) => {
  remarkMentions((name) => live[name.toLowerCase()] ?? null)()(tree)
  return tree
}

const paragraph = (value: string): Node => ({
  children: [{ children: [{ type: "text", value }], type: "paragraph" }],
  type: "root",
})

// None of these labels is clickable.
describe("remarkMentions", () => {
  const live = { greed: "/dashboard?worker=s1", builder: "/dashboard?worker=s2" }

  test("an @Name of a live agent becomes a link to its view, the words around it kept", () => {
    expect(linkify(paragraph("ask @Greed and @Builder's lead."), live).children?.[0]).toEqual({
      children: [
        { type: "text", value: "ask " },
        {
          children: [{ type: "text", value: "@Greed" }],
          type: "link",
          url: "/dashboard?worker=s1",
        },
        { type: "text", value: " and " },
        {
          children: [{ type: "text", value: "@Builder" }],
          type: "link",
          url: "/dashboard?worker=s2",
        },
        { type: "text", value: "'s lead." },
      ],
      type: "paragraph",
    })
  })

  test("a name no live agent has, an email address, code and a link's own text stay as written", () => {
    expect(linkify(paragraph("@Nobody at agent@greed"), live)).toEqual(
      paragraph("@Nobody at agent@greed"),
    )
    const code: Node = {
      children: [
        { type: "inlineCode", value: "@Greed" },
        { children: [{ type: "text", value: "@Greed" }], type: "link", url: "https://x.test" },
      ],
      type: "paragraph",
    }
    expect(linkify({ children: [code], type: "root" }, live).children?.[0]).toEqual(code)
  })
})

describe("messageRecipient", () => {
  test("a SendMessage step splits into its recipient and the rest", () => {
    expect(messageRecipient("to worker-wrath: Here is the roster module")).toEqual({
      rest: "Here is the roster module",
      to: "worker-wrath",
    })
    expect(messageRecipient("to dispatcher [3fa9c1]: done")).toEqual({
      rest: "done",
      to: "dispatcher [3fa9c1]",
    })
    expect(messageRecipient("to uds:/tmp/cc-socks/1.sock: hi")?.to).toBe("uds:/tmp/cc-socks/1.sock")
  })

  test("other text is not a message", () => {
    expect(messageRecipient("Run the tests")).toBeNull()
  })
})

describe("withoutRef", () => {
  test("a recipient's [ref] is dropped, leaving the name it addresses", () => {
    expect(withoutRef("dispatcher [3fa9c1]")).toBe("dispatcher")
    expect(withoutRef("worker-wrath")).toBe("worker-wrath")
  })
})
