Load writing-for-agents with the Skill tool before your first write to an agent-facing doc, a brief or a handoff included.
Agent-facing means a `SKILL.md` and its sibling files, `AGENTS.md` and `CLAUDE.md`, an `.agents/dashboard` rule, `scripts/README.md` and `scripts/hooks/README.md`, a docs page, a handoff and a brief.
The skill keeps each such doc lean, with a completion criterion on every step, positive phrasing and reference disclosed into sibling files, so every agent that loads it takes the same path.
A docs page also follows `.agents/writing-docs.md`.
A PR body is written for the owner in the pr skill's template, so it sits outside this rule.
The reviewer scores each changed agent-facing doc against the skill.
A compaction clears the load, so the first write after one loads the skill again.
The `writing-first` hook refuses such a write until the skill is loaded (scripts/hooks/README.md, writing-first).
