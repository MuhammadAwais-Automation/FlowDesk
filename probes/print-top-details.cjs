const fs = require('fs');
const data = JSON.parse(fs.readFileSync('probes/out/li-108-parse-search-feed-updates.json', 'utf8'));
const posts = data.result.topPosts;
posts.sort((a,b) => (b.reactions||0) - (a.reactions||0));

for (let i = 0; i < 12; i++) {
  const p = posts[i];
  const t = typeof p.text === 'object' ? p.text?.text : p.text;
  console.log(`================================================================`);
  console.log(`RANK: #${i+1}`);
  console.log(`AUTHOR: ${p.author}`);
  console.log(`HEADLINE: ${p.headline}`);
  console.log(`URL: ${p.url}`);
  console.log(`TIMEFRAME: ${p.postedAgo}`);
  console.log(`METRICS: ${p.reactions} reactions, ${p.comments} comments, ${p.shares} shares`);
  console.log(`QUERY: ${p.query}`);
  console.log(`FULL TEXT:\n${t}\n`);
}
