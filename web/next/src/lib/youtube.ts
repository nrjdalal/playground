// A YouTube link the sidebar's player can play: a song, a playlist, or a song inside a playlist.
export type YouTubeLink = { list?: string; videoId?: string }

const HOSTS = new Set([
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "youtube.com",
  "www.youtube.com",
])
const ID = /^[\w-]{11}$/
const LIST = /^[\w-]{2,}$/

// The default first song in Recently played.
export const DEMO_SONG = {
  title: "Rick Astley - Never Gonna Give You Up (Official Video)",
  url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
}

export function parseYouTube(text: string): YouTubeLink | null {
  let url: URL
  try {
    url = new URL(text.trim())
  } catch {
    return null
  }
  if (!/^https?:$/.test(url.protocol) || !HOSTS.has(url.hostname)) return null
  const [first, second] = url.pathname.split("/").filter(Boolean)
  const videoId =
    url.hostname === "youtu.be"
      ? first
      : first === "watch"
        ? url.searchParams.get("v")
        : first === "shorts" || first === "embed" || first === "live"
          ? second
          : undefined
  const list = url.searchParams.get("list") ?? undefined
  const link: YouTubeLink = {
    ...(list && LIST.test(list) ? { list } : {}),
    ...(videoId && ID.test(videoId) ? { videoId } : {}),
  }
  return link.list || link.videoId ? link : null
}

export const coverOf = (videoId: string) => `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`

export type Shelf = "liked" | "recent" | "search"

// The songs in a random order (Fisher-Yates), the song just heard never first.
export function deal(ids: string[], last?: string): string[] {
  const order = [...ids]
  for (let at = order.length - 1; at > 0; at--) {
    const pick = Math.floor(Math.random() * (at + 1))
    ;[order[at], order[pick]] = [order[pick] as string, order[at] as string]
  }
  if (order.length > 1 && order[0] === last) [order[0], order[1]] = [order[1] as string, last]
  return order
}

// What a row of the music box plays: a Recent or Liked song, then the rest of its list in order round from the top, or dealt while shuffle is on; null plays a search result, or a list of one, on into YouTube's mix.
export function queueOf(
  shelf: Shelf,
  ids: string[],
  id: string,
  shuffle: boolean,
): string[] | null {
  const at = ids.indexOf(id)
  if (shelf === "search" || at < 0 || ids.length < 2) return null
  const rest = [...ids.slice(at + 1), ...ids.slice(0, at)]
  return [id, ...(shuffle ? deal(rest) : rest)]
}
