/**
 * The script injected into the Studio document iframe, and the message shapes
 * that cross that boundary.
 *
 * It is a string rather than a module because it executes in the iframe's own
 * realm, not the app's. Everything it sends is namespaced under `__fdCanvas`
 * so the canvas can ignore postMessage traffic from anything else.
 */

import { PANEL_PROPERTIES, EFFECT_ATTR } from './studioNode'
import type { EffectParams } from './textEffects'

// Re-exported for callers (and studioBridge.test.ts) that import it from here,
// as before the move — its canonical definition now lives in ./studioNode.
export { EFFECT_ATTR }

export interface BridgeRect { x: number; y: number; width: number; height: number }

/**
 * The attribute Ruling D2 gives an applied effect's parameters a home in the
 * document itself. The bridge reads/writes it as plain JSON text, distinct
 * from `PANEL_PROPERTIES` (which is only ever computed CSS) because the
 * kind/intensity/offset that produced a `text-shadow` isn't recoverable from
 * the `text-shadow` value alone. Defined in ./studioNode (DOM-free, shared
 * with the agent's studio_* tools) rather than here.
 */

export type BridgeMessage =
  | { __fdCanvas: 'bounds'; width: number; height: number }
  /** Ids were assigned to previously unidentified elements; persist this artboard. */
  | { __fdCanvas: 'sealed'; artboardId: string; html: string }
  | { __fdCanvas: 'selected'; artboardId: string; elementId: string; tag: string; rect: BridgeRect }
  | { __fdCanvas: 'cleared' }
  | { source: 'fd-bridge'; type: 'styles'; elementId: string; styles: Record<string, string> }
  | { source: 'fd-bridge'; type: 'tree'; nodes: Array<{ elementId: string; tag: string; label: string; depth: number; childCount: number }> }
  | { source: 'fd-bridge'; type: 'artboards'; boards: Array<{ id: string; name: string }> }
  | { source: 'fd-bridge'; type: 'effect'; elementId: string; params: EffectParams | null }

const FD_BRIDGE_TYPES = new Set(['styles', 'tree', 'artboards', 'effect'])

export function isBridgeMessage(data: unknown): data is BridgeMessage {
  if (typeof data !== 'object' || data === null) return false
  if ('__fdCanvas' in data) return true
  const record = data as Record<string, unknown>
  return record.source === 'fd-bridge' && typeof record.type === 'string' && FD_BRIDGE_TYPES.has(record.type)
}

/**
 * Reports the document's natural size so the host can size the iframe to it.
 *
 * Measured from the artboards' declared `data-fd-w`/`data-fd-h` rather than
 * from laid-out geometry: the declared numbers are what export uses, and they
 * are correct immediately, before fonts or images settle. Re-reported on load
 * and on fonts-ready anyway, since an artboard whose height is `auto` in some
 * future document would only be measurable then.
 */
