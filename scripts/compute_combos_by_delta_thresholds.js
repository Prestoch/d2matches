"use strict";

const fs = require("fs");
const path = require("path");
const { loadCounterData, computeTeamScore } = require("./model");

function readDetailedCsv(filePath) {
  const text = fs.readFileSync(filePath, "utf8").trim();
  if (!text) return { header: [], rows: [] };
  const lines = text.split(/\r?\n/);
  const header = lines.shift().split(",");
  const rows = lines.map((l) => l.split(","));
  return { header, rows };
}

function buildNameToIndex(heroes) {
  const m = new Map();
  heroes.forEach((n, i) => m.set(String(n), i));
  return m;
}

function toIdxList(namesStr, nameToIndex) {
  const names = (namesStr || "").split("|").map((s) => s.trim()).filter(Boolean);
  const ids = names.map((n) => nameToIndex.get(n)).filter((x) => x !== undefined);
  return ids;
}

function main() {
  const outDir = path.resolve(__dirname, "../out");
  const detailedPath = path.join(outDir, "matches_detailed.csv");
  if (!fs.existsSync(detailedPath)) {
    console.error("matches_detailed.csv not found. Run the parser first.");
    process.exit(1);
  }

  const data = loadCounterData(path.resolve(__dirname, "../cs.json"));
  const nameToIndex = buildNameToIndex(data.heroes);
  const { header, rows } = readDetailedCsv(detailedPath);
  const col = new Map(header.map((h, i) => [h, i]));

  const MIN_T = 2;
  const MAX_T = 50;
  const thresholds = [];
  for (let t = MIN_T; t <= MAX_T; t += 2) thresholds.push(t);

  // comboKey -> threshold -> { games, wins }
  const agg = new Map();

  for (const r of rows) {
    const dHeroesStr = r[col.get("dire_heroes")];
    const rHeroesStr = r[col.get("radiant_heroes")];
    const radiantWin = Number(r[col.get("radiant_win")]) === 1;
    const dIdx = toIdxList(dHeroesStr, nameToIndex);
    const rIdx = toIdxList(rHeroesStr, nameToIndex);
    if (dIdx.length !== 5 || rIdx.length !== 5) continue;

    const rTeam = computeTeamScore(rIdx, dIdx, data);
    const dTeam = computeTeamScore(dIdx, rIdx, data);
    const rPos = rTeam.perHeroAdvantages.filter((x) => x > 0).length;
    const dPos = dTeam.perHeroAdvantages.filter((x) => x > 0).length;
    const rNeg = 5 - rPos;
    const dNeg = 5 - dPos;
    const comboKey = `${rPos}+ ${rNeg}- vs ${dPos}+ ${dNeg}-`;

    const delta = Number(r[col.get("delta")]);
    if (!Number.isFinite(delta)) continue;
    const absDelta = Math.abs(delta);
    const favoredRadiant = delta >= 0;
    const favoredWon = favoredRadiant ? radiantWin : !radiantWin;

    if (!agg.has(comboKey)) agg.set(comboKey, new Map());
    const mapT = agg.get(comboKey);
    for (const t of thresholds) {
      if (absDelta >= t) {
        const s = mapT.get(t) || { games: 0, wins: 0 };
        s.games += 1;
        if (favoredWon) s.wins += 1;
        mapT.set(t, s);
      }
    }
  }

  const outLines = ["combination,threshold,games,accuracy"]; 
  for (const [comboKey, tMap] of Array.from(agg.entries()).sort()) {
    const sortedT = Array.from(tMap.entries()).sort((a, b) => a[0] - b[0]);
    for (const [t, s] of sortedT) {
      const acc = s.games ? (s.wins / s.games) : 0;
      outLines.push(`${comboKey},${t},${s.games},${acc.toFixed(4)}`);
    }
  }

  const outPath = path.join(outDir, "combos_by_delta_thresholds.csv");
  fs.writeFileSync(outPath, outLines.join("\n") + "\n", "utf8");
  console.log(`Wrote ${outPath}`);
}

if (require.main === module) {
  main();
}

