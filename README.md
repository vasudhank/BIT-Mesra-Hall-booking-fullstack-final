# BIT-Booking3

Live frontend: https://hall-booking-frontend-4o04.onrender.com/

## AI Architecture (Upgraded)

- Hybrid conversational + agentic orchestration for chat and booking workflows.
- Runtime selector for support graph:
  - `AGENT_GRAPH` (existing)
  - `LANGGRAPH_COMPAT` (real `@langchain/langgraph` `StateGraph` runtime with a safe local fallback)
- Multi-agent graph-style support pipeline:
  - `StrategistAgent` -> `RetrieverAgent` -> `ResponderAgent` -> `CriticAgent`
- Provider-resilient LLM gateway:
  - Ollama, OpenAI, Anthropic with fallback chain
- Retrieval stack:
  - keyword retrieval from FAQ/notices
  - vector retrieval via local vector store (with Pinecone/Weaviate adapters)
- Persistent agent memory:
  - Mongo-backed conversations, messages, long-term facts/preferences/constraints
  - memory extraction from user turns with vector-backed recall
  - thread-aware memory via frontend `threadId` and `accountKey`
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
- Developer monitoring dashboard:
  - SPA route: `/developer/monitoring`
  - Protected backend overview: `GET /api/ops/monitoring`
  - Synthetic proof events:
    - `POST /api/ops/sentry-test`
    - `POST /api/ops/datadog-test`
- Production monitoring:
  - Prometheus metrics via `prom-client`
  - Grafana provisioning in `monitoring/grafana`
  - Prometheus alert rules in `monitoring/alert-rules.yml`
  - optional Sentry error/performance tracing with `SENTRY_DSN`
  - optional Datadog APM with `DATADOG_ENABLED=true` / `DD_TRACE_ENABLED=true`

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
- Monitoring stack:
  - `docker compose --profile monitoring up`
  - Prometheus: `http://localhost:9090`
  - Grafana: `http://localhost:3001`

## Environment Examples

- Integration env template:
  - `backend/.env.integrations.example`

## Useful Commands

Backend:
- `npm run check`
- `npm run ai:intent:test`
- `npm run ai:autonomous:test`
- `npm run vector:sync`

AI regression coverage now includes deterministic intent routing, admin direct booking, hall vacating, non-admin access control, general conversational fallback, and mocked execution-level mutation checks.
