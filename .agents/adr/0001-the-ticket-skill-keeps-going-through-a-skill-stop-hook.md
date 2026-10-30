# `/triage-and-implement` keeps going through a skill-scoped Stop hook

`/triage-and-implement <ticket>` should run until the ticket is finished, the way `/goal` does, without the user also typing `/goal`. Two things ruled out leaning on `/goal` alone: its condition is capped at 4,000 characters, so the workflow cannot ride in it, and typing a separate goal every time is the friction being removed.

## Decision

The `triage-and-implement` skill registers a `command` Stop hook in its frontmatter (`scripts/keep-going.py`). Claude Code keeps a skill's hooks registered for the rest of the session once the skill is invoked, so the hook decides on every turn end whether a run is active:

- **Typed invocation only.** A run starts on a user row recording a typed `/triage-and-implement` (`<command-name>/triage-and-implement</command-name>`). A model-loaded `triage-and-implement` stays a normal skill. The latest invocation wins, so `/triage-and-implement` again re-arms it and `/triage-and-implement stop` ends it.
- **Markers end or pause it.** `✅ **Done** · …` ends the run, `⛔ **Blocked** · …` pauses until the user sends a prompt, and `⏳ **Waiting** · …` pauses only for the turn that wrote it, while a background task or a scheduled wake-up (`session_crons`) can start the next turn (with neither it would strand the run, so the hook keeps going and says so). The hook requires the ` · ` after the word, and for Done the ticket ID after that, because "✅ Done with X" and a status line like "✅ Done · phase 5" are ordinary output (the earlier bracket forms were chosen for the same reason: "work done:" appears in prose); markers inside code fences do not count.
  The markers were `[work done]`, `[work blocked]` and `[work waiting]` until 5 Oct 2026, when they moved to emoji forms that read as status rather than machine output; the hook still matches the bracket forms, so a run started before the change still ends.
- **A line starting "work stop" ends it** ("work stop-gap" does not), including a message the user queued while Claude was busy (stored as a `queued_command` attachment row, not a user row). Looser phrases were dropped because "cancel work order" is ordinary vocabulary in an org's tickets.
- **Only real prompts count.** Meta rows (skill bodies, hook feedback), compaction summaries (which quote earlier messages verbatim), task notifications, local command output, interrupts and sidechain rows are ignored.
- **The final message comes from the hook input.** The transcript file can lag the turn's last message, so the hook also reads `last_assistant_message`.
- **It continues with `additionalContext`.** Verified on Claude Code 2.1.286: a Stop hook returning `hookSpecificOutput.additionalContext` continues the turn, with no "Stop hook error" notice, which `decision: "block"` showed on every push-back.
- **An idle guard bounds it.** Three continuations in a row without a tool call pause the run. Claude Code's own cap (8 consecutive continuations, `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`) counts only continuations without progress: a live test on 2.1.286 ran 9 `additionalContext` continuations in a row, with a tool call between each, and reached `[work done]`.
- **It fails open.** Any unexpected input allows the stop.

## Consequences

- "Done" is self-declared through `✅ **Done** · …`, which the skill allows only once every phase's completion criterion is shown. `/goal ... use the triage-and-implement skill` remains available when an independent judge is wanted.
- The hook path is the skill's own `scripts/keep-going.py`, so the skill must be installed where Claude Code loads it, as the org's extension is.
- The skill's `tests/test_keep_going.py` pins this behaviour using the row shapes Claude Code actually stores; run it after any change to the hook.
