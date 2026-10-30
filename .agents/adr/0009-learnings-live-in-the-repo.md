# Learnings live in the repo, not in Claude Code's memory

Until 7 Oct 2026 sessions kept what they learned in Claude Code's auto-memory, one folder per project under `~/.claude/projects/*/memory`: 310 files across six projects, read only by sessions started in that one project, and never reviewed. The owner's reason: learnings go to the repo, so every session works better for them.

## Decision

A session writes no memory file. A learning becomes a PR to this repo (a skill, a brief template, AGENTS.md, a check), or a line to its lead to put in one, and goes through the gate like any other change. The **correction** rule in playbook drops its fourth layer, memory, and gains the **memory** rule. One issue lands the existing memories (each kept, dropped or refused for private content), then turns auto-memory off with `autoMemoryEnabled: false` in `scripts/factory-settings.json` and `.claude/settings.json`, then archives the folders (moved, never deleted). The setting stops a session reading the folders as well as writing them, so it lands only once every kept memory is in the repo, and no session loses a memory the repo does not hold yet.

The upstream skills in core are the one outside source the Standalone rule allows: our skills and briefs call them through the Skill tool, never forking one, since a fork drifts from upstream and a call keeps what they improve. The repo holds them only as a pinned copy, whole and unchanged ([ADR 0014](0014-upstream-skills-are-vendored-byte-for-byte.md)), which is no fork: nothing edits it but a re-vendor.

## Consequences

- Every session reads the same rules, wherever it runs, and a learning gets a review before it binds anyone.
- A learning waits for a merge and a ship before an installed skill carries it; a lead puts an urgent one in a brief meanwhile.
- Private facts (secrets, customer data, production numbers) that a memory could hold have no home in the repo; they stay out, or go to 1Password through vault.
