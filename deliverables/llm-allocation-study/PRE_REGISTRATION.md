# Experiment A 预注册（设计冻结）

**冻结日期：2026-09-23**
**状态：在看到任何 LLM 实验结果之前写下。此时 T1/T2 从未调用过一次真实 API。**

这是 Proposal §9 时间线里的 W4 里程碑。预注册的全部意义在于：主指标、样本量、检验方法、
以及"什么结果算支持/什么结果算推翻"，必须在数据产生之前定死，否则事后择优是无法防范的。

---

## 1. 冻结的配置

| 项 | 取值 | 依据 |
|---|---|---|
| 车队规模 | `--target-capacity 240`（24 个真实车位，缩放至 240 车位） | cap=30 的 MDE 是 2.57pp，会把 2pp 的真实差异判成"不显著" |
| 负载 ρ | 0.8 / 1.2 / 2.0 | 请求数 192 / 288 / 480 |
| 主网格种子数 | n = 60（seed 1–60） | 见下方实测检验力 |
| 消融网格种子数 | n = 20（seed 1–20） | effort 消融是次要问题，只需检出大效应 |
| 实验臂 | B0 random, B1 fifo, B2 greedy, T1 llm_central, T2 llm_negotiate | |
| broker 模型 | `claude-opus-5` | |
| user-agent 模型 | `claude-haiku-4-5` | 仅占 T2 成本 1.4–2.4%，非预算决策 |
| 主网格 effort | `high` | |
| 消融 effort | `low`, `medium` | |
| 决策窗口 | 10 分钟 | |
| 协商轮数（T2） | 3 轮（出价 → 暂定+修正 → 定案） | |

**配对设计**：所有实验臂共用同一组种子，因此看到逐位相同的场景。

### 实测检验力（经典臂已在本配置下跑完 540 episode，`results/expA_classic.csv`）

配对差 SD 取自 fifo vs greedy（最接近的一对，也是对 LLM 比较最相关的参照），
α=0.05、power=0.80、双侧配对 t：

| 指标 | ρ=0.8 | ρ=1.2 | ρ=2.0 |
|---|---|---|---|
| success_rate MDE | 1.06 pp | 1.07 pp | **0.65 pp** |
| jains_index MDE | 0.99 pp | 0.83 pp | **0.58 pp** |

配对使方差下降约 74%（相对未配对的合并 SD）。

**这些数字来自确定性策略，只含场景方差。** LLM 臂会叠加模型自身随机性，实际 MDE 会更大。
pilot 后必须用 LLM 数据重算（§6 第 3 条）。本节数字仅用于说明"经典臂侧的精度已足够"，
不构成对 LLM 臂检验力的承诺。

### Prompt 与 schema 指纹（防止事后调 prompt）

在跑任何真实 episode 之前记录。若结果产出后这些哈希发生变化，说明 prompt 被改过，
结果必须作废重跑。

| 对象 | sha256[:16] |
|---|---|
| T1 system prompt | `e3cfd6c8d2ae8db0` |
| T2 agent system prompt | `f3b9fa5605da3716` |
| T2 broker system prompt | `c3f7f5a542080738` |
| `submit_allocation` schema | `cb7fed34d83e9002` |
| `submit_bid` schema | `11ac97ec4cb16451` |
| `submit_tentative_allocation` schema | `2064efed20f1d535` |

复算方式见本文件末尾的命令。

---

## 2. 预先声明的指标

**主指标（只有这两个）**：`success_rate`、`jains_index`。
**次要指标族**（单独做 Holm–Bonferroni，不与主族共用显著性预算）：
`gini`、`worst_decile_utility`、`social_welfare`、`utilization`、
`illegal_allocation_rate`、`parse_failure_rate`、`decision_latency_s`、`cost_usd`。

`worst_decile_utility` 在失败率 >10% 时会饱和为 0（已知的地板效应），预计本次仍会如此，
届时按"无信息"报告，不做解释性发挥。

---

## 3. 假设与**证伪标准**

事先写明什么结果算推翻，是这份文档最重要的部分。

### H1（成功率）
T2 的 success_rate **不优于** B2 greedy。

- **支持 H1**：T2 − B2 的 95% CI 上界 < +1.1pp（该 ρ 下的实测 MDE），或差异显著为负。
- **推翻 H1**：T2 显著高于 B2（Holm 校正后 p<0.05）且效应超过该 ρ 下的 MDE。
- 注意：**"不显著"不等于"等价"**。若 CI 宽到同时包含 ±MDE，结论记为"检验力不足以判定"，
  不记为支持 H1。**这条区分必须在报告里逐 ρ 显式给出，不能用一句"无显著差异"含糊带过。**

