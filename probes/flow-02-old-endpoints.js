// @target flow.google.com
//
// READ-ONLY. Nothing is created, changed, deleted, and no credits are spent.
//
// Question: flowBridge.ts was written against labs.google's tRPC API. Flow now
// runs on flow.google.com as an Angular/batchexecute app. Which of the old
// routes, if any, still exist on the new origin?
//
// Method: send GET to each route. tRPC answers a *mutation* reached by GET with
// 405 (method not allowed) when the route exists, and 404 when it does not — so
// this distinguishes "moved" from "still there" WITHOUT invoking the mutation.
// createProject is a mutation; a GET cannot create anything.
//
// Anything returning 200/405 is alive and worth re-testing properly. 404 means
// the tool built on it is dead and needs a fresh capture.

var routes = [
  // Used by flowCreateProject
  '/fx/api/trpc/project.createProject',
  // Used by fetchMediaBytes (download + view image)
  '/fx/api/trpc/media.getMediaUrlRedirect',
  // The old project list, replaced by the UpteDb batchexecute call
  '/fx/api/trpc/project.listProjects',
  // Sanity control: a route that certainly does not exist. If this comes back
  // anything other than 404, the 404/405 signal means nothing on this host and
  // the whole probe's reasoning is void.
  '/fx/api/trpc/flowdesk.thisRouteIsNotReal',
]

var results = []
for (var i = 0; i < routes.length; i++) {
  var route = routes[i]
  try {
    var res = await fetch(route, { method: 'GET', credentials: 'include' })
    var body = await res.text()
    results.push({
      route: route,
      status: res.status,
      // First bytes only: enough to tell an HTML error page from a tRPC error
      // envelope, without dragging a whole document back across the bridge.
      bodyStart: body.slice(0, 120),
    })
  } catch (e) {
    results.push({ route: route, status: 'threw', bodyStart: String((e && e.message) || e).slice(0, 120) })
  }
}

return {
  origin: location.origin,
  note: '404 on every route including the control means the signal is usable; 404 only on real routes means they are gone',
  results: results,
}
