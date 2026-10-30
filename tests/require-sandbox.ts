import { setSessionNames } from "../packages/config/src/kinds"
import { SEEDED_NAMES } from "./session-names"

// bunfig.toml preloads this into every bun test run from the repo root: a run outside packages/scripts/src/test-sandbox.ts reads and writes the real HOME and can start a real claude session (a red-first run opened 9 on the live herdr server), so it stops before any test file loads
if (!process.env.TEST_SANDBOX_HOME)
  throw new Error(
    "bun test runs only inside the test sandbox: run bun run test:file <paths>, or bun run test for the whole suite",
  )

// A machine past the switch, whose sessions.aliases hold the managers' old names, as most tests name them; a fresh install's case sets DEFAULT_SESSION_NAMES itself.
setSessionNames(SEEDED_NAMES)
