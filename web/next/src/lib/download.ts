// Pure: the name a Content-Disposition gives, its UTF-8 filename* first, else its filename; null when it names none.
export function dispositionName(header: string | null): string | null {
  if (!header) return null
  const extended = /filename\*=UTF-8''([^;\s]+)/i.exec(header)?.[1]
  if (extended) {
    try {
      return decodeURIComponent(extended)
    } catch {}
  }
  return /filename="([^"]*)"/i.exec(header)?.[1] || null
}

// Saves a file the API serves for download under the name the API gives it: fetched with the owner's cookie, since a route that takes a trusted Origin refuses a plain link, then handed to the browser as a blob.
export async function saveFrom(url: string): Promise<void> {
  const response = await fetch(url, { credentials: "include" })
  if (!response.ok) throw new Error(`The file did not download (${response.status})`)
  const link = document.createElement("a")
  link.href = URL.createObjectURL(await response.blob())
  link.download = dispositionName(response.headers.get("content-disposition")) ?? "download"
  link.click()
  // the browser reads the blob after the click returns, so it is let go a minute later
  setTimeout(() => URL.revokeObjectURL(link.href), 60_000)
}
