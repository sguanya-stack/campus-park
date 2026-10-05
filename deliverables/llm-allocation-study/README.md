# LLM 智能体协商式车位分配 — 实验 harness

对应 Proposal：[research_proposal_llm_allocation.md](../research_proposal_llm_allocation.md)
数据字段来源（真实 vs 合成）：[data_provenance.md](data_provenance.md)

## 现状（截至本次会话）

| 部分 | 状态 |
|---|---|
| 仿真器（真实数据加载 + 场景生成 + 区间调度） | ✅ 完成，已跑通 |
| B0 Random / B1 FIFO / B2 Greedy 三个经典基线（大规模，cap=833） | ✅ 270 episode，零非法分配 |
| 同上（compact，cap=30，与 LLM 臂配对用） | ✅ 270 episode |
| **缩放验证**：compact 是否忠实复现大规模场景 | ✅ 策略排序 6/6 保持，均值最大偏差 0.121 |
| 统计分析脚本（配对检验 + Holm-Bonferroni + 双因素 ANOVA + bootstrap CI） | ✅ 完成，两个尺度都出了报告 |
| **离线成本预估器**（不花钱、不需 key） | ✅ 完成，推翻了 Proposal 原来的成本论证 |
| **Experiment B（动态定价基准，§6.3）** | ✅ **完成，270 episode，三条结论全部显著** |
| effort 作为实验因子（扫 low/medium/high） | ✅ 已接入 runner 与分析端，含消融小节 |
| T1（LLM 单轮中央分配器）代码 | ✅ 代码完成 + 假客户端管线自测，**未跑真实 episode** |
| T2（LLM 多轮协商）代码 | ✅ 代码完成 + 假客户端管线自测，**未跑真实 episode** |
| 真实 LLM episode（花钱的部分） | ❌ 未跑 —— 本环境没有 `ANTHROPIC_API_KEY` |

### Experiment B 结果摘要（已跑完，见 [results/pricing_findings.md](results/pricing_findings.md)）

生产环境的 surge 规则（`server.js:574` 的 ×1.5）做的是**用利用率换收入**：

- 利用率**下降** 3.79%（ρ=2.0，d=−3.58，p=2.9e−18）——预先声明的主指标上的负面结果
- 收入上升 6.15%，但**全部来自需求瞄准**：同均值随机加价（P2）多收 13.8% 的价格，
  收入反而**显著下降 0.78%**（p=0.008）
- 没有 P2 这个置换对照，会得出"动态定价提升收入 6%"并错误归因于价格杠杆

**设计已于 2026-09-23 冻结**，见 [PRE_REGISTRATION.md](PRE_REGISTRATION.md)：cap=240、
n=60（消融 n=20）、effort 主档 high + 消融 low/medium、prompt 指纹已记录。经典臂已在该
配置下跑完 540 episode，实测 MDE 0.52–0.95 pp。

**现在只剩一件事挡在真实实验前面：`ANTHROPIC_API_KEY`。** 拿到 key 后先按
[PILOT_PLAN.md](PILOT_PLAN.md) 花约 \$6 跑四步 pilot，每步都有明确的"发现什么就停"的门槛，
全部通过再投主网格（约 \$748，Batch API 后约 \$374）。

## 工程层（serving/）：把研究结论变成能上线的东西

研究发现 LLM 会产出传统调度器结构上不可能产出的分配（幻觉车位、重复占位、EV 错配，
即假设 H3）。**所以生产环境一行都不信任模型输出。**

```
请求
  → 成本上限闸      超过预算直接拒绝走模型
  → 熔断器          模型连续失败时彻底跳过，不再烧钱
  → 截止时间 + 有界重试
  → LLM 策略        harness/ 原封不动，与预注册一致
  → 校验闸          用与实验完全相同的 validator，非法分配一律丢弃，绝不修补
  → Greedy 兜底     把模型丢掉的请求重新分配一遍
  → 遥测            延迟 / 成本 / 非法率 / 降级率
```

