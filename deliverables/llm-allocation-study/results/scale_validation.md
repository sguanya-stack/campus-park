# Scale validation: compact (cap=30) vs full-size (cap=833) fleet

Requests per episode -- full-size: {0.8: 666, 1.2: 1000, 2.0: 1666}; compact: {0.8: 24, 1.2: 36, 2.0: 60}

## Does the strategy ordering survive the shrink?

| metric       |   rho | large_order            | compact_order          | order_preserved   |
|:-------------|------:|:-----------------------|:-----------------------|:------------------|
| success_rate |   0.8 | greedy > fifo > random | greedy > fifo > random | True              |
| jains_index  |   0.8 | greedy > fifo > random | greedy > fifo > random | True              |
| success_rate |   1.2 | greedy > fifo > random | greedy > fifo > random | True              |
| jains_index  |   1.2 | greedy > fifo > random | greedy > fifo > random | True              |
| success_rate |   2   | greedy > fifo > random | greedy > fifo > random | True              |
| jains_index  |   2   | greedy > fifo > random | greedy > fifo > random | True              |

## Per-cell means and unpaired effect sizes

| metric       | strategy   |   rho |   large_mean |   compact_mean |   abs_diff |   cohens_d |
|:-------------|:-----------|------:|-------------:|---------------:|-----------:|-----------:|
| success_rate | fifo       |   0.8 |       0.5789 |         0.4611 |     0.1178 |     3.1926 |
| success_rate | fifo       |   1.2 |       0.5022 |         0.3815 |     0.1208 |     2.7095 |
| success_rate | fifo       |   2   |       0.3667 |         0.3061 |     0.0606 |     2.5932 |
| success_rate | greedy     |   0.8 |       0.674  |         0.6389 |     0.0351 |     0.5298 |
| success_rate | greedy     |   1.2 |       0.6356 |         0.575  |     0.0606 |     1.2784 |
| success_rate | greedy     |   2   |       0.5665 |         0.5372 |     0.0293 |     0.8227 |
| success_rate | random     |   0.8 |       0.2384 |         0.2417 |     0.0033 |    -0.056  |
| success_rate | random     |   1.2 |       0.2348 |         0.2269 |     0.0079 |     0.142  |
| success_rate | random     |   2   |       0.2354 |         0.2217 |     0.0137 |     0.3576 |
| jains_index  | fifo       |   0.8 |       0.4403 |         0.3693 |     0.071  |     1.9157 |
| jains_index  | fifo       |   1.2 |       0.3824 |         0.2988 |     0.0836 |     2.3712 |
| jains_index  | fifo       |   2   |       0.2788 |         0.2404 |     0.0384 |     1.5818 |
| jains_index  | greedy     |   0.8 |       0.5112 |         0.5104 |     0.0008 |     0.0134 |
| jains_index  | greedy     |   1.2 |       0.4807 |         0.4432 |     0.0375 |     0.7818 |
| jains_index  | greedy     |   2   |       0.4277 |         0.4124 |     0.0153 |     0.3796 |
| jains_index  | random     |   0.8 |       0.1805 |         0.1974 |     0.0169 |    -0.3644 |
| jains_index  | random     |   1.2 |       0.1759 |         0.1761 |     0.0001 |    -0.0032 |
| jains_index  | random     |   2   |       0.1773 |         0.1723 |     0.005  |     0.1643 |
| gini         | fifo       |   0.8 |       0.5954 |         0.6618 |     0.0664 |    -2.0178 |
| gini         | fifo       |   1.2 |       0.6491 |         0.727  |     0.0779 |    -2.419  |
| gini         | fifo       |   2   |       0.7441 |         0.7801 |     0.036  |    -1.7525 |
| gini         | greedy     |   0.8 |       0.5295 |         0.5362 |     0.0067 |    -0.1263 |
| gini         | greedy     |   1.2 |       0.5577 |         0.5948 |     0.0371 |    -0.887  |
| gini         | greedy     |   2   |       0.6064 |         0.6209 |     0.0144 |    -0.4382 |
| gini         | random     |   0.8 |       0.8339 |         0.8188 |     0.0151 |     0.3622 |
| gini         | random     |   1.2 |       0.8375 |         0.8377 |     0.0002 |    -0.0066 |
| gini         | random     |   2   |       0.8364 |         0.8412 |     0.0048 |    -0.1791 |
| utilization  | fifo       |   0.8 |       0.2536 |         0.2004 |     0.0533 |     2.5855 |
| utilization  | fifo       |   1.2 |       0.3278 |         0.2515 |     0.0763 |     2.8836 |
| utilization  | fifo       |   2   |       0.3971 |         0.3313 |     0.0658 |     2.7185 |
| utilization  | greedy     |   0.8 |       0.2964 |         0.2774 |     0.019  |     0.6115 |
| utilization  | greedy     |   1.2 |       0.4149 |         0.38   |     0.0349 |     1.0746 |
| utilization  | greedy     |   2   |       0.6068 |         0.5719 |     0.0349 |     0.7994 |
| utilization  | random     |   0.8 |       0.0986 |         0.0967 |     0.002  |     0.0764 |
| utilization  | random     |   1.2 |       0.1455 |         0.1457 |     0.0002 |    -0.0068 |
| utilization  | random     |   2   |       0.2441 |         0.2281 |     0.0159 |     0.3565 |

## Reading this

- The ordering table is the load-bearing one: if `order_preserved` is True everywhere, the compact fleet reproduces the phenomenon and is a defensible stand-in for the LLM arms, which cannot be afforded at full size.
- `cohens_d` here is UNPAIRED (different scenario populations), so treat it as a magnitude-of-offset indicator, not a hypothesis test. A non-trivial d with a small `abs_diff` just means both distributions are tight, not that the shrink broke anything.
- Any residual offset between scales does NOT bias the LLM-vs-classic comparison, because that comparison is run entirely within the compact grid against classic baselines measured at the same compact scale and the same seeds.
