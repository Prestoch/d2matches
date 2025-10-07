"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");

const API_KEY = "17a1f63b-8cce-4c4e-8e1c-cf0ea7cf5dba";
const RATE_LIMIT = 1100; // calls per minute
const DELAY_MS = Math.ceil(60000 / RATE_LIMIT); // ~55ms between calls

/**
 * Fetch match data from OpenDota API
 */
function fetchMatchData(matchId) {
  return new Promise((resolve, reject) => {
    const url = `https://api.opendota.com/api/matches/${matchId}?api_key=${API_KEY}`;
    
    https.get(url, (res) => {
      let data = "";
      
      res.on("data", (chunk) => {
        data += chunk;
      });
      
      res.on("end", () => {
        if (res.statusCode === 200) {
          try {
            const json = JSON.parse(data);
            resolve(json);
          } catch (e) {
            reject(new Error(`Parse error: ${e.message}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    }).on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * Map OpenDota lane/position to our role system
 */
function mapPositionToRole(player) {
  // OpenDota provides lane and sometimes role
  const lane = player.lane;
  const laneRole = player.lane_role;
  const isCore = player.is_roaming === false;
  
  // Try to determine position (1-5)
  // Position 1 = Safe Lane Carry
  // Position 2 = Mid
  // Position 3 = Offlane
  // Position 4 = Soft Support (roaming/jungle support)
  // Position 5 = Hard Support (safe lane support)
  
  if (lane === 2) return "mid"; // Mid lane = position 2
  
  // For other lanes, use lane_role if available
  if (laneRole === 1) return "carry";
  if (laneRole === 2) return "mid";
  if (laneRole === 3) return "offlane";
  if (laneRole === 4) return "softsupport";
  if (laneRole === 5) return "hardsupport";
  
  // Fallback based on lane
  if (lane === 1) return "carry"; // Safe lane
  if (lane === 3) return "offlane"; // Offlane
  if (lane === 4 || player.is_roaming) return "softsupport"; // Jungle/roaming
  
  // Default fallback
  return "hardsupport";
}

/**
 * Extract role assignments from match data
 */
function extractRoleAssignments(matchData) {
  if (!matchData.players || matchData.players.length < 10) {
    return null;
  }
  
  const radiantPlayers = matchData.players.filter(p => p.isRadiant);
  const direPlayers = matchData.players.filter(p => !p.isRadiant);
  
  if (radiantPlayers.length !== 5 || direPlayers.length !== 5) {
    return null;
  }
  
  // Sort by position/lane to maintain order
  radiantPlayers.sort((a, b) => {
    const roleOrder = { carry: 1, mid: 2, offlane: 3, softsupport: 4, hardsupport: 5 };
    const roleA = mapPositionToRole(a);
    const roleB = mapPositionToRole(b);
    return (roleOrder[roleA] || 99) - (roleOrder[roleB] || 99);
  });
  
  direPlayers.sort((a, b) => {
    const roleOrder = { carry: 1, mid: 2, offlane: 3, softsupport: 4, hardsupport: 5 };
    const roleA = mapPositionToRole(a);
    const roleB = mapPositionToRole(b);
    return (roleOrder[roleA] || 99) - (roleOrder[roleB] || 99);
  });
  
  return {
    matchId: matchData.match_id,
    radiantRoles: radiantPlayers.map(p => ({
      heroId: p.hero_id,
      role: mapPositionToRole(p),
      lane: p.lane,
      laneRole: p.lane_role
    })),
    direRoles: direPlayers.map(p => ({
      heroId: p.hero_id,
      role: mapPositionToRole(p),
      lane: p.lane,
      laneRole: p.lane_role
    }))
  };
}

/**
 * Read matches from CSV
 */
function readMatchIds() {
  const csvPath = path.join(__dirname, "../out/matches_detailed.csv");
  const text = fs.readFileSync(csvPath, "utf8").trim();
  const lines = text.split(/\r?\n/);
  lines.shift(); // Remove header
  
  const matchIds = lines.map(line => {
    const parts = line.split(",");
    return parts[0]; // match_id is first column
  });
  
  return matchIds;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main function
 */
async function main() {
  console.log("=".repeat(80));
  console.log("FETCHING MATCH POSITION DATA FROM OPENDOTA");
  console.log("=".repeat(80));
  console.log(`API Key: ${API_KEY.substring(0, 8)}...`);
  console.log(`Rate Limit: ${RATE_LIMIT} calls/minute (~${DELAY_MS}ms between calls)`);
  console.log();
  
  // Load cache if exists
  const cacheFile = path.join(__dirname, "../out/match_positions_cache.json");
  let cache = {};
  if (fs.existsSync(cacheFile)) {
    console.log("Loading existing cache...");
    cache = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    console.log(`Cache loaded: ${Object.keys(cache).length} matches`);
  }
  
  // Read all match IDs
  console.log("\nReading match IDs from matches_detailed.csv...");
  const matchIds = readMatchIds();
  console.log(`Total matches: ${matchIds.length}`);
  
  // Filter out already cached matches
  const uncachedMatches = matchIds.filter(id => !cache[id]);
  console.log(`Already cached: ${matchIds.length - uncachedMatches.length}`);
  console.log(`Need to fetch: ${uncachedMatches.length}`);
  
  if (uncachedMatches.length === 0) {
    console.log("\n✓ All matches already cached!");
    return;
  }
  
  console.log("\nStarting fetch process...");
  console.log(`Estimated time: ~${Math.ceil(uncachedMatches.length * DELAY_MS / 1000 / 60)} minutes`);
  console.log();
  
  let fetched = 0;
  let errors = 0;
  let noData = 0;
  const startTime = Date.now();
  
  // Fetch in batches with progress updates
  for (let i = 0; i < uncachedMatches.length; i++) {
    const matchId = uncachedMatches[i];
    
    try {
      const matchData = await fetchMatchData(matchId);
      const roleData = extractRoleAssignments(matchData);
      
      if (roleData) {
        cache[matchId] = roleData;
        fetched++;
      } else {
        cache[matchId] = { matchId, error: "incomplete_data" };
        noData++;
      }
      
      // Progress update every 100 matches
      if ((i + 1) % 100 === 0) {
        const elapsed = Date.now() - startTime;
        const rate = (i + 1) / (elapsed / 1000 / 60);
        const remaining = uncachedMatches.length - (i + 1);
        const eta = remaining / rate;
        
        console.log(`Progress: ${i + 1}/${uncachedMatches.length} (${((i + 1) / uncachedMatches.length * 100).toFixed(1)}%) | ` +
                    `Rate: ${rate.toFixed(0)}/min | ETA: ${eta.toFixed(1)}min | ` +
                    `Fetched: ${fetched}, Errors: ${errors}, NoData: ${noData}`);
        
        // Save cache every 100 matches
        fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2), "utf8");
      }
      
      // Rate limiting
      await sleep(DELAY_MS);
      
    } catch (error) {
      errors++;
      cache[matchId] = { matchId, error: error.message };
      
      if (errors % 10 === 0) {
        console.error(`Error fetching match ${matchId}: ${error.message}`);
      }
      
      // Save cache on errors too
      if (errors % 100 === 0) {
        fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2), "utf8");
      }
      
      await sleep(DELAY_MS);
    }
  }
  
  // Final save
  console.log("\nSaving final cache...");
  fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2), "utf8");
  
  const elapsed = Date.now() - startTime;
  console.log("\n" + "=".repeat(80));
  console.log("FETCH COMPLETE");
  console.log("=".repeat(80));
  console.log(`Total time: ${(elapsed / 1000 / 60).toFixed(1)} minutes`);
  console.log(`Successfully fetched: ${fetched}`);
  console.log(`Incomplete data: ${noData}`);
  console.log(`Errors: ${errors}`);
  console.log(`Cache file: ${cacheFile}`);
  console.log("=".repeat(80));
}

if (require.main === module) {
  main().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}

module.exports = { fetchMatchData, extractRoleAssignments };
