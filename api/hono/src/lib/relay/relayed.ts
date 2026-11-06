// The mark a write from Yard carries into this Mac's own API: answerRelay sets it, in process, on the request it builds once requireSignedWrite passes the frame, and requireTrustedOrigin and requireLoopback take that request alone. It lives in memory, never in a header or a query, so nothing a network request carries can claim it.
const relayed = new WeakSet<Request>()

export const markRelayed = (request: Request): Request => {
  relayed.add(request)
  return request
}

export const isRelayed = (request: Request): boolean => relayed.has(request)
