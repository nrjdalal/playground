import localFont from "next/font/local"

export const dmSans = localFont({
  src: [
    { path: "../fonts/dm-sans-latin-wght-normal.woff2", style: "normal" },
    { path: "../fonts/dm-sans-latin-wght-italic.woff2", style: "italic" },
  ],
  variable: "--font-dm-sans",
  weight: "100 1000",
})

// The latin file has no box-drawing glyphs, so an ASCII drawing's lines come from the next font in the stack: a monospace one of the same width, never next/font's adjusted Arial, whose ─ is half again as wide.
export const jetbrainsMono = localFont({
  adjustFontFallback: false,
  fallback: ["ui-monospace", "Menlo", "monospace"],
  src: "../fonts/jetbrains-mono-latin-wght-normal.woff2",
  variable: "--font-jetbrains-mono",
  weight: "100 800",
})
