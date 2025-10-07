# Dota 2 Match Prediction Accuracy Analysis

## Overview
Analysis of prediction accuracy using different delta thresholds and combinations from 105,928 matches in matches_detailed.csv.

## Methodology
- **Role Assignment**: Heroes assigned to roles (carry, mid, offlane, soft support, hard support) based on D2PT rating
- **Team Composition**: Each team has exactly 1 hero per role
- **Prediction Method**: Compare team deltas against thresholds to predict winner
- **Conditions Tested**: Delta (WR+Advantage), KDA, D2PT, NW10, NW20, LaneAdv

## Results Summary

### 1. Delta (Win Rate + Advantage) - BEST PREDICTOR
| Threshold | Games | Accuracy | Notes |
|-----------|-------|----------|-------|
| 5  | 77,878 | 52.79% | Highest coverage |
| 10 | 52,765 | 53.59% | Good balance |
| 15 | 32,950 | 54.14% | |
| 20 | 19,141 | 55.08% | |
| 25 | 10,510 | 55.98% | |
| 30 | 5,424  | 56.14% | |
| **35** | **2,644**  | **56.43%** | **Best accuracy** |
| 40 | 1,237  | 54.41% | Lower accuracy |
| 45 | 601    | 56.07% | |
| 50 | 267    | 55.06% | |

**Key Finding**: Delta shows clear predictive power, with accuracy increasing up to threshold 35 (56.43%). Best balance of coverage and accuracy is around threshold 20-30.

### 2. KDA (Kill/Death/Assist Ratio) - WEAK PREDICTOR
| Threshold | Games | Accuracy |
|-----------|-------|----------|
| 1 | 45,427 | 50.26% |
| 2 | 11,960 | 50.98% |
| 3 | 1,825  | 48.71% |
| 4 | 134    | 49.25% |
| 5 | 4      | 50.00% |
| 6 | 0      | N/A    |

**Key Finding**: KDA delta shows minimal predictive power, barely above random chance (50%).

### 3. D2PT (DotaBuff Pro Tracker Rating) - WEAK PREDICTOR
| Threshold | Games | Accuracy |
|-----------|-------|----------|
| 500   | 68,292 | 50.06% |
| 1000  | 66,530 | 50.08% |
| 1500  | 66,520 | 50.08% |
| 2000  | 66,511 | 50.08% |
| 2500  | 65,096 | 50.08% |
| 3000  | 37,873 | 50.44% |
| 3500  | 16,015 | 50.15% |
| 4000  | 15,351 | 50.00% |
| 4500  | 15,351 | 50.00% |
| 5000  | 15,351 | 50.00% |

**Key Finding**: D2PT delta shows almost no predictive power, hovering around 50% accuracy.

### 4. NW10 (Net Worth at 10 minutes) - WEAK PREDICTOR
| Threshold | Games | Accuracy |
|-----------|-------|----------|
| 200   | 83,454 | 50.90% |
| 400   | 65,734 | 50.62% |
| 600   | 52,925 | 50.45% |
| 800   | 43,412 | 50.35% |
| 1000  | 31,474 | 50.16% |
| 1500  | 20,464 | 50.17% |
| 2000  | 13,349 | 49.99% |
| 3000  | 7,278  | 49.56% |
| 4000  | 3,849  | 49.36% |
| 5000  | 666    | 48.05% |

**Key Finding**: NW10 shows slight improvement at low thresholds (50.90% at 200) but degrades to below 50% at high thresholds.

### 5. NW20 (Net Worth at 20 minutes) - WEAK PREDICTOR
| Threshold | Games | Accuracy |
|-----------|-------|----------|
| 500   | 88,116 | 50.99% |
| 1000  | 76,132 | 50.89% |
| 1500  | 65,011 | 50.82% |
| 2000  | 46,105 | 50.78% |
| 3000  | 31,998 | 50.63% |
| 4000  | 20,356 | 50.42% |
| 6000  | 10,819 | 50.18% |
| 8000  | 6,588  | 49.70% |
| 10000 | 3,245  | 48.97% |

**Key Finding**: Similar to NW10, NW20 shows minimal improvement (50.99% at 500) and degrades at high thresholds.

### 6. LaneAdv (Lane Advantage) - WEAK PREDICTOR
| Threshold | Games | Accuracy |
|-----------|-------|----------|
| 2  | 88,376 | 50.58% |
| 4  | 71,659 | 50.66% |
| 6  | 56,956 | 50.62% |
| 8  | 44,284 | 50.65% |
| 10 | 34,303 | 50.70% |
| 12 | 26,279 | 50.74% |
| 14 | 20,305 | 50.61% |
| 16 | 15,964 | 50.53% |
| 18 | 12,856 | 50.33% |
| 20 | 10,449 | 50.66% |

**Key Finding**: LaneAdv shows consistent but minimal predictive power (~50.6-50.7%) across all thresholds.

## Conclusions

1. **Delta (WR + Advantage) is the dominant predictor** with accuracy reaching 56.43% at optimal thresholds
2. **Optimal threshold range**: 20-35 for balance of coverage and accuracy
3. **Other metrics show minimal predictive power**: KDA, D2PT, NW10, NW20, and LaneAdv all hover near 50% accuracy
4. **Recommendation**: Focus on Delta-based predictions with threshold between 20-30 for practical use

## Data Quality
- Total matches analyzed: 105,928
- Matches skipped: 0
- All matches had complete 5v5 hero data
- Role assignment based on D2PT rating per role

## Next Steps
To improve predictions, consider:
1. Testing combinations of conditions (e.g., Delta >= 20 AND LaneAdv >= 10)
2. Analyzing specific hero matchups or patch-specific trends
3. Incorporating game duration or patch version as features
4. Testing weighted combinations of multiple conditions
