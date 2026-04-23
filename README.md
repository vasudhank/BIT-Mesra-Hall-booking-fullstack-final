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
  - vector retrieval via live local or remote vector stores
  - production runtime supports Mongo-backed local vectors, managed Pinecone, and remote/self-hosted Weaviate
  - runtime probe + sync status available at `GET /api/vector/status`
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

## Vector Deployment

- `VECTOR_DB_PROVIDER=local|pinecone|weaviate`
- Live vector runtime probe:
  - `GET /api/vector/status`
  - `POST /api/vector/probe` (admin/developer)
- Live vector sync:
  - `POST /api/vector/sync`
- Protected monitoring overview now includes vector runtime health, deployment mode, sync history, and remote readiness in `GET /api/ops/monitoring`
- Pinecone production deployment:
  - set `PINECONE_API_KEY`
  - set `PINECONE_INDEX_URL`
  - optionally set `VECTOR_PROVIDER_REQUIRED=true` to make readiness fail if the remote index is not live
- Weaviate production deployment:
  - set `WEAVIATE_URL`
  - optional `WEAVIATE_API_KEY`
  - optional `WEAVIATE_CLASS`
  - backend auto-creates the class on first sync if it is missing
- Local live Weaviate deployment:
  - `docker compose --profile vector up weaviate`
  - point backend env to `WEAVIATE_URL=http://weaviate:8080`

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

## AI-Native Development Evidence

- Repository workflow now includes an AI-native development proof template in `.github/pull_request_template.md`
- Contributor guidance for Codex / Cursor / Claude Code style workflows lives in [docs/AI_NATIVE_DEVELOPMENT.md](docs/AI_NATIVE_DEVELOPMENT.md)
- This gives the repo a repeatable way to show where AI-native tooling accelerated implementation, debugging, and verification

## Useful Commands

Backend:
- `npm run check`
- `npm run ai:intent:test`
- `npm run ai:autonomous:test`
- `npm run vector:sync`

AI regression coverage now includes deterministic intent routing, admin direct booking, hall vacating, non-admin access control, general conversational fallback, and mocked execution-level mutation checks.
