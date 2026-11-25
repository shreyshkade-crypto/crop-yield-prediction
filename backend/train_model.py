"""Train + evaluate the Random Forest and save model + metadata.
Usage: python train_model.py [--data data/crop_yield.csv] [--out-dir models]"""
import argparse, json, os
import joblib, numpy as np, pandas as pd
from sklearn.compose import TransformedTargetRegressor
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from preprocess import CAT, NUM, TARGET, engineer, load_and_validate, make_preprocessor

MIN_ROWS = 200  # refuse to "train" on a tiny template file


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=os.path.join(here, "data", "crop_yield.csv"))
    ap.add_argument("--out-dir", default=os.path.join(here, "models"))
    a = ap.parse_args()
    if not os.path.exists(a.data):
        raise SystemExit(f"Dataset not found: {a.data}\nSee README 'Preparing the dataset'.")

    df, report = load_and_validate(a.data)
    if len(df) < MIN_ROWS:
        raise SystemExit(f"Only {len(df)} usable rows (<{MIN_ROWS}). Use the full dataset.")
    df = engineer(df)
    X, y = df[CAT + NUM], df[TARGET]
    X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.2, random_state=42)

    rf = Pipeline([("prep", make_preprocessor()),
                   ("rf", RandomForestRegressor(n_estimators=200, min_samples_leaf=2,
                                                n_jobs=-1, random_state=42))])
    # log1p target: yields are right-skewed; metrics below are on the ORIGINAL scale.
    model = TransformedTargetRegressor(regressor=rf, func=np.log1p, inverse_func=np.expm1)
    model.fit(X_tr, y_tr)
    pred = model.predict(X_te)
    metrics = {"MAE": float(mean_absolute_error(y_te, pred)),
               "RMSE": float(np.sqrt(mean_squared_error(y_te, pred))),
               "R2": float(r2_score(y_te, pred)),
               "train_rows": int(len(X_tr)), "test_rows": int(len(X_te))}

    # Global importances, summed back from one-hot columns to the original feature.
    pipe = model.regressor_
    names = pipe.named_steps["prep"].get_feature_names_out()
    imps = pipe.named_steps["rf"].feature_importances_
    grouped = {}
    for n, v in zip(names, imps):
        base = n.split("__", 1)[1]
        key = next((c for c in CAT if base.startswith(c + "_")), base)
        grouped[key] = grouped.get(key, 0.0) + float(v)

    # Per-crop reference ranges from the data (used for risk bands + advice rules).
    q = lambda s, p: float(s.quantile(p))
    crop_stats = {}
    for crop, g in df.groupby("Crop"):
        crop_stats[crop] = {"n": int(len(g)), "yield_mean": float(g.Yield.mean()),
            "yield_p25": q(g.Yield, .25), "yield_p50": q(g.Yield, .5), "yield_p75": q(g.Yield, .75),
            "rain_p25": q(g.Annual_Rainfall, .25), "rain_p75": q(g.Annual_Rainfall, .75),
            "fert_p25": q(g.Fertilizer_per_ha, .25), "fert_p50": q(g.Fertilizer_per_ha, .5),
            "fert_p75": q(g.Fertilizer_per_ha, .75)}

    top = df.Crop.value_counts().head(8).index
    bins = pd.cut(df.Annual_Rainfall, 8)
    analytics = {
        "crop_comparison": [{"crop": c, "avg_yield": s["yield_mean"], "n": s["n"]}
                            for c, s in sorted(crop_stats.items(), key=lambda kv: -kv[1]["yield_mean"])],
        "yearly_trend": [{"year": int(k[0]), "crop": k[1], "avg_yield": float(v)} for k, v in
                         df[df.Crop.isin(top)].groupby(["Crop_Year", "Crop"]).Yield.mean().items()],
        "rainfall_vs_yield": [{"range": f"{int(i.left)}-{int(i.right)} mm", "avg_yield": float(v)}
                              for i, v in df.groupby(bins, observed=True).Yield.mean().items()],
        "fertilizer_by_crop": [{"crop": c, "median_kg_per_ha": s["fert_p50"]}
                               for c, s in crop_stats.items()]}

    meta = {"metrics": metrics, "data_report": report, "feature_importance": grouped,
            "categories": {c: sorted(df[c].unique().tolist()) for c in CAT},
            "latest_year": int(df.Crop_Year.max()), "crop_stats": crop_stats,
            "analytics": analytics, "model": "RandomForestRegressor (log1p target)",
            "dataset_file": os.path.basename(a.data)}
    os.makedirs(a.out_dir, exist_ok=True)
    joblib.dump(model, os.path.join(a.out_dir, "yield_model.joblib"))
    with open(os.path.join(a.out_dir, "metadata.json"), "w") as f:
        json.dump(meta, f, indent=2)
    print("Data report:", report)
    print("Test-set metrics:", {k: round(v, 4) if isinstance(v, float) else v for k, v in metrics.items()})


if __name__ == "__main__":
    main()
