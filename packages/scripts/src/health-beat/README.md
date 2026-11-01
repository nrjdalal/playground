# health-beat

`bun run health-beat` prints the owner's health beat as text: a header at the time in `clock.ownerZone`, then one line each for the Mac's load and CPU idle share, its memory, the sessions of the last 2 hours by state, the ops jobs by heartbeat, and the battery.
It posts nothing: the session that runs the beat posts the text, and keeps its channel and token outside the repo.

The memory line reads what spawn.sh's memory gate reads, through ops-machine's `readMachine`: the pressure level (`kern.memorystatus_vm_pressure_level`) first, then the free share (`kern.memorystatus_level`).
It warns only when that gate would refuse a Claude start (a GLM start takes a stricter gate): a level other than 1 or 2, or a free share under the `gates.memoryFreeMin` setting (8% by default).
Reading the gate's own two figures keeps its warning in step with every start the gate refuses, where `memory_pressure`'s free percentage and the System panel's `vm_stat` figure each count memory their own way.
