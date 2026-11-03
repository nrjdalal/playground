const MAX_NAME = 120

// Pure: a title as the name a file saves under: each character a file name cannot hold (/ \ : * ? " < > | and control characters) a space, each run of spaces one, no dot or space at either end, at most 120 characters, "download" when nothing is left, then the extension.
export function fileNameOf(title: string, extension: string): string {
  const base =
    title
      .replace(/[/\\:*?"<>|\p{Cc}]/gu, " ")
      .replace(/\s+/g, " ")
      .slice(0, MAX_NAME)
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
