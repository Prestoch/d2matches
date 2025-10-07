"use strict";

const fs = require("fs");
const path = require("path");

function parseCsvLine(line) {
  // Simple CSV split (no quoted commas in our files)
  return line.split(",");
}

function main() {
  const inPath = path.resolve(__dirname, "../out/matches_detailed.csv");
  const outPath = path.resolve(__dirname, "../out/matches_detailed_cells.csv");

  if (!fs.existsSync(inPath)) {
    console.error("matches_detailed.csv not found");
    process.exit(1);
  }

  const lines = fs.readFileSync(inPath, "utf8").trim().split(/\r?\n/);
  if (lines.length <= 1) {
    fs.writeFileSync(outPath, "match_id,DireHero1,DireHero2,DireHero3,DireHero4,DireHero5,dire_base,dire_advantages_sum,dire_score,RadiantHero1,RadiantHero2,RadiantHero3,RadiantHero4,RadiantHero5,radiant_base,radiant_advantages_sum,radiant_score,delta,radiant_win,dire_win\n", "utf8");
    console.log(`Wrote empty header to ${outPath}`);
    return;
  }

  const header = parseCsvLine(lines[0]);
  const ci = new Map(header.map((h, i) => [h, i]));

  const outHeader = [
    "match_id",
    "DireHero1","DireHero2","DireHero3","DireHero4","DireHero5",
    "dire_base","dire_advantages_sum","dire_score",
    "RadiantHero1","RadiantHero2","RadiantHero3","RadiantHero4","RadiantHero5",
    "radiant_base","radiant_advantages_sum","radiant_score",
    "delta","radiant_win","dire_win",
  ];
  const out = [outHeader.join(",")];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const matchId = cols[ci.get("match_id")];
    const dHeroesStr = cols[ci.get("dire_heroes")] || "";
    const rHeroesStr = cols[ci.get("radiant_heroes")] || "";
    const dHeroes = dHeroesStr.split("|");
    const rHeroes = rHeroesStr.split("|");
    while (dHeroes.length < 5) dHeroes.push("");
    while (rHeroes.length < 5) rHeroes.push("");

    const row = [
      matchId,
      dHeroes[0], dHeroes[1], dHeroes[2], dHeroes[3], dHeroes[4],
      cols[ci.get("dire_base")], cols[ci.get("dire_advantages_sum")], cols[ci.get("dire_score")],
      rHeroes[0], rHeroes[1], rHeroes[2], rHeroes[3], rHeroes[4],
      cols[ci.get("radiant_base")], cols[ci.get("radiant_advantages_sum")], cols[ci.get("radiant_score")],
      cols[ci.get("delta")], cols[ci.get("radiant_win")], cols[ci.get("dire_win")],
    ];
    out.push(row.join(","));
  }

  fs.writeFileSync(outPath, out.join("\n") + "\n", "utf8");
  console.log(`Wrote ${outPath}`);
}

if (require.main === module) {
  main();
}

