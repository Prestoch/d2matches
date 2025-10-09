/*
 * STRATZ 10-Thread Fetcher - NO CACHE PRELOAD VERSION
 * Loads cache from localStorage or starts fresh
 * Avoids console crashes from large cache pastes
 * 
 * INSTRUCTIONS:
 * 1. Change THREAD_NUMBER to 1, 2, 3, ... 10
 * 2. Change API_KEY to your unique key
 * 3. Make sure matchIds are loaded: window.matchIds
 */

(async function() {
  // ========== EDIT THESE ==========
  const THREAD_NUMBER = 1;
  const API_KEY = "PASTE_YOUR_API_KEY_HERE";
  // ================================
  
  const TOTAL_THREADS = 10;
  const THREAD_NAME = `T${THREAD_NUMBER}`;
  const BATCH_SIZE = 1;
  const DELAY_MS = 2000;
  const MAX_PER_THREAD = 10000;
  
  console.log(`🚀 ${THREAD_NAME} - Thread ${THREAD_NUMBER} of ${TOTAL_THREADS}`);
  
  if (!window.matchIds) {
    console.error('❌ Load match IDs first!');
    console.log('👉 Run: fetch("http://localhost:8888/match_ids_only.txt").then(r=>r.text()).then(t=>{window.matchIds=t.trim().split("\\n");console.log("✅",window.matchIds.length)})');
    return;
  }
  
  // Try to load cache from localStorage or window
  let existingCache = {};
  
  console.log('📥 Looking for existing cache...');
  
  // Option 1: Check localStorage
  try {
    const stored = localStorage.getItem('stratzMergedCache');
    if (stored) {
      existingCache = JSON.parse(stored);
      console.log(`💾 Loaded from localStorage: ${Object.keys(existingCache).length} matches`);
    }
  } catch(e) {
    console.log('⚠️ localStorage empty or too large');
  }
  
  // Option 2: Check window variable
  if (Object.keys(existingCache).length === 0 && window.existingStratzCache) {
    existingCache = window.existingStratzCache;
    console.log(`💾 Loaded from window: ${Object.keys(existingCache).length} matches`);
  }
  
  // Option 3: Check merged cache
  if (Object.keys(existingCache).length === 0 && window.mergedStratzCache) {
    existingCache = window.mergedStratzCache;
    console.log(`💾 Loaded from mergedStratzCache: ${Object.keys(existingCache).length} matches`);
  }
  
  // Option 4: Try to fetch from local server
  if (Object.keys(existingCache).length === 0) {
    console.log('🌐 Attempting to fetch from localhost:8888...');
    try {
      const response = await fetch('http://localhost:8888/stratz_100k_merged.json');
      existingCache = await response.json();
      console.log(`💾 Loaded from file: ${Object.keys(existingCache).length} matches`);
    } catch(e) {
      console.log('⚠️ Could not fetch from localhost (CORS or file not found)');
    }
  }
  
  const existingCount = Object.keys(existingCache).length;
  
  if (existingCount === 0) {
    console.log('📝 Starting fresh (no existing cache found)');
  }
  
  const successfulMatches = Object.entries(existingCache).filter(([k,v]) => !v.error).length;
  const errorMatches = existingCount - successfulMatches;
  
  console.log(`📊 Cache stats: ${existingCount} total (✓${successfulMatches}, ✗${errorMatches})`);
  
  // Find missing/error matches
  const allMatchIds = window.matchIds;
  const allMissing = allMatchIds.filter(id => {
    const cached = existingCache[id];
    return !cached || cached.error;
  });
  
  console.log(`📋 Total matches: ${allMatchIds.length}`);
  console.log(`✅ Successfully cached: ${successfulMatches}`);
  console.log(`⏳ Missing/Error: ${allMissing.length}`);
  
  // Divide into chunks
  const chunkSize = Math.ceil(allMissing.length / TOTAL_THREADS);
  const startIdx = (THREAD_NUMBER - 1) * chunkSize;
  const endIdx = Math.min(startIdx + chunkSize, allMissing.length);
  const myMatches = allMissing.slice(startIdx, endIdx);
  const toFetch = myMatches.slice(0, MAX_PER_THREAD);
  
  console.log(`🎯 ${THREAD_NAME} range: ${startIdx} to ${endIdx} (${myMatches.length} matches)`);
  console.log(`📍 Will fetch: ${toFetch.length}`);
  
  if (toFetch.length === 0) {
    console.log('✅ Nothing to fetch!');
    return;
  }
  
  if (toFetch.length > 0) {
    console.log(`📍 First: ${toFetch[0]}, Last: ${toFetch[toFetch.length-1]}`);
  }
  
  const cache = {...existingCache};
  let fetched = 0, errors = 0, newSuccessful = 0, rateLimitHits = 0, retries = 0;
  
  async function fetchMatch(matchId) {
    if (existingCache[matchId]?.error) retries++;
    
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
  
  console.log(`\n📥 [${THREAD_NAME}] Starting...`);
  const startTime = Date.now();
  
  for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
    await Promise.all(toFetch.slice(i, i+BATCH_SIZE).map(fetchMatch));
    
    const progress = Math.min(i+BATCH_SIZE, toFetch.length);
    const percent = ((progress / toFetch.length) * 100).toFixed(1);
    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    const rate = (fetched / ((Date.now() - startTime) / 1000)).toFixed(2);
    
    if (progress % 50 === 0 || progress === toFetch.length) {
      console.log(`[${THREAD_NAME}] ${progress}/${toFetch.length} (${percent}%) | ✓${newSuccessful} ✗${errors} (429:${rateLimitHits}) | ${elapsed}min`);
    }
    
    if (i+BATCH_SIZE < toFetch.length) {
      await new Promise(r=>setTimeout(r, DELAY_MS));
    }
    
    if (progress % 200 === 0) {
      window[`stratzCacheT${THREAD_NUMBER}`] = cache;
    }
    
    if (rateLimitHits > 50 && rateLimitHits / progress > 0.1) {
      console.warn(`⚠️ [${THREAD_NAME}] Too many 429s!`);
      break;
    }
  }
  
  window[`stratzCacheT${THREAD_NUMBER}`] = cache;
  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  
  console.log(`\n✅ [${THREAD_NAME}] DONE in ${totalTime} min!`);
  console.log(`📊 New successful: ${newSuccessful}`);
  console.log(`❌ Errors: ${errors}`);
  console.log(`💾 Total: ${Object.keys(cache).length}`);
  console.log(`\n👉 copy(JSON.stringify(window.stratzCacheT${THREAD_NUMBER}, null, 2))`);
  
  // Try to save to localStorage for next run
  try {
    localStorage.setItem('stratzMergedCache', JSON.stringify(cache));
    console.log('💾 Saved to localStorage for next run');
  } catch(e) {
    console.log('⚠️ localStorage full, manual save needed');
  }
})();
