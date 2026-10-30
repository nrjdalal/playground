# An HTML demo page

A UI not yet built goes to the owner as a page to click, never a paragraph about it.

1. **Write it** under `~/.playground/previews/` (`bun run ask` takes an `html` file only from under `~/.playground/`). Done when the page shows one tangible thing: the tooltip, the toolbar or the screen in question, with made-up data.
2. **Keep it self-contained.** The viewer's frame fetches nothing, so the page carries its CSS and any SVG inline, with no CDN, font or script from outside. Done when the page opens whole from disk with the network off.
3. **Share one stylesheet.** Start the page's `<style>` with the rules of `~/.playground/previews/demo.css`, writing that file from your page's base rules when it is missing, and add a rule to it when a second page would want one, so the demos look like one set. Done when the page's `<style>` starts with those rules.
4. **Attach it alone**, as the item's one attachment with `kind: "html"`, so the card shows it live at its full width, with a full-screen square in its corner that opens it in the viewer. Done when the item holds that one file.
