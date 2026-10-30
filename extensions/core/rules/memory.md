Everything you learn lands in this repo, as a PR or a line to your lead, so every session works better from what one learned.
A finding, a correction or a preference becomes a PR at the strongest layer it fits (**correction**), or a line to your lead to put in one.
Claude Code's auto-memory stays off, since a memory file serves one session on one machine and no review reads it.
`scripts/factory-settings.json` and `.claude/settings.json` set `autoMemoryEnabled` to false, and `tests/scripts/factory-settings.test.ts` holds both to it.
AGENTS.md's Shipping a Playground PR holds how a learning lands, and ADR 0009 (`.agents/adr/0009-learnings-live-in-the-repo.md`) records why.
