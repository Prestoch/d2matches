/*
 * STRATZ Browser Fetcher - THREAD 1 (SLOWER)
 * Matches: 0 - 10,000
 */

(async function() {
  const API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJTdWJqZWN0IjoiMDM3OWE0NjQtNTE5MS00Y2E5LTlhY2QtZGUxNDZmZWU1YzNkIiwiU3RlYW1JZCI6IjEwNTA0MDg1NTMiLCJBUElVc2VyIjoidHJ1ZSIsIm5iZiI6MTc1OTg2MTk5OCwiZXhwIjoxNzkxMzk3OTk4LCJpYXQiOjE3NTk4NjE5OTgsImlzcyI6Imh0dHBzOi8vYXBpLnN0cmF0ei5jb20ifQ.EChu3KCuD6FKuf_vTE7nRS_LpnfZfl36JqIh5s7gHxQ";
  const START_INDEX = 0;
  const END_INDEX = 10000;
  const BATCH_SIZE = 5;  // Smaller batches
  const DELAY_MS = 1500; // Slower delay = ~3 req/sec per thread
  
  console.log('🚀 THREAD 1 - Matches 0 to 10,000 (SLOW MODE)');
  
  if (!window.matchIds) {
    console.error('❌ First load match IDs!');
    return;
  }
  
  const cache = {};
  let fetched = 0, errors = 0;
  
  async function fetchMatch(matchId) {
    try {
      const response = await fetch('https://api.stratz.com/graphql', {
        method: 'POST',
        headers: {'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json'},
        body: JSON.stringify({query: `{match(id: ${matchId}) {id didRadiantWin players {heroId isRadiant position role}}}`})
      });
      const data = await response.json();
      if (data.data?.match) {
        const m = data.data.match;
        const posMap = {'POSITION_1':'carry','POSITION_2':'mid','POSITION_3':'offlane','POSITION_4':'softsupport','POSITION_5':'hardsupport'};
        cache[matchId] = {
          radiantWin: m.didRadiantWin,
          radiantRoles: m.players.filter(p=>p.isRadiant).map(p=>({heroId:p.heroId,role:posMap[p.position]})),
          direRoles: m.players.filter(p=>!p.isRadiant).map(p=>({heroId:p.heroId,role:posMap[p.position]}))
        };
        fetched++;
      } else { cache[matchId] = {error:'No data'}; errors++; }
    } catch(e) { cache[matchId] = {error:e.message}; errors++; }
  }
  
  const matches = window.matchIds.slice(START_INDEX, END_INDEX);
  console.log(`📥 Fetching ${matches.length} matches...`);
  
  for (let i = 0; i < matches.length; i += BATCH_SIZE) {
    const batch = matches.slice(i, i+BATCH_SIZE);
    await Promise.all(batch.map(fetchMatch));
    console.log(`[T1] ${Math.min(i+BATCH_SIZE,matches.length)}/${matches.length} (${((Math.min(i+BATCH_SIZE,matches.length)/matches.length)*100).toFixed(1)}%) | ✓${fetched} ✗${errors}`);
    if (i+BATCH_SIZE < matches.length) await new Promise(r=>setTimeout(r,DELAY_MS));
  }
  
  console.log(`\n✅ THREAD 1 DONE! Fetched: ${fetched}, Errors: ${errors}`);
  await navigator.clipboard.writeText(JSON.stringify(cache,null,2));
  console.log('📋 Copied to clipboard! Save as: stratz_thread1_cache.json');
  window.stratzCacheT1 = cache;
})();