**关键约束：预注册 §5 明令禁止重试失败 episode、禁止修补非法分配**——因为两者都会抹掉
研究要测量的失败模式。而生产的义务恰恰相反。把两者分成两层，是唯一能让两个要求同时成立的
做法：`serving/` 只包装、不修改 `harness/policies/`。

### 控制台（前端）

`GET /` 是一个实时看板：熔断器三态徽章、吞吐/质量/可靠性/成本磁贴、决策日志、
以及一个注入合成流量的按钮。标准库托管，零外部依赖、零 CDN、支持明暗两模式。

**演示模式**（`ALLOCATOR_POLICY=demo`）用一个**假模型**驱动整条链路——它会故意幻觉车位
ID、故意失败——这样在没有 API key 的情况下也能演示校验闸拦截、熔断器跳闸、Greedy 接管
的完整过程。页面顶部有醒目横幅声明"**这些数字不是研究数据**"，`/healthz` 也会返回
`mode: simulated`。

```bash
python3 -m serving.app                        # 真实臂（无 key 则降级 Greedy）
ALLOCATOR_POLICY=demo python3 -m serving.app   # 演示模式，可见安全层全部行为
# 浏览器打开 http://localhost:8080
```

```bash
# 启动（没有 API key 也能跑，会以降级模式服务 Greedy）
python3 -m serving.app

curl -X POST localhost:8080/allocate -H 'Content-Type: application/json' \
  -d '[{"id":"r1","arrival_minute":10,"duration_minutes":60,"trip_value":30,
        "origin_lat":47.61385,"origin_lng":-122.20017}]'
# → {"policy":"greedy","degraded":true,"reason":"circuit_open",...}

curl localhost:8080/healthz   # 503 + status=degraded（诚实汇报降级，不假装健康）
curl localhost:8080/metrics   # p50/p95 延迟、成本、降级率、非法分配率
```

标准库实现，无框架——与 CampusPark 自己的 `server.js`（纯 `http.createServer`）保持一致。

## 测试与 CI

```bash
python3 -m pytest tests/ -q     # 93 passed in ~23s
```

全部测试使用桩客户端，`conftest.py` 会**硬阻断对外网络连接**——一个不小心开始调真实 API 的
测试会让每次 push 都花钱，所以从机制上让它不可能发生。

CI（`.github/workflows/ci.yml` 的 `allocation-study` job）在无 API key 的环境下检查：
单元与集成测试、**两次独立运行结果逐位一致**、经典策略零非法分配、**prompt 指纹与预注册一致**
（防止事后调 prompt）、以及服务在无 key 时降级而非崩溃。

## 目录结构

