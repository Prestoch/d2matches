"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadRoleBasedData() {
  const csDbPath = path.resolve(__dirname, "../cs_db.json");
  const csDbContent = fs.readFileSync(csDbPath, "utf8");
  const dbContext = Object.create(null);
  dbContext.console = console;
  vm.createContext(dbContext);
  vm.runInContext(csDbContent, dbContext, { filename: "cs_db.json" });

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
    heroesRolesDbWrkda: dbContext.heroes_roles_db_wrkda || {},
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
 * Calculate role fitness score for a hero
 */
function calculateRoleFitness(heroIdx, role, data) {
  const d2pt = data.heroesRolesD2pt[role]?.[heroIdx] || 0;
  const nw20 = data.heroesRoles[role]?.nw20?.[heroIdx] || 0;
  const kda = data.heroesRolesDbWrkda[role]?.kda?.[heroIdx] || 0;
  
  // Weighted score (D2PT is most important)
  return d2pt * 10 + nw20 * 0.01 + kda * 100;
}

/**
 * Improved role assignment using best-fit algorithm
 */
function assignRolesBestFit(teamHeroIndices, data) {
  const roles = ["carry", "mid", "offlane", "softsupport", "hardsupport"];
  
  // Calculate fitness score for each hero-role combination
  const fitnessMatrix = teamHeroIndices.map((heroIdx) => {
    return roles.map((role) => calculateRoleFitness(heroIdx, role, data));
  });
  
  // Greedy assignment with preference strength
  const assignedRoles = new Set();
  const heroAssignments = new Map();
  
  // Create priority list: sort heroes by their best role strength
  const heroPriorities = teamHeroIndices.map((heroIdx, idx) => {
    const maxFitness = Math.max(...fitnessMatrix[idx]);
    return { heroIdx, idx, maxFitness };
  });
  
  heroPriorities.sort((a, b) => b.maxFitness - a.maxFitness);
  
  // Assign roles greedily
  for (const { heroIdx, idx } of heroPriorities) {
    let bestRole = null;
    let bestFitness = -1;
    
    for (let roleIdx = 0; roleIdx < roles.length; roleIdx++) {
      const role = roles[roleIdx];
      if (!assignedRoles.has(role) && fitnessMatrix[idx][roleIdx] > bestFitness) {
        bestRole = role;
        bestFitness = fitnessMatrix[idx][roleIdx];
      }
    }
    
    if (bestRole) {
      assignedRoles.add(bestRole);
      heroAssignments.set(heroIdx, bestRole);
    }
  }
  
  // Return in original order
  return teamHeroIndices.map((heroIdx) => heroAssignments.get(heroIdx) || "carry");
}

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

