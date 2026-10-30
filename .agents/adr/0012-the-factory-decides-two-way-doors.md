# The factory decides two-way doors

The factory asked the owner for every choice it was unsure of. The **ask** rule already sent the owner's decisions to the Inbox rather than chat, and it named a list of what goes to the owner. But a design pick, an order or a scope question inside work the owner had approved still reached the owner as an Inbox item, and the upstream grilling skill, which this decision adopts as the first step of every ask, would put each of its questions to the owner one by one. The 18 Oct decision: the factory makes wise decisions itself, with the user involved the least.

## Decision

A choice is a **two-way door** when it can be undone: a design, an order, the scope inside an ask the owner approved, a name, a wording. The factory picks every two-way door itself and records it, in an ADR when its reason should outlast the work, else on the issue. The owner hears of it as an Inbox update with outcome `decision` only when the pick changes what the owner sees or does; the record alone covers the rest.

A choice is a **one-way door** when undoing it costs real rows, real money or someone else's trust, such as a breaking schema change, a budget, a Slack message to someone the owner has not cleared, an irreversible delete or a new Linear ticket. The **ask** rule's list is the closed set. Of the choices a session could make itself, only a one-way door goes to the owner, as one Inbox decision. The Inbox keeps its other items: the plain asks only the owner can answer (a step only the owner can take, a production port, a request from outside the chain), drafts and updates.

Grilling asks the owner only what is left. It answers every question that the repo, `GLOSSARY.md`, the ADRs or the owner's past words already settle, and sends the owner the rest as one grilling batch, a plain `ask` decision with no approve or deny labels: each question numbered with its recommended answer, Approve taking the recommendations and Edit giving the owner's own by number. A second batch goes only when an answer opens new questions. A live grilling with the owner is kept for an ask whose intent is unclear.

## Consequences

- An ADR or an issue comment records each two-way door the factory took, so a later session finds the reason without asking the owner again.
- A wrong two-way pick costs a follow-up PR, which the gate already makes cheap; a wrong one-way pick is what the Inbox still guards.
- Grilling a new ask costs the owner at most one Inbox decision a round, not a question a turn.
- The `no-chat-question` hook is unchanged: what does reach the owner still goes through the Inbox, never chat.
