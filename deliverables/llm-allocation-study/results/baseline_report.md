# Statistical report

Source: `results/baseline_summary.csv`. Arms: ['fifo', 'greedy', 'random']. Loads (rho): [np.float64(0.8), np.float64(1.2), np.float64(2.0)]. n_seeds per cell: 30-30.

## Descriptive summary (mean per arm x load)

| arm    |   rho |   success_rate |   jains_index |   gini |   worst_decile_utility |   social_welfare |   utilization |   illegal_allocation_rate |   parse_failure_rate |   decision_latency_s |   cost_usd |
|:-------|------:|---------------:|--------------:|-------:|-----------------------:|-----------------:|--------------:|--------------------------:|---------------------:|---------------------:|-----------:|
| fifo   |   0.8 |         0.5789 |        0.4403 | 0.5954 |                      0 |          6386.02 |        0.2536 |                         0 |                    0 |               0.0141 |          0 |
| fifo   |   1.2 |         0.5022 |        0.3824 | 0.6491 |                      0 |          8254.2  |        0.3278 |                         0 |                    0 |               0.0222 |          0 |
| fifo   |   2   |         0.3667 |        0.2788 | 0.7441 |                      0 |         10030.3  |        0.3971 |                         0 |                    0 |               0.0367 |          0 |
| greedy |   0.8 |         0.674  |        0.5112 | 0.5295 |                      0 |          7419.9  |        0.2964 |                         0 |                    0 |               0.0362 |          0 |
| greedy |   1.2 |         0.6356 |        0.4807 | 0.5577 |                      0 |         10402.3  |        0.4149 |                         0 |                    0 |               0.0603 |          0 |
| greedy |   2   |         0.5665 |        0.4277 | 0.6064 |                      0 |         15188.9  |        0.6068 |                         0 |                    0 |               0.1465 |          0 |
| random |   0.8 |         0.2384 |        0.1805 | 0.8339 |                      0 |          2421.27 |        0.0986 |                         0 |                    0 |               0.0213 |          0 |
| random |   1.2 |         0.2348 |        0.1759 | 0.8375 |                      0 |          3618.98 |        0.1455 |                         0 |                    0 |               0.0348 |          0 |
| random |   2   |         0.2354 |        0.1773 | 0.8364 |                      0 |          6037.88 |        0.2441 |                         0 |                    0 |               0.076  |          0 |


## Primary metrics: pairwise paired comparisons (Holm-Bonferroni corrected)

