# Decisions register

One line per finalized decision, the decision in one sentence, then `->` and its link: an ADR path under `.agents/adr/`, or an issue number. The guard at `tests/scripts/decisions-register.test.ts` holds every link target, and the **context** rule's after-compact reread reads this file, so a settled decision is carried, not re-litigated.

- Slack links go in messages as link chips in their full shape, never bare URLs; the `no-bare-slack-link` hook refuses a bare one -> #761
- An org's scope is its ticket and its product team's decisions; creative liberty is Playground's alone, since an org has its own process -> #714
- Labs is the spec for behaviour and the Product team answers its product questions, as triage-and-implement's Labs line holds -> #714
- An idle worker or runner of 200k+ tokens is compacted before its cache expires, a trial its A/B keeps or reverts -> .agents/adr/0020-an-idle-session-compacts-before-its-cache-expires.md
- A fixture stack's hosted session gets the stack's own PLAYGROUND_DATA_DIR, never the live data folder -> .agents/dashboard/messages.md
