import { orgOf } from "@packages/config/org"

// The organisation's config (packages/config/src/org.ts), read once as the API starts, as its env is, so a value its schema refuses stops the start rather than a request.
export const org = orgOf(process.env)
