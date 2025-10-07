"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

/**
 * Load cs_db.json and cs_d2pt.json files
 */
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

function assignRolesBasedOnD2pt(teamHeroIndices, heroesRolesD2pt) {
  const roles = ["carry", "mid", "offlane", "softsupport", "hardsupport"];
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
  const matchId = process.argv[2] || "8459753144"; // Default to first match

  console.log("Loading data...");
  const data = loadRoleBasedData();
  const nameToIndex = buildNameToIndex(data.heroes);

  const detailedPath = path.join(__dirname, "../out/matches_detailed.csv");
  const { header, rows } = readDetailedCsv(detailedPath);
  const col = new Map(header.map((h, i) => [h, i]));

  // Find the match
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

  // Assign roles
  const radiantRoles = assignRolesBasedOnD2pt(rIdx, data.heroesRolesD2pt);
  const direRoles = assignRolesBasedOnD2pt(dIdx, data.heroesRolesD2pt);

  console.log("\n" + "=".repeat(100));
  console.log("ROLE ASSIGNMENTS (based on D2PT rating)");
  console.log("=".repeat(100));

  console.log("\nRADIANT:");
  for (let i = 0; i < rIdx.length; i++) {
    const heroIdx = rIdx[i];
    const heroName = data.heroes[heroIdx];
    const role = radiantRoles[i];
    const d2pt = getStatForHeroRole(heroIdx, role, "d2pt", data);
    console.log(`  ${heroName.padEnd(25)} -> ${role.padEnd(12)} (D2PT: ${d2pt})`);
  }

  console.log("\nDIRE:");
  for (let i = 0; i < dIdx.length; i++) {
    const heroIdx = dIdx[i];
    const heroName = data.heroes[heroIdx];
    const role = direRoles[i];
    const d2pt = getStatForHeroRole(heroIdx, role, "d2pt", data);
    console.log(`  ${heroName.padEnd(25)} -> ${role.padEnd(12)} (D2PT: ${d2pt})`);
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

    // Calculate advantage against all dire heroes
    let heroAdv = 0;
    const advDetails = [];
    for (const opponentIdx of dIdx) {
      const adv = getAdvantage(heroIdx, opponentIdx, data.winRates);
      heroAdv += adv;
      advDetails.push(`${data.heroes[opponentIdx]}: ${adv.toFixed(2)}`);
    }

    console.log(`\n${heroName} (${role}):`);
    console.log(`  Hero Index: ${heroIdx}`);
    console.log(`  WR: ${wr.toFixed(2)}`);
    console.log(`  KDA: ${kda.toFixed(2)}`);
    console.log(`  D2PT: ${d2pt}`);
    console.log(`  NW10: ${nw10}`);
    console.log(`  NW20: ${nw20}`);
    console.log(`  LaneAdv: ${laneadv.toFixed(2)}`);
    console.log(`  Advantage vs Dire: ${heroAdv.toFixed(2)}`);
    console.log(`    ${advDetails.join(", ")}`);

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
  console.log(`  WR Sum: ${rWrSum.toFixed(2)}`);
  console.log(`  Advantage Sum: ${rAdvSum.toFixed(2)}`);
  console.log(`  KDA Sum: ${rKdaSum.toFixed(2)}`);
  console.log(`  D2PT Sum: ${rD2ptSum}`);
  console.log(`  NW10 Sum: ${rNw10Sum}`);
  console.log(`  NW20 Sum: ${rNw20Sum}`);
  console.log(`  LaneAdv Sum: ${rLaneadvSum.toFixed(2)}`);

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
    const advDetails = [];
    for (const opponentIdx of rIdx) {
      const adv = getAdvantage(heroIdx, opponentIdx, data.winRates);
      heroAdv += adv;
      advDetails.push(`${data.heroes[opponentIdx]}: ${adv.toFixed(2)}`);
    }

    console.log(`\n${heroName} (${role}):`);
    console.log(`  Hero Index: ${heroIdx}`);
    console.log(`  WR: ${wr.toFixed(2)}`);
    console.log(`  KDA: ${kda.toFixed(2)}`);
    console.log(`  D2PT: ${d2pt}`);
    console.log(`  NW10: ${nw10}`);
    console.log(`  NW20: ${nw20}`);
    console.log(`  LaneAdv: ${laneadv.toFixed(2)}`);
    console.log(`  Advantage vs Radiant: ${heroAdv.toFixed(2)}`);
    console.log(`    ${advDetails.join(", ")}`);

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
  console.log(`  WR Sum: ${dWrSum.toFixed(2)}`);
  console.log(`  Advantage Sum: ${dAdvSum.toFixed(2)}`);
  console.log(`  KDA Sum: ${dKdaSum.toFixed(2)}`);
  console.log(`  D2PT Sum: ${dD2ptSum}`);
  console.log(`  NW10 Sum: ${dNw10Sum}`);
  console.log(`  NW20 Sum: ${dNw20Sum}`);
  console.log(`  LaneAdv Sum: ${dLaneadvSum.toFixed(2)}`);

  console.log("\n" + "=".repeat(100));
  console.log("DELTAS (Radiant - Dire)");
  console.log("=".repeat(100));

  const wrDelta = rWrSum + rAdvSum - (dWrSum + dAdvSum);
  const kdaDelta = rKdaSum - dKdaSum;
  const d2ptDelta = rD2ptSum - dD2ptSum;
  const nw10Delta = rNw10Sum - dNw10Sum;
  const nw20Delta = rNw20Sum - dNw20Sum;
  const laneadvDelta = rLaneadvSum - dLaneadvSum;

  console.log(`\nWR+Advantage Delta: ${rWrSum.toFixed(2)} + ${rAdvSum.toFixed(2)} - (${dWrSum.toFixed(2)} + ${dAdvSum.toFixed(2)}) = ${wrDelta.toFixed(2)}`);
  console.log(`  Prediction: ${wrDelta > 0 ? "RADIANT" : "DIRE"} wins`);
  console.log(`  Actual: ${radiantWin ? "RADIANT" : "DIRE"} wins`);
  console.log(`  Result: ${(wrDelta > 0) === radiantWin ? "✓ CORRECT" : "✗ WRONG"}`);

  console.log(`\nKDA Delta: ${rKdaSum.toFixed(2)} - ${dKdaSum.toFixed(2)} = ${kdaDelta.toFixed(2)}`);
  console.log(`  Prediction: ${kdaDelta > 0 ? "RADIANT" : "DIRE"} wins`);
  console.log(`  Actual: ${radiantWin ? "RADIANT" : "DIRE"} wins`);
  console.log(`  Result: ${(kdaDelta > 0) === radiantWin ? "✓ CORRECT" : "✗ WRONG"}`);

  console.log(`\nD2PT Delta: ${rD2ptSum} - ${dD2ptSum} = ${d2ptDelta}`);
  console.log(`  Prediction: ${d2ptDelta > 0 ? "RADIANT" : "DIRE"} wins`);
  console.log(`  Actual: ${radiantWin ? "RADIANT" : "DIRE"} wins`);
  console.log(`  Result: ${(d2ptDelta > 0) === radiantWin ? "✓ CORRECT" : "✗ WRONG"}`);

  console.log(`\nNW10 Delta: ${rNw10Sum} - ${dNw10Sum} = ${nw10Delta}`);
  console.log(`  Prediction: ${nw10Delta > 0 ? "RADIANT" : "DIRE"} wins`);
  console.log(`  Actual: ${radiantWin ? "RADIANT" : "DIRE"} wins`);
  console.log(`  Result: ${(nw10Delta > 0) === radiantWin ? "✓ CORRECT" : "✗ WRONG"}`);

  console.log(`\nNW20 Delta: ${rNw20Sum} - ${dNw20Sum} = ${nw20Delta}`);
  console.log(`  Prediction: ${nw20Delta > 0 ? "RADIANT" : "DIRE"} wins`);
  console.log(`  Actual: ${radiantWin ? "RADIANT" : "DIRE"} wins`);
  console.log(`  Result: ${(nw20Delta > 0) === radiantWin ? "✓ CORRECT" : "✗ WRONG"}`);

  console.log(`\nLaneAdv Delta: ${rLaneadvSum.toFixed(2)} - ${dLaneadvSum.toFixed(2)} = ${laneadvDelta.toFixed(2)}`);
  console.log(`  Prediction: ${laneadvDelta > 0 ? "RADIANT" : "DIRE"} wins`);
  console.log(`  Actual: ${radiantWin ? "RADIANT" : "DIRE"} wins`);
  console.log(`  Result: ${(laneadvDelta > 0) === radiantWin ? "✓ CORRECT" : "✗ WRONG"}`);

  console.log("\n" + "=".repeat(100));
}

if (require.main === module) {
  main();
}
