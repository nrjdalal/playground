Every heavy run (a suite, a type check, a lint guard, Checks, a build, an install or a `node_modules` clone), a fork's included, goes through `~/.playground/ops/run-slot.sh <your name> -- <command>`.
run-slot waits for a free slot and enough load units, and gives the slot back however the command ends, so heavy runs share the machine instead of piling onto it.
A run counts its item's size in load units, small, medium or big, but a light run (an install, a push, a filtered `turbo run`, a short test run) counts small whatever its item's size, and a share of the units stays for small runs and the runs that gate a merge, so a big run never blocks a small one.
The queue serves the work org's runs first, then the runs that gate a merge, then the rest, each small before big and oldest first, and a ticket that has waited long keeps its place.
A test, type check, lint or format check goes to the runner host and prints the same output with the same exit code, while a browser, `verify`, an install, docker and a build stay on the Mac.
Another factory on this machine shares the slots too: each live run in an ops folder `slots.peers` lists holds its units here, read only, so this factory's runs wait while the other's hold the machine.
A model-bound run (one that mostly waits on a model, such as a parity replay) takes `run-slot.sh <your name> --model-bound -- <command>` and holds one of the model slots (`slots.modelBound`, 2 by default) outside the queue, the box and the load units, so it never holds a CPU slot while its CPU idles, and ops-flow judges its holder by a 2-hour limit.
A commit, a merge, a push, a clone, its `bun install --ignore-scripts`, a short test run and any command that ended in 10 s or less its last 3 times take quick slots outside the queue, so a run of a few seconds never waits behind a suite.
A slot is for a short run: run-slot refuses a command that never exits, so a dev stack starts as a background task outside it.
A queued run reads the worktree as it stands when its slot frees, so its result is for the head it ran on, which `git rev-parse HEAD` names once it starts.
Before you name what drove a load spike, count the kernel's idle kills across it, since runnable processes can drive the load while the CPU idles.
A script that may be running changes only by moving a new file over it, since bash reads a running script as it goes.
scripts/ops/README.md holds the how: its run-slot.sh row and its run-slot, Ops switches and runner-host sections.
