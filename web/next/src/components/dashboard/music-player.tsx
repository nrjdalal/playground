"use client"

import {
  RiExpandDiagonalLine,
  RiForward10Line,
  RiHeartFill,
  RiHeartLine,
  RiMusic2Line,
  RiPauseFill,
  RiPictureInPicture2Line,
  RiPictureInPictureExitLine,
  RiPlayFill,
  RiReplay10Line,
  RiSearchLine,
  RiShuffleLine,
  RiSkipBackFill,
  RiSkipForwardFill,
  RiVolumeMuteLine,
  RiVolumeUpLine,
} from "@remixicon/react"
import { cn } from "cn"
import {
  type FormEvent,
  type PointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { apiClient, unwrap } from "@/lib/api/client"
import { BAR_ITEM, GLASS } from "@/lib/floating-bar"
import { coverOf, DEMO_SONG, parseYouTube, type YouTubeLink } from "@/lib/youtube"

// The few calls of YouTube's IFrame Player API the player makes (developers.google.com/youtube/iframe_api_reference).
type YTPlayer = {
  getCurrentTime: () => number
  getDuration: () => number
  getPlayerState: () => number
  getVolume: () => number
  // undefined while the player switches between a playlist and a lone song
  getVideoData: () => { title?: string; video_id?: string } | undefined
  isMuted: () => boolean
  cuePlaylist: (options: { list: string; listType: "playlist" }) => void
  getPlaylist: () => string[] | null
  getPlaylistIndex: () => number
  loadPlaylist: (options: { index?: number; list: string; listType: "playlist" } | string[]) => void
  loadVideoById: (videoId: string, startSeconds?: number) => void
  mute: () => void
  nextVideo: () => void
  pauseVideo: () => void
  playVideo: () => void
  playVideoAt: (index: number) => void
  previousVideo: () => void
  seekTo: (seconds: number, allowSeekAhead: boolean) => void
  setVolume: (volume: number) => void
  unMute: () => void
}
type YTGlobal = {
  Player: new (
    element: HTMLElement,
    options: {
      events: {
        onReady: () => void
        onStateChange: (event: { data: number }) => void
      }
      height: number
      playerVars: Record<string, number>
      width: number
    },
  ) => YTPlayer
}
declare global {
  interface Window {
    onYouTubeIframeAPIReady?: () => void
    YT?: YTGlobal
  }
}

const PLAYING = 1
const PAUSED = 2
// how long the cover stays once a song plays, past the controls YouTube shows for about 3 seconds as a song starts or resumes
const VEIL_AFTER_PLAY = 3500
const CUED = 5
const ENDED = 0
const LAST_KEY = "playground:music:last"
const LIKED_KEY = "playground:music:liked"
const RECENT_KEY = "playground:music:recent"
const VOLUME_KEY = "playground:music:volume"
// Recently played keeps the last fifty songs, its window scrolling past the first five
const RECENT_MAX = 50

type Shelf = "liked" | "recent" | "search"
type Song = { detail?: string; title: string; url: string; videoId?: string }
type Last = Song & { time: number; videoId: string }
type Now = {
  duration: number
  muted: boolean
  // the last song, kept from the last visit and not yet loaded, so Play picks it up where it stopped
  parked?: boolean
  playing: boolean
  time: number
  title: string
  videoId: string
}

let api: Promise<YTGlobal> | null = null
// YouTube's script, loaded once, the first time the box opens, so a page that never plays loads nothing.
function loadApi(): Promise<YTGlobal> {
  api ??= new Promise((resolve) => {
    if (window.YT?.Player) return resolve(window.YT)
    window.onYouTubeIframeAPIReady = () => window.YT && resolve(window.YT)
    const script = document.createElement("script")
    script.src = "https://www.youtube.com/iframe_api"
    document.head.append(script)
  })
  return api
}

// Where the video shows: nowhere (the card), the sidebar's card grown to the video's size, or detached into a floating picture-in-picture window, first over the chat at the top.
type View = "card" | "inline" | "pip"

// the frame's host: small and see-through under the page, laid over the card's video slot, or the floating window; the frame never moves, so the song plays on
const HIDDEN = "pointer-events-none fixed right-0 bottom-0 -z-10 size-[200px] opacity-0"
// neither clips, so the volume slider can rise past the video's top edge; the frame clips itself to the host's rounded box
const INLINE = "group/video @container fixed z-[60] rounded-lg bg-black"
const PIP = "group/video @container fixed z-[60] rounded-xl border border-border bg-black shadow-lg"
// a hot reload starts this module afresh, so it takes over the frame's host already in the page, and the player kept on the window, and the song plays on with its controls and its cover
let host =
  typeof document === "undefined"
    ? null
    : document.querySelector<HTMLDivElement>("[data-music-player]")
// the player and the card that hears its events, kept on the tab, so a card mounted again (a phone's sidebar sheet opened again, a hot reload) takes over the player still playing
const tab = globalThis as {
  playgroundMusic?: Promise<YTPlayer>
  playgroundMusicOnState?: (event: unknown) => void
}

// where the window was dragged or resized to, kept for the tab, so a second Detach opens it there
type PipBox = { left: number; top: number; width: number }
const PIP_MIN = 200
// the share of a 16:9 frame cut from each side and from top and bottom, where the song's picture carries black bars of its own
type Crop = { x: number; y: number }
const FULL: Crop = { x: 0, y: 0 }
const ratioOf = (crop: Crop) => (16 * (1 - 2 * crop.x)) / (9 * (1 - 2 * crop.y))

// One still's bars: the rows from the top and bottom, and the columns from each side, that are all but black, the thinner of each pair kept, and a bar of 2px or less read as none.
function barsOf(img: HTMLImageElement): Crop {
  const { naturalHeight: h, naturalWidth: w } = img
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const pen = canvas.getContext("2d", { willReadFrequently: true })
  if (!pen || !w || !h) return FULL
  pen.drawImage(img, 0, 0)
  let data: Uint8ClampedArray
  try {
    data = pen.getImageData(0, 0, w, h).data
  } catch {
    return FULL
  }
  const dark = (x: number, y: number) => {
    const at = (y * w + x) * 4
    return Math.max(data[at] ?? 0, data[at + 1] ?? 0, data[at + 2] ?? 0) < 24
  }
  const row = (y: number) => {
    let count = 0
    for (let x = 0; x < w; x++) if (dark(x, y)) count++
    return count > w * 0.98
  }
  const column = (x: number) => {
    let count = 0
    for (let y = 0; y < h; y++) if (dark(x, y)) count++
    return count > h * 0.98
  }
  const run = (line: (at: number) => boolean, from: number, step: number, most: number) => {
    let n = 0
    while (n < most && line(from + n * step)) n++
    return n
  }
  // a bar runs at most half way in, and one whose two sides meet there (an all-black still) reads as none, so the crop never takes the whole picture
  const bar = (line: (at: number) => boolean, size: number) => {
    const most = size / 2
    const n = Math.min(run(line, 0, 1, most), run(line, size - 1, -1, most))
    return n > 2 && n < most ? n / size : 0
  }
  return { x: bar(column, w), y: bar(row, h) }
}

// Reads a song's black bars from three stills YouTube takes from it, a quarter, half and three quarters in, each as wide as the player, keeping the thinnest each way, so a dark scene never reads as a bar; the window then takes the picture's own shape
function readCrop(id: string): Promise<Crop> {
  const still = (n: number) =>
    new Promise<Crop>((resolve) => {
      const img = new Image()
      img.crossOrigin = "anonymous"
      img.onload = () => resolve(barsOf(img))
      img.onerror = () => resolve(FULL)
      img.src = `https://i.ytimg.com/vi/${id}/mq${n}.jpg`
    })
  return Promise.all([1, 2, 3].map(still)).then((crops) => ({
    x: Math.min(...crops.map((crop) => crop.x)),
    y: Math.min(...crops.map((crop) => crop.y)),
  }))
}

// a width the window takes in the video's shape, its height inside the screen's
const fitWidth = (width: number, ratio: number) =>
  Math.max(PIP_MIN, Math.min(width, window.innerHeight * ratio))

// the window first opens over the chat at the very top, its side borders on the chat's own, the sidebar's edge and the split's line
function firstBox(ratio: number): PipBox {
  const page = document.querySelector("[data-dashboard-page]")?.getBoundingClientRect()
  return {
    left: (page?.left ?? 1) - 1,
    top: 0,
    width: fitWidth(page ? page.width + 2 : 400, ratio),
  }
}

// a song of another shape keeps the window's width and grows from the third of the screen it sits in: down from the top third, up from the bottom third, both ways from the middle
function reshaped(box: PipBox, was: number, ratio: number): PipBox {
  const width = fitWidth(box.width, ratio)
  const before = box.width / was
  const after = width / ratio
  const zone = Math.floor(((box.top + before / 2) / window.innerHeight) * 3)
  const top =
    zone <= 0 ? box.top : zone >= 2 ? box.top + before - after : box.top + (before - after) / 2
  return {
    left: box.left,
    top: Math.min(Math.max(0, top), window.innerHeight - after),
    width,
  }
}
// YouTube's end-screen cards show in a video's last 5 to 20 seconds
const ENDING = 20

// the edge or corner a press resizes the window from, and its new box, its shape kept, the sides opposite held still and the rest kept on the screen
const EDGES = ["t", "r", "b", "l", "tl", "tr", "bl", "br"] as const
type Edge = (typeof EDGES)[number]
function resized(rect: DOMRect, edge: Edge, dx: number, dy: number, ratio: number): PipBox {
  const { bottom, left, right, top, width } = rect
  const west = edge.includes("l")
  const north = edge.startsWith("t")
  const grow = edge === "t" || edge === "b" ? (north ? -dy : dy) * ratio : west ? -dx : dx
  const most = Math.min(
    west ? right : window.innerWidth - left,
    (north ? bottom : window.innerHeight - top) * ratio,
  )
  const next = Math.min(Math.max(PIP_MIN, width + grow), most)
  return {
    left: west ? right - next : left,
    top: north ? bottom - next / ratio : top,
    width: next,
  }
}

function showVideo(view: View, crop: Crop, box: PipBox | null) {
  if (!host) return
  const ratio = ratioOf(crop)
  host.className = view === "pip" ? PIP : view === "inline" ? INLINE : HIDDEN
  // at the screen's top edge, the window's top corners are square
  let flat = false
  if (view !== "inline") {
    const { left, top, width } = box ?? firstBox(ratio)
    flat = view === "pip" && top <= 0
    host.style.cssText =
      view === "pip"
        ? `aspect-ratio:${ratio};left:${left}px;top:${top}px;width:${width}px;right:auto;bottom:auto${flat ? ";border-top-left-radius:0;border-top-right-radius:0" : ""}`
        : ""
  }
  host.setAttribute("aria-hidden", view === "card" ? "true" : "false")
  const frame = host.querySelector("iframe")
  // inside its clipping layer, the frame is the 16:9 player grown so the picture inside its bars fills the host, and runs 60px further past its top and bottom, so YouTube's title bar and logo row fall outside it too
  if (!frame) return
  const { x, y } = crop
  frame.style.cssText =
    view === "card"
      ? ""
      : `display:block;position:absolute;pointer-events:none;left:calc(-100% * ${x / (1 - 2 * x)});width:calc(100% / ${1 - 2 * x});top:calc(-100% * ${y / (1 - 2 * y)} - 60px);height:calc(100% / ${1 - 2 * y} + 120px)`
}

// One player for the whole tab, in the body under the page and see-through (a frame parked off-screen is throttled and never says it is ready), so it plays on across the Dashboard's pages.
function getPlayer(onState: (event: unknown) => void): Promise<YTPlayer> {
  tab.playgroundMusicOnState = onState
  tab.playgroundMusic ??= loadApi().then(
    (YT) =>
      new Promise((resolve) => {
        // a hot reload starts this module afresh, so an earlier player's frame would play on beside the new one
        for (const stale of document.querySelectorAll("[data-music-player]")) stale.remove()
        const box = document.createElement("div")
        box.dataset.musicPlayer = ""
        box.setAttribute("aria-hidden", "true")
        box.className = HIDDEN
        // the frame's own clipping layer, rounded as the host is, so the host itself clips nothing and the volume slider can rise past its top
        const clip = document.createElement("div")
        clip.className = "absolute inset-0 overflow-hidden rounded-[inherit]"
        const element = document.createElement("div")
        clip.append(element)
        box.append(clip)
        document.body.append(box)
        host = box
        const player: YTPlayer = new YT.Player(element, {
          events: {
            onReady: () => resolve(player),
            onStateChange: (event: unknown) => tab.playgroundMusicOnState?.(event),
          },
          height: 200,
          playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            fs: 0,
            iv_load_policy: 3,
            playsinline: 1,
            rel: 0,
          },
          width: 200,
        })
      }),
  )
  return tab.playgroundMusic
}

