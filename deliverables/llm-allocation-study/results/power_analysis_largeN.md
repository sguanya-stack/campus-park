# Power analysis from measured variance

Source: `results/baseline_summary.csv`. Arms: ['fifo', 'greedy', 'random']. Planned n per cell: 30. alpha=0.05, target power=0.8, two-sided paired t-test.

## Why these numbers differ from the proposal's

The proposal quoted `n=30 detects d>=0.74` from a **two-sample** formula. This design is **paired** -- every arm sees the same seeded scenarios -- so the relevant dispersion is the SD of paired *differences*. The `variance_reduction` column below shows how much pairing buys: it is the fraction by which the paired-difference SD falls short of the pooled raw SD. Where that number is high, the two-sample figure badly understates what this design can detect.

## Measured dispersion and minimum detectable effect

| metric         |   rho | pair             |   n |   sd_diff |   sd_raw_pooled |   variance_reduction |   mde_at_n |   observed_diff |   observed_over_mde |
|:---------------|------:|:-----------------|----:|----------:|----------------:|---------------------:|-----------:|----------------:|--------------------:|
| success_rate   |   0.8 | fifo vs greedy   |  30 |   0.01322 |         0.05076 |              0.73953 |    0.007   |        -0.09505 |             13.584  |
| success_rate   |   0.8 | fifo vs random   |  30 |   0.02618 |         0.17268 |              0.84837 |    0.01386 |         0.34054 |             24.5747 |
| success_rate   |   0.8 | greedy vs random |  30 |   0.02057 |         0.22027 |              0.90662 |    0.01089 |         0.43559 |             40.012  |
| success_rate   |   1.2 | fifo vs greedy   |  30 |   0.01288 |         0.06863 |              0.81237 |    0.00682 |        -0.1334  |             19.5735 |
| success_rate   |   1.2 | fifo vs random   |  30 |   0.01488 |         0.13539 |              0.89009 |    0.00788 |         0.26747 |             33.9627 |
| success_rate   |   1.2 | greedy vs random |  30 |   0.01478 |         0.20258 |              0.92705 |    0.00782 |         0.40087 |             51.2542 |
| success_rate   |   2   | fifo vs greedy   |  30 |   0.00985 |         0.10104 |              0.90252 |    0.00521 |        -0.19988 |             38.3464 |
| success_rate   |   2   | fifo vs random   |  30 |   0.01443 |         0.06681 |              0.78398 |    0.00764 |         0.13129 |             17.188  |
| success_rate   |   2   | greedy vs random |  30 |   0.01226 |         0.16724 |              0.9267  |    0.00649 |         0.33117 |             51.0459 |
| jains_index    |   0.8 | fifo vs greedy   |  30 |   0.01138 |         0.03958 |              0.71253 |    0.00602 |        -0.07081 |             11.7603 |
| jains_index    |   0.8 | fifo vs random   |  30 |   0.02236 |         0.13198 |              0.83061 |    0.01183 |         0.25989 |             21.9658 |
| jains_index    |   0.8 | greedy vs random |  30 |   0.01877 |         0.16732 |              0.8878  |    0.00994 |         0.3307  |             33.2843 |
| jains_index    |   1.2 | fifo vs greedy   |  30 |   0.01132 |         0.05103 |              0.77825 |    0.00599 |        -0.0983  |             16.4125 |
| jains_index    |   1.2 | fifo vs random   |  30 |   0.01394 |         0.10458 |              0.86675 |    0.00738 |         0.20646 |             27.9935 |
| jains_index    |   1.2 | greedy vs random |  30 |   0.01461 |         0.15412 |              0.9052  |    0.00773 |         0.30475 |             39.4109 |
| jains_index    |   2   | fifo vs greedy   |  30 |   0.00937 |         0.0755  |              0.8759  |    0.00496 |        -0.1489  |             30.027  |
| jains_index    |   2   | fifo vs random   |  30 |   0.01146 |         0.05192 |              0.77935 |    0.00606 |         0.10149 |             16.7385 |
| jains_index    |   2   | greedy vs random |  30 |   0.0084  |         0.12658 |              0.93364 |    0.00445 |         0.25038 |             56.3256 |
| utilization    |   0.8 | fifo vs greedy   |  30 |   0.00598 |         0.02328 |              0.74325 |    0.00316 |        -0.04271 |             13.5032 |
| utilization    |   0.8 | fifo vs random   |  30 |   0.01216 |         0.07861 |              0.84529 |    0.00644 |         0.15502 |             24.0856 |
| utilization    |   0.8 | greedy vs random |  30 |   0.01052 |         0.10001 |              0.89478 |    0.00557 |         0.19773 |             35.5054 |
| utilization    |   1.2 | fifo vs greedy   |  30 |   0.00755 |         0.04475 |              0.83124 |    0.004   |        -0.08709 |             21.7911 |
| utilization    |   1.2 | fifo vs random   |  30 |   0.01047 |         0.0923  |              0.88656 |    0.00554 |         0.18229 |             32.8946 |
| utilization    |   1.2 | greedy vs random |  30 |   0.0095  |         0.13615 |              0.93023 |    0.00503 |         0.26937 |             53.5843 |
| utilization    |   2   | fifo vs greedy   |  30 |   0.00931 |         0.106   |              0.91221 |    0.00492 |        -0.20964 |             42.5712 |
| utilization    |   2   | fifo vs random   |  30 |   0.01459 |         0.07777 |              0.81242 |    0.00772 |         0.15306 |             19.8262 |
| utilization    |   2   | greedy vs random |  30 |   0.01266 |         0.18319 |              0.93089 |    0.0067  |         0.36271 |             54.1299 |
| social_welfare |   0.8 | fifo vs greedy   |  30 | 155.828   |       585.597   |              0.7339  |   82.47    |     -1033.88    |             12.5364 |
| social_welfare |   0.8 | fifo vs random   |  30 | 265.832   |      2014.87    |              0.86807 |  140.688   |      3964.75    |             28.1812 |
| social_welfare |   0.8 | greedy vs random |  30 | 222.332   |      2532.49    |              0.91221 |  117.666   |      4998.63    |             42.4815 |
| social_welfare |   1.2 | fifo vs greedy   |  30 | 248.488   |      1145.24    |              0.78303 |  131.509   |     -2148.11    |             16.3344 |
| social_welfare |   1.2 | fifo vs random   |  30 | 267.933   |      2356.31    |              0.88629 |  141.799   |      4635.22    |             32.6885 |
| social_welfare |   1.2 | greedy vs random |  30 | 271.738   |      3437.29    |              0.92094 |  143.813   |      6783.32    |             47.1676 |
| social_welfare |   2   | fifo vs greedy   |  30 | 318.561   |      2620.21    |              0.87842 |  168.594   |     -5158.6     |             30.5978 |
| social_welfare |   2   | fifo vs random   |  30 | 433.646   |      2034.93    |              0.7869  |  229.501   |      3992.41    |             17.3961 |
| social_welfare |   2   | greedy vs random |  30 | 327.315   |      4624.28    |              0.92922 |  173.227   |      9151.01    |             52.8268 |

