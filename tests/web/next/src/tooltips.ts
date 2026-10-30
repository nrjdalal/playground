import { mock } from "bun:test"
import { join } from "node:path"

// A static render never opens a Tooltip, whose content mounts in a portal on hover, so a test that imports this renders each one inline as <span data-slot="tooltip-content">, which tipsOf reads; a hidden one (SidebarMenuButton's while expanded, unless the row asks) renders nothing, as it shows nothing. bun keeps a module mock for every test file after this one, and the swap only adds markup, so later files see the same elements. The content span ends at its tooltip-end marker, since a line-by-line tooltip nests row spans inside it.
const web = join(import.meta.dir, "../../../../web/next")
const { cloneElement, createElement, Fragment } = (await import(Bun.resolveSync("react", web))) as {
  cloneElement: (element: unknown, props?: unknown, ...children: unknown[]) => unknown
  createElement: (type: unknown, props?: unknown, ...children: unknown[]) => unknown
  Fragment: unknown
}
// the element's own props win over the trigger's, as Base UI's mergeProps(props, render.props) gives them
type Props = { children?: unknown; hidden?: boolean; render?: { props: { children?: unknown } } }
mock.module(join(web, "src/components/ui/tooltip.tsx"), () => ({
  Tooltip: ({ children }: Props) => createElement(Fragment, null, children),
  TooltipContent: ({ children, hidden }: Props) =>
    hidden
      ? null
      : createElement(
          "span",
          { "data-slot": "tooltip-content" },
          children,
          createElement("span", { "data-slot": "tooltip-end" }),
        ),
  TooltipProvider: ({ children }: Props) => createElement(Fragment, null, children),
  TooltipTrigger: ({ children, render, ...props }: Props) =>
    render
      ? cloneElement(render, { ...props, ...render.props }, children ?? render.props.children)
      : createElement("button", props, children),
}))

const unescape = (text: string) =>
  text
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")

// Every tooltip's words in a static render, in document order.
export const tipsOf = (html: string) =>
  [
    ...html.matchAll(
      /<span data-slot="tooltip-content">([\s\S]*?)<span data-slot="tooltip-end"><\/span>/g,
    ),
  ].map(([, text]) => unescape(text))
