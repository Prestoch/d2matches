"use strict";

const fs = require("fs");
const path = require("path");
const {
  loadCounterData,
  computeHeroAdvantageAgainstTeam,
} = require("./model");

function readCsv(filePath) {
  const text = fs.readFileSync(filePath, "utf8").trim();
  const lines = text ? text.split(/\r?\n/) : [];
  const header = lines.shift().split(",");
  const rows = lines.map((line) => line.split(","));
  return { header, rows };
}

function buildNameToIndexMap(heroes) {
  const map = new Map();
  heroes.forEach((n, i) => map.set(n, i));
  return map;
}

function to2(n) {
  if (n === "" || n === undefined || n === null) return "";
  const num = Number(n);
  if (Number.isNaN(num)) return String(n);
  return num.toFixed(2);
}

function main() {
  const outDir = path.resolve(__dirname, "../out");
  const detailedPath = path.join(outDir, "matches_detailed.csv");
  if (!fs.existsSync(detailedPath)) {
    console.error("matches_detailed.csv not found. Run the parser first.");
    process.exit(1);
  }

  const { header, rows } = readCsv(detailedPath);
  const col = new Map(header.map((h, i) => [h, i]));

  const data = loadCounterData(path.resolve(__dirname, "../cs.json"));
  const nameToIndex = buildNameToIndexMap(data.heroes);

  // File 1: pipe-delimited without per-hero advantages
  const out1 = [];
  const head1 = [
    "match_id",
    "DireHero1","DireHero2","DireHero3","DireHero4","DireHero5",
    "dire_base","dire_advantages_sum","dire_score",
    "RadiantHero1","RadiantHero2","RadiantHero3","RadiantHero4","RadiantHero5",
    "radiant_base","radiant_advantages_sum","radiant_score",
    "delta","radiant_win","dire_win",
  ];
  out1.push(`| ${head1.join(" | ")} |`);
  out1.push(`| ${head1.map(() => "---").join(" | ")} |`);

  // File 2: pipe-delimited with per-hero advantages next to each hero
  const out2 = [];
  const head2 = [
    "match_id",
    "DireHero1","D1_adv","DireHero2","D2_adv","DireHero3","D3_adv","DireHero4","D4_adv","DireHero5","D5_adv",
    "dire_base","dire_advantages_sum","dire_score",
    "RadiantHero1","R1_adv","RadiantHero2","R2_adv","RadiantHero3","R3_adv","RadiantHero4","R4_adv","RadiantHero5","R5_adv",
    "radiant_base","radiant_advantages_sum","radiant_score",
    "delta","radiant_win","dire_win",
  ];
  out2.push(`| ${head2.join(" | ")} |`);
  out2.push(`| ${head2.map(() => "---").join(" | ")} |`);

  for (const r of rows) {
    const matchId = r[col.get("match_id")];
    const dHeroesStr = r[col.get("dire_heroes")] || "";
    const rHeroesStr = r[col.get("radiant_heroes")] || "";
    const dHeroes = dHeroesStr.split("|");
    const rHeroes = rHeroesStr.split("|");
    while (dHeroes.length < 5) dHeroes.push("");
    while (rHeroes.length < 5) rHeroes.push("");

    // Without per-hero adv
    const row1 = [
      matchId,
      dHeroes[0], dHeroes[1], dHeroes[2], dHeroes[3], dHeroes[4],
      to2(r[col.get("dire_base")]), to2(r[col.get("dire_advantages_sum")]), to2(r[col.get("dire_score")]),
      rHeroes[0], rHeroes[1], rHeroes[2], rHeroes[3], rHeroes[4],
      to2(r[col.get("radiant_base")]), to2(r[col.get("radiant_advantages_sum")]), to2(r[col.get("radiant_score")]),
      to2(r[col.get("delta")]), r[col.get("radiant_win")], r[col.get("dire_win")],
    ];
    out1.push(`| ${row1.join(" | ")} |`);

    // With per-hero advs
    const dIdx = dHeroes.map((h) => nameToIndex.get(h)).filter((x) => x !== undefined);
    const rIdx = rHeroes.map((h) => nameToIndex.get(h)).filter((x) => x !== undefined);
    const dAdv = dIdx.map((idx) => computeHeroAdvantageAgainstTeam(idx, rIdx, data));
    const rAdv = rIdx.map((idx) => computeHeroAdvantageAgainstTeam(idx, dIdx, data));
    // Ensure 5 elements each
    while (dAdv.length < 5) dAdv.push(0);
    while (rAdv.length < 5) rAdv.push(0);

    const row2 = [
      matchId,
      dHeroes[0], to2(dAdv[0]), dHeroes[1], to2(dAdv[1]), dHeroes[2], to2(dAdv[2]), dHeroes[3], to2(dAdv[3]), dHeroes[4], to2(dAdv[4]),
      to2(r[col.get("dire_base")]), to2(r[col.get("dire_advantages_sum")]), to2(r[col.get("dire_score")]),
      rHeroes[0], to2(rAdv[0]), rHeroes[1], to2(rAdv[1]), rHeroes[2], to2(rAdv[2]), rHeroes[3], to2(rAdv[3]), rHeroes[4], to2(rAdv[4]),
      to2(r[col.get("radiant_base")]), to2(r[col.get("radiant_advantages_sum")]), to2(r[col.get("radiant_score")]),
      to2(r[col.get("delta")]), r[col.get("radiant_win")], r[col.get("dire_win")],
    ];
    out2.push(`| ${row2.join(" | ")} |`);
  }

  fs.writeFileSync(path.join(outDir, "matches_detailed_cells.md"), out1.join("\n") + "\n", "utf8");
  fs.writeFileSync(path.join(outDir, "matches_detailed_cells_with_adv.md"), out2.join("\n") + "\n", "utf8");
  console.log("Wrote matches_detailed_cells.md and matches_detailed_cells_with_adv.md");
}

if (require.main === module) {
  main();
}

