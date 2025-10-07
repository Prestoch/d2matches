/*
 * STRATZ Browser Fetcher
 * 
 * INSTRUCTIONS:
 * 1. Open https://stratz.com in your browser
 * 2. Open Developer Tools (F12)
 * 3. Go to Console tab
 * 4. Copy and paste this ENTIRE script
 * 5. Press Enter to run
 * 6. Wait for it to finish (shows progress)
 * 7. Copy the final JSON output and save it
 */

(async function() {
  const API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJTdWJqZWN0IjoiMDM3OWE0NjQtNTE5MS00Y2E5LTlhY2QtZGUxNDZmZWU1YzNkIiwiU3RlYW1JZCI6IjEwNTA0MDg1NTMiLCJBUElVc2VyIjoidHJ1ZSIsIm5iZiI6MTc1OTg2MTk5OCwiZXhwIjoxNzkxMzk3OTk4LCJpYXQiOjE3NTk4NjE5OTgsImlzcyI6Imh0dHBzOi8vYXBpLnN0cmF0ei5jb20ifQ.EChu3KCuD6FKuf_vTE7nRS_LpnfZfl36JqIh5s7gHxQ";
  
  // Match range to fetch (adjust as needed)
  const START_INDEX = 0;
  const END_INDEX = 10000; // First 10,000 matches
  const BATCH_SIZE = 20;
  const DELAY_MS = 250; // 4 requests/sec = 240/min (under 250/min limit)
  
  console.log('🚀 Starting Stratz fetch...');
  console.log(`📊 Will fetch matches ${START_INDEX} to ${END_INDEX}`);
  
  // Load match IDs from a global variable (you'll need to set this)
  // For now, we'll need to get the CSV data first
  console.log('⚠️  IMPORTANT: First run this to load match IDs:');
  console.log(`
    fetch('/path/to/matches_detailed.csv')
      .then(r => r.text())
      .then(csv => {
        window.matchIds = csv.split('\\n').slice(1).map(line => line.split(',')[0]);
        console.log('✅ Loaded', window.matchIds.length, 'match IDs');
      });
  `);
  
  if (!window.matchIds) {
    console.error('❌ No match IDs loaded! Please load them first (see instructions above)');
    return;
  }
  
  const cache = {};
  let fetched = 0;
  let errors = 0;
  
  async function fetchMatch(matchId) {
    try {
      const response = await fetch('https://api.stratz.com/graphql', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: `{
            match(id: ${matchId}) {
              id
              didRadiantWin
              players {
                heroId
                isRadiant
                position
                role
              }
            }
          }`
        })
      });
      
      const data = await response.json();
      
      if (data.data && data.data.match) {
        const match = data.data.match;
        const radiantPlayers = match.players.filter(p => p.isRadiant);
        const direPlayers = match.players.filter(p => !p.isRadiant);
        
        const positionMap = {
          'POSITION_1': 'carry',
          'POSITION_2': 'mid',
          'POSITION_3': 'offlane',
          'POSITION_4': 'softsupport',
          'POSITION_5': 'hardsupport'
        };
        
        cache[matchId] = {
          radiantWin: match.didRadiantWin,
          radiantRoles: radiantPlayers.map(p => ({
            heroId: p.heroId,
            role: positionMap[p.position] || null
          })),
          direRoles: direPlayers.map(p => ({
            heroId: p.heroId,
            role: positionMap[p.position] || null
          }))
        };
        
        fetched++;
        return true;
      } else {
        cache[matchId] = { error: 'No match data' };
        errors++;
        return false;
      }
    } catch (err) {
      cache[matchId] = { error: err.message };
      errors++;
      return false;
    }
  }
  
  const matchesToFetch = window.matchIds.slice(START_INDEX, END_INDEX);
  const total = matchesToFetch.length;
  
  console.log(`\n📥 Fetching ${total} matches...`);
  
  for (let i = 0; i < matchesToFetch.length; i += BATCH_SIZE) {
    const batch = matchesToFetch.slice(i, i + BATCH_SIZE);
    
    await Promise.all(batch.map(id => fetchMatch(id)));
    
    const progress = Math.min(i + BATCH_SIZE, total);
    const percent = ((progress / total) * 100).toFixed(1);
    
    console.log(`Progress: ${progress}/${total} (${percent}%) | Fetched: ${fetched} | Errors: ${errors}`);
    
    // Rate limiting delay
    if (i + BATCH_SIZE < matchesToFetch.length) {
      await new Promise(resolve => setTimeout(resolve, DELAY_MS * BATCH_SIZE));
    }
  }
  
  console.log('\n✅ COMPLETE!');
  console.log(`✓ Fetched: ${fetched}`);
  console.log(`✗ Errors: ${errors}`);
  console.log('\n📋 Copy the JSON below and save it as stratz_browser_cache.json:\n');
  console.log(JSON.stringify(cache, null, 2));
  
  // Also save to clipboard if available
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(JSON.stringify(cache, null, 2));
    console.log('\n✅ Also copied to clipboard!');
  }
  
  window.stratzCache = cache;
  console.log('\n💾 Data also saved to window.stratzCache');
})();
