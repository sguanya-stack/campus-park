# Statistical report

Source: `results/pricing_summary.csv`. Arms: ['p0_static', 'p1_rule_surge', 'p2_permuted_surge']. Loads (rho): [np.float64(0.8), np.float64(1.2), np.float64(2.0)]. n_seeds per cell: 30-30.

## Descriptive summary (mean per arm x load)

| arm               |   rho |   success_rate |   jains_index |   gini |   worst_decile_utility |   social_welfare |   utilization |   illegal_allocation_rate |   parse_failure_rate |   decision_latency_s |   cost_usd |
|:------------------|------:|---------------:|--------------:|-------:|-----------------------:|-----------------:|--------------:|--------------------------:|---------------------:|---------------------:|-----------:|
| p0_static         |   0.8 |         0.674  |        0.5112 | 0.5295 |                      0 |          7419.9  |        0.2964 |                         0 |                    0 |               0.0432 |          0 |
| p0_static         |   1.2 |         0.6356 |        0.4807 | 0.5577 |                      0 |         10402.3  |        0.4149 |                         0 |                    0 |               0.0654 |          0 |
| p0_static         |   2   |         0.5665 |        0.4277 | 0.6064 |                      0 |         15188.9  |        0.6068 |                         0 |                    0 |               0.1174 |          0 |
| p1_rule_surge     |   0.8 |         0.6694 |        0.5079 | 0.5326 |                      0 |          7342.02 |        0.2925 |                         0 |                    0 |               0.0554 |          0 |
| p1_rule_surge     |   1.2 |         0.6337 |        0.4789 | 0.5593 |                      0 |         10303.3  |        0.4106 |                         0 |                    0 |               0.0785 |          0 |
| p1_rule_surge     |   2   |         0.5544 |        0.4176 | 0.6154 |                      0 |         14662.3  |        0.5838 |                         0 |                    0 |               0.1413 |          0 |
| p2_permuted_surge |   0.8 |         0.6677 |        0.5062 | 0.5342 |                      0 |          7334.06 |        0.2931 |                         0 |                    0 |               0.0511 |          0 |
| p2_permuted_surge |   1.2 |         0.6249 |        0.4722 | 0.5654 |                      0 |         10184.7  |        0.4064 |                         0 |                    0 |               0.0807 |          0 |
| p2_permuted_surge |   2   |         0.5453 |        0.4111 | 0.6215 |                      0 |         14491.7  |        0.5792 |                         0 |                    0 |               0.141  |          0 |


## Primary metrics: pairwise paired comparisons (Holm-Bonferroni corrected)

