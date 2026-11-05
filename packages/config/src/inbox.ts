// The widest line, in characters, a drawing in an Inbox ask may run and still show whole on the narrowest real card, so bun run ask can warn its author before the card scrolls it: the aside at its 30% minimum beside the sidebar on a 1512px screen is 377px, its pre 319px and 299px inside the pre's 1.25rem padding, where a 60-column line draws at 8.29px (measured), above the 7px floor of fitWidth (web/next/src/components/transcript-markdown.tsx), which grows a drawing up to 16px on a wider card.
export const ASK_CODE_COLUMNS = 60

// When the Inbox stopped moving cards by the clock, set at this change's last commit before the live dashboard took it: the old clock had already moved every card answered or read before then to Done, so those keep the list's week, while each one since stays in the Inbox until a verb moves it (inboxView in the web, listItems in the API).
export const CLOCKS_STOPPED_AT = "2026-11-05T03:44:00.000Z"
