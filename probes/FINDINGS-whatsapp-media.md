# Sending attachments on WhatsApp Web

Verified end to end against a real chat before any of it was written into the
app. Probes wa-01 … wa-08.

## The native file dialog is not involved

The obvious route — click the paperclip, drive the file picker — is a dead end,
because the picker is a native Windows dialog and JavaScript cannot fill it. The
usual workarounds are `DOM.setFileInputFiles` through CDP, or synthesising a
drag-and-drop onto the chat. Neither was needed.

WhatsApp's own module registry, already open (see `whatsappInject.ts`), carries
the send path directly. `window.require('__debug')` lists **16,878** modules.

## The route

```
WAWebMediaOpaqueData.createFromData(blob, mimetype)   -> opaque data
WAWebPrepRawMedia.prepRawMedia(opaque, opts)          -> a MediaPrep
prep.waitForPrep()                                    -> processing finished
prep.sendToChat({ chat, options })                    -> sent
```

`chat` comes from `WAWebCollections.Chat.get(chatId)`, the same collection the
text path already uses.

### The first argument is not a File

`prepRawMedia` calls `autoreleaseWhenPromiseCompletes` on what it is given.
That is an OpaqueData method, not a File one — so passing a File fails deep
inside the send path rather than at the call site. This single line in the
minified source is what redirected the whole implementation, and it is why
wa-04 existed at all.

`createFromData(data, mimetype)` returns a Promise and accepts a Blob directly:

```js
r.blob = e instanceof Blob && e.type === t ? e : new Blob([e], { type: t })
```

### Options, read out of the source rather than guessed

`prepRawMedia(media, opts)` picks the outward type from flags, in this order:

| flag | outward type |
|---|---|
| `isPtt` | `ptt` |
| `asDocument` | `document` |
| `asGif` | `video` |
| `isAudio` | `audio` |
| `asSticker` | `sticker` |
| `asStickerPack` | `sticker-pack` |
| none | `unknown` |

`unknown` is not a failure state. Tested (wa-08): an image blob sent with no
flags resolved to type `image`, and WhatsApp transcoded the PNG to JPEG itself.
With `asDocument` (wa-06) it resolved to `document` and kept the filename.

`sendToChat` destructures `{ chat, earlyUpload, options }`. Its body and
`processRawMedia`'s are behind minified async wrappers and cannot be read, so
`filename` and `caption` were settled by sending and reading the result back:
`filename` in the prep options works, and the message came back with
`filename: "flowdesk-test.txt"`, `size: 50`, `caption` set, `ack: 2`.

## Route A was abandoned, and why

`WAWebAttachMediaCollection` mirrors the attachment tray and has
`processAttachmentsForChat` / `processAttachments`. Both are five- and
seven-argument async wrappers whose bodies are not readable, so their arguments
could not be learned from the page. Route B is two readable calls and needs no
picker state.

## What crosses from the main process

The page cannot read the filesystem, so bytes arrive as base64 inside an
evaluated script. They are staged in chunks (512KB before base64 expansion) and
assembled as a Blob at send time, so the evaluated script stays small no matter
how large the file is. The assembled size is checked against the real file size
inside the page before anything sends — a lost chunk would otherwise deliver a
silently truncated file, which looks like success from every side.

Unlike the text path, an unknown chat id is **not** passed to
`findOrCreateLatestChat`. Creating a new chat as a side effect of sending a file
would deliver the user's file somewhere they never chose.
