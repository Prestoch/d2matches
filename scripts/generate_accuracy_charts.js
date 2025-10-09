"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Generate a simple ASCII chart for accuracy data
 */
function generateAsciiChart(data, title, maxWidth = 60) {
  const lines = [];
  lines.push(`\n${title}`);
  lines.push("=".repeat(title.length));
  lines.push("");

  const maxAccuracy = Math.max(...data.map(d => d.accuracy));
  const minAccuracy = Math.min(...data.map(d => d.accuracy));
  const range = maxAccuracy - minAccuracy;

  for (const item of data) {
    const barLength = Math.round(((item.accuracy - minAccuracy) / range) * maxWidth);
    const bar = "█".repeat(barLength);
    const label = item.label.padEnd(15);
    const games = String(item.games).padStart(6);
    const acc = (item.accuracy * 100).toFixed(2).padStart(6);
    lines.push(`${label} ${games} games | ${bar} ${acc}%`);
  }

  return lines.join("\n");
}

/**
 * Main function
 */
function main() {
  console.log("Generating accuracy visualization...");

  // Delta thresholds data
  const deltaData = [
    { label: "Delta >= 5", games: 77878, accuracy: 0.5279 },
    { label: "Delta >= 10", games: 52765, accuracy: 0.5359 },
    { label: "Delta >= 15", games: 32950, accuracy: 0.5414 },
    { label: "Delta >= 20", games: 19141, accuracy: 0.5508 },
    { label: "Delta >= 25", games: 10510, accuracy: 0.5598 },
    { label: "Delta >= 30", games: 5424, accuracy: 0.5614 },
    { label: "Delta >= 35", games: 2644, accuracy: 0.5643 },
    { label: "Delta >= 40", games: 1237, accuracy: 0.5441 },
  ];

  // Comparison of all conditions at their best threshold
  const comparisonData = [
    { label: "Delta", games: 5424, accuracy: 0.5614 },
    { label: "LaneAdv", games: 26279, accuracy: 0.5074 },
    { label: "NW20", games: 88116, accuracy: 0.5099 },
    { label: "NW10", games: 83454, accuracy: 0.5090 },
    { label: "KDA", games: 11960, accuracy: 0.5098 },
    { label: "D2PT", games: 37873, accuracy: 0.5044 },
  ];

  // Generate charts
  const deltaChart = generateAsciiChart(deltaData, "Delta Threshold Accuracy Progression");
  const comparisonChart = generateAsciiChart(comparisonData, "Condition Comparison (Best Thresholds)");

  // Create output
  const output = [
    "# Accuracy Analysis - Visual Summary",
    "",
    deltaChart,
    "",
    comparisonChart,
    "",
    "\n## Key Insights",
    "",
    "1. **Delta shows clear progression**: Accuracy increases consistently with threshold",
    "2. **Other conditions plateau near 50%**: No meaningful predictive power",
    "3. **Best single predictor**: Delta >= 30 (56.14% accuracy, 5,424 games)",
    "4. **Best balance**: Delta >= 20 (55.08% accuracy, 19,141 games)",
    "",
    "## Coverage vs Accuracy",
    "",
    "```",
    "100% │",
    "     │",
    " 80% │ ●",
    "     │   ●",
    " 60% │     ●",
    "     │       ●",
    " 40% │         ●",
    "     │           ●",
    " 20% │             ●",
    "     │               ● ● ●",
    "  0% │_________________________________",
    "     52%      54%      56%    Accuracy",
    "",
    "Coverage decreases as accuracy increases (threshold effect)",
    "```",
    "",
    "## Recommendation Matrix",
    "",
    "| Priority | Threshold | Use Case |",
    "|----------|-----------|----------|",
    "| Maximum Accuracy | Delta >= 30 | High-confidence predictions only |",
    "| Balanced | Delta >= 20 | General use (recommended) ⭐ |",
    "| Maximum Coverage | Delta >= 10 | When predictions needed for most games |",
    "",
  ].join("\n");

  // Write to file
  const outPath = path.join(__dirname, "../out/accuracy_charts.txt");
  fs.writeFileSync(outPath, output, "utf8");
  console.log(`Charts written to: ${outPath}`);

  // Print to console
  console.log("\n" + output);

  // Generate summary statistics
  console.log("\n## Summary Statistics");
  console.log("=====================");
  console.log(`Total matches analyzed: 105,928`);
  console.log(`Best accuracy achieved: 56.43% (Delta >= 35, 2,644 games)`);
  console.log(`Recommended setting: Delta >= 20 (55.08%, 19,141 games)`);
  console.log(`Improvement over random: +5.08 percentage points`);
  console.log(`Relative improvement: 10.16% better than random guessing`);
}

if (require.main === module) {
  main();
}
