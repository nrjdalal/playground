const MAX_NAME = 120

// Pure: a title as the name a file saves under: each character a file name cannot hold (/ \ : * ? " < > |, control characters, a lone surrogate, and a format character such as a right-to-left override but the joiner inside an emoji) a space, each run of spaces one, no dot or space at either end, at most 120 code points, "download" when nothing is left, then the extension.
export function fileNameOf(title: string, extension: string): string {
  const clean = title
    .replace(/[/\\:*?"<>|\p{Cc}\p{Cs}]|(?!\u200d)\p{Cf}/gu, " ")
    .replace(/\s+/g, " ")
  // cut by code point, since a cut through an emoji's surrogate pair leaves a name encodeURIComponent throws on
  const base =
    Array.from(clean)
      .slice(0, MAX_NAME)
      .join("")
      .replace(/^[\s.]+|[\s.]+$/g, "") || "download"
  return extension ? `${base}.${extension}` : base
}

// RFC 5987's encoding: every byte but a letter, a digit and !#$&+-.^_`|~ as %XX.
const encodeExtended = (name: string): string =>
  encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )

// Pure: the Content-Disposition that saves a file under name: filename* carries it whole in UTF-8 (RFC 6266), and filename an ASCII copy for an old client, each other character and % as _.
export const attachmentDisposition = (name: string): string =>
  `attachment; filename="${name.replace(/[^\x20-\x7e]|[%"\\]/g, "_")}"; filename*=UTF-8''${encodeExtended(name)}`
