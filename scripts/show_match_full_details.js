"use strict";

const fs = require("fs");
const path = require("path");
const { assignRolesBestFitImproved, calculateRoleFitness } = require("./improved_role_assignment.js");

function loadRoleBasedData() {
  const vm = require("vm");
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
    winRates: dbContext.win_rates || [],
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

const matchId = process.argv[2] || "8268427523";

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
console.log(`\nRadiant: ${rHeroes.join(", ")}`);
console.log(`Dire: ${dHeroes.join(", ")}`);

const radiantRoles = assignRolesBestFitImproved(rIdx, data);
const direRoles = assignRolesBestFitImproved(dIdx, data);

console.log("\n" + "=".repeat(100));
console.log("ROLE ASSIGNMENTS (Optimal via exhaustive search)");
console.log("=".repeat(100));

console.log("\nRADIANT:");
const roles = ["carry", "mid", "offlane", "softsupport", "hardsupport"];
for (const role of roles) {
  const idx = radiantRoles.indexOf(role);
  if (idx >= 0) {
    const heroIdx = rIdx[idx];
    const heroName = data.heroes[heroIdx];
    const d2pt = getStatForHeroRole(heroIdx, role, "d2pt", data);
    console.log(`  ${heroName.padEnd(25)} -> ${role.padEnd(12)} (D2PT: ${d2pt})`);
  }
}

console.log("\nDIRE:");
for (const role of roles) {
  const idx = direRoles.indexOf(role);
  if (idx >= 0) {
    const heroIdx = dIdx[idx];
    const heroName = data.heroes[heroIdx];
    const d2pt = getStatForHeroRole(heroIdx, role, "d2pt", data);
    console.log(`  ${heroName.padEnd(25)} -> ${role.padEnd(12)} (D2PT: ${d2pt})`);
  }
}

console.log("\n" + "=".repeat(100));
console.log("RADIANT TEAM - INDIVIDUAL HERO STATS");
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
    advDetails.push(`vs ${data.heroes[opponentIdx]}: ${adv.toFixed(2)}`);
  }

  console.log(`\n${heroName} (${role}):`);
  console.log(`  WR: ${wr.toFixed(2)}`);
  console.log(`  KDA: ${kda.toFixed(2)}`);
  console.log(`  D2PT: ${d2pt}`);
  console.log(`  NW10: ${nw10}`);
  console.log(`  NW20: ${nw20}`);
  console.log(`  LaneAdv: ${laneadv.toFixed(2)}`);
  console.log(`  Total Advantage: ${heroAdv.toFixed(2)}`);
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
console.log(`  Total Advantage: ${rAdvSum.toFixed(2)}`);
console.log(`  KDA Sum: ${rKdaSum.toFixed(2)}`);
console.log(`  D2PT Sum: ${rD2ptSum}`);
console.log(`  NW10 Sum: ${rNw10Sum}`);
console.log(`  NW20 Sum: ${rNw20Sum}`);
console.log(`  LaneAdv Sum: ${rLaneadvSum.toFixed(2)}`);

console.log("\n" + "=".repeat(100));
console.log("DIRE TEAM - INDIVIDUAL HERO STATS");
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
    advDetails.push(`vs ${data.heroes[opponentIdx]}: ${adv.toFixed(2)}`);
  }

  console.log(`\n${heroName} (${role}):`);
  console.log(`  WR: ${wr.toFixed(2)}`);
  console.log(`  KDA: ${kda.toFixed(2)}`);
  console.log(`  D2PT: ${d2pt}`);
  console.log(`  NW10: ${nw10}`);
  console.log(`  NW20: ${nw20}`);
  console.log(`  LaneAdv: ${laneadv.toFixed(2)}`);
  console.log(`  Total Advantage: ${heroAdv.toFixed(2)}`);
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
console.log(`  Total Advantage: ${dAdvSum.toFixed(2)}`);
console.log(`  KDA Sum: ${dKdaSum.toFixed(2)}`);
console.log(`  D2PT Sum: ${dD2ptSum}`);
console.log(`  NW10 Sum: ${dNw10Sum}`);
console.log(`  NW20 Sum: ${dNw20Sum}`);
console.log(`  LaneAdv Sum: ${dLaneadvSum.toFixed(2)}`);

console.log("\n" + "=".repeat(100));
console.log("ALL DELTAS (Radiant - Dire)");
console.log("=".repeat(100));

const wrDelta = rWrSum + rAdvSum - (dWrSum + dAdvSum);
const kdaDelta = rKdaSum - dKdaSum;
const d2ptDelta = rD2ptSum - dD2ptSum;
const nw10Delta = rNw10Sum - dNw10Sum;
const nw20Delta = rNw20Sum - dNw20Sum;
const laneadvDelta = rLaneadvSum - dLaneadvSum;

