# Writing docs pages

Every promoted skill has a human-facing page at `docs/playground/<name>.md`. It orients a person around one skill (what it is, when to reach for it, where it fits), so it explains the why and leaves the steps to `SKILL.md`. Re-sync it whenever the skill is added, renamed, or changes behaviour. No H1. Write one sentence per line: `bun run docs:wrap` rewraps every page here, and its pre-commit check refuses a page that breaks the rule.

Sections, in this order:

- **What it does**: the job in one sentence, then the defining constraint (the fact that makes this skill behave differently from the obvious default) as plain prose.
- **When to reach for it**: the invocation mode (typed, agent-fired, or both) and the trigger boundary. Branches go in a table.
- **A free-form middle** (optional, one to three short sections): whatever makes the skill click in its own vocabulary, such as the loop it runs or the artifact it produces.
- **Common questions**: questions actually asked, in bold, each answered beneath it. Keep the count honest to the evidence, and omit the section when there are none.
- **It's working if**: signals the reader can see in their own work, not checks on the skill's internals.
- **Where it fits**: the skill's role and the neighbouring skills it leans on.