| metric       |   rho | arm_a         | arm_b             |   n_pairs |   mean_a |   mean_b |   mean_diff |   ci95_lo |   ci95_hi |   cohens_d |   cliffs_delta |    t_p |   t_p_holm | reject_holm_0.05   |
|:-------------|------:|:--------------|:------------------|----------:|---------:|---------:|------------:|----------:|----------:|-----------:|---------------:|-------:|-----------:|:-------------------|
| success_rate |   0.8 | p0_static     | p1_rule_surge     |        30 |   0.674  |   0.6694 |      0.0046 |    0.0027 |    0.0066 |     0.8321 |         0.1822 | 0.0001 |     0.0003 | True               |
| success_rate |   0.8 | p0_static     | p2_permuted_surge |        30 |   0.674  |   0.6677 |      0.0063 |    0.005  |    0.0076 |     1.6905 |         0.3067 | 0      |     0      | True               |
| success_rate |   0.8 | p1_rule_surge | p2_permuted_surge |        30 |   0.6694 |   0.6677 |      0.0017 |   -0.0001 |    0.0034 |     0.3405 |         0.0978 | 0.0724 |     0.1173 | False              |
| success_rate |   1.2 | p0_static     | p1_rule_surge     |        30 |   0.6356 |   0.6337 |      0.0019 |    0      |    0.0036 |     0.3594 |         0.0944 | 0.0587 |     0.1173 | False              |
| success_rate |   1.2 | p0_static     | p2_permuted_surge |        30 |   0.6356 |   0.6249 |      0.0108 |    0.0091 |    0.0124 |     2.2859 |         0.3933 | 0      |     0      | True               |
| success_rate |   1.2 | p1_rule_surge | p2_permuted_surge |        30 |   0.6337 |   0.6249 |      0.0089 |    0.0068 |    0.0111 |     1.444  |         0.3144 | 0      |     0      | True               |
| success_rate |   2   | p0_static     | p1_rule_surge     |        30 |   0.5665 |   0.5544 |      0.0121 |    0.0102 |    0.014  |     2.2451 |         0.7344 | 0      |     0      | True               |
| success_rate |   2   | p0_static     | p2_permuted_surge |        30 |   0.5665 |   0.5453 |      0.0213 |    0.0193 |    0.0233 |     3.7403 |         0.9256 | 0      |     0      | True               |
| success_rate |   2   | p1_rule_surge | p2_permuted_surge |        30 |   0.5544 |   0.5453 |      0.0091 |    0.007  |    0.0113 |     1.488  |         0.5722 | 0      |     0      | True               |
| jains_index  |   0.8 | p0_static     | p1_rule_surge     |        30 |   0.5112 |   0.5079 |      0.0033 |    0.0019 |    0.0047 |     0.8223 |         0.1533 | 0.0001 |     0.0003 | True               |
| jains_index  |   0.8 | p0_static     | p2_permuted_surge |        30 |   0.5112 |   0.5062 |      0.0049 |    0.004  |    0.0059 |     1.7585 |         0.1911 | 0      |     0      | True               |
| jains_index  |   0.8 | p1_rule_surge | p2_permuted_surge |        30 |   0.5079 |   0.5062 |      0.0017 |    0.0003 |    0.003  |     0.4367 |         0.0622 | 0.0235 |     0.0235 | True               |
| jains_index  |   1.2 | p0_static     | p1_rule_surge     |        30 |   0.4807 |   0.4789 |      0.0018 |    0.0005 |    0.003  |     0.5066 |         0.0889 | 0.0096 |     0.0191 | True               |
| jains_index  |   1.2 | p0_static     | p2_permuted_surge |        30 |   0.4807 |   0.4722 |      0.0085 |    0.007  |    0.0099 |     2.1004 |         0.32   | 0      |     0      | True               |
| jains_index  |   1.2 | p1_rule_surge | p2_permuted_surge |        30 |   0.4789 |   0.4722 |      0.0067 |    0.005  |    0.0085 |     1.3554 |         0.2533 | 0      |     0      | True               |
| jains_index  |   2   | p0_static     | p1_rule_surge     |        30 |   0.4277 |   0.4176 |      0.0101 |    0.0087 |    0.0115 |     2.4683 |         0.6156 | 0      |     0      | True               |
| jains_index  |   2   | p0_static     | p2_permuted_surge |        30 |   0.4277 |   0.4111 |      0.0166 |    0.0152 |    0.018  |     4.2147 |         0.8156 | 0      |     0      | True               |
| jains_index  |   2   | p1_rule_surge | p2_permuted_surge |        30 |   0.4176 |   0.4111 |      0.0065 |    0.0049 |    0.0081 |     1.4157 |         0.3733 | 0      |     0      | True               |


## Secondary metrics: pairwise paired comparisons (Holm-Bonferroni corrected within family)

