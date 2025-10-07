"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const { URL } = require("url");
const {
  loadCounterData,
  computeTeamScore,
  computeDelta,
  computeMaxHeroAdvantage,
} = require("./model");

const OPEN_DOTA_BASE = process.env.OPEN_DOTA_BASE || "https://api.opendota.com/api";
const OPEN_DOTA_API_KEY = process.env.OPEN_DOTA_API_KEY || process.env.OPENDOTA_API_KEY || "";
const INCREMENTAL_APPEND = String(process.env.INCREMENTAL_APPEND || process.env.APPEND || "").trim() === "1";
const TARGET_TOTAL = Number(process.env.TARGET_TOTAL || 0);
const MATCHES_ONLY = String(process.env.MATCHES_ONLY || process.env.SKIP_DETAILS || "").trim() === "1";
const MAX_RPM = Number(process.env.MAX_RPM || 1200); // OpenDota paid limit
const APPEND_BATCH_SIZE = Number(process.env.APPEND_BATCH_SIZE || 2000);
const DAYS = Number(process.env.DAYS || 365);
const LIMIT = Number(process.env.LIMIT || 20000);
const MAX_REQUESTS = Number(process.env.MAX_REQUESTS || 500);
const SLEEP_MS = Number(process.env.SLEEP_MS || 300);
const DETAIL_CONCURRENCY = Number(process.env.DETAIL_CONCURRENCY || 5);
const DETAIL_SLEEP_MS = Number(process.env.DETAIL_SLEEP_MS || 200);
const RETRIES = Number(process.env.RETRIES || 5);
const SCRAPE_DO_TOKEN = process.env.SCRAPE_DO_TOKEN || "";

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Global token-bucket rate limiter (MAX_RPM tokens per minute)
let __tokens = MAX_RPM;
let __lastRefill = Date.now();
function __refillTokens() {
  const now = Date.now();
  const elapsedMs = now - __lastRefill;
  if (elapsedMs <= 0) return;
  const tokensToAdd = (elapsedMs / 60000) * MAX_RPM;
  if (tokensToAdd > 0) {
    __tokens = Math.min(MAX_RPM, __tokens + tokensToAdd);
    __lastRefill = now;
  }
}
async function rateLimitAcquire() {
  // Fast path if limiter disabled or rpm invalid
  if (!Number.isFinite(MAX_RPM) || MAX_RPM <= 0) return;
  while (true) {
    __refillTokens();
    if (__tokens >= 1) {
      __tokens -= 1;
      return;
    }
    // Sleep until next token likely available
    const waitMs = Math.max(25, Math.ceil(60000 / MAX_RPM));
    await sleep(waitMs);
  }
}

async function httpGetJson(url, attempt = 0) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const options = {
      method: "GET",
      headers: {
        "User-Agent": "model-analysis/1.0",
        Accept: "application/json",
      },
    };
    const req = https.request(u, options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        } else if (res.statusCode === 429) {
          // Backoff and retry
          resolve({ __rate_limited: true, body: data });
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function appendApiKey(url) {
  if (!OPEN_DOTA_API_KEY) return url;
  try {
    const u = new URL(url);
    // Only append to OpenDota base URLs
    if (!String(u.origin + u.pathname).startsWith(OPEN_DOTA_BASE)) return url;
    if (!u.searchParams.has("api_key")) u.searchParams.set("api_key", OPEN_DOTA_API_KEY);
    return u.toString();
  } catch (_) {
    // Fallback: naive append
    return url + (url.includes("?") ? "&" : "?") + `api_key=${encodeURIComponent(OPEN_DOTA_API_KEY)}`;
  }
}

async function fetchJsonWithRetry(url, maxRetries = RETRIES, baseDelayMs = 1000) {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      await rateLimitAcquire();
      const r = await httpGetJson(appendApiKey(url));
      if (r && r.__rate_limited) {
        const delay = baseDelayMs * Math.pow(2, i);
        await sleep(delay);
        continue;
      }
      return r;
    } catch (e) {
      const delay = baseDelayMs * Math.pow(2, i);
      await sleep(delay);
      if (i === maxRetries) throw e;
    }
  }
}

