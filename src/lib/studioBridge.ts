/**
 * The script injected into the Studio document iframe, and the message shapes
 * that cross that boundary.
 *
 * It is a string rather than a module because it executes in the iframe's own
 * realm, not the app's. Everything it sends is namespaced under `__fdCanvas`
 * so the canvas can ignore postMessage traffic from anything else.
 */

export interface BridgeRect { x: number; y: number; width: number; height: number }

export type BridgeMessage =
  | { __fdCanvas: 'bounds'; width: number; height: number }
  /** Ids were assigned to previously unidentified elements; persist this artboard. */
  | { __fdCanvas: 'sealed'; artboardId: string; html: string }
  | { __fdCanvas: 'selected'; artboardId: string; elementId: string; tag: string; rect: BridgeRect }
  | { __fdCanvas: 'cleared' }
  | { source: 'fd-bridge'; type: 'styles'; elementId: string; styles: Record<string, string> }
  | { source: 'fd-bridge'; type: 'tree'; nodes: Array<{ elementId: string; tag: string; label: string; depth: number; childCount: number }> }
  | { source: 'fd-bridge'; type: 'artboards'; boards: Array<{ id: string; name: string }> }

const FD_BRIDGE_TYPES = new Set(['styles', 'tree', 'artboards'])

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
  function seal() {
    var boards = document.querySelectorAll('.fd-artboard');
    for (var i = 0; i < boards.length; i++) {
      var board = boards[i];
      var added = 0;
      var nodes = board.querySelectorAll('*');
      for (var j = 0; j < nodes.length; j++) {
        if (!nodes[j].hasAttribute('data-fd-el')) {
          counter++;
          nodes[j].setAttribute('data-fd-el', 'e' + Date.now().toString(36) + counter.toString(36));
          added++;
        }
      }
      if (added > 0) {
        parent.postMessage({
          __fdCanvas: 'sealed',
          artboardId: board.getAttribute('data-fd-id'),
          html: board.innerHTML,
        }, '*');
      }
    }
  }

  document.addEventListener('click', function (e) {
    var el = e.target;
    while (el && el !== document.body && !el.hasAttribute('data-fd-el')) el = el.parentElement;
    if (!el || el === document.body) {
      parent.postMessage({ __fdCanvas: 'cleared' }, '*');
      return;
    }
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
  });

  seal();

  var FD_PANEL_PROPERTIES = ['left','top','width','height','rotate','display','flex-direction','align-items','justify-content','gap','padding','overflow','border-radius','opacity','mix-blend-mode','background-color','color','font-family','font-size','font-weight','letter-spacing','line-height'];

  function fdFind(id) { return document.querySelector('[data-fd-el="' + id + '"]'); }

  function fdLabel(el) {
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
    }

    if (d.cmd === 'readTree') fdTree();
    if (d.cmd === 'readArtboards') fdArtboards();
  });
})();
`