| metric       |   rho | arm_a   | arm_b   |   n_pairs |   mean_a |   mean_b |   mean_diff |   ci95_lo |   ci95_hi |   cohens_d |   cliffs_delta |   t_p |   t_p_holm | reject_holm_0.05   |
|:-------------|------:|:--------|:--------|----------:|---------:|---------:|------------:|----------:|----------:|-----------:|---------------:|------:|-----------:|:-------------------|
| success_rate |   0.8 | fifo    | greedy  |        30 |   0.5789 |   0.674  |     -0.095  |   -0.0996 |   -0.0904 |    -7.1891 |        -1      |     0 |          0 | True               |
| success_rate |   0.8 | fifo    | random  |        30 |   0.5789 |   0.2384 |      0.3405 |    0.3316 |    0.3496 |    13.0058 |         1      |     0 |          0 | True               |
| success_rate |   0.8 | greedy  | random  |        30 |   0.674  |   0.2384 |      0.4356 |    0.4285 |    0.4428 |    21.1758 |         1      |     0 |          0 | True               |
| success_rate |   1.2 | fifo    | greedy  |        30 |   0.5022 |   0.6356 |     -0.1334 |   -0.1378 |   -0.1289 |   -10.359  |        -1      |     0 |          0 | True               |
| success_rate |   1.2 | fifo    | random  |        30 |   0.5022 |   0.2348 |      0.2675 |    0.2623 |    0.2726 |    17.9743 |         1      |     0 |          0 | True               |
| success_rate |   1.2 | greedy  | random  |        30 |   0.6356 |   0.2348 |      0.4009 |    0.3957 |    0.406  |    27.1255 |         1      |     0 |          0 | True               |
| success_rate |   2   | fifo    | greedy  |        30 |   0.3667 |   0.5665 |     -0.1999 |   -0.2033 |   -0.1964 |   -20.2943 |        -1      |     0 |          0 | True               |
| success_rate |   2   | fifo    | random  |        30 |   0.3667 |   0.2354 |      0.1313 |    0.126  |    0.1363 |     9.0965 |         1      |     0 |          0 | True               |
| success_rate |   2   | greedy  | random  |        30 |   0.5665 |   0.2354 |      0.3312 |    0.3269 |    0.3355 |    27.0153 |         1      |     0 |          0 | True               |
| jains_index  |   0.8 | fifo    | greedy  |        30 |   0.4403 |   0.5112 |     -0.0708 |   -0.0747 |   -0.0668 |    -6.224  |        -0.9978 |     0 |          0 | True               |
| jains_index  |   0.8 | fifo    | random  |        30 |   0.4403 |   0.1805 |      0.2599 |    0.2522 |    0.2676 |    11.6251 |         1      |     0 |          0 | True               |
| jains_index  |   0.8 | greedy  | random  |        30 |   0.5112 |   0.1805 |      0.3307 |    0.3244 |    0.3374 |    17.6152 |         1      |     0 |          0 | True               |
| jains_index  |   1.2 | fifo    | greedy  |        30 |   0.3824 |   0.4807 |     -0.0983 |   -0.1022 |   -0.0944 |    -8.6861 |        -1      |     0 |          0 | True               |
| jains_index  |   1.2 | fifo    | random  |        30 |   0.3824 |   0.1759 |      0.2065 |    0.2014 |    0.2112 |    14.8151 |         1      |     0 |          0 | True               |
| jains_index  |   1.2 | greedy  | random  |        30 |   0.4807 |   0.1759 |      0.3048 |    0.2996 |    0.3098 |    20.8577 |         1      |     0 |          0 | True               |
| jains_index  |   2   | fifo    | greedy  |        30 |   0.2788 |   0.4277 |     -0.1489 |   -0.1521 |   -0.1455 |   -15.8914 |        -1      |     0 |          0 | True               |
| jains_index  |   2   | fifo    | random  |        30 |   0.2788 |   0.1773 |      0.1015 |    0.0974 |    0.1056 |     8.8586 |         1      |     0 |          0 | True               |
| jains_index  |   2   | greedy  | random  |        30 |   0.4277 |   0.1773 |      0.2504 |    0.2474 |    0.2534 |    29.8095 |         1      |     0 |          0 | True               |


## Secondary metrics: pairwise paired comparisons (Holm-Bonferroni corrected within family)

