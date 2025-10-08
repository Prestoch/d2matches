/*
 * STRATZ 10-Thread Fetcher - AUTO RETRY VERSION
 * Automatically re-fetches matches that had errors
 * 
 * INSTRUCTIONS:
 * 1. Change THREAD_NUMBER to 1, 2, 3, ... 10 (one per tab)
 * 2. Change API_KEY to your unique key for that thread
 * 3. Make sure all tabs have loaded existingStratzCache and matchIds first!
 */

(async function() {
  // ========== EDIT THESE TWO LINES ==========
  const THREAD_NUMBER = 1;  // Change to 1, 2, 3, ... 10
  const API_KEY = "PASTE_YOUR_API_KEY_HERE";
  // ==========================================
  
  const TOTAL_THREADS = 10;
  const THREAD_NAME = `T${THREAD_NUMBER}`;
  
  // Rate: 0.5 req/sec = 1,800/hour (under 2,000 limit)
  const BATCH_SIZE = 1;
  const DELAY_MS = 2000;
  const MAX_PER_THREAD = 10000; // Each thread fetches up to 10,000
  
  console.log(`🚀 ${THREAD_NAME} - Thread ${THREAD_NUMBER} of ${TOTAL_THREADS} (AUTO-RETRY)`);
  console.log('📊 Rate: 0.5 req/sec (1,800/hour)');
  
  if (!window.matchIds) {
    console.error('❌ Load match IDs first!');
    return;
  }
  
  if (!window.existingStratzCache) {
    console.error('❌ Load existing cache first!');
    return;
  }
  
  const existingCache = window.existingStratzCache;
  const existingCount = Object.keys(existingCache).length;
  
  // Count successful vs errors
  const successfulMatches = Object.entries(existingCache).filter(([k,v]) => !v.error).length;
  const errorMatches = existingCount - successfulMatches;
  
  console.log(`💾 Existing cache: ${existingCount} total (✓${successfulMatches}, ✗${errorMatches})`);
  
  // Find missing matches: those NOT in cache OR those with errors
  const allMatchIds = window.matchIds;
  const allMissing = allMatchIds.filter(id => {
    const cached = existingCache[id];
    return !cached || cached.error;  // ← KEY CHANGE: Treat errors as missing!
  });
  
  console.log(`📋 Total matches: ${allMatchIds.length}`);
  console.log(`✅ Successfully cached: ${successfulMatches}`);
  console.log(`⏳ Missing/Error (will fetch): ${allMissing.length}`);
  
  // Divide missing matches into 10 parts
  const chunkSize = Math.ceil(allMissing.length / TOTAL_THREADS);
  const startIdx = (THREAD_NUMBER - 1) * chunkSize;
  const endIdx = Math.min(startIdx + chunkSize, allMissing.length);
  const myMatches = allMissing.slice(startIdx, endIdx);
  const toFetch = myMatches.slice(0, MAX_PER_THREAD);
  
  console.log(`🎯 ${THREAD_NAME} range: ${startIdx} to ${endIdx} (${myMatches.length} matches)`);
  console.log(`📍 Will fetch: ${toFetch.length} (respecting daily limit)`);
  if (toFetch.length > 0) {
    console.log(`📍 First match ID: ${toFetch[0]}`);
    console.log(`📍 Last match ID: ${toFetch[toFetch.length-1]}`);
  }
  
  if (toFetch.length === 0) {
    console.log('✅ Nothing to fetch!');
    return;
  }
  
  const cache = {...existingCache};
  let fetched = 0, errors = 0, newSuccessful = 0, rateLimitHits = 0, retries = 0;
  
  async function fetchMatch(matchId) {
    // Check if this is a retry
    if (existingCache[matchId]?.error) {
      retries++;
    }
    
    try {
      const response = await fetch('https://api.stratz.com/graphql', {
        method: 'POST',
        headers: {'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json'},
        body: JSON.stringify({query: `{match(id: ${matchId}) {id didRadiantWin players {heroId isRadiant position role}}}`})
      });
      
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
  
  console.log(`\n📥 [${THREAD_NAME}] Starting fetch...`);
  const startTime = Date.now();
  
  for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
    const batch = toFetch.slice(i, i+BATCH_SIZE);
    await Promise.all(batch.map(fetchMatch));
    
    const progress = Math.min(i+BATCH_SIZE, toFetch.length);
    const percent = ((progress / toFetch.length) * 100).toFixed(1);
    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    const rate = (fetched / ((Date.now() - startTime) / 1000)).toFixed(2);
    
    if (progress % 50 === 0 || progress === toFetch.length) {
      console.log(`[${THREAD_NAME}] ${progress}/${toFetch.length} (${percent}%) | ✓${newSuccessful} ✗${errors} (429:${rateLimitHits}, retry:${retries}) | ${elapsed}min | ${rate} req/s`);
    }
    
    if (i+BATCH_SIZE < toFetch.length) {
      await new Promise(r=>setTimeout(r, DELAY_MS));
    }
    
    if (progress % 200 === 0) {
      window[`stratzCacheT${THREAD_NUMBER}`] = cache;
      console.log(`💾 [${THREAD_NAME}] Auto-saved to window.stratzCacheT${THREAD_NUMBER}`);
    }
    
    if (rateLimitHits > 50 && rateLimitHits / progress > 0.1) {
      console.warn(`⚠️ [${THREAD_NAME}] Too many 429s! Stopping.`);
      break;
    }
  }
  
  window[`stratzCacheT${THREAD_NUMBER}`] = cache;
  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  
  console.log(`\n✅ [${THREAD_NAME}] DONE in ${totalTime} minutes!`);
  console.log(`📊 New successful: ${newSuccessful}`);
  console.log(`🔄 Retried errors: ${retries}`);
  console.log(`❌ New errors: ${errors} (429s: ${rateLimitHits})`);
  console.log(`💾 Total: ${Object.keys(cache).length}`);
  console.log(`\n👉 To copy: copy(JSON.stringify(window.stratzCacheT${THREAD_NUMBER}, null, 2))`);
  
  try {
    await navigator.clipboard.writeText(JSON.stringify(cache, null, 2));
    console.log('📋 Copied!');
  } catch(e) {
    console.log('⚠️ Use copy command above');
  }
})();
