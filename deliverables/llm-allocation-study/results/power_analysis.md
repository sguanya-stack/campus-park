# Power analysis from measured variance

Source: `results/compact_baseline_summary.csv`. Arms: ['fifo', 'greedy', 'random']. Planned n per cell: 30. alpha=0.05, target power=0.8, two-sided paired t-test.

## Why these numbers differ from the proposal's

The proposal quoted `n=30 detects d>=0.74` from a **two-sample** formula. This design is **paired** -- every arm sees the same seeded scenarios -- so the relevant dispersion is the SD of paired *differences*. The `variance_reduction` column below shows how much pairing buys: it is the fraction by which the paired-difference SD falls short of the pooled raw SD. Where that number is high, the two-sample figure badly understates what this design can detect.

## Measured dispersion and minimum detectable effect

| metric         |   rho | pair             |   n |   sd_diff |   sd_raw_pooled |   variance_reduction |   mde_at_n |   observed_diff |   observed_over_mde |
|:---------------|------:|:-----------------|----:|----------:|----------------:|---------------------:|-----------:|----------------:|--------------------:|
| success_rate   |   0.8 | fifo vs greedy   |  30 |   0.08471 |         0.11579 |              0.26838 |    0.04483 |        -0.17778 |             3.96542 |
| success_rate   |   0.8 | fifo vs random   |  30 |   0.09535 |         0.12891 |              0.26033 |    0.05046 |         0.21944 |             4.34865 |
| success_rate   |   0.8 | greedy vs random |  30 |   0.10249 |         0.21798 |              0.52981 |    0.05424 |         0.39722 |             7.32314 |
| success_rate   |   1.2 | fifo vs greedy   |  30 |   0.05673 |         0.11618 |              0.51171 |    0.03002 |        -0.19352 |             6.44528 |
| success_rate   |   1.2 | fifo vs random   |  30 |   0.0808  |         0.10462 |              0.22766 |    0.04276 |         0.15463 |             3.61607 |
| success_rate   |   1.2 | greedy vs random |  30 |   0.06754 |         0.18946 |              0.64349 |    0.03575 |         0.34815 |             9.73927 |
| success_rate   |   2   | fifo vs greedy   |  30 |   0.04522 |         0.12375 |              0.63459 |    0.02393 |        -0.23111 |             9.65733 |
| success_rate   |   2   | fifo vs random   |  30 |   0.055   |         0.06092 |              0.09713 |    0.02911 |         0.08444 |             2.90082 |
| success_rate   |   2   | greedy vs random |  30 |   0.04951 |         0.1671  |              0.70374 |    0.0262  |         0.31556 |            12.044   |
| jains_index    |   0.8 | fifo vs greedy   |  30 |   0.06947 |         0.09862 |              0.29557 |    0.03677 |        -0.14101 |             3.83542 |
| jains_index    |   0.8 | fifo vs random   |  30 |   0.0761  |         0.10364 |              0.26568 |    0.04028 |         0.17196 |             4.26934 |
| jains_index    |   0.8 | greedy vs random |  30 |   0.08644 |         0.17447 |              0.50459 |    0.04574 |         0.31297 |             6.84164 |
| jains_index    |   1.2 | fifo vs greedy   |  30 |   0.05138 |         0.09295 |              0.44728 |    0.02719 |        -0.14439 |             5.31042 |
| jains_index    |   1.2 | fifo vs random   |  30 |   0.05507 |         0.0813  |              0.32265 |    0.02915 |         0.12271 |             4.2102  |
| jains_index    |   1.2 | greedy vs random |  30 |   0.05713 |         0.14806 |              0.61413 |    0.03024 |         0.2671  |             8.83379 |
| jains_index    |   2   | fifo vs greedy   |  30 |   0.03984 |         0.09813 |              0.59403 |    0.02108 |        -0.17194 |             8.15509 |
| jains_index    |   2   | fifo vs random   |  30 |   0.04686 |         0.0509  |              0.07947 |    0.0248  |         0.06813 |             2.74724 |
| jains_index    |   2   | greedy vs random |  30 |   0.048   |         0.13068 |              0.63269 |    0.0254  |         0.24007 |             9.45015 |
| utilization    |   0.8 | fifo vs greedy   |  30 |   0.03787 |         0.05284 |              0.28337 |    0.02004 |        -0.07704 |             3.84382 |
| utilization    |   0.8 | fifo vs random   |  30 |   0.0471  |         0.06106 |              0.22862 |    0.02493 |         0.1037  |             4.16005 |
| utilization    |   0.8 | greedy vs random |  30 |   0.04869 |         0.09917 |              0.50902 |    0.02577 |         0.18074 |             7.01411 |
| utilization    |   1.2 | fifo vs greedy   |  30 |   0.04113 |         0.07648 |              0.46219 |    0.02177 |        -0.12852 |             5.90422 |
| utilization    |   1.2 | fifo vs random   |  30 |   0.05717 |         0.06867 |              0.16742 |    0.03026 |         0.10574 |             3.49484 |
| utilization    |   1.2 | greedy vs random |  30 |   0.04859 |         0.1271  |              0.61771 |    0.02571 |         0.23426 |             9.11008 |
| utilization    |   2   | fifo vs greedy   |  30 |   0.05471 |         0.13077 |              0.58165 |    0.02895 |        -0.24056 |             8.3082  |
| utilization    |   2   | fifo vs random   |  30 |   0.05637 |         0.07174 |              0.21434 |    0.02983 |         0.10315 |             3.45768 |
| utilization    |   2   | greedy vs random |  30 |   0.05495 |         0.18372 |              0.70089 |    0.02908 |         0.3437  |            11.8179  |
| social_welfare |   0.8 | fifo vs greedy   |  30 |  39.1157  |        54.1982  |              0.27829 |   20.7014  |       -71.0155  |             3.43047 |
| social_welfare |   0.8 | fifo vs random   |  30 |  34.0196  |        59.9703  |              0.43273 |   18.0044  |       100.502   |             5.58207 |
| social_welfare |   0.8 | greedy vs random |  30 |  34.9116  |        96.0063  |              0.63636 |   18.4765  |       171.517   |             9.28302 |
| social_welfare |   1.2 | fifo vs greedy   |  30 |  45.2016  |        83.4495  |              0.45834 |   23.9223  |      -117.905   |             4.92865 |
| social_welfare |   1.2 | fifo vs random   |  30 |  50.1295  |        70.6705  |              0.29066 |   26.5303  |        98.5767  |             3.71562 |
| social_welfare |   1.2 | greedy vs random |  30 |  46.2528  |       121.602   |              0.61964 |   24.4786  |       216.481   |             8.84368 |
| social_welfare |   2   | fifo vs greedy   |  30 |  54.9919  |       125.723   |              0.56259 |   29.1037  |      -207.732   |             7.13767 |
| social_welfare |   2   | fifo vs random   |  30 |  62.9801  |        76.7021  |              0.1789  |   33.3313  |       107.973   |             3.2394  |
| social_welfare |   2   | greedy vs random |  30 |  60.8824  |       173.205   |              0.6485  |   32.2212  |       315.706   |             9.79809 |

