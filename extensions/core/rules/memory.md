Everything you learn lands in this repo, as a PR or a line to your lead, so every session works better from what one learned.
A finding, a correction or a preference becomes a PR at the strongest layer it fits (**correction**), or a line to your lead to put in one.
Claude Code's auto-memory runs only for the trial's sessions, which spawn.sh starts with it on in the data folder's `memory/<role>/`; the shared settings files keep `autoMemoryEnabled` false, and `tests/scripts/factory-settings.test.ts` holds them to it.
A trial session's memory holds the verified rules and facts a later session of its role will need; changing state (a PR's head, an ETA, a load reading) lives in the roster and the handoffs.
AGENTS.md's Shipping a Playground PR holds how a learning lands, ADR 0009 (`.agents/adr/0009-learnings-live-in-the-repo.md`) records why, and ADR 0022 (`.agents/adr/0022-auto-memory-runs-as-a-reviewed-trial.md`) records the trial, its bar and its revert.