| metric                  |   rho | arm_a         | arm_b             |   n_pairs |   mean_diff |   ci95_lo |   ci95_hi |   cohens_d |   t_p_holm | reject_holm_0.05   |
|:------------------------|------:|:--------------|:------------------|----------:|------------:|----------:|----------:|-----------:|-----------:|:-------------------|
| gini                    |   0.8 | p0_static     | p1_rule_surge     |        30 |     -0.003  |   -0.0044 |   -0.0017 |    -0.7845 |     0.0005 | True               |
| gini                    |   0.8 | p0_static     | p2_permuted_surge |        30 |     -0.0046 |   -0.0055 |   -0.0038 |    -1.8869 |     0      | True               |
| gini                    |   0.8 | p1_rule_surge | p2_permuted_surge |        30 |     -0.0016 |   -0.0029 |   -0.0003 |    -0.4227 |     0.0302 | True               |
| gini                    |   1.2 | p0_static     | p1_rule_surge     |        30 |     -0.0016 |   -0.0028 |   -0.0004 |    -0.4716 |     0.0302 | True               |
| gini                    |   1.2 | p0_static     | p2_permuted_surge |        30 |     -0.0077 |   -0.009  |   -0.0065 |    -2.221  |     0      | True               |
| gini                    |   1.2 | p1_rule_surge | p2_permuted_surge |        30 |     -0.0061 |   -0.0078 |   -0.0046 |    -1.3347 |     0      | True               |
| gini                    |   2   | p0_static     | p1_rule_surge     |        30 |     -0.009  |   -0.0103 |   -0.0077 |    -2.4194 |     0      | True               |
| gini                    |   2   | p0_static     | p2_permuted_surge |        30 |     -0.0151 |   -0.0164 |   -0.0138 |    -4.0849 |     0      | True               |
| gini                    |   2   | p1_rule_surge | p2_permuted_surge |        30 |     -0.0061 |   -0.0076 |   -0.0047 |    -1.4701 |     0      | True               |
| worst_decile_utility    |   0.8 | p0_static     | p1_rule_surge     |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| worst_decile_utility    |   0.8 | p0_static     | p2_permuted_surge |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| worst_decile_utility    |   0.8 | p1_rule_surge | p2_permuted_surge |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| worst_decile_utility    |   1.2 | p0_static     | p1_rule_surge     |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| worst_decile_utility    |   1.2 | p0_static     | p2_permuted_surge |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| worst_decile_utility    |   1.2 | p1_rule_surge | p2_permuted_surge |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| worst_decile_utility    |   2   | p0_static     | p1_rule_surge     |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| worst_decile_utility    |   2   | p0_static     | p2_permuted_surge |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| worst_decile_utility    |   2   | p1_rule_surge | p2_permuted_surge |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| social_welfare          |   0.8 | p0_static     | p1_rule_surge     |        30 |     77.8777 |   61.3585 |   93.3118 |     1.7172 |     0      | True               |
| social_welfare          |   0.8 | p0_static     | p2_permuted_surge |        30 |     85.8441 |   71.6684 |  100.615  |     2.0722 |     0      | True               |
| social_welfare          |   0.8 | p1_rule_surge | p2_permuted_surge |        30 |      7.9664 |  -10.2092 |   27.5447 |     0.1491 |     0.4208 | False              |
| social_welfare          |   1.2 | p0_static     | p1_rule_surge     |        30 |     99.0008 |   71.9969 |  125.724  |     1.2663 |     0      | True               |
| social_welfare          |   1.2 | p0_static     | p2_permuted_surge |        30 |    217.594  |  193.736  |  242.467  |     3.1647 |     0      | True               |
| social_welfare          |   1.2 | p1_rule_surge | p2_permuted_surge |        30 |    118.593  |   83.417  |  154.937  |     1.1618 |     0      | True               |
| social_welfare          |   2   | p0_static     | p1_rule_surge     |        30 |    526.557  |  492.409  |  560.603  |     5.3515 |     0      | True               |
| social_welfare          |   2   | p0_static     | p2_permuted_surge |        30 |    697.226  |  659.031  |  737.331  |     6.2443 |     0      | True               |
| social_welfare          |   2   | p1_rule_surge | p2_permuted_surge |        30 |    170.668  |  123.546  |  217.667  |     1.2835 |     0      | True               |
| utilization             |   0.8 | p0_static     | p1_rule_surge     |        30 |      0.0039 |    0.0028 |    0.005  |     1.2417 |     0      | True               |
| utilization             |   0.8 | p0_static     | p2_permuted_surge |        30 |      0.0033 |    0.0025 |    0.004  |     1.5821 |     0      | True               |
| utilization             |   0.8 | p1_rule_surge | p2_permuted_surge |        30 |     -0.0006 |   -0.0016 |    0.0003 |    -0.2316 |     0.2147 | False              |
| utilization             |   1.2 | p0_static     | p1_rule_surge     |        30 |      0.0042 |    0.0028 |    0.0056 |     1.0231 |     0      | True               |
| utilization             |   1.2 | p0_static     | p2_permuted_surge |        30 |      0.0084 |    0.0071 |    0.0097 |     2.2648 |     0      | True               |
| utilization             |   1.2 | p1_rule_surge | p2_permuted_surge |        30 |      0.0042 |    0.0025 |    0.0059 |     0.876  |     0.0001 | True               |
| utilization             |   2   | p0_static     | p1_rule_surge     |        30 |      0.023  |    0.0207 |    0.0252 |     3.5774 |     0      | True               |
| utilization             |   2   | p0_static     | p2_permuted_surge |        30 |      0.0276 |    0.025  |    0.0301 |     3.8712 |     0      | True               |
| utilization             |   2   | p1_rule_surge | p2_permuted_surge |        30 |      0.0046 |    0.0019 |    0.0073 |     0.5892 |     0.0062 | True               |
| illegal_allocation_rate |   0.8 | p0_static     | p1_rule_surge     |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| illegal_allocation_rate |   0.8 | p0_static     | p2_permuted_surge |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| illegal_allocation_rate |   0.8 | p1_rule_surge | p2_permuted_surge |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| illegal_allocation_rate |   1.2 | p0_static     | p1_rule_surge     |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| illegal_allocation_rate |   1.2 | p0_static     | p2_permuted_surge |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| illegal_allocation_rate |   1.2 | p1_rule_surge | p2_permuted_surge |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| illegal_allocation_rate |   2   | p0_static     | p1_rule_surge     |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| illegal_allocation_rate |   2   | p0_static     | p2_permuted_surge |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| illegal_allocation_rate |   2   | p1_rule_surge | p2_permuted_surge |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| parse_failure_rate      |   0.8 | p0_static     | p1_rule_surge     |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| parse_failure_rate      |   0.8 | p0_static     | p2_permuted_surge |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| parse_failure_rate      |   0.8 | p1_rule_surge | p2_permuted_surge |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| parse_failure_rate      |   1.2 | p0_static     | p1_rule_surge     |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| parse_failure_rate      |   1.2 | p0_static     | p2_permuted_surge |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| parse_failure_rate      |   1.2 | p1_rule_surge | p2_permuted_surge |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| parse_failure_rate      |   2   | p0_static     | p1_rule_surge     |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| parse_failure_rate      |   2   | p0_static     | p2_permuted_surge |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| parse_failure_rate      |   2   | p1_rule_surge | p2_permuted_surge |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| decision_latency_s      |   0.8 | p0_static     | p1_rule_surge     |        30 |     -0.0122 |   -0.0189 |   -0.0058 |    -0.6614 |     0.0044 | True               |
| decision_latency_s      |   0.8 | p0_static     | p2_permuted_surge |        30 |     -0.0078 |   -0.0104 |   -0.0045 |    -0.9263 |     0.0001 | True               |
| decision_latency_s      |   0.8 | p1_rule_surge | p2_permuted_surge |        30 |      0.0043 |    0.0001 |    0.0101 |     0.3017 |     0.3276 | False              |
| decision_latency_s      |   1.2 | p0_static     | p1_rule_surge     |        30 |     -0.0131 |   -0.0163 |   -0.0088 |    -1.1828 |     0      | True               |
| decision_latency_s      |   1.2 | p0_static     | p2_permuted_surge |        30 |     -0.0153 |   -0.0187 |   -0.0108 |    -1.3409 |     0      | True               |
| decision_latency_s      |   1.2 | p1_rule_surge | p2_permuted_surge |        30 |     -0.0022 |   -0.006  |    0.0006 |    -0.2269 |     0.4478 | False              |
| decision_latency_s      |   2   | p0_static     | p1_rule_surge     |        30 |     -0.0239 |   -0.0256 |   -0.0219 |    -4.4951 |     0      | True               |
| decision_latency_s      |   2   | p0_static     | p2_permuted_surge |        30 |     -0.0236 |   -0.0249 |   -0.0218 |    -5.221  |     0      | True               |
| decision_latency_s      |   2   | p1_rule_surge | p2_permuted_surge |        30 |      0.0003 |   -0.0008 |    0.0014 |     0.0937 |     0.6115 | False              |
| cost_usd                |   0.8 | p0_static     | p1_rule_surge     |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| cost_usd                |   0.8 | p0_static     | p2_permuted_surge |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| cost_usd                |   0.8 | p1_rule_surge | p2_permuted_surge |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| cost_usd                |   1.2 | p0_static     | p1_rule_surge     |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| cost_usd                |   1.2 | p0_static     | p2_permuted_surge |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| cost_usd                |   1.2 | p1_rule_surge | p2_permuted_surge |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| cost_usd                |   2   | p0_static     | p1_rule_surge     |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| cost_usd                |   2   | p0_static     | p2_permuted_surge |        30 |      0      |    0      |    0      |     0      |     1      | False              |
| cost_usd                |   2   | p1_rule_surge | p2_permuted_surge |        30 |      0      |    0      |    0      |     0      |     1      | False              |


