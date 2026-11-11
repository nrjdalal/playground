import { z } from "zod"

export const WHATSAPP_KEYS = { device: "wa.device", owner: "wa.owner" } as const

export type WhatsappKey = (typeof WHATSAPP_KEYS)[keyof typeof WHATSAPP_KEYS]

const number = z.string().trim()

export const whatsappFormSchema = z.object({ device: number, owner: number })

export type WhatsappForm = z.input<typeof whatsappFormSchema>

export const whatsappWrites = (_form: WhatsappForm): { key: WhatsappKey; value: string }[] => []

export const whatsappWrite = (key: WhatsappKey, value: string, scope: string) => ({
  json: { by: "Settings", reason: `Set ${key} in Settings > Extensions`, scope, value },
  param: { key },
})
