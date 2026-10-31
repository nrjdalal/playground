- Playground's Inbox is what the factory posts for the owner: a decision to approve, a draft to send, or an update to read.
  It replaced the asks (their JSON files, locks, in-chat cards and `/dashboard/asks`) and the old approval channel.
  It is one table, `inbox_item` (`packages/db/src/schema/inbox.ts`), in the dashboard's local Postgres, read and written through `api/hono/src/lib/dashboard/inbox.ts`, whose zod schemas check each kind's payload,
  and served by `/api/v1/inbox` (`GET` the list, `POST /api/v1/inbox/:id/answer`, `POST /api/v1/inbox/:id/retry`, `POST /api/v1/inbox/dismiss`, `POST /api/v1/inbox/read`, `POST /api/v1/inbox/:id/schedule`, `POST /api/v1/inbox/:id/secret` for a secret ask's value (below), and `GET /api/v1/inbox/attachments/:id` for an ask's or a read-only update's files).
  It shows first in the aside window beside every dashboard page (`DashboardAside` in `web/next/src/components/dashboard/dashboard-aside.tsx`, drawn once by `web/next/src/app/(protected)/dashboard/layout.tsx`, so the Inbox and the chat are on every page and only the session panes differ by view),
  in stock Tabs whose squares float centred over the bottom of that half in the table's selection-bar look (`FLOATING_BAR`), one icon square a tab, `APP_SQUARE`'s shape (`iconTab` in `web/next/src/components/dashboard/dashboard-aside.tsx`), in one row that scrolls sideways once the squares outgrow it (`TAB_BAR`),
  above every layer a pane holds, since the panes stack in an isolated layer of their own (`PANES`, since a table's sticky header once painted over the bar),
  hidden as a dock is until the pointer comes within 96px of the half's bottom (`BAR_NEAR_PX`; a pointer over a portal opened from the aside, the viewer, counts for nothing, #i949) or a key's focus lands in it,
  unless the owner unticks Auto-hide tab bar at the top of the user menu, which keeps it shown (a wide screen's alone, since a phone's bar never hides), the choice kept in this browser,
  and shown see-through over the pane (`bg-popover/60` with a blur; the owner: "autohide aside toolbar", "black should be transparent"), a drawer handle named Show tabs marking where it comes back, wearing the squares' red dot (`CountBadge`) while something is new,
  so each scrolling pane ends 12px under its last line (`PANE_BOTTOM`) and the chat alone keeps the bar's room (`BAR_ROOM`, `CHAT_BOTTOM`), every pane taking `BAR_ROOM` while Auto-hide is off,
  its count inside a red dot at the square's top right, and something new on a square with no count the plain red dot (`cornerMarks`, `.agents/dashboard/sidebar.md`), each tab's name its hover and screen-reader words, Inbox (the default),
  then Playground's chat on every page but your chat, which is that chat itself, then a square for each app you show, in your order (#i787, `.agents/dashboard/apps.md`), then Pages on a session's own view alone, then Apps, the app manager, last of the tabs (`asideTabs`, `.agents/dashboard/dashboard.md`; on a phone the page's own square leads them, at the bottom),
  then a Settings square, a link to `/dashboard/settings` (`SettingsSquare`), which the user menu lists too,
  as one plain list in priority order (`components/dashboard/inbox.tsx`):
  decisions and drafts that need the owner and answers that failed to send, then unread updates, then whatever else moved in the last week, each newest first by when it was posted (`inboxOrder` in `api/hono/src/lib/dashboard/inbox.ts`, #i545), that order read once when the list opens,
  after which each item keeps its place instead of jumping the list: one that arrives waits behind a pill on the open row (below), white, left of Mark all as read, on that one line at every width (its words truncating first, the pill reading `1 new` in a pane under 24rem, its whole words still read to a screen reader),
  so it never covers a card and its coming and going moves nothing,
  sliding in and fading out (none under reduced motion), `1 new update` (`pinnedView` and `newLabel` in `web/next/src/lib/inbox.ts`), whose click puts what waits on top (the order lasts as long as the page, so what arrives while they are on another tab waits behind the pill too), newest first, the rows below gliding down (none under reduced motion);
  a take by the keyboard hands focus to the first card it puts on top (`focusAfterTake`), since the pill leaves; and the action buttons of every card that moved pause for 1 second (`movedRows`, `MOVED_PAUSE_MS`, the guard a short pause so a stray click during the move cannot misfire), still focusable and saying why on hover;
  Each card is a stock Card holding one question on shadcn's Questionnaire (its title the item's, its description what Approve does or, once it is answered or settled, the result, on its own line above the footer; Cmd/Ctrl+Enter in a draft's box presses Send, and on a labelled ask sends the picked side, once one is),
  and its footer holds the item's actions on the left and Archive (a decision's), Snooze (where offered), Dismiss and Reply on the right, Dismiss directly left of Reply (#i510), with Send leading an open labelled ask's footer;
  an answered item its poster has not closed (below), or a read update, stays as its result for ten minutes, then moves to Done, newest first, or,
  for an update (read or not) or an answered decision or draft at once when the owner presses its Dismiss, directly left of Reply (`dismissItems()` records `dismissedAt` inside its answer, so no column was added, and marks an update read, keeping the time it was read; the dismiss buttons exist so the owner can clear any item from the list),
  so nothing is deleted (`inboxView` and `DONE_AFTER_MS` in `web/next/src/lib/inbox.ts`).
  An answered decision or draft moves to Done at once when its poster closes it, by `bun run ask ack`, by a `bun run ask get --ack` that closes it or by `bun run ask settle`, since `stamp()` and `settleItem()` in `api/hono/src/lib/dashboard/inbox.ts` write `dismissedAt` with the close;
  one the owner set aside keeps its Archived shelf, and a go read but not yet carried out stays in the list.
  Dismiss takes a decision or draft answered by a chat reply too, moving it to Done at once while it stays open for its poster (the owner: "how can I dismiss this").
  Mark all as read on the open row marks every unread update and open decision or draft on screen seen (`markRead`), answering and dismissing none, so each stays in the list as it is until it is done, shown only while one is left (`unreadIds`; the owner: "inbox should be just mark as read and just show in inbox until done").
  The Inbox is one shadcn Accordion with six rows (the owner: "all caught up gray when nothing, snoozed, archived, then done" and "icon text labels"): the open items, starting open (`FOLDS_OPEN`), then the shelves In progress, Snoozed, Archived and Done, starting shut ("you can add in progress above snoozed and below inbox"),
  each row's header sticking to the top of the pane while its section scrolls,
  with a full-width line under every header but the last row's while it is shut (the row classes live in `web/next/src/components/shelf.ts`, which the Changelog shares).
  Each row ends in its `ShelfMark` (`web/next/src/components/shelf-mark.tsx`) in place of the stock chevrons: a small circle on an empty row, else a right chevron turning down while open, on a muted square while the row is hovered ("show circle icon if no items in accordion, and right chevron on closed?", "and hover state like this").
  The open row reads Inbox and the open cards' count as the shelves' Badge, 0 included ("still keep showing counts", "all caught up to inbox then label count", "where is inbox zero"), the summary of the open cards, or All caught up, in an `sr-only` span, Inbox muted with the row disabled when none is open;
  the pill and Mark all as read (a single ✓ icon button, `RiCheckLine`, its Hint naming how many it reads, while anything is unread, else a muted ✓✓ named All read) sit over its right end, outside the trigger, so pressing one never folds the row.
  A shelf's row is its icon, its name and its count as a mono outline Badge, every shelf counting what it holds, disabled and gray while empty (`ShelfLabel`): In progress holds an open item whose answer is a chat reply its poster has not closed, 5 minutes after the reply (`PROGRESS_AFTER_MS`, `progress` in `inboxView`; "move to in progress in 5 mins or so"),
  offering no ✓ since its poster closes it;
  Snoozed holds the open items put away until a time still ahead, which the API returns apart from `items` as `snoozed` (`listItems`), since every other reader of `items` takes a row there as awake;
  Archived holds the cleared ones not dismissed, however old, each card offering Dismiss and the row's header a ghost Dismiss all archived (a ✓, `RiCheckLine`, `ShelfDismiss`), both sending them to Done;
  Done the rest of what settled, its header's ghost Mark all done as read (`ShelfDismiss`, "where is done mark as read") dismissing every item in it not yet dismissed, gone once none is left ("why mark as complete is available at 0 here"), as Dismiss all archived is, and its count everything it holds, its history too ("done show 0 and yet items?"), with `, N unread` for a screen reader,
  its row muted once none is unread, as an empty one is, though it still opens to its history, full again on hover or while open ("Why at 0 is it not muted like others?").
  Under Done sits the Preview row, its icon and name with no count, starting shut and there in an empty Inbox too: opened, `PreviewPane` in `web/next/src/components/dashboard/preview-pane.tsx` fills the pane below it with a frame down to the pane's bottom edge.
  Its picker lists the machine's web stacks (`GET /api/v1/stacks`, `webStacks()` in `api/hono/src/lib/dashboard/stacks.ts` reading portless's live routes, none on a fixture stack), then the 8 newest Previews pages, which load sandboxed with no script;
  its address field loads only a `.localhost` stack or a Previews page (`loadable()` in `web/next/src/lib/previews.ts`), and the last address is kept in localStorage.
  An empty row is always shut and gray with the default cursor, and the open list keeps the owner's open or shut while it is empty.
  The open cards stay mounted while folded, so a fold keeps an edited draft or a picked side, and taking what waits behind the pill, or a link to a card in the folded list, opens the list first.
  Each item sits flat, led by one muted band the pane's full width (`KindBand`, `bg-muted` with square corners bleeding over the pane's `--pane-x` padding, which `dashboard-aside.tsx` sets on each scroll pane, its words lined up with the card's; the owner:
  "use as previously did but bubble, muted bg, blue like alpha, purple for bravo" and "should be full width, no rounder corners, and text stays where it is now"), which gives its kind as an icon and a word,
  its id `#i<ref>` (`ref` is an identity column, so an id is stable and never reused) and who posted it (Alpha's name `text-info`, Bravo's `text-bravo`, the theme's purple), then at its right end one time and a tick: `posted <time>`,
  or `updated <time>` once a decision or draft changed (its `updatedAt` a second or more after its `createdAt`: an answer, a delivery, an ack, a settle, an edit or a Snooze, `scheduleItem` setting it too), or once its poster edited an update (`bun run ask edit`; an update's read, Dismiss or resolve leaves it `posted`;
  `changedAt` in `web/next/src/lib/inbox.ts`), reading `read <time>` on hover once read, and a blue `Updated` when it changed after the owner's look before this one and by the time this one began (`updatedSince`; the inbox's look mark, `inboxMark` in `web/next/src/lib/tab-dot.ts`, takes in changes too), so a change made as the owner looks shows in place, with the change's own time beside it,
  since a relative minute alone can hide an update that landed after the last look.
  Colour says what an item is and where it stands, as the sidebar's lights do: its kind's on its icon alone (a decision `warning`, a draft `info`, an update `success`, an alert `destructive`), the card's own edges plain, no thick coloured border,
  and its state as the sidebar's Worker Lights draw the state that means the same, beside its title and in its result line's colour (`itemState`, `inboxLight` in `web/next/src/lib/inbox.ts`, its icon and tone read from `statusIcon` in `web/next/src/lib/status-icons.ts`, the one table),
  the kind icon sitting in the band and that light in a leading column centred on the title's first line (`LEAD` in `components/dashboard/inbox.tsx`):
  the orange eye while a decision or draft waits on the owner, the blue spinner while a go is being carried out (turning only where motion is allowed), the green check once its poster closed it, the result link green too, the red error when it failed to send, until the owner dismisses it, and the gray circle once denied, discarded, set aside (`cleared`), settled or read,
  or a failed send dismissed;
  an unread update keeps its dot.
  An `ask`'s text, and a read-only update's, renders as a chat message's does, through `TranscriptMarkdown card` with its line breaks kept, so a fenced block (`ts`, `sql`, `diff`, `text`) shows highlighted with its copy button, at text-xs and wrapping at any character.
  A drawing (a `text`, `txt` or `ascii` block, or one with no language) keeps its lines whole, its font shrinking from 12px to fit its widest line, measured with pretext, down to 10px before it scrolls sideways.
  `ASK_CODE_COLUMNS` (`@packages/config/inbox`) is the widest drawing line that fits the narrowest card at 12px.
  Every other preview's words, a Slack message's included, stay plain text, since they go out exactly as written, marked as quoted by a `border-l-2` rule rather than a background, and no card's body, a Done one's included, sits on gray, the band alone muted.
  The card's header is one `minmax(0,1fr)` column and a card's table cells wrap, so a wide table or drawing stays inside the card.
  A decision previews exactly what Approve does, then Approve and Deny, and no card offers Edit: a change goes in the comment box, while the API still reads `edit` on an older row; an `ask` whose poster labelled both sides is shadcn's questionnaire card instead:
  its text as the quoted block, then its sides as numbered choices, the keys 1 and 2 picking one, and the card's footer inside its form, Send first, the form's Submit, which sends the picked side,
  off until one is picked and saying `Pick Approve or Deny first` on hover and to a screen reader (`sendWhy` in `web/next/src/lib/inbox.ts`, the submit disabled while no option stands and placed on the left), then Archive, Snooze, Dismiss and Reply;
  a draft is its Slack message or Linear comment, named so from its `link`'s host (`linear.app` is a Linear comment, anything else a Slack draft) with an Open thread link to it in its place line, editable in place, then Send, Draft for a Slack draft alone and Discard (for the apps whose drafts a person sends themselves):
  Draft saves it in Slack's Drafts & Sent for the owner to finish and send, which its poster does with Slack's MCP tool `slack_send_message_draft` and acks with the `channel_link` it returns,
  rewritten to the app form by the command `slack.linkConverter` names (the archives refusal, below) since `ack` refuses its archives form,
  or with `--no-link` with why when Slack refuses with `draft_already_exists`, since a conversation holds one draft, which the owner's card then reads, gray, as `Draft not saved: <why>`,
  since Slack's public Web API has no draft method and Linear's API has no mutation that creates a draft, so a Linear comment offers none and the API refuses `draft` for one (`savesDraft`, which the web's `canDraft` mirrors);
  Clear (`RiArchive2Line`, named Archive, the Archived shelf's icon; the action `clear`) sets an open decision aside for later: status `cleared`, neither a deny nor a discard and never a go, read as "You set it aside for later".
  A draft's one no is its own red Discard, which drops the message, so the API refuses `clear` on a draft.
  Its poster reads "Cleared for now": whatever is already in motion stays in motion, only the new step the item asks for waits, and the owner picks the talk up again; its read (`bun run ask get --ack`) closes it, as a deny's does.
  The band's tick sits after its time:
  while an update, or an open decision or draft, is unread (`readAt` null) the tick is a single ✓ button, Mark as read, which only marks it seen through `POST /api/v1/inbox/read`, taking any kind, so an ask stays open and answerable, its card as it was ("once mark as read, keep the message as is"); once read it is a muted ✓✓ named Read, its Hint the full time it was read.
  The unread dot stands in for an update's light alone; an ask keeps its light ("what is this dot before the icon?").
  Dismiss is an icon button too, named in its `aria-label` and `Hint` ("should be just icon in this case also").
  An open decision or draft ends in a comment box above its buttons, reading Add an optional comment and named Comment ("rename to just Add a comment"), the same gap above it as between the card's other parts, at least as tall as its first choice (`NoteBox`);
  what the owner types there goes with whatever he answers, as `answer.note` (at most 4000 characters), its poster reading it on a line of its own after the answer, `The owner's note: ...`,
  and the answered card reading `Your note: ...` under its result.
  A card's words, its preview (an ask's callouts, tables and inline code included), a draft's box and the Note, read at `text-xs` (`BOX` in `inbox.tsx`, whose `md:text-xs` beats the Textarea's own `md:text-sm`).
  Approve, Send and a labelled ask's Send once Approve is picked take a muted green, Deny and Discard a muted red and Draft amber (`SIDE_TONES` and `DRAFT_TONE` in `inbox.tsx`), on the choices and the footer buttons alike.
  Snooze (the zzz icon, `Schedule` in the code) puts an open decision or draft away until a time, sitting just before Reply while its answer holds no choice yet, one put away already included, or holds a chat reply its poster has not closed:
  its fixed times in the owner's zone (the `clock.ownerZone` setting, its label naming it), soonest first, each beside its day and time (`scheduleChoices` in `web/next/src/lib/inbox.ts`, with more than one default to pick from):
  In 30 minutes, In 1 hour, In 3 hours, This evening 18:00 while it is ahead, the next 09:00 (Today or Tomorrow), Monday 09:00 (the coming Monday) and Next <weekday> 09:00 (today's weekday a week out), a moment two of them share kept once; or Pick a time…, shadcn's date and time picker (the Calendar in a popover beside a time field, in the browser's time zone) with a Set button;
  `POST /api/v1/inbox/:id/schedule` takes `{ at }` as ISO and is guarded like an answer, `scheduleItem()` recording `answer.snoozedUntil` on the item.
  A sleeping item leaves the list and the count until its time (the list SQL's `awake` fragment) and asks again once it has passed, new to the browser tab's dot again (a wake after their last look counts as new, a look after the wake clears the dot);
  a chat reply (`re #iN`) wakes it at once by replacing the whole answer with the reply, so it reads `You replied "<his words>" · <poster> is on it…`, while an item woken by its time passing offers Snooze again (`schedulable`).
  An update is an outcome, bold with a dot until a click on its title, its tick or its Dismiss marks it read; Dismiss also moves it to Done, and Mark all as read on the open row marks every update read.
  Its poster clears an alert update that has fixed itself with `bun run ask resolve <id|#iN> --by <your session name>` (`resolveItem()` in `api/hono/src/lib/dashboard/inbox.ts`), which marks it read and merges its keys into the answer, so a resolve after the owner's Dismiss leaves the item dismissed; only the posting session's own alert resolves.
  A sent draft reads `Sending in Slack…` (`Sending to Linear…` for a Linear comment), a draft saved as one `Saving a Slack draft…`, and an approved decision `Being carried out by <taker>…`, until its poster closes it, even once typed into its session, since only the ack says it landed (#i115's earlier Delivered word read as landed when it was not).
  A `<taker>` is the session that took the answer: its poster, unless the poster has ended.
  An answered item's result line ends with a link to where its poster carried it out, when the poster acked or settled it with `--link <https url>` (stored as `answer.link`; a Slack link in its `https://app.slack.com/client/<team>/<channel>` form, a message's ending `/thread/<channel>-<ts>`), named for what was done by `--label` (`answer.linkLabel`, "Filed FIX-12"),
  else from the link (a Linear ID, `owner/repo#N`, Open thread for a Slack link, else the site), opening in a new tab (`resultLink` in `web/next/src/lib/inbox.ts`; a result carries the link it acted on, so the reader can open the thread or ticket themselves).
  Each item's Chat about it button, at the right of its footer, prefills Playground's composer with a removable Replying to #iN chip and puts focus in the box in the click's own frame, a phone's too, its Chat tab coming forward in the same render, so a dictation app's Cmd+V sent at once lands there (`bun run verify reply-focus`),
  and marks the item until the message is sent, which goes as `re #iN: <words>`; words that already say `re #iN` resolve to the item the same way (`web/next/src/lib/reply.ts`).
  A reply takes the item off the open list, the count and the open row's summary at once, and the owner's card reads `You replied "<his words>" · <poster> is on it…` until the poster closes it, then `You replied "<his words>"`:
  the reply keeps his words after the tag, at most 280 characters (`said`, `saidOf`; the owner: "should show what action, I don't even know what's in progress"), and 5 minutes on the item moves to In progress.
  Until then the card folds to that line, and its Show actions chevron left of Reply, a click on the card or E while it holds focus opens it again with its answers and Snooze (`reopenable` and `reopenKey` in `web/next/src/lib/inbox.ts`).
  An answer or a Snooze given there replaces the reply (`answerItem`, `scheduleItem`), so the poster reads that one alone and is chased for it alone, a Snooze reading as no answer until its time, so the poster's `bun run ask ack` of the reply is refused with `This item has no answer yet`; once the poster closes the reply, the card takes neither.
  A session that posted an open decision or draft depends on it, so until the owner acts on it, by a button, a Snooze or a chat reply, it reads Waiting on your inbox, with the orange eye, linked to that item, in the sidebar and the System page's table (`inboxWaitOf` in `web/next/src/lib/inbox.ts`, through `statusOf` and `rowLines`),
  and ranks with the sessions at a prompt;
  with nothing open or running it reads Idle (playbook's **ask** rule).
  The answer is recorded in one write that holds only while the item is open at the version read, then typed into the posting session through `deliver()` (`Inbox #i41 (<id>) "<title>": Approved. Carry it out.`), and the item records how that delivery went.
  A poster that has ended (the delivery reads `NOT_FOUND` with deliver.ts's reason `No live session is named <poster>.` or `<poster>'s Claude is not running in its pane any more.`; `posterGone` in `inbox.ts`) hands the answer to the dispatcher instead (`DISPATCHER`, which the router passes to `answerItem` and `retryDelivery`; `relayText`).
  Any other `NOT_FOUND` (`now names another session`, `has no terminal to type into`) comes from a live session and stays failed, so the go is never carried out twice.
  The dispatcher is typed the same text, led by a line saying the poster has ended: for a go, that it posts a sent message through the MCP server `slack.sendServer` names, else its Slack tool, or saves a draft as the text says and then acks the item; for a deny, a clear or a discard, that nothing is carried out and the item closes with `bun run ask get --ack`.
  The item's kind and exact preview text follow.
  That delivery records `delivered` with `to`, the session that took it: the dispatcher here, the poster otherwise.
  A row from before `to` was recorded has none and reads as its poster (`takenBy` in `web/next/src/lib/inbox.ts`).
  The card and `bun run ask ack`'s line name that session: `Being carried out by <dispatcher>…`, then `Delivered to <dispatcher>` once it acks.
  A relay that fails records the dispatcher's own failure, and an item the dispatcher itself posted is never relayed.
  An answer whose delivery failed (on 9 Oct, 11 failed unseen with `CMUX_FAILED` and #i76's Send never went out) still needs them (`deliveryFailed` in `api/hono/src/lib/dashboard/inbox.ts`, `sendFailed` in `web/next/src/lib/inbox.ts`):
  it stays in the list and its count past ten minutes and past the week, its result line in red reading `Send failed: <reason>`, or `Send unconfirmed: <reason>` when typing began (`INTERRUPTED`) or the adapter threw (`ERROR`), so the answer may be in the session already;
  Retry is offered only after a failure that comes before anything is typed (`RETRY_CODES`: `CMUX_FAILED`, `INPUT_NOT_EMPTY`, `NOT_FOUND`, `ON_PICKER`, so it never types an answer twice) and marks it pending in one write that holds only while it still reads failed at the version read and types it again (`retryDelivery`), until it is delivered or they press its own Dismiss;
  the session carries it out, and the Dashboard itself never sends, merges or files anything.
  No session row carries a count, Playground's included (Worker Lights): the Inbox tab counts what needs the owner and arrived since their last look at the Inbox (`newInInboxCount` in `web/next/src/lib/tab-dot.ts`, the rule `newInInbox` lights the tab dot by), so a look clears it with no answer given,
  its name reading `N new` (the owner: "I clicked just to clear the notification in toolbar"),
  while the Inbox's first row counts every item in the list; the API's `inboxCount` (`api/hono/src/lib/dashboard/inbox.ts`), which Needs you and the sidebar read, counts the open decisions and drafts and the answers that failed to send, plus the unread updates, one put away with Snooze counted again only once its time has passed,
  and one they have replied to in chat counted no more until its poster closes it,
  the browser tab's red dot lights for what is new since their last look (`newInInbox`, `.agents/dashboard/sidebar.md`), and the System page's Needs you lists them, Playground's place alone.
  A session's Feed prompts show as its red alarm, Stuck (Waiting on you on Playground's own row), each shown as a card in its stream on shadcn's Questionnaire (`components/dashboard/needs-you-card.tsx`, one shape, `NeedsYou` in `web/next/src/lib/needs-you.ts`, answered through `feedNeeds()`; a permission or plan card is read-only while `PLAYGROUND_APPROVALS_ENABLED` is off).
  Items are posted only with the `bun run ask` CLI, which checks each against its kind's schema and proves its database is a container on this machine first, as `bun run ingest` does, and refuses the live dashboard's `live.container` off `live.branch`, as the launcher does.
  Before that it refuses, naming both ports, a `POSTGRES_URL` whose port is not the one in the `.env` of the checkout `dashboard-ask.ts` lives in (`checkoutMismatch` in `api/hono/src/lib/sessions/guard.ts`): a run by path from another checkout, or a URL exported in the shell over the `.env`.
  A test run (`NODE_ENV=test`) passes its own container's URL on purpose, and the check skips it.
  Run it in the checkout that serves the dashboard, from anywhere with `bun run --cwd <checkout> ask`: any other checkout has its own database, which the live dashboard never shows, and says so on stderr.
  From a user install's clone root with no `POSTGRES_URL`, `bun run ask` runs as the Dashboard's checkout's (`.claude/worktrees/desk`, whose `.env` holds the database), through `api/hono/src/bin/ask-from-clone.ts`.
  A fresh worktree runs it once its `.env` is set up (the `dev` skill's Start) and its shared packages are built (`~/.playground/ops/run-slot.sh <your name> -- bunx turbo run build --filter='./packages/*'`), since a cloned `node_modules` alone leaves `@packages/db` unresolved.

  ```bash
  bun run ask new <<'EOF'   # prints the id on stdout, its tag (#i41) on stderr
  {"from": "ops", "title": "Ship canary 3f9a2c1 to main?",
   "preview": {"type": "ship", "sha": "3f9a2c1", "prs": [{"number": 270, "title": "Changelog entries read as text"}],
               "link": "https://github.com/acme/app/compare/main...3f9a2c1"}}
  EOF
  bun run ask new <<'EOF'
  {"kind": "draft", "from": "dispatcher", "title": "Ask Ivo to try the export fix", "preview": {"to": "@Ivo", "text": "hi Ivo, ...", "link": "https://app.slack.com/client/<team>/<dm>"}}
  EOF
  bun run ask new <<'EOF'
  {"kind": "update", "from": "builder", "title": "Merged: changelog entries read as text",
   "preview": {"outcome": "merged", "link": "https://github.com/acme/app/pull/270"}}
  EOF
  bun run ask new --thread <id> < item.json   # routes the item to that thread (bun run thread), refused when no thread has the id
  bun run ask get <id|#i41> --ack   # the item, with answer {at, choice, editedText?, link?, linkLabel?, noLink?, ackedAt?} once the owner answers, marked read (which closes a deny, a clear or a discard, not a go)
  bun run ask ack <id|#i41> --link https://app.slack.com/client/<team>/<channel>/thread/<channel>-1700000000.000100   # once carried out, a go closes with where (a Slack link in its app.slack.com/client form, which reads Open thread, so no --label), which its card links to by the label, or --no-link "<why>" when it has no page or Slack refused a Draft
  bun run ask edit <id|#i41> < item.json   # the poster replaces its own open item's title and preview in place, checked and its files copied as new does; the card redraws on the next 5s poll
  bun run ask settle <id|#i41> --note "Shipped by hand"   # the poster closes its own open item, decided another way
  bun run ask resolve <id|#i41> --by builder --note "The loop recovered on its own"   # the poster clears its own alert update once it has resolved itself
  bun run ask stale --minutes 15   # ops-sweep's chase: each answer given in the last 24h (--since <iso> moves that) its poster has not closed within 15 minutes
  ```

  `kind` is `decision` (left out, it is one), `draft` or `update`; `from` is the posting session's name as the Dashboard shows it, since the answer is typed into that session; `title` is one line.
  A decision's `preview` is one of eight, each what Approve does but the `secret` ask (below), written in ELI5 / ASD-STE100 plain words: `ask` (`text`, what its poster does on Approve, for a decision no other shape fits: a production port, a work request from outside the chain, its text naming the session asking and the work it wants, or a step only the owner can take, its text the step,
  Approve meaning done and Deny meaning the owner can't, or a grilling batch, its text each open question numbered with its recommended answer, Approve taking them all and the owner's Note giving his own by number;
  with optional `approve` and `deny` labels, one line each, which the owner's card shows as two choices under its text, the quoted block, when both are there, and optional `attachments`, below), `slack` (`to`, `text`),
  `ship` (`sha`, `prs` of `{number, title}`), `ticket` (`team`, `title`, `body`), `delete` (`what`, `why`), `schema` (`shape`), `budget` (`amount`, `why`) or `secret` (`key`, `sink`); a decision with none is refused.
  An `ask`'s `attachments`, and a read-only update's, are up to 20 files on this Mac, each `{src, kind?, label?, group?}`: `src` an absolute path, never a URL; `kind` one of `code`, `doc`, `html`, `image` or `pdf`,
  read from the extension when left out (`KIND_OF_EXTENSION` in `api/hono/src/lib/dashboard/inbox-attachments.ts`); `label` `before` or `after`; `group` a one-line section heading.
  `bun run ask edit <id|#iN>` (`editItem()`) takes the same JSON as `new` and replaces the item's `title` and `preview`, its files copied the same way, bumping `updatedAt` and `version`, so one card carries a progress to its end;
  an item put away with Snooze edits as an open one, and the card's own answer carries `seen`, the `updatedAt` it showed, which `answerItem` refuses once it no longer matches (`This item changed since you read it`), so Approve never lands on words the owner did not read;
  it refuses another session's item (its `from` differs), a change of `kind`, and an item answered, closed or replied to in chat (a decision or draft not open or holding a reply, an update dismissed or resolved).
  `bun run ask new` checks every file first, then copies each into the attachments folder (`keepAttachments`, through `storeAttachment`: bytes sniffed, 10 MB a file, a week's retention), and the item keeps `{id, kind, name, label?, group?}`.
  It refuses, with one line naming the file, an unknown key, a relative path, a missing file, a file over the cap, and bytes that do not match the kind; it takes every kind (code, doc, html, image and pdf).
  `GET /api/v1/inbox/attachments/:id` serves a kept file behind `requireTrustedOrigin`, `requireLoopback` and the owner rung, so the web fetches it with its cookie into a blob URL (`useAttachmentUrl`), since an `<img>` sends no Origin.
  The card shows its files under the text gap-3 below the words:
  a lone HTML page live at its full width through the viewer's own HTML view, links opening in a tab, never taking the focus, an `h-80` box with a full-screen square in its corner that opens the viewer (`LivePage`),
  a lone before/after pair at its full width with Before above After, each in an `h-48` box, the picture `object-contain` (`WideSide`, Up and Down a side), else in a four-by-four grid of squares gap-3 apart, up to sixteen thumbnails or fifteen and a `+N` tile (`AttachmentThumbs` in `web/next/src/components/dashboard/viewer/thumbnails.tsx`),
  a kind with no `Thumb` a titled tile, its icon over its name,
  the grid a group whose Left and Right move focus a tile and Up and Down a row, Home and End to its ends (`focusTarget`);
  a click, Enter or Space opens the viewer (`Viewer` in `viewer.tsx`), full screen over the page, its own colours dark whatever the theme, on a see-through stage, the stock Dialog overlay's dim and blur, the file edge to edge, on the stock Dialog and Carousel, in Slider mode:
  one file a slide, Left and Up back, Right and Down on, past either end wrapping to the other with a jump (`wrapStep`), a swipe, the ‹ › buttons, Esc or X to close, a jump in place of the slide where motion is reduced.
  One floating bar, the aside's own, holds ‹, `2 / 6`, ›, the file's name, Open in new tab and X, with no tooltips and the kind read to a screen reader alone;
  it rises while the pointer is within 96px of the bottom edge or a key has focus in it, and on a touch screen a tap on the picture shows or hides it, while an HTML page or a PDF, whose frame keeps a tap to itself, keeps it up (`pinsBars`); a thin strip along the bottom edge brings it up over an HTML or PDF frame, which keeps the pointer's moves to itself.
  A Close of its own stays shown at the top-right corner, one square on a floating bar of the same look.
  Open in new tab opens an image or a PDF at full size in a browser tab (`OPENS_IN_TAB`), on a pair the Before, whose id the folded item keeps, never an HTML page, code or an SVG, since a blob URL runs with the Dashboard's origin.
  Each kind's renderer is one line of `VIEWERS` in `registry.tsx`; a renderer that keeps its own pointer or keys marks itself `data-viewer-owns-pointer` or `data-viewer-owns-keys`, and hands the arrows back with `onEdge`.
  An `ask`'s image `attachments` labelled `before` and `after` in one `group`, or both with no `group`, show as one slide in the viewer and one split tile on the card (`foldPairs` in `web/next/src/lib/pictures.ts`).
  That slide has one row of buttons floating at the stage's top over the whole-stage picture, Before, Side, Slider and After, Side and Slider joined in the middle, 3.5rem clear of each side on a narrow screen so the viewer's top-right Close never covers After; the row and the Side divider keep Left and Right and hand Up and Down back with `onEdge` (`handBack`).
  Side, the first view, shows them side by side at a divider that drags from the centre; Slider stacks them under a drag slider (`role="slider"`, 5% a Left or Right press, Home and End to the ends, Up and Down handed back with `onEdge` for the slide before or after).
  Both use one 1px divider, the knob on the slider alone, Before on the left, and Before or After shows that picture alone; a picture zooms in at a click or Enter and pans on a drag, while a touch tap on it shows or hides the bars as on every kind and a tap on the slider or the bar's buttons acts on it alone (`web/next/src/components/dashboard/viewer/image.tsx`).
  Label a set of screenshots this way so the owner compares them.
  The kinds past `image` render in `web/next/src/components/dashboard/viewer/documents.tsx`.
  An `html` page comes only from the data folder, which holds `playground page`'s previews folder: `bun run ask` refuses any other path, its symlinks resolved first.
  The route serves it as plain text, as every kept text file; the viewer builds the page itself (`asViewerPage` in `web/next/src/lib/viewer.ts`):
  its fetch policy (`default-src 'none'`, inline script and styles, `data:` images and fonts) as a `<meta>` CSP ahead of its markup, since no header reaches a `srcdoc` page,
  and a script after it that posts Escape and a Left or Right the page left alone, read by `viewerFrameMessage`: one that changed nothing on the page by two frames on, so a deck that moves its slides without taking the key keeps it.
  The frame takes the focus once its page says it is ready, and again when its slide comes back, so the page's own arrows run it.
  It runs in an `<iframe sandbox="allow-scripts">` from `srcdoc` alone; its blob is plain text, and it has no Open in new tab.
  A link clicked in it opens in a browser tab of its own, http or https alone (`viewer: "link"`), and one to a place on the page scrolls there with no load.
  Since a policy reaches no navigation, each load is judged by whether its page posted `viewer: "ready"` (`frameLoad`): a page a script or a refresh sent the frame off to is put back once, then stopped on a notice, each request that took it off having left.
  A `doc` renders through `TranscriptMarkdown` and a `code` file as one fenced block named by its extension (`fenced`), both in a region that keeps Up and Down for scrolling; a `pdf` opens in the browser's own viewer in an unsandboxed frame.
  An `ask` whose title, text or labels have the owner quit, restart, close or stop something, in any form of the four verbs but a past form after after, since, because or while, a determiner and one word ("after the dashboard restarted"), carries `checked`,
  one line saying what the four checks of playbook's **ask** found (the ops jobs and their runtimes in the data folder's `ops/jobs.json`, the live processes under the target, the sessions in it, and the Dashboard's `/api/health`),
  `none` or what still depends on the target, and is refused without it,
  the refusal naming the checks; `checked` stays in the stored payload and the owner's card does not show it.
  A draft's is `{to, text, thread?}`: `to` a short name ("a teammate's thread", "a teammate's DM").
  A draft, and a `slack` decision, carries `thread` whenever the reply answers a Slack conversation (the owner: "for slack previews the draft should show what's going on at other end summary of who said what as tldrs and drafted reply below").
  It holds 1 to 12 `{who, said}`, oldest first: `who` the display name as Slack shows it (a first name, never a raw token), `said` the gist of that message in one line of plain STE100 words.
  The card shows them as So far above the words to send, a draft's under Your reply, each gist rendered through `TranscriptMarkdown card`; `bun run ask example slack` prints a `slack` decision with its `thread` filled.
  Which Slack messages post directly (a developer's) and which come here as a draft (anyone else's) is playbook's **ask** ([rules/ask.md](../../extensions/core/rules/ask.md)).
  Before drafting a reply to a person's message, read that DM or channel from that message on, its thread and the top level both, and draft only while the owner has not answered it already (twice on 23 Oct a reply was drafted after the owner had replied, and both drafts were discarded); `bun run ask new` reminds you once when a draft's `link` is a message.
  What that read found goes in the item's `thread`, a line for each message that leads up to the reply.
  A draft, and a `slack`, `ship` or `ticket` decision, also names where it will land, upfront, not after the send: `link`, the https URL of the Slack thread, channel or DM it posts in (a DM's conversation found or opened first, read-only where it already exists), the canary compare or the pull request,
  or the Linear team or project; or, with no place yet (a brand-new DM nobody can open), `noLink`, one line saying why.
  One of the two is required and both are refused; `ask`, `delete`, `schema` and `budget` take neither.
  A draft that asks or nudges a named person goes to that person's DM, never a public comment: its `to` names the DM and its `link` is that DM conversation, never a thread reply or a PR comment; a channel ask, such as the one in #peer-review-chat, stays in its channel.
  Its card's place line, above its title, shows the link by name (Open thread for a draft or a Slack link, `owner/repo#N`, `owner/repo compare`, a Linear ID) or `No link: <why>` (`upfrontLink` in `web/next/src/lib/inbox.ts`), until the poster's ack links where it landed.
  An update's is `{outcome, link?, text?, attachments?}`, its outcome one of `alert`, `decision`, `finding`, `merged` or `shipped`, so progress or an ETA is no outcome of its own: a session carries its progress in the one item it keeps editing with `bun run ask edit`, never a new item a step, which keeps the Inbox one card a thread.
  An update with `text` or `attachments`, an ask's two fields, is the read-only card: it shows them as an ask's card does, with no Approve, Deny or On Approve line, for something the owner looks at and answers nothing to, such as a table or a preview.
  Unknown keys are refused, and so is an archives-style Slack link (`<workspace>.slack.com/archives/...`) anywhere in an item, a `--link`, a `--label` or a `--note`, naming the command `slack.linkConverter` holds, which rewrites a link to its app form, when that setting is set.
  A raw Slack mention token anywhere in an item (`<@U...>`, `<!subteam^...>`, `<!here>`, `<!channel>`, `<!everyone>`, `<#C...>`) is refused too, since a raw token shows the reader an ID, not who is tagged: mentions read as names (@teammate), and the poster resolves each ID by name when it posts.
  A draft, or a `slack` decision, speaking as we, us, our, ours or ourselves is refused too: it speaks in the owner's voice, first person singular, code, quoted words and links aside, and the all-caps `US` and a hyphenated name (`us-east-1`) passing, a bare URL or Slack's `<url|label>` form being an address, not a voice.
  `status` reads `open` until the owner answers or its poster settles it (`done`, answer `{at, by, choice: "settled", link?, linkLabel?, note?}`, its card reading Answered by the poster with no buttons, nothing delivered, and one the owner answered refused,
  a chat reply included once its poster acked it, since a settle replaces the whole answer; a reply not yet acked still settles), then `approved` (Approve, or Edit with `answer.editedText`), `denied`,
  `sent` or `drafted` (Draft; each with `editedText` when the owner changed the draft), `discarded`, or `cleared` (a decision's Archive, neither yes nor no); an update is `done` from the start, read once `readAt` is set, and its answer is `{dismissedAt}` once the owner dismisses it.
  Delivery is `pending`, then `delivered` (`via: "session"` with `to`, the session that took it) or `failed` with the adapter's code; when it fails, or to collect the answer without waiting, the poster polls `bun run ask get <id> --ack` until `status` is not `open`, and `--ack` records `{at, status: "delivered", via: "cli"}` (`readAnswer`), the first delivery recorded standing.
  A go (Approve, Edit, Send, Draft) closes only once carried out, with where it landed, whatever its kind of link: `bun run ask ack <id> --link <https url>` (the Slack message, the pull request, issue or comment,
  the Linear ticket or comment) or `--no-link "<why>"` for a go with no page (a budget) or a Draft Slack refused (`draft_already_exists`), which `ack` refuses to go without, and one way alone: `--no-link` fits a go with no link recorded, and `--link` one not closed with no link; a deny, a clear or a discard closes when read, by `get --ack` or a bare `ack`.
  Closing stamps `answer.ackedAt`, the first close's time, even after a delivery to the session, and records `answer.link` or `answer.noLink`; until then a go's card reads as still being carried out (`Sending in Slack…` for a sent draft or an approved Slack decision, `Sending to Linear…`, `Saving a Slack draft…` for a Draft, or `Being carried out by <taker>…`),
  and once closed with no link it adds `No link: <why>`, but for a Draft, which reads, gray, `Draft not saved: <why>`.
  `bun run ask stale [--minutes 15] [--since <iso>]` prints one line for each answer of the owner's (not a settle) given since `--since` (default 24 hours ago) and at least `--minutes` ago with no `ackedAt` (a go not closed with its link or why, anything else not read), its delivery pending, failed or typed into the session alike, but for a failed one the owner dismissed,
  which the owner chose not to send (`staleItems`; an answer delivered before acks were stamped, `ACKS_STAMPED_FROM`, is not listed, since it may have been acked with no stamp, while one never delivered still is, and a go delivered before then, read through bun run ask or typed into its session, reads as closed):
  ops-sweep reminds each live poster on it every 30 minutes, and a lead hears of a poster that is down (playbook's Sweep).
- A `secret` ask asks the owner for a value (a client secret, an API key) that goes straight to one sink and is kept nowhere: no row, log line, transcript, response, error or argv holds it.
  Its `key` is the environment variable's name and its `sink` one of the allowlist in code, `secretSinkSchema` in `api/hono/src/lib/dashboard/inbox.ts`, today Vercel alone: `{type: "vercel", project, scope, environments}`, each environment of `development`, `preview` and `production` named once.
  Its card shows what Submit does, a masked field and Submit, Enter submitting too, with no comment box, Archive or Chat about it, so nothing else invites the value; Snooze stays.
  Submit posts `{value, seen}` to `POST /api/v1/inbox/:id/secret`, which `provideSecret()` claims in one write that holds only while the item is open at the version read, so the sink runs once, then hands the value on stdin to `vercel env add <key> --environment <env> --project <project> --scope <scope> --yes`, once an environment in order,
  from the temp folder with its output dropped (`spawnSink` in `api/hono/src/lib/dashboard/secret-sink.ts`, stopped after 60 seconds).
  Only a stack that reads the live machine runs the sink; a fixture or test stack runs nothing and records exit 0 (`runSink`).
  The item turns `provided`, its answer `{at, choice: "provided", results: [{environment, exitCode}]}` (`exitCode` null once stopped, 127 when `vercel` could not start), and its poster is typed `Provided at <at>`, each environment's exit status and the `bun run ask get --ack` that closes it, which `bun run ask stale` chases until it does.
  The card reads `Provided at <time>` with each exit status, green once every environment took it, red while any did not; a value the sink refused takes a new ask.

  ```bash
  bun run ask new <<'EOF'
  {"from": "dispatcher", "title": "Client secret for the web app",
   "preview": {"type": "secret", "key": "GITHUB_CLIENT_SECRET",
               "sink": {"type": "vercel", "project": "web-app", "scope": "acme",
                        "environments": ["production", "preview", "development"]}}}
  EOF
  ```

- The ask's shape: an `ask` decision's text reads the way chat talks to the owner, in three parts, top to bottom:
  1. A picture of the point: a diff or code block for a code change, before and after pictures for a UI change (as `attachments` with the smart viewer), an ASCII flow in a code block for a plain decision.
     Keep each code or ASCII line within `ASK_CODE_COLUMNS` characters, the drawing width the card paragraph above names, whose source (`packages/config/src/inbox.ts`) gives the card width and character width it comes from.
     A wider drawing still posts and shrinks to 10px, then scrolls, so the limit is a writing guide.
  2. Short bullets, one fact each, an emoji as each one's marker.
  3. What Approve does, in the `approve` label, with `deny` beside it: the card shows the two as its choices under the text, in place of its On Approve line.

  A factory session writes each item's words and pictures by the `to-inbox` skill (`extensions/core/skills/to-inbox/SKILL.md`), loaded before `bun run ask new`.

  `bun run ask example code|decision|slack|ui` prints each worked example as an item to fill in, the three asks below and the slack decision above.
  `bun run ask new` prints a hint on stderr, and posts the item all the same, when an ask's text runs past 300 characters with no list, code block or attachment, or a code block in an ask's or a read-only update's text holds a line past `ASK_CODE_COLUMNS` (`shapeHints`).
  The three, as their card shows the text (`tests/api/hono/src/lib/dashboard/ask-shape.test.ts` holds this file to the templates):

  ````markdown
  ```diff
  - const limit = 100
  + const limit = rows.length
  ```

  - 🐛 The export ends at 100 rows.
  - ✅ The fix runs on dev since 24 Oct, with no errors.
  - ↩️ One commit reverts it.
  ````

  Approve: `Port the fix to staging, then main`; Deny: `Keep it on dev`.

  ````markdown
  ```
  web-api
     │ asks for a dry run
     ▼
  builder ──runs──▶ export job (dev)
     │
     ▼
  report to you
  ```

  - 📨 The web-api session asks for a dry run of the export job.
  - 🧪 The run is on dev only and writes no rows.
  - ⏱️ It takes about 10 minutes.
  ````

  Approve: `Take the request and run the dry run`; Deny: `Turn the request down`.

  The UI change leads with its before and after pictures, which join the ask as `attachments` (absolute paths on this Mac, each with its `label` and `group`, which `bun run ask new` copies in), and its card shows them under this text:

  ````markdown
  - 🖼️ The Inbox card shows its pictures as a row of thumbnails.
  - 👆 A click opens the picture in the viewer.
  - 📱 The row scrolls sideways on a phone.
  ````

  Approve: `Build the row as the after picture shows`; Deny: `Keep the card as it is`.

- Threads group the owner's asks: a thread is one thing they asked about, followed up until it is done, and it is theirs, not a session's ([ADR 0013](../adr/0013-threads-are-the-owners-and-live-in-the-dashboards-database.md)).
  It is one table, `thread` (`packages/db/src/schema/thread.ts`), in the dashboard's local Postgres beside the transcripts: a transcript line joins a thread through `claude_entry.thread_id` and `thread_seq`, its place there, and an Inbox item through `inbox_item.thread_id`.
  Its shapes on the wire are the contract in `@packages/config/threads`, read and written through `api/hono/src/lib/dashboard/threads.ts`, and served by `GET /api/v1/threads?page=N`, `GET /api/v1/threads/:id/messages` and `PATCH /api/v1/threads/:id`, each behind the dashboard's guards and the owner rung.
  A page holds 5 open threads, pinned first with the newest pin on top, then `updatedAt` newest first, `id` breaking a tie, archived ones left out (`listThreads`); each carries `unread`, its lines someone else wrote (not `human` or `meta`) stamped after `lastReadAt`, every one while that is null, the count the thread view's Unread holds, and `firstMessageId`,
  the uuid of its lowest `thread_seq` line, the id the chat keys it by.
  A PATCH takes at least one of `archived`, `pinned` and `read`, each setting its time to now or clearing it (read false marks every line unread again), and `title`; it leaves `updatedAt` alone, which only the route that tags a line to a thread bumps, so a change keeps the thread's place.
  An id is 4 characters of `ID_ALPHABET` with at least one letter (`THREAD_ID`); any other is a 400.
  The GET is a read: a fixture stack's 7 made-up threads are written by `bun run ingest` once it has read the fixture's transcripts (`seedFixtureThreads`), only while `dashboardSource()` is the fixture, so they never reach the live dashboard's database.
- A thread's marker routes a line: a transcript line of kind `human`, `peer`, `prompt` or `assistant` whose text opens with `[thread:<id>]`, past the `[Image #n]` marks Claude Code puts first, belongs to that thread (`markerOf` in `@packages/config/threads`).
  It is ASCII and never a bare `#xxxx`, so it never reads as an Inbox id or a PR number.
  Ingest routes each marked line as it stores it (`routeMarked`, called from `applyChunk` in `api/hono/src/lib/sessions/ingest.ts`, in the chunk's own transaction): the line takes the thread's next `threadSeq` and bumps its `updatedAt`, through the same tag `routeMessage` uses, which locks the thread's row, keyed by the line's uuid in place of a quote.
  A marker naming no thread leaves the line untagged, and a tagged line never moves to another thread, a re-read's included.
  So the session's own reply routes too, once playbook's DISPATCH.md has it open with the marker, and so does a peer's report that opens with it.
  This is the dashboard's partial answer to the open question in ZeroSDK's decision that threads group a session's stored lines, a message "tagged with its thread on both sides":
  the receiver's side routes by the marker, while the sender's side is a tool call (`SendMessage`), which carries no thread, so that side stays open.
  Playground routes a line or an item to a thread by hand, when playbook's DISPATCH.md says, with the `bun run thread` CLI (`api/hono/src/bin/dashboard-thread.ts`) or `bun run ask new --thread <id>`, which proves its database as `bun run ask` does; run either in the live dashboard's checkout.

  ```bash
  bun run thread new "Rename the sidebar to Threads"   # prints the new thread's 4-character id, refusing a title past 200 characters
  bun run thread route <id> --quote "<opening words>"   # routes the newest untagged message (a person's, a peer's or a prompt, never the session's own reply, which its marker routes) of the dispatcher's session that starts with the quote; --session <id> names another session
  bun run thread title <id> "<title>"   # renames the thread, refusing a missing id, an empty title or one past 200 characters
  bun run thread list   # the open threads, pinned first, then newest: id, unread count, pinned, title
  ```

  A route tags the message's `claude_entry` row with the thread and the thread's next `threadSeq` (counting from 1 per thread) and bumps the thread's `updatedAt`, in one transaction that locks the thread's row, so two routes to one thread take their numbers in turn.
  The message reaches the database only once ingest brings it, so a route polls for up to `--wait` seconds (60 by default), then fails naming the quote.
- A thread's view (`ThreadView` in `web/next/src/components/dashboard/thread-view.tsx`, at `/dashboard/threads/<id>`) is a selective chat: its messages alone, by `threadSeq`, from `GET /api/v1/threads/:id/messages` (`threadMessages`), each through `TranscriptMessage` with its files as chips, an image a source line names among them,
  and a meta line left out, since a thread is not a chat that completes).
  It shows the first message under You asked when it is yours, then the ones someone else wrote stamped after `lastReadAt` under Unread, the count the sidebar shows, then the rest, your replies included, folded under Full history (`threadSections` in `web/next/src/lib/threads.ts`), and marks the thread read as it opens.
  It keeps the moment it opened and the `lastReadAt` it opened with, so Unread holds still while it is open and everything stamped after that moment shows unfolded at the foot, a reply sent from the view included.
  Back to chat in its header goes to `/dashboard`, and the browser's Back works, since the view is its own page.
  Its composer is the primary dispatcher's, with a draft of its own (`<dispatcher>#<id>`), and sends through the outbox with `threadId`.
  - Routing a sent message: `POST /api/v1/messages` refuses a `threadId` to any other session (400) or for a thread that does not exist (404), and delivers the text with the thread's marker put first (`withMarker`), so ingest routes it once it brings it, with no wait on its words.
    A message of files alone carries the marker before its `Attached:` line, and an empty one stays empty, for the delivery to refuse.
    A message that opens with `/` or `!` goes unmarked (`COMMAND_START`), so a skill's command still runs and any other command is still refused, and it routes nowhere; New thread opens no thread for it.
    The main chat is unchanged: a routed message stays in it in time order, and a routed one never moves to another thread.
    The outbox matches the message to its transcript line past the marker (`findDelivery` in `web/next/src/lib/outbox.ts`).
    The marker routes the message's line alone, so `threadMessages` names its image by the session's untagged source line of the same prompt (`sourceLines`).
    Until it is routed, a message sent from the view shows at its end as on its way (`pendingIn`), for up to 90 seconds; one that failed points to the full chat for Retry or Edit.
- The main chat starts a thread: the primary dispatcher's composer there has a New thread toggle, and a message sent with it on goes with `newThread: true` in place of `threadId`.
  The API opens a thread titled from the message's first line (`quoteOf`: up to a pasted path, at most 80 characters, `Attached:` for files alone; renamed later through the PATCH), sends the message with its marker, and names the thread under `threadId` in its answer.
  A new thread whose message was refused before typing is removed (`dropThread`), while one cut off as it typed stays, since the message may have gone, and the refusal names it under `threadId`, so the outbox's Retry sends to it; one left pasted and unsent in a herdr session's box stays too, and the outbox's own wait sends its retry there (messages.md).
  A retry that `deliver()` answers from its first try's row (`replayed`) drops the thread it opened and names none, since the first try's marker already routed the message.
- A leading marker reads as a chip in every chat, the main one and a thread's view alike: `TranscriptBubble` in `web/next/src/components/transcript-message.tsx` shows the thread's id as an outline badge that opens `/dashboard/threads/<id>`, and the words after it.