async function fetchViaScrapeDo(url) {
  if (!SCRAPE_DO_TOKEN) return null;
  const proxied = `https://api.scrape.do?token=${encodeURIComponent(SCRAPE_DO_TOKEN)}&url=${encodeURIComponent(appendApiKey(url))}`;
  try {
    const r = await fetchJsonWithRetry(proxied, RETRIES, 1000);
    return r;
  } catch (_) {
    return null;
  }
}

async function fetchHeroList() {
  // Prefer constants endpoint (stable, low rate-limit impact)
  // https://docs.opendota.com/#tag/constants/operation/constants_heroes
  try {
    const constants = await fetchJsonWithRetry(`${OPEN_DOTA_BASE}/constants/heroes`, RETRIES, 1000);
    if (constants && typeof constants === "object" && !Array.isArray(constants)) {
      const list = Object.values(constants).map((h) => ({
        id: Number(h.id),
        localized_name: h.localized_name,
        name: h.name,
      }));
      if (Array.isArray(list) && list.length > 0) return list;
    }
  } catch (_) {
    // fall through
  }

  // Try constants via Scrape.do proxy
  try {
    const constantsProxy = await fetchViaScrapeDo(`${OPEN_DOTA_BASE}/constants/heroes`);
    if (constantsProxy && typeof constantsProxy === "object" && !Array.isArray(constantsProxy)) {
      const list = Object.values(constantsProxy).map((h) => ({
        id: Number(h.id),
        localized_name: h.localized_name,
        name: h.name,
      }));
      if (Array.isArray(list) && list.length > 0) return list;
    }
  } catch (_) {}

  // Fallback: /heroStats
  try {
    const data = await fetchJsonWithRetry(`${OPEN_DOTA_BASE}/heroStats`, RETRIES, 1000);
    if (Array.isArray(data) && data.length > 0) return data;
  } catch (_) {
    // fall through
  }

  try {
    const dataProxy = await fetchViaScrapeDo(`${OPEN_DOTA_BASE}/heroStats`);
    if (Array.isArray(dataProxy) && dataProxy.length > 0) return dataProxy;
  } catch (_) {}

  // Fallback: /heroes
  try {
    const alt = await fetchJsonWithRetry(`${OPEN_DOTA_BASE}/heroes`, RETRIES, 1000);
    if (Array.isArray(alt) && alt.length > 0) {
      return alt.map((h) => ({ id: h.id, localized_name: h.localized_name, name: h.name }));
    }
  } catch (_) {
    // fall through
  }

  try {
    const altProxy = await fetchViaScrapeDo(`${OPEN_DOTA_BASE}/heroes`);
    if (Array.isArray(altProxy) && altProxy.length > 0) {
      return altProxy.map((h) => ({ id: h.id, localized_name: h.localized_name, name: h.name }));
    }
  } catch (_) {}

  throw new Error("Failed to fetch hero list");
}

function loadCachedHeroList(cachePath) {
  try {
    const txt = require("fs").readFileSync(cachePath, "utf8");
    const j = JSON.parse(txt);
    if (Array.isArray(j) && j.length > 0) return j;
  } catch (_) {}
  return null;
}

function saveCachedHeroList(cachePath, list) {
  try {
    require("fs").mkdirSync(require("path").dirname(cachePath), { recursive: true });
    require("fs").writeFileSync(cachePath, JSON.stringify(list, null, 2), "utf8");
  } catch (_) {}
}

