import type { PullProblem } from "@api/hono"

// What a stack reading its own machine says where an area has nothing to show: what is missing and what fills it, naming the button or page when the app has one and never a command, one line each, never invented rows (ADR 0008).
export type Setup = { description: string; title: string }

export const SETUP = {
  changelog: {
    description:
      "Merges and versions appear here once Playground's changelog sync has read them from GitHub.",
    title: "No changes yet",
  },
  github: {
    description:
      "Pull requests are read through GitHub's gh tool: the Settings page's checks set it up and sign it in.",
    title: "GitHub can't be read",
  },
  plan: {
    description:
      "It appears once bundles/plan.json exists in the Dashboard's data folder (PLAYGROUND_DATA_DIR).",
    title: "No plan yet",
  },
  sessions: {
    description:
      "Sessions appear here once Playground starts them, the first from the Dashboard's chat.",
    title: "No Claude Code sessions yet",
  },
  sessionsLog: {
    description: "Sessions appear here as Playground runs them.",
    title: "No sessions recorded yet",
  },
  unreachable: {
    description: "Run playground, which starts herdr, the terminal your sessions run in.",
    title: "Sessions can't be read",
  },
  usage: {
    description: "Usage appears here as Playground runs sessions.",
    title: "No usage yet",
  },
} as const satisfies Record<string, Setup>

// The codes the API gives a read of the sessions' terminal that failed: not installed, or not answering.
const READ_DOWN = new Set(["CMUX_FAILED", "CMUX_UNAVAILABLE"])

// Pure: the line an empty list of sessions shows: none for a refused source, whose alert names the reason; unreachable while the sessions cannot be read; else that no session runs yet.
export const sessionsSetup = (
  problem: { code: string } | null,
  liveProblem?: string | null,
): Setup | null => {
  if (problem?.code === "SOURCE_REFUSED") return null
  return (problem && READ_DOWN.has(problem.code)) || liveProblem
    ? SETUP.unreachable
    : SETUP.sessions
}

// Pure: the line the System page shows while no roster exists, naming the path the API reads it from, so it follows the folder wherever it is.
export const rosterSetup = (path: string): Setup => ({
  description: `Titles and ETAs appear once ${path} exists.`,
  title: "No agent roster yet",
})

// Pure: the line an empty Pull requests tab shows when its GitHub read failed, with the reason: the gh setup line only while gh is missing or logged out, since a spent budget or a refused query is not fixed by setting gh up; none while every read answered, so it never reads as none open.
export const pullsSetup = (problem: PullProblem | null): Setup | null => {
  if (!problem) return null
  const reason = problem.reason.replace(/\.$/, "")
  return problem.setup
    ? { ...SETUP.github, description: `${SETUP.github.description} The read failed: ${reason}.` }
    : { description: `The read failed: ${reason}.`, title: "GitHub refused the read" }
}
