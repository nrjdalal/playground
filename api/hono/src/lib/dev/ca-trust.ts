import { X509Certificate } from "node:crypto"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

// Which of Linux's browsers trust portless's CA, which no setup step puts in a browser's own store. Firefox keeps an NSS store in each profile, read here and written by the ca-trust fix with certutil. A Chromium-family browser trusts the CA only through its own certificate manager, which no file here reads: ~/.pki/nssdb holding it as C,, was measured not to count on Chromium 157 and 159. Imports only node: modules, since playground doctor reads it too.

export const CA_NAME = "portless Local CA"

// The Chromium-family browsers whose own import the steps name, by the command each puts on PATH.
export const CHROMIUM = [
  "brave-browser",
  "chromium",
  "chromium-browser",
  "google-chrome",
  "google-chrome-stable",
  "helium",
  "microsoft-edge",
  "vivaldi",
]

// In a Chromium-family browser's own words: its certificate manager's import, and the page info button that drops a Proceed made before it (IDS_PAGE_INFO_RESET_INVALID_CERTIFICATE_DECISIONS_BUTTON, "Turn on warnings").
export const chromiumSteps = (browsers: string[], ca: string): string =>
  `In ${browsers.join(", ")}, open chrome://certificate-manager, then Local certificates, Custom, Installed by you, Trusted certificates, and Import ${ca}. Restart the browser. If the address still reads Not secure, click it and choose Turn on warnings, which drops a Proceed you clicked before.`

export type CaProbe = {
  has: (cmd: string) => boolean
  run: (argv: string[]) => Promise<{ code: number; stdout: string }>
}

export type CaTrust = {
  certutil: boolean
  chromium: string[]
  firefox: string[]
  untrusted: string[]
}

// Each Firefox profile that has its certificate store yet: snap's under ~/snap/firefox/common, a deb or tarball Firefox's under ~/.mozilla.
export const firefoxProfiles = (home: string): string[] =>
  [
    join(home, "snap", "firefox", "common", ".mozilla", "firefox"),
    join(home, ".mozilla", "firefox"),
  ].flatMap((root) => {
    try {
      return readdirSync(root)
        .map((name) => join(root, name))
        .filter((profile) => existsSync(join(profile, "cert9.db")))
        .toSorted()
    } catch {
      return []
    }
  })

// A certificate's public key, so a copy the proxy signed again still matches its CA; null for text that holds none.
const keyOf = (pem: string): string | null => {
  try {
    return new X509Certificate(pem).publicKey
      .export({ format: "der", type: "spki" })
      .toString("hex")
  } catch {
    return null
  }
}

const PEM_END = "-----END CERTIFICATE-----"

// Whether a profile's store holds the CA's key under CA_NAME, trusted to issue server certificates (C in its SSL field).
const trustedIn = async (profile: string, key: string, probe: CaProbe): Promise<boolean> => {
  const db = `sql:${profile}`
  const listed = await probe.run(["certutil", "-L", "-d", db])
  const trust = listed.stdout
    .split("\n")
    .find((line) => line.startsWith(`${CA_NAME} `))
    ?.trim()
    .split(/\s+/)
    .at(-1)
  if (listed.code !== 0 || !trust?.split(",")[0]?.includes("C")) return false
  const pems = await probe.run(["certutil", "-L", "-d", db, "-n", CA_NAME, "-a"])
  return (
    pems.code === 0 &&
    pems.stdout
      .split(PEM_END)
      .slice(0, -1)
      .some((pem) => keyOf(`${pem}${PEM_END}`) === key)
  )
}

// What trusts the CA file at ca: each Firefox profile, those that do not (every one while certutil is missing, since none can be read), and the Chromium-family browsers on PATH, which only the owner's import reaches.
export const readCaTrust = async (ca: string, home: string, probe: CaProbe): Promise<CaTrust> => {
  const firefox = firefoxProfiles(home)
  const certutil = probe.has("certutil")
  const key = (() => {
    try {
      return keyOf(readFileSync(ca, "utf8"))
    } catch {
      return null
    }
  })()
  const untrusted: string[] = []
  for (const profile of firefox)
    if (!certutil || !key || !(await trustedIn(profile, key, probe))) untrusted.push(profile)
  return { certutil, chromium: CHROMIUM.filter((cmd) => probe.has(cmd)), firefox, untrusted }
}
