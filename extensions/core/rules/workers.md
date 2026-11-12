Every build, read or research a manager hands off runs in a worker session with a roster row, never a sub-agent of its own; a worker or checker may use a skill's fork or `code-review`'s two sub-agents, and nothing else.
A manager's settings deny it the Agent and Workflow tools, which takes both out of its session.
A worker starts through `scripts/spawn.sh` and reports to the manager that handed it the work, so every piece of work shows on the roster and the Dashboard, with no hidden helpers.
Edits in parallel go to one worker per set of files no other worker touches.
A skill's fork is one that holds its write tools back in the frontmatter `.agents/invocation.md` gives it, such as a read-only scan.
A fork or sub-agent starts any server or long-running process as a Bash background task, so it stops by its own handle (**signal**), and binds any server to 127.0.0.1.
scripts/README.md's spawn.sh section names the roles whose settings hold the deny, and ADR 0002 records why a read-only skill runs as a fork.
