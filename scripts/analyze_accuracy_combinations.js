"use strict";

const fs = require("fs");
const path = require("path");
const {
  loadRoleBasedData,
  assignRolesBasedOnD2pt,
  calculateTeamScore,
} = require("./analyze_accuracy_with_roles");

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
 * Build hero name to index mapping
 */
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
 * Main analysis function for combinations
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

  // Define combinations to test
  const combinations = [
    // Single conditions (best from previous analysis)
    { name: "Delta>=20", conditions: [{ type: "delta", threshold: 20 }] },
    { name: "Delta>=25", conditions: [{ type: "delta", threshold: 25 }] },
    { name: "Delta>=30", conditions: [{ type: "delta", threshold: 30 }] },
    
    // Delta + LaneAdv combinations
    { name: "Delta>=20 AND LaneAdv>=10", conditions: [{ type: "delta", threshold: 20 }, { type: "laneadv", threshold: 10 }] },
    { name: "Delta>=25 AND LaneAdv>=10", conditions: [{ type: "delta", threshold: 25 }, { type: "laneadv", threshold: 10 }] },
    { name: "Delta>=20 OR LaneAdv>=10", conditions: [{ type: "delta", threshold: 20 }, { type: "laneadv", threshold: 10 }], operator: "OR" },
    
    // Delta + NW20 combinations
    { name: "Delta>=20 AND NW20>=2000", conditions: [{ type: "delta", threshold: 20 }, { type: "nw20", threshold: 2000 }] },
    { name: "Delta>=25 AND NW20>=2000", conditions: [{ type: "delta", threshold: 25 }, { type: "nw20", threshold: 2000 }] },
    
    // Delta + NW10 combinations
    { name: "Delta>=20 AND NW10>=500", conditions: [{ type: "delta", threshold: 20 }, { type: "nw10", threshold: 500 }] },
    
    // Triple combinations
    { name: "Delta>=20 AND LaneAdv>=10 AND NW20>=2000", conditions: [
      { type: "delta", threshold: 20 },
      { type: "laneadv", threshold: 10 },
      { type: "nw20", threshold: 2000 }
    ]},
    { name: "Delta>=25 AND LaneAdv>=10 AND NW20>=2000", conditions: [
      { type: "delta", threshold: 25 },
      { type: "laneadv", threshold: 10 },
      { type: "nw20", threshold: 2000 }
    ]},
    
    // More aggressive thresholds
    { name: "Delta>=15 AND LaneAdv>=8", conditions: [{ type: "delta", threshold: 15 }, { type: "laneadv", threshold: 8 }] },
    { name: "Delta>=15 AND NW20>=1500", conditions: [{ type: "delta", threshold: 15 }, { type: "nw20", threshold: 1500 }] },
    
    // Very conservative
    { name: "Delta>=35 OR LaneAdv>=15", conditions: [{ type: "delta", threshold: 35 }, { type: "laneadv", threshold: 15 }], operator: "OR" },
    
    // Multiple OR conditions for coverage
    { name: "Delta>=20 OR LaneAdv>=12 OR NW20>=2500", conditions: [
      { type: "delta", threshold: 20 },
      { type: "laneadv", threshold: 12 },
      { type: "nw20", threshold: 2500 }
    ], operator: "OR"},
  ];

  // Initialize stats for each combination
  const stats = combinations.map((combo) => ({
    name: combo.name,
    games: 0,
    correct: 0,
  }));

  console.log("Processing matches...");
  let processedMatches = 0;

  for (const r of rows) {
    const radiantWin = Number(r[col.get("radiant_win")]) === 1;

    const dHeroes = (r[col.get("dire_heroes")] || "").split("|");
    const rHeroes = (r[col.get("radiant_heroes")] || "").split("|");

    const dIdx = dHeroes.map((h) => nameToIndex.get(h)).filter((x) => x !== undefined);
    const rIdx = rHeroes.map((h) => nameToIndex.get(h)).filter((x) => x !== undefined);

    if (dIdx.length !== 5 || rIdx.length !== 5) {
      continue;
    }

    // Assign roles based on D2PT
    const radiantRoles = assignRolesBasedOnD2pt(rIdx, data.heroesRolesD2pt);
    const direRoles = assignRolesBasedOnD2pt(dIdx, data.heroesRolesD2pt);

    // Calculate scores for both teams
    const radiantScore = calculateTeamScore(rIdx, radiantRoles, dIdx, data);
    const direScore = calculateTeamScore(dIdx, direRoles, rIdx, data);

    // Calculate deltas
    const deltas = {
      delta: radiantScore.wr + radiantScore.advantage - (direScore.wr + direScore.advantage),
      kda: radiantScore.kda - direScore.kda,
      d2pt: radiantScore.d2pt - direScore.d2pt,
      nw10: radiantScore.nw10 - direScore.nw10,
      nw20: radiantScore.nw20 - direScore.nw20,
      laneadv: radiantScore.laneadv - direScore.laneadv,
    };

    // Test each combination
    for (let i = 0; i < combinations.length; i++) {
      const combo = combinations[i];
      const operator = combo.operator || "AND";
      
      let matches = false;
      if (operator === "AND") {
        matches = combo.conditions.every((cond) => {
          const deltaValue = deltas[cond.type];
          return Math.abs(deltaValue) >= cond.threshold;
        });
      } else if (operator === "OR") {
        matches = combo.conditions.some((cond) => {
          const deltaValue = deltas[cond.type];
          return Math.abs(deltaValue) >= cond.threshold;
        });
      }

      if (matches) {
        stats[i].games++;
        // Predict based on first condition's delta sign
        const primaryDelta = deltas[combo.conditions[0].type];
        const predictedRadiantWin = primaryDelta > 0;
        if (predictedRadiantWin === radiantWin) {
          stats[i].correct++;
        }
      }
    }

    processedMatches++;
    if (processedMatches % 10000 === 0) {
      console.log(`Processed ${processedMatches} matches...`);
    }
  }

  console.log(`\nTotal processed: ${processedMatches} matches`);

  // Sort by accuracy
  stats.sort((a, b) => {
    if (b.games < 100) return -1; // Prioritize combinations with enough games
    if (a.games < 100) return 1;
    const accA = a.games > 0 ? a.correct / a.games : 0;
    const accB = b.games > 0 ? b.correct / b.games : 0;
    return accB - accA;
  });

  // Write results to CSV
  const outDir = path.resolve(__dirname, "../out");
  const outputLines = ["combination,games,accuracy,correct"];

  for (const s of stats) {
    const accuracy = s.games > 0 ? (s.correct / s.games) : 0;
    outputLines.push(`"${s.name}",${s.games},${accuracy.toFixed(4)},${s.correct}`);
  }

  const outputPath = path.join(outDir, "accuracy_combinations.csv");
  fs.writeFileSync(outputPath, outputLines.join("\n") + "\n", "utf8");
  console.log(`\nResults written to: ${outputPath}`);

  // Print summary
  console.log("\n=== COMBINATION RESULTS (sorted by accuracy) ===");
  console.log("Combination | Games | Accuracy | Correct");
  console.log("-".repeat(80));
  for (const s of stats) {
    const accuracy = s.games > 0 ? (s.correct / s.games * 100) : 0;
    console.log(`${s.name.padEnd(50)} | ${String(s.games).padStart(6)} | ${accuracy.toFixed(2).padStart(6)}% | ${s.correct}`);
  }

  // Find best balance (min 1000 games)
  console.log("\n=== BEST COMBINATIONS (min 1000 games) ===");
  const qualified = stats.filter((s) => s.games >= 1000);
  for (let i = 0; i < Math.min(5, qualified.length); i++) {
    const s = qualified[i];
    const accuracy = s.games > 0 ? (s.correct / s.games * 100) : 0;
    console.log(`${i + 1}. ${s.name}`);
    console.log(`   Games: ${s.games}, Accuracy: ${accuracy.toFixed(2)}%, Correct: ${s.correct}`);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