const readJson = <T,>(key: string): T | null => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") as T | null
  } catch {
    return null
  }
}

const readRecent = (): Song[] => {
  const songs = readJson<Song[]>(RECENT_KEY)
  if (!Array.isArray(songs) || songs.length === 0) return [DEMO_SONG]
  // a song once, though an older list holds it twice under two links
  return songs.filter(
    (song, at) => !song.videoId || songs.findIndex((one) => one.videoId === song.videoId) === at,
  )
}

const readSongs = (key: string): Song[] => {
  const songs = readJson<Song[]>(key)
  return Array.isArray(songs) ? songs : []
}

const watchUrl = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`

const SQUARE = cn(BAR_ITEM, "size-7 shrink-0")
// the video's own buttons, white on its dim layer, a size larger in a window 480px wide or more; an open search box leaves Search with no plate, lit on hover alone
const VIDEO_BUTTONS =
  "pointer-events-auto [&_button]:text-white [&_button]:hover:text-white [&_button]:aria-expanded:not-hover:not-focus-visible:bg-transparent [&_button]:aria-expanded:text-white [&_button]:hover:bg-white/15 [&_button]:focus-visible:bg-white/15 @[480px]:[&_button]:size-10 @[480px]:[&_svg]:size-6!"
// the search box's Collapse and Shuffle play: no plate, muted, lit on hover and while shuffle play runs
const BOX_ICON =
  "text-muted-foreground hover:text-foreground focus-visible:text-foreground aria-pressed:text-foreground size-8 shrink-0 bg-transparent!"
// a time that turns into its skip button in the same place, a square as large as the controls' and lit as they are, laid over the row so nothing beside it moves
const SKIP = "group/skip hover:text-foreground relative outline-none"
const SKIP_TEXT = "group-hover/skip:invisible group-focus-visible/skip:invisible"
const SKIP_ICON =
  "invisible absolute top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md bg-current/15 group-hover/skip:visible group-focus-visible/skip:visible [&_svg]:size-4 [&_svg]:text-current @[480px]:size-10 @[480px]:[&_svg]:size-6"

// the song a link names inside its playlist, played once the playlist is cued, so a pasted song plays that song and not the playlist's first, and the second it starts from
let startAt: string | null = null
let startFrom = 0
// the playlist a song played alone came from (YouTube's mix for a lone link, whose first 50 songs leave that song out), so Next or the song's end moves on into it; the player still reports the cued playlist while a song plays alone, so this flag says which
let queued: string | null = null
let alone = false
// the songs Shuffle play took, dealt again in a new order once the last of them ends or is skipped
let shuffled: string[] | null = null

function playAlone(player: YTPlayer, id: string, from: number) {
  alone = true
  player.loadVideoById(id, from)
}

// Next, or a song ending: on through the playlist playing, or into the queued one when the song played alone
function playNext(player: YTPlayer, ended = false) {
  if (shuffled?.length === 1) playShuffled(player, shuffled)
  else if (shuffled) {
    const order = player.getPlaylist() ?? []
    if (player.getPlaylistIndex() >= order.length - 1) playShuffled(player, shuffled, order.at(-1))
    else if (!ended) player.nextVideo()
  } else if (alone && queued) {
    alone = false
    player.loadPlaylist({ list: queued, listType: "playlist" })
    queued = null
  } else if (!ended && !alone) player.nextVideo()
}

// YouTube's own mix for a song, so a lone song link still has a Next and plays on when it ends
export const withMix = (link: YouTubeLink): YouTubeLink =>
  link.list || !link.videoId ? link : { ...link, list: `RD${link.videoId}` }

function play(player: YTPlayer, asked: YouTubeLink, from = 0) {
  shuffled = null
  const link = withMix(asked)
  queued = link.list ?? null
  startAt = link.list && link.videoId ? link.videoId : null
  startFrom = from
  if (startAt && link.list) {
    player.cuePlaylist({ list: link.list, listType: "playlist" })
    // a playlist YouTube cannot cue never says so, so the song plays alone after 3 seconds
    const id = startAt
    setTimeout(() => {
      if (startAt !== id) return
      startAt = null
      playAlone(player, id, startFrom)
    }, 3000)
  } else if (link.list) {
    alone = false
    player.loadPlaylist({ list: link.list, listType: "playlist" })
  } else if (link.videoId) playAlone(player, link.videoId, from)
}

// Shuffle play: the songs a list shows, as one playlist in a random order, Next and each song's end moving through it; dealt again, the song just heard never comes first
function playShuffled(player: YTPlayer, ids: string[], last?: string) {
  const order = [...ids]
  for (let at = order.length - 1; at > 0; at--) {
    const pick = Math.floor(Math.random() * (at + 1))
    ;[order[at], order[pick]] = [order[pick] as string, order[at] as string]
  }
  if (order.length > 1 && order[0] === last) [order[0], order[1]] = [order[1] as string, last]
  shuffled = ids
  startAt = null
  queued = null
  alone = false
  // one song loads alone, since a one-song playlist after a cued one starts the old playlist's first song
  if (order.length === 1) player.loadVideoById(order[0] as string)
  else player.loadPlaylist(order)
}

// a cued playlist starts at the link's song, or plays that song alone when the playlist does not hold it
function startCued(player: YTPlayer): boolean {
  if (!startAt) return false
  const index = player.getPlaylist()?.indexOf(startAt) ?? -1
  if (index >= 0) {
    queued = null
    alone = false
    player.playVideoAt(index)
    if (startFrom > 0) player.seekTo(startFrom, true)
  } else playAlone(player, startAt, startFrom)
  startAt = null
  return true
}

// A line that scrolls slowly while it is wider than its box, and stays still, cut short, under reduced motion (the plan's "A long title scrolls slowly").
function Marquee({ className, text }: { className?: string; text: string }) {
  const box = useRef<HTMLSpanElement>(null)
  const line = useRef<HTMLSpanElement>(null)
  const [moving, setMoving] = useState(false)
  useEffect(() => {
    const measure = () => {
      const first = line.current?.firstElementChild as HTMLElement | null
      if (!box.current || !first) return
      setMoving(
        first.offsetWidth > box.current.clientWidth &&
          !matchMedia("(prefers-reduced-motion: reduce)").matches,
      )
    }
    measure()
    const watch = new ResizeObserver(measure)
    if (box.current) watch.observe(box.current)
    return () => watch.disconnect()
  }, [text])
  useEffect(() => {
    const first = line.current?.firstElementChild as HTMLElement | null
    if (!moving || !line.current || !first) return
    const step = first.offsetWidth + 32
    const run = line.current.animate(
      [{ transform: "translateX(0)" }, { transform: `translateX(-${step}px)` }],
      {
        duration: step * 40,
        iterations: Infinity,
      },
    )
    return () => run.cancel()
  }, [moving, text])
  return (
    <span
      ref={box}
      className={cn(
        "block overflow-hidden whitespace-nowrap",
        !moving && "text-ellipsis",
        className,
      )}
      style={
        moving
          ? {
              maskImage:
                "linear-gradient(90deg, transparent, #000 6px, #000 calc(100% - 12px), transparent)",
            }
          : undefined
      }
    >
      <span ref={line} className={cn("inline-flex gap-8", !moving && "block truncate")}>
        <span className={cn(!moving && "truncate")}>{text}</span>
        {moving && <span aria-hidden>{text}</span>}
      </span>
    </span>
  )
}

// The sidebar's bottom row: the cover, the title, ＋ Previous Play/Pause Next Volume and the time, holding the last song from the last visit so Play picks it up where it stopped, and one music button only before anything has played. ♫ and ＋ open one box: a field for a YouTube song or playlist link and the last three songs.
export function MusicPlayer() {
  const [now, setNow] = useState<Now | null>(null)
  const [open, setOpen] = useState(false)
  // Shuffle play is on until a song or link plays, which lights its icon
  const [shuffling, setShuffling] = useState(false)
  const [recent, setRecent] = useState<Song[]>([DEMO_SONG])
  const [liked, setLiked] = useState<Song[]>([])
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<Song[] | null>(null)
  const [shelf, setShelf] = useState<Shelf>("recent")
  const [searching, setSearching] = useState(false)
  const [volume, setVolume] = useState(100)
  const [veiled, setVeiled] = useState(false)
  const veilTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // the song last heard playing, so a new one is veiled as it starts, and whether the veil is up, read inside the player's callback
  const heard = useRef<string | undefined>(undefined)
  const veiledRef = useRef(false)
  veiledRef.current = veiled
  const [next, setNext] = useState<string | null>(null)
  // the query the shown results answer, so a page read for an older query is dropped
  const searched = useRef("")
  const [more, setMore] = useState(false)
  const songsBox = useRef<HTMLDivElement>(null)
  const tail = useRef<HTMLDivElement>(null)
  const rows = useRef(new Map<string, number>())
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<View>("card")
  // the song's black bars, so the video takes its picture's own shape, 16:9 until the stills are read
  const [crop, setCrop] = useState<Crop>(FULL)
  const ratio = ratioOf(crop)
  // where a drag on the timeline is, in seconds, while it lasts
  const [scrub, setScrub] = useState<number | null>(null)
  const [pipBox, setPipBox] = useState<PipBox | null>(null)
  const drag = useRef<{
    dragged: boolean
    mode: "move" | "size"
    rect: DOMRect
    x: number
    y: number
  } | null>(null)
  const slot = useRef<HTMLDivElement>(null)
  const player = useRef<YTPlayer | null>(null)
  const pending = useRef<string | null>(null)
  const list = useRef<string | undefined>(undefined)

  useEffect(() => {
    setRecent(readRecent())
    setLiked(readSongs(LIKED_KEY))
    const kept = Number(localStorage.getItem(VOLUME_KEY))
    if (localStorage.getItem(VOLUME_KEY) !== null && kept >= 0 && kept <= 100) setVolume(kept)
    // a player already in the tab, playing or paused on a song, shows that song rather than the last one parked
    void tab.playgroundMusic?.then((p) => {
      player.current = p
      tab.playgroundMusicOnState = (event) => onState(event as { data: number })
      if (p.getPlayerState() === PLAYING || p.getPlayerState() === PAUSED)
        onState({ data: p.getPlayerState() })
    })
    const last = readJson<Last>(LAST_KEY)
    if (last?.videoId && last.url)
      setNow({
        duration: 0,
        muted: false,
        parked: true,
        playing: false,
        time: last.time ?? 0,
        title: last.title,
        videoId: last.videoId,
      })
  }, [])

  // the video shows until Esc or its Close shrink it back to the card
  useEffect(() => {
    const id = now?.videoId
    if (!id) return
    let live = true
    void readCrop(id).then((next) => {
      if (live) setCrop((was) => (was.x === next.x && was.y === next.y ? was : next))
    })
    return () => {
      live = false
    }
  }, [now?.videoId])

  // before the window is drawn in a new song's shape, its box moves by the zone it sits in
  const shape = useRef(ratio)
  useLayoutEffect(() => {
    const was = shape.current
    shape.current = ratio
    if (was !== ratio) setPipBox((box) => box && reshaped(box, was, ratio))
  }, [ratio])

  useEffect(() => {
    showVideo(view, crop, pipBox)
    if (view === "card") return
    const shut = (event: KeyboardEvent) => {
      if (event.key === "Escape") setView("card")
    }
    document.addEventListener("keydown", shut)
    return () => document.removeEventListener("keydown", shut)
  }, [view, crop, pipBox])

  // in the sidebar, the frame's host follows the card's video slot, hidden while the rail is collapsed
  useEffect(() => {
    const el = slot.current
    if (view !== "inline" || !el || !host) return
    const box = host
    const place = () => {
      const r = el.getBoundingClientRect()
      box.style.cssText = r.width
        ? `top:${r.top}px;left:${r.left}px;width:${r.width}px;height:${r.height}px`
        : "display:none"
    }
    place()
    const watch = new ResizeObserver(place)
    watch.observe(el)
    window.addEventListener("resize", place)
    return () => {
      watch.disconnect()
      window.removeEventListener("resize", place)
    }
  }, [view])

  const read = () => {
    const p = player.current
    if (!p) return
    const data = p.getVideoData()
    if (!data?.video_id) return
    const title = data.title || "YouTube"
    const time = p.getCurrentTime() || 0
    setNow((was) => ({
      duration: p.getDuration() || 0,
      muted: p.isMuted(),
      playing: was?.playing ?? false,
      time,
      title,
      videoId: data.video_id ?? "",
    }))
    const url = `https://www.youtube.com/watch?v=${data.video_id}${list.current ? `&list=${list.current}` : ""}`
    if (data.title)
      localStorage.setItem(
        LAST_KEY,
        JSON.stringify({ time, title, url, videoId: data.video_id } satisfies Last),
      )
    // a song's title arrives with its first frames, so Recently played names it then
    // only the song the link names, so a Next pressed before the title arrives never files another song under the link
    const asked = pending.current
    const named = asked ? parseYouTube(asked)?.videoId : undefined
    if (asked && data.title && (!named || named === data.video_id)) {
      pending.current = null
      setRecent((songs) => {
        const next = [
          { title: data.title ?? asked, url: asked, videoId: data.video_id },
          ...songs.filter((song) => song.url !== asked && song.videoId !== data.video_id),
        ].slice(0, RECENT_MAX)
        localStorage.setItem(RECENT_KEY, JSON.stringify(next))
        return next
      })
    }
  }

  const onState = (event?: { data: number }) => {
    if (event?.data === CUED && player.current && startCued(player.current)) return
    if (startAt) return
    read()
    if (event) setNow((was) => was && { ...was, playing: event.data === PLAYING })
    if (event?.data === PLAYING) {
      const id = player.current?.getVideoData()?.video_id
      if (veiledRef.current || id !== heard.current) veil(VEIL_AFTER_PLAY)
      heard.current = id
    }
    if (event?.data === ENDED && player.current) playNext(player.current, true)
  }

  useEffect(() => {
    if (!now?.playing) return
    const tick = setInterval(read, 1000)
    return () => clearInterval(tick)
  })

  const ready = () => getPlayer((event) => onState(event as { data: number }))

  // YouTube loads when the pointer reaches the card or the box opens, so the click that plays reaches a ready player and the browser lets it sound
  const warm = () => {
    void ready().then((p) => {
      player.current = p
      p.setVolume(volume)
    })
  }

  // the player: now if it is ready, else once it is
  const withPlayer = (act: (p: YTPlayer) => void) => {
    if (player.current) act(player.current)
    else
      void ready().then((p) => {
        player.current = p
        p.setVolume(volume)
        act(p)
      })
  }

  const start = (url: string, from = 0) => {
    const link = parseYouTube(url)
    if (!link) return setError("That is not a YouTube link")
    setError(null)
    setShuffling(false)
    pending.current = url
    list.current = withMix(link).list
    const go = (p: YTPlayer) => {
      player.current = p
      play(p, link, from)
    }
    if (player.current) go(player.current)
    else void ready().then(go)
  }

  // Enter plays a pasted link, else the search's first result once the search is done
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (parseYouTube(query)) start(query)
    else if (!searching && results?.[0]) start(results[0].url)
  }

  const like = (song: Song) => {
    setLiked((songs) => {
      const next = songs.some((one) => one.videoId === song.videoId)
        ? songs.filter((one) => one.videoId !== song.videoId)
        : [song, ...songs]
      localStorage.setItem(LIKED_KEY, JSON.stringify(next))
      return next
    })
  }
  const likes = (videoId?: string) => liked.some((song) => song.videoId === videoId)

  const toSongs = (videos: { channel: string; id: string; length: string; title: string }[]) =>
    videos.map((video) => ({
      detail: [video.channel, video.length].filter(Boolean).join(" · "),
      title: video.title,
      url: watchUrl(video.id),
      videoId: video.id,
    }))

  // what is typed searches YouTube a moment after the last key, unless it is a link
  useEffect(() => {
    const q = query.trim()
    searched.current = q
    setNext(null)
    if (!q || parseYouTube(q)) {
      setResults(null)
      setSearching(false)
      setShelf((was) => (was === "search" ? "recent" : was))
      return
    }
    setShelf("search")
    setSearching(true)
    let live = true
    const wait = setTimeout(() => {
      void unwrap(apiClient.v1.music.search.$get({ query: { q } }))
        .then(({ data }) => {
          if (!live || !data) return
          setResults(toSongs(data.results))
          setNext(data.next)
        })
        .catch(() => {
          if (live) setNext(null)
        })
        .finally(() => {
          if (live) setSearching(false)
        })
    }, 300)
    return () => {
      live = false
      clearTimeout(wait)
    }
  }, [query])

  // scrolled near the list's end, the next page of results joins it
  useEffect(() => {
    const end = tail.current
    const q = query.trim()
    if (!end || !next || more || !q) return
    const watch = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        setMore(true)
        void unwrap(apiClient.v1.music.search.$get({ query: { next, q } }))
          .then(({ data }) => {
            if (searched.current !== q) return
            if (!data) return setNext(null)
            setResults((songs) => {
              const seen = new Set(songs?.map((song) => song.videoId))
              return [
                ...(songs ?? []),
                ...toSongs(data.results).filter((song) => !seen.has(song.videoId)),
              ]
            })
            setNext(data.next)
          })
          // a failed page ends the list, so the still-visible tail asks no more
          .catch(() => {
            if (searched.current === q) setNext(null)
          })
          .finally(() => setMore(false))
      },
      { root: songsBox.current, rootMargin: "120px" },
    )
    watch.observe(end)
    return () => watch.disconnect()
  })

  // a row that moves, a song played rising to the top, slides from where it was
  useLayoutEffect(() => {
    const was = rows.current
    const now = new Map<string, number>()
    for (const row of songsBox.current?.querySelectorAll<HTMLElement>("li[data-song]") ?? []) {
      const key = row.dataset.song ?? ""
      now.set(key, row.offsetTop)
      const from = was.get(key)
      if (
        from !== undefined &&
        from !== row.offsetTop &&
        !matchMedia("(prefers-reduced-motion: reduce)").matches
      )
        row.animate(
          [{ transform: `translateY(${from - row.offsetTop}px)` }, { transform: "translateY(0)" }],
          { duration: 250, easing: "ease-out" },
        )
    }
    rows.current = now
  })

  const shown = shelf === "search" ? (results ?? []) : shelf === "liked" ? liked : recent

  const shuffle = () => {
    const ids = shown.flatMap((song) => (song.videoId ? [song.videoId] : []))
    if (ids.length === 0) return
    setShuffling(true)
    pending.current = null
    list.current = undefined
    const go = (p: YTPlayer) => {
      player.current = p
      playShuffled(p, ids)
    }
    if (player.current) go(player.current)
    else void ready().then(go)
  }

  const openBox = () => {
    setError(null)
    setOpen(true)
    warm()
  }

  // the box stays open while songs play, a press outside included, and shuts on its 🔍 again or Esc
  useEffect(() => {
    if (!open) return
    const shut = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("keydown", shut)
    return () => document.removeEventListener("keydown", shut)
  }, [open])

  // ♫ and 🔍 open one box right above the player card, 6px over it as the field is over the toggle, at its width: one full-width field that searches or takes a link, then the search's seven results, or the songs liked and the last seven played
  const box = open && (
    <div
      role="dialog"
      aria-label="Play a YouTube link"
      className={cn(
        GLASS,
        "absolute inset-x-0 bottom-full z-20 mb-1.5 flex flex-col gap-0.5 rounded-lg p-1.5",
      )}
    >
      {/* the field sits 6px over the toggle, as the box's padding sits over it */}
      {/* the field and, at its right end over Shuffle play, Collapse as a music note, which shuts the box back to the player from where it is, with no trip back to the search icon */}
      <div className="mb-1 flex items-center gap-0.5">
        <form onSubmit={submit} className="relative min-w-0 flex-1">
          <Input
            autoFocus
            name="link"
            aria-label="Search YouTube or paste a link"
            aria-invalid={error ? true : undefined}
            // short enough to show whole in the field
            placeholder={error ?? "Search YT or paste a link"}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-8 w-full pr-8 text-xs md:text-xs"
          />
          {/* while a search runs, a spinner at the field's end says so, and Enter waits for it; Recent and Liked are a tab away, so the field has no ✕ */}
          {searching && (
            <Spinner
              aria-label="Searching"
              className="text-muted-foreground absolute top-2 right-2 size-4"
            />
          )}
        </form>
        <Button
          aria-label="Collapse"
          className={cn(BAR_ITEM, BOX_ICON)}
          size="icon"
          variant="ghost"
          onClick={() => setOpen(false)}
        >
          <RiMusic2Line />
        </Button>
      </div>
      {/* Recent, Liked and Search as one three-way toggle, a row's height; Search stays disabled until something is searched, and a search turns to it */}
      {/* the toggle and, at its right end, Shuffle play as an icon, one row; Shuffle plays the tab's songs in a random order, one song too, 6px over the first song as the field is over the toggle */}
      <div className="mb-1 flex items-center gap-0.5">
        <Tabs
          value={shelf}
          onValueChange={(value) => setShelf(value as Shelf)}
          className="min-w-0 flex-1"
        >
          <TabsList className="h-8 w-full">
            <TabsTrigger value="recent" className="text-xs">
              Recent
            </TabsTrigger>
            <TabsTrigger value="liked" className="text-xs">
              Liked
            </TabsTrigger>
            <TabsTrigger value="search" disabled={!results && !searching} className="text-xs">
              Search
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Button
          aria-label="Shuffle play"
          aria-pressed={shuffling}
          disabled={!shown.some((song) => song.videoId)}
          className={cn(BAR_ITEM, BOX_ICON)}
          size="icon"
          variant="ghost"
          onClick={shuffle}
        >
          <RiShuffleLine />
        </Button>
      </div>
      {/* one window of a fixed height, seven 32px rows under the field and the toggle's row, the songs 2px apart, that scrolls past them and keeps its size with fewer songs; each row one hover with its heart; search results in YouTube's own order */}
      <div ref={songsBox} className="relative flex h-[236px] flex-col gap-0.5 overflow-y-auto">
        {shown.length === 0 && (
          <p className="text-muted-foreground grid flex-1 place-items-center text-xs">
            {shelf === "liked"
              ? "Nothing liked yet"
              : shelf === "search"
                ? searching
                  ? "Searching"
                  : "No results"
                : "Nothing played yet"}
          </p>
        )}
        {[{ label: shelf, songs: shown }].map(
          (section) =>
            section.songs.length > 0 && (
              <section key={section.label} className="flex flex-col gap-0.5">
                <ul className="flex flex-col gap-0.5">
                  {section.songs.map((song) => {
                    const id = song.videoId ?? parseYouTube(song.url)?.videoId
                    const hearted = likes(id)
                    const current = id !== undefined && id === now?.videoId
                    return (
                      // the song playing stays lit as a hovered row, its cover a record that spins while it plays
                      <li
                        key={song.url}
                        data-song={song.videoId ?? song.url}
                        aria-current={current ? "true" : undefined}
                        className="group/song hover:bg-foreground/10 has-focus-visible:bg-foreground/10 aria-current:bg-foreground/10 relative rounded-md"
                      >
                        <button
                          type="button"
                          onClick={() => start(song.url)}
                          className="flex h-8 w-full min-w-0 items-center gap-2 px-1 pr-8 text-left text-xs outline-none"
                        >
                          {id ? (
                            <img
                              alt=""
                              src={coverOf(id)}
                              className={cn(
                                "size-6 shrink-0 rounded-sm object-cover",
                                current &&
                                  "animate-[spin_4s_linear_infinite] rounded-full group-hover/song:[animation-play-state:paused] motion-reduce:animate-none",
                                current && !now?.playing && "[animation-play-state:paused]",
                              )}
                            />
                          ) : (
                            <RiMusic2Line className="size-4 shrink-0" />
                          )}
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate">{song.title}</span>
                            {song.detail && (
                              <span className="text-muted-foreground text-2xs truncate leading-3">
                                {song.detail}
                              </span>
                            )}
                          </span>
                        </button>
                        {id && (
                          <Button
                            aria-label={hearted ? "Unlike" : "Like"}
                            aria-pressed={hearted}
                            className={cn(
                              SQUARE,
                              "text-muted-foreground hover:text-foreground absolute top-0.5 right-0.5 hover:bg-transparent focus-visible:bg-transparent aria-pressed:bg-transparent dark:hover:bg-transparent",
                              !hearted &&
                                "opacity-0 group-hover/song:opacity-100 focus-visible:opacity-100",
                            )}
                            size="icon-sm"
                            variant="ghost"
                            onClick={() =>
                              like({ title: song.title, url: watchUrl(id), videoId: id })
                            }
                          >
                            {hearted ? (
                              <RiHeartFill className="text-destructive" />
                            ) : (
                              <RiHeartLine />
                            )}
                          </Button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </section>
            ),
        )}
        {shelf === "search" && next && <div ref={tail} aria-hidden className="h-px shrink-0" />}
      </div>
    </div>
  )

  // cover after each play, pause or skip, and as each new song starts, held until the song has played 3 seconds, past the controls YouTube shows then, which no setting turns off
  const veil = (hold = 6000) => {
    setVeiled(true)
    clearTimeout(veilTimer.current)
    veilTimer.current = setTimeout(() => setVeiled(false), hold)
  }
  const toggle = () => {
    if (!now) return
    veil()
    if (now.parked) {
      const last = readJson<Last>(LAST_KEY)
      if (last) start(last.url, last.time)
    } else if (now.playing) player.current?.pauseVideo()
    else player.current?.playVideo()
  }
  // a drag on the bar moves only the bar and the time, and the song seeks once, where it is let go, and shows that time at once, since the player still reports the old one for a moment
  const pointAt = (event: PointerEvent<HTMLElement>) => {
    const r = event.currentTarget.getBoundingClientRect()
    return Math.min(Math.max(0, (event.clientX - r.left) / r.width), 1) * (now?.duration ?? 0)
  }
  const seek = (to: number) => {
    player.current?.seekTo(to, true)
    setNow((was) => was && { ...was, time: to })
  }
  const skip = (by: number) => {
    const p = player.current
    if (!p) return
    seek(Math.min(Math.max(0, p.getCurrentTime() + by), p.getDuration() || Infinity))
  }
  // the times, each a 10-second skip when hovered, round a bar that seeks, under the card's controls and along the video's bottom edge
  const timeline = now && (
    <div className="text-2xs flex items-center gap-1.5 font-mono leading-3 tabular-nums">
      {now.parked ? (
        <span>{clock(now.time)}</span>
      ) : (
        <button
          type="button"
          aria-label="Back 10 seconds"
          className={SKIP}
          onClick={() => skip(-10)}
        >
          <span className={SKIP_TEXT}>{clock(scrub ?? now.time)}</span>
          <span data-skip className={cn(SKIP_ICON, "left-0")}>
            <RiReplay10Line />
          </span>
        </button>
      )}
      <span
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(now.duration)}
        aria-valuenow={Math.round(scrub ?? now.time)}
        // the hit area reaches 6px above and below the bar without taking room, so the row keeps its height
        className="-my-1.5 flex flex-1 cursor-pointer touch-none items-center py-1.5"
        onPointerDown={(event) => {
          if (event.button !== 0 || !now.duration) return
          event.stopPropagation()
          event.currentTarget.setPointerCapture(event.pointerId)
          setScrub(pointAt(event))
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) setScrub(pointAt(event))
        }}
        onPointerUp={(event) => {
          if (scrub === null) return
          seek(pointAt(event))
          setScrub(null)
        }}
        onPointerCancel={() => setScrub(null)}
      >
        <span className="h-1 flex-1 overflow-hidden rounded-full bg-current/25">
          <span
            className="block h-full bg-current"
            style={{
              width: `${now.duration ? ((scrub ?? now.time) / now.duration) * 100 : 0}%`,
            }}
          />
        </span>
      </span>
      {now.parked ? (
        <span />
      ) : (
        <button
          type="button"
          aria-label="Ahead 10 seconds"
          className={SKIP}
          onClick={() => skip(10)}
        >
          <span className={SKIP_TEXT}>{clock(now.duration)}</span>
          <span data-skip className={cn(SKIP_ICON, "right-0")}>
            <RiForward10Line />
          </span>
        </button>
      )}
    </div>
  )
  // the box's button is a search icon
  const search = (
    <Button
      aria-expanded={open}
      aria-label="Play another link"
      className={SQUARE}
      size="icon-sm"
      variant="ghost"
      onClick={() => (open ? setOpen(false) : openBox())}
    >
      <RiSearchLine />
    </Button>
  )
  // every control works from the first visit: on the last song, kept and not yet loaded, Previous plays it from its start and Next moves on into its mix
  const last = () => readJson<Last>(LAST_KEY)
  const mute = (muted: boolean) => {
    withPlayer((p) => (muted ? p.mute() : p.unMute()))
    setNow((was) => was && { ...was, muted })
  }
  const controls = (
    <>
      <Button
        aria-label="Previous"
        className={SQUARE}
        size="icon-sm"
        variant="ghost"
        onClick={() => {
          veil()
          const kept = now?.parked ? last() : null
          if (kept) return start(kept.url)
          const p = player.current
          if (p && p.getCurrentTime() > 3) p.seekTo(0, true)
          else p?.previousVideo()
        }}
      >
        <RiSkipBackFill />
      </Button>
      <Button
        aria-label={now?.playing ? "Pause" : "Play"}
        className={SQUARE}
        size="icon-sm"
        variant="ghost"
        onClick={toggle}
      >
        {now?.playing ? <RiPauseFill /> : <RiPlayFill />}
      </Button>
      <Button
        aria-label="Next"
        className={SQUARE}
        size="icon-sm"
        variant="ghost"
        onClick={() => {
          veil()
          const kept = now?.parked ? last() : null
          if (kept?.videoId) return start(`https://www.youtube.com/playlist?list=RD${kept.videoId}`)
          if (player.current) playNext(player.current)
        }}
      >
        <RiSkipForwardFill />
      </Button>
      {/* Volume: a click mutes or unmutes, its icon saying which, and hovering it, or a key in it, opens a slider above it to drag the volume */}
    </>
  )
  const volumeControl = (
    <>
      {/* Volume sits on one plate: hovered, the plate lights the button, and held a moment it grows up into the slider, one element in one colour all through */}
      <div className="group/volume relative">
        <div className="bg-popover/80 invisible absolute bottom-0 left-0 z-30 flex h-7 w-7 flex-col justify-end overflow-hidden rounded-md opacity-0 backdrop-blur-md transition-[opacity,height,visibility] duration-150 group-hover/volume:visible group-hover/volume:h-[124px] group-hover/volume:opacity-100 group-hover/volume:[transition-delay:0ms,300ms,0ms] group-has-focus-visible/volume:visible group-has-focus-visible/volume:h-[124px] group-has-focus-visible/volume:opacity-100 @[480px]:size-10 @[480px]:group-hover/volume:h-[136px] @[480px]:group-has-focus-visible/volume:h-[136px]">
          <div className="bg-foreground/10 flex shrink-0 flex-col items-center">
            {/* the slider stands upright over the button, as wide as it */}
            <div className="flex h-24 justify-center pt-2.5 pb-1">
              <Slider
                aria-label="Volume"
                orientation="vertical"
                className="**:data-vertical:min-h-0!"
                max={100}
                value={[now?.muted ? 0 : volume]}
                onValueChange={(value) => {
                  const next = Array.isArray(value) ? (value[0] ?? 0) : value
                  setVolume(next)
                  localStorage.setItem(VOLUME_KEY, String(next))
                  withPlayer((p) => p.setVolume(next))
                  if (now?.muted && next > 0) mute(false)
                }}
              />
            </div>
            <span aria-hidden className="h-7 @[480px]:h-10" />
          </div>
        </div>
        <Button
          aria-label={now?.muted ? "Unmute" : "Mute"}
          aria-pressed={now?.muted ?? false}
          className={cn(SQUARE, "relative z-40 bg-transparent! hover:bg-transparent!")}
          size="icon-sm"
          variant="ghost"
          onClick={() => mute(!now?.muted)}
        >
          {now?.muted || volume === 0 ? <RiVolumeMuteLine /> : <RiVolumeUpLine />}
        </Button>
      </div>
    </>
  )

  return (
    <div
      onPointerEnter={warm}
      onFocus={warm}
      className="relative group-data-[collapsible=icon]:hidden"
    >
      {box}
      {/* the video's own controls, the sidebar's on the same glass, shown while the pointer is over the video or a key is in them: Detach in the sidebar, Dock in the window, and Close back to the card */}
      {view !== "card" &&
        host &&
        createPortal(
          <>
            {/* a clear layer over the frame keeps the pointer from YouTube's own title and buttons, which no setting turns off, and a click on the video plays or pauses it */}
            {/* in the window it also drags: a press that moves past 4px carries the window, kept on the screen, and one that does not plays or pauses */}
            <div
              aria-hidden
              className={cn(
                "absolute inset-0",
                view === "pip" && "cursor-grab active:cursor-grabbing",
              )}
              onPointerDown={(event) => {
                if (event.button !== 0 || !host) return
                event.currentTarget.setPointerCapture(event.pointerId)
                drag.current = {
                  dragged: false,
                  mode: "move",
                  rect: host.getBoundingClientRect(),
                  x: event.clientX,
                  y: event.clientY,
                }
              }}
              onPointerMove={(event) => {
                const start = drag.current
                if (!start || view !== "pip") return
                const dx = event.clientX - start.x
                const dy = event.clientY - start.y
                if (!start.dragged && Math.hypot(dx, dy) < 4) return
                start.dragged = true
                const { height, left, top, width } = start.rect
                setPipBox({
                  left: Math.min(Math.max(0, left + dx), window.innerWidth - width),
                  top: Math.min(Math.max(0, top + dy), window.innerHeight - height),
                  width,
                })
              }}
              onPointerUp={() => {
                const start = drag.current
                drag.current = null
                if (start && !start.dragged) toggle()
              }}
              onPointerCancel={() => {
                drag.current = null
              }}
            />
            {/* every edge and corner resizes the window, a 6px band along each edge and a 12px square at each corner */}
            {view === "pip" &&
              EDGES.map((edge) => (
                <div
                  key={edge}
                  aria-hidden
                  className={cn(
                    "absolute z-20",
                    edge === "t" && "inset-x-3 top-0 h-1.5 cursor-ns-resize",
                    edge === "b" && "inset-x-3 bottom-0 h-1.5 cursor-ns-resize",
                    edge === "l" && "inset-y-3 left-0 w-1.5 cursor-ew-resize",
                    edge === "r" && "inset-y-3 right-0 w-1.5 cursor-ew-resize",
                    edge === "tl" && "top-0 left-0 size-3 cursor-nwse-resize",
                    edge === "tr" && "top-0 right-0 size-3 cursor-nesw-resize",
                    edge === "bl" && "bottom-0 left-0 size-3 cursor-nesw-resize",
                    edge === "br" && "right-0 bottom-0 size-3 cursor-nwse-resize",
                  )}
                  onPointerDown={(event) => {
                    if (event.button !== 0 || !host) return
                    event.stopPropagation()
                    event.currentTarget.setPointerCapture(event.pointerId)
                    drag.current = {
                      dragged: true,
                      mode: "size",
                      rect: host.getBoundingClientRect(),
                      x: event.clientX,
                      y: event.clientY,
                    }
                  }}
                  onPointerMove={(event) => {
                    const start = drag.current
                    if (start?.mode !== "size") return
                    setPipBox(
                      resized(
                        start.rect,
                        edge,
                        event.clientX - start.x,
                        event.clientY - start.y,
                        ratio,
                      ),
                    )
                  }}
                  onPointerUp={() => {
                    drag.current = null
                  }}
                  onPointerCancel={() => {
                    drag.current = null
                  }}
                />
              ))}
            {/* while the video is not playing, and in its last 20 seconds where YouTube lays its end-screen cards, its cover hides YouTube's own start, pause and end screens, so none of YouTube's controls ever shows */}
            {now &&
              (veiled ||
                !now.playing ||
                (now.duration > 0 && now.duration - now.time < ENDING)) && (
                <img
                  alt=""
                  src={`https://i.ytimg.com/vi/${now.videoId}/hqdefault.jpg`}
                  className="pointer-events-none absolute inset-0 size-full rounded-[inherit] bg-black object-cover"
                />
              )}
            {/* hovered, a clear dim layer with the controls built on it: Search (in the sidebar), Previous, Play/Pause, Next and Volume with Play/Pause dead centre, and Minimize with Detach or Pop in in the top-right corner */}
            <div className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black/50 text-white opacity-0 transition-opacity group-hover/video:opacity-100 has-focus-visible:opacity-100">
              {/* a window 480px wide or more grows its buttons to 40px and its icons to 24px */}
              <div
                className={cn(
                  VIDEO_BUTTONS,
                  "absolute top-1/2 left-1/2 flex -translate-1/2 items-center gap-1",
                )}
              >
                {controls}
              </div>
              {/* the top-left corner, across from Minimize and Detach, holds Search in the sidebar, then the heart, lit red while the song is liked */}
              {now && (
                <div className={cn(VIDEO_BUTTONS, "absolute top-2 left-3 flex")}>
                  {view === "inline" && search}
                  <Button
                    aria-label={likes(now.videoId) ? "Unlike" : "Like"}
                    aria-pressed={likes(now.videoId)}
                    className={cn(SQUARE, "aria-pressed:bg-transparent")}
                    size="icon-sm"
                    variant="ghost"
                    onClick={() =>
                      like({ title: now.title, url: watchUrl(now.videoId), videoId: now.videoId })
                    }
                  >
                    {likes(now.videoId) ? (
                      <RiHeartFill className="text-destructive" />
                    ) : (
                      <RiHeartLine />
                    )}
                  </Button>
                </div>
              )}
              {/* Volume sits at the timeline's right end */}
              {/* the row takes the pointer, so the timeline seeks with its own cursor rather than dragging the window */}
              <div className="pointer-events-auto absolute inset-x-3 bottom-1.5 flex items-center gap-2">
                <div className="min-w-0 flex-1 @[480px]:[&>div]:text-xs">{timeline}</div>
                <div className={VIDEO_BUTTONS}>{volumeControl}</div>
              </div>
              {/* Minimize back to the card, then Detach or Pop in, together in the top-right corner, lit on hover as every other button on the video, 12px in from the edge as the bottom row, so each corner's button stands over the one below it; each drawn as a video player draws it: Minimize as the music note of the card it goes back to, Detach with its arrow out, Pop in with its arrow in */}
              <div className={cn(VIDEO_BUTTONS, "absolute top-2 right-3 flex [&_button]:size-7")}>
                <Button
                  aria-label="Minimize"
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => setView("card")}
                >
                  <RiMusic2Line />
                </Button>
                <Button
                  aria-label={view === "pip" ? "Pop in" : "Detach"}
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => setView(view === "pip" ? "inline" : "pip")}
                >
                  {view === "pip" ? <RiPictureInPicture2Line /> : <RiPictureInPictureExitLine />}
                </Button>
              </div>
            </div>
          </>,
          host,
        )}
      <div
        className={cn(
          GLASS,
          // over the search box, so Volume's slider opens above it
          "relative z-30 rounded-lg",
          view === "inline" ? "overflow-hidden" : "h-[74px] p-1.5",
        )}
        style={view === "inline" ? { aspectRatio: ratio } : undefined}
      >
        {view === "inline" ? (
          <div ref={slot} className="size-full" />
        ) : !now ? (
          <div className="grid size-full place-items-center">
            <Button
              aria-expanded={open}
              aria-label="Play a YouTube link"
              className={cn(BAR_ITEM, "text-muted-foreground hover:text-foreground size-10")}
              size="icon"
              variant="ghost"
              onClick={() => (open ? setOpen(false) : openBox())}
            >
              <RiMusic2Line className="size-5" />
            </Button>
          </div>
        ) : (
          <div className="grid size-full grid-cols-[60px_1fr] gap-2">
            {/* hovered or focused, the cover turns into a maximize button that grows the card into the video; while the video plays in its window, the cover stays dimmed under Pop in's own icon, and brings it back */}
            <button
              type="button"
              aria-label={
                now.parked
                  ? "Play"
                  : view === "pip"
                    ? "Bring the video back to the sidebar"
                    : "Watch the video"
              }
              onClick={() => (now.parked ? toggle() : setView("inline"))}
              className="group/cover focus-visible:ring-ring/50 relative size-15 overflow-hidden rounded-md outline-none focus-visible:ring-3"
            >
              <img alt="" src={coverOf(now.videoId)} className="size-full object-cover" />
              <span
                className={cn(
                  "absolute inset-0 grid place-items-center bg-black/50 text-white transition-opacity",
                  view === "pip"
                    ? "opacity-100"
                    : "opacity-0 group-focus-visible/cover:opacity-100 group-hover/cover:opacity-100",
                )}
              >
                {/* nothing loaded yet, the cover plays the last song */}
                {now.parked ? (
                  <RiPlayFill className="size-5" />
                ) : view === "pip" ? (
                  <RiPictureInPicture2Line className="size-5" />
                ) : (
                  <RiExpandDiagonalLine className="size-5" />
                )}
              </span>
            </button>
            <div className="flex min-w-0 flex-col gap-0.5">
              <div className="flex items-center gap-1">
                <Marquee text={now.title} className="min-w-0 flex-1 text-xs leading-4" />
                <button
                  type="button"
                  aria-label={likes(now.videoId) ? "Unlike" : "Like"}
                  aria-pressed={likes(now.videoId)}
                  onClick={() =>
                    like({ title: now.title, url: watchUrl(now.videoId), videoId: now.videoId })
                  }
                  // as wide as the controls' squares, so it sits centred over Volume
                  className="text-muted-foreground hover:text-foreground grid h-4 w-7 shrink-0 place-items-center rounded-sm outline-none [&_svg]:size-3.5"
                >
                  {likes(now.videoId) ? (
                    <RiHeartFill className="text-destructive" />
                  ) : (
                    <RiHeartLine />
                  )}
                </button>
              </div>
              {/* the card's buttons draw no plate, muted at rest and lit on hover, a key or an open box */}
              <div className="[&_button]:text-muted-foreground [&_button]:hover:text-foreground [&_button]:focus-visible:text-foreground [&_button]:aria-expanded:text-foreground flex justify-between [&_button]:bg-transparent!">
                {search}
                {controls}
                {volumeControl}
              </div>
              {/* in the card, the skip buttons show their icon alone, with no square under it, each centred under the button above it */}
              <div className="text-muted-foreground [&_[data-skip]]:bg-transparent">{timeline}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
