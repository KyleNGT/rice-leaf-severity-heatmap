---
name: run-backend
description: Start the FastAPI inference backend for local development (venv setup, npm run dev:api) and diagnose the conda/venv PATH-shadowing failure mode.
---

```bash
# One-time setup
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt

# Every time
npm run dev:api
```
Then `npm run dev` in a second terminal — Vite proxies `/api/*` to `localhost:8000` (see `vite.config.js`).

`npm run dev:api` invokes `backend/.venv/bin/uvicorn` by explicit path rather than a bare `uvicorn`. **This matters if conda/Anaconda is installed** — `conda init` prepends its own bin dir to `PATH`, which can shadow an activated venv (a new terminal tab, or conda re-asserting itself, silently reverts `uvicorn`/`python` to Anaconda's, which never had `backend/requirements.txt` installed). Symptom: the server crashes on `import torch`, or the front end shows "Cannot reach the analysis server." Verify the interpreter directly with `backend/.venv/bin/python -c "import torch; print(torch.__version__)"`.
