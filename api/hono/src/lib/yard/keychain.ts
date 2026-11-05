import { userInfo } from "node:os"

import { keychainItem, type KeychainItem, type Run } from "../keychain"
import { KEYCHAIN_ITEMS } from "../keychain-items"

// The Mac's Yard token in the macOS Keychain: the local API and `playground yard` read it, so the token stays on this Mac and never reaches a browser.

export const KEYCHAIN_SERVICE = KEYCHAIN_ITEMS.yard.service

export type { Run }

export const keychain = (run?: Run, account = userInfo().username): KeychainItem =>
  keychainItem("yard", { account, run })

export type Keychain = KeychainItem