export const BRIDGE_SCRIPT = `
(function () {
  var MARGIN = 24;
  function report() {
    var boards = document.querySelectorAll('.fd-artboard');
    var width = 0;
    var height = MARGIN;
    for (var i = 0; i < boards.length; i++) {
      var el = boards[i];
      var w = Number(el.getAttribute('data-fd-w')) || el.offsetWidth || 0;
      var h = Number(el.getAttribute('data-fd-h')) || el.offsetHeight || 0;
      if (w > width) width = w;
      height += h + MARGIN;
    }
    parent.postMessage({
      __fdCanvas: 'bounds',
      width: width + MARGIN * 2,
      height: height,
    }, '*');
  }
  report();
  window.addEventListener('load', report);
  if (document.fonts && document.fonts.ready) { document.fonts.ready.then(report); }

  // Identity is assigned here, inside the iframe, because this realm has a
  // real HTML parser. Doing it with regex over stored HTML is how this
  // feature would rot: the first attribute containing a quote or a '>'
  // produces silently corrupt markup.
  //
  // Ids must not be positional — a path like ':nth-child(3)' retargets the
  // moment the agent inserts a sibling, which it does constantly.
  var counter = 0;
  function nextId() {
    counter++;
    return 'e' + Date.now().toString(36) + counter.toString(36);
  }

  // Single write-and-persist door for every mutation below (id assignment,
  // style writes, and every layer command): finds the owning artboard from
  // any element inside it and posts the same 'sealed' shape, which is what
  // routes every one of these through StudioCanvas's applyEdit + undo path.
  // An element with no owning artboard (already detached, or the artboard
  // itself was removed) is silently skipped rather than persisted.
  function fdSeal(el) {
    var board = el && el.closest ? el.closest('.fd-artboard') : null;
    if (!board) return;
    parent.postMessage({
      __fdCanvas: 'sealed',
      artboardId: board.getAttribute('data-fd-id'),
      html: board.innerHTML,
    }, '*');
  }

  function seal() {
    var boards = document.querySelectorAll('.fd-artboard');
    for (var i = 0; i < boards.length; i++) {
      var board = boards[i];
      var added = 0;
      var nodes = board.querySelectorAll('*');
      for (var j = 0; j < nodes.length; j++) {
        if (!nodes[j].hasAttribute('data-fd-el')) {
          nodes[j].setAttribute('data-fd-el', nextId());
          added++;
        }
      }
      if (added > 0) fdSeal(board);
    }
  }

  // Shared by the canvas click handler and the 'selectNode' command from the
  // layer tree, so both selection doors post the exact same message shape and
  // land on the same host handler — one model, not two that can drift.
  function fdSelect(el) {
    var board = el.closest('.fd-artboard');
    if (!board) { parent.postMessage({ __fdCanvas: 'cleared' }, '*'); return; }
    var r = el.getBoundingClientRect();
    parent.postMessage({
      __fdCanvas: 'selected',
      artboardId: board.getAttribute('data-fd-id'),
      elementId: el.getAttribute('data-fd-el'),
      tag: el.tagName.toLowerCase(),
      // Page coordinates, so the host can place its overlay in world space
      // without knowing anything about scroll inside the frame.
      rect: { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height },
    }, '*');
  }

  document.addEventListener('click', function (e) {
    var el = e.target;
    while (el && el !== document.body && !el.hasAttribute('data-fd-el')) el = el.parentElement;
    if (!el || el === document.body) {
      parent.postMessage({ __fdCanvas: 'cleared' }, '*');
      return;
    }
    fdSelect(el);
  });

  seal();

  var FD_PANEL_PROPERTIES = ${JSON.stringify(PANEL_PROPERTIES)};

  function fdFind(id) { return document.querySelector('[data-fd-el="' + id + '"]'); }

  function fdLabel(el) {
    // A 'rename' command writes a custom name here; it wins over the derived
    // text-content label so a rename actually sticks instead of reverting to
    // the text the moment the tree next refreshes.
    var custom = el.getAttribute('data-fd-name');
    if (custom) return custom;
    var text = (el.textContent || '').trim().replace(/\\s+/g, ' ');
    if (text && text.length <= 40) return text;
    if (text) return text.slice(0, 37) + '…';
    return el.tagName.toLowerCase();
  }

  function fdTree() {
    var nodes = [];
    var walk = function (el, depth) {
      var kids = Array.prototype.filter.call(el.children, function (c) { return c.hasAttribute('data-fd-el'); });
      nodes.push({
        elementId: el.getAttribute('data-fd-el'),
        tag: el.tagName.toLowerCase(),
        label: fdLabel(el),
        depth: depth,
        childCount: kids.length,
      });
      kids.forEach(function (c) { walk(c, depth + 1); });
    };
    Array.prototype.forEach.call(document.querySelectorAll('[data-fd-el]'), function (el) {
      if (!el.parentElement || !el.parentElement.closest('[data-fd-el]')) walk(el, 0);
    });
    parent.postMessage({ source: 'fd-bridge', type: 'tree', nodes: nodes }, '*');
  }

  function fdArtboards() {
    var boards = [];
    Array.prototype.forEach.call(document.querySelectorAll('.fd-artboard[data-fd-id]'), function (el) {
      boards.push({ id: el.getAttribute('data-fd-id'), name: el.getAttribute('data-fd-name') || el.getAttribute('data-fd-id') });
    });
    parent.postMessage({ source: 'fd-bridge', type: 'artboards', boards: boards }, '*');
  }

  var EFFECT_ATTR = ${JSON.stringify(EFFECT_ATTR)};

  function fdReadEffect(el) {
    var raw = el.getAttribute(EFFECT_ATTR);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      // A hand-edited or corrupted attribute must not crash the bridge —
      // treat it the same as no effect stored.
      return null;
    }
  }

  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || typeof d !== 'object') return;

    if (d.cmd === 'readStyles') {
      var el = fdFind(d.elementId);
      if (!el) return;
      var cs = getComputedStyle(el);
      var styles = {};
      FD_PANEL_PROPERTIES.forEach(function (p) { styles[p] = cs.getPropertyValue(p).trim(); });
      parent.postMessage({ source: 'fd-bridge', type: 'styles', elementId: d.elementId, styles: styles }, '*');
    }

    if (d.cmd === 'applyStyles') {
      var target = fdFind(d.elementId);
      if (!target) return;
      Object.keys(d.patch || {}).forEach(function (p) { target.style.setProperty(p, d.patch[p]); });
      // Report back so the panel shows what the document actually accepted,
      // not what was requested — an invalid value silently does nothing.
      var cs2 = getComputedStyle(target);
      var after = {};
      FD_PANEL_PROPERTIES.forEach(function (p) { after[p] = cs2.getPropertyValue(p).trim(); });
      parent.postMessage({ source: 'fd-bridge', type: 'styles', elementId: d.elementId, styles: after }, '*');
      // A style write is a document edit like any other: route it through the
      // same 'sealed' message the id-assignment pass sends, so the host's
      // single write-and-record path persists it and enters it into undo
      // instead of the change living only in the live iframe DOM.
      fdSeal(target);
    }

    if (d.cmd === 'selectNode') {
      var node = fdFind(d.elementId);
      if (node) fdSelect(node);
    }

    if (d.cmd === 'readTree') fdTree();
    if (d.cmd === 'readArtboards') fdArtboards();

    // --- Ruling D2: the effect that produced text-shadow/-webkit-text-stroke
    // round-trips through a data-fd-effect attribute, distinct from the CSS
    // patch the panel also sends via 'applyStyles'. ---

    if (d.cmd === 'readEffect') {
      var effEl = fdFind(d.elementId);
      if (!effEl) return;
      parent.postMessage({ source: 'fd-bridge', type: 'effect', elementId: d.elementId, params: fdReadEffect(effEl) }, '*');
    }

    if (d.cmd === 'writeEffect') {
      var effTarget = fdFind(d.elementId);
      if (!effTarget) return;
      if (d.params) effTarget.setAttribute(EFFECT_ATTR, JSON.stringify(d.params));
      else effTarget.removeAttribute(EFFECT_ATTR);
      parent.postMessage({ source: 'fd-bridge', type: 'effect', elementId: d.elementId, params: fdReadEffect(effTarget) }, '*');
      fdSeal(effTarget);
    }

    // --- Task 4/9: the layers panel and the agent's studio_layer_op tool
    // both post a LayerCommand's own object across, unchanged, so d.cmd is
    // the command's own discriminant and the remaining fields are exactly
    // LayerCommand's fields. Validation against isLayerCommand happens on
    // the host before it ever reaches this postMessage boundary (see
    // useStudioNode.runLayerCommand); handlers here still guard against a
    // missing/foreign id since an element can vanish between the panel
    // reading the tree and the command arriving. setLocked is intentionally
    // absent — it is editor-only state the host never forwards here. ---

    if (d.cmd === 'reorder') {
      var reEl = fdFind(d.elementId);
      if (!reEl || !reEl.parentElement) return;
      if (d.beforeId === null) {
        reEl.parentElement.appendChild(reEl);
      } else {
        var beforeEl = fdFind(d.beforeId);
        if (!beforeEl || beforeEl.parentElement !== reEl.parentElement) return;
        reEl.parentElement.insertBefore(reEl, beforeEl);
      }
      fdSeal(reEl);
    }

    if (d.cmd === 'group') {
      var ids = Array.isArray(d.elementIds) ? d.elementIds : [];
      var els = ids.map(fdFind).filter(function (e) { return !!e; });
      if (els.length === 0) return;
      // Document order, ascending, so the wrapper preserves front/back order
      // regardless of the order ids were selected in.
      els.sort(function (a, b) {
        var pos = a.compareDocumentPosition(b);
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
      });
      var groupParent = els[0].parentElement;
      if (!groupParent) return;
      var wrapper = document.createElement('div');
      wrapper.setAttribute('data-fd-el', nextId());
      groupParent.insertBefore(wrapper, els[0]);
      els.forEach(function (e) { wrapper.appendChild(e); }); // ids/order preserved, just re-parented
      fdSeal(wrapper);
    }

    if (d.cmd === 'ungroup') {
      var wrapperEl = fdFind(d.elementId);
      if (!wrapperEl || !wrapperEl.parentElement) return;
      var ungroupParent = wrapperEl.parentElement;
      var kids = Array.prototype.slice.call(wrapperEl.children);
      kids.forEach(function (k) { ungroupParent.insertBefore(k, wrapperEl); });
      ungroupParent.removeChild(wrapperEl);
      fdSeal(ungroupParent);
    }

    if (d.cmd === 'setHidden') {
      var hideEl = fdFind(d.elementId);
      if (!hideEl) return;
      if (d.hidden) hideEl.style.setProperty('display', 'none');
      else hideEl.style.removeProperty('display');
      fdSeal(hideEl);
    }

    if (d.cmd === 'rename') {
      var renameEl = fdFind(d.elementId);
      if (!renameEl || typeof d.name !== 'string') return;
      var trimmed = d.name.trim();
      if (!trimmed) return;
      renameEl.setAttribute('data-fd-name', trimmed);
      fdSeal(renameEl);
    }

    if (d.cmd === 'delete') {
      var delEl = fdFind(d.elementId);
      // An artboard is a document, not a layer inside one — deleting it is
      // out of scope for this command.
      if (!delEl || delEl.classList.contains('fd-artboard')) return;
      var delParent = delEl.parentElement;
      if (!delParent) return;
      delEl.remove();
      parent.postMessage({ __fdCanvas: 'cleared' }, '*');
      fdSeal(delParent);
    }

    if (d.cmd === 'duplicate') {
      var dupEl = fdFind(d.elementId);
      if (!dupEl || !dupEl.parentElement) return;
      var clone = dupEl.cloneNode(true);
      // Every id in the subtree must be fresh, including the root of the
      // clone — reusing any of the original's ids would mean two elements
      // answering to the same data-fd-el, which breaks fdFind's lookup and
      // therefore every command after this one.
      clone.setAttribute('data-fd-el', nextId());
      var clonedDescendants = clone.querySelectorAll('[data-fd-el]');
      for (var k = 0; k < clonedDescendants.length; k++) {
        clonedDescendants[k].setAttribute('data-fd-el', nextId());
      }
      dupEl.parentElement.insertBefore(clone, dupEl.nextSibling);
      fdSeal(clone);
    }
  });
})();
`
