const fs = require('fs');
const data = JSON.parse(fs.readFileSync('probes/out/li-108-parse-search-feed-updates.json', 'utf8'));
const res = data.result;
console.log('Total extracted:', res.totalExtracted, 'Unique:', res.uniqueCount);
res.topPosts.forEach((p, idx) => {
  const t = typeof p.text === 'object' ? p.text?.text : p.text;
  console.log(`\n------------------------------------------------------------`);
  console.log(`[${idx + 1}] Author: ${p.author} | Headline: ${p.headline}`);
  console.log(`Query: ${p.query} | Time: ${p.postedAgo} | URL: ${p.url}`);
  console.log(`Reactions: ${p.reactions} | Comments: ${p.comments} | Shares: ${p.shares}`);
  console.log(`Full Text:\n${t}`);
});
