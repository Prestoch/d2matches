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
  const m = new Map();
  heroes.forEach((n, i) => m.set(String(n), i));
  return m;
}

function ensureStatsForThresholds(statsMap, thresholds) {
  for (const t of thresholds) {
    if (!statsMap.has(t)) statsMap.set(t, { games: 0, wins: 0 });
  }
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

  const posThresholds = [5, 6, 7, 8, 9, 10];
  const negThresholds = [5, 6, 7, 8, 9, 10];

  const heroStats = Array.from({ length: data.heroes.length }, () => ({
    pos: new Map(), // t -> { games, wins }
    neg: new Map(), // t -> { games, wins }
  }));
  for (const hs of heroStats) {
    ensureStatsForThresholds(hs.pos, posThresholds);
    ensureStatsForThresholds(hs.neg, negThresholds);
  }

  for (const r of rows) {
    const radiantWin = Number(r[col.get("radiant_win")]) === 1;
    const direWin = Number(r[col.get("dire_win")]) === 1;

    const dHeroes = (r[col.get("dire_heroes")] || "").split("|");
    const rHeroes = (r[col.get("radiant_heroes")] || "").split("|");

    const dIdx = dHeroes.map((h) => nameToIndex.get(h)).filter((x) => x !== undefined);
    const rIdx = rHeroes.map((h) => nameToIndex.get(h)).filter((x) => x !== undefined);
    if (dIdx.length !== 5 || rIdx.length !== 5) continue;

    // Radiant heroes: compute adv vs Dire
    for (const idx of rIdx) {
      const adv = computeHeroAdvantageAgainstTeam(idx, dIdx, data);
      for (const t of posThresholds) {
        if (adv >= t) {
          const s = heroStats[idx].pos.get(t);
          s.games += 1;
          if (radiantWin) s.wins += 1;
        }
      }
      for (const t of negThresholds) {
        if (adv <= -t) {
          const s = heroStats[idx].neg.get(t);
          s.games += 1;
          if (radiantWin) s.wins += 1;
        }
      }
    }

    // Dire heroes: compute adv vs Radiant
    for (const idx of dIdx) {
      const adv = computeHeroAdvantageAgainstTeam(idx, rIdx, data);
      for (const t of posThresholds) {
        if (adv >= t) {
          const s = heroStats[idx].pos.get(t);
          s.games += 1;
          if (direWin) s.wins += 1;
        }
      }
      for (const t of negThresholds) {
        if (adv <= -t) {
          const s = heroStats[idx].neg.get(t);
          s.games += 1;
          if (direWin) s.wins += 1;
        }
      }
    }
  }

  const lines = ["hero_id,hero_name,threshold,games,accuracy"];
  for (let heroIndex = 0; heroIndex < heroStats.length; heroIndex++) {
    const heroName = data.heroes[heroIndex] ?? String(heroIndex);
    // Positive thresholds
    for (const t of posThresholds) {
      const s = heroStats[heroIndex].pos.get(t);
      const acc = s.games ? (s.wins / s.games) : 0;
      lines.push(`${heroIndex},${heroName},+${t},${s.games},${acc.toFixed(4)}`);
    }
    // Negative thresholds
    for (const t of negThresholds) {
      const s = heroStats[heroIndex].neg.get(t);
      const acc = s.games ? (s.wins / s.games) : 0;
      lines.push(`${heroIndex},${heroName},-${t},${s.games},${acc.toFixed(4)}`);
    }
  }

  fs.writeFileSync(path.join(outDir, "hero_adv_thresholds.csv"), lines.join("\n") + "\n", "utf8");
  console.log(`Wrote ${path.join(outDir, "hero_adv_thresholds.csv")}`);
}

if (require.main === module) {
  main();
}