```
harness/
  data_loader.py       真实 CSV → Spot 列表（价格真实，容量/坐标/EV 合成，见 data_provenance.md）
  scenario.py           Spot 列表 + rho + seed → Request 流（完全确定性可复现）
  interval_lanes.py     车位车道区间调度引擎（每个策略、validator 共用同一份，标准不打折）
  validator.py          独立复核硬约束（容量/EV/存在性），LLM 输出不被信任
  metrics.py             §4 全部指标（success_rate、jains_index、gini、illegal_allocation_rate...）
  policies/
    random_policy.py    B0
    fifo_policy.py       B1（对应 test-concurrency.js 的原子事务真实行为）
    greedy_policy.py      B2
    llm_common.py         T1/T2 共享：定价表、窗口分组、strict tool schema、commit-and-validate
    llm_central.py         T1
    llm_negotiate.py       T2（user-agent 出价 → broker 暂定分配 → 修正 → broker 定案）
  run_experiment.py     CLI：跑策略 × 负载 × 种子网格，写 runs/*.json + results/*.csv
  analyze.py             CLI：配对检验 + ANOVA + Holm-Bonferroni，写 results/*.md
  compare_scales.py      CLI：compact vs 全尺寸的缩放验证
  estimate_cost.py       CLI：离线成本预估（录制真实 prompt，不发网络请求）
  power_analysis.py      CLI：用实测方差反算 MDE 与所需样本量（配对设计口径）
  sensitivity_report.py  CLI：效用参数敏感性扫描汇总
  combine_results.py     CLI：合并 Experiment A 各结果文件（拒绝不配对/重复行）
  variance_analysis.py   CLI：场景方差 vs 模型抖动分解 + ICC（替代 temperature=0）
serving/                 生产层（只包装 harness/，不修改它）
  safety.py              熔断器 + 校验闸（非法分配丢弃不修补）
  allocator.py           组合：预算闸 / 熔断 / 截止时间 / 重试 / 兜底 / 遥测
  telemetry.py           JSONL 结构化事件 + 滚动指标
  app.py                 HTTP 服务 + 控制台路由 + 演示用假模型（标准库，无框架）
  static/dashboard.html  实时控制台（单文件，无依赖，明暗双模式）
tests/                   93 个测试，全部用桩客户端，禁止对外网络
  pricing.py             Experiment B：P0 静态 / P1 规则加价 / P2 置换对照 + 定价感知分配循环
  run_pricing_experiment.py  CLI：跑 Experiment B 网格
results/
  baseline_summary.csv         大规模（cap=833）270 episode 指标
  baseline_report.md            ↑ 的统计报告
  compact_baseline_summary.csv  compact（cap=30）270 episode 指标 ← 与 LLM 臂配对用
  compact_baseline_report.md    ↑ 的统计报告
  scale_validation.md           两个尺度的对比：缩放有没有破坏现象
  cost_analysis.md              成本结构分析（推翻了 Proposal 原来的成本论证）
  pricing_summary.csv           Experiment B 的 270 episode 指标
  pricing_report.md             ↑ 的统计报告
  pricing_findings.md           Experiment B 的结论与限制（可直接进论文）
  power_analysis.md             compact 尺度的实测方差与 MDE
  power_analysis_largeN.md      全尺寸尺度的同上
  design_recommendation.md      Experiment A 该用多大规模、多少种子（含一处自我更正）
runs/
  <strategy>_<rho>_<seed>[_cap30].json   每个 episode 的轻量审计日志
```

## 已经跑出来的结果（B0/B1/B2，n=30/格，两个尺度）

`success_rate`（均值），括号内是 compact（cap=30）尺度：

| rho | random | fifo | greedy |
|---|---|---|---|
| 0.8 | 0.229 (0.228) | 0.576 (0.547) | 0.731 (0.679) |
| 1.2 | 0.229 (0.203) | 0.464 (0.429) | 0.676 (0.624) |
| 2.0 | 0.229 (0.219) | 0.337 (0.335) | 0.599 (0.558) |

三个策略两两比较在全部负载水平上都显著（Holm-Bonferroni 校正后 p<0.001，Cliff's delta 基本是 ±1，即完全分离）。这符合预期：Greedy 的"全场搜索最优可用车位"确实系统性优于 FIFO 的"只认自己第一选择"，两者又都远好于 Random。**这本身不是新结论**——它是确认仿真器行为合理的 sanity check，真正的研究问题（LLM vs Greedy/FIFO）还没跑。

完整报告：[results/baseline_report.md](results/baseline_report.md)

## 两个我做了但没请示你的设计决定（需要你认可或改）

### 1. LLM 策略按 10 分钟窗口批处理，经典策略逐请求实时处理

T1/T2 每个决策窗口只调用（几次）API，一次性决定该窗口内所有到达的请求；经典策略是每个请求到达即时决定（更贴近 CampusPark 生产环境的真实行为）。这个不对称是刻意的（不这样做，一个 episode 要打 600-1600 次 API 调用，成本爆炸），但它确实给了 LLM 策略"看到同批次其他人的信息"这一点小优势。**这一点必须在论文里报告，不能藏起来**——README 和代码注释里都已经写了。

