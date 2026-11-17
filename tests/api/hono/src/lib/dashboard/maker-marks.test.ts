import { expect, test } from "bun:test"

import { MAKER_MARKS } from "../../../../../../api/hono/src/lib/dashboard/maker-marks"

// Ornith publishes no logo, so its mark is ours: one path on a 24 box with no colour of its own, so a mask draws it in the text colour with no tile (PG-2662).
test("Ornith's mark is one path on a 24 box, with no tile, image or colour of its own", () => {
  const mark = MAKER_MARKS["ornith-ai"]!
  expect(mark).toStartWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">')
  expect(mark.match(/<path /g)).toHaveLength(1)
  expect(mark).not.toMatch(/<rect|<image|fill=/)
})
