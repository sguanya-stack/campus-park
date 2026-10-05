"""
Combines the Experiment A result files into the single CSV the analysis
steps read (PRE_REGISTRATION §8 step 6 names `expA_combined.csv`).

Guards against the ways a combine can quietly corrupt an analysis:

  * pooling arms that were run at different fleet sizes or request counts,
    which would make the comparison unpaired without it being visible
  * duplicate (arm, rho, seed, replicate) rows from a re-run, which would
    silently double-weight those cells
  * a missing `replicate` column, which the variance decomposition needs

Usage:
  python -m harness.combine_results \
      results/expA_classic.csv results/expA_llm_high.csv results/expA_llm_ablation.csv \
      --out results/expA_combined.csv
"""

from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

KEY = ["strategy", "effort", "rho", "seed", "replicate"]


def combine(paths: list[Path], strict: bool = True) -> pd.DataFrame:
    frames = []
    for p in paths:
        if not p.exists():
            raise SystemExit(f"missing input: {p}")
        # keep_default_na=False for `effort`: pandas parses the literal string
        # "n/a" as NaN, which silently drops every classical-arm row from any
        # later groupby on effort. Read it as text and normalize explicitly.
        df = pd.read_csv(p)
        if "replicate" not in df.columns:
            df["replicate"] = 1
        if "effort" not in df.columns:
            df["effort"] = "n/a"
        df["effort"] = df["effort"].fillna("n/a").astype(str)
        df["source_file"] = p.name
        frames.append(df)

    combined = pd.concat(frames, ignore_index=True)

    # Paired design check: every arm must have seen the same scenario sizes.
    if "n_requests" in combined.columns:
        per_rho = combined.groupby("rho")["n_requests"].nunique()
        bad = per_rho[per_rho > 1]
        if len(bad):
            detail = (
                combined[combined["rho"].isin(bad.index)]
                .groupby(["rho", "source_file"])["n_requests"].unique().to_dict()
            )
            msg = (
                "arms were run at different scenario sizes, so they are NOT paired: "
                f"{detail}. Re-run the mismatched arm with the same --target-capacity, "
                "or pass --allow-unpaired if you intend to analyze them separately."
            )
            if strict:
                raise SystemExit(msg)
            print(f"WARNING: {msg}")

    dupes = combined.duplicated(subset=KEY, keep=False)
    if dupes.any():
        offenders = combined.loc[dupes, KEY + ["source_file"]].head(10)
        raise SystemExit(
            "duplicate (strategy, effort, rho, seed, replicate) rows would double-weight "
            f"those cells:\n{offenders.to_string(index=False)}\n"
            "Two files cover the same cell -- drop one, or re-run with distinct "
            "--seed-start / --replicates ranges."
        )

    return combined.sort_values(KEY).reset_index(drop=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("inputs", nargs="+")
    ap.add_argument("--out", default="results/expA_combined.csv")
    ap.add_argument("--allow-unpaired", action="store_true",
                     help="downgrade the differing-scenario-size check to a warning")
    args = ap.parse_args()

    combined = combine([Path(p) for p in args.inputs], strict=not args.allow_unpaired)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    combined.to_csv(out, index=False)

    print(f"Wrote {len(combined)} rows to {out}")
    summary = combined.groupby(["strategy", "effort"]).agg(
        episodes=("seed", "size"), seeds=("seed", "nunique"),
        reps=("replicate", "max"), loads=("rho", "nunique"),
    )
    print(summary.to_string())


if __name__ == "__main__":
    main()
