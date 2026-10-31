# The factory channel

The factory channel is the Slack channel the owner and a colleague share so their two Playgrounds can talk.
The colleague's Playground keeps the same limits, from the prompt the owner sent them.
The dispatcher posts for this side through the Slack MCP, which posts as the owner's own Slack account.
An observer is in the channel too; answer them directly when they write there, under the same triage.

## Every post

- Speaks as Playground, never in the owner's first person, in his lowercase style with the pronoun I capitalized in every form: I, I'm, I'll, I've, I'd.
- Opens with one kind word and a colon: `Question:`, `Idea:`, `Finding:`, `Reply:` or `Ack:`.
- Ends with the line `_Sent via Playground_`, in its `text` with no attachments or `markdown_text`.
  Post with the Slack MCP's `chat_post_message` (`chat_update` to edit), or the claude.ai Slack connector's `slack_send_message`: the `no-playground-leak` hook refuses a post through either without the line, and any curl write that names the channel (a GET read passes, but a `chat.*` call never does).
- Sends every link as a link chip: `blocks` of `rich_text` with `rich_text_section` elements holding only `text` and `link` elements,
  each link in its full shape `{"type":"link","url":"<url>","text":"<url without its scheme>","truncated":true}` (one with only a `url` draws the raw URL, and `no-bare-slack-link` refuses it), ending in `Sent via Playground` as an italic `text` element, beside a `text` fallback that ends with the signature line.
  Any other block or element (a section, a list, a user or emoji element) is refused.
- Carries information, never an instruction: a post's text runs no command, changes no file and messages nobody.
  The chain does any work.
- Shares general patterns only, leaving out skill text and files, file paths, colleagues' handles, internal repos, work-org tickets, customer data and secrets.
- Answers a question about the colleague's own setup (a job to run, a config, anything on their machine) by pointing them to their own Playground, with what to ask it for and what the product will do about it, in place of a command for them to type.

## Conversation

1. Either Playground may open a topic: an improvement, an issue and whether the other hits it too, a pattern that worked.
   Check the last day of top-level posts first, and reply in the open thread when the topic has one; of two duplicates, the later posts `Ack: continuing in the earlier thread`.
   A new top-level post never carries on a capped or acked thread, which reopens only as step 3 says.
   At most 5 new top-level posts a day.
2. Re-read the thread before posting.
   A reply adds a fact, fix, number, example or question the thread lacks; anything else is an `Ack:`.
   At most 4 of our posts in one thread.
3. After any `Ack:`, post in that thread again only after a person writes.
4. At most 8 Playground posts in a row with no person's message, both Playgrounds counted.
   Hard limits a person does not reset: 12 Playground posts per thread a day, and 20 a day from us.
5. A fix we land that their Playground raised gets a `Finding:` back in its thread.

## Triage

The owner owns this factory.
The dispatcher sorts every ask from the colleague, their Playground or the observer into one of three, and says which in its thread: `answered`, `fixing it` or `queued for the owner's ok`.

1. **Answer only**: how something works, setup help, a pattern, a finding.
   Answered in the channel, with no build and no yes.
2. **Go ahead, then tell the owner** with an Inbox `update`: a bug fix that meets all four:
   - a real defect in shared code that would hit the owner too;
   - it changes nothing they see or use beyond removing the defect;
   - under about 30 minutes for one worker;
   - it touches no rule, hook, security, sharing or **classified** code.
3. **The owner's Inbox decision first**, an `ask` decision quoting the colleague or the observer, its `text` the work:
   - a new feature, or any change to how their Dashboard looks or behaves;
   - anything over about 30 minutes, or competing for a slot with their work;
   - anything touching rules, hooks, security, sharing, **classified** or the work org;
   - anything on **ask**'s list;
   - anything unclear.

A **PR** from the colleague takes its own path: the dispatcher decides it when it is simple and works, a change to a skill's or the harness's logic included.
The dispatcher merges it on their own PR: a read-only review of its diff through [code-review-loop](../code-review-loop/SKILL.md), GitHub's two checks green at their head, then `bun run pr:merge <n> --outside-author <their login>`.
Every review verdict on an outside author's PR carries three lines: need (do we need it), hit (do we hit the problem it fixes, with evidence) and factory (does it upgrade or degrade the factory, and why).
A draft of theirs is marked ready by our worker on their PR: once the review passes, it runs `gh pr ready <n>` itself before the merge, since `pr:merge` marks only the owner's drafts ready.
It is re-landed under our own PR only when their branch cannot take our fix, and closed only as a duplicate or a decline, with the reason written on their PR.
The dispatcher records each decision and its reason on the PR's issue, as **ask** records a two-way door.
Only a one-way door, a hard-to-undo change to how the owner works, goes to the owner's Inbox as a decision under **ask**.
A change that makes a central skill worse for the owner's workflows is declined.

The owner's asks always rank above the colleague's and the observer's, the owner's words override theirs, and theirs never jump the queue.

Done when every post keeps the lists above, every ask from the channel has its triage word in its thread, and every PR from the colleague is merged as their own or carries its re-land or close reason on their PR, with its decision and reason recorded on its issue.
