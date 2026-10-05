# Statistical report

Source: `results/compact_baseline_summary.csv`. Arms: ['fifo', 'greedy', 'random']. Loads (rho): [np.float64(0.8), np.float64(1.2), np.float64(2.0)]. n_seeds per cell: 30-30.

## Descriptive summary (mean per arm x load)

| arm    |   rho |   success_rate |   jains_index |   gini |   worst_decile_utility |   social_welfare |   utilization |   illegal_allocation_rate |   parse_failure_rate |   decision_latency_s |   cost_usd |
|:-------|------:|---------------:|--------------:|-------:|-----------------------:|-----------------:|--------------:|--------------------------:|---------------------:|---------------------:|-----------:|
| fifo   |   0.8 |         0.4611 |        0.3693 | 0.6618 |                      0 |         186.032  |        0.2004 |                         0 |                    0 |               0.0005 |          0 |
| fifo   |   1.2 |         0.3815 |        0.2988 | 0.727  |                      0 |         224.858  |        0.2515 |                         0 |                    0 |               0.0007 |          0 |
| fifo   |   2   |         0.3061 |        0.2404 | 0.7801 |                      0 |         310.292  |        0.3313 |                         0 |                    0 |               0.002  |          0 |
| greedy |   0.8 |         0.6389 |        0.5104 | 0.5362 |                      0 |         257.048  |        0.2774 |                         0 |                    0 |               0.0013 |          0 |
| greedy |   1.2 |         0.575  |        0.4432 | 0.5948 |                      0 |         342.763  |        0.38   |                         0 |                    0 |               0.0015 |          0 |
| greedy |   2   |         0.5372 |        0.4124 | 0.6209 |                      0 |         518.024  |        0.5719 |                         0 |                    0 |               0.0021 |          0 |
| random |   0.8 |         0.2417 |        0.1974 | 0.8188 |                      0 |          85.5305 |        0.0967 |                         0 |                    0 |               0.0009 |          0 |
| random |   1.2 |         0.2269 |        0.1761 | 0.8377 |                      0 |         126.282  |        0.1457 |                         0 |                    0 |               0.0019 |          0 |
| random |   2   |         0.2217 |        0.1723 | 0.8412 |                      0 |         202.319  |        0.2281 |                         0 |                    0 |               0.0023 |          0 |


## Primary metrics: pairwise paired comparisons (Holm-Bonferroni corrected)

