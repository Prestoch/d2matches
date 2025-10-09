/*
 * STRATZ Browser Fetcher - FIXED VERSION
 * Change START_INDEX, END_INDEX, and API_KEY as needed
 */

(async function() {
  const API_KEY = "YOUR_API_KEY_HERE";
  const START_INDEX = 0;
  const END_INDEX = 10000;
  const THREAD_NAME = "T1"; // Change to T2, T3
  const BATCH_SIZE = 5;
  const DELAY_MS = 1500;
  
  console.log(`🚀 ${THREAD_NAME} - Matches ${START_INDEX} to ${END_INDEX}`);
  
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
      } else { 
        cache[matchId] = {error: data.errors ? JSON.stringify(data.errors) : 'No data'}; 
        errors++; 
      }
    } catch(e) { 
      cache[matchId] = {error:e.message}; 
      errors++; 
    }
  }
  
  const matches = window.matchIds.slice(START_INDEX, END_INDEX);
  console.log(`📥 Fetching ${matches.length} matches...`);
  
  for (let i = 0; i < matches.length; i += BATCH_SIZE) {
    const batch = matches.slice(i, i+BATCH_SIZE);
    await Promise.all(batch.map(fetchMatch));
    console.log(`[${THREAD_NAME}] ${Math.min(i+BATCH_SIZE,matches.length)}/${matches.length} (${((Math.min(i+BATCH_SIZE,matches.length)/matches.length)*100).toFixed(1)}%) | ✓${fetched} ✗${errors}`);
    if (i+BATCH_SIZE < matches.length) await new Promise(r=>setTimeout(r,DELAY_MS));
  }
  
  // SAVE TO WINDOW FIRST (before clipboard)
  window.stratzCache = cache;
  console.log(`\n✅ ${THREAD_NAME} DONE! Fetched: ${fetched}, Errors: ${errors}`);
  console.log('💾 Data saved to window.stratzCache');
  
  // Try clipboard (won't break if it fails)
  try {
    await navigator.clipboard.writeText(JSON.stringify(cache,null,2));
    console.log('📋 Also copied to clipboard!');
  } catch(e) {
    console.log('⚠️ Clipboard failed (tab not focused), but data is in window.stratzCache');
    console.log('👉 Run: copy(JSON.stringify(window.stratzCache, null, 2))');
  }
})();