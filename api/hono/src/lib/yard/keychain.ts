import { userInfo } from "node:os"

import { keychainItem, type KeychainItem, type Run } from "../keychain"
import { KEYCHAIN_ITEMS } from "../keychain-items"

// The Mac's Yard token in the macOS Keychain: the local API and `playground yard` read it, so the token stays on this Mac and never reaches a browser.

export const KEYCHAIN_SERVICE = KEYCHAIN_ITEMS.yard.service

export type { Run }

export const keychain = (run?: Run, account = userInfo().username): KeychainItem =>
  keychainItem("yard", { account, run })

// A bot's token, which `playground yard bot add` writes and never prints, in an item of its own a reveal card names for the owner's Copy.
export const botService = (name: string) => `playground-yard-bot-${name}`

export const botKeychain = (name: string, run?: Run, account = userInfo().username): KeychainItem =>
  keychainItem(botService(name), { account, run })

// The Mac's relay token, in an item of its own that the local API alone reads, to hold the relay; `playground yard` never reads it.
export const relayKeychain = (run?: Run, account = userInfo().username): KeychainItem =>
  keychainItem("relay", { account, run })

export type Keychain = KeychainItem
