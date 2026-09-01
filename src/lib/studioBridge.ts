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

export function isBridgeMessage(data: unknown): data is BridgeMessage {
  return typeof data === 'object' && data !== null && '__fdCanvas' in data
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
})();
`
