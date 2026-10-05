# CampusPark LLM Allocation Study — 完成态项目介绍（预写版）

> **使用须知（重要）**：本文按"项目已完成"的口吻预写。文中**已经跑出来的真实数据用普通字体**，
> **尚未获得的结果一律标成 `⟨PENDING: ...⟩`**。在拿到真实数据前，**不要删掉 PENDING 标记直接
> 往简历上贴**——那会变成编造实验结果。文末 §6 有一张表，逐条列出"现在就能说"和"跑完才能说"。

---

## 1. 一句话版本

用真实停车场报价数据构建离散事件仿真平台，对比 **LLM 多智能体协商调度** 与传统贪心/FIFO
算法在高并发车位分配中的成功率与公平性，采用预注册实验设计与配对统计检验，量化 LLM 调度
独有的失败模式与推理深度的边际收益。

**English one-liner:**
Built a discrete-event simulation platform on real parking-market data to benchmark
LLM multi-agent negotiation against greedy/FIFO allocation under contention, using a
pre-registered experimental design with paired statistical testing to quantify both
fairness gains and LLM-specific failure modes.

---

## 2. 简历 bullet（英文，挑 3–4 条用）

**偏 ML/AI 岗位：**

- Designed and implemented a multi-agent LLM allocation system (per-user negotiating agents +
  a central broker over a 3-round protocol) using strict JSON-schema tool calling, with an
  independent constraint validator that **rejects rather than repairs** illegal allocations —
  making model failure modes measurable instead of silently masked.
- Benchmarked LLM-driven allocation against greedy and FIFO baselines across 3 contention
  levels × 30 seeds under a paired design; reported Cohen's d / Cliff's delta with bootstrap
  CIs and Holm–Bonferroni correction over a pre-registered metric family.
- Addressed reproducibility on current-generation models that **no longer accept
  `temperature`**: replaced deterministic decoding with a repeated-measures design and
  variance decomposition (ICC), isolating model stochasticity from scenario variance via a
  linear mixed-effects model.
- Profiled inference cost end-to-end and found spend was dominated by broker reasoning tokens
  (**11.7× swing, $26→$303, across thinking-budget settings**), not by the per-agent model
  choice (**1.4–2.4% of total**) — redirecting optimization to the parameter that actually
  mattered.

**偏平台 / 基础设施岗位（工程层）：**

- Shipped the research finding as a **fault-tolerant serving layer**: cost-ceiling guard →
  circuit breaker → deadline + bounded retry → LLM policy → validator gate → deterministic
  fallback → structured telemetry. Illegal model output is **dropped and re-decided by the
  classical scheduler, never repaired**, so a hallucinated spot ID can never reach a user.
- Kept the production retry/fallback behavior in a **separate layer that wraps the research
  code without modifying it**, because the study's pre-registration explicitly forbids
  retries and repair — the two requirements are contradictory and could not share a codebase.
- Built a **75-test suite whose harness makes it impossible to spend money**: every test runs
  against a stub client and `conftest.py` blocks outbound sockets, so a test that began
  calling the real API would fail rather than bill every CI run.
- Wrote CI that enforces **scientific** invariants alongside the usual ones: two independent
  runs must be byte-identical, classical policies must produce zero illegal allocations, and
  **prompt/tool-schema SHA-256 fingerprints must still match the pre-registration** — making
  post-hoc prompt tuning a build failure rather than an honor-system rule.
- Caught a defect where a timeout was decorative: `ThreadPoolExecutor` used as a context
  manager calls `shutdown(wait=True)`, so the deadline fired but the caller still blocked for
  the full hung call (asserted <3s, measured 5.02s).

**偏 SWE / 数据岗位：**

- Built a reproducible discrete-event simulator (interval-scheduling engine, seeded scenario
  generation, pluggable policy interface) over **1,104 real parking quotes across 24 garages**;
  documented every real vs. synthetic field to keep data provenance auditable.
- Validated a cost-driven 28× scale reduction of the simulation before relying on it: ran
  classic baselines at both scales (270 episodes each) and showed strategy ordering held in
  **6/6 (metric, load) cells with max mean deviation 0.121**.