| metric                  |   rho | arm_a   | arm_b   |   n_pairs |   mean_diff |    ci95_lo |    ci95_hi |   cohens_d |   t_p_holm | reject_holm_0.05   |
|:------------------------|------:|:--------|:--------|----------:|------------:|-----------:|-----------:|-----------:|-----------:|:-------------------|
| gini                    |   0.8 | fifo    | greedy  |        30 |      0.0659 |     0.0624 |     0.0693 |     6.6167 |     0      | True               |
| gini                    |   0.8 | fifo    | random  |        30 |     -0.2385 |    -0.2452 |    -0.2318 |   -12.3291 |     0      | True               |
| gini                    |   0.8 | greedy  | random  |        30 |     -0.3043 |    -0.3099 |    -0.299  |   -19.4546 |     0      | True               |
| gini                    |   1.2 | fifo    | greedy  |        30 |      0.0914 |     0.0881 |     0.0946 |     9.6257 |     0      | True               |
| gini                    |   1.2 | fifo    | random  |        30 |     -0.1884 |    -0.1925 |    -0.1842 |   -16.0122 |     0      | True               |
| gini                    |   1.2 | greedy  | random  |        30 |     -0.2798 |    -0.2841 |    -0.2753 |   -22.5164 |     0      | True               |
| gini                    |   2   | fifo    | greedy  |        30 |      0.1376 |     0.1349 |     0.1403 |    17.9802 |     0      | True               |
| gini                    |   2   | fifo    | random  |        30 |     -0.0923 |    -0.096  |    -0.0886 |    -8.8147 |     0      | True               |
| gini                    |   2   | greedy  | random  |        30 |     -0.23   |    -0.2329 |    -0.2271 |   -27.3814 |     0      | True               |
| worst_decile_utility    |   0.8 | fifo    | greedy  |        30 |      0      |     0      |     0      |     0      |     1      | False              |
| worst_decile_utility    |   0.8 | fifo    | random  |        30 |      0      |     0      |     0      |     0      |     1      | False              |
| worst_decile_utility    |   0.8 | greedy  | random  |        30 |      0      |     0      |     0      |     0      |     1      | False              |
| worst_decile_utility    |   1.2 | fifo    | greedy  |        30 |      0      |     0      |     0      |     0      |     1      | False              |
| worst_decile_utility    |   1.2 | fifo    | random  |        30 |      0      |     0      |     0      |     0      |     1      | False              |
| worst_decile_utility    |   1.2 | greedy  | random  |        30 |      0      |     0      |     0      |     0      |     1      | False              |
| worst_decile_utility    |   2   | fifo    | greedy  |        30 |      0      |     0      |     0      |     0      |     1      | False              |
| worst_decile_utility    |   2   | fifo    | random  |        30 |      0      |     0      |     0      |     0      |     1      | False              |
| worst_decile_utility    |   2   | greedy  | random  |        30 |      0      |     0      |     0      |     0      |     1      | False              |
| social_welfare          |   0.8 | fifo    | greedy  |        30 |  -1033.88   | -1087.53   |  -979.16   |    -6.6347 |     0      | True               |
| social_welfare          |   0.8 | fifo    | random  |        30 |   3964.75   |  3876.07   |  4060.5    |    14.9145 |     0      | True               |
| social_welfare          |   0.8 | greedy  | random  |        30 |   4998.63   |  4923.49   |  5078.2    |    22.4827 |     0      | True               |
| social_welfare          |   1.2 | fifo    | greedy  |        30 |  -2148.11   | -2235.82   | -2060.52   |    -8.6447 |     0      | True               |
| social_welfare          |   1.2 | fifo    | random  |        30 |   4635.22   |  4540.73   |  4729.98   |    17.2999 |     0      | True               |
| social_welfare          |   1.2 | greedy  | random  |        30 |   6783.32   |  6686.58   |  6876.26   |    24.9628 |     0      | True               |
| social_welfare          |   2   | fifo    | greedy  |        30 |  -5158.6    | -5270.62   | -5050.73   |   -16.1935 |     0      | True               |
| social_welfare          |   2   | fifo    | random  |        30 |   3992.41   |  3838.6    |  4143.75   |     9.2066 |     0      | True               |
| social_welfare          |   2   | greedy  | random  |        30 |   9151.01   |  9033.97   |  9263.28   |    27.9578 |     0      | True               |
| utilization             |   0.8 | fifo    | greedy  |        30 |     -0.0427 |    -0.0448 |    -0.0406 |    -7.1464 |     0      | True               |
| utilization             |   0.8 | fifo    | random  |        30 |      0.155  |     0.1509 |     0.1593 |    12.747  |     0      | True               |
| utilization             |   0.8 | greedy  | random  |        30 |      0.1977 |     0.1942 |     0.2015 |    18.7907 |     0      | True               |
| utilization             |   1.2 | fifo    | greedy  |        30 |     -0.0871 |    -0.0897 |    -0.0845 |   -11.5326 |     0      | True               |
| utilization             |   1.2 | fifo    | random  |        30 |      0.1823 |     0.1785 |     0.1859 |    17.409  |     0      | True               |
| utilization             |   1.2 | greedy  | random  |        30 |      0.2694 |     0.266  |     0.2727 |    28.3587 |     0      | True               |
| utilization             |   2   | fifo    | greedy  |        30 |     -0.2096 |    -0.2129 |    -0.2065 |   -22.5302 |     0      | True               |
| utilization             |   2   | fifo    | random  |        30 |      0.1531 |     0.1478 |     0.158  |    10.4927 |     0      | True               |
| utilization             |   2   | greedy  | random  |        30 |      0.3627 |     0.3582 |     0.367  |    28.6475 |     0      | True               |
| illegal_allocation_rate |   0.8 | fifo    | greedy  |        30 |      0      |     0      |     0      |     0      |     1      | False              |
| illegal_allocation_rate |   0.8 | fifo    | random  |        30 |      0      |     0      |     0      |     0      |     1      | False              |
| illegal_allocation_rate |   0.8 | greedy  | random  |        30 |      0      |     0      |     0      |     0      |     1      | False              |
| illegal_allocation_rate |   1.2 | fifo    | greedy  |        30 |      0      |     0      |     0      |     0      |     1      | False              |
| illegal_allocation_rate |   1.2 | fifo    | random  |        30 |      0      |     0      |     0      |     0      |     1      | False              |
| illegal_allocation_rate |   1.2 | greedy  | random  |        30 |      0      |     0      |     0      |     0      |     1      | False              |
| illegal_allocation_rate |   2   | fifo    | greedy  |        30 |      0      |     0      |     0      |     0      |     1      | False              |
| illegal_allocation_rate |   2   | fifo    | random  |        30 |      0      |     0      |     0      |     0      |     1      | False              |
| illegal_allocation_rate |   2   | greedy  | random  |        30 |      0      |     0      |     0      |     0      |     1      | False              |
| parse_failure_rate      |   0.8 | fifo    | greedy  |        30 |      0      |     0      |     0      |     0      |     1      | False              |
| parse_failure_rate      |   0.8 | fifo    | random  |        30 |      0      |     0      |     0      |     0      |     1      | False              |
| parse_failure_rate      |   0.8 | greedy  | random  |        30 |      0      |     0      |     0      |     0      |     1      | False              |
| parse_failure_rate      |   1.2 | fifo    | greedy  |        30 |      0      |     0      |     0      |     0      |     1      | False              |
| parse_failure_rate      |   1.2 | fifo    | random  |        30 |      0      |     0      |     0      |     0      |     1      | False              |
| parse_failure_rate      |   1.2 | greedy  | random  |        30 |      0      |     0      |     0      |     0      |     1      | False              |
| parse_failure_rate      |   2   | fifo    | greedy  |        30 |      0      |     0      |     0      |     0      |     1      | False              |
| parse_failure_rate      |   2   | fifo    | random  |        30 |      0      |     0      |     0      |     0      |     1      | False              |
| parse_failure_rate      |   2   | greedy  | random  |        30 |      0      |     0      |     0      |     0      |     1      | False              |
| decision_latency_s      |   0.8 | fifo    | greedy  |        30 |     -0.0222 |    -0.0236 |    -0.0211 |    -6.3002 |     0      | True               |
| decision_latency_s      |   0.8 | fifo    | random  |        30 |     -0.0072 |    -0.008  |    -0.0067 |    -4.093  |     0      | True               |
| decision_latency_s      |   0.8 | greedy  | random  |        30 |      0.0149 |     0.0141 |     0.0161 |     5.1365 |     0      | True               |
| decision_latency_s      |   1.2 | fifo    | greedy  |        30 |     -0.0381 |    -0.0399 |    -0.0364 |    -7.6564 |     0      | True               |
| decision_latency_s      |   1.2 | fifo    | random  |        30 |     -0.0126 |    -0.0143 |    -0.011  |    -2.7062 |     0      | True               |
| decision_latency_s      |   1.2 | greedy  | random  |        30 |      0.0255 |     0.0239 |     0.0272 |     5.382  |     0      | True               |
| decision_latency_s      |   2   | fifo    | greedy  |        30 |     -0.1098 |    -0.1432 |    -0.0842 |    -1.2814 |     0      | True               |
| decision_latency_s      |   2   | fifo    | random  |        30 |     -0.0393 |    -0.0484 |    -0.0324 |    -1.7019 |     0      | True               |
| decision_latency_s      |   2   | greedy  | random  |        30 |      0.0705 |     0.0423 |     0.1059 |     0.7634 |     0.0002 | True               |
| cost_usd                |   0.8 | fifo    | greedy  |        30 |      0      |     0      |     0      |     0      |     1      | False              |
| cost_usd                |   0.8 | fifo    | random  |        30 |      0      |     0      |     0      |     0      |     1      | False              |
| cost_usd                |   0.8 | greedy  | random  |        30 |      0      |     0      |     0      |     0      |     1      | False              |
| cost_usd                |   1.2 | fifo    | greedy  |        30 |      0      |     0      |     0      |     0      |     1      | False              |
| cost_usd                |   1.2 | fifo    | random  |        30 |      0      |     0      |     0      |     0      |     1      | False              |
| cost_usd                |   1.2 | greedy  | random  |        30 |      0      |     0      |     0      |     0      |     1      | False              |
| cost_usd                |   2   | fifo    | greedy  |        30 |      0      |     0      |     0      |     0      |     1      | False              |
| cost_usd                |   2   | fifo    | random  |        30 |      0      |     0      |     0      |     0      |     1      | False              |
| cost_usd                |   2   | greedy  | random  |        30 |      0      |     0      |     0      |     0      |     1      | False              |


