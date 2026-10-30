import { describe, expect, test } from "bun:test"

import { chipResult } from "../../../../../packages/scripts/src/verify/upload-keep"

describe("chipResult", () => {
  test("passes a chip that waits while its upload gets no answer", () => {
    expect(chipResult("c", { description: "Queued", state: "uploading" }, "kept").ok).toBe(true)
  })

  test("fails a kept chip that does not wait: failed, or still on its first try", () => {
    expect(chipResult("c", { description: "Upload failed", state: "error" }, "kept").ok).toBe(false)
    expect(chipResult("c", { description: "Uploading", state: "uploading" }, "kept").ok).toBe(false)
  })

  test("fails a file dropped when its upload got no answer, as before #1070", () => {
    const dropped = chipResult("c", null, "kept")
    expect(dropped.ok).toBe(false)
    expect(dropped.detail).toContain("the file was dropped")
  })

  test("passes the chip once uploaded, and fails one still waiting or failed", () => {
    expect(chipResult("c", { description: "Image · 1 KB", state: "done" }, "done").ok).toBe(true)
    expect(chipResult("c", { description: "Upload failed", state: "error" }, "done").ok).toBe(false)
  })
})
