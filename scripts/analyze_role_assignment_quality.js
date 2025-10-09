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
 * Analyze D2PT ratings for each hero across all roles
 */
function analyzeHeroRoleStrength(data, nameToIndex) {
  const roles = ["carry", "mid", "offlane", "softsupport", "hardsupport"];
  
  console.log("Analyzing hero role strengths based on D2PT ratings...\n");
  
  // Sample a few heroes to show their role preferences
  const sampleHeroes = [
    "Anti Mage", "Queen Of Pain", "Earthshaker", "Crystal Maiden", 
    "Axe", "Sniper", "Invoker", "Troll Warlord", "Chen"
  ];
  
  for (const heroName of sampleHeroes) {
    const heroIdx = nameToIndex.get(heroName);
    if (heroIdx === undefined) continue;
    
    console.log(`${heroName} (index ${heroIdx}):`);
    
    const roleScores = [];
    for (const role of roles) {
      const d2ptArray = data.heroesRolesD2pt[role];
      const d2pt = d2ptArray && d2ptArray[heroIdx] != null ? d2ptArray[heroIdx] : 0;
      roleScores.push({ role, d2pt });
    }
    
    roleScores.sort((a, b) => b.d2pt - a.d2pt);
    
    for (const { role, d2pt } of roleScores) {
      const bar = "█".repeat(Math.floor(d2pt / 100));
      console.log(`  ${role.padEnd(12)}: ${String(d2pt).padStart(4)} ${bar}`);
    }
    console.log();
  }
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

console.log("=".repeat(80));
console.log("ROLE ASSIGNMENT ANALYSIS");
console.log("=".repeat(80));
console.log();

const data = loadRoleBasedData();
const nameToIndex = buildNameToIndex(data.heroes);

analyzeHeroRoleStrength(data, nameToIndex);

console.log("=".repeat(80));
console.log("TESTING IMPROVED ASSIGNMENT ALGORITHM");
console.log("=".repeat(80));
console.log();

// Test with the match we just looked at
const testHeroes = ["Anti Mage", "Enigma", "Queen Of Pain", "Monkey King", "Oracle"];
const testIdx = testHeroes.map((h) => nameToIndex.get(h));

console.log("Test team:", testHeroes.join(", "));
console.log();

const assignedRoles = assignRolesBestFit(testIdx, data);

console.log("Assigned roles:");
for (let i = 0; i < testHeroes.length; i++) {
  const heroIdx = testIdx[i];
  const role = assignedRoles[i];
  const d2pt = data.heroesRolesD2pt[role]?.[heroIdx] || 0;
  console.log(`  ${testHeroes[i].padEnd(20)} -> ${role.padEnd(12)} (D2PT: ${d2pt})`);
}
