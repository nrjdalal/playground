"use client"

import type { AttachmentKind, EntryAttachment } from "@api/hono"
import { RiCloseLine, RiFilePdf2Line, RiFileTextLine, RiRefreshLine } from "@remixicon/react"
import { cn } from "cn"
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
} from "react"

import { Hint } from "@/components/hint"
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/components/ui/attachment"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import {
  ACCEPT,
  attachmentUrl,
  byteLabel,
  fitFiles,
  fitRefs,
  heldReducer,
  isAttachmentId,
  kindLabel,
  MAX_FILE_BYTES,
  MAX_FILES,
  pasteTakesFiles,
  PREVIEWABLE,
  uploadAttachment,
  uploadWait,
  type Held,
  type HeldAction,
  type UploadWait,
} from "@/lib/attachments"
import { dropFile, isKept, keepFile, keptFiles, withClaim } from "@/lib/draft-files"
import { attachmentGone, keptAttachments } from "@/lib/drafts"
import type { OutboxAttachment } from "@/lib/outbox"
import { pastedFile } from "@/lib/paste"

// One chip: a file being attached, attached, or named by a message the session received.
export type AttachmentChipItem = {
  id: string | null
  key: string
  kind: AttachmentKind | null
  name: string | null
  preview: string | null
  // the composer's own: tries a failed upload again
  retry: (() => void) | null
  size: number | null
  uploading: boolean
  wait: UploadWait
}

const revoke = (item: Held) => {
  if (item.preview?.startsWith("blob:")) URL.revokeObjectURL(item.preview)
}

const heldFrom = (refs: OutboxAttachment[]): Held[] =>
  refs.map((ref) => ({
    key: crypto.randomUUID(),
    name: ref.name,
    preview: ref.previewUrl,
    ref,
    size: ref.size,
    wait: null,
  }))

const carriesFiles = (event: { dataTransfer: DataTransfer | null }) =>
  Boolean(event.dataTransfer?.types.includes("Files"))

const tooMany = () =>
  toast.add({ title: `A message carries at most ${MAX_FILES} files`, type: "warning" })

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener("abort", done)
  })

