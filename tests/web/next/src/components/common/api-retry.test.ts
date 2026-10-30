import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { ApiRetry } from "../../../../../../web/next/src/components/common/api-retry"

const web = join(import.meta.dir, "../../../../../../web/next")
const { createElement } = (await import(Bun.resolveSync("react", web))) as {
  createElement: (type: unknown, props?: unknown, ...children: unknown[]) => unknown
}
const { renderToStaticMarkup } = (await import(Bun.resolveSync("react-dom/server", web))) as {
  renderToStaticMarkup: (node: unknown) => string
}
const { AppRouterContext } = (await import(
  Bun.resolveSync("next/dist/shared/lib/app-router-context.shared-runtime", web)
)) as { AppRouterContext: { Provider: unknown } }

describe("ApiRetry", () => {
  // The protected layout draws this in place of throwing ApiUnavailable, so next shows no error document, whose every dev sync reloads the page
  test("says the API cannot be reached and when it tries again, inside the app's own page", () => {
    const html = renderToStaticMarkup(
      createElement(
        AppRouterContext.Provider,
        { value: { refresh: () => {} } },
        createElement(ApiRetry),
      ),
    )
    expect(html).toContain("Can&#x27;t reach the API")
    expect(html).toContain("Retrying in 5s")
    expect(html).toContain('data-slot="empty"')
    expect(html).not.toContain("__next_error__")
  })
})
