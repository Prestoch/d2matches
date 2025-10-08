/*
 * STRATZ Browser Fetcher - RESUME VERSION
 * Only fetches matches NOT in existing cache
 * Paste your existing cache first, then run this
 */

(async function() {
  const API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJTdWJqZWN0IjoiMDM3OWE0NjQtNTE5MS00Y2E5LTlhY2QtZGUxNDZmZWU1YzNkIiwiU3RlYW1JZCI6IjEwNTA0MDg1NTMiLCJBUElVc2VyIjoidHJ1ZSIsIm5iZiI6MTc1OTg2ODc3NSwiZXhwIjoxNzkxNDA0Nzc1LCJpYXQiOjE3NTk4Njg3NzUsImlzcyI6Imh0dHBzOi8vYXBpLnN0cmF0ei5jb20ifQ.TTMK7TgoMRLAcI2ZyU1NnbXheOeDyd1Y8K-weIne5Dg";
  
  // Rate limits: 20/sec, 250/min, 2000/hr, 10000/day
  const BATCH_SIZE = 3;     // 3 concurrent requests
  const DELAY_MS = 1000;    // 1 second between batches = 3 req/sec (180/min, well under 250/min)
  const MAX_MATCHES = 10000; // Daily limit
  
  console.log('🚀 STRATZ Resume Fetcher');
  console.log('📊 Rate: ~3 req/sec (180/min, under 250 limit)');
  
  if (!window.matchIds) {
    console.error('❌ Load match IDs first!');
    return;
  }
  
  // Load existing cache if available
  let existingCache = window.existingStratzCache || {};
  const existingCount = Object.keys(existingCache).length;
  console.log(`💾 Existing cache: ${existingCount} matches`);
  
  // Find matches to fetch
  const allMatchIds = window.matchIds;
  const missingMatches = allMatchIds.filter(id => !existingCache[id]);
  
  console.log(`📋 Total matches in CSV: ${allMatchIds.length}`);
  console.log(`✅ Already cached: ${existingCount}`);
  console.log(`⏳ Missing: ${missingMatches.length}`);
  
  // Limit to daily quota
  const toFetch = missingMatches.slice(0, MAX_MATCHES);
  console.log(`🎯 Will fetch: ${toFetch.length} (respecting daily limit)`);
  
  if (toFetch.length === 0) {
    console.log('✅ All matches already cached!');
    return;
  }
  
  const cache = {...existingCache}; // Start with existing
  let fetched = 0, errors = 0, newSuccessful = 0;
  
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
        newSuccessful++;
        fetched++;
      } else { 
        const errorMsg = data.errors ? JSON.stringify(data.errors) : (data.error || 'No data');
        cache[matchId] = {error: errorMsg}; 
        errors++; 
      }
    } catch(e) { 
      cache[matchId] = {error: e.message}; 
      errors++; 
    }
  }
  
  console.log(`\n📥 Starting fetch...`);
  const startTime = Date.now();
  
  for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
    const batch = toFetch.slice(i, i+BATCH_SIZE);
    await Promise.all(batch.map(fetchMatch));
    
    const progress = Math.min(i+BATCH_SIZE, toFetch.length);
    const percent = ((progress / toFetch.length) * 100).toFixed(1);
    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    const rate = (fetched / ((Date.now() - startTime) / 1000)).toFixed(1);
    
    console.log(`[${progress}/${toFetch.length}] ${percent}% | ✓${newSuccessful} ✗${errors} | ${elapsed}min | ${rate} req/s`);
    
    // Rate limiting delay
    if (i+BATCH_SIZE < toFetch.length) {
      await new Promise(r=>setTimeout(r, DELAY_MS));
    }
    
    // Auto-save every 1000 matches
    if (progress % 1000 === 0) {
      window.stratzCache = cache;
      console.log('💾 Auto-saved to window.stratzCache');
    }
  }
  
  // Final save
  window.stratzCache = cache;
  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  
  console.log(`\n✅ DONE in ${totalTime} minutes!`);
  console.log(`📊 New successful: ${newSuccessful}`);
  console.log(`❌ New errors: ${errors}`);
  console.log(`💾 Total in cache: ${Object.keys(cache).length}`);
  console.log(`\n👉 To copy: copy(JSON.stringify(window.stratzCache, null, 2))`);
  
  // Try clipboard
  try {
    await navigator.clipboard.writeText(JSON.stringify(cache, null, 2));
    console.log('📋 Also copied to clipboard!');
  } catch(e) {
    console.log('⚠️ Clipboard failed, use copy command above');
  }
})();
