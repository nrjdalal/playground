# When `dev:stop` or a second start refuses

This page says what the launcher records, what `dev:stop` may signal, and what each refusal names.

## The record

The launcher claims `.turbo/dev.pgid` before its checks, with its pid, process group and start time (read in UTC, so a caller's TZ never changes it). While it runs, it adds each task group turbo starts, with its leader's pid and start time, every 2s. It clears the record as it leaves, but keeps it while a recorded group still holds a process of the checkout, so a launcher killed with no stop leaves its groups on record. A dry run records nothing.

A recorded group is the stack's while a member works in the checkout and either a process with its leader's pid runs with the recorded start time, or the leader has exited (no pid equal to a group id in use is handed out). A leader pid running with another start time is a new process: the group is left alone, and, once the launcher has gone, named as reused.

## A second start

A second `bun run dev` in the checkout refuses while the recorded launcher still runs, or, once it has gone, while its own group or a recorded group still holds a process of the checkout. It names that group's pids: for a recorded group with `bun run dev:stop`, which ends it, and for the launcher's own group with where they started, since `dev:stop` only lists that group.

## What `dev:stop` signals

While the launcher runs, `dev:stop` signals only when it is the recorded launcher, the same pid and start time, running from this checkout in the recorded group, and that group is not this command's own; otherwise it refuses and signals nothing. Then it sends SIGTERM to the launcher's group and, after up to 15s, SIGKILL to each of the stack's groups still holding a process (turbo starts every task in a group of its own, and portless its app in another). After that it ends the recorded task groups too, as below, since one whose leader has left is not in the live tree.

Once the launcher has gone, it ends each recorded task group, SIGTERM and then SIGKILL after up to 15s, and only lists what the launcher's own group still holds.

Every member it signals is the stack's own:

- In the launcher's live tree: what started the launcher, what descends from it, or an orphan whose working directory is in this checkout.
- In a recorded group: a member working from inside the checkout, or one whose parent chain reaches the group's leader inside the group, as `next-server` under `next dev` does.

A group holding anything else it leaves alone and names. It keeps the record while a stranger, the launcher's own group or this command's own group still runs, and otherwise clears it, a reused group's included.
