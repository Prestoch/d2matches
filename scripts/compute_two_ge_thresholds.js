"use strict";

const fs = require("fs");
const path = require("path");
const {
  loadCounterData,
  computeHeroAdvantageAgainstTeam,
} = require("./model");

function readDetailedCsv(filePath) {
  const text = fs.readFileSync(filePath, "utf8").trim();
  if (!text) return { header: [], rows: [] };
  const lines = text.split(/\r?\n/);
  const header = lines.shift().split(",");
  const rows = lines.map((l) => l.split(","));
  return { header, rows };
}

function buildNameToIndex(heroes) {
  const map = new Map();
  heroes.forEach((n, i) => map.set(String(n), i));
  return map;
}

function countAtLeastN(advList, threshold, nRequired) {
  let count = 0;
  for (const a of advList) if (a >= threshold) count++;
  return count >= nRequired ? 1 : 0;
}

function writeMatchesTwoGe(outDir, suffix, rows) {
  const outPath = path.join(outDir, `matches_two_ge${suffix}.csv`);
  const lines = [
    `match_id,radiant_two_ge${suffix},dire_two_ge${suffix},radiant_win,dire_win`,
    ...rows.map((r) => [r.match_id, r.rTwo, r.dTwo, r.radiant_win, r.dire_win].join(",")),
  ];
  fs.writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
  return outPath;
}

function writeSummary(outDir, suffix, rows) {
  const rGames = rows.filter((r) => r.rTwo === 1).length;
  const rWins = rows.filter((r) => r.rTwo === 1 && r.radiant_win === 1).length;
  const dGames = rows.filter((r) => r.dTwo === 1).length;
  const dWins = rows.filter((r) => r.dTwo === 1 && r.dire_win === 1).length;
  const lines = [
    "condition,games,accuracy",
    `radiant_two_ge${suffix},${rGames},${rGames ? (rWins / rGames).toFixed(4) : "0"}`,
    `dire_two_ge${suffix},${dGames},${dGames ? (dWins / dGames).toFixed(4) : "0"}`,
  ];
  const outPath = path.join(outDir, `two_ge${suffix}_summary.csv`);
  fs.writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
  return outPath;
}

function main() {
  const outDir = path.resolve(__dirname, "../out");
  const detailedPath = path.join(outDir, "matches_detailed.csv");
  if (!fs.existsSync(detailedPath)) {
    console.error("matches_detailed.csv not found. Run the parser first.");
    process.exit(1);
  }

  const data = loadCounterData();
  const nameToIndex = buildNameToIndex(data.heroes);
  const { header, rows } = readDetailedCsv(detailedPath);
  const col = new Map(header.map((h, i) => [h, i]));

  const results = [];

  for (const r of rows) {
    const match_id = r[col.get("match_id")];
    const radiant_win = Number(r[col.get("radiant_win")]) === 1 ? 1 : 0;
    const dire_win = Number(r[col.get("dire_win")]) === 1 ? 1 : 0;
    const dHeroes = (r[col.get("dire_heroes")] || "").split("|");
    const rHeroes = (r[col.get("radiant_heroes")] || "").split("|");
    const dIdx = dHeroes.map((h) => nameToIndex.get(h)).filter((x) => x !== undefined);
    const rIdx = rHeroes.map((h) => nameToIndex.get(h)).filter((x) => x !== undefined);
    if (dIdx.length !== 5 || rIdx.length !== 5) continue;

    const rAdv = rIdx.map((idx) => computeHeroAdvantageAgainstTeam(idx, dIdx, data));
    const dAdv = dIdx.map((idx) => computeHeroAdvantageAgainstTeam(idx, rIdx, data));

    // Store base info; thresholds applied later
    results.push({ match_id, radiant_win, dire_win, rAdv, dAdv });
  }

  // Compute and write for thresholds 4 and 5
  for (const thr of [4, 5]) {
    const rowsOut = results.map((e) => ({
      match_id: e.match_id,
      rTwo: countAtLeastN(e.rAdv, thr, 2),
      dTwo: countAtLeastN(e.dAdv, thr, 2),
      radiant_win: e.radiant_win,
      dire_win: e.dire_win,
    }));
    const p1 = writeMatchesTwoGe(outDir, String(thr), rowsOut);
    const p2 = writeSummary(outDir, String(thr), rowsOut);
    console.log(`Wrote ${p1}`);
    console.log(`Wrote ${p2}`);
  }
}

if (require.main === module) {
  main();
}

