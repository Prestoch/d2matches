/*
 * STRATZ Browser Fetcher - THREAD 3
 * Matches: 20,000 - 30,000
 * API Key: ...3rU (Account 3)
 */

(async function() {
  const API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJTdWJqZWN0IjoiMWEyOWZjYjUtM2NiMi00NWE4LTllMWEtZjA4YjhjYjkyM2I4IiwiU3RlYW1JZCI6IjEyNjMzNTQxNyIsIkFQSVVzZXIiOiJ0cnVlIiwibmJmIjoxNzU5ODY0NTY2LCJleHAiOjE3OTE0MDA1NjYsImlhdCI6MTc1OTg2NDU2NiwiaXNzIjoiaHR0cHM6Ly9hcGkuc3RyYXR6LmNvbSJ9.WCbIYYrBR-ehGCe4ZFgQDW7HoKav3g02wl4WVdPE3rU";
  const START_INDEX = 20000;
  const END_INDEX = 30000;
  const BATCH_SIZE = 20;
  const DELAY_MS = 250;
  
  console.log('🚀 THREAD 3 - Matches 20,000 to 30,000');
  
  if (!window.matchIds) {
    console.error('❌ First load match IDs! Run:\nfetch("http://localhost:8888/out/matches_detailed.csv").then(r=>r.text()).then(csv=>{window.matchIds=csv.split("\\n").slice(1).map(l=>l.split(",")[0]);console.log("✅",window.matchIds.length,"IDs loaded")})');
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
    await Promise.all(matches.slice(i, i+BATCH_SIZE).map(fetchMatch));
    console.log(`[T3] ${Math.min(i+BATCH_SIZE,matches.length)}/${matches.length} (${((Math.min(i+BATCH_SIZE,matches.length)/matches.length)*100).toFixed(1)}%) | ✓${fetched} ✗${errors}`);
    if (i+BATCH_SIZE < matches.length) await new Promise(r=>setTimeout(r,DELAY_MS*BATCH_SIZE));
  }
  
  console.log(`\n✅ THREAD 3 DONE! Fetched: ${fetched}, Errors: ${errors}`);
  const json = JSON.stringify(cache,null,2);
  await navigator.clipboard.writeText(json);
  console.log('📋 Copied to clipboard! Save as: stratz_thread3_cache.json');
  window.stratzCacheT3 = cache;
})();
