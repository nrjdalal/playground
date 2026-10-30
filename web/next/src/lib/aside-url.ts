import { createContext, useContext } from "react"

// An app drawn in the aside (#i787) names its URL state under its own keys, so its search, sort, filters and picks never reach the page beside it, whose table may read the same keys; the aside's pane holds those keys in memory (components/apps/app-pane.tsx), never in the page's URL.
export const AsideUrl = createContext("")

// A URL state key as this component's place names it: the key itself on a page, prefixed in the aside.
export const useUrlKey = (key: string) => useContext(AsideUrl) + key

export const useInAside = () => useContext(AsideUrl) !== ""
