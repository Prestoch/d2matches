Analysis pipeline

Files added
- scripts/model.js: Loads cs.json and computes team delta and hero advantages to match the UI logic in index.html.
- scripts/analyze_pro_matches.js: Fetches OpenDota pro matches (with pagination), maps heroes, computes per-match delta and max hero advantage, writes CSV and JSON outputs to out/.
- scripts/postprocess_from_csv.js: Derives betting thresholds from matches.csv without extra API calls.

Outputs (in out/)
- matches.csv: Columns match_id, delta, max_hero_adv, radiant_win.
- delta_bins.csv: Win rate by delta bin.
- single_hero_thresholds.csv: Accuracy of the rule "team with a >=T single-hero advantage wins".
- summary.json: Summary of the analyzed sample.
- betting_signal.json: Recommended delta threshold with accuracy and sample size.

Usage
1) Initial run (may hit OpenDota rate limits if you increase limits aggressively):
   node scripts/analyze_pro_matches.js

2) Derive threshold recommendations from the current matches.csv:
   node scripts/postprocess_from_csv.js

Current small-sample findings (sample_matches from summary files)
- In this run, sample size = 93 matches.
- Recommended absolute delta threshold = 20 (accuracy ~45%, coverage 20 games).
- Single-hero max advantage thresholds (>=6..10) did not show strong accuracy in this small sample.

Caveats and improvements
- Increase sample size via pagination (already implemented) but respect OpenDota rate limits; add an API key if available.
- Segment by patch ranges to control for meta shifts.
- Evaluate calibration (Brier/log loss) and expected value using bookmaker odds.