| metric       |   rho | arm_a   | arm_b   |   n_pairs |   mean_a |   mean_b |   mean_diff |   ci95_lo |   ci95_hi |   cohens_d |   cliffs_delta |   t_p |   t_p_holm | reject_holm_0.05   |
|:-------------|------:|:--------|:--------|----------:|---------:|---------:|------------:|----------:|----------:|-----------:|---------------:|------:|-----------:|:-------------------|
| success_rate |   0.8 | fifo    | greedy  |        30 |   0.4611 |   0.6389 |     -0.1778 |   -0.2083 |   -0.1472 |    -2.0986 |        -0.8744 |     0 |          0 | True               |
| success_rate |   0.8 | fifo    | random  |        30 |   0.4611 |   0.2417 |      0.2194 |    0.1861 |    0.2528 |     2.3015 |         0.9789 |     0 |          0 | True               |
| success_rate |   0.8 | greedy  | random  |        30 |   0.6389 |   0.2417 |      0.3972 |    0.3611 |    0.4333 |     3.8757 |         1      |     0 |          0 | True               |
| success_rate |   1.2 | fifo    | greedy  |        30 |   0.3815 |   0.575  |     -0.1935 |   -0.213  |   -0.1731 |    -3.4111 |        -0.9867 |     0 |          0 | True               |
| success_rate |   1.2 | fifo    | random  |        30 |   0.3815 |   0.2269 |      0.1546 |    0.1269 |    0.1843 |     1.9138 |         0.8844 |     0 |          0 | True               |
| success_rate |   1.2 | greedy  | random  |        30 |   0.575  |   0.2269 |      0.3481 |    0.3241 |    0.3713 |     5.1544 |         1      |     0 |          0 | True               |
| success_rate |   2   | fifo    | greedy  |        30 |   0.3061 |   0.5372 |     -0.2311 |   -0.2472 |   -0.2156 |    -5.111  |        -1      |     0 |          0 | True               |
| success_rate |   2   | fifo    | random  |        30 |   0.3061 |   0.2217 |      0.0844 |    0.065  |    0.1033 |     1.5352 |         0.8067 |     0 |          0 | True               |
| success_rate |   2   | greedy  | random  |        30 |   0.5372 |   0.2217 |      0.3156 |    0.2978 |    0.3333 |     6.3741 |         1      |     0 |          0 | True               |
| jains_index  |   0.8 | fifo    | greedy  |        30 |   0.3693 |   0.5104 |     -0.141  |   -0.1655 |   -0.1161 |    -2.0298 |        -0.8467 |     0 |          0 | True               |
| jains_index  |   0.8 | fifo    | random  |        30 |   0.3693 |   0.1974 |      0.172  |    0.1453 |    0.1978 |     2.2595 |         0.96   |     0 |          0 | True               |
| jains_index  |   0.8 | greedy  | random  |        30 |   0.5104 |   0.1974 |      0.313  |    0.2826 |    0.3431 |     3.6208 |         1      |     0 |          0 | True               |
| jains_index  |   1.2 | fifo    | greedy  |        30 |   0.2988 |   0.4432 |     -0.1444 |   -0.1624 |   -0.1267 |    -2.8105 |        -0.9556 |     0 |          0 | True               |
| jains_index  |   1.2 | fifo    | random  |        30 |   0.2988 |   0.1761 |      0.1227 |    0.1035 |    0.1422 |     2.2282 |         0.88   |     0 |          0 | True               |
| jains_index  |   1.2 | greedy  | random  |        30 |   0.4432 |   0.1761 |      0.2671 |    0.2468 |    0.2871 |     4.6752 |         1      |     0 |          0 | True               |
| jains_index  |   2   | fifo    | greedy  |        30 |   0.2404 |   0.4124 |     -0.1719 |   -0.186  |   -0.1583 |    -4.316  |        -1      |     0 |          0 | True               |
| jains_index  |   2   | fifo    | random  |        30 |   0.2404 |   0.1723 |      0.0681 |    0.0519 |    0.0845 |     1.4539 |         0.7933 |     0 |          0 | True               |
| jains_index  |   2   | greedy  | random  |        30 |   0.4124 |   0.1723 |      0.2401 |    0.2236 |    0.2575 |     5.0014 |         1      |     0 |          0 | True               |


## Secondary metrics: pairwise paired comparisons (Holm-Bonferroni corrected within family)