function getAdvantage(heroIdx, opponentIdx, winRates) {
  if (winRates[opponentIdx] && winRates[opponentIdx][heroIdx]) {
    return Number(winRates[opponentIdx][heroIdx][0] || 0);
  }
  return 0;
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
  const matchId = process.argv[2] || "8189977223";

  console.log("Loading data...");
  const data = loadRoleBasedData();
  const nameToIndex = buildNameToIndex(data.heroes);

  const detailedPath = path.join(__dirname, "../out/matches_detailed.csv");
  const { header, rows } = readDetailedCsv(detailedPath);
  const col = new Map(header.map((h, i) => [h, i]));

  const matchRow = rows.find((r) => r[col.get("match_id")] === matchId);
  if (!matchRow) {
    console.error(`Match ${matchId} not found!`);
    process.exit(1);
  }

  const radiantWin = Number(matchRow[col.get("radiant_win")]) === 1;
  const dHeroes = (matchRow[col.get("dire_heroes")] || "").split("|");
  const rHeroes = (matchRow[col.get("radiant_heroes")] || "").split("|");

  const dIdx = dHeroes.map((h) => nameToIndex.get(h)).filter((x) => x !== undefined);
  const rIdx = rHeroes.map((h) => nameToIndex.get(h)).filter((x) => x !== undefined);

  console.log("\n" + "=".repeat(100));
  console.log(`MATCH ID: ${matchId}`);
  console.log("=".repeat(100));
  console.log(`Winner: ${radiantWin ? "RADIANT" : "DIRE"}`);
  console.log(`\nRadiant Heroes: ${rHeroes.join(", ")}`);
  console.log(`Dire Heroes: ${dHeroes.join(", ")}`);

  // Assign roles using improved algorithm
  const radiantRoles = assignRolesBestFit(rIdx, data);
  const direRoles = assignRolesBestFit(dIdx, data);

  console.log("\n" + "=".repeat(100));
  console.log("IMPROVED ROLE ASSIGNMENTS (Fitness-based)");
  console.log("=".repeat(100));

  console.log("\nRADIANT:");
  const roles = ["carry", "mid", "offlane", "softsupport", "hardsupport"];
  for (const role of roles) {
    const idx = radiantRoles.indexOf(role);
    if (idx >= 0) {
      const heroIdx = rIdx[idx];
      const heroName = data.heroes[heroIdx];
      const d2pt = getStatForHeroRole(heroIdx, role, "d2pt", data);
      const fitness = calculateRoleFitness(heroIdx, role, data);
      console.log(`  ${heroName.padEnd(25)} -> ${role.padEnd(12)} (D2PT: ${d2pt}, Fitness: ${fitness.toFixed(0)})`);
    }
  }

  console.log("\nDIRE:");
  for (const role of roles) {
    const idx = direRoles.indexOf(role);
    if (idx >= 0) {
      const heroIdx = dIdx[idx];
      const heroName = data.heroes[heroIdx];
      const d2pt = getStatForHeroRole(heroIdx, role, "d2pt", data);
      const fitness = calculateRoleFitness(heroIdx, role, data);
      console.log(`  ${heroName.padEnd(25)} -> ${role.padEnd(12)} (D2PT: ${d2pt}, Fitness: ${fitness.toFixed(0)})`);
    }
  }

  console.log("\n" + "=".repeat(100));
  console.log("RADIANT TEAM - DETAILED STATS");
  console.log("=".repeat(100));

  let rWrSum = 0, rKdaSum = 0, rD2ptSum = 0, rNw10Sum = 0, rNw20Sum = 0, rLaneadvSum = 0, rAdvSum = 0;

  for (let i = 0; i < rIdx.length; i++) {
    const heroIdx = rIdx[i];
    const heroName = data.heroes[heroIdx];
    const role = radiantRoles[i];

    const wr = getStatForHeroRole(heroIdx, role, "wr", data);
    const kda = getStatForHeroRole(heroIdx, role, "kda", data);
    const d2pt = getStatForHeroRole(heroIdx, role, "d2pt", data);
    const nw10 = getStatForHeroRole(heroIdx, role, "nw10", data);
    const nw20 = getStatForHeroRole(heroIdx, role, "nw20", data);
    const laneadv = getStatForHeroRole(heroIdx, role, "laneadv", data);

    let heroAdv = 0;
    const advDetails = [];
    for (const opponentIdx of dIdx) {
      const adv = getAdvantage(heroIdx, opponentIdx, data.winRates);
      heroAdv += adv;
      advDetails.push(`${data.heroes[opponentIdx]}: ${adv.toFixed(2)}`);
    }

    console.log(`\n${heroName} (${role}):`);
    console.log(`  WR: ${wr.toFixed(2)}, KDA: ${kda.toFixed(2)}, D2PT: ${d2pt}, NW10: ${nw10}, NW20: ${nw20}, LaneAdv: ${laneadv.toFixed(2)}`);
    console.log(`  Advantage vs Dire: ${heroAdv.toFixed(2)}`);

    rWrSum += wr;
    rKdaSum += kda;
    rD2ptSum += d2pt;
    rNw10Sum += nw10;
    rNw20Sum += nw20;
    rLaneadvSum += laneadv;
    rAdvSum += heroAdv;
  }

  console.log("\n" + "-".repeat(100));
  console.log("RADIANT TOTALS:");
  console.log(`  WR: ${rWrSum.toFixed(2)}, Adv: ${rAdvSum.toFixed(2)}, KDA: ${rKdaSum.toFixed(2)}, D2PT: ${rD2ptSum}, NW10: ${rNw10Sum}, NW20: ${rNw20Sum}, LaneAdv: ${rLaneadvSum.toFixed(2)}`);

  console.log("\n" + "=".repeat(100));
  console.log("DIRE TEAM - DETAILED STATS");
  console.log("=".repeat(100));

  let dWrSum = 0, dKdaSum = 0, dD2ptSum = 0, dNw10Sum = 0, dNw20Sum = 0, dLaneadvSum = 0, dAdvSum = 0;

  for (let i = 0; i < dIdx.length; i++) {
    const heroIdx = dIdx[i];
    const heroName = data.heroes[heroIdx];
    const role = direRoles[i];

    const wr = getStatForHeroRole(heroIdx, role, "wr", data);
    const kda = getStatForHeroRole(heroIdx, role, "kda", data);
    const d2pt = getStatForHeroRole(heroIdx, role, "d2pt", data);
    const nw10 = getStatForHeroRole(heroIdx, role, "nw10", data);
    const nw20 = getStatForHeroRole(heroIdx, role, "nw20", data);
    const laneadv = getStatForHeroRole(heroIdx, role, "laneadv", data);

    let heroAdv = 0;
    for (const opponentIdx of rIdx) {
      const adv = getAdvantage(heroIdx, opponentIdx, data.winRates);
      heroAdv += adv;
    }

    console.log(`\n${heroName} (${role}):`);
    console.log(`  WR: ${wr.toFixed(2)}, KDA: ${kda.toFixed(2)}, D2PT: ${d2pt}, NW10: ${nw10}, NW20: ${nw20}, LaneAdv: ${laneadv.toFixed(2)}`);
    console.log(`  Advantage vs Radiant: ${heroAdv.toFixed(2)}`);

    dWrSum += wr;
    dKdaSum += kda;
    dD2ptSum += d2pt;
    dNw10Sum += nw10;
    dNw20Sum += nw20;
    dLaneadvSum += laneadv;
    dAdvSum += heroAdv;
  }

  console.log("\n" + "-".repeat(100));
  console.log("DIRE TOTALS:");
  console.log(`  WR: ${dWrSum.toFixed(2)}, Adv: ${dAdvSum.toFixed(2)}, KDA: ${dKdaSum.toFixed(2)}, D2PT: ${dD2ptSum}, NW10: ${dNw10Sum}, NW20: ${dNw20Sum}, LaneAdv: ${dLaneadvSum.toFixed(2)}`);

  console.log("\n" + "=".repeat(100));
  console.log("DELTAS (Radiant - Dire)");
  console.log("=".repeat(100));

  const wrDelta = rWrSum + rAdvSum - (dWrSum + dAdvSum);
  const kdaDelta = rKdaSum - dKdaSum;
  const d2ptDelta = rD2ptSum - dD2ptSum;
  const nw10Delta = rNw10Sum - dNw10Sum;
  const nw20Delta = rNw20Sum - dNw20Sum;
  const laneadvDelta = rLaneadvSum - dLaneadvSum;

  console.log(`\nWR+Advantage Delta: ${wrDelta.toFixed(2)} → Predicts ${wrDelta > 0 ? "RADIANT" : "DIRE"} | Actual: ${radiantWin ? "RADIANT" : "DIRE"} | ${(wrDelta > 0) === radiantWin ? "✓ CORRECT" : "✗ WRONG"}`);
  console.log(`KDA Delta: ${kdaDelta.toFixed(2)} → Predicts ${kdaDelta > 0 ? "RADIANT" : "DIRE"} | Actual: ${radiantWin ? "RADIANT" : "DIRE"} | ${(kdaDelta > 0) === radiantWin ? "✓ CORRECT" : "✗ WRONG"}`);
  console.log(`D2PT Delta: ${d2ptDelta} → Predicts ${d2ptDelta > 0 ? "RADIANT" : "DIRE"} | Actual: ${radiantWin ? "RADIANT" : "DIRE"} | ${(d2ptDelta > 0) === radiantWin ? "✓ CORRECT" : "✗ WRONG"}`);
  console.log(`NW10 Delta: ${nw10Delta} → Predicts ${nw10Delta > 0 ? "RADIANT" : "DIRE"} | Actual: ${radiantWin ? "RADIANT" : "DIRE"} | ${(nw10Delta > 0) === radiantWin ? "✓ CORRECT" : "✗ WRONG"}`);
  console.log(`NW20 Delta: ${nw20Delta} → Predicts ${nw20Delta > 0 ? "RADIANT" : "DIRE"} | Actual: ${radiantWin ? "RADIANT" : "DIRE"} | ${(nw20Delta > 0) === radiantWin ? "✓ CORRECT" : "✗ WRONG"}`);
  console.log(`LaneAdv Delta: ${laneadvDelta.toFixed(2)} → Predicts ${laneadvDelta > 0 ? "RADIANT" : "DIRE"} | Actual: ${radiantWin ? "RADIANT" : "DIRE"} | ${(laneadvDelta > 0) === radiantWin ? "✓ CORRECT" : "✗ WRONG"}`);

  console.log("\n" + "=".repeat(100));
}

if (require.main === module) {
  main();
}
