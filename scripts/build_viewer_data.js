"use strict";

const fs = require("fs");
const path = require("path");
const {
  loadCounterData,
  computeHeroAdvantageAgainstTeam,
} = require("./model");

function readCsv(filePath) {
  const text = fs.readFileSync(filePath, "utf8").trim();
  if (!text) return { header: [], rows: [] };
  const lines = text.split(/\r?\n/);
  const header = lines.shift().split(",");
  const rows = lines.map((l) => l.split(","));
  return { header, rows };
}

function buildNameToIndex(heroes) {
  const map = new Map();
  heroes.forEach((n, i) => map.set(n, i));
  return map;
}

function to2(n) {
  const f = Number(n);
  return Number.isFinite(f) ? Number(f.toFixed(2)) : n;
}

function main() {
  const outDir = path.resolve(__dirname, "../out");
  const srcPath = path.join(outDir, "matches_detailed.csv");
  if (!fs.existsSync(srcPath)) {
    console.error("matches_detailed.csv not found");
    process.exit(1);
  }

  const { header, rows } = readCsv(srcPath);
  const col = new Map(header.map((h, i) => [h, i]));
  const data = loadCounterData(path.resolve(__dirname, "../cs.json"));
  const nameToIndex = buildNameToIndex(data.heroes);

  const outRows = [];
  for (const r of rows) {
    const match_id = r[col.get("match_id")];
    const dHeroes = (r[col.get("dire_heroes")] || "").split("|");
    const rHeroes = (r[col.get("radiant_heroes")] || "").split("|");
    while (dHeroes.length < 5) dHeroes.push("");
    while (rHeroes.length < 5) rHeroes.push("");

    const dIdx = dHeroes.map((h) => nameToIndex.get(h)).filter((x) => x !== undefined);
    const rIdx = rHeroes.map((h) => nameToIndex.get(h)).filter((x) => x !== undefined);
    const dAdv = dIdx.map((idx) => to2(computeHeroAdvantageAgainstTeam(idx, rIdx, data)));
    const rAdv = rIdx.map((idx) => to2(computeHeroAdvantageAgainstTeam(idx, dIdx, data)));
    while (dAdv.length < 5) dAdv.push(0);
    while (rAdv.length < 5) rAdv.push(0);

    outRows.push({
      match_id,
      DireHero1: dHeroes[0], D1_adv: dAdv[0], DireHero2: dHeroes[1], D2_adv: dAdv[1], DireHero3: dHeroes[2], D3_adv: dAdv[2], DireHero4: dHeroes[3], D4_adv: dAdv[3], DireHero5: dHeroes[4], D5_adv: dAdv[4],
      dire_base: to2(r[col.get("dire_base")]), dire_advantages_sum: to2(r[col.get("dire_advantages_sum")]), dire_score: to2(r[col.get("dire_score")]),
      RadiantHero1: rHeroes[0], R1_adv: rAdv[0], RadiantHero2: rHeroes[1], R2_adv: rAdv[1], RadiantHero3: rHeroes[2], R3_adv: rAdv[2], RadiantHero4: rHeroes[3], R4_adv: rAdv[3], RadiantHero5: rHeroes[4], R5_adv: rAdv[4],
      radiant_base: to2(r[col.get("radiant_base")]), radiant_advantages_sum: to2(r[col.get("radiant_advantages_sum")]), radiant_score: to2(r[col.get("radiant_score")]),
      delta: to2(r[col.get("delta")]), radiant_win: r[col.get("radiant_win")], dire_win: r[col.get("dire_win")],
    });
  }

  fs.writeFileSync(path.join(outDir, "matches_view.json"), JSON.stringify(outRows), "utf8");
  console.log(`Wrote ${path.join(outDir, "matches_view.json")}`);
}

if (require.main === module) {
  main();
}

