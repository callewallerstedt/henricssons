# Deployment (Recommended: Render)

## Why Render
- You are already using it.
- This project serves both static pages and API from Flask, so one web service is enough.
- Managed Postgres is easy to attach through `render.yaml`.

## One-time setup
1. Push this repo to GitHub.
2. In Render, create a Blueprint deploy from this repo.
3. Render will read `render.yaml` and create:
   - `henricssons-app` (web service)
   - `henricssons-db` (managed Postgres)
4. Set secret env vars in Render:
   - `ADMIN_API_KEY`
   - `OPENAI_API_KEY`

## DNS/domain
1. In Render service settings, add your custom domain (`henricssonsbatkapell.se` and optionally `www.henricssonsbatkapell.se`).
2. Update DNS records to Render target.

## Verify after deploy
1. Open `/healthz` and verify `{ "status": "ok" }`.
2. Open `/admin.html` and verify admin save calls work.
3. Submit a test form and confirm data is stored.
