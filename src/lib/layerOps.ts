/**
 * Layer model behind the Photoshop-style layers panel.
 *
 * Front/back convention: this module treats the array as DOM sibling order —
 * index 0 is the back-most (painted first) element, and the LAST index is the
 * front-most (painted last, on top) element. That matches how the DOM actually
 * stacks children, and is the order the document bridge (Task 9) writes back
 * through `sealed`. A layers *panel* traditionally lists front-most at the TOP
 * of the visible list, which is the reverse of this array — that reversal is a
 * presentation concern for the panel component, not this module. Every
 * function below agrees: `moveUp` moves an id one step CLOSER TO THE FRONT
 * (towards the end of the array), `moveDown` moves it one step closer to the
 * back (towards the start), `moveToFront` sends it to the end, `moveToBack`
 * sends it to the start.
 */

/** Moves `id` one step towards the front (end of the array). No-op if `id` is missing or already front-most. */
export function moveUp(ids: string[], id: string): string[] {
  const index = ids.indexOf(id)
  if (index === -1 || index === ids.length - 1) return ids
  const next = ids.slice()
  const tmp = next[index]
  next[index] = next[index + 1]
  next[index + 1] = tmp
  return next
}

/** Moves `id` one step towards the back (start of the array). No-op if `id` is missing or already back-most. */
export function moveDown(ids: string[], id: string): string[] {
  const index = ids.indexOf(id)
  if (index === -1 || index === 0) return ids
  const next = ids.slice()
  const tmp = next[index]
  next[index] = next[index - 1]
  next[index - 1] = tmp
  return next
}

/** Moves `id` to the front (end of the array). No-op if `id` is missing or already front-most. */
export function moveToFront(ids: string[], id: string): string[] {
  const index = ids.indexOf(id)
  if (index === -1 || index === ids.length - 1) return ids
  const next = ids.slice()
  next.splice(index, 1)
  next.push(id)
  return next
}

/** Moves `id` to the back (start of the array). No-op if `id` is missing or already back-most. */
export function moveToBack(ids: string[], id: string): string[] {
  const index = ids.indexOf(id)
  if (index === -1 || index === 0) return ids
  const next = ids.slice()
  next.splice(index, 1)
  next.unshift(id)
  return next
}

/**
 * Moves the element at index `from` to index `to`, shifting everything in
 * between. Out-of-range indices (negative, >= length, or equal) are a no-op
 * and return the same array reference.
 */
export function reorder(ids: string[], from: number, to: number): string[] {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= ids.length ||
    to >= ids.length
  ) {
    return ids
  }
  const next = ids.slice()
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/**
 * The command union shared by the layers panel, the document bridge, and the
 * agent's `studio_layer_op` tool — the same shape crosses all three so a
 * panel edit and an agent edit are literally the same operation.
 *
 * `beforeId: null` on `reorder` means "move to the end" (front-most, per the
 * front/back convention above).
 */
export type LayerCommand =
  | { cmd: 'reorder'; elementId: string; beforeId: string | null }
  | { cmd: 'group'; elementIds: string[] }
  | { cmd: 'ungroup'; elementId: string }
  | { cmd: 'setHidden'; elementId: string; hidden: boolean }
  | { cmd: 'setLocked'; elementId: string; locked: boolean }
  | { cmd: 'rename'; elementId: string; name: string }
  | { cmd: 'delete'; elementId: string }
  | { cmd: 'duplicate'; elementId: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString)
}

/**
 * Runtime type guard for `LayerCommand`. The bridge receives these across a
 * `postMessage` boundary where nothing is type-checked, so every variant is
 * validated by shape, not just by a recognised `cmd` string.
 */
export function isLayerCommand(value: unknown): value is LayerCommand {
  if (!isRecord(value) || !isString(value.cmd)) return false

  switch (value.cmd) {
    case 'reorder':
      return (
        isString(value.elementId) &&
        (value.beforeId === null || isString(value.beforeId))
      )
    case 'group':
      return isStringArray(value.elementIds)
    case 'ungroup':
      return isString(value.elementId)
    case 'setHidden':
      return isString(value.elementId) && typeof value.hidden === 'boolean'
    case 'setLocked':
      return isString(value.elementId) && typeof value.locked === 'boolean'
    case 'rename':
      return isString(value.elementId) && isString(value.name)
    case 'delete':
      return isString(value.elementId)
    case 'duplicate':
      return isString(value.elementId)
    default:
      return false
  }
}
