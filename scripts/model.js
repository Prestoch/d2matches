"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

/**
 * Loads counter data from config files into a sandbox and returns a structured object.
 *
 * Backwards compatibility:
 * - Legacy single file: cs.json (JS snippet)
 * - New split config: cs_db.json (+ optional cs_d2pt.json)
 *
 * Accepts either a string path (legacy) or an options object:
 *   loadCounterData({ db: ".../cs_db.json", d2pt: ".../cs_d2pt.json" })
 */
function loadCounterData(csPathOrOptions = undefined) {
  const baseDir = path.resolve(__dirname, "../");

  const filesToLoad = [];
  if (typeof csPathOrOptions === "string") {
    if (fs.existsSync(csPathOrOptions)) filesToLoad.push(csPathOrOptions);
  } else if (csPathOrOptions && typeof csPathOrOptions === "object") {
    const { db, d2pt } = csPathOrOptions;
    if (db && fs.existsSync(db)) filesToLoad.push(db);
    if (d2pt && fs.existsSync(d2pt)) filesToLoad.push(d2pt);
  }

  if (filesToLoad.length === 0) {
    const dbDefault = path.join(baseDir, "cs_db.json");
    const d2ptDefault = path.join(baseDir, "cs_d2pt.json");
    const legacy = path.join(baseDir, "cs.json");
    if (fs.existsSync(dbDefault)) filesToLoad.push(dbDefault);
    if (fs.existsSync(d2ptDefault)) filesToLoad.push(d2ptDefault);
    if (filesToLoad.length === 0 && fs.existsSync(legacy)) filesToLoad.push(legacy);
  }

  if (filesToLoad.length === 0) {
    throw new Error(
      "No config files found. Expected cs_db.json/cs_d2pt.json or legacy cs.json"
    );
  }

  const context = Object.create(null);
  // Provide minimal globals to avoid ReferenceErrors
  context.console = console;
  vm.createContext(context);

  for (const filePath of filesToLoad) {
    const fileContent = fs.readFileSync(filePath, "utf8");
    vm.runInContext(fileContent, context, { filename: path.basename(filePath) });
  }

  const heroes = context.heroes || [];
  const heroesBg = context.heroes_bg || [];
  const heroesWrRaw = context.heroes_wr || [];
  const winRatesRaw = context.win_rates || [];
  const updateTime = context.update_time || "";

  const heroesWr = heroesWrRaw.map((v) => (v == null ? 0 : Number(v)));

  // win_rates[i][j] = [ advantagePct, wr_vsPct, matches ]
  // Coerce missing values to [0, 0, 0]
  const winRates = winRatesRaw.map((row) =>
    (row || []).map((cell) => {
      if (!cell) return [0, 0, 0];
      const a = Number(cell[0] ?? 0);
      const b = Number(cell[1] ?? 0);
      const c = Number(cell[2] ?? 0);
      return [a, b, c];
    })
  );

  return { heroes, heroesBg, heroesWr, winRates, updateTime };
}

/**
 * Normalizes hero names to a comparable key (lowercased, hyphens/apostrophes removed, spaces collapsed).
 */
function normalizeHeroName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[-_.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Computes per-hero advantage of a single hero against an opponent team
 * using the same logic as the UI: sum of win_rates[opponent][hero][0].
 *
 * @param {number} heroIndex - index in heroes array for the hero whose advantage we compute
 * @param {number[]} opponentTeamIndices - indices of the opposing team heroes
 * @param {object} data - counter data from loadCounterData
 * @returns {number}
 */
function computeHeroAdvantageAgainstTeam(heroIndex, opponentTeamIndices, data) {
  const { winRates } = data;
  let total = 0;
  for (const opponentIndex of opponentTeamIndices) {
    if (opponentIndex == null || opponentIndex < 0) continue;
    // Match UI logic effective sum: add advantage(hero vs opponent)
    // Stored as win_rates[opponent][hero][0] (advantage of hero vs opponent)
    if (winRates[opponentIndex] && winRates[opponentIndex][heroIndex]) {
      total += Number(winRates[opponentIndex][heroIndex][0] || 0);
    }
  }
  return total;
}

/**
 * Computes team score for a team against an opposing team using the UI logic:
 * sum of each hero's base win rate + sum of per-hero advantages versus opponents.
 *
 * @param {number[]} teamIndices
 * @param {number[]} opponentIndices
 * @param {object} data
 * @returns {{score:number, perHeroAdvantages:number[]}}
 */
function computeTeamScore(teamIndices, opponentIndices, data) {
  const { heroesWr } = data;
  let base = 0;
  const perHeroAdvantages = [];
  for (const idx of teamIndices) {
    base += Number(heroesWr[idx] || 0);
  }
  for (const heroIndex of teamIndices) {
    const adv = computeHeroAdvantageAgainstTeam(heroIndex, opponentIndices, data);
    perHeroAdvantages.push(adv);
    base += adv;
  }
  return { score: base, perHeroAdvantages };
}

/**
 * Computes the delta score shown in the UI (radiantScore - direScore).
 */
function computeDelta(radiantIndices, direIndices, data) {
  const r = computeTeamScore(radiantIndices, direIndices, data).score;
  const d = computeTeamScore(direIndices, radiantIndices, data).score;
  return r - d;
}

/**
 * Returns maximum per-hero advantage across both teams (positive direction).
 */
function computeMaxHeroAdvantage(radiantIndices, direIndices, data) {
  const r = computeTeamScore(radiantIndices, direIndices, data).perHeroAdvantages;
  const d = computeTeamScore(direIndices, radiantIndices, data).perHeroAdvantages;
  return Math.max(...r, ...d);
}

module.exports = {
  loadCounterData,
  normalizeHeroName,
  computeHeroAdvantageAgainstTeam,
  computeTeamScore,
  computeDelta,
  computeMaxHeroAdvantage,
};

