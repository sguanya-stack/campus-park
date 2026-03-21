"""
Parkopedia Parking Data Scraper
"""

import httpx
import csv
import time
import os
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

# ─── 配置 ────────────────────────────────────────────────
LAT        = 47.61385          # 目标地点纬度（Bellevue, WA）
LNG        = -122.20017        # 目标地点经度
RADIUS     = 1000              # 搜索半径（米）
TIMEZONE   = "America/Los_Angeles"
DURATION_H = 2                 # 查询停车时长（小时）
INTERVAL_S = 300               # 采集间隔（秒），5分钟 = 300

CID        = "avalon_iu4ryufghgjrf"   # 从 DevTools 拿到的 client ID
APIVER     = "40"

OUTPUT_CSV = "parking_data.csv"
# ─────────────────────────────────────────────────────────

def round_to_half_hour(dt: datetime) -> datetime:
    """把时间向上取整到最近的整点或半点"""
    minutes = dt.minute
    if minutes < 30:
        return dt.replace(minute=30, second=0, microsecond=0)
    else:
        return dt.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)


def build_url(start_dt: datetime) -> str:
    start_dt = round_to_half_hour(start_dt)
    stop_dt = start_dt + timedelta(hours=DURATION_H)
    fmt = "%Y-%m-%dT%H:%M:%S"
    return (
        "https://en.parkopedia.com/api/bookingsquotes/"
        f"?start_time_local={start_dt.strftime(fmt)}"
        f"&stop_time_local={stop_dt.strftime(fmt)}"
        f"&timezone_id={TIMEZONE.replace('/', '%2F')}"
        f"&lat={LAT}&lng={LNG}&radius={RADIUS}"
        f"&cid={CID}&apiver={APIVER}"
    )


def fetch_quotes(start_dt: datetime) -> list[dict]:
    url = build_url(start_dt)
    headers = {
        "User-Agent": "Mozilla/5.0 (educational project - parking course assignment)",
        "Accept": "application/json",
        "Referer": "https://en.parkopedia.com/",
    }
    try:
        resp = httpx.get(url, headers=headers, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        if data.get("status") == "OK":
            return data.get("result", [])
        else:
            print(f"  [warn] API status: {data.get('status')}")
            return []
    except Exception as e:
        print(f"  [error] 请求失败: {e}")
        return []


def save_to_csv(records: list[dict], fetched_at: str):
    file_exists = os.path.exists(OUTPUT_CSV)
    fieldnames = [
        "fetched_at", "location_id", "price", "price_text",
        "start_time_local", "stop_time_local",
        "requires_print_pass", "requires_display_pass", "cancellation_notice"
    ]
    with open(OUTPUT_CSV, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        if not file_exists:
            writer.writeheader()
        for r in records:
            writer.writerow({
                "fetched_at":            fetched_at,
                "location_id":           r.get("location_id"),
                "price":                 r.get("price"),
                "price_text":            r.get("price_text"),
                "start_time_local":      r.get("start_time_local"),
                "stop_time_local":       r.get("stop_time_local"),
                "requires_print_pass":   r.get("requires_print_pass"),
                "requires_display_pass": r.get("requires_display_pass"),
                "cancellation_notice":   r.get("cancellation_notice"),
            })


def main():
    print(f"Parkopedia scraper 启动")
    print(f"地点: ({LAT}, {LNG})  半径: {RADIUS}m  间隔: {INTERVAL_S}s")
    print(f"数据存入: {OUTPUT_CSV}")
    print("-" * 50)

    tz = ZoneInfo(TIMEZONE)
    round_num = 0

    while True:
        round_num += 1
        now = datetime.now(tz)
        fetched_at = now.strftime("%Y-%m-%d %H:%M:%S")

        # 从"现在"开始查接下来 DURATION_H 小时
        start_dt = now.replace(second=0, microsecond=0)

        print(f"[{fetched_at}] 第 {round_num} 次采集...", end=" ", flush=True)
        records = fetch_quotes(start_dt)

        if records:
            save_to_csv(records, fetched_at)
            prices = [r["price"] for r in records]
            print(f"获取 {len(records)} 条  价格范围: ${min(prices):.2f} ~ ${max(prices):.2f}")
        else:
            print("无数据")

        time.sleep(INTERVAL_S)


if __name__ == "__main__":
    main()
