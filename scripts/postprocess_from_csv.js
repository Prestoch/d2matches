"use strict";

const fs = require("fs");
const path = require("path");

function loadMatchesCsv(csvPath) {
  const raw = fs.readFileSync(csvPath, "utf8").trim().split(/\r?\n/);
  const header = raw.shift();
  const idx = header.split(",");
  const idxMap = new Map(idx.map((k, i) => [k, i]));
  const rows = raw.map((line) => line.split(",")).map((cols) => ({
    match_id: cols[idxMap.get("match_id")],
    delta: Number(cols[idxMap.get("delta")]),
    max_hero_adv: Number(cols[idxMap.get("max_hero_adv")]),
    radiant_win: cols[idxMap.get("radiant_win")] === "1",
  }));
  return rows;
}

function computeDeltaThresholds(rows, thresholds) {
  const out = [];
  for (const t of thresholds) {
    let games = 0;
    let wins = 0;
    for (const r of rows) {
      const absDelta = Math.abs(r.delta);
      if (absDelta >= t) {
        games += 1;
        const favoredRadiant = r.delta >= 0; // positive delta favors radiant
        const favoredWon = favoredRadiant ? r.radiant_win : !r.radiant_win;
        if (favoredWon) wins += 1;
      }
    }
    const acc = games ? wins / games : 0;
    out.push({ threshold: t, games, accuracy: acc });
  }
  return out;
}

function binByDelta(delta) {
  if (delta <= -20) return "<=-20";
  if (delta >= 20) return ">=20";
  const b = Math.floor(delta / 2) * 2;
  const hi = b + 2;
  return `${b}..${hi}`;
}

function computeDeltaBins(rows) {
  const bins = new Map(); // bin -> { games, radiantWins }
  for (const r of rows) {
    const b = binByDelta(r.delta);
    const agg = bins.get(b) || { games: 0, radiantWins: 0 };
    agg.games += 1;
    agg.radiantWins += r.radiant_win ? 1 : 0;
    bins.set(b, agg);
  }
  const sorted = Array.from(bins.entries()).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
  return sorted.map(([bin, s]) => ({
    bin,
    games: s.games,
    radiant_win_rate: s.games ? s.radiantWins / s.games : 0,
    dire_win_rate: s.games ? (s.games - s.radiantWins) / s.games : 0,
  }));
}

function main() {
  const csvPath = path.resolve(__dirname, "../out/matches.csv");
  const rows = loadMatchesCsv(csvPath);
  const thresholds = [];
  for (let t = 2; t <= 50; t += 2) thresholds.push(t);
  const stats = computeDeltaThresholds(rows, thresholds);
  const lines = ["threshold,games,accuracy"].concat(
    stats.map((s) => `${s.threshold},${s.games},${s.accuracy.toFixed(4)}`)
  );
  const outPath = path.resolve(__dirname, "../out/delta_thresholds.csv");
  fs.writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
  const best = stats.reduce((a, b) => (b.games >= 20 && b.accuracy > (a?.accuracy ?? -1) ? b : a), null);
  const summary = {
    sample_matches: rows.length,
    recommended_delta_threshold: best ? best.threshold : null,
    expected_accuracy: best ? best.accuracy : null,
    coverage_games: best ? best.games : null,
  };
  fs.writeFileSync(path.resolve(__dirname, "../out/betting_signal.json"), JSON.stringify(summary, null, 2), "utf8");

  // Write delta bins with both radiant and dire win rates
  const bins = computeDeltaBins(rows);
  const binLines = ["bin,games,radiant_win_rate,dire_win_rate"].concat(
    bins.map((b) => `${b.bin},${b.games},${b.radiant_win_rate.toFixed(4)},${b.dire_win_rate.toFixed(4)}`)
  );
  fs.writeFileSync(path.resolve(__dirname, "../out/delta_bins.csv"), binLines.join("\n") + "\n", "utf8");

  // (removed) favored_bins.csv generation to reduce redundancy; info is present in delta_bins.csv

  // Detailed thresholds split by favored side
  const detailed = ["threshold,games,accuracy,radiant_favored_games,radiant_favored_accuracy,dire_favored_games,dire_favored_accuracy"]; 
  for (const t of thresholds) {
    let games = 0, wins = 0;
    let rGames = 0, rWins = 0;
    let dGames = 0, dWins = 0;
    for (const r of rows) {
      if (Math.abs(r.delta) >= t) {
        games++;
        const favoredRadiant = r.delta >= 0;
        const favoredWon = favoredRadiant ? r.radiant_win : !r.radiant_win;
        if (favoredWon) wins++;
        if (favoredRadiant) {
          rGames++;
          if (r.radiant_win) rWins++;
        } else {
          dGames++;
          if (!r.radiant_win) dWins++;
        }
      }
    }
    const acc = games ? wins / games : 0;
    const rAcc = rGames ? rWins / rGames : 0;
    const dAcc = dGames ? dWins / dGames : 0;
    detailed.push([t, games, acc.toFixed(4), rGames, rAcc.toFixed(4), dGames, dAcc.toFixed(4)].join(","));
  }
  fs.writeFileSync(path.resolve(__dirname, "../out/delta_thresholds_detailed.csv"), detailed.join("\n") + "\n", "utf8");

  // Direction-specific thresholds combined into one CSV
  const combinedLines = ["threshold,radiant_games,radiant_accuracy,dire_games,dire_accuracy"]; 
  for (const t of thresholds) {
    let rGames = 0, rWins = 0;
    let dGames = 0, dWins = 0;
    for (const r of rows) {
      if (r.delta >= t) { rGames++; if (r.radiant_win) rWins++; }
      if (r.delta <= -t) { dGames++; if (!r.radiant_win) dWins++; }
    }
    const rAcc = (rGames? rWins/rGames : 0);
    const dAcc = (dGames? dWins/dGames : 0);
    combinedLines.push(`${t},${rGames},${rAcc.toFixed(4)},${dGames},${dAcc.toFixed(4)}`);
  }
  fs.writeFileSync(path.resolve(__dirname, "../out/thresholds_combined.csv"), combinedLines.join("\n") + "\n", "utf8");
}

if (require.main === module) {
  main();
}

