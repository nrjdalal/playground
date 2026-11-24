# A WhatsApp card keeps tracker ids

[ADR 0024](0024-the-owners-whatsapp-answers-an-inbox-card.md) had ops-wa's redactor write `[hidden]` for every kind no-public-leak refuses, tracker ids (`linearKeys`) among them.
A card that asked the owner to claim two tickets then read "Claim [hidden] and [hidden]", so the owner could not tell which tickets it meant.
By [ADR 0015](0015-versions-the-old-one-stays-the-latest-is-used.md), this changed meaning stands beside 0024 and leaves it as written.

## Decision

- **A tracker id goes as written.** `HIDE` in `packages/scripts/src/ops-wa/cards.ts` leaves out `linearKeys`: a card goes to the owner alone, who reads the same id in the Inbox, and an id is no secret and no personal data.
- **The redactor hides what that path guards.** Secrets and token shapes (`hideSecrets`), emails, Slack ids, people's names and handles, archive links and company terms still read `[hidden]`, each kind with its reason beside it in `HIDE`.

## Consequences

- A card that names its tickets reads the same on WhatsApp as in the Inbox.
- no-public-leak still refuses a tracker id in a public post; only the owner's WhatsApp copy keeps it.