- Caught two correctness bugs through zero-cost dry-run harness testing that would have
  invalidated the primary comparison — an unenforced acceptance threshold making success rates
  incomparable across arms, and a tool-name mismatch silently disabling the negotiation
  revision round.

**结果类 bullet — Experiment B 已跑完，以下是真实数据，可以直接用：**

- Produced a **negative result on the pre-registered primary metric**: the production surge
  pricing rule significantly *reduced* spot utilization at every load level (**−3.79% at
  ρ=2.0, d=−3.58, p=2.9e−18**), reframing it as a utilization-for-revenue trade rather than
  an efficiency gain — a conclusion that held across **all 5** demand-elasticity settings in
  a sensitivity sweep, with effect size scaling monotonically in price sensitivity.
- Isolated the source of the rule's revenue gain with a **permutation control** (identical
  number of surcharges, randomly relocated): targeting contested spots earned **+5.94% over
  the matched-price control** (d=+3.98, p=1.6e−19), showing the gain comes from the demand
  signal rather than the price increase — robust in **4 of 5** elasticity settings, failing
  only for a uniformly highly-price-sensitive population.
- Ran a **sensitivity sweep over the model's one unmeasured parameter and reported that it
  materially revised one of my own headline findings**: "untargeted price increases capture no
  revenue" was significantly contradicted in 1 of 5 settings, holding only when demand is both price-sensitive
  *and* homogeneous — at equal mean elasticity, a heterogeneous population made blanket
  increases profitable (+0.07%) where a homogeneous one lost money (−2.14%).

**结果类 bullet（Experiment A，跑完才能用）：**

- ⟨PENDING: LLM 协商 vs Greedy 的主结论，例如 "Found LLM negotiation improved Jain's fairness
  index by X% (d=Y, p<Z) at high contention while reducing success rate by W%" ⟩
- ⟨PENDING: H3 非法分配率，例如 "Quantified an N% illegal-allocation rate structurally
  impossible for classical schedulers" ⟩

---

## 3. 中文简历版本

- 基于 **1,104 条真实停车报价数据（24 个车库、53 个时间快照）** 构建可复现的离散事件仿真平台，
  实现区间调度引擎与可插拔策略接口，支撑 5 种分配策略的受控对比。
- 设计并实现 **LLM 多智能体协商调度系统**：每用户一个出价 agent + 中央 broker 的三轮协商协议，
  使用 strict schema 约束结构化输出，并由独立校验器执行"**拒绝而非修补**"的硬约束策略，
  使模型失败模式可被量化而非被掩盖。
- 采用**预注册实验设计**：配对样本设计（跨策略共用随机种子）、Holm–Bonferroni 多重比较校正、
  Cohen's d / Cliff's delta 效应量与 bootstrap 置信区间、双因素 ANOVA 检验策略×负载交互作用。
- 针对新一代模型**已移除 `temperature` 参数**导致传统"温度归零求可复现"失效的问题，改用
  重复测量 + 方差分解（ICC）+ 线性混合效应模型，将模型自身随机性与场景方差分离。
- 通过离线成本剖析发现开销由 broker 推理 token 主导（**不同思考预算下相差 11.7 倍，$26→$303**），
  而原方案重点优化的 agent 模型选择仅占 **1.4%–2.4%**，据此修正了实验的成本设计。
- 用**同均值置换对照**证明生产环境动态定价规则的收益来自"需求瞄准"而非"价格杠杆"：
  等量加价随机施加时收入无显著变化、高争抢下反而**显著下降 0.78%**（p=0.008，尽管平均
  价格高出 **13.8%**），而瞄准争抢车位时收入 **+6.15%**；同时该规则在预注册主指标
  （车位利用率）上是**负向的**（ρ=2.0 时 **−3.79%，d=−3.58，p=2.9e−18**）。

---

## 4. 作品集 / LinkedIn 段落（~180 字）

这个项目源于我自己开发的校园停车预约系统 CampusPark（Node.js + Prisma + PostgreSQL）。
系统上线后我注意到一个真实问题：抢车位的并发场景里，先到先得（FIFO）会系统性地让部分用户
持续抢不到位，而这些用户的需求其实可以通过"你要充电桩、我只要便宜"这类跨用户交换来满足。

