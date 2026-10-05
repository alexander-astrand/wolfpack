# {{project.name}}

{{project.summary}}

## How to run

```
npm install <!-- stack:node -->
npm run dev     # http://localhost:{{project.devPort}} <!-- ui-only --> <!-- stack:node -->
python3 -m venv .venv <!-- stack:python -->
.venv/bin/pip install -r requirements.txt     # or: .venv/bin/pip install -e . <!-- stack:python -->
# how to run it: fill in once there is something to run <!-- stack:other -->
```

Check everything with `scripts/check.sh`. Values the app needs are named in `.env.example`.

## Not yet

- {{notyet.item}}
