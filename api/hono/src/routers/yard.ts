import { Hono } from "hono"

// Yard's routes, which only the hosted build mounts (hosted.ts); empty until its channels, messages and invites land.
export const yardRouter = new Hono()
