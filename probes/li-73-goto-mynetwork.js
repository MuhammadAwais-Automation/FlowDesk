// @target linkedin.com
// Navigation only. The queryId sweep reads whatever bundles the CURRENT page
// loaded, and the feed does not load the invitations client — which is why the
// invitations bucket came back empty there. That is not evidence they do not
// exist, so the page that owns them is loaded first.
var T = 'https://www.linkedin.com/mynetwork/'
location.href = T
return { to: T }
