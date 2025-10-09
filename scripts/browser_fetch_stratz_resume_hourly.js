/*
 * STRATZ Browser Fetcher - RESUME VERSION (HOURLY LIMIT SAFE)
 * Respects 2,000 requests/hour limit
 * ~0.5 req/sec = 30 req/min = 1,800 req/hour
 */

(async function() {
  const API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJTdWJqZWN0IjoiMDM3OWE0NjQtNTE5MS00Y2E5LTlhY2QtZGUxNDZmZWU1YzNkIiwiU3RlYW1JZCI6IjEwNTA0MDg1NTMiLCJBUElVc2VyIjoidHJ1ZSIsIm5iZiI6MTc1OTg2ODc3NSwiZXhwIjoxNzkxNDA0Nzc1LCJpYXQiOjE3NTk4Njg3NzUsImlzcyI6Imh0dHBzOi8vYXBpLnN0cmF0ei5jb20ifQ.TTMK7TgoMRLAcI2ZyU1NnbXheOeDyd1Y8K-weIne5Dg";
  
  // HOURLY LIMIT SAFE: 0.5 req/sec = 1,800 req/hour (under 2,000 limit)
  const BATCH_SIZE = 1;     // 1 request at a time
  const DELAY_MS = 2000;    // 2 seconds between requests = 0.5 req/sec
  const MAX_MATCHES = 10000; // Daily limit
  
  console.log('🚀 STRATZ Resume Fetcher (HOURLY LIMIT SAFE)');
  console.log('📊 Rate: 0.5 req/sec (30/min, 1,800/hour - under 2,000 limit)');
  console.log('⏱️ Expected time for 10,000 matches: ~5.5 hours');
  
  if (!window.matchIds) {
    console.error('❌ Load match IDs first!');
    return;
  }
  
  // Load existing cache if available
  let existingCache = window.existingStratzCache || {};
  
  // IMPORTANT: Merge with current window.stratzCache if resuming mid-run
  if (window.stratzCache && Object.keys(window.stratzCache).length > Object.keys(existingCache).length) {
    console.log('🔄 Found more recent cache in window.stratzCache, using that');
    existingCache = window.stratzCache;
  }
  
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
  let rateLimitHits = 0;
  
  async function fetchMatch(matchId) {
    try {
      const response = await fetch('https://api.stratz.com/graphql', {
        method: 'POST',
        headers: {'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json'},
        body: JSON.stringify({query: `{match(id: ${matchId}) {id didRadiantWin players {heroId isRadiant position role}}}`})
      });
      
      // Check for rate limit
      if (response.status === 429) {
        rateLimitHits++;
        cache[matchId] = {error: 'Rate limited (429)'};
        errors++;
        return;
      }
      
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
    const rate = (fetched / ((Date.now() - startTime) / 1000)).toFixed(2);
    
    // Show progress every 100 matches
    if (progress % 100 === 0 || progress === toFetch.length) {
      console.log(`[${progress}/${toFetch.length}] ${percent}% | ✓${newSuccessful} ✗${errors} (429:${rateLimitHits}) | ${elapsed}min | ${rate} req/s`);
    }
    
    // Rate limiting delay
    if (i+BATCH_SIZE < toFetch.length) {
      await new Promise(r=>setTimeout(r, DELAY_MS));
    }
    
    // Auto-save every 500 matches
    if (progress % 500 === 0) {
      window.stratzCache = cache;
      console.log('💾 Auto-saved to window.stratzCache');
    }
    
    // If getting too many 429s, warn and stop
    if (rateLimitHits > 50 && rateLimitHits / progress > 0.1) {
      console.warn('⚠️ Too many rate limits! Stopping to avoid wasting quota.');
      console.warn('💡 Wait 1 hour, then resume by running this script again.');
      break;
    }
  }
  
  // Final save
  window.stratzCache = cache;
  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  
  console.log(`\n✅ DONE in ${totalTime} minutes!`);
  console.log(`📊 New successful: ${newSuccessful}`);
  console.log(`❌ New errors: ${errors} (including ${rateLimitHits} rate limits)`);
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
