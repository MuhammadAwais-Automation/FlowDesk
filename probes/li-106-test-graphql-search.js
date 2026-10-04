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
    const text = await res.text()
    try {
      return { status: res.status, json: JSON.parse(text) }
    } catch (e) {
      return { status: res.status, text: text.slice(0, 300) }
    }
  }

  const queries = [
    // 1. resultType: CONTENT
    '(start:0,origin:FACETED_SEARCH,query:(keywords:AI%20Agents,flagshipSearchIntent:SEARCH_SRP,queryParameters:List((key:resultType,value:List(CONTENT)))))',
    // 2. with datePosted
    '(start:0,origin:FACETED_SEARCH,query:(keywords:AI%20Agents,flagshipSearchIntent:SEARCH_SRP,queryParameters:List((key:resultType,value:List(CONTENT)),(key:datePosted,value:List(past-24h)))))',
    // 3. clusters query without queryParameters
    '(start:0,origin:GLOBAL_SEARCH_HEADER,query:(keywords:AI%20Agents,flagshipSearchIntent:SEARCH_SRP))'
  ]

  const results = {}
  const Q_SEARCH = "voyagerSearchDashClusters.a7a0567fa66c52d645b5ff2f960b92aa"
  
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i]
    const url = '/voyager/api/graphql?includeWebMetadata=true&variables=' + q + '&queryId=' + Q_SEARCH
    const r = await api(url)
    results['q' + i] = {
      status: r.status,
      keys: r.json ? Object.keys(r.json) : null,
      dataKeys: r.json?.data ? Object.keys(r.json.data) : null,
      elementsCount: r.json?.data?.searchDashClustersByAll?.elements?.length ?? null,
      clusters: (r.json?.data?.searchDashClustersByAll?.elements || []).map(c => ({
        title: c.title,
        total: c.totalResultCount,
        itemCount: c.items?.length
      }))
    }
  }

  return results
})()
