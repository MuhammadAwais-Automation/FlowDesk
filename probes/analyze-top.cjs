const fs = require('fs');
const data = JSON.parse(fs.readFileSync('probes/out/li-108-parse-search-feed-updates.json', 'utf8'));
const posts = data.result.topPosts;
posts.sort((a,b) => (b.reactions||0) - (a.reactions||0));
for (let i = 0; i < Math.min(20, posts.length); i++) {
  const p = posts[i];
  const t = typeof p.text === 'object' ? p.text?.text : p.text;
  console.log(`[#${i+1}] ${p.author} | Query: ${p.query} | Time: ${p.postedAgo} | Reactions: ${p.reactions} | Comments: ${p.comments} | Shares: ${p.shares}`);
  console.log('URL: ' + p.url);
  console.log('Headline: ' + p.headline);
  console.log('Hook: ' + JSON.stringify((t||'').slice(0, 180)));
  console.log('');
}
