# 数据来源说明（真实字段 vs 合成字段）

本仿真器使用 `../../parking_data.csv`（Parkopedia，Bellevue WA，1km 半径，1104 行、24 个
`location_id`、53 个采集快照，2026-03-20 13:20 → 2026-03-21 13:52）。CSV 本身**不包含**
坐标、容量或 EV 标记字段，因此 harness 里每个停车场的属性分为两类，全部在
`harness/data_loader.py` 中生成且**确定性**（同一 `location_id` 每次生成结果相同，不随
episode 种子变化——物理车库不会因为仿真跑第几次而改变):

## 真实字段（直接取自 CSV，未加工）
- `location_id`
- 每个地点的价格中位数 / 最低 / 最高价（`price` 列）
- **可用性比例** `availability_fraction = 该地点出现的快照数 / 53`
  这是本数据集里最有信息量的隐藏信号：如果某地点在部分快照里**没有报价返回**，
  最合理的解释是当时**订满**（Parkopedia 对已满车库不返回报价），而不是接口出错。
  出现次数从 17/53（约 32%）到 53/53（100%）不等，天然编码了"这个车库平时有多紧俏"。
- `requires_print_pass` / `requires_display_pass` / `cancellation_notice`（原样保留，
  目前仿真器未使用，为未来扩展预留）

## 坐标：已从合成改为真实（2026-10-05）

原先坐标由 `hash(location_id)` 在 1km 圆内按面积均匀生成。与 OpenStreetMap 对比后发现这
是**可测量地错的**：真实停车距锚点中位 554m，均匀撒点 744m（KS D=0.301，p=1.2e−06）。

现改用 `data/osm_parking_bellevue.json` —— 与爬虫同一个 1km 圆内的 **156 个真实 OSM 停车
设施**（ODbL 许可），已冻结入库，不在运行时联网。

**必须讲清的限制：** 24 个车库按固定种子（20260320）打乱后依 `location_id` 顺序分配坐标。
因此**空间分布是真实的（聚集程度、径向分布、与目的地的距离），但哪个车库坐落在哪个坐标是
任意的**。Parkopedia 的 `location_id` 无法与 OSM 要素对应（156 个要素里只有 8 个有名字），
硬要声称这种对应关系就是伪造数据联接。

影响已在 [PRE_REGISTRATION.md](PRE_REGISTRATION.md) 修订 A-2 中完整报告：Experiment B 三条
结论方向全部不变，但 greedy−fifo 的差距缩小 19–37%。

## 仍为合成的字段（确定性派生，非真实数据）
| 字段 | 生成方式 | 为什么合成 |
|---|---|---|
| `capacity`（车位数/lane 数） | `round(BASE_CAPACITY * availability_fraction)`，`BASE_CAPACITY=40`，下限 clip 到 3 | CSV 不含容量字段；用可用性比例做真实信号的合理代理 |
| ~~`lat_offset` / `lng_offset`~~ | **已替换为真实坐标，见下** | — |
| `is_ev` | `hash(location_id) % 5 == 0`（约 20% 地点标记为 EV） | CSV 不含 EV 字段；OSM 也几乎没有（156 个要素中仅 6 个带 `capacity` 标签，EV 标签更稀疏） |

**这条限制已经写进 [research_proposal_llm_allocation.md](research_proposal_llm_allocation.md)
§7 Threats to Validity**：24 个地点、约 24.5 小时的真实观测量偏薄，容量与 EV
维度是合成的。所有合成生成逻辑都是确定性、可复现、且在此文档公开说明——不是为了让某个
策略看起来更好而调整的。