### H2（公平性）
T2 的 Jain's index **显著优于** B1 fifo 与 B2 greedy，且优势随 ρ 增大。

- **支持 H2**：T2 在 ρ=2.0 时对 B2 的 jains_index 差异显著为正，且 ρ×策略 交互项显著。
- **推翻 H2**：差异不显著、或方向为负。
- 这是本研究最可能失败的假设，也是最有价值的负面结果。

### H3（LLM 独有失败模式）
T1/T2 的 `illegal_allocation_rate` **显著大于 0**；经典策略结构上恒为 0。

- **支持 H3**：单侧精确二项检验 p<0.05。
- **推翻 H3**：非法分配率为 0（说明 strict schema + 代码校验足以完全封住这个风险，
  这对工程实践同样是有价值的结论）。

### H4（推理深度的边际收益，消融）
更高的 effort **不带来**更好的分配质量。

- **支持 H4**：high vs low 在两个主指标上差异均不显著。
- **推翻 H4**：high 显著优于 low。
- 任一方向都可报告；若 H4 成立，直接结论是"部署时用便宜档位"。

---

## 4. 统计方案（事先固定）

- 主检验：配对 t 检验（success_rate）+ Wilcoxon 符号秩（jains_index，有界非正态）。
- 效应量：Cohen's d（配对差）与 Cliff's delta，均附 10,000 次 bootstrap 95% CI。
- 多重比较：主指标族内 Holm–Bonferroni，α_family = 0.05；次要族单独校正。
- 交互作用：双因素 ANOVA（arm × ρ）。
- **模型随机性**：每个 (arm, ρ, seed) 重复 3 次，用线性混合效应模型
  `metric ~ arm * rho + (1|seed)` 分离场景方差与模型抖动，报告 ICC。
  （`claude-opus-5` 拒绝 `temperature` 参数，无法用温度归零求确定性，这是替代方案。）
  ⚠️ **见下方修订 A-1：上面这个随机效应结构写错了，但原文保留。**
- **重复测量在配对检验中的处理**：配对检验的分析单元是 (arm, ρ, seed) 格，重复测量先在格内
  取均值再配对。重复的作用是降低该格的测量误差，不是增加独立观测；若当作独立观测会虚增 n
  并低估 p 值。原始重复仅供方差分解使用。

---

## 4b. 修订记录

预注册冻结后，任何改动都必须在此登记，原文不得改写。

### 修订 A-1（2026-09-30，**在任何真实 API 调用之前**）

**问题：** §4 写的随机效应结构 `(1|seed)` 与场景的生成方式不符。
`generate_requests(spots, rho, seed)` 对每个 ρ 重新抽样（请求数与随机流都不同），因此
**同一个 seed 配不同 ρ 是三个互不相关的场景**，而不是同一场景的三次观测。按 seed 分组无法
表示场景效应，会把它推进残差，从而**低估 ICC**。

**证据：** 用已知 ICC 的合成数据检验三个估计量
（`tests/test_variance_analysis.py`，可复现）：

| 真实 ICC | 直接经验分解 | `(1\|rho:seed)` | **`(1\|seed)`（原文）** |
|---|---|---|---|
| 0.962 | 0.965 | 0.965 | **0.223** |
| 0.800 | 0.811 | 0.811 | **0.178** |
| 0.500 | 0.510 | 0.510 | **0.100** |

**处理：** 不改写原文。`harness/variance_analysis.py` **同时计算并报告两种分组**，
以 `(1|rho:seed)` 与直接经验分解为准，`(1|seed)` 作为预注册忠实性一并列出并注明其偏差方向。
另外，ρ 作为固定因子在估计场景方差前先行扣除（否则各负载间约 8pp 的成功率差会被算进场景方差）。

**为什么此修订不损害预注册的效力：** 它发生在任何真实 LLM 调用之前，因此不可能受结果影响；
且它不改变任何假设、主指标、样本量或停止规则，只修正一个统计估计量的实现错误。

## 5. 停止规则与禁止事项

- **不中途看结果**。全网格跑完之前不做任何统计检验。
- **不因结果不理想而追加种子**。n 在此冻结；若事后确需扩大样本，必须作为独立的、
  明确标注的二次分析报告，不得与预注册结果混同。
- **不重跑失败的 episode**。API 错误、解析失败一律按预设规则记录
  （该窗口请求记为未满足，`parse_failure_rate` 计数），不重试、不丢弃。
- **不修补非法分配**。违反硬约束的分配被拒绝并记入 `illegal_allocation_rate`。
- **不事后调 prompt**。指纹见 §1。

## 6. 计划中的敏感性分析（事先声明，非事后补救）

