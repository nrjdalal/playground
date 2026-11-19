# A session's proposed setting is set by the owner's WhatsApp yes

[ADR 0035](0035-the-owners-own-whatsapp-message-sets-a-setting.md) sets a key from the owner's own WhatsApp message only when that message holds the value.
When the owner answers a session's question with a plain "yes", his message holds no value, so a guarded set fell back to an Inbox card that waits on a tap, and while he is away for days every such set waits.
The owner asked that his WhatsApp yes alone be enough: ops-wa's confirm question names the key and the value, so his yes to that question is the proof.
By [ADR 0015](0015-versions-the-old-one-stays-the-latest-is-used.md) this ADR stands beside 0035: its line on a second guarded ask gives way to the one below, and every other line of it still holds.

## Decision

- **`playground settings set <key> <value> --propose` only asks.** The CLI sends the key and value to ops-wa's socket and writes nothing itself. It takes no `--scope`, `--by`, `--reason` or `--from-owner-msg`.
- **ops-wa asks the owner its confirm question.** It sends "set <key> to <value>? yes or no", the same question as 0035, and keeps the proposal in `confirm.json` (0600) with the question's message id. The owner's own next message, `yes`, `y`, `yes do it` or `1`, within 10 minutes, applies it. A `no`, any other message, a yes after 10 minutes, a reaction, and a yes from the second number or a stranger work as in 0035.
- **The value shown is the value set.** A key the schema knows is checked before the question goes out, so the owner is never asked about a value the set would refuse, and the question shows the value as it will be stored. An org's `jobs.<name>` row is checked by the set itself.
- **No masked key on this path.** A masked key's question would show its last 4 characters alone, so the owner's yes could not vouch for the rest. ops-wa refuses every masked key and names the Inbox `secret` ask as its path. `wa.owner` and `wa.device` stay refused, as in 0035.
- **Only a guarded key.** A key no guard reads needs no yes: ops-wa refuses it and names the plain `settings set`.
- **One confirm waits at a time.** While a confirm waits, a proposal is refused with a line that names the open one. While a proposal waits, a set from the owner's own message of a guarded key is refused the same way, so the owner's yes applies only the setting his question named. A second ask from the owner's own messages still replaces the first, as in 0035.
- **Each set is the owner's act, logged with its undo.** ops-wa writes the key at the login's scope with author `owner`, actor `ops-wa` and the reason "the owner's WhatsApp yes to the question <id> confirmed it", and sends the owner the same one-line undo as 0035.
- **Every other writer stays refused.** no-extensions-write passes a `settings set <key> <value>` whose one option is `--propose`, since that call writes nothing. A CLI from before the flag reads `--propose` as an option that needs a value, so it stops before it writes. Every other set or reset of a guarded key is refused as before.

## Consequences

- A session gets a guarded setting changed on the owner's yes on WhatsApp, with no card to tap, while he is away.
- A session chooses the value. The owner's check is the question, which names the key and the whole value, so a masked key keeps the Inbox `secret` ask.
- A proposal blocks every other confirm for up to 10 minutes. A session that is refused proposes again once the open one is settled.