于是我把它做成了一个可验证的研究问题：**LLM 驱动的多智能体协商调度，相比传统贪心算法，
真的能提升分配公平性吗？代价是什么？**

我用爬取的真实停车报价数据（24 个车库、53 个快照）校准了一个离散事件仿真器，实现了随机、
FIFO、贪心三个基线，以及 LLM 单轮中央分配和 LLM 多轮协商两个实验组。整个研究按预注册标准
执行：主指标事先声明、配对设计、多重比较校正、效应量与置信区间并报。

已完成的定价子实验给出了一个我自己没预料到的结果：我原本以为动态加价能提升车位利用率，
实测是反的——它显著**降低**利用率（−3.79%，5 档需求弹性设定下全部一致），换来的是收入。
更关键的是，我加了一个"等量加价但随机撒到别的车位上"的置换对照，结果显示收入增长主要
来自**需求瞄准**而不是涨价本身（+5.94%，d=3.96）。没有那个对照，我会把 6% 的收入增长
直接归因给涨价。

这个项目里我自己最看重的一步，是**我对自己的结论做了敏感性扫描，并且它推翻了我原本的
头条发现**：我一度认为"不瞄准的涨价一分钱赚不到"是最锐利的结论，但把那个未实测的价格
弹性参数扫了 5 档之后，这条在 3 档里翻转了——它只在需求"既敏感又同质"时成立。在**相同的
平均弹性**下，同质人群亏 2.14%，异质人群反而赚 0.77%。所以我把它从结论降级成了"基线
假设下的观察"，并写清楚要坐实它需要的是真实价格弹性数据，而不是更多仿真。

⟨PENDING: Experiment A（LLM vs 贪心）一句话主结论 ⟩ 项目同时记录了 LLM 调度独有的失败
模式（幻觉车位、重复占位）——这是传统算法结构上不可能出现的错误类型，也是我认为这类系统
进入生产前最需要被量化的风险。

---

## 5. GitHub README 开头（技术向）

````markdown
# CampusPark Allocation Study

Do LLM negotiating agents allocate a scarce resource more fairly than a greedy scheduler —
and what does it cost you when they don't?

A pre-registered simulation study benchmarking **LLM multi-agent negotiation** against
**greedy / FIFO / random** baselines for parking-spot allocation under contention, built on
real market data from 24 Bellevue, WA garages.

## Why this exists

FIFO allocation — what most real booking systems actually do, including the CampusPark app
this study grew out of — is structurally unfair: a user whose first choice is contested gets
nothing, even when a mutually better swap exists with another user. Negotiation should fix
that. This study tests whether an LLM can actually find those swaps, at what cost, and with
what new failure modes.

## Design

| Arm | Policy | Role |
|---|---|---|
| B0 | Random | Sanity floor |
| B1 | FIFO | Production baseline (mirrors the real atomic-reservation transaction) |
| B2 | Greedy | Strong algorithmic baseline (online utility maximization) |
| T1 | LLM central allocator (single-shot) | Ablation: isolates *reasoning* from *negotiation* |
| T2 | LLM multi-agent negotiation (3 rounds) | Treatment |

- **Paired design**: all arms see identical seeded scenarios.
- **Pre-registered primary metrics**: allocation success rate, Jain's fairness index.
  Secondary family corrected separately (Holm–Bonferroni).
- **Never-repair validation**: an independent validator re-checks every allocation against
  hard constraints (capacity / EV / interval overlap). Illegal LLM output is *recorded and
  rejected*, never patched — otherwise the failure mode being measured disappears.

## Notable methodology

**Reproducibility without `temperature`.** Current Claude models reject the `temperature`
parameter outright, so the standard "set temperature=0 for determinism" approach is
unavailable. Instead: scenario generation is fully seeded, model stochasticity is treated as
a random effect, each cell is replicated, and variance is decomposed (ICC) under a
linear mixed-effects model.

**Validated scale reduction.** LLM arms can't be afforded at full scale, so supply and demand
are shrunk together (28× smaller fleet, all 24 real garages retained) to preserve the meaning
of the load factor ρ. Before relying on it, classic baselines were run at *both* scales:
strategy ordering held in 6/6 (metric, ρ) cells, max mean deviation 0.121.

