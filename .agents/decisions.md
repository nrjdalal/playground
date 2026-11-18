# Decisions register

One line per finalized decision, the decision in one sentence, then `->` and its link: an ADR path under `.agents/adr/`, another repo-relative doc path that exists, or an issue number. The guard at `tests/scripts/decisions-register.test.ts` holds every link target, and the **context** rule's after-compact reread reads this file, so a settled decision is carried, not re-litigated.

- Slack links go in messages as link chips in their full shape, never bare URLs; the `no-bare-slack-link` hook refuses a bare one -> #761
- An org's scope is its ticket and its product team's decisions; creative liberty is Playground's alone, since an org has its own process -> #714
- An org's ticket skill names its spec for behaviour and who answers its product questions -> #714
- An idle worker or runner of 200k+ tokens is compacted before its cache expires, a trial its A/B keeps or reverts -> .agents/adr/0020-an-idle-session-compacts-before-its-cache-expires.md
- Claude Code's auto-memory runs for the dispatcher, the builder, ops and planner leads and every second worker start, a trial its A/B keeps or reverts -> .agents/adr/0022-auto-memory-runs-as-a-reviewed-trial.md
- Every Claude account's week is used to about 100% by its reset, with enough Claude work queued that no reset finds points unused and spawn.sh's usage gate as the only usage stop -> extensions/core/rules/usage.md
- The hosted session's `PLAYGROUND_DATA_DIR` names its stack's own data folder, so a factory script it runs on a fixture stack never writes this machine's -> .agents/dashboard/messages.md
- At API start, the Dashboard sends the owner's Approve answer, with a failed outcome, once per root card whose run a restart cut off, as deliver()'s fourth caller -> .agents/adr/0026-a-restart-sends-the-owners-approve-late.md
- A peer machine in org.ts's cluster takes its root setup once through sudo, its admin password from a secret card used once and deleted, then runs its listed root steps through a polkit rule with no password -> .agents/adr/0027-a-peer-runs-its-listed-root-steps-with-no-password.md
- A second WhatsApp number, `wa.alert`, gets each alert once beside the owner's once it has written or the owner approved it, and its words reach the dispatcher as data under `[ops-wa-data]` -> .agents/adr/0028-a-second-whatsapp-number-gets-alerts-and-is-data.md
- The `wa.alert` number is a guest the dispatcher replies to with `wa send --to alert`, its words still data, and what the dispatcher may answer each WhatsApp chat with is a policy line from a setting, `wa.replyPolicy` and `wa.guestPolicy` -> .agents/adr/0030-the-second-whatsapp-number-is-a-guest-and-the-policy-lines-are-settings.md
- WhatsApp sends have no hourly cap, and the gap between sends holds the pace -> .agents/adr/0033-whatsapp-sends-have-no-hourly-cap.md
- The owner's own WhatsApp message that holds one phone number sets the second number through `playground wa alert-set --from-owner-msg <id>`, ops-wa keeping its id, time and number alone for 24 hours -> .agents/adr/0032-the-owners-own-whatsapp-message-sets-the-second-number.md
- An urgent WhatsApp alert reaches the owner first and the second number after `wa.alertDelayMinutes` unless the owner's reaction or the checker `wa.alertCheck` names reads it as handled, and the second number the owner approved takes the dispatcher's replies with no message first -> .agents/adr/0034-an-urgent-alert-reaches-the-owner-first.md
- An Inbox card with choices also goes to the owner's WhatsApp as a poll, and the owner's vote answers it as the typed row number would -> .agents/adr/0029-the-owners-poll-vote-answers-an-inbox-card.md
