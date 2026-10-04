// @target linkedin.com
// @timeout 30000

return await (async function () {
  function csrf() {
    var m = document.cookie.match(/JSESSIONID="?([^";]+)"?/)
    return m ? m[1] : null
  }

  async function api(url) {
    const res = await fetch(url, {
      headers: {
        'csrf-token': csrf(),
        'accept': 'application/json',
        'x-restli-protocol-version': '2.0.0',
        'x-li-lang': 'en_US'
      }
    })
    return await res.json()
  }

  const Q_SEARCH = "voyagerSearchDashClusters.a7a0567fa66c52d645b5ff2f960b92aa"
  const q0 = '(start:0,origin:FACETED_SEARCH,query:(keywords:AI%20Agents,flagshipSearchIntent:SEARCH_SRP,queryParameters:List((key:resultType,value:List(CONTENT)))))'
  const url = '/voyager/api/graphql?includeWebMetadata=true&variables=' + q0 + '&queryId=' + Q_SEARCH

  const json = await api(url)
  const clusters = json?.data?.searchDashClustersByAll?.elements || []
  
  // Find cluster with items
  const postCluster = clusters.find(c => c.items && c.items.length >= 5) || clusters[1]
  const sampleItems = (postCluster?.items || []).slice(0, 3)

  return {
    clustersCount: clusters.length,
    postClusterItemsCount: postCluster?.items?.length,
    sampleItems
  }
})()
