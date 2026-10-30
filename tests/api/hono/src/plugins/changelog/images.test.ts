import { describe, expect, test } from "bun:test"
import { mkdtemp, stat, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { drawPng, fixtureImages } from "../../../../../../api/hono/src/plugins/changelog/fixture"
import {
  IMAGE_ID,
  imageSize,
  readImage,
  storeImage,
  withSizes,
} from "../../../../../../api/hono/src/plugins/changelog/images"

const PNG = drawPng(4, 3, [{ color: [14, 165, 233], h: 1, w: 1, x: 0, y: 0 }])

const scratch = () => mkdtemp(join(tmpdir(), "changelog-images-"))

describe("the changelog's screenshots", () => {
  test("keeps an image 0600 in a 0700 folder under a name it makes, and reads it back", async () => {
    const dir = join(await scratch(), "changelog")
    const id = await storeImage(PNG, dir)
    expect(id).toMatch(IMAGE_ID)
    expect(id).toEndWith(".png")
    expect((await stat(dir)).mode & 0o777).toBe(0o700)
    expect((await stat(join(dir, id!))).mode & 0o777).toBe(0o600)
    expect((await readImage(id!, dir))?.bytes).toEqual(Uint8Array.from(PNG))
  })

  test("refuses bytes that are not a raster image, and an id the store would never give", async () => {
    const dir = await scratch()
    expect(await storeImage(new TextEncoder().encode("<svg onload=x>"), dir)).toBeNull()
    expect(await storeImage(new TextEncoder().encode("%PDF-1.7"), dir)).toBeNull()
    expect(await storeImage(new Uint8Array(), dir)).toBeNull()
    expect(await readImage("../secret.png", dir)).toBeNull()
    expect(await readImage("notes.txt", dir)).toBeNull()
  })

  test("serves nothing through a symlink", async () => {
    const dir = await scratch()
    const real = await storeImage(PNG, join(dir, "real"))
    const linked = join(dir, "linked")
    await symlink(join(dir, "real"), linked)
    expect(await readImage(real!, linked)).toBeNull()
  })

  test("a fixture stack serves the drawn screenshots from memory, and they are PNGs", async () => {
    const dir = await scratch()
    for (const image of fixtureImages()) {
      expect(image.id).toMatch(IMAGE_ID)
      expect(Array.from(image.bytes.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47])
      expect((await readImage(image.id, dir))?.bytes).toEqual(Uint8Array.from(image.bytes))
    }
  })

  test("reads an image's size from its header, so the page holds its box before it loads", () => {
    expect(imageSize(drawPng(37, 21, []))).toEqual({ height: 21, width: 37 })
    const gif = new Uint8Array([...new TextEncoder().encode("GIF89a"), 40, 1, 30, 0])
    expect(imageSize(gif)).toEqual({ height: 30, width: 296 })
    const webp = (chunk: string, body: number[]) =>
      new Uint8Array([
        ...new TextEncoder().encode("RIFF"),
        0,
        0,
        0,
        0,
        ...new TextEncoder().encode(`WEBP${chunk}`),
        ...body,
      ])
    expect(imageSize(webp("VP8X", [0, 0, 0, 0, 0, 0, 0, 0, 99, 1, 0, 49, 0, 0]))).toEqual({
      height: 50,
      width: 356,
    })
    const vp8 = [0, 0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a, 0x40, 0x01, 0xf0, 0x00]
    expect(imageSize(webp("VP8 ", vp8))).toEqual({ height: 240, width: 320 })
    // 14 bits of width less one, then 14 of height less one: 100x60
    const bits = 99 | (59 << 14)
    const vp8l = [
      0,
      0,
      0,
      0,
      0x2f,
      bits & 0xff,
      (bits >> 8) & 0xff,
      (bits >> 16) & 0xff,
      bits >>> 24,
    ]
    expect(imageSize(webp("VP8L", vp8l))).toEqual({ height: 60, width: 100 })
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 1, 44, 2, 88, 3, 0, 0,
    ])
    expect(imageSize(jpeg)).toEqual({ height: 300, width: 600 })
    expect(imageSize(new TextEncoder().encode("not an image"))).toBeNull()
  })

  test("serves each screenshot with its size, null once its file is gone", async () => {
    const dir = await scratch()
    const id = (await storeImage(drawPng(12, 7, []), dir))!
    const gone = "0f8b6a3e-2c1d-4e5f-9a7b-1c2d3e4f5a6b.png"
    const [entry] = await withSizes(
      [
        {
          images: [
            { alt: "Before", id },
            { alt: "After", id: gone },
          ],
          text: "x",
        },
      ],
      dir,
    )
    expect(entry).toEqual({
      images: [
        { alt: "Before", height: 7, id, width: 12 },
        { alt: "After", height: null, id: gone, width: null },
      ],
      text: "x",
    })
    const [fixture] = await withSizes([{ images: [{ alt: "f", id: fixtureImages()[0]!.id }] }], dir)
    expect(fixture?.images[0]).toMatchObject({ height: 450, width: 800 })
  })
})
