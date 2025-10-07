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

function to2n(n) {
  const f = Number(n);
  return Number.isFinite(f) ? Number(f.toFixed(2)) : n;
}

function fmt2(n) {
  const f = Number(n);
  return Number.isFinite(f) ? f.toFixed(2) : String(n);
}

function fmtSigned2(n) {
  const f = Number(n);
  if (!Number.isFinite(f)) return String(n);
  return (f >= 0 ? "+" : "") + f.toFixed(2);
}

function main() {
  const outDir = path.resolve(__dirname, "../out");
  const srcPath = path.join(outDir, "matches_detailed.csv");
  if (!fs.existsSync(srcPath)) {
    console.error("matches_detailed.csv not found. Run the parser first.");
    process.exit(1);
  }

  const { header, rows } = readCsv(srcPath);
  const col = new Map(header.map((h, i) => [h, i]));
  const data = loadCounterData();
  const nameToIndex = buildNameToIndex(data.heroes);

  const simpleLines = [];
  const advLines = [];

  for (const r of rows) {
    const match_id = r[col.get("match_id")];
    const dHeroes = (r[col.get("dire_heroes")] || "").split("|");
    const rHeroes = (r[col.get("radiant_heroes")] || "").split("|");
    while (dHeroes.length < 5) dHeroes.push("");
    while (rHeroes.length < 5) rHeroes.push("");

    // Build simple line
    const simpleRow = [
      match_id,
      dHeroes[0], dHeroes[1], dHeroes[2], dHeroes[3], dHeroes[4],
      fmt2(r[col.get("dire_base")]), fmt2(r[col.get("dire_advantages_sum")]), fmt2(r[col.get("dire_score")]),
      rHeroes[0], rHeroes[1], rHeroes[2], rHeroes[3], rHeroes[4],
      fmt2(r[col.get("radiant_base")]), fmt2(r[col.get("radiant_advantages_sum")]), fmt2(r[col.get("radiant_score")]),
      fmt2(r[col.get("delta")]), r[col.get("radiant_win")], r[col.get("dire_win")],
    ];
    simpleLines.push(`| ${simpleRow.join(" | ")} |`);

    // Build line with per-hero adv appended to names
    const dIdx = dHeroes.map((h) => nameToIndex.get(h)).filter((x) => x !== undefined);
    const rIdx = rHeroes.map((h) => nameToIndex.get(h)).filter((x) => x !== undefined);
    const dAdv = dIdx.map((idx) => to2n(computeHeroAdvantageAgainstTeam(idx, rIdx, data)));
    const rAdv = rIdx.map((idx) => to2n(computeHeroAdvantageAgainstTeam(idx, dIdx, data)));
    while (dAdv.length < 5) dAdv.push(0);
    while (rAdv.length < 5) rAdv.push(0);

    const dHeroesWithAdv = dHeroes.map((h, i) => h ? `${h} (${fmtSigned2(dAdv[i])})` : "");
    const rHeroesWithAdv = rHeroes.map((h, i) => h ? `${h} (${fmtSigned2(rAdv[i])})` : "");

    const advRow = [
      match_id,
      dHeroesWithAdv[0], dHeroesWithAdv[1], dHeroesWithAdv[2], dHeroesWithAdv[3], dHeroesWithAdv[4],
      fmt2(r[col.get("dire_base")]), fmt2(r[col.get("dire_advantages_sum")]), fmt2(r[col.get("dire_score")]),
      rHeroesWithAdv[0], rHeroesWithAdv[1], rHeroesWithAdv[2], rHeroesWithAdv[3], rHeroesWithAdv[4],
      fmt2(r[col.get("radiant_base")]), fmt2(r[col.get("radiant_advantages_sum")]), fmt2(r[col.get("radiant_score")]),
      fmt2(r[col.get("delta")]), r[col.get("radiant_win")], r[col.get("dire_win")],
    ];
    advLines.push(`| ${advRow.join(" | ")} |`);
  }

  fs.writeFileSync(path.join(outDir, "matches_lines.txt"), simpleLines.join("\n") + "\n", "utf8");
  fs.writeFileSync(path.join(outDir, "matches_lines_with_adv.txt"), advLines.join("\n") + "\n", "utf8");
  console.log("Wrote matches_lines.txt and matches_lines_with_adv.txt");
}

if (require.main === module) {
  main();
}

