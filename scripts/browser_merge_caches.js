/*
 * Browser-based Cache Merger
 * Merges multiple Stratz cache files and shows statistics
 * 
 * USAGE:
 * 1. Open any webpage (even a blank tab)
 * 2. Open console (F12)
 * 3. Paste this entire script
 * 4. Follow the prompts to paste each cache file
 */

(async function() {
  console.log('🔄 Stratz Cache Merger\n');
  console.log('Paste your cache files below when prompted...\n');
  
  // Prompt for number of caches to merge
  const numCaches = parseInt(prompt('How many cache files do you want to merge? (e.g., 5)'));
  
  if (!numCaches || numCaches < 1) {
    console.error('❌ Invalid number!');
    return;
  }
  
  const caches = [];
  
  // Collect all caches
  for (let i = 1; i <= numCaches; i++) {
    console.log(`\n📥 Preparing to load Cache ${i}/${numCaches}...`);
    console.log(`👉 Paste the contents of thread${i}.json below:`);
    
    const input = prompt(`Paste Cache ${i} JSON (or type 'window.stratzCacheT${i}' if still in memory):`);
    
    if (!input) {
      console.warn(`⚠️ Skipping Cache ${i} (empty)`);
      continue;
    }
    
    try {
      let cache;
      
      // Check if user wants to use window variable
      if (input.trim().startsWith('window.stratzCache')) {
        const varName = input.trim();
        cache = eval(varName);
        if (!cache) {
          console.error(`❌ ${varName} is not defined!`);
          continue;
        }
      } else {
        cache = JSON.parse(input);
      }
      
      const total = Object.keys(cache).length;
      const errors = Object.entries(cache).filter(([k,v]) => v.error).length;
      const successful = total - errors;
      
      console.log(`✅ Cache ${i}: ${total} total (✓${successful}, ✗${errors})`);
      caches.push(cache);
      
    } catch(e) {
      console.error(`❌ Cache ${i} failed to parse:`, e.message);
    }
  }
  
  if (caches.length === 0) {
    console.error('❌ No valid caches to merge!');
    return;
  }
  
  // Merge all caches
  console.log('\n🔄 Merging caches...');
  const merged = {};
  let successCount = 0;
  let errorCount = 0;
  let duplicates = 0;
  
  for (const cache of caches) {
    for (const [matchId, data] of Object.entries(cache)) {
      if (merged[matchId]) {
        duplicates++;
        // If duplicate, prefer successful data over errors
        if (!data.error && merged[matchId].error) {
          merged[matchId] = data;
        }
      } else {
        merged[matchId] = data;
      }
      
      if (data.error) {
        errorCount++;
      } else {
        successCount++;
      }
    }
  }
  
  // Final count (after deduplication)
  const finalErrors = Object.entries(merged).filter(([k,v]) => v.error).length;
  const finalSuccess = Object.keys(merged).length - finalErrors;
  
  console.log('\n✅ MERGE COMPLETE!\n');
  console.log('📊 Statistics:');
  console.log('─'.repeat(50));
  console.log(`Total caches merged: ${caches.length}`);
  console.log(`Duplicates found: ${duplicates}`);
  console.log(`\nFinal merged cache:`);
  console.log(`  Total matches: ${Object.keys(merged).length}`);
  console.log(`  ✓ Successful: ${finalSuccess}`);
  console.log(`  ✗ Errors: ${finalErrors}`);
  console.log('─'.repeat(50));
  
  // Show sample errors if any
  if (finalErrors > 0) {
    console.log('\n⚠️ Sample errors:');
    const errorSamples = Object.entries(merged)
      .filter(([k,v]) => v.error)
      .slice(0, 5);
    
    errorSamples.forEach(([id, data]) => {
      console.log(`  Match ${id}: ${data.error}`);
    });
  }
  
  // Save to window
  window.mergedStratzCache = merged;
  console.log('\n💾 Merged cache saved to: window.mergedStratzCache');
  console.log('👉 To copy: copy(JSON.stringify(window.mergedStratzCache, null, 2))');
  
  // Try to copy to clipboard
  try {
    await navigator.clipboard.writeText(JSON.stringify(merged, null, 2));
    console.log('📋 Also copied to clipboard!');
  } catch(e) {
    console.log('⚠️ Clipboard failed, use copy command above');
  }
  
  // Show what's missing (if user has matchIds loaded)
  if (window.matchIds) {
    const totalMatches = window.matchIds.length;
    const cached = Object.keys(merged).length;
    const missing = totalMatches - cached;
    
    console.log('\n📋 Coverage:');
    console.log(`  Total matches needed: ${totalMatches}`);
    console.log(`  Currently cached: ${cached}`);
    console.log(`  Still missing: ${missing}`);
    console.log(`  Coverage: ${((cached / totalMatches) * 100).toFixed(2)}%`);
  }
  
})();
