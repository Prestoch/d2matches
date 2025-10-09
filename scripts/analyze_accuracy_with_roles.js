"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

/**
 * Load cs_db.json and cs_d2pt.json files
 */
function loadRoleBasedData() {
  // Load cs_db.json
  const csDbPath = path.resolve(__dirname, "../cs_db.json");
  const csDbContent = fs.readFileSync(csDbPath, "utf8");
  const dbContext = Object.create(null);
  dbContext.console = console;
  vm.createContext(dbContext);
  vm.runInContext(csDbContent, dbContext, { filename: "cs_db.json" });

  // Load cs_d2pt.json
  const csD2ptPath = path.resolve(__dirname, "../cs_d2pt.json");
  const csD2ptContent = fs.readFileSync(csD2ptPath, "utf8");
  const d2ptContext = Object.create(null);
  d2ptContext.console = console;
  vm.createContext(d2ptContext);
  vm.runInContext(csD2ptContent, d2ptContext, { filename: "cs_d2pt.json" });

  return {
    heroes: dbContext.heroes || [],
    heroesBg: dbContext.heroes_bg || [],
    winRates: dbContext.win_rates || [],
    updateTime: dbContext.update_time || "",
    // Role-based data from cs_db.json
    heroesRolesDbWrkda: dbContext.heroes_roles_db_wrkda || {},
    // Role-based data from cs_d2pt.json
    heroesRoles: d2ptContext.heroes_roles || {},
    heroesRolesD2pt: d2ptContext.heroes_roles_d2pt || {},
  };
}

/**
 * Normalize hero name for matching
 */
