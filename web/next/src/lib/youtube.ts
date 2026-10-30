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