1. 效用参数（价格敏感度）5 档扫描，口径同 Experiment B 已完成的那次。
2. Prompt 改写鲁棒性：主实验结束后，用 2 个语义等价的改写版 prompt 在 ρ=1.2、n=20 上复跑
   T2，检查结论方向是否稳定。
3. 跑完 pilot 后用 LLM 自身数据重算检验力（当前 MDE 来自确定性策略，只含场景方差，
   对 LLM 臂偏乐观）。

## 7. 预算

| 阶段 | 配置 | 估算 |
|---|---|---|
| 主网格 | effort=high, n=60 | \$553 |
| 消融 | effort=medium, n=20 | \$111 |
| 消融 | effort=low, n=20 | \$83 |
| **合计** | | **\$748**（Batch API 后约 \$374） |

估算来自 `harness/estimate_cost.py`（chars/4 启发式 + 假设的思考 token），**不是账单**。
第一步是 pilot 单 episode 读真实 `cost_usd` 校准，若偏差超过 2 倍则回到本文件修订预算
并重新冻结。

## 8. 执行顺序

```bash
export ANTHROPIC_API_KEY=sk-ant-...
cd deliverables/llm-allocation-study

# 步骤 1：pilot 单 episode，校准真实成本（约 $1）
python3 -m harness.run_experiment --strategies llm_central --loads 1.2 --n-seeds 1 \
  --target-capacity 240 --efforts high --full-logs --out-name pilot_t1
# 检查 results/pilot_t1.csv 的 cost_usd 与 illegal_allocation_rate

# 步骤 2：T2 pilot（协商链路更长，先单独验证一次）
python3 -m harness.run_experiment --strategies llm_negotiate --loads 1.2 --n-seeds 1 \
  --target-capacity 240 --efforts high --full-logs --out-name pilot_t2

# 步骤 3：经典基线在同配置下重跑（免费，配对用）—— ✅ 已完成 2026-09-23
#   results/expA_classic.csv（540 episode），检验力见上文 §1
python3 -m harness.run_experiment --strategies random,fifo,greedy --loads 0.8,1.2,2.0 \
  --n-seeds 60 --target-capacity 240 --out-name expA_classic

# 步骤 4：主网格（--replicates 3 是 §4 方差分解的前提，不可省）
python3 -m harness.run_experiment --strategies llm_central,llm_negotiate \
  --loads 0.8,1.2,2.0 --n-seeds 60 --target-capacity 240 --efforts high \
  --replicates 3 --out-name expA_llm_high

# 步骤 5：effort 消融
python3 -m harness.run_experiment --strategies llm_central,llm_negotiate \
  --loads 0.8,1.2,2.0 --n-seeds 20 --target-capacity 240 --efforts low,medium \
  --replicates 3 --out-name expA_llm_ablation

# 步骤 6：合并（会拒绝不同场景规模的混合与重复行）
python3 -m harness.combine_results \
  results/expA_classic.csv results/expA_llm_high.csv results/expA_llm_ablation.csv \
  --out results/expA_combined.csv

# 步骤 7：分析（一次性跑完，不中途看）
python3 -m harness.analyze          --csv results/expA_combined.csv --out results/expA_report.md
python3 -m harness.variance_analysis --csv results/expA_combined.csv --out results/expA_variance.md
python3 -m harness.power_analysis   --csv results/expA_combined.csv --out results/expA_power.md
```

> 整条流水线已用桩客户端端到端演练过（270 行、含 3 次重复、经典臂 + 两个 LLM 臂 × 三档
> effort），四个分析步骤全部产出。演练过程中修掉了两个会污染真实分析的缺陷：pandas 把
> `effort="n/a"` 读成 NaN 导致经典臂在 groupby 中被静默丢弃；以及配对检验在遇到重复测量时
> 因长度不等而崩溃（现已按格内取均值处理）。

## 9. 复算 prompt 指纹

```bash
python3 -c "
import hashlib, json
from harness.policies.llm_central import SYSTEM_PROMPT as T1
from harness.policies.llm_negotiate import AGENT_SYSTEM_PROMPT, BROKER_SYSTEM_PROMPT
from harness.policies.llm_common import ALLOCATION_TOOL
from harness.policies.llm_negotiate import AGENT_BID_TOOL, BROKER_TENTATIVE_TOOL
h=lambda s: hashlib.sha256(s.encode() if isinstance(s,str) else json.dumps(s,sort_keys=True).encode()).hexdigest()[:16]
for n,o in [('T1',T1),('agent',AGENT_SYSTEM_PROMPT),('broker',BROKER_SYSTEM_PROMPT),('alloc',ALLOCATION_TOOL),('bid',AGENT_BID_TOOL),('tent',BROKER_TENTATIVE_TOOL)]:
    print(n, h(o))
"
```
