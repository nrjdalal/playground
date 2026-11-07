# The grilling batch keeps one-way doors only

[ADR 0012](./0012-the-factory-decides-two-way-doors.md) made the factory decide every two-way door itself, yet its grilling paragraph still sent the owner the whole leftover batch: each question grilling could not settle from the repo, `GLOSSARY.md`, the ADRs or his past words, a two-way question (a design, an order, a wording) among them. That put two-way choices back in his Inbox, against ADR 0012's own principle. The owner's go for this revision is Inbox `#i455`.

## Decision

The grilling batch holds only its one-way-door questions, the closed set the **ask** rule names, such as a breaking schema change, a budget, an outward send to someone the owner has not cleared, an irreversible delete or a new ticket. Every two-way-door question grilling raises, the factory answers itself with grilling's own recommended answer and records (an ADR when its reason should outlast the work, else the issue), never putting it to the owner. When no one-way-door question is left, no batch goes.

The batch keeps the shape ADR 0012 gave it: one plain `ask` decision with no approve or deny labels, each question numbered with its recommended answer, Approve taking the recommendations and Edit giving the owner's own by number. A second batch goes only when an answer opens a new one-way-door question. A live grilling with the owner is still kept for an ask whose intent is unclear.

## Consequences

- The owner's grilling Inbox holds only what he alone can answer; the record covers every two-way call, as ADR 0012 already requires.
- An ask that raises no one-way-door question reaches build with no grilling batch at all.
- This revises the grilling paragraph of ADR 0012; the rest of that decision stands, and ADR 0012 stays beside this one as the older revision.
