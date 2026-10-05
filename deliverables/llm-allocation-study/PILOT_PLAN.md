# 低成本 Pilot 方案

在投入全网格（约 \$748）之前，用**约 \$6 分四步**回答四个问题。每一步都有明确的
"发现什么就停下来"的门槛——pilot 的价值不在于省那点钱，而在于**在便宜的时候发现设计缺陷**。

前置：`export ANTHROPIC_API_KEY=sk-ant-...`；全部在 `deliverables/llm-allocation-study/` 下执行。

---

## Step 0 —— 一次最小调用（约 \$0.02）

**问题：** 认证、模型 ID、strict schema、工具调用这条链路通不通？

```bash
python3 - <<'PY'
import anthropic
from harness.policies.llm_common import ALLOCATION_TOOL
r = anthropic.Anthropic().messages.create(
    model="claude-opus-5", max_tokens=1024,
    tools=[ALLOCATION_TOOL],
    tool_choice={"type": "tool", "name": "submit_allocation"},
    output_config={"effort": "low"},
    messages=[{"role": "user", "content":
        "Decision window [0,10). Spots:\n- spot_id=A price_per_hour=$5.00 "
        "capacity=1 free_lanes_this_window~=1 is_ev=False\n\n"
        "Requests in this window:\n- request_id=req-1 ... "
        "distance_to_eligible_spots=[A:100m]\n\nReturn an assignment for all 1 request_id(s)."}],
)
print("stop_reason:", r.stop_reason)
print("usage:", r.usage)
print("tool input:", [b.input for b in r.content if getattr(b, "type", None) == "tool_use"])
PY
```

**停下来的条件：** 报 400（模型 ID 或参数不对）、`stop_reason` 不是 `tool_use`、
或返回的 JSON 不符合 schema。这些都属于"代码问题"，不该用真实 episode 去发现。

---

## Step 1 —— T1 单 episode（约 \$1）

**问题：** 成本估算准不准？非法分配率是不是零？

```bash
python3 -m harness.run_experiment --strategies llm_central --loads 1.2 --n-seeds 1 \
  --target-capacity 240 --efforts high --full-logs --out-name pilot_t1
```

检查 `results/pilot_t1.csv`：

| 字段 | 期望 | 不符合时怎么办 |
|---|---|---|
| `cost_usd` | ≈ \$0.91（估算值） | 偏差 >2 倍 → 回到 `PRE_REGISTRATION.md` §7 改预算并**重新冻结** |
| `illegal_allocation_rate` | 任意值都是数据（H3 就是测这个） | 若 >0.5，先看 `runs/*_full.json` 的 transcript 确认不是 prompt 缺陷而是模型能力 |
| `parse_failure_rate` | 应为 0 | >0 说明 strict schema 没起作用，属代码问题，先修 |
| `success_rate` | 与 Greedy 同量级 | 若接近 0，多半是 prompt 里信息给漏了，不是模型不行 |

---

## Step 2 —— T2 单 episode（约 \$1.8）

**问题：** 三轮协商链路是否真的跑满？成本是不是 T1 的约 1.85 倍？

```bash
python3 -m harness.run_experiment --strategies llm_negotiate --loads 1.2 --n-seeds 1 \
  --target-capacity 240 --efforts high --full-logs --out-name pilot_t2
```

```bash
python3 - <<'PY'
import json, glob
log = json.load(open(sorted(glob.glob("runs/llm_negotiate_1.2_1_cap240_high.json"))[0]))
for w in log.get("llm_transcript") or []:
    print(w.get("window"), "n_req:", w.get("n_requests"), "n_revised:", w.get("n_revised"),
          "errors:", {k: v for k, v in w.items() if k.endswith("_error")})
PY
```

**关键检查：`n_revised` 必须至少在一些窗口里大于 0。** 如果全是 0，说明修正轮没有真正发生
——这正是之前那个 tool 名不匹配 bug 的症状，只不过这次会是别的原因。**全 0 就停，不要继续。**

---

## Step 3 —— 方差与检验力探针（约 \$3）

**问题：** 模型随机性有多大？冻结的 n=60 够不够？

同一个场景（同一个 seed）跑 3 次，测模型自身抖动：

```bash
for i in 1 2 3; do
  python3 -m harness.run_experiment --strategies llm_negotiate --loads 1.2 \
    --n-seeds 1 --seed-start 1 --target-capacity 240 --efforts high \
    --out-name pilot_rep_$i
done
python3 - <<'PY'
import pandas as pd, glob
df = pd.concat([pd.read_csv(f) for f in sorted(glob.glob("results/pilot_rep_*.csv"))])
print(df[["success_rate", "jains_index", "illegal_allocation_rate", "cost_usd"]])
print("\n同一场景下的模型抖动 (sd):")
print(df[["success_rate", "jains_index"]].std(ddof=1))
PY
```

**判据：** 把这个 sd 与 `results/expA_classic_power.md` 里经典臂的配对差 sd（≈0.031）比较。

- 模型抖动 **≪ 0.031** → n=60 的检验力结论成立，按冻结配置跑。
- 模型抖动 **与之相当或更大** → 冻结的 MDE 偏乐观。**此时不要偷偷加种子**
  （预注册 §5 禁止），而应回到 `PRE_REGISTRATION.md` 修订 n、记录修订理由与日期、
  重新冻结，再开跑。

---

## 全部通过后

```bash
# 主网格（约 $553）
python3 -m harness.run_experiment --strategies llm_central,llm_negotiate \
  --loads 0.8,1.2,2.0 --n-seeds 60 --target-capacity 240 --efforts high \
  --out-name expA_llm_high

# effort 消融（约 $194）
python3 -m harness.run_experiment --strategies llm_central,llm_negotiate \
  --loads 0.8,1.2,2.0 --n-seeds 20 --target-capacity 240 --efforts low,medium \
  --out-name expA_llm_ablation
```

## 成本小结

| 步骤 | 估算 | 买到的信息 |
|---|---|---|
| Step 0 | \$0.02 | API 链路是否通 |
| Step 1 | \$1.00 | 成本估算精度、非法分配率量级 |
| Step 2 | \$1.80 | 协商链路是否真的跑满 |
| Step 3 | \$3.00 | 模型方差 → 检验力是否成立 |
| **pilot 合计** | **≈ \$6** | **在花 \$748 之前把设计缺陷都暴露出来** |

一条经验：上面每一个"停下来的条件"，对应的都是一类**用全网格去发现会浪费几百美元**的问题。
