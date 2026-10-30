// The sidebar player's search: YouTube's own results page, then its next pages as the list scrolls, since the IFrame API no longer searches and the Data API needs a key.
export type YouTubeResult = { channel: string; id: string; length: string; title: string }
// one page of results, and the token for the next (the client version and YouTube's continuation, joined by a space), null at the end
export type YouTubePage = { results: YouTubeResult[]; next: string | null }

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"

type Node = { [key: string]: unknown }
type Text = { runs?: { text?: string }[]; simpleText?: string }
const textOf = (value: unknown) => {
  const text = value as Text | undefined
  return text?.simpleText ?? text?.runs?.map((run) => run.text ?? "").join("") ?? ""
}

// Pure: every videoRenderer in a page's data, in the order YouTube ranks them, and its continuation token
export function readPage(data: unknown): { results: YouTubeResult[]; token: string | null } {
  const results: YouTubeResult[] = []
  let token: string | null = null
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return
    const video = (node as Node).videoRenderer as Node | undefined
    if (video && typeof video.videoId === "string" && /^[\w-]{11}$/.test(video.videoId)) {
      results.push({
        channel: textOf(video.ownerText),
        id: video.videoId,
        length: textOf(video.lengthText),
        title: textOf(video.title),
      })
      return
    }
    const command = (node as Node).continuationCommand as Node | undefined
    if (typeof command?.token === "string") token = command.token
    for (const child of Object.values(node)) walk(child)
  }
  walk(data)
  return { results, token }
}

// Pure: the first page from the results page's HTML, its ytInitialData and its client version
export function readResults(html: string): YouTubePage {
  const json = html.match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/)?.[1]
  const version = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1]
  if (!json) return { results: [], next: null }
  const { results, token } = readPage(JSON.parse(json))
  return { results, next: token && version ? `${version} ${token}` : null }
}

export async function searchYouTube(query: string, next?: string): Promise<YouTubePage> {
  const signal = AbortSignal.timeout(8000)
  if (!next) {
    const response = await fetch(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`,
      { headers: { "accept-language": "en", "user-agent": UA }, signal },
    )
    return response.ok ? readResults(await response.text()) : { results: [], next: null }
  }
  const [version, continuation] = next.split(" ")
  const response = await fetch("https://www.youtube.com/youtubei/v1/search", {
    body: JSON.stringify({
      context: { client: { clientName: "WEB", clientVersion: version, hl: "en" } },
      continuation,
    }),
    headers: { "content-type": "application/json", "user-agent": UA },
    method: "POST",
    signal,
  })
  if (!response.ok) return { results: [], next: null }
  const { results, token } = readPage(await response.json())
  return { results, next: token ? `${version} ${token}` : null }
}
