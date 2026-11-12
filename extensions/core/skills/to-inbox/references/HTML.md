# An HTML demo page

A UI not yet built goes to the owner as a page to click, never a paragraph about it.

1. **Write it** in your scratchpad. Done when the page shows one tangible thing: the tooltip, the toolbar or the screen in question, with made-up data.
2. **Keep it self-contained.** The viewer's frame fetches nothing, so the page carries its CSS and any SVG inline, with no CDN, font or script from outside. Done when no `src`, `href`, `url(` or `@import` in the page starts with `http` or `//`.
3. **Share one stylesheet.** Start the page's `<style>` with the rules of `~/.playground/previews/demo.css`, writing that file from your page's base rules when it is missing, and add a rule to it when a second page would want one, so the demos look like one set. Done when the page's `<style>` starts with those rules.
   A PDF goes as an HTML page that embeds it (`<embed src="data:application/pdf;base64,...">`) beside a Download link (`<a download="<name>.pdf" href="data:application/pdf;base64,...">`), since `playground page` takes only `.html`.
   Print a page to PDF through CDP: `agent-browser get cdp-url`, then `Page.printToPDF` with `preferCSSPageSize: true`, which keeps the page's own `@page` size, since `agent-browser pdf` prints US Letter only (an A4 page came out 612 by 792 points from `agent-browser pdf`, and 595 by 842 from `Page.printToPDF`, measured 12 Nov).

4. **Keep it, then attach it alone.** `playground page <file.html> --title "<title>" --by <you>` copies it into the previews folder and prints `Kept <path>` (the **local page** rule; `bun run ask` takes an `html` file only from the data folder, `.agents/dashboard/asks.md`). Attach that kept path as the item's one attachment with `kind: "html"`, so the card shows it live at its full width, with Download, Open in new tab, Open in side panel and Full screen in its corner. Done when the item holds that one kept file.
