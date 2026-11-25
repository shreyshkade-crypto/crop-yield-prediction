# Deploy Kisan Saathi on Render

## Before creating the service

1. Push the repository root (the folder containing `render.yaml`) to GitHub or another Git provider.
2. In Render, create a Blueprint from that repository and review the service before deploying. The blueprint selects Render's free web-service plan to avoid an unexpected paid plan.
3. Add `DATA_GOV_API_KEY` as a secret in the service's Environment settings. Never put the key in frontend files or commit a `.env` file. The app can start without this key, but mandi-price requests need a valid key and access to the government API.
4. Wait for the build and deploy to finish. The build installs bounded dependency versions, uses `backend/data/crop_yield.csv` if it exists in the checkout, creates clearly synthetic demo data only when it is absent, and trains the model. Render checks `/api/health`; it returns HTTP 503 if the model failed to load.
5. Open the `onrender.com` URL shown in the Render dashboard. The app and API share the same origin, and HTTPS session cookies are enabled by `COOKIE_SECURE=true`.

## Data storage warning

Farmer accounts, sessions, predictions, fields, reminders, crop-health photos, and captured market history are stored in SQLite at `backend/database/history.db`. The Render free service has an ephemeral filesystem, so these records can be lost after a restart or deploy. The free blueprint is suitable for a demo, not for keeping real farmers' records.

For production records, use a paid Render web service with a persistent disk mounted at `/opt/render/project/src/backend/database` and set `DB_PATH=/opt/render/project/src/backend/database/history.db`, or port the app to a managed database. Back up the data and keep a single service instance when using SQLite. Adding a persistent disk requires a paid Render web service; do not add one unless you choose that plan.

## Local checks on Windows

From the repository root in PowerShell:

```powershell
.\backend\venv\Scripts\python.exe -m pip install -r .\backend\requirements.txt
.\backend\venv\Scripts\python.exe .\backend\app.py
```

The app prints no custom URL; open `http://localhost:5001`. If that port is busy, set a free port before launching:

```powershell
$env:FLASK_PORT = '5002'
.\backend\venv\Scripts\python.exe .\backend\app.py
```

Check `http://localhost:5001/api/health` (or your selected port). A ready response includes `"model_loaded": true`.

Render's Linux process uses Gunicorn. The checked-in `Procfile` and `render.yaml` bind it to `0.0.0.0:$PORT`, as required for Render web services.

## What can still fail outside the repository

A successful deploy also depends on the Git repository containing the files, the secret being set correctly, Render account/service availability, and the external mandi API being reachable. Free Render services can sleep when idle, and their first request after sleep may take longer. Check Render's build and runtime logs if its health check fails.
