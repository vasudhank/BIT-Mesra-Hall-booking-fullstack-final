# Production Deployment Guide (Institute Server)

This project is now hardened for production with:
- atomic hall booking writes (prevents double-booking races),
- request load shedding + rate limiting,
- graceful shutdown + drain mode,
- Mongo connection pool tuning,
- readiness/health + monitoring endpoints.

Use this checklist when deploying for real traffic.

## 1) Backend Environment Baseline

Start from `backend/.env.integrations.example` and set production values:

- `NODE_ENV=production`
- `SESSION_STORE_USE_MONGO=true`
- `MONGO_URI=<production Mongo URI>`
- `SESSION_SECRET=<strong random secret>`
- `PUBLIC_BASE_URL=<https://your-domain>`
- `EMAIL=<admin mail account>`

High-load tuning knobs:

- `MAX_ACTIVE_REQUESTS=900`
- `RATE_LIMIT_DEFAULT_MAX=240`
- `RATE_LIMIT_BOOKING_MAX=80`
- `RATE_LIMIT_AI_MAX=80`
- `MONGO_MAX_POOL_SIZE=80`
- `MONGO_MIN_POOL_SIZE=5`
- `SERVER_REQUEST_TIMEOUT_MS=120000`
- `SERVER_MAX_REQUESTS_PER_SOCKET=1000`

Tune these from real monitoring data after go-live.

## 2) Run Behind a Reverse Proxy

Use NGINX/Apache in front of Node. Minimum NGINX recommendations:

- enable keepalive to upstream,
- set proxy timeouts above backend request timeout,
- enable gzip/brotli at proxy,
- cap request body size,
- terminate TLS at proxy.

## 3) Process Supervision

Run backend with a supervisor (systemd, PM2, Docker restart policy).

Required behavior:
- auto-restart on crash,
- single-command restart for deploys,
- graceful stop (SIGTERM) so in-flight requests drain.

The backend already handles graceful shutdown and will reject new traffic during drain mode.

## 4) Container Deployment (Optional)

`docker-compose.yml` is production-hardened with:
- Mongo + backend healthchecks,
- backend startup waiting for Mongo health,
- backend non-root runtime image,
- backend stop grace period.

Bring up stack:

```bash
docker compose up -d --build
```

## 5) Health and Readiness Gates

Before switching traffic:

- Health: `GET /api/ops/health` must return `200`.
- Readiness: `GET /api/ops/ready` must return `200`.
- Monitoring: `GET /api/ops/monitoring` (admin/developer auth) should show DB ready and no overload spikes.

## 6) Load Test Before Go-Live

Run a pre-production load test (k6/Locust/JMeter) on:
- login + OTP flows,
- booking create/approve/vacate flows,
- AI action execution endpoints,
- complaint/query submission and admin views.

Pass criteria:
- no double-bookings under concurrent booking attempts,
- stable P95/P99 latency,
- controlled 429/503 behavior (not random 500 spikes),
- no memory growth trend under sustained load.

## 7) Day-1 Monitoring Alarms

Set alerts for:
- readiness failures,
- 5xx error rate,
- high `rejectedOverloaded` or `rejectedRateLimited`,
- Mongo disconnect/reconnect loops,
- CPU/RAM saturation.

## 8) Safe Deploy/Rollback Pattern

1. Deploy new backend version.
2. Wait for health + readiness green.
3. Shift traffic gradually (or restart proxy upstream cleanly).
4. Roll back immediately if 5xx or latency regresses.

