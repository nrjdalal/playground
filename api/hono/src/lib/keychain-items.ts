// The Keychain items a secret ask's keychain sink may write, the allowlist in code: each one's service and the shape its value takes; a sink naming any other is refused.
export const KEYCHAIN_ITEMS = {
  yard: {
    invalid: "a Yard token starts yard_",
    service: "playground-yard",
    valid: /^yard_[A-Za-z0-9_-]+$/,
  },
} as const

export type KeychainItemName = keyof typeof KEYCHAIN_ITEMS

export const KEYCHAIN_ITEM_NAMES = Object.keys(KEYCHAIN_ITEMS) as [
  KeychainItemName,
  ...KeychainItemName[],
]