| metric                  |   rho | arm_a   | arm_b   |   n_pairs |   mean_diff |   ci95_lo |   ci95_hi |   cohens_d |   t_p_holm | reject_holm_0.05   |
|:------------------------|------:|:--------|:--------|----------:|------------:|----------:|----------:|-----------:|-----------:|:-------------------|
| gini                    |   0.8 | fifo    | greedy  |        30 |      0.1256 |    0.1032 |    0.1474 |     2.0218 |     0      | True               |
| gini                    |   0.8 | fifo    | random  |        30 |     -0.157  |   -0.181  |   -0.1327 |    -2.2405 |     0      | True               |
| gini                    |   0.8 | greedy  | random  |        30 |     -0.2826 |   -0.3099 |   -0.2553 |    -3.6298 |     0      | True               |
| gini                    |   1.2 | fifo    | greedy  |        30 |      0.1322 |    0.1167 |    0.1479 |     2.9572 |     0      | True               |
| gini                    |   1.2 | fifo    | random  |        30 |     -0.1107 |   -0.1299 |   -0.0924 |    -2.0724 |     0      | True               |
| gini                    |   1.2 | greedy  | random  |        30 |     -0.2429 |   -0.2615 |   -0.2243 |    -4.6165 |     0      | True               |
| gini                    |   2   | fifo    | greedy  |        30 |      0.1592 |    0.1481 |    0.1707 |     4.8846 |     0      | True               |
| gini                    |   2   | fifo    | random  |        30 |     -0.0612 |   -0.0756 |   -0.0471 |    -1.5042 |     0      | True               |
| gini                    |   2   | greedy  | random  |        30 |     -0.2204 |   -0.2352 |   -0.2064 |    -5.4085 |     0      | True               |
| worst_decile_utility    |   0.8 | fifo    | greedy  |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| worst_decile_utility    |   0.8 | fifo    | random  |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| worst_decile_utility    |   0.8 | greedy  | random  |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| worst_decile_utility    |   1.2 | fifo    | greedy  |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| worst_decile_utility    |   1.2 | fifo    | random  |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| worst_decile_utility    |   1.2 | greedy  | random  |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| worst_decile_utility    |   2   | fifo    | greedy  |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| worst_decile_utility    |   2   | fifo    | random  |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| worst_decile_utility    |   2   | greedy  | random  |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| social_welfare          |   0.8 | fifo    | greedy  |        30 |    -71.0155 |  -85.0945 |  -57.0651 |    -1.8155 |     0      | True               |
| social_welfare          |   0.8 | fifo    | random  |        30 |    100.502  |   88.2163 |  112.77   |     2.9542 |     0      | True               |
| social_welfare          |   0.8 | greedy  | random  |        30 |    171.517  |  158.65   |  183.199  |     4.9129 |     0      | True               |
| social_welfare          |   1.2 | fifo    | greedy  |        30 |   -117.904  | -134.624  | -102.79   |    -2.6084 |     0      | True               |
| social_welfare          |   1.2 | fifo    | random  |        30 |     98.5767 |   81.3224 |  116.453  |     1.9664 |     0      | True               |
| social_welfare          |   1.2 | greedy  | random  |        30 |    216.481  |  200.93   |  233.634  |     4.6804 |     0      | True               |
| social_welfare          |   2   | fifo    | greedy  |        30 |   -207.732  | -227.414  | -188.713  |    -3.7775 |     0      | True               |
| social_welfare          |   2   | fifo    | random  |        30 |    107.973  |   86.0817 |  130.782  |     1.7144 |     0      | True               |
| social_welfare          |   2   | greedy  | random  |        30 |    315.706  |  295.372  |  337.779  |     5.1855 |     0      | True               |
| utilization             |   0.8 | fifo    | greedy  |        30 |     -0.077  |   -0.0904 |   -0.0639 |    -2.0343 |     0      | True               |
| utilization             |   0.8 | fifo    | random  |        30 |      0.1037 |    0.0874 |    0.12   |     2.2016 |     0      | True               |
| utilization             |   0.8 | greedy  | random  |        30 |      0.1807 |    0.1639 |    0.1981 |     3.7121 |     0      | True               |
| utilization             |   1.2 | fifo    | greedy  |        30 |     -0.1285 |   -0.1428 |   -0.1141 |    -3.1247 |     0      | True               |
| utilization             |   1.2 | fifo    | random  |        30 |      0.1057 |    0.0867 |    0.1265 |     1.8496 |     0      | True               |
| utilization             |   1.2 | greedy  | random  |        30 |      0.2343 |    0.2174 |    0.2515 |     4.8214 |     0      | True               |
| utilization             |   2   | fifo    | greedy  |        30 |     -0.2406 |   -0.2602 |   -0.2219 |    -4.397  |     0      | True               |
| utilization             |   2   | fifo    | random  |        30 |      0.1031 |    0.0826 |    0.122  |     1.8299 |     0      | True               |
| utilization             |   2   | greedy  | random  |        30 |      0.3437 |    0.3243 |    0.3628 |     6.2545 |     0      | True               |
| illegal_allocation_rate |   0.8 | fifo    | greedy  |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| illegal_allocation_rate |   0.8 | fifo    | random  |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| illegal_allocation_rate |   0.8 | greedy  | random  |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| illegal_allocation_rate |   1.2 | fifo    | greedy  |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| illegal_allocation_rate |   1.2 | fifo    | random  |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| illegal_allocation_rate |   1.2 | greedy  | random  |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| illegal_allocation_rate |   2   | fifo    | greedy  |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| illegal_allocation_rate |   2   | fifo    | random  |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| illegal_allocation_rate |   2   | greedy  | random  |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| parse_failure_rate      |   0.8 | fifo    | greedy  |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| parse_failure_rate      |   0.8 | fifo    | random  |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| parse_failure_rate      |   0.8 | greedy  | random  |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| parse_failure_rate      |   1.2 | fifo    | greedy  |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| parse_failure_rate      |   1.2 | fifo    | random  |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| parse_failure_rate      |   1.2 | greedy  | random  |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| parse_failure_rate      |   2   | fifo    | greedy  |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| parse_failure_rate      |   2   | fifo    | random  |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| parse_failure_rate      |   2   | greedy  | random  |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| decision_latency_s      |   0.8 | fifo    | greedy  |        30 |     -0.0008 |   -0.0011 |   -0.0006 |    -1.1337 |     0      | True               |
| decision_latency_s      |   0.8 | fifo    | random  |        30 |     -0.0004 |   -0.0005 |   -0.0003 |    -1.1679 |     0      | True               |
| decision_latency_s      |   0.8 | greedy  | random  |        30 |      0.0004 |    0.0002 |    0.0007 |     0.5686 |     0.0206 | True               |
| decision_latency_s      |   1.2 | fifo    | greedy  |        30 |     -0.0008 |   -0.001  |   -0.0007 |    -2.087  |     0      | True               |
| decision_latency_s      |   1.2 | fifo    | random  |        30 |     -0.0012 |   -0.0015 |   -0.0009 |    -1.3041 |     0      | True               |
| decision_latency_s      |   1.2 | greedy  | random  |        30 |     -0.0004 |   -0.0007 |   -0.0001 |    -0.472  |     0.0601 | False              |
| decision_latency_s      |   2   | fifo    | greedy  |        30 |     -0.0001 |   -0.0004 |    0.0002 |    -0.1525 |     0.7706 | False              |
| decision_latency_s      |   2   | fifo    | random  |        30 |     -0.0003 |   -0.0007 |    0.0002 |    -0.2242 |     0.6881 | False              |
| decision_latency_s      |   2   | greedy  | random  |        30 |     -0.0001 |   -0.0005 |    0.0001 |    -0.1609 |     0.7706 | False              |
| cost_usd                |   0.8 | fifo    | greedy  |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| cost_usd                |   0.8 | fifo    | random  |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| cost_usd                |   0.8 | greedy  | random  |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| cost_usd                |   1.2 | fifo    | greedy  |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| cost_usd                |   1.2 | fifo    | random  |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| cost_usd                |   1.2 | greedy  | random  |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| cost_usd                |   2   | fifo    | greedy  |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| cost_usd                |   2   | fifo    | random  |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| cost_usd                |   2   | greedy  | random  |        30 |      0      |    0      |    0      |     0      |     1      | False              |