## Effort ablation: does more reasoning buy better allocations?

(no effort sweep present in this data -- run with --efforts low,medium,high)


## Two-way ANOVA (strategy x load), primary metrics

### success_rate

|               |    sum_sq |   df |         F |         PR(>F) |
|:--------------|----------:|-----:|----------:|---------------:|
| C(arm)        | 6.97791   |    2 | 18933.3   |   3.31105e-283 |
| C(rho)        | 0.532841  |    2 |  1445.76  |   6.26065e-142 |
| C(arm):C(rho) | 0.338379  |    4 |   459.064 |   9.07256e-117 |
| Residual      | 0.0480962 |  261 |   nan     | nan            |


### jains_index

|               |    sum_sq |   df |         F |         PR(>F) |
|:--------------|----------:|-----:|----------:|---------------:|
| C(arm)        | 4.02754   |    2 | 13241     |   4.1769e-263  |
| C(rho)        | 0.314345  |    2 |  1033.44  |   9.61994e-125 |
| C(arm):C(rho) | 0.194856  |    4 |   320.305 |   2.27817e-99  |
| Residual      | 0.0396946 |  261 |   nan     | nan            |


## Notes

- Primary family (success_rate, jains_index) and secondary family are corrected *separately*, per the pre-registration rule in §5.1 of the proposal -- a secondary result is never allowed to steal significance budget from the primary family.
- `cohens_d` is computed on paired differences (mean_diff / sd(diff)); `cliffs_delta` is the non-parametric alternative. Report both -- see the Romano et al. (2006) thresholds in `cliffs_delta()`'s docstring for interpreting magnitude.
- An 'arm' is a strategy at one reasoning-effort level (e.g. `llm_negotiate@medium`); classic strategies have no effort knob and keep their bare name. Runs configured at different effort levels are never pooled.
- `worst_decile_utility` saturates at 0 whenever a strategy's failure rate exceeds 10% (the bottom decile is then entirely unsatisfied requests, which are pinned at utility 0) -- true for every cell in this run. It is not a coding error; it is a real floor effect worth flagging as a limitation of that particular metric rather than silently dropping it.