function normalizeHeroName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/[-_.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Build hero name to index mapping
 */
function buildNameToIndex(heroes) {
  const m = new Map();
  heroes.forEach((n, i) => {
    m.set(String(n), i);
    m.set(normalizeHeroName(n), i);
  });
  return m;
}

/**
 * Assign roles to heroes based on D2PT rating (most popular role)
 * Returns array of 10 role assignments: [role0, role1, ..., role9]
 * Ensures each team has exactly: 1 carry, 1 mid, 1 offlane, 1 soft support, 1 hard support
 */
function assignRolesBasedOnD2pt(teamHeroIndices, heroesRolesD2pt) {
  const roles = ["carry", "mid", "offlane", "softsupport", "hardsupport"];
  const assigned = [];

  // For each hero, find their best role based on D2PT rating
  const heroRolePrefs = teamHeroIndices.map((heroIdx) => {
    const prefs = [];
    for (const role of roles) {
      const d2ptArray = heroesRolesD2pt[role];
      const d2ptValue = d2ptArray && d2ptArray[heroIdx] != null ? d2ptArray[heroIdx] : 0;
      prefs.push({ role, d2pt: Number(d2ptValue) || 0 });
    }
    // Sort by D2PT descending (higher is better/more popular)
    prefs.sort((a, b) => b.d2pt - a.d2pt);
    return { heroIdx, prefs };
  });

  // Greedy assignment: assign each hero to their best available role
  const assignedRoles = new Set();
  const heroAssignments = new Map();

  // Sort heroes by their best D2PT rating
  heroRolePrefs.sort((a, b) => b.prefs[0].d2pt - a.prefs[0].d2pt);

  for (const { heroIdx, prefs } of heroRolePrefs) {
    for (const { role, d2pt } of prefs) {
      if (!assignedRoles.has(role)) {
        assignedRoles.add(role);
        heroAssignments.set(heroIdx, role);
        break;
      }
    }
  }

  // Build result in original order
  return teamHeroIndices.map((heroIdx) => heroAssignments.get(heroIdx) || "carry");
}

/**
 * Get stat value for a hero in a given role
 */
function getStatForHeroRole(heroIdx, role, statName, data) {
  const { heroesRolesDbWrkda, heroesRoles } = data;

  if (statName === "wr" || statName === "kda") {
    const roleData = heroesRolesDbWrkda[role];
    const arr = roleData && roleData[statName];
    return arr && arr[heroIdx] != null ? Number(arr[heroIdx]) : 0;
  } else if (statName === "nw10" || statName === "nw20" || statName === "laneadv") {
    const roleData = heroesRoles[role];
    const arr = roleData && roleData[statName];
    return arr && arr[heroIdx] != null ? Number(arr[heroIdx]) : 0;
  } else if (statName === "d2pt") {
    const d2ptArray = data.heroesRolesD2pt[role];
    return d2ptArray && d2ptArray[heroIdx] != null ? Number(d2ptArray[heroIdx]) : 0;
  }
  return 0;
}

/**
 * Calculate advantage between hero and opponent using win_rates
 */
function getAdvantage(heroIdx, opponentIdx, winRates) {
  if (winRates[opponentIdx] && winRates[opponentIdx][heroIdx]) {
    return Number(winRates[opponentIdx][heroIdx][0] || 0);
  }
  return 0;
}

/**
 * Calculate team score with role-based stats
 */
function calculateTeamScore(teamHeroIndices, teamRoles, opponentHeroIndices, data) {
  const { winRates } = data;

  let wrSum = 0;
  let kdaSum = 0;
  let d2ptSum = 0;
  let nw10Sum = 0;
  let nw20Sum = 0;
  let laneadvSum = 0;
  let advantageSum = 0;

  for (let i = 0; i < teamHeroIndices.length; i++) {
    const heroIdx = teamHeroIndices[i];
    const role = teamRoles[i];

    // Get role-based stats
    wrSum += getStatForHeroRole(heroIdx, role, "wr", data);
    kdaSum += getStatForHeroRole(heroIdx, role, "kda", data);
    d2ptSum += getStatForHeroRole(heroIdx, role, "d2pt", data);
    nw10Sum += getStatForHeroRole(heroIdx, role, "nw10", data);
    nw20Sum += getStatForHeroRole(heroIdx, role, "nw20", data);
    laneadvSum += getStatForHeroRole(heroIdx, role, "laneadv", data);

    // Calculate advantage against opponents
    let heroAdvantage = 0;
    for (const opponentIdx of opponentHeroIndices) {
      heroAdvantage += getAdvantage(heroIdx, opponentIdx, winRates);
    }
    advantageSum += heroAdvantage;
  }

  return {
    wr: wrSum,
    kda: kdaSum,
    d2pt: d2ptSum,
    nw10: nw10Sum,
    nw20: nw20Sum,
    laneadv: laneadvSum,
    advantage: advantageSum,
    totalScore: wrSum + advantageSum,
  };
}

/**
 * Read matches_detailed.csv
 */
function readDetailedCsv(filePath) {
  const text = fs.readFileSync(filePath, "utf8").trim();
  if (!text) return { header: [], rows: [] };
  const lines = text.split(/\r?\n/);
  const header = lines.shift().split(",");
  const rows = lines.map((l) => l.split(","));
  return { header, rows };
}

/**
 * Main analysis function
 */
function main() {
  console.log("Loading role-based data...");
  const data = loadRoleBasedData();
  const nameToIndex = buildNameToIndex(data.heroes);

  console.log("Reading matches_detailed.csv...");
  const detailedPath = path.join(__dirname, "../out/matches_detailed.csv");
  if (!fs.existsSync(detailedPath)) {
    console.error("matches_detailed.csv not found!");
    process.exit(1);
  }

  const { header, rows } = readDetailedCsv(detailedPath);
  const col = new Map(header.map((h, i) => [h, i]));

  // Define thresholds to test
  const deltaThresholds = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
  const kdaThresholds = [1, 2, 3, 4, 5, 6];
  const d2ptThresholds = [500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000];
  const nw10Thresholds = Array.from({ length: 25 }, (_, i) => 200 * (i + 1)); // 200 to 5000
  const nw20Thresholds = Array.from({ length: 20 }, (_, i) => 500 * (i + 1)); // 500 to 10000
  const laneadvThresholds = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20];

  // Initialize stats for each condition
  const stats = {
    delta: new Map(),
    kda: new Map(),
    d2pt: new Map(),
    nw10: new Map(),
    nw20: new Map(),
    laneadv: new Map(),
  };

  // Initialize all thresholds
  deltaThresholds.forEach((t) => stats.delta.set(t, { games: 0, correct: 0 }));
  kdaThresholds.forEach((t) => stats.kda.set(t, { games: 0, correct: 0 }));
  d2ptThresholds.forEach((t) => stats.d2pt.set(t, { games: 0, correct: 0 }));
  nw10Thresholds.forEach((t) => stats.nw10.set(t, { games: 0, correct: 0 }));
  nw20Thresholds.forEach((t) => stats.nw20.set(t, { games: 0, correct: 0 }));
  laneadvThresholds.forEach((t) => stats.laneadv.set(t, { games: 0, correct: 0 }));

  console.log("Processing matches...");
  let processedMatches = 0;
  let skippedMatches = 0;

  for (const r of rows) {
    const radiantWin = Number(r[col.get("radiant_win")]) === 1;
    const direWin = Number(r[col.get("dire_win")]) === 1;

    const dHeroes = (r[col.get("dire_heroes")] || "").split("|");
    const rHeroes = (r[col.get("radiant_heroes")] || "").split("|");

    const dIdx = dHeroes.map((h) => nameToIndex.get(h)).filter((x) => x !== undefined);
    const rIdx = rHeroes.map((h) => nameToIndex.get(h)).filter((x) => x !== undefined);

    if (dIdx.length !== 5 || rIdx.length !== 5) {
      skippedMatches++;
      continue;
    }

    // Assign roles based on D2PT
    const radiantRoles = assignRolesBasedOnD2pt(rIdx, data.heroesRolesD2pt);
    const direRoles = assignRolesBasedOnD2pt(dIdx, data.heroesRolesD2pt);

    // Calculate scores for both teams
    const radiantScore = calculateTeamScore(rIdx, radiantRoles, dIdx, data);
    const direScore = calculateTeamScore(dIdx, direRoles, rIdx, data);

    // Calculate deltas
    const wrDelta = radiantScore.wr + radiantScore.advantage - (direScore.wr + direScore.advantage);
    const kdaDelta = radiantScore.kda - direScore.kda;
    const d2ptDelta = radiantScore.d2pt - direScore.d2pt;
    const nw10Delta = radiantScore.nw10 - direScore.nw10;
    const nw20Delta = radiantScore.nw20 - direScore.nw20;
    const laneadvDelta = radiantScore.laneadv - direScore.laneadv;

    // Test each threshold
    // Delta (WR + Advantage)
    for (const threshold of deltaThresholds) {
      if (Math.abs(wrDelta) >= threshold) {
        const s = stats.delta.get(threshold);
        s.games++;
        const predictedRadiantWin = wrDelta > 0;
        if (predictedRadiantWin === radiantWin) s.correct++;
      }
    }

    // KDA
    for (const threshold of kdaThresholds) {
      if (Math.abs(kdaDelta) >= threshold) {
        const s = stats.kda.get(threshold);
        s.games++;
        const predictedRadiantWin = kdaDelta > 0;
        if (predictedRadiantWin === radiantWin) s.correct++;
      }
    }

    // D2PT
    for (const threshold of d2ptThresholds) {
      if (Math.abs(d2ptDelta) >= threshold) {
        const s = stats.d2pt.get(threshold);
        s.games++;
        const predictedRadiantWin = d2ptDelta > 0;
        if (predictedRadiantWin === radiantWin) s.correct++;
      }
    }

    // NW10
    for (const threshold of nw10Thresholds) {
      if (Math.abs(nw10Delta) >= threshold) {
        const s = stats.nw10.get(threshold);
        s.games++;
        const predictedRadiantWin = nw10Delta > 0;
        if (predictedRadiantWin === radiantWin) s.correct++;
      }
    }

    // NW20
    for (const threshold of nw20Thresholds) {
      if (Math.abs(nw20Delta) >= threshold) {
        const s = stats.nw20.get(threshold);
        s.games++;
        const predictedRadiantWin = nw20Delta > 0;
        if (predictedRadiantWin === radiantWin) s.correct++;
      }
    }

    // LaneAdv
    for (const threshold of laneadvThresholds) {
      if (Math.abs(laneadvDelta) >= threshold) {
        const s = stats.laneadv.get(threshold);
        s.games++;
        const predictedRadiantWin = laneadvDelta > 0;
        if (predictedRadiantWin === radiantWin) s.correct++;
      }
    }

    processedMatches++;
    if (processedMatches % 10000 === 0) {
      console.log(`Processed ${processedMatches} matches...`);
    }
  }

  console.log(`\nTotal processed: ${processedMatches} matches`);
  console.log(`Skipped: ${skippedMatches} matches`);

  // Write results to CSV
  const outDir = path.resolve(__dirname, "../out");
  const outputLines = ["condition,threshold,games,accuracy"];

  // Delta results
  for (const [threshold, s] of stats.delta) {
    const accuracy = s.games > 0 ? (s.correct / s.games) : 0;
    outputLines.push(`Delta,${threshold},${s.games},${accuracy.toFixed(4)}`);
  }

  // KDA results
  for (const [threshold, s] of stats.kda) {
    const accuracy = s.games > 0 ? (s.correct / s.games) : 0;
    outputLines.push(`KDA,${threshold},${s.games},${accuracy.toFixed(4)}`);
  }

  // D2PT results
  for (const [threshold, s] of stats.d2pt) {
    const accuracy = s.games > 0 ? (s.correct / s.games) : 0;
    outputLines.push(`D2PT,${threshold},${s.games},${accuracy.toFixed(4)}`);
  }

  // NW10 results
  for (const [threshold, s] of stats.nw10) {
    const accuracy = s.games > 0 ? (s.correct / s.games) : 0;
    outputLines.push(`NW10,${threshold},${s.games},${accuracy.toFixed(4)}`);
  }

  // NW20 results
  for (const [threshold, s] of stats.nw20) {
    const accuracy = s.games > 0 ? (s.correct / s.games) : 0;
    outputLines.push(`NW20,${threshold},${s.games},${accuracy.toFixed(4)}`);
  }

  // LaneAdv results
  for (const [threshold, s] of stats.laneadv) {
    const accuracy = s.games > 0 ? (s.correct / s.games) : 0;
    outputLines.push(`LaneAdv,${threshold},${s.games},${accuracy.toFixed(4)}`);
  }

  const outputPath = path.join(outDir, "accuracy_by_conditions.csv");
  fs.writeFileSync(outputPath, outputLines.join("\n") + "\n", "utf8");
  console.log(`\nResults written to: ${outputPath}`);

  // Print summary
  console.log("\n=== SUMMARY ===");
  console.log("\nDelta Thresholds:");
  for (const [threshold, s] of stats.delta) {
    const accuracy = s.games > 0 ? (s.correct / s.games * 100) : 0;
    console.log(`  ${threshold}: ${s.games} games, ${accuracy.toFixed(2)}% accuracy`);
  }

  console.log("\nKDA Thresholds:");
  for (const [threshold, s] of stats.kda) {
    const accuracy = s.games > 0 ? (s.correct / s.games * 100) : 0;
    console.log(`  ${threshold}: ${s.games} games, ${accuracy.toFixed(2)}% accuracy`);
  }

  console.log("\nD2PT Thresholds:");
  for (const [threshold, s] of stats.d2pt) {
    const accuracy = s.games > 0 ? (s.correct / s.games * 100) : 0;
    console.log(`  ${threshold}: ${s.games} games, ${accuracy.toFixed(2)}% accuracy`);
  }

  console.log("\nNW10 Thresholds (sample):");
  for (const threshold of [200, 1000, 2000, 3000, 4000, 5000]) {
    const s = stats.nw10.get(threshold);
    const accuracy = s.games > 0 ? (s.correct / s.games * 100) : 0;
    console.log(`  ${threshold}: ${s.games} games, ${accuracy.toFixed(2)}% accuracy`);
  }

  console.log("\nNW20 Thresholds (sample):");
  for (const threshold of [500, 2000, 4000, 6000, 8000, 10000]) {
    const s = stats.nw20.get(threshold);
    const accuracy = s.games > 0 ? (s.correct / s.games * 100) : 0;
    console.log(`  ${threshold}: ${s.games} games, ${accuracy.toFixed(2)}% accuracy`);
  }

  console.log("\nLaneAdv Thresholds:");
  for (const [threshold, s] of stats.laneadv) {
    const accuracy = s.games > 0 ? (s.correct / s.games * 100) : 0;
    console.log(`  ${threshold}: ${s.games} games, ${accuracy.toFixed(2)}% accuracy`);
  }
}

if (require.main === module) {
  main();
}

module.exports = { loadRoleBasedData, assignRolesBasedOnD2pt, calculateTeamScore };