## Effort ablation: does more reasoning buy better allocations?

(no effort sweep present in this data -- run with --efforts low,medium,high)


## Two-way ANOVA (strategy x load), primary metrics

### success_rate

|               |   sum_sq |   df |         F |         PR(>F) |
|:--------------|---------:|-----:|----------:|---------------:|
| C(arm)        | 5.66233  |    2 | 671.39    |   1.25953e-103 |
| C(rho)        | 0.385389 |    2 |  45.6961  |   9.65291e-18  |
| C(arm):C(rho) | 0.139991 |    4 |   8.29947 |   2.5748e-06   |
| Residual      | 1.1006   |  261 | nan       | nan            |


### jains_index

|               |   sum_sq |   df |        F |        PR(>F) |
|:--------------|---------:|-----:|---------:|--------------:|
| C(arm)        | 3.37801  |    2 | 510.236  |   6.53976e-91 |
| C(rho)        | 0.324606 |    2 |  49.0306 |   8.35775e-19 |
| C(arm):C(rho) | 0.086874 |    4 |   6.561  |   4.79955e-05 |
| Residual      | 0.863973 |  261 | nan      | nan           |


## Notes

- Primary family (success_rate, jains_index) and secondary family are corrected *separately*, per the pre-registration rule in §5.1 of the proposal -- a secondary result is never allowed to steal significance budget from the primary family.
- `cohens_d` is computed on paired differences (mean_diff / sd(diff)); `cliffs_delta` is the non-parametric alternative. Report both -- see the Romano et al. (2006) thresholds in `cliffs_delta()`'s docstring for interpreting magnitude.
- An 'arm' is a strategy at one reasoning-effort level (e.g. `llm_negotiate@medium`); classic strategies have no effort knob and keep their bare name. Runs configured at different effort levels are never pooled.
- `worst_decile_utility` saturates at 0 whenever a strategy's failure rate exceeds 10% (the bottom decile is then entirely unsatisfied requests, which are pinned at utility 0) -- true for every cell in this run. It is not a coding error; it is a real floor effect worth flagging as a limitation of that particular metric rather than silently dropping it.
