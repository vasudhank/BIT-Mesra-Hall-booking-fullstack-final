# BIT-Booking3

Live frontend: https://hall-booking-frontend-4o04.onrender.com/

## AI Architecture (Upgraded)

- Hybrid conversational + agentic orchestration for chat and booking workflows.
- Runtime selector for support graph:
  - `AGENT_GRAPH` (existing)
  - `LANGGRAPH_COMPAT` (new LangGraph-style DAG runtime with node transitions)
- Multi-agent graph-style support pipeline:
  - `StrategistAgent` -> `RetrieverAgent` -> `ResponderAgent` -> `CriticAgent`
- Provider-resilient LLM gateway:
  - Ollama, OpenAI, Anthropic with fallback chain
- Retrieval stack:
  - keyword retrieval from FAQ/notices
  - vector retrieval via local vector store (with Pinecone/Weaviate adapters)
- Realtime channel:
  - WebSocket streaming endpoint at `/api/ai/ws`
  - frontend fallback to HTTP action execution when action intent is detected

## Integrations (New)

### WhatsApp (Meta Cloud API)

- Webhook verify: `GET /api/integrations/whatsapp/webhook`
- Webhook receive: `POST /api/integrations/whatsapp/webhook`
- Manual send (admin/developer): `POST /api/integrations/whatsapp/send`
- Status (admin/developer): `GET /api/integrations/whatsapp/status`

### Slack

- Events webhook: `POST /api/integrations/slack/events`
- Slash-command style endpoint: `POST /api/integrations/slack/command`
- Manual notify (admin/developer): `POST /api/integrations/slack/notify`
- Status (admin/developer): `GET /api/integrations/slack/status`

### CRM (HubSpot Free)

- Support-thread sync (admin/developer): `POST /api/integrations/crm/sync/support-thread`
- Booking-event sync (admin/developer): `POST /api/integrations/crm/sync/booking`
- Status (admin/developer): `GET /api/integrations/crm/status`
- Optional auto-sync from support AI: `CRM_AUTO_SYNC_SUPPORT_THREADS=true`

## Ops and Observability

- Health endpoint: `GET /api/ops/health`
- Readiness endpoint: `GET /api/ops/ready`
- Metrics endpoint:
  - JSON: `GET /api/ops/metrics`
  - Prometheus text: `GET /api/ops/metrics?format=prom`

## Deployment

- Render blueprint updated for both backend + frontend in `render.yaml`.
- GitHub Actions CI:
  - backend syntax + AI intent regression
  - frontend build
- Optional Render deploy-hook workflow via GitHub secrets:
  - `RENDER_DEPLOY_HOOK_URL_BACKEND`
  - `RENDER_DEPLOY_HOOK_URL_FRONTEND`
- Optional Vercel deploy workflow (free-tier friendly for frontend):
  - `.github/workflows/vercel-deploy.yml`
  - required secrets:
    - `VERCEL_TOKEN`
    - `VERCEL_ORG_ID`
    - `VERCEL_PROJECT_ID`

## Docker (Optional)

- `docker-compose.yml` for local full stack boot.
- Dockerfiles added for both backend and frontend.

## Environment Examples

- Integration env template:
  - `backend/.env.integrations.example`

## Useful Commands

Backend:
- `npm run check`
- `npm run ai:intent:test`
- `npm run vector:sync`