// The composer's files: each one uploads the moment it is added (picked, pasted or dropped), so a send waits only on what is still in flight. An upload with no answer, as while the dashboard restarts, waits as queued and tries again on the outbox's backoff, then fails with Retry; until it is uploaded, the file is kept in this browser under `to`, the session's name, and a reload puts its chip back and uploads it then. `initial` are files already uploaded that the box starts with, a saved draft's. `refs` are the uploaded ones, as a message carries them; `ready` is false while any is not uploaded yet.
export function useAttachments(to: string, initial: OutboxAttachment[] = []) {
  const [held, setHeld] = useState<Held[]>(() => heldFrom(fitRefs(0, initial).taken))
  const [dragging, setDragging] = useState(false)
  // Mirrors held synchronously, so files added twice in one tick still count against the cap, and a preview is revoked once.
  const current = useRef<Held[]>(held)
  const uploads = useRef(new Map<string, AbortController>())
  // each file not uploaded yet, for its retries
  const files = useRef(new Map<string, File>())
  // A drag over the box crosses its children, each entry and exit firing on its own, so the box is left only when every entry has been matched by an exit.
  const depth = useRef(0)
  const picker = useRef<HTMLInputElement>(null)

  const update = (action: HeldAction) => {
    current.current = heldReducer(current.current, action)
    setHeld(current.current)
  }

  const remove = (key: string) => {
    uploads.current.get(key)?.abort()
    uploads.current.delete(key)
    files.current.delete(key)
    void dropFile(key)
    const item = current.current.find((h) => h.key === key)
    if (item) revoke(item)
    update({ key, type: "remove" })
  }

  // Uploads one held file until the API answers or it fails; the caller holds this tab's claim on it (withClaim), so a second tab reloaded beside this one leaves it alone.
  const upload = async (key: string, file: File) => {
    const controller = new AbortController()
    const { signal } = controller
    uploads.current.set(key, controller)
    for (let tries = 1; !signal.aborted; tries++) {
      // between tries the chip stays Queued, so only a first try reads Uploading
      if (tries === 1) update({ key, type: "wait", wait: null })
      const { data, error } = await uploadAttachment(file, signal)
      if (signal.aborted) return
      if (!error) {
        uploads.current.delete(key)
        files.current.delete(key)
        // the row goes before the claim does, so a tab claiming it next finds it gone
        await dropFile(key)
        const ref: OutboxAttachment = {
          id: data.id,
          kind: data.kind,
          name: file.name,
          previewUrl: data.kind === "image" ? attachmentUrl(data.id) : null,
          size: data.size,
        }
        update({ key, ref, type: "settle" })
        return
      }
      const next = uploadWait(error.code, tries)
      if (next === "refused") {
        toast.add({ title: `${file.name}: ${error.message}`, type: "error" })
        remove(key)
        return
      }
      if (next === "failed") {
        uploads.current.delete(key)
        update({ key, type: "wait", wait: "failed" })
        return
      }
      update({ key, type: "wait", wait: "queued" })
      await pause(next, signal)
    }
  }

  const hold = (key: string, file: File) => {
    files.current.set(key, file)
    const preview = PREVIEWABLE.has(file.type) ? URL.createObjectURL(file) : null
    update({
      items: [{ key, name: file.name, preview, ref: null, size: file.size, wait: null }],
      type: "add",
    })
  }

  const add = (picked: File[]) => {
    const { dropped, taken, tooLarge } = fitFiles(current.current.length, picked)
    if (tooLarge.length) {
      const limit = byteLabel(MAX_FILE_BYTES)
      toast.add({ title: `${tooLarge.join(", ")}: a file holds at most ${limit}`, type: "error" })
    }
    if (dropped) tooMany()
    for (const file of taken) {
      const key = crypto.randomUUID()
      void keepFile({ at: Date.now(), file, key, to })
      hold(key, file)
      void withClaim(key, () => upload(key, file))
    }
  }

  const retry = (key: string) => {
    const file = files.current.get(key)
    if (!file || uploads.current.has(key)) return
    // a tab reloaded since this one failed may be uploading it; one that already has leaves at worst a spare copy the weekly sweep clears
    void withClaim(key, () => upload(key, file)).then((claimed) => {
      if (!claimed) toast.add({ title: `${file.name}: another tab is uploading it`, type: "info" })
    })
  }

  // Files already uploaded, put back as they were: a failed message's Edit hands its files back with its words.
  const restore = (refs: OutboxAttachment[]) => {
    const { dropped, taken } = fitRefs(current.current.length, refs)
    if (dropped) tooMany()
    update({ items: heldFrom(taken), type: "add" })
  }

  const clear = () => {
    for (const item of current.current) {
      revoke(item)
      void dropFile(item.key)
    }
    files.current.clear()
    update({ type: "clear" })
  }

  // A saved draft's files leave the folder a week after they arrive, so those the API says are gone are dropped quietly rather than failing the send.
  useEffect(() => {
    const restored = current.current.flatMap((h) => (h.ref ? [{ key: h.key, ref: h.ref }] : []))
    if (!restored.length) return
    let live = true
    void keptAttachments(
      restored.map((h) => h.ref),
      attachmentGone,
    ).then((kept) => {
      if (!live) return
      const ids = new Set(kept.map((ref) => ref.id))
      for (const h of restored) if (!ids.has(h.ref.id)) update({ key: h.key, type: "remove" })
    })
    return () => {
      live = false
    }
  }, [])

  // Files a reload or a session switch left before they uploaded come back as chips and upload, each only in the tab that claims it.
  useEffect(() => {
    let live = true
    void keptFiles(to).then((kept) => {
      if (!live) return
      const { dropped, taken } = fitFiles(
        current.current.length,
        kept.map((row) => row.file),
      )
      if (dropped) tooMany()
      for (const row of kept) {
        // a row past the cap stays kept, for a box with room after a reload, or the weekly sweep
        if (!taken.includes(row.file)) continue
        void withClaim(row.key, async () => {
          // another tab may have uploaded it since the rows were read
          if (!live || current.current.some((h) => h.key === row.key)) return
          if (!(await isKept(row.key)) || !live) return
          hold(row.key, row.file)
          await upload(row.key, row.file)
        })
      }
    })
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    const active = uploads.current
    // A file dropped beside the box would otherwise open in the tab, losing the page's outbox and the words being written; outside the box the cursor says it will not be taken. The box's own handlers run first and claim their drag.
    const keep = (event: globalThis.DragEvent) => {
      if (!carriesFiles(event) || event.defaultPrevented) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = "none"
    }
    window.addEventListener("dragover", keep)
    window.addEventListener("drop", keep)
    return () => {
      window.removeEventListener("dragover", keep)
      window.removeEventListener("drop", keep)
      for (const upload of active.values()) upload.abort()
      for (const item of current.current) revoke(item)
    }
  }, [])

  const chips: AttachmentChipItem[] = held.map((h) => ({
    id: h.ref?.id ?? null,
    key: h.key,
    kind: h.ref?.kind ?? null,
    name: h.name,
    preview: h.preview,
    retry: h.wait === "failed" ? () => retry(h.key) : null,
    size: h.size,
    uploading: !h.ref,
    wait: h.wait,
  }))

  return {
    add,
    chips,
    clear,
    dragging,
    // Drop on the composer: only a drag that carries files is taken, so dragging text in still drops text.
    dropProps: {
      onDragEnter: (event: DragEvent) => {
        if (!carriesFiles(event)) return
        depth.current += 1
        setDragging(true)
      },
      onDragLeave: (event: DragEvent) => {
        if (!carriesFiles(event)) return
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setDragging(false)
      },
      onDragOver: (event: DragEvent) => {
        if (carriesFiles(event)) event.preventDefault()
      },
      onDrop: (event: DragEvent) => {
        depth.current = 0
        setDragging(false)
        if (!event.dataTransfer.files.length) return
        event.preventDefault()
        add([...event.dataTransfer.files])
      },
    },
    // a file whose upload ran out of tries, which waits on Retry or Remove
    failed: held.some((h) => h.wait === "failed"),
    // A paste whose files are what was copied attaches them in place of its text; a paste of real text beside an image (spreadsheet cells, a slide) stays text, and a long one goes as a text file (pastedFile), so it is never refused.
    onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const files = [...event.clipboardData.files]
      const text = event.clipboardData.getData("text/plain")
      if (
        files.length &&
        pasteTakesFiles(
          text,
          files.map((file) => file.name),
        )
      ) {
        event.preventDefault()
        add(files)
        return
      }
      // with no room for another file the paste goes in as words, as it did before
      if (current.current.length >= MAX_FILES) return
      const box = event.currentTarget
      const { selectionEnd, selectionStart, value } = box
      const file = pastedFile(text, value.slice(0, selectionStart), value.slice(selectionEnd))
      if (!file) return
      event.preventDefault()
      add([file])
      // the paste replaces what was selected, as one in the box would; the input event lets React's onChange read the box
      if (selectionStart === selectionEnd) return
      box.setRangeText("", selectionStart, selectionEnd, "end")
      box.dispatchEvent(new Event("input", { bubbles: true }))
    },
    pick: () => picker.current?.click(),
    pickerProps: {
      accept: ACCEPT,
      hidden: true,
      multiple: true,
      onChange: (event: ChangeEvent<HTMLInputElement>) => {
        add([...(event.target.files ?? [])])
        event.target.value = ""
      },
      ref: picker,
      type: "file" as const,
    },
    ready: held.every((h) => h.ref),
    refs: held.flatMap((h) => (h.ref ? [h.ref] : [])),
    remove,
    restore,
  }
}

