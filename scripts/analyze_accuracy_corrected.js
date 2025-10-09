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

function normalizeHeroName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/[-_.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildNameToIndex(heroes) {
  const m = new Map();
  heroes.forEach((n, i) => {
    m.set(String(n), i);
    m.set(normalizeHeroName(n), i);
  });
  return m;
}

/**
 * Assign roles based on D2PT rating
 */
function assignRolesBasedOnD2pt(teamHeroIndices, heroesRolesD2pt) {
  const roles = ["carry", "mid", "offlane", "softsupport", "hardsupport"];
  const assigned = [];

  const heroRolePrefs = teamHeroIndices.map((heroIdx) => {
    const prefs = [];
    for (const role of roles) {
      const d2ptArray = heroesRolesD2pt[role];
      const d2ptValue = d2ptArray && d2ptArray[heroIdx] != null ? d2ptArray[heroIdx] : 0;
      prefs.push({ role, d2pt: Number(d2ptValue) || 0 });
    }
    prefs.sort((a, b) => b.d2pt - a.d2pt);
    return { heroIdx, prefs };
  });

  const assignedRoles = new Set();
  const heroAssignments = new Map();

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

  return teamHeroIndices.map((heroIdx) => heroAssignments.get(heroIdx) || "carry");
}

/**
 * Get stat value for a hero in a given role
 */
function getStatForHeroRole(heroIdx, role, statName, data) {
  const { heroesRolesDbWrkda, heroesRoles, heroesRolesD2pt } = data;

  if (statName === "wr" || statName === "kda") {
    const roleData = heroesRolesDbWrkda[role];
    const arr = roleData && roleData[statName];
    return arr && arr[heroIdx] != null ? Number(arr[heroIdx]) : 0;
  } else if (statName === "nw10" || statName === "nw20" || statName === "laneadv") {
    const roleData = heroesRoles[role];
    const arr = roleData && roleData[statName];
    return arr && arr[heroIdx] != null ? Number(arr[heroIdx]) : 0;
  } else if (statName === "d2pt") {
    const d2ptArray = heroesRolesD2pt[role];
    return d2ptArray && d2ptArray[heroIdx] != null ? Number(d2ptArray[heroIdx]) : 0;
  }
  return 0;
}

/**
 * Calculate advantage
 */
function getAdvantage(heroIdx, opponentIdx, winRates) {
  if (winRates[opponentIdx] && winRates[opponentIdx][heroIdx]) {
    return Number(winRates[opponentIdx][heroIdx][0] || 0);
  }
  return 0;
}

/**
 * Calculate team score
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

    wrSum += getStatForHeroRole(heroIdx, role, "wr", data);
    kdaSum += getStatForHeroRole(heroIdx, role, "kda", data);
    d2ptSum += getStatForHeroRole(heroIdx, role, "d2pt", data);
    nw10Sum += getStatForHeroRole(heroIdx, role, "nw10", data);
    nw20Sum += getStatForHeroRole(heroIdx, role, "nw20", data);
    laneadvSum += getStatForHeroRole(heroIdx, role, "laneadv", data);

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

function readDetailedCsv(filePath) {
  const text = fs.readFileSync(filePath, "utf8").trim();
  if (!text) return { header: [], rows: [] };
  const lines = text.split(/\r?\n/);
  const header = lines.shift().split(",");
  const rows = lines.map((l) => l.split(","));
  return { header, rows };
}

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

  // Define thresholds
  const deltaThresholds = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
  const kdaThresholds = [1, 2, 3, 4, 5, 6];
  const d2ptThresholds = [500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000];
  const nw10Thresholds = Array.from({ length: 25 }, (_, i) => 200 * (i + 1));
  const nw20Thresholds = Array.from({ length: 20 }, (_, i) => 500 * (i + 1));
  const laneadvThresholds = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20];

  // Initialize stats
  const stats = {
    delta: new Map(),
    kda: new Map(),
    d2pt: new Map(),
    nw10: new Map(),
    nw20: new Map(),
    laneadv: new Map(),
  };

  deltaThresholds.forEach((t) => stats.delta.set(t, { games: 0, correct: 0 }));
  kdaThresholds.forEach((t) => stats.kda.set(t, { games: 0, correct: 0 }));
  d2ptThresholds.forEach((t) => stats.d2pt.set(t, { games: 0, correct: 0 }));
  nw10Thresholds.forEach((t) => stats.nw10.set(t, { games: 0, correct: 0 }));
  nw20Thresholds.forEach((t) => stats.nw20.set(t, { games: 0, correct: 0 }));
  laneadvThresholds.forEach((t) => stats.laneadv.set(t, { games: 0, correct: 0 }));

  console.log("Processing matches...");
  let processedMatches = 0;
  let skippedMatches = 0;

  // Debug first few matches
  let debugCount = 0;

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

    // Assign roles
    const radiantRoles = assignRolesBasedOnD2pt(rIdx, data.heroesRolesD2pt);
    const direRoles = assignRolesBasedOnD2pt(dIdx, data.heroesRolesD2pt);

    // Calculate scores
    const radiantScore = calculateTeamScore(rIdx, radiantRoles, dIdx, data);
    const direScore = calculateTeamScore(dIdx, direRoles, rIdx, data);

    // Calculate deltas (Radiant - Dire)
    const wrDelta = radiantScore.wr + radiantScore.advantage - (direScore.wr + direScore.advantage);
    const kdaDelta = radiantScore.kda - direScore.kda;
    const d2ptDelta = radiantScore.d2pt - direScore.d2pt;
    const nw10Delta = radiantScore.nw10 - direScore.nw10;
    const nw20Delta = radiantScore.nw20 - direScore.nw20;
    const laneadvDelta = radiantScore.laneadv - direScore.laneadv;

    // Debug first 3 matches
    if (debugCount < 3) {
      console.log(`\n=== Match ${processedMatches + 1} ===`);
      console.log(`Radiant: ${rHeroes.join(", ")}`);
      console.log(`Dire: ${dHeroes.join(", ")}`);
      console.log(`Winner: ${radiantWin ? "Radiant" : "Dire"}`);
      console.log(`\nRadiant scores: WR=${radiantScore.wr.toFixed(2)}, Adv=${radiantScore.advantage.toFixed(2)}, KDA=${radiantScore.kda.toFixed(2)}, D2PT=${radiantScore.d2pt.toFixed(0)}, NW10=${radiantScore.nw10.toFixed(0)}, NW20=${radiantScore.nw20.toFixed(0)}, LaneAdv=${radiantScore.laneadv.toFixed(2)}`);
      console.log(`Dire scores: WR=${direScore.wr.toFixed(2)}, Adv=${direScore.advantage.toFixed(2)}, KDA=${direScore.kda.toFixed(2)}, D2PT=${direScore.d2pt.toFixed(0)}, NW10=${direScore.nw10.toFixed(0)}, NW20=${direScore.nw20.toFixed(0)}, LaneAdv=${direScore.laneadv.toFixed(2)}`);
      console.log(`\nDeltas (Radiant - Dire):`);
      console.log(`  WR+Adv Delta: ${wrDelta.toFixed(2)}`);
      console.log(`  KDA Delta: ${kdaDelta.toFixed(2)}`);
      console.log(`  D2PT Delta: ${d2ptDelta.toFixed(0)}`);
      console.log(`  NW10 Delta: ${nw10Delta.toFixed(0)}`);
      console.log(`  NW20 Delta: ${nw20Delta.toFixed(0)}`);
      console.log(`  LaneAdv Delta: ${laneadvDelta.toFixed(2)}`);
      debugCount++;
    }

    // Test each threshold
    for (const threshold of deltaThresholds) {
      if (Math.abs(wrDelta) >= threshold) {
        const s = stats.delta.get(threshold);
        s.games++;
        const predictedRadiantWin = wrDelta > 0;
        if (predictedRadiantWin === radiantWin) s.correct++;
      }
    }

    for (const threshold of kdaThresholds) {
      if (Math.abs(kdaDelta) >= threshold) {
        const s = stats.kda.get(threshold);
        s.games++;
        const predictedRadiantWin = kdaDelta > 0;
        if (predictedRadiantWin === radiantWin) s.correct++;
      }
    }

    for (const threshold of d2ptThresholds) {
      if (Math.abs(d2ptDelta) >= threshold) {
        const s = stats.d2pt.get(threshold);
        s.games++;
        const predictedRadiantWin = d2ptDelta > 0;
        if (predictedRadiantWin === radiantWin) s.correct++;
      }
    }

    for (const threshold of nw10Thresholds) {
      if (Math.abs(nw10Delta) >= threshold) {
        const s = stats.nw10.get(threshold);
        s.games++;
        const predictedRadiantWin = nw10Delta > 0;
        if (predictedRadiantWin === radiantWin) s.correct++;
      }
    }

    for (const threshold of nw20Thresholds) {
      if (Math.abs(nw20Delta) >= threshold) {
        const s = stats.nw20.get(threshold);
        s.games++;
        const predictedRadiantWin = nw20Delta > 0;
        if (predictedRadiantWin === radiantWin) s.correct++;
      }
    }

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

  // Write results
  const outDir = path.resolve(__dirname, "../out");
  const outputLines = ["condition,threshold,games,accuracy"];

  for (const [threshold, s] of stats.delta) {
    const accuracy = s.games > 0 ? (s.correct / s.games) : 0;
    outputLines.push(`Delta,${threshold},${s.games},${accuracy.toFixed(4)}`);
  }

  for (const [threshold, s] of stats.kda) {
    const accuracy = s.games > 0 ? (s.correct / s.games) : 0;
    outputLines.push(`KDA,${threshold},${s.games},${accuracy.toFixed(4)}`);
  }

  for (const [threshold, s] of stats.d2pt) {
    const accuracy = s.games > 0 ? (s.correct / s.games) : 0;
    outputLines.push(`D2PT,${threshold},${s.games},${accuracy.toFixed(4)}`);
  }

  for (const [threshold, s] of stats.nw10) {
    const accuracy = s.games > 0 ? (s.correct / s.games) : 0;
    outputLines.push(`NW10,${threshold},${s.games},${accuracy.toFixed(4)}`);
  }

  for (const [threshold, s] of stats.nw20) {
    const accuracy = s.games > 0 ? (s.correct / s.games) : 0;
    outputLines.push(`NW20,${threshold},${s.games},${accuracy.toFixed(4)}`);
  }

  for (const [threshold, s] of stats.laneadv) {
    const accuracy = s.games > 0 ? (s.correct / s.games) : 0;
    outputLines.push(`LaneAdv,${threshold},${s.games},${accuracy.toFixed(4)}`);
  }

  const outputPath = path.join(outDir, "accuracy_corrected.csv");
  fs.writeFileSync(outputPath, outputLines.join("\n") + "\n", "utf8");
  console.log(`\nResults written to: ${outputPath}`);

  // Print detailed summary
  console.log("\n" + "=".repeat(80));
  console.log("DETAILED RESULTS");
  console.log("=".repeat(80));

  console.log("\n📊 Delta (WR + Advantage) Thresholds:");
  for (const [threshold, s] of stats.delta) {
    const accuracy = s.games > 0 ? (s.correct / s.games * 100) : 0;
    console.log(`  ${String(threshold).padStart(2)}: ${String(s.games).padStart(6)} games, ${accuracy.toFixed(2).padStart(6)}% accuracy`);
  }

  console.log("\n📊 KDA Delta Thresholds:");
  for (const [threshold, s] of stats.kda) {
    const accuracy = s.games > 0 ? (s.correct / s.games * 100) : 0;
    console.log(`  ${String(threshold).padStart(2)}: ${String(s.games).padStart(6)} games, ${accuracy.toFixed(2).padStart(6)}% accuracy`);
  }

  console.log("\n📊 D2PT Delta Thresholds:");
  for (const [threshold, s] of stats.d2pt) {
    const accuracy = s.games > 0 ? (s.correct / s.games * 100) : 0;
    console.log(`  ${String(threshold).padStart(4)}: ${String(s.games).padStart(6)} games, ${accuracy.toFixed(2).padStart(6)}% accuracy`);
  }

  console.log("\n📊 NW10 Delta Thresholds (sample):");
  for (const threshold of [200, 400, 1000, 2000, 3000, 4000, 5000]) {
    const s = stats.nw10.get(threshold);
    if (s) {
      const accuracy = s.games > 0 ? (s.correct / s.games * 100) : 0;
      console.log(`  ${String(threshold).padStart(4)}: ${String(s.games).padStart(6)} games, ${accuracy.toFixed(2).padStart(6)}% accuracy`);
    }
  }

  console.log("\n📊 NW20 Delta Thresholds (sample):");
  for (const threshold of [500, 1000, 2000, 4000, 6000, 8000, 10000]) {
    const s = stats.nw20.get(threshold);
    if (s) {
      const accuracy = s.games > 0 ? (s.correct / s.games * 100) : 0;
      console.log(`  ${String(threshold).padStart(5)}: ${String(s.games).padStart(6)} games, ${accuracy.toFixed(2).padStart(6)}% accuracy`);
    }
  }

  console.log("\n📊 LaneAdv Delta Thresholds:");
  for (const [threshold, s] of stats.laneadv) {
    const accuracy = s.games > 0 ? (s.correct / s.games * 100) : 0;
    console.log(`  ${String(threshold).padStart(2)}: ${String(s.games).padStart(6)} games, ${accuracy.toFixed(2).padStart(6)}% accuracy`);
  }
}

if (require.main === module) {
  main();
}
