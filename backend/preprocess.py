"""Data loading, validation and feature engineering (shared by training + API)."""
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder

# Columns of the public "Crop Yield in Indian States" dataset (Kaggle).
REQUIRED = ["Crop", "Crop_Year", "Season", "State", "Area",
            "Annual_Rainfall", "Fertilizer", "Pesticide", "Yield"]
CAT = ["Crop", "Season", "State"]
NUM = ["Crop_Year", "Area", "Annual_Rainfall", "Fertilizer_per_ha", "Pesticide_per_ha"]
TARGET = "Yield"  # tonnes per hectare. 'Production' is NOT a feature (it would leak the target).


def load_and_validate(path):
    """Read CSV, check columns / dtypes / NaNs / duplicates, return clean df + report."""
    df = pd.read_csv(path)
    df.columns = [c.strip() for c in df.columns]
    missing = [c for c in REQUIRED if c not in df.columns]
    if missing:
        raise ValueError(f"Dataset is missing required columns: {missing}")
    df = df[REQUIRED + (["Production"] if "Production" in df.columns else [])]
    report = {"rows_raw": len(df),
              "missing_values": int(df[REQUIRED].isna().sum().sum()),
              "duplicate_rows": int(df.duplicated().sum())}
    df = df.drop_duplicates()
    for c in CAT:
        df[c] = df[c].astype(str).str.strip()
    for c in ["Crop_Year", "Area", "Annual_Rainfall", "Fertilizer", "Pesticide", "Yield"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")  # bad values -> NaN -> dropped below
    df = df.dropna(subset=REQUIRED)
    df = df[(df.Area > 0) & (df.Yield >= 0) & (df.Annual_Rainfall >= 0)
            & (df.Fertilizer >= 0) & (df.Pesticide >= 0)]
    report["rows_clean"] = len(df)
    return df.reset_index(drop=True), report


def engineer(df):
    """Per-hectare input intensity is more comparable across farm sizes than totals."""
    df = df.copy()
    df["Fertilizer_per_ha"] = df["Fertilizer"] / df["Area"]
    df["Pesticide_per_ha"] = df["Pesticide"] / df["Area"]
    return df


def make_preprocessor():
    return ColumnTransformer([
        ("cat", OneHotEncoder(handle_unknown="ignore"), CAT),
        ("num", "passthrough", NUM)])