// The chips for a message's files as they went out: what the outbox holds for a message on its way, or for one it saw delivered.
export const chipsFromRefs = (refs: OutboxAttachment[]): AttachmentChipItem[] =>
  refs.map((ref, i) => ({
    id: ref.id,
    key: `${i}:${ref.id}`,
    kind: ref.kind,
    name: ref.name,
    preview: ref.previewUrl,
    retry: null,
    size: ref.size,
    uploading: false,
    wait: null,
  }))

// The chips for a message in a transcript, which names its files by id alone; an id the API would not give, or an image whose id is not read yet, is left out.
export const chipsFromEntry = (attachments: EntryAttachment[]): AttachmentChipItem[] =>
  attachments
    .flatMap((file) =>
      file.id !== null && isAttachmentId(file.id) ? [{ ...file, id: file.id }] : [],
    )
    .map((file, i) => ({
      id: file.id,
      key: `${i}:${file.id}`,
      kind: file.kind,
      name: null,
      preview: file.kind === "image" ? attachmentUrl(file.id) : null,
      retry: null,
      size: null,
      uploading: false,
      wait: null,
    }))

function AttachmentChip({
  item,
  label,
  onRemove,
}: {
  item: AttachmentChipItem
  label: string
  onRemove?: (key: string) => void
}) {
  // A thumbnail that will not load: from the server, the file has left the folder (files are kept for a week); a picked file the browser cannot draw shows its icon instead.
  const [broken, setBroken] = useState(false)
  const expired = broken && Boolean(item.id) && !item.preview?.startsWith("blob:")
  const title = item.name ?? (item.kind ? kindLabel(item.kind) : "File")
  // A file named by id alone shows its kind over its extension, or over Document when the two would read the same (a PDF).
  const extension = item.id?.split(".").pop()?.toUpperCase() ?? null
  const detail = extension === title.toUpperCase() ? "Document" : extension
  const failed = item.wait === "failed"
  const description = expired
    ? "Expired"
    : failed
      ? "Upload failed"
      : item.wait === "queued"
        ? "Queued"
        : item.uploading
          ? "Uploading"
          : [
              item.name && item.kind ? kindLabel(item.kind) : detail,
              item.size === null ? null : byteLabel(item.size),
            ]
              .filter(Boolean)
              .join(" · ")
  const href = item.id && !item.uploading && !expired ? attachmentUrl(item.id) : null
  const thumbnail = item.preview && !broken ? item.preview : null
  return (
    <Attachment
      size="sm"
      state={expired || failed ? "error" : item.uploading ? "uploading" : "done"}
      // the open link covers the chip, so its focus lights the chip's border rather than filling over the file
      className="has-[:focus-visible]:border-ring"
    >
      <AttachmentMedia variant={thumbnail ? "image" : "icon"}>
        {thumbnail ? (
          <img src={thumbnail} alt="" onError={() => setBroken(true)} />
        ) : item.uploading && !failed ? (
          <Spinner />
        ) : item.kind === "pdf" ? (
          <RiFilePdf2Line />
        ) : (
          <RiFileTextLine />
        )}
      </AttachmentMedia>
      <AttachmentContent>
        {/* the uploading title's shimmer loops, so it stops where motion is reduced: a plain animate-none loses to the state variant's specificity */}
        <AttachmentTitle className="motion-reduce:shimmer-none motion-reduce:animate-none!">
          {title}
        </AttachmentTitle>
        <AttachmentDescription>{description}</AttachmentDescription>
      </AttachmentContent>
      {href ? (
        <Hint content={item.name ?? undefined}>
          <AttachmentTrigger
            aria-label={`Open ${label}`}
            className="focus-visible:bg-transparent"
            render={<a href={href} target="_blank" rel="noreferrer" />}
          />
        </Hint>
      ) : null}
      {onRemove || item.retry ? (
        <AttachmentActions>
          {item.retry ? (
            <AttachmentAction aria-label={`Retry ${label}`} onClick={item.retry}>
              <RiRefreshLine />
            </AttachmentAction>
          ) : null}
          {onRemove ? (
            <AttachmentAction aria-label={`Remove ${label}`} onClick={() => onRemove(item.key)}>
              <RiCloseLine />
            </AttachmentAction>
          ) : null}
        </AttachmentActions>
      ) : null}
    </Attachment>
  )
}

// A row of file chips: an image shows its thumbnail, anything else its kind; an image opens in a new tab and any other file downloads. With onRemove each chip also has a remove button, as in the composer. Each is named for a screen reader by its file's name, or by its kind and place when only its id is known.
export function AttachmentChips({
  className,
  items,
  onRemove,
}: {
  className?: string
  items: AttachmentChipItem[]
  onRemove?: (key: string) => void
}) {
  if (!items.length) return null
  return (
    // the strip scrolls sideways, which clips: its chips sit 4px in, so a focus ring is never cut, and the strip gives that room back outside
    <AttachmentGroup className={cn("-m-1 p-1", className)}>
      {items.map((item, i) => (
        <AttachmentChip
          key={item.key}
          item={item}
          label={
            item.name ?? `${item.kind ? kindLabel(item.kind) : "file"} ${i + 1} of ${items.length}`
          }
          onRemove={onRemove}
        />
      ))}
    </AttachmentGroup>
  )
}
