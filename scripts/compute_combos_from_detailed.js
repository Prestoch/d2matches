"use strict";

const fs = require("fs");
const path = require("path");
const { loadCounterData, computeTeamScore } = require("./model");

function readDetailedCsv(filePath) {
  const raw = fs.readFileSync(filePath, "utf8").trim().split(/\r?\n/);
  const header = raw.shift();
  const cols = header.split(",");
  const colIdx = new Map(cols.map((c, i) => [c, i]));
  const rows = raw.map((line) => line.split(","));
  return { rows, colIdx };
}

function buildNameToIndex(heroes) {
  const m = new Map();
  heroes.forEach((n, i) => m.set(String(n), i));
  return m;
}

function parseHeroesField(field, nameToIndex) {
  if (!field) return [];
  return field.split("|").map((name) => nameToIndex.get(name)).filter((v) => v != null);
}

function main() {
  const outDir = path.resolve(__dirname, "../out");
  const detailedPath = path.join(outDir, "matches_detailed.csv");
  const { rows, colIdx } = readDetailedCsv(detailedPath);
  const data = loadCounterData();
  const nameToIndex = buildNameToIndex(data.heroes);

  const agg = new Map();

  for (const r of rows) {
    const direHeroesStr = r[colIdx.get("dire_heroes")];
    const radiantHeroesStr = r[colIdx.get("radiant_heroes")];
    const radiantWin = Number(r[colIdx.get("radiant_win")]) === 1;

    const dire = parseHeroesField(direHeroesStr, nameToIndex);
    const radiant = parseHeroesField(radiantHeroesStr, nameToIndex);
    if (dire.length !== 5 || radiant.length !== 5) continue;

    const rTeam = computeTeamScore(radiant, dire, data);
    const dTeam = computeTeamScore(dire, radiant, data);

    // Classify exactly 5 heroes per side: positives are strictly > 0, the rest count as negatives (<= 0)
    const rPos = rTeam.perHeroAdvantages.filter((x) => x > 0).length;
    const rNeg = 5 - rPos;
    const dPos = dTeam.perHeroAdvantages.filter((x) => x > 0).length;
    const dNeg = 5 - dPos;

    const key = `${rPos}+ ${rNeg}- vs ${dPos}+ ${dNeg}-`;
    const entry = agg.get(key) || { games: 0, radiantWins: 0, rPos, rNeg, dPos, dNeg };
    entry.games += 1;
    entry.radiantWins += radiantWin ? 1 : 0;
    agg.set(key, entry);
  }

  // (removed) invalid pre-population of partial sums; see valid pre-population below

  // Pre-populate all valid combinations (sum to 5 per side)
  for (let rPos = 0; rPos <= 5; rPos++) {
    const rNeg = 5 - rPos;
    for (let dPos = 0; dPos <= 5; dPos++) {
      const dNeg = 5 - dPos;
      const key = `${rPos}+ ${rNeg}- vs ${dPos}+ ${dNeg}-`;
      if (!agg.has(key)) {
        agg.set(key, { games: 0, radiantWins: 0, rPos, rNeg, dPos, dNeg });
      }
    }
  }

  const lines = [
    "combination,games,radiant_win_rate,dire_win_rate",
  ];
  for (const [key, e] of Array.from(agg.entries()).sort((a, b) => {
    // sort by r_pos desc, then d_pos desc, then games desc
    const ea = a[1];
    const eb = b[1];
    if (eb.rPos !== ea.rPos) return eb.rPos - ea.rPos;
    if (eb.dPos !== ea.dPos) return eb.dPos - ea.dPos;
    return eb.games - ea.games;
  })) {
    const rw = e.games ? e.radiantWins / e.games : 0;
    const dw = e.games ? 1 - rw : 0;
    lines.push(`${key},${e.games},${rw.toFixed(4)},${dw.toFixed(4)}`);
  }

  fs.writeFileSync(path.join(outDir, "combos.csv"), lines.join("\n") + "\n", "utf8");
  console.log(`Wrote ${path.join(outDir, "combos.csv")}`);
}

if (require.main === module) {
  main();
}