## Results

### Experiment B — dynamic pricing (complete, n=30/cell, 270 episodes)

The production surge rule trades utilization for revenue, and its revenue gain is entirely
attributable to *targeting* rather than to the price increase itself.

| Arm | Mean multiplier | Utilization vs static | Revenue vs static |
|---|---|---|---|
| P0 static | 1.000 | — | — |
| P1 rule surge (contested spots) | 1.144 | **−3.79%** (d=−3.58, p=2.9e−18) | **+6.15%** |
| P2 permuted (same count, random spots) | 1.143 | −4.74% | −0.78% (p=0.008) |

*At ρ=2.0. P1 and P2 charge an identical average multiplier by construction — the only
difference is whether the surcharge is aimed at contested spots.*

Without P2, the natural conclusion would have been "surge pricing raises revenue 6%" with
the credit going to the price increase. P2 attributes it to targeting instead.

**Sensitivity sweep over the one unmeasured parameter** (price elasticity, 5 settings
varying level and spread independently):

| Conclusion | Holds in | Status |
|---|---|---|
| Surge reduces utilization | **5/5** | robust; effect scales monotonically in elasticity |
| Targeting beats matched-price random | 4/5 | robust with a boundary condition |
| Untargeted increases capture no revenue | **2/5** | **overturned** — holds only when demand is price-sensitive *and* homogeneous |

The third row is reported as a finding, not buried: at equal mean elasticity a heterogeneous
population made blanket increases profitable (+0.07%) where a homogeneous one lost money
(−2.14%). Settling it needs real price-elasticity data, not more simulation.

### Experiment A — LLM vs. classical allocation

⟨PENDING: 主结果表 + 图 ⟩

## Reproducing

```bash
pip install -r requirements.txt
python -m harness.run_experiment --strategies random,fifo,greedy --target-capacity 30 --n-seeds 30
python -m harness.analyze --csv results/compact_baseline_summary.csv
python -m harness.estimate_cost   # offline cost projection, no API key needed
```
````

---

## 6. 哪些能说 / 哪些要等（诚信检查表）

| 说法 | 现在能不能用 | 依据 |
|---|---|---|
| 1,104 条真实报价、24 车库、53 快照 | ✅ 能 | `parking_data.csv` 实测 |
| 区间调度仿真器 + 可插拔策略接口 | ✅ 能 | 代码已完成并跑通 |
| 三个经典基线，270 episode，零非法分配 | ✅ 能 | `results/baseline_summary.csv` |
| 缩放验证：6/6 单元格排序保持，最大偏差 0.121 | ✅ 能 | `results/scale_validation.md` |
| 成本剖析：11.7× 摆动、agent 侧占 1.4–2.4% | ✅ 能 | `results/cost_analysis.md`（注明是离线估算） |
| 抓到两个会污染主结论的 bug | ✅ 能 | README 有完整记录 |
| 预注册设计、配对检验、Holm-Bonferroni、效应量 | ✅ 能（设计已实现） | `harness/analyze.py` |
| LLM 多智能体协商系统"已实现" | ✅ 能 | 代码完成 + 假客户端管线自测 |
| Experiment B 结论① 利用率下降 | ✅ 能（无条件） | 5/5 档敏感性扫描一致 |
| Experiment B 结论② 瞄准有价值 | ✅ 能（**必须带边界条件**） | 4/5 档一致，高敏感同质人群下失效 |
| Experiment B 结论③ 随机涨价无收益 | ✅ 能（**必须带边界条件**） | 4/5 档成立，1 档显著反例 |
| **置换对照方法论** | ✅ 能 | `harness/pricing.py`，含对原方案的修正说明 |
| **对自己的结论做敏感性扫描并推翻其中一条** | ✅ 能 | `results/pricing_sensitivity.md` |
| 生产层：熔断 / 校验闸 / 兜底 / 遥测 / HTTP 服务 | ✅ 能 | `serving/`，无 key 降级行为已实测 |
| 75 个测试 + CI（含 prompt 指纹校验） | ✅ 能 | `tests/`、`.github/workflows/ci.yml` |
| 工程层自身抓到的两个 bug | ✅ 能 | 超时失效、CI 可复现性检查写错 |
| LLM 多智能体协商系统"已评估/已跑通真实实验" | ❌ **不能** | 还没调过一次真实 API |
| 任何 LLM vs Greedy 的**结果数字** | ❌ **不能** | Experiment A 未跑 |
| 非法分配率的具体数值（H3） | ❌ **不能** | 同上 |
| ICC / 方差分解的具体数值 | ❌ **不能** | 需要重复测量数据 |

