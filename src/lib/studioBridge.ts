/**
 * The script injected into the Studio document iframe, and the message shapes
 * that cross that boundary.
 *
 * It is a string rather than a module because it executes in the iframe's own
 * realm, not the app's. Everything it sends is namespaced under `__fdCanvas`
 * so the canvas can ignore postMessage traffic from anything else.
 */

export type BridgeMessage = {
  __fdCanvas: 'bounds'
  width: number
  height: number
}

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
})();
`
