# Power analysis from measured variance

Source: `results/expA_classic.csv`. Arms: ['fifo', 'greedy', 'random']. Planned n per cell: 30. alpha=0.05, target power=0.8, two-sided paired t-test.

## Why these numbers differ from the proposal's

The proposal quoted `n=30 detects d>=0.74` from a **two-sample** formula. This design is **paired** -- every arm sees the same seeded scenarios -- so the relevant dispersion is the SD of paired *differences*. The `variance_reduction` column below shows how much pairing buys: it is the fraction by which the paired-difference SD falls short of the pooled raw SD. Where that number is high, the two-sample figure badly understates what this design can detect.

## Measured dispersion and minimum detectable effect

| metric         |   rho | pair             |   n |   sd_diff |   sd_raw_pooled |   variance_reduction |   mde_at_n |   observed_diff |   observed_over_mde |
|:---------------|------:|:-----------------|----:|----------:|----------------:|---------------------:|-----------:|----------------:|--------------------:|
| success_rate   |   0.8 | fifo vs greedy   |  60 |   0.02582 |         0.0615  |              0.58012 |    0.01367 |        -0.10564 |             7.73045 |
| success_rate   |   0.8 | fifo vs random   |  60 |   0.03624 |         0.16114 |              0.77509 |    0.01918 |         0.31545 |            16.4466  |
| success_rate   |   0.8 | greedy vs random |  60 |   0.03671 |         0.21356 |              0.82809 |    0.01943 |         0.42109 |            21.6721  |
| success_rate   |   1.2 | fifo vs greedy   |  60 |   0.02188 |         0.07998 |              0.72644 |    0.01158 |        -0.15284 |            13.198   |
| success_rate   |   1.2 | fifo vs random   |  60 |   0.03059 |         0.12439 |              0.75407 |    0.01619 |         0.24317 |            15.0194  |
| success_rate   |   1.2 | greedy vs random |  60 |   0.0298  |         0.20042 |              0.85129 |    0.01577 |         0.39601 |            25.1064  |
| success_rate   |   2   | fifo vs greedy   |  60 |   0.01719 |         0.10661 |              0.83878 |    0.0091  |        -0.20997 |            23.0812  |
| success_rate   |   2   | fifo vs random   |  60 |   0.02062 |         0.06082 |              0.66093 |    0.01091 |         0.11642 |            10.6681  |
| success_rate   |   2   | greedy vs random |  60 |   0.02072 |         0.16505 |              0.87447 |    0.01097 |         0.32639 |            29.766   |
| jains_index    |   0.8 | fifo vs greedy   |  60 |   0.02185 |         0.04975 |              0.56076 |    0.01157 |        -0.07945 |             6.86963 |
| jains_index    |   0.8 | fifo vs random   |  60 |   0.03042 |         0.1232  |              0.75307 |    0.0161  |         0.23972 |            14.89    |
| jains_index    |   0.8 | greedy vs random |  60 |   0.03168 |         0.16266 |              0.80524 |    0.01677 |         0.31917 |            19.0373  |
| jains_index    |   1.2 | fifo vs greedy   |  60 |   0.01591 |         0.06046 |              0.73695 |    0.00842 |        -0.11432 |            13.5812  |
| jains_index    |   1.2 | fifo vs random   |  60 |   0.02285 |         0.09616 |              0.76234 |    0.0121  |         0.18742 |            15.495   |
| jains_index    |   1.2 | greedy vs random |  60 |   0.0229  |         0.15285 |              0.85021 |    0.01212 |         0.30174 |            24.9012  |
| jains_index    |   2   | fifo vs greedy   |  60 |   0.01406 |         0.07927 |              0.82268 |    0.00744 |        -0.1548  |            20.8087  |
| jains_index    |   2   | fifo vs random   |  60 |   0.01659 |         0.04791 |              0.65369 |    0.00878 |         0.09039 |            10.2939  |
| jains_index    |   2   | greedy vs random |  60 |   0.01673 |         0.12438 |              0.86552 |    0.00885 |         0.24518 |            27.6981  |
| utilization    |   0.8 | fifo vs greedy   |  60 |   0.01223 |         0.02839 |              0.56933 |    0.00647 |        -0.04656 |             7.19546 |
| utilization    |   0.8 | fifo vs random   |  60 |   0.01792 |         0.07425 |              0.7587  |    0.00948 |         0.14513 |            15.3061  |
| utilization    |   0.8 | greedy vs random |  60 |   0.01984 |         0.0975  |              0.79651 |    0.0105  |         0.19169 |            18.2559  |
| utilization    |   1.2 | fifo vs greedy   |  60 |   0.01591 |         0.05274 |              0.69836 |    0.00842 |        -0.10082 |            11.9753  |
| utilization    |   1.2 | fifo vs random   |  60 |   0.02148 |         0.08461 |              0.74616 |    0.01137 |         0.16573 |            14.5796  |
| utilization    |   1.2 | greedy vs random |  60 |   0.02194 |         0.13497 |              0.83747 |    0.01161 |         0.26655 |            22.9592  |
| utilization    |   2   | fifo vs greedy   |  60 |   0.0183  |         0.11226 |              0.83699 |    0.00968 |        -0.22069 |            22.7877  |
| utilization    |   2   | fifo vs random   |  60 |   0.0223  |         0.07258 |              0.69282 |    0.0118  |         0.13951 |            11.8232  |
| utilization    |   2   | greedy vs random |  60 |   0.02301 |         0.18223 |              0.87374 |    0.01218 |         0.36021 |            29.5813  |
| social_welfare |   0.8 | fifo vs greedy   |  60 |  86.3445  |       215.419   |              0.59918 |   45.6966  |      -333.149   |             7.29046 |
| social_welfare |   0.8 | fifo vs random   |  60 | 109.048   |       537.348   |              0.79706 |   57.7121  |      1046.17    |            18.1274  |
| social_welfare |   0.8 | greedy vs random |  60 | 113.017   |       702.399   |              0.8391  |   59.8125  |      1379.32    |            23.0607  |
| social_welfare |   1.2 | fifo vs greedy   |  60 | 117.991   |       388.557   |              0.69634 |   62.4449  |      -700.188   |            11.2129  |
| social_welfare |   1.2 | fifo vs random   |  60 | 175.398   |       636.929   |              0.72462 |   92.827   |      1237.13    |            13.3272  |
| social_welfare |   1.2 | greedy vs random |  60 | 159.941   |       983.786   |              0.83742 |   84.6465  |      1937.31    |            22.8871  |
| social_welfare |   2   | fifo vs greedy   |  60 | 175.128   |       801.846   |              0.78159 |   92.6838  |     -1549.97    |            16.7232  |
| social_welfare |   2   | fifo vs random   |  60 | 180.213   |       557.365   |              0.67667 |   95.3751  |      1057.25    |            11.0852  |
| social_welfare |   2   | greedy vs random |  60 | 156.06    |      1323.61    |              0.88209 |   82.5928  |      2607.22    |            31.5672  |