## Effort ablation: does more reasoning buy better allocations?

(no effort sweep present in this data -- run with --efforts low,medium,high)


## Two-way ANOVA (strategy x load), primary metrics

### success_rate

|               |     sum_sq |   df |          F |         PR(>F) |
|:--------------|-----------:|-----:|-----------:|---------------:|
| C(arm)        | 0.00734054 |    2 |   19.2675  |   1.56744e-08  |
| C(rho)        | 0.615232   |    2 | 1614.86    |   1.04978e-147 |
| C(arm):C(rho) | 0.00211471 |    4 |    2.77535 |   0.0275569    |
| Residual      | 0.049718   |  261 |  nan       | nan            |


### jains_index

|               |     sum_sq |   df |         F |         PR(>F) |
|:--------------|-----------:|-----:|----------:|---------------:|
| C(arm)        | 0.00449287 |    2 |   12.6017 |   5.96367e-06  |
| C(rho)        | 0.372572   |    2 | 1045      |   2.64922e-125 |
| C(arm):C(rho) | 0.00126696 |    4 |    1.7768 |   0.133847     |
| Residual      | 0.0465269  |  261 |  nan      | nan            |


## Notes

- Primary family (success_rate, jains_index) and secondary family are corrected *separately*, per the pre-registration rule in §5.1 of the proposal -- a secondary result is never allowed to steal significance budget from the primary family.
- `cohens_d` is computed on paired differences (mean_diff / sd(diff)); `cliffs_delta` is the non-parametric alternative. Report both -- see the Romano et al. (2006) thresholds in `cliffs_delta()`'s docstring for interpreting magnitude.
- An 'arm' is a strategy at one reasoning-effort level (e.g. `llm_negotiate@medium`); classic strategies have no effort knob and keep their bare name. Runs configured at different effort levels are never pooled.
- `worst_decile_utility` saturates at 0 whenever a strategy's failure rate exceeds 10% (the bottom decile is then entirely unsatisfied requests, which are pinned at utility 0) -- true for every cell in this run. It is not a coding error; it is a real floor effect worth flagging as a limitation of that particular metric rather than silently dropping it.
