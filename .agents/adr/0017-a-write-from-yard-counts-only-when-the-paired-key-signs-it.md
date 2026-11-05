# A write from Yard counts only when the paired key signs it

The Yard relay carried the owner's reads alone, so sending from Yard needed a way for this Mac to tell the owner's own click from anything else the hosted side could send. The owner chose a paired key in Inbox #i353: the owner's browser makes an ECDSA P-256 key with WebCrypto, non-extractable and kept in IndexedDB, and the Mac takes a write only when that key signed it. The hosted server forwards each write and holds no key, so trusting the Mac's writes never means trusting the hosted deploy.

## Decision

- **Pairing is a click on the Mac.** The browser sends its public key up the relay as a pair request, which waits in the Mac's memory alone. The Mac's local Settings (Remote) shows it with the key's fingerprint, which the browser shows too, and only the owner's Approve there, a loopback write behind `guardWrites` and the owner rung, pairs it (`api/hono/src/routers/remote.ts`).
- **One key at a time.** The Mac keeps the paired key in its data folder at mode 600 (`api/hono/src/lib/relay/key.ts`). A new pairing replaces the old key, so rotation is a re-pair, and Revoke on the same section removes it.
- **The Mac checks before any route runs.** `requireSignedWrite` (`api/hono/src/lib/relay/mac.ts`), beside `requireRelay` and sharing its seen ids, refuses in this order: an id seen before; a frame 30 s old or ahead (`RELAY_MAX_AGE_MS`); a login other than this Mac's token's or the paired key's; a path off the write list; a `keyId` other than the paired key's; a signature that does not verify over the frame's id, time, login, method, path and its body's SHA-256 (`signedBytes` in `@packages/message`).
- **The fingerprint is the pairing's control.** The browser shows the fingerprint of its own key, never one the hosted side passed back, and refuses a Mac that received another; the owner approves on the Mac only when the two match. It is the first 64 bits of the key's RFC 7638 thumbprint: a hosted side that swaps in its own key would need one matching those 64 bits, a second-preimage search of about 2^64 hashes, inside the request's 10-minute wait.
- **The write list is short, and so are the cards it answers.** `RELAY_WRITES` (`api/hono/src/lib/relay/protocol.ts`) holds the composer's send, an Inbox card's answer, Later's schedule and Done's dismiss. An answer reaches only a card whose kind is on `RELAY_ANSWER_KINDS`, an allowlist, so an Approve the Mac carries out itself (an extension accept, an apps change, a grant), a delete, a secret and any kind added later stay on the Mac. The Mac reads the card's kind itself before any route runs, and refuses a card it cannot read.
- **A checked write runs as the owner's own click.** `answerRelay` runs it in process as the one local owner's POST, so the route's owner rung and limits run, and marks that request in memory (`markRelayed`), which `requireTrustedOrigin` and `requireLoopback` take in place of an Origin and a loopback peer. Nothing a network request carries can claim the mark.
- **Every checked write is audited.** The Mac appends its time, path, the paired key's fingerprint and status, refusals included and never its body, to the data folder's `remote-audit.jsonl`, and the Remote section shows the last 20. The hub keeps no body and logs a write's id, path, status and time alone.

## Threat model

| Threat | What stops it |
| --- | --- |
| A network attacker replays a captured write | The id is seen once, and the 30 s window refuses an old frame. |
| The hosted server forges a write | It holds no private key, and the Mac verifies every signature. |
| The hosted server replays or reorders frames | The id is seen once and the 30 s window holds; a drop or a delay shows in the browser as a failed send. |
| The hosted server pairs a key of its own | Pairing takes the owner's Approve on the Mac's loopback dashboard. |
| A stolen or lost device | Revoke on the Mac refuses its next frame; the key is non-extractable, so a copied browser profile carries no usable key. |
| A different GitHub login signs in on Yard | The frame's login must match both the Mac's token's login and the paired key's login. |
| A write aims at a route outside the list | The write list is checked before any route runs, and the route's own rung and limits run after. |
| A relayed answer approves what the Mac carries out itself | The Mac reads the card's kind and refuses any kind off `RELAY_ANSWER_KINDS`, a new kind included, before any route runs. |
| A network request claims the relay's mark | The mark is a request object `answerRelay` built, held in memory; no header, query or body sets it. |
| **Residual: the hosted web's script is compromised** | The script that holds the key is served by the hosted deploy, so a compromised deploy can ask the key to sign writes on the list while the owner's tab is open, which means messages to sessions in the owner's voice. The short list, the rate limits, the Mac's audit list and Revoke bound it, and nothing here prevents it. The owner accepted this risk in Inbox #i354. |

## Considered options

- **The hosted session as the proof.** A write signed by nothing but the owner's Yard cookie would let any compromise of the hosted server write to the Mac. The key keeps that server out of the trust path.
- **Pairing from the browser alone.** A pair request the browser could complete by itself would let the hosted server pair its own key. The click on the Mac is what makes a pairing the owner's.
