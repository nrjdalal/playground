# A public post's draft holds the owner's words alone

A draft the factory wrote for the owner to post on a public page once carried a real internal PR count. The public repository's own rule, AGENTS.md's Commits section, holds the repo's files to plain words that name no person, and the **classified** rule keeps the factory out of an org's writes, but nothing covered a draft for a public post: it reaches the owner through the Inbox, and the owner posts it by hand. The owner approved the rule and its check in Inbox #i460.

## Decision

- **The rule.** A public post's draft holds only what the owner asked to say: no work figure (a PR, commit or session count) and no repo, ticket, colleague, tool or session name. It is the standing rule **public** (`extensions/core/rules/public.md`), and to-inbox, the one skill that writes drafts, names it at its draft kind.
- **A draft with no link is a public post's.** Every draft names where it lands or says why it has none (`noLink`). A message to a colleague has a Slack or Linear `link`, and a public post has no place for the Inbox to send to, so the `noLink` draft is the public one, and the check needs no new field and no new card. `publicDraftText` in `api/hono/src/lib/dashboard/public-draft.ts` picks that draft's text out, so a linked draft starts no check.
- **The check runs where the draft is posted.** `bun run ask new` and `edit`, the one way into the Inbox, refuse a draft with no link whose text holds such a figure or name, before the item posts. `publicDraftRefusal` hands the text as an argument to `scripts/hooks/public-draft.ts` through `run-argv.ts`'s runner, so no new process spawner joins `api/hono/src/lib`. The finder adds one figure pattern (a count beside PR, pull request, commit or session) and a ticket or PR number, which no-public-leak lets through, to the two guards' own finders and the repositories they read; the README's public-draft check holds the order and each pattern. The guards' lists stay the one source of each name, a list that cannot be read refuses as the guards do, and the refusal names the kind of text and its fix, never the text, as the guards' do.

## Consequences

- A public post's draft reaches the owner's card only in the owner's own words; one that holds a figure or a name comes back to its poster with the kind to remove.
- A colleague's draft with no place yet gets the same refusal when it names the colleague, and the refusal says that a draft to a colleague carries its link.
- A figure the owner wants in a post is the owner's to add at the post, since the check reads no note from the owner.
- No hook changes what it refuses: the two guards export the finders they already build, and the API's own graph stays free of them, since the CLI runs the finder as a child.