**距离全部解锁还差什么**：一个 `ANTHROPIC_API_KEY` + 跑完主网格（含 effort 因子）。
按上一轮的估算，不计成本全跑（T1+T2 × 3 负载 × 3 effort 档 × 30 seeds）约 $260，
走 Batch API 约 $130。

---

## 7. 面试时值得深挖的五个技术点

**① "你怎么保证 LLM 和传统算法的对比是公平的？"**
三个层面：(a) 信息对称——把效用函数的全部参数和每个车位的距离都给模型，它拿到的信息和贪心
算法内部用的完全一样，测的是"怎么用信息"而不是"有没有信息"；(b) 验收规则统一——早期版本里
LLM 路径漏掉了"效用必须高于用户保留阈值"这条检查，会把负效用的烂匹配算成成功，我在干跑测试
里抓到并修了；(c) 硬约束由同一份代码校验，所有策略一个标准。

**② "新模型不让设 temperature，你的实验还怎么复现？"**
这正是我最满意的一段设计。`claude-opus-5` / `claude-sonnet-5` 传 `temperature` 直接返回 400，
传统做法失效。我的处理是把不可复现性**隔离并测量**，而不是假装消除：场景生成侧完全种子化、
可字节级复现；模型随机性当作随机效应，同场景重复采样，用 ICC 报告"模型自身抖动占总方差多少"，
再用混合效应模型把它和策略效应分开。

**③ "你怎么知道是'瞄准'起了作用，而不是单纯涨价起了作用？"**（Experiment B，已有真实数据）
这是我最满意的一个对照设计。原方案写的是"随机乘数 U[1.0,1.5]，与规则组同均值"，但
U[1.0,1.5] 的均值是 1.25，只有当加价规则恰好 50% 触发时两者才同均值——而触发率是未知的。
我改成**复用规则组在同一时间窗口的实际加价次数，只把位置随机置换**，这样边际价格分布按
构造完全一致（实测两组平均乘数 1.144 vs 1.143），唯一变量就是"有没有瞄准争抢车位"，在任何
触发率下都成立。结果很干净：随机撒加价的那组多收 13.8% 的价格却**亏钱**，说明价格杠杆本身
零贡献。没有这个对照，我会把 6% 的收入增长归因给涨价。

**④ "研究代码和生产代码你是怎么处理的？"**（这题能同时展示研究严谨和工程判断）
这两者的要求是**直接冲突**的。预注册明令禁止重试失败调用、禁止修补非法分配——因为两者都会
抹掉我要测量的失败模式；而生产必须重试、必须兜底、必须保证用户拿到答案。我的处理是分层：
`serving/` 只包装、不修改 `harness/policies/`，研究路径与预注册逐字一致，安全网在外侧。
生产链路是"成本上限闸 → 熔断器 → 截止时间+有界重试 → 模型 → 校验闸 → Greedy 兜底 → 遥测"，
其中校验闸用的是**与实验完全相同的 validator**，非法分配丢弃后重新分配，绝不修补——因为
研究已经量化了模型会产生幻觉车位，所以生产一行都不能信任它的输出。

**⑤ "缩小仿真规模会不会让结论失效？"**
会，而且我第一版方案就错了——只减少请求数不减少供给，结果 ρ=2.0 的真实需求供给比变成 0.07，
争抢完全消失。改成按比例缩小供给后，我没有直接相信它，而是把经典基线在两个尺度上各跑了
270 个 episode 做验证，确认策略排序 6/6 保持、均值偏差最大 0.121，才敢用缩放后的场景跑
LLM 实验。