`mde_at_n` is in the metric's own units (success_rate and utilization are fractions, so 0.01 = 1 percentage point). `observed_over_mde` > 1 means the effect actually measured in this data is larger than the smallest effect the design could reliably detect.

## Planning table: seeds required for a given effect

| metric       |   worst_case_sd_diff |   target_effect |   required_n |
|:-------------|---------------------:|----------------:|-------------:|
| success_rate |                0.037 |           0.01  |      107.731 |
| success_rate |                0.037 |           0.02  |       28.429 |
| success_rate |                0.037 |           0.05  |        6.404 |
| jains_index  |                0.032 |           0.01  |       80.709 |
| jains_index  |                0.032 |           0.02  |       21.691 |
| jains_index  |                0.032 |           0.05  |        5.361 |
| utilization  |                0.023 |           0.005 |      168.135 |
| utilization  |                0.023 |           0.01  |       43.511 |
| utilization  |                0.023 |           0.02  |       12.444 |

Each row uses the **largest** paired-difference SD observed for that metric, so these are conservative.

## Limits of this analysis

- These SDs come from **deterministic** policies, so they capture scenario variance only. The LLM arms add model stochasticity on top -- exactly what §5.3's repeated-measures ICC is meant to quantify -- so their paired-difference SD will be larger and every MDE here is **optimistic** for them. Re-run this script on the LLM data before claiming power for Experiment A.
- Power computed post hoc on the same data that produced the observed effects is not evidence that those effects are real. The MDE column is a *design* property (it depends only on SD and n) and is the defensible thing to quote; `observed_over_mde` is descriptive context, not a test.