console.log(`\n1. WR+Advantage Delta:`);
console.log(`   Radiant: ${rWrSum.toFixed(2)} + ${rAdvSum.toFixed(2)} = ${(rWrSum + rAdvSum).toFixed(2)}`);
console.log(`   Dire: ${dWrSum.toFixed(2)} + ${dAdvSum.toFixed(2)} = ${(dWrSum + dAdvSum).toFixed(2)}`);
console.log(`   Delta: ${wrDelta.toFixed(2)}`);
console.log(`   → Predicts ${wrDelta > 0 ? "RADIANT" : "DIRE"} | Actual: ${radiantWin ? "RADIANT" : "DIRE"} | ${(wrDelta > 0) === radiantWin ? "✓ CORRECT" : "✗ WRONG"}`);

console.log(`\n2. KDA Delta:`);
console.log(`   Radiant: ${rKdaSum.toFixed(2)}`);
console.log(`   Dire: ${dKdaSum.toFixed(2)}`);
console.log(`   Delta: ${kdaDelta.toFixed(2)}`);
console.log(`   → Predicts ${kdaDelta > 0 ? "RADIANT" : "DIRE"} | Actual: ${radiantWin ? "RADIANT" : "DIRE"} | ${(kdaDelta > 0) === radiantWin ? "✓ CORRECT" : "✗ WRONG"}`);

console.log(`\n3. D2PT Delta:`);
console.log(`   Radiant: ${rD2ptSum}`);
console.log(`   Dire: ${dD2ptSum}`);
console.log(`   Delta: ${d2ptDelta}`);
console.log(`   → Predicts ${d2ptDelta > 0 ? "RADIANT" : "DIRE"} | Actual: ${radiantWin ? "RADIANT" : "DIRE"} | ${(d2ptDelta > 0) === radiantWin ? "✓ CORRECT" : "✗ WRONG"}`);

console.log(`\n4. NW10 Delta:`);
console.log(`   Radiant: ${rNw10Sum}`);
console.log(`   Dire: ${dNw10Sum}`);
console.log(`   Delta: ${nw10Delta}`);
console.log(`   → Predicts ${nw10Delta > 0 ? "RADIANT" : "DIRE"} | Actual: ${radiantWin ? "RADIANT" : "DIRE"} | ${(nw10Delta > 0) === radiantWin ? "✓ CORRECT" : "✗ WRONG"}`);

console.log(`\n5. NW20 Delta:`);
console.log(`   Radiant: ${rNw20Sum}`);
console.log(`   Dire: ${dNw20Sum}`);
console.log(`   Delta: ${nw20Delta}`);
console.log(`   → Predicts ${nw20Delta > 0 ? "RADIANT" : "DIRE"} | Actual: ${radiantWin ? "RADIANT" : "DIRE"} | ${(nw20Delta > 0) === radiantWin ? "✓ CORRECT" : "✗ WRONG"}`);

console.log(`\n6. LaneAdv Delta:`);
console.log(`   Radiant: ${rLaneadvSum.toFixed(2)}`);
console.log(`   Dire: ${dLaneadvSum.toFixed(2)}`);
console.log(`   Delta: ${laneadvDelta.toFixed(2)}`);
console.log(`   → Predicts ${laneadvDelta > 0 ? "RADIANT" : "DIRE"} | Actual: ${radiantWin ? "RADIANT" : "DIRE"} | ${(laneadvDelta > 0) === radiantWin ? "✓ CORRECT" : "✗ WRONG"}`);

console.log("\n" + "=".repeat(100));
console.log("SUMMARY");
console.log("=".repeat(100));
console.log(`Match Winner: ${radiantWin ? "RADIANT" : "DIRE"}`);
console.log(`\nConditions that correctly predicted the winner:`);
let correct = 0;
if ((wrDelta > 0) === radiantWin) { console.log("  ✓ WR+Advantage"); correct++; }
if ((kdaDelta > 0) === radiantWin) { console.log("  ✓ KDA"); correct++; }
if ((d2ptDelta > 0) === radiantWin) { console.log("  ✓ D2PT"); correct++; }
if ((nw10Delta > 0) === radiantWin) { console.log("  ✓ NW10"); correct++; }
if ((nw20Delta > 0) === radiantWin) { console.log("  ✓ NW20"); correct++; }
if ((laneadvDelta > 0) === radiantWin) { console.log("  ✓ LaneAdv"); correct++; }
console.log(`\nTotal: ${correct}/6 correct predictions`);
console.log("=".repeat(100));
