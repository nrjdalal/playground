Claude plans and researches; GLM takes small, bounded build tasks outside the fenced paths, never a plan, a plan draft or research for a plan, and no reviewer or tester runs on it.
A Claude session writes each GLM task's brief with its files, its steps and a done-when for each, and the lead checks those files against the fence before the dispatch; a GLM worker that finds it needs a file outside the brief stops and reports before editing it.
No org's data reaches GLM: a GLM session reads and writes no org's tickets, repos, chat, docs or databases, and a job that touches them runs on Claude with every GLM variable cleared, since a child of a GLM shell inherits them.
While load5 is over {glm.readOnlyLoad5} a GLM session is read-only, and it waits for the load to fall or reports to its lead.
GLM's unused credits lapse at each reset, so a lead gives it the next eligible task while it has room.
The `no-glm-heavy-path` hook holds the fence and the load (scripts/hooks/README.md), and spawn.sh refuses a GLM reviewer, tester or org start (SESSIONS.md, Spawn).