### 2. compact 场景靠缩小**供给**实现，不是靠减少请求数

Proposal §11 承认"30 个 user-agent 是成本与真实性的折中"没解决。我一开始加的
`--compact-base`（只减少请求数）是**错的**：24 个请求去抢 833 个车位，ρ=2.0 的实际
需求/供给比只有 0.07，争抢完全消失，整个实验就失去意义了。

正确做法是 `--target-capacity 30`：把 24 个真实车位的容量按比例缩到总共 30 个车位
（每个车位至少 1），价格/距离/EV 多样性全部保留，ρ 继续等于 24/36/60 请求 ÷ 30 车位，
含义不变。

**并且做了缩放验证**（`python -m harness.compare_scales`）：经典基线在 cap=833 和 cap=30
两个尺度上各跑 270 个 episode，策略排序在 6/6 个 (指标, ρ) 单元格全部保持，各格均值最大
偏差 0.121。详见 [results/scale_validation.md](results/scale_validation.md)。

⚠️ **但这个验证只覆盖"效应量与排序"，不覆盖"统计精度"**——这是我此前说得过宽的一点。
实测配对差 SD 显示 compact 的 MDE 是 2.57 pp，全尺寸只有 0.79 pp（差 3 倍以上）。
**cap=30 / n=30 的配置下，一个 2 pp 的真实差异会被判为"不显著"，那是无效结论而非负面
结论。** 因此建议 Experiment A 不要用 cap=30，理由与推荐配置见
[results/design_recommendation.md](results/design_recommendation.md)。

`--compact-base` 参数保留但已标注为不推荐。**`baseline_summary.csv`（大规模）和
`compact_baseline_summary.csv` 是两份不同实验的数据，不要混起来比。**

## 跑真实 LLM episode 之前要过的三道门

```bash
# 0. 先离线看一遍预算（不花钱、不需要 key）
python3 -m harness.estimate_cost --target-capacity 30 --n-seeds 30

# 1. 需要 API key
export ANTHROPIC_API_KEY=sk-ant-...

# 2. 先跑 1 个 episode 摸底真实成本（读 usage，不是估算）
python3 -m harness.run_experiment \
  --strategies llm_central --loads 1.2 --n-seeds 1 \
  --target-capacity 30 --full-logs --out-name pilot_t1_smoke

# 3. 看 results/pilot_t1_smoke.csv 里的 cost_usd 对不对得上估算，再决定跑不跑全网格
```

跑之前要定的是 **broker 的 `effort` 档位**——这是唯一数量级级别的成本杠杆
（\$26 ↔ \$303），见 [results/cost_analysis.md](results/cost_analysis.md)。
模型分工（broker=Opus 5 / agent=Haiku 4.5）已经不构成预算问题，agent 侧只占 1.4%–2.4%。

## 已做的正确性验证（不花钱）

在没有 API key 的情况下，用一个假的 `anthropic` 客户端跑通了 T1/T2 的全部非网络逻辑（窗口分组、strict tool 解析、commit-and-validate、成本累加、违规识别），过程中实际抓到并修了两个 bug：

1. **`commit_llm_choice` 原来没检查 `utility >= u_min`**——导致 LLM 策略会把效用为负的烂匹配也算成"成功"，而经典策略从不会这样做。这会让 success_rate/fairness 指标在 LLM 和经典策略之间不可比。已修复：LLM 选择低于用户保留阈值的车位时，视为未满足且不占用车位容量，和经典策略规则完全一致。
2. **`parse_tool_input` 硬编码只认 `"submit_allocation"` 这个 tool 名字**，但 T2 第二轮用的是 `"submit_tentative_allocation"`，导致每次都解析失败、`revise_request_ids` 永远读不出来。已修复为可传入 `tool_name` 参数。

这两个 bug 如果没抓到，会直接污染 H1/H2/H3 的结果，所以我认为先做完这轮"零成本正确性验证"再谈跑真钱的 pilot，是必要的顺序，没有跳过。