`mde_at_n` is in the metric's own units (success_rate and utilization are fractions, so 0.01 = 1 percentage point). `observed_over_mde` > 1 means the effect actually measured in this data is larger than the smallest effect the design could reliably detect.

## Planning table: seeds required for a given effect

| metric       |   worst_case_sd_diff |   target_effect |   required_n |
|:-------------|---------------------:|----------------:|-------------:|
| success_rate |                0.026 |           0.01  |       55.762 |
| success_rate |                0.026 |           0.02  |       15.483 |
| success_rate |                0.026 |           0.05  |        4.404 |
| jains_index  |                0.022 |           0.01  |       41.189 |
| jains_index  |                0.022 |           0.02  |       11.869 |
| jains_index  |                0.022 |           0.05  |        3.841 |
| utilization  |                0.015 |           0.005 |       68.752 |
| utilization  |                0.015 |           0.01  |       18.713 |
| utilization  |                0.015 |           0.02  |        6.349 |

Each row uses the **largest** paired-difference SD observed for that metric, so these are conservative.

## Limits of this analysis

- These SDs come from **deterministic** policies, so they capture scenario variance only. The LLM arms add model stochasticity on top -- exactly what §5.3's repeated-measures ICC is meant to quantify -- so their paired-difference SD will be larger and every MDE here is **optimistic** for them. Re-run this script on the LLM data before claiming power for Experiment A.
- Power computed post hoc on the same data that produced the observed effects is not evidence that those effects are real. The MDE column is a *design* property (it depends only on SD and n) and is the defensible thing to quote; `observed_over_mde` is descriptive context, not a test.