function buildHeroIdToIndexMap(openDotaHeroes, modelData) {
  // OpenDota provides id, localized_name, name (npc_dota_hero_*)
  const nameToIndex = new Map();
  modelData.heroes.forEach((n, i) => nameToIndex.set(n.toLowerCase(), i));

  const idToIndex = new Map();
  const list = Array.isArray(openDotaHeroes)
    ? openDotaHeroes
    : (openDotaHeroes && typeof openDotaHeroes === "object")
      ? Object.values(openDotaHeroes)
      : [];
  for (const h of list) {
    const namesToTry = [h.localized_name, (h.localized_name || "").replace(/-/g, " ")];
    let idx = undefined;
    for (const candidate of namesToTry) {
      const k = String(candidate || "").toLowerCase();
      if (nameToIndex.has(k)) {
        idx = nameToIndex.get(k);
        break;
      }
    }
    if (idx === undefined) {
      // Try common variations
      const alt = (h.localized_name || "").toLowerCase()
        .replace(/’/g, "")
        .replace(/'/g, "")
        .replace(/-/g, " ")
        .replace(/ +/g, " ")
        .trim();
      if (nameToIndex.has(alt)) idx = nameToIndex.get(alt);
    }
    if (idx !== undefined) idToIndex.set(h.id, idx);
  }
  return idToIndex;
}

async function fetchProMatchesPaginated({ days = DAYS, limit = LIMIT, maxRequests = MAX_REQUESTS, sleepMs = SLEEP_MS }) {
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
  let lastId = undefined;
  const out = [];
  for (let req = 0; req < maxRequests && out.length < limit; req++) {
    const url = lastId ? `${OPEN_DOTA_BASE}/proMatches?less_than_match_id=${lastId}` : `${OPEN_DOTA_BASE}/proMatches`;
    let page = await fetchJsonWithRetry(url, RETRIES, 1000);
    if (!Array.isArray(page) || page.length === 0) {
      const prox = await fetchViaScrapeDo(url);
      if (Array.isArray(prox) && prox.length > 0) {
        page = prox;
      } else {
        console.log(`[proMatches] empty page at req=${req + 1}, stopping.`);
        break;
      }
    }
    out.push(...page);
    lastId = page[page.length - 1].match_id;
    // Stop early if we've paged beyond cutoff
    const minStart = page.reduce((a, b) => Math.min(a, b.start_time || a), Number.MAX_SAFE_INTEGER);
    console.log(`[proMatches] page=${req + 1} got=${page.length} last_id=${lastId} min_start=${minStart} total=${out.length}`);
    if (minStart < cutoff) break;
    if (sleepMs) await new Promise((r) => setTimeout(r, sleepMs));
  }
  const filtered = out.filter((m) => (m.start_time || 0) >= cutoff);
  // De-duplicate by match_id and slice to limit
  const seen = new Set();
  const uniq = [];
  for (const m of filtered) {
    if (seen.has(m.match_id)) continue;
    seen.add(m.match_id);
    uniq.push(m);
  }
  return uniq.slice(0, limit);
}

// Incremental variant: stop as soon as enough new non-duplicate candidates are found
async function fetchProMatchesPaginatedIncremental({ days = DAYS, limit = LIMIT, maxRequests = MAX_REQUESTS, sleepMs = SLEEP_MS, existingSet, needNew }) {
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
  let lastId = undefined;
  const seen = new Set();
  const newCandidates = [];
  for (let req = 0; req < maxRequests && newCandidates.length < needNew && (seen.size < limit); req++) {
    const url = lastId ? `${OPEN_DOTA_BASE}/proMatches?less_than_match_id=${lastId}` : `${OPEN_DOTA_BASE}/proMatches`;
    let page = await fetchJsonWithRetry(url, RETRIES, 1000);
    if (!Array.isArray(page) || page.length === 0) {
      const prox = await fetchViaScrapeDo(url);
      if (Array.isArray(prox) && prox.length > 0) {
        page = prox;
      } else {
        console.log(`[proMatches] empty page at req=${req + 1}, stopping.`);
        break;
      }
    }
    lastId = page[page.length - 1].match_id;
    const minStart = page.reduce((a, b) => Math.min(a, b.start_time || a), Number.MAX_SAFE_INTEGER);
    let addedThisPage = 0;
    for (const m of page) {
      if ((m.start_time || 0) < cutoff) continue;
      if (seen.has(m.match_id)) continue;
      seen.add(m.match_id);
      if (existingSet && existingSet.has(String(m.match_id))) continue;
      newCandidates.push(m);
      addedThisPage++;
      if (newCandidates.length >= needNew) break;
      if (seen.size >= limit) break;
    }
    console.log(`[proMatches-inc] page=${req + 1} got=${page.length} last_id=${lastId} min_start=${minStart} new_added=${addedThisPage} new_total=${newCandidates.length}`);
    if (minStart < cutoff) break;
    if (sleepMs) await new Promise((r) => setTimeout(r, sleepMs));
  }
  return newCandidates;
}

async function fetchMatchDetailsThrottled(ids, concurrency = DETAIL_CONCURRENCY, sleepMs = DETAIL_SLEEP_MS) {
  let index = 0;
  const results = [];
  const errors = [];
  let processed = 0;
  async function worker() {
    while (true) {
      const i = index++;
      if (i >= ids.length) break;
      const match_id = ids[i];
      try {
        let detail = await fetchJsonWithRetry(`${OPEN_DOTA_BASE}/matches/${match_id}`, RETRIES, 1000);
        if (!detail || !detail.match_id) {
          const prox = await fetchViaScrapeDo(`${OPEN_DOTA_BASE}/matches/${match_id}`);
          if (prox && prox.match_id) detail = prox;
        }
        if (detail && detail.match_id) results.push(detail); else errors.push({ match_id, error: 'empty' });
      } catch (e) {
        errors.push({ match_id, error: String(e) });
      }
      if (sleepMs) await sleep(sleepMs);
      processed++;
      if (processed % 200 === 0) {
        console.log(`[details] processed=${processed}/${ids.length} results=${results.length} errors=${errors.length}`);
      }
    }
  }
  const workers = [];
  const c = Math.max(1, concurrency);
  for (let w = 0; w < c; w++) workers.push(worker());
  await Promise.all(workers);
  return { results, errors };
}

function extractTeamsFromMatch(detail, idToIndex) {
  // Primary: players[].hero_id with isRadiant or player_slot
  if (Array.isArray(detail.players)) {
    const r = [];
    const d = [];
    for (const p of detail.players) {
      const heroId = Number(p.hero_id || 0);
      if (!heroId) continue;
      const idx = idToIndex.get(heroId);
      if (idx === undefined) { /* mapping gap; try fallback later */ continue; }
      const isRad = (p.isRadiant !== undefined) ? !!p.isRadiant : (Number(p.player_slot) < 128);
      if (isRad) r.push(idx); else d.push(idx);
    }
    if (r.length === 5 && d.length === 5) return { radiant: r, dire: d };
  }
  // Fallback: picks_bans with is_pick and team (0=radiant,1=dire)
  const pb = detail.picks_bans;
  if (Array.isArray(pb)) {
    const r = [];
    const d = [];
    for (const x of pb) {
      if (!x || x.is_pick !== true) continue;
      const heroId = Number(x.hero_id || 0);
      if (!heroId) continue;
      const idx = idToIndex.get(heroId);
      if (idx === undefined) continue;
      if (x.team === 0 && r.length < 5) r.push(idx);
      if (x.team === 1 && d.length < 5) d.push(idx);
      if (r.length === 5 && d.length === 5) break;
    }
    if (r.length === 5 && d.length === 5) return { radiant: r, dire: d };
  }
  return null;
}

function binByDelta(delta) {
  // 2-pt bins from -20 to 20, with tails
  if (delta <= -20) return "<=-20";
  if (delta >= 20) return ">=20";
  const b = Math.floor(delta / 2) * 2; // e.g., -1.2 -> -2, 5.9 -> 4
  const hi = b + 2;
  return `${b}..${hi}`;
}

function readExistingMatchesCsv(csvPath) {
  try {
    if (!fs.existsSync(csvPath)) return { rows: [], set: new Set() };
    const text = fs.readFileSync(csvPath, "utf8").trim();
    if (!text) return { rows: [], set: new Set() };
    const lines = text.split(/\r?\n/);
    if (lines.length <= 1) return { rows: [], set: new Set() };
    const header = lines.shift().split(",");
    const map = new Map(header.map((h, i) => [h, i]));
    const rows = [];
    const set = new Set();
    for (const line of lines) {
      const c = line.split(",");
      const match_id = c[map.get("match_id")];
      if (match_id != null) set.add(String(match_id));
      rows.push(line);
    }
    return { rows, set };
  } catch (_) {
    return { rows: [], set: new Set() };
  }
}

async function main() {
  const outDir = path.resolve(__dirname, "../out");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const existingCsvPath = path.join(outDir, "matches.csv");
  const existing = readExistingMatchesCsv(existingCsvPath);
  const existingCount = existing.rows.length;
  if (INCREMENTAL_APPEND && TARGET_TOTAL > 0 && existingCount >= TARGET_TOTAL) {
    console.log(`[append] Existing matches >= target (${existingCount} >= ${TARGET_TOTAL}). Nothing to do.`);
    return;
  }

  const data = loadCounterData(path.resolve(__dirname, "../cs.json"));
  const cachePath = path.resolve(__dirname, "../out/hero_list.json");
  let openDotaHeroes = loadCachedHeroList(cachePath);
  if (!openDotaHeroes) {
    openDotaHeroes = await fetchHeroList();
    if (Array.isArray(openDotaHeroes)) saveCachedHeroList(cachePath, openDotaHeroes);
  }
  const idToIndex = buildHeroIdToIndexMap(openDotaHeroes || [], data);

  let candidates;
  if (INCREMENTAL_APPEND) {
    // Stream-style incremental: fetch pages, and as soon as we have a batch of new candidates, fetch details and append
    const need = TARGET_TOTAL > 0 ? Math.max(0, TARGET_TOTAL - existingCount) : LIMIT;
    const cutoff = Math.floor(Date.now() / 1000) - DAYS * 86400;
    let lastId = undefined;
    const seen = new Set();
    const matchesPath = path.join(outDir, "matches.csv");
    const matchesHeader = "match_id,delta,max_hero_adv,radiant_win,dire_win\n";
    if (!fs.existsSync(matchesPath)) fs.writeFileSync(matchesPath, matchesHeader, "utf8");
    let found = 0;
    let totalAppended = 0;
    let req = 0;
    let batch = [];
    while (found < need && req < MAX_REQUESTS) {
      req++;
      const url = lastId ? `${OPEN_DOTA_BASE}/proMatches?less_than_match_id=${lastId}` : `${OPEN_DOTA_BASE}/proMatches`;
      let page = await fetchJsonWithRetry(url, RETRIES, 1000);
      if (!Array.isArray(page) || page.length === 0) {
        const prox = await fetchViaScrapeDo(url);
        if (Array.isArray(prox) && prox.length > 0) {
          page = prox;
        } else {
          console.log(`[proMatches-inc] empty page at req=${req}, stopping.`);
          break;
        }
      }
      lastId = page[page.length - 1].match_id;
      const minStart = page.reduce((a, b) => Math.min(a, b.start_time || a), Number.MAX_SAFE_INTEGER);
      let added = 0;
      for (const m of page) {
        if ((m.start_time || 0) < cutoff) continue;
        if (seen.has(m.match_id)) continue;
        seen.add(m.match_id);
        if (existing.set.has(String(m.match_id))) continue;
        batch.push(m.match_id);
        found++;
        added++;
        if (batch.length >= APPEND_BATCH_SIZE) {
          const { results: batchResults, errors: batchErrors } = await fetchMatchDetailsThrottled(batch, DETAIL_CONCURRENCY, DETAIL_SLEEP_MS);
          console.log(`[append] details batch results=${batchResults.length} errors=${batchErrors.length}`);
          const newLines = [];
          for (const match of batchResults) {
            const teams = extractTeamsFromMatch(match, idToIndex);
            if (!teams) continue;
            const { radiant, dire } = teams;
            const rTeam = computeTeamScore(radiant, dire, data);
            const dTeam = computeTeamScore(dire, radiant, data);
            const delta = rTeam.score - dTeam.score;
            const rMax = Math.max(...rTeam.perHeroAdvantages);
            const dMax = Math.max(...dTeam.perHeroAdvantages);
            const maxHeroAdv = Math.max(rMax, dMax);
            const radiantWon = match.radiant_win === true;
            const rw = radiantWon ? 1 : 0;
            const dw = radiantWon ? 0 : 1;
            newLines.push(`${match.match_id},${delta.toFixed(2)},${maxHeroAdv.toFixed(2)},${rw},${dw}`);
          }
          if (newLines.length) {
            fs.appendFileSync(matchesPath, newLines.join("\n") + "\n", "utf8");
            totalAppended += newLines.length;
            console.log(`[append] appended=${newLines.length} total_appended=${totalAppended} file_est=${existingCount + totalAppended}`);
          }
          batch = [];
          if (TARGET_TOTAL > 0 && existingCount + totalAppended >= TARGET_TOTAL) {
            console.log(`[append] Reached target total ${TARGET_TOTAL}. Stopping.`);
            return;
          }
        }
        if (found >= need) break;
      }
      console.log(`[proMatches-inc] page=${req} got=${page.length} last_id=${lastId} min_start=${minStart} new_added=${added} new_total=${found}`);
      if (minStart < cutoff) break;
      if (SLEEP_MS) await new Promise((r) => setTimeout(r, SLEEP_MS));
    }
    if (batch.length) {
      const { results: batchResults, errors: batchErrors } = await fetchMatchDetailsThrottled(batch, DETAIL_CONCURRENCY, DETAIL_SLEEP_MS);
      console.log(`[append] details final results=${batchResults.length} errors=${batchErrors.length}`);
      const newLines = [];
      for (const match of batchResults) {
        const teams = extractTeamsFromMatch(match, idToIndex);
        if (!teams) continue;
        const { radiant, dire } = teams;
        const rTeam = computeTeamScore(radiant, dire, data);
        const dTeam = computeTeamScore(dire, radiant, data);
        const delta = rTeam.score - dTeam.score;
        const rMax = Math.max(...rTeam.perHeroAdvantages);
        const dMax = Math.max(...dTeam.perHeroAdvantages);
        const maxHeroAdv = Math.max(rMax, dMax);
        const radiantWon = match.radiant_win === true;
        const rw = radiantWon ? 1 : 0;
        const dw = radiantWon ? 0 : 1;
        newLines.push(`${match.match_id},${delta.toFixed(2)},${maxHeroAdv.toFixed(2)},${rw},${dw}`);
      }
      if (newLines.length) {
        fs.appendFileSync(matchesPath, newLines.join("\n") + "\n", "utf8");
        console.log(`[append] appended=${newLines.length} (final)`);
      }
    }
    return;
  } else {
    const proMatches = await fetchProMatchesPaginated({ days: DAYS, limit: LIMIT, maxRequests: MAX_REQUESTS, sleepMs: SLEEP_MS });
    console.log(`Fetched pro matches: ${Array.isArray(proMatches) ? proMatches.length : 0}`);
    candidates = proMatches;
  }
  const matchIds = candidates.map((m) => m.match_id);

  // Streaming append path: process in batches and append to matches.csv after each batch
  if (INCREMENTAL_APPEND) {
    let totalAppended = 0;
    const matchesHeader = "match_id,delta,max_hero_adv,radiant_win,dire_win\n";
    const matchesPath = path.join(outDir, "matches.csv");
    const exists = fs.existsSync(matchesPath);
    if (!exists) fs.writeFileSync(matchesPath, matchesHeader, "utf8");

    for (let i = 0; i < matchIds.length; i += APPEND_BATCH_SIZE) {
      const slice = matchIds.slice(i, i + APPEND_BATCH_SIZE);
      const { results: batchResults, errors: batchErrors } = await fetchMatchDetailsThrottled(slice, DETAIL_CONCURRENCY, DETAIL_SLEEP_MS);
      console.log(`[append] details batch ${Math.floor(i / APPEND_BATCH_SIZE) + 1} results=${batchResults.length} errors=${batchErrors.length}`);

      const newLines = [];
      for (const match of batchResults) {
        const teams = extractTeamsFromMatch(match, idToIndex);
        if (!teams) continue;
        const { radiant, dire } = teams;
        const rTeam = computeTeamScore(radiant, dire, data);
        const dTeam = computeTeamScore(dire, radiant, data);
        const delta = rTeam.score - dTeam.score;
        const rMax = Math.max(...rTeam.perHeroAdvantages);
        const dMax = Math.max(...dTeam.perHeroAdvantages);
        const maxHeroAdv = Math.max(rMax, dMax);
        const radiantWon = match.radiant_win === true;
        const rw = radiantWon ? 1 : 0;
        const dw = radiantWon ? 0 : 1;
        newLines.push(`${match.match_id},${delta.toFixed(2)},${maxHeroAdv.toFixed(2)},${rw},${dw}`);
      }
      if (newLines.length) {
        fs.appendFileSync(matchesPath, newLines.join("\n") + "\n", "utf8");
        totalAppended += newLines.length;
      }
      console.log(`[append] appended=${newLines.length} total_appended=${totalAppended} file_total=${existingCount + totalAppended}`);
      if (TARGET_TOTAL > 0 && existingCount + totalAppended >= TARGET_TOTAL) {
        console.log(`[append] Reached target total ${TARGET_TOTAL}. Stopping.`);
        return;
      }
    }
    console.log(`[append] Completed streaming append. total_appended=${totalAppended}`);
    return;
  }

  const rows = [];
  const detailRows = [];
  const comboRows = [];
  const bins = new Map(); // bin -> { games, radiantWins }
  const singleHeroThresholds = [4, 5, 6, 7, 8, 9, 10];
  const singleHeroStats = new Map(); // threshold -> { games, wins }
  for (const t of singleHeroThresholds) singleHeroStats.set(t, { games: 0, wins: 0 });

  for (const match of allResults) {
    const teams = extractTeamsFromMatch(match, idToIndex);
    if (!teams) continue;
    const { radiant, dire } = teams;

    // Compute components matching the UI
    const rTeam = computeTeamScore(radiant, dire, data);
    const dTeam = computeTeamScore(dire, radiant, data);
    const delta = rTeam.score - dTeam.score; // Radiant - Dire
    const rMax = Math.max(...rTeam.perHeroAdvantages);
    const dMax = Math.max(...dTeam.perHeroAdvantages);
    const maxHeroAdv = Math.max(rMax, dMax);
    const sideWithMax = rMax >= dMax ? "radiant" : "dire";
    const radiantWon = match.radiant_win === true;

    rows.push({ match_id: match.match_id, delta, maxHeroAdv, radiantWon });

    // Build detailed breakdown row (Dire first, then Radiant)
    const rBase = radiant.reduce((s, i) => s + Number(data.heroesWr[i] || 0), 0);
    const dBase = dire.reduce((s, i) => s + Number(data.heroesWr[i] || 0), 0);
    const rAdv = rTeam.perHeroAdvantages.reduce((a, b) => a + b, 0);
    const dAdv = dTeam.perHeroAdvantages.reduce((a, b) => a + b, 0);
    const radiantScore = rBase + rAdv;
    const direScore = dBase + dAdv;
    const direWin = radiantWon ? 0 : 1;
    detailRows.push({
      match_id: match.match_id,
      dire_heroes: dire.map((i) => data.heroes[i]).join("|"),
      dire_base: dBase,
      dire_advantages_sum: dAdv,
      dire_score: direScore,
      radiant_heroes: radiant.map((i) => data.heroes[i]).join("|"),
      radiant_base: rBase,
      radiant_advantages_sum: rAdv,
      radiant_score: radiantScore,
      delta: delta,
      radiant_win: radiantWon ? 1 : 0,
      dire_win: direWin,
    });

    // Positive/negative hero counts by per-hero advantage sign
    const rPos = rTeam.perHeroAdvantages.filter((x) => x > 0).length;
    const rNeg = rTeam.perHeroAdvantages.filter((x) => x < 0).length;
    const dPos = dTeam.perHeroAdvantages.filter((x) => x > 0).length;
    const dNeg = dTeam.perHeroAdvantages.filter((x) => x < 0).length;
    comboRows.push({ match_id: match.match_id, rPos, rNeg, dPos, dNeg, radiantWon: radiantWon ? 1 : 0 });

    const b = binByDelta(delta);
    const agg = bins.get(b) || { games: 0, radiantWins: 0 };
    agg.games += 1;
    agg.radiantWins += radiantWon ? 1 : 0;
    bins.set(b, agg);

    for (const t of singleHeroThresholds) {
      if (maxHeroAdv >= t) {
        const s = singleHeroStats.get(t);
        s.games += 1;
        const teamWithMaxWon = sideWithMax === "radiant" ? radiantWon : !radiantWon;
        s.wins += teamWithMaxWon ? 1 : 0;
      }
    }
  }

  // Write per-match rows (include dire_win)
  const matchesHeader = "match_id,delta,max_hero_adv,radiant_win,dire_win\n";
  const newLines = rows.map((r) => {
    const rw = r.radiantWon ? 1 : 0;
    const dw = r.radiantWon ? 0 : 1;
    return `${r.match_id},${r.delta.toFixed(2)},${r.maxHeroAdv.toFixed(2)},${rw},${dw}`;
  }).join("\n") + (rows.length ? "\n" : "");

  const matchesPath = path.join(outDir, "matches.csv");
  if (INCREMENTAL_APPEND) {
    const exists = fs.existsSync(matchesPath);
    if (!exists) {
      fs.writeFileSync(matchesPath, matchesHeader + newLines, "utf8");
    } else {
      fs.appendFileSync(matchesPath, newLines, "utf8");
    }
  } else {
    fs.writeFileSync(matchesPath, matchesHeader + newLines, "utf8");
  }

  if (!MATCHES_ONLY) {
    // Write detailed per-match breakdown (Dire listed first) - non-incremental for simplicity
    fs.writeFileSync(
      path.join(outDir, "matches_detailed.csv"),
      [
        [
          "match_id",
          "dire_heroes",
          "dire_base",
          "dire_advantages_sum",
          "dire_score",
          "radiant_heroes",
          "radiant_base",
          "radiant_advantages_sum",
          "radiant_score",
          "delta",
          "radiant_win",
          "dire_win",
        ].join(","),
        ...detailRows.map((r) =>
          [
            r.match_id,
            r.dire_heroes,
            r.dire_base.toFixed(2),
            r.dire_advantages_sum.toFixed(2),
            r.dire_score.toFixed(2),
            r.radiant_heroes,
            r.radiant_base.toFixed(2),
            r.radiant_advantages_sum.toFixed(2),
            r.radiant_score.toFixed(2),
            r.delta.toFixed(2),
            r.radiant_win,
            r.dire_win,
          ].join(",")
        ),
      ].join("\n") + "\n",
      "utf8"
    );
  }

  if (!MATCHES_ONLY) {
    // Write combo rows for postprocessing
    fs.writeFileSync(
      path.join(outDir, "matches_combos.csv"),
      ["match_id,r_pos,r_neg,d_pos,d_neg,radiant_win"].concat(
        comboRows.map((r) => `${r.match_id},${r.rPos},${r.rNeg},${r.dPos},${r.dNeg},${r.radiantWon}`)
      ).join("\n") + "\n",
      "utf8"
    );
  }

  // Write bin stats
  if (!MATCHES_ONLY) {
    const sortedBins = Array.from(bins.entries()).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
    const binCsv = ["bin,games,radiant_win_rate"]; 
    for (const [bin, s] of sortedBins) {
      const wr = s.games ? (s.radiantWins / s.games) : 0;
      binCsv.push(`${bin},${s.games},${wr.toFixed(4)}`);
    }
    fs.writeFileSync(path.join(outDir, "delta_bins.csv"), binCsv.join("\n") + "\n", "utf8");
  }

  // Write single hero advantage threshold accuracy
  if (!MATCHES_ONLY) {
    const thrCsv = ["threshold,games,model_accuracy"]; 
    for (const t of singleHeroThresholds) {
      const s = singleHeroStats.get(t);
      const acc = s.games ? (s.wins / s.games) : 0;
      thrCsv.push(`${t},${s.games},${acc.toFixed(4)}`);
    }
    fs.writeFileSync(path.join(outDir, "single_hero_thresholds.csv"), thrCsv.join("\n") + "\n", "utf8");
  }

  // Summary JSON
  if (!MATCHES_ONLY) {
    const sortedBins = Array.from(bins.entries()).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
    const summary = {
      total_matches: rows.length,
      delta_bins: Object.fromEntries(sortedBins.map(([k, v]) => [k, { games: v.games, radiant_win_rate: v.games ? v.radiantWins / v.games : 0 }])),
      single_hero_thresholds: Object.fromEntries(singleHeroThresholds.map((t) => {
        const s = singleHeroStats.get(t);
        return [t, { games: s.games, model_accuracy: s.games ? s.wins / s.games : 0 }];
      })),
    };
    fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  }

  console.log(`Analyzed ${rows.length} matches. Outputs written to ${outDir}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

