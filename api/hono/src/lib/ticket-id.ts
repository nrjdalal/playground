// One whole Linear ticket ID, such as ABC-123: the shape the dashboard accepts wherever an ID names a file or reaches a session. Held in core, so core never reaches an app's lib for it.
export const TICKET_ID_RE = /^[A-Z][A-Z0-9]*-\d{1,9}$/