`mde_at_n` is in the metric's own units (success_rate and utilization are fractions, so 0.01 = 1 percentage point). `observed_over_mde` > 1 means the effect actually measured in this data is larger than the smallest effect the design could reliably detect.

## Planning table: seeds required for a given effect

| metric       |   worst_case_sd_diff |   target_effect |   required_n |
|:-------------|---------------------:|----------------:|-------------:|
| success_rate |                0.102 |           0.01  |      826.404 |
| success_rate |                0.102 |           0.02  |      208.049 |
| success_rate |                0.102 |           0.05  |       34.949 |
| jains_index  |                0.086 |           0.01  |      588.318 |
| jains_index  |                0.086 |           0.02  |      148.531 |
| jains_index  |                0.086 |           0.05  |       25.443 |
| utilization  |                0.057 |           0.005 |     1028.04  |
| utilization  |                0.057 |           0.01  |      258.458 |
| utilization  |                0.057 |           0.02  |       66.079 |

Each row uses the **largest** paired-difference SD observed for that metric, so these are conservative.

## Limits of this analysis

- These SDs come from **deterministic** policies, so they capture scenario variance only. The LLM arms add model stochasticity on top -- exactly what §5.3's repeated-measures ICC is meant to quantify -- so their paired-difference SD will be larger and every MDE here is **optimistic** for them. Re-run this script on the LLM data before claiming power for Experiment A.
- Power computed post hoc on the same data that produced the observed effects is not evidence that those effects are real. The MDE column is a *design* property (it depends only on SD and n) and is the defensible thing to quote; `observed_over_mde` is descriptive context, not a test.
