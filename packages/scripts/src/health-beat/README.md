# health-beat

`bun run health-beat` prints the owner's health beat as text: a header at the time in `clock.ownerZone`, then one line each for the main checkout, the Dashboard, the Mac's load and CPU idle share, its memory, the sessions of the last 2 hours by state, the ops jobs by heartbeat, and the battery.
It posts nothing: the session that runs the beat posts the text, and keeps its channel and token outside the repo.

The two lines under the header say what this install runs, each naming the place it describes and the version it carries, as `running.ts` reads it:

```
🏷️ Main checkout: v0.0.23 + 1 local commit (8b6438a), behind main v0.0.25
🏗️ Dashboard: main build, at b73af937 (v0.0.25)
```

- `Main checkout:` is the main checkout's `git describe --tags`: the tag alone, or the tag with `+ N local commit(s) (<sha>)` when the checkout is ahead of it.
  `, behind main <tag>` follows when the checkout does not hold `origin/main`'s latest tag, as last fetched; a main tag the beat cannot read leaves it out.
- `Dashboard:` is the main checkout's branch, then `build` when the live Dashboard serves a production build or `dev server` when it serves one, then `, at <sha>` from the version its `/api/health` reports, then that sha's tag (the tag at it, or the nearest before it) in brackets.
  The kind comes from the process trees under the stack that holds `playground.localhost`'s port in portless's routes and under each process `lsof` finds listening on that port: a command run from a `/builds/<sha>/` path is a build, and `next dev` is a dev server.
  The listener counts on the live Dashboard, whose supervisor owns the route while the web it starts runs with ppid 1.
  The sha comes from `api.playground.localhost`'s port on loopback, and its tag from `git describe --tags --abbrev=0 <sha>` in the main checkout.
- A value the beat cannot read prints as unknown with its reason, never a guess.

Each read leaves the machine as it was: up to five git reads of the main checkout, portless's `routes.json`, one `ps`, one `lsof` of the web's port and one GET, with no process signalled or selected for any action.

The memory line reads what spawn.sh's memory gate reads, through ops-machine's `readMachine`: the pressure level (`kern.memorystatus_vm_pressure_level`) first, then the free share (`kern.memorystatus_level`).
It warns only when that gate would refuse a Claude start (a GLM start takes a stricter gate): a level other than 1 or 2, or a free share under the `gates.memoryFreeMin` setting (8% by default).
Reading the gate's own two figures keeps its warning in step with every start the gate refuses, where `memory_pressure`'s free percentage and the System panel's `vm_stat` figure each count memory their own way.

The ops jobs line leaves out a job `jobs.json` marks `disabled: true`, a pause on purpose, and calls a job down when its heartbeat file is missing, does not parse or holds no `lastBeatAt`, as the Dashboard's Ops list does, so a job meant to run that never started warns.
