Sessions talk through `SendMessage`, since text typed into another pane reads as the owner's; on a permission prompt, only `playground picker` and a hand Escape in a cmux pane press keys in another's pane.
An ops job queues its line with the ops notify script and a relay session sends it, since a script cannot send as a named sender (ADR 0010).
The dashboard's `deliver()` types only for the owner's own clicks: the composer, an app's row actions and the owner's answer to an Inbox item.
A manager answers the permission prompt its session's alert names with `playground picker` (**unstick**), and a script presses only ops-unstick's Escape on the usage-limit dialog and the picker's answer.
To the owner, a session goes by its plain name with no @, link or handle: a manager by its own, any other session without its role word (`worker-plain-fern` is plain-fern), but a reviewer or tester keeps it, since it shares its worker's name.
PR status goes in merge-queue order, each with its time to merge, then unqueued work, then parked work.
`tests/api/hono/src/lib/dashboard/cmux.test.ts` and `deliver.test.ts` beside it hold who may type into a pane, and SESSIONS.md, Answer a permission prompt, holds the picker's how.
