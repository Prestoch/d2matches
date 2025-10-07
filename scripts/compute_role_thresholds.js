"use strict";

const fs = require("fs");
const path = require("path");
const {
  loadCounterData,
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
  const m = new Map();
  heroes.forEach((n, i) => m.set(String(n), i));
  return m;
}

const ROLE_KEYS = ["carry", "mid", "offlane", "softsupport", "hardsupport"];

function coerceNumber(x, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function getRoleFitnessFor(heroIndex, role, data) {
  // Prefer D2PT per-role if available, else NW20, else NW10, else LaneAdv (can be negative)
  const d2ptArr = data.rolesD2pt && data.rolesD2pt[role];
  const d2pt = (d2ptArr && Array.isArray(d2ptArr) && d2ptArr[heroIndex] != null) ? Number(d2ptArr[heroIndex]) : NaN;
  if (Number.isFinite(d2pt)) return d2pt;
  const nw20Arr = data.roles && data.roles[role] && data.roles[role].nw20;
  const nw20 = (nw20Arr && Array.isArray(nw20Arr) && nw20Arr[heroIndex] != null) ? Number(nw20Arr[heroIndex]) : NaN;
  if (Number.isFinite(nw20)) return nw20;
  const nw10Arr = data.roles && data.roles[role] && data.roles[role].nw10;
  const nw10 = (nw10Arr && Array.isArray(nw10Arr) && nw10Arr[heroIndex] != null) ? Number(nw10Arr[heroIndex]) : NaN;
  if (Number.isFinite(nw10)) return nw10;
  const laArr = data.roles && data.roles[role] && data.roles[role].laneadv;
  const la = (laArr && Array.isArray(laArr) && laArr[heroIndex] != null) ? Number(laArr[heroIndex]) : NaN;
  return Number.isFinite(la) ? la : -Infinity;
}

function bestRoleAssignment(teamHeroIndices, data) {
  // Brute-force 5! permutations to assign exactly one of each role to 5 heroes maximizing total fitness
  const roles = ROLE_KEYS.slice();
  const heroes = teamHeroIndices.slice();
  const perms = [];
  function permute(arr, l) {
    if (l === arr.length - 1) { perms.push(arr.slice()); return; }
    for (let i = l; i < arr.length; i++) {
      [arr[l], arr[i]] = [arr[i], arr[l]];
      permute(arr, l + 1);
      [arr[l], arr[i]] = [arr[i], arr[l]];
    }
  }
  permute(roles, 0);

  let best = null;
  let bestScore = -Infinity;
  for (const assignment of perms) {
    let score = 0;
    let valid = true;
    for (let i = 0; i < heroes.length; i++) {
      const hero = heroes[i];
      const role = assignment[i];
      const fit = getRoleFitnessFor(hero, role, data);
      if (!Number.isFinite(fit) || fit === -Infinity) { valid = false; break; }
      score += fit;
    }
    if (valid && score > bestScore) {
      bestScore = score;
      best = assignment.slice();
    }
  }

  // Build map heroIndex -> role (fallback: carry)
  const map = new Map();
  if (best) {
    for (let i = 0; i < heroes.length; i++) map.set(heroes[i], best[i]);
  } else {
    for (const h of heroes) map.set(h, "carry");
  }
  return map;
}

function getKdaFor(heroIndex, role, data) {
  const arr = data.rolesDbWrKda && data.rolesDbWrKda[role] && data.rolesDbWrKda[role].kda;
  return coerceNumber(arr && arr[heroIndex], 0);
}

function getD2ptFor(heroIndex, role, data) {
  const arrRole = data.rolesD2pt && data.rolesD2pt[role];
  const byRole = coerceNumber(arrRole && arrRole[heroIndex], NaN);
  if (Number.isFinite(byRole)) return byRole;
  const flat = data.heroesD2pt && data.heroesD2pt[heroIndex];
  return coerceNumber(flat, 0);
}

function getNw10For(heroIndex, role, data) {
  const arrRole = data.roles && data.roles[role] && data.roles[role].nw10;
  const byRole = coerceNumber(arrRole && arrRole[heroIndex], NaN);
  if (Number.isFinite(byRole)) return byRole;
  const flat = data.heroesNw10 && data.heroesNw10[heroIndex];
  return coerceNumber(flat, 0);
}

function getNw20For(heroIndex, role, data) {
  const arrRole = data.roles && data.roles[role] && data.roles[role].nw20;
  const byRole = coerceNumber(arrRole && arrRole[heroIndex], NaN);
  if (Number.isFinite(byRole)) return byRole;
  const flat = data.heroesNw20 && data.heroesNw20[heroIndex];
  return coerceNumber(flat, 0);
}

function getLaneAdvFor(heroIndex, role, data) {
  const arrRole = data.roles && data.roles[role] && data.roles[role].laneadv;
  const byRole = coerceNumber(arrRole && arrRole[heroIndex], NaN);
  if (Number.isFinite(byRole)) return byRole;
  const flat = data.heroesLaneAdv && data.heroesLaneAdv[heroIndex];
  return coerceNumber(flat, 0);
}

function main() {
  const outDir = path.resolve(__dirname, "../out");
  const detailedPath = path.join(outDir, "matches_detailed.csv");
  if (!fs.existsSync(detailedPath)) {
    console.error("matches_detailed.csv not found");
    process.exit(1);
  }

  const data = loadCounterData();
  const nameToIndex = buildNameToIndex(data.heroes);

  const { header, rows } = readCsv(detailedPath);
  const col = new Map(header.map((h, i) => [h, i]));

  // Threshold series
  const deltaThr = Array.from({ length: 10 }, (_, i) => (i + 1) * 5); // 5..50
  const kdaThr = [1, 2, 3, 4, 5, 6];
  const d2ptThr = Array.from({ length: 10 }, (_, i) => (i + 1) * 500); // 500..5000
  const nw10Thr = Array.from({ length: 25 }, (_, i) => (i + 1) * 200); // 200..5000
  const nw20Thr = Array.from({ length: 20 }, (_, i) => (i + 1) * 500); // 500..10000
  const laneThr = Array.from({ length: 30 }, (_, i) => (i + 1) * 2); // 2..60

  function initStats(thresholds) {
    const m = new Map();
    for (const t of thresholds) m.set(t, { games: 0, wins: 0 });
    return m;
  }

  const stats = {
    delta: initStats(deltaThr),
    kda: initStats(kdaThr),
    d2pt: initStats(d2ptThr),
    nw10: initStats(nw10Thr),
    nw20: initStats(nw20Thr),
    lane: initStats(laneThr),
  };

  for (const r of rows) {
    const radiantWin = Number(r[col.get("radiant_win")]) === 1;

    // Parse hero lists
    const dHeroes = (r[col.get("dire_heroes")] || "").split("|").filter(Boolean);
    const rHeroes = (r[col.get("radiant_heroes")] || "").split("|").filter(Boolean);
    const dIdx = dHeroes.map((h) => nameToIndex.get(h)).filter((x) => x !== undefined);
    const rIdx = rHeroes.map((h) => nameToIndex.get(h)).filter((x) => x !== undefined);
    if (dIdx.length !== 5 || rIdx.length !== 5) continue;

    // Compute a per-team role assignment (one of each role) maximizing fitness
    const roleMapR = bestRoleAssignment(rIdx, data);
    const roleMapD = bestRoleAssignment(dIdx, data);

    // Sum metrics per team using assigned roles
    let sumKdaR = 0, sumKdaD = 0;
    let sumD2ptr = 0, sumD2ptd = 0;
    let sumNw10r = 0, sumNw10d = 0;
    let sumNw20r = 0, sumNw20d = 0;
    let sumLaneR = 0, sumLaneD = 0;

    for (const idx of rIdx) {
      const role = roleMapR.get(idx) || "carry";
      sumKdaR += getKdaFor(idx, role, data);
      sumD2ptr += getD2ptFor(idx, role, data);
      sumNw10r += getNw10For(idx, role, data);
      sumNw20r += getNw20For(idx, role, data);
      sumLaneR += getLaneAdvFor(idx, role, data);
    }
    for (const idx of dIdx) {
      const role = roleMapD.get(idx) || "carry";
      sumKdaD += getKdaFor(idx, role, data);
      sumD2ptd += getD2ptFor(idx, role, data);
      sumNw10d += getNw10For(idx, role, data);
      sumNw20d += getNw20For(idx, role, data);
      sumLaneD += getLaneAdvFor(idx, role, data);
    }

    const kdaDelta = sumKdaR - sumKdaD;
    const d2ptDelta = sumD2ptr - sumD2ptd;
    const nw10Delta = sumNw10r - sumNw10d;
    const nw20Delta = sumNw20r - sumNw20d;
    const laneDelta = sumLaneR - sumLaneD;

    // Delta from CSV (Radiant - Dire)
    const uiDelta = Number(r[col.get("delta")]);
    if (Number.isFinite(uiDelta)) {
      const abs = Math.abs(uiDelta);
      const favoredWon = (uiDelta >= 0) ? radiantWin : !radiantWin;
      for (const t of deltaThr) {
        if (abs >= t) {
          const s = stats.delta.get(t);
          s.games += 1;
          if (favoredWon) s.wins += 1;
        }
      }
    }

    function updateSeries(series, thresholds, delta, favoredRadiantWon) {
      const abs = Math.abs(delta);
      for (const t of thresholds) {
        if (abs >= t) {
          const s = series.get(t);
          s.games += 1;
          if (favoredRadiantWon) s.wins += 1;
        }
      }
    }

    updateSeries(stats.kda, kdaThr, kdaDelta, kdaDelta >= 0 ? radiantWin : !radiantWin);
    updateSeries(stats.d2pt, d2ptThr, d2ptDelta, d2ptDelta >= 0 ? radiantWin : !radiantWin);
    updateSeries(stats.nw10, nw10Thr, nw10Delta, nw10Delta >= 0 ? radiantWin : !radiantWin);
    updateSeries(stats.nw20, nw20Thr, nw20Delta, nw20Delta >= 0 ? radiantWin : !radiantWin);
    updateSeries(stats.lane, laneThr, laneDelta, laneDelta >= 0 ? radiantWin : !radiantWin);
  }

  // Write outputs
  const lines = [
    "metric,threshold,games,accuracy",
  ];
  function pushSeries(name, series, thresholds) {
    for (const t of thresholds) {
      const s = series.get(t) || { games: 0, wins: 0 };
      const acc = s.games ? (s.wins / s.games) : 0;
      lines.push(`${name},${t},${s.games},${acc.toFixed(4)}`);
    }
  }
  pushSeries("delta", stats.delta, deltaThr);
  pushSeries("kda", stats.kda, kdaThr);
  pushSeries("d2pt", stats.d2pt, d2ptThr);
  pushSeries("nw10", stats.nw10, nw10Thr);
  pushSeries("nw20", stats.nw20, nw20Thr);
  pushSeries("laneadv", stats.lane, laneThr);

  const outSummary = path.join(outDir, "role_thresholds_summary.csv");
  fs.writeFileSync(outSummary, lines.join("\n") + "\n", "utf8");

  console.log(`Wrote ${outSummary}`);
}

if (require.main === module) {
  main();
}
