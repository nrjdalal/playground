// The box a page draws in beside the sidebar: a column that scrolls on its own, so a channel's header and composer stay in view while its messages scroll between them. The dashboard's page (its half on a wide screen, its tab on a phone) and the hosted Yard's pages draw it, so a channel looks the same on both.
export const PAGE_PANE = "flex min-h-0 flex-col overflow-y-auto"
