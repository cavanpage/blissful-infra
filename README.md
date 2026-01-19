<div align="center">

# ⚡ blissful-infra

**Ship fast. Break nothing. Learn everything.**

Infrastructure that thinks for itself.

---

[Product Spec](./specs/product.md) · [Agent Spec](./specs/agent.md) · [Timeline](./specs/timeline.md) · [Get Started](#quick-start)

---

</div>

## The Problem

You're a software engineer with an idea. You want to test it. But first you need to:

- Set up a build pipeline
- Configure Kubernetes manifests
- Wire up monitoring
- Add chaos testing
- Debug that one cryptic error for 3 hours

**What if you just... didn't?**

## The Solution

```bash
npx blissful-infra start my-idea
```

That's it. One command. You now have:

- ✅ Working hello world with test endpoints
- ✅ Kafka event streaming + WebSockets
- ✅ CI/CD pipeline (Jenkins + Argo CD)
- ✅ Performance tests (k6)
- ✅ Chaos/FMEA testing (Chaos Mesh)
- ✅ Local LLM agent that debugs failures for you

## What Makes This Different

### 🧠 Self-Healing Infrastructure

When something breaks, the AI agent correlates logs, metrics, code changes, and deployment events to tell you exactly why:

```
$ blissful-infra analyze

🔍 Root Cause Analysis:

FINDING: OOMKilled after deploy
CONFIDENCE: 94%

Root Cause:
  Commit abc123 introduced unbounded cache in GreetingService.kt:47

Suggested Fix:
  [AUTO-FIX AVAILABLE] Add bounded cache - PR #142

Apply auto-fix? [y/N]
```

### 📊 Parallel Version Comparison

Deploy old and new versions side-by-side. Run identical load tests. Get a winner.

```
$ blissful-infra compare --old main~1 --new main

| Metric      | Old    | New    | Winner |
|-------------|--------|--------|--------|
| p95 Latency | 180ms  | 120ms  | ✅ New |
| Throughput  | 1200/s | 1350/s | ✅ New |
| Error Rate  | 0.1%   | 0.05%  | ✅ New |
```

### 🔥 Chaos Testing Built In

Every template ships with FMEA scenarios. Know how your service fails before production does.

```
$ blissful-infra chaos --env staging

Running: kafka-down, pod-kill, network-latency...

Resilience Score: 78/100

❌ No fallback when payment-service is down
   Suggested: Add circuit breaker
   [Generate PR]
```

### 💸 Zero API Costs

All AI runs locally via Ollama. Your code, your data, your machine.

## Additional Features

### Auto-Scaling Configuration

Automatically adjust resources based on load and usage patterns.

### Security Scanning

Integrate tools for continuous security scanning (e.g., Snyk, OWASP ZAP).

### Backup and Restore

Automate backups of critical data. Provide a restore mechanism to recover from failures or data loss.

### Monitoring Dashboards

Enhance the existing monitoring capabilities with detailed dashboards. Integrate third-party monitoring tools like Grafana for more granular insights.

### CI/CD Pipeline Customization

Allow customization of CI/CD pipelines using configuration files. Support multiple pipeline providers (e.g., GitHub Actions, GitLab CI).

### Database Management

Automate database setup and management. Provide tools for database migration and version control.

### Environment Management

Simplify the creation and management of different environments (development, staging, production). Support environment-specific configurations.

### Cost Monitoring

Monitor infrastructure costs and provide alerts for anomalies. Integrate with cloud providers to fetch cost data.

### User Access Control

Implement role-based access control (RBAC) for different users. Provide granular permissions for various actions within the infrastructure.

### Notifications and Alerts

Configure notifications for important events and alerts. Support integration with communication tools like Slack, Microsoft Teams, or email.

### Documentation Generation

Automatically generate documentation based on code comments and configurations. Provide a central repository for all project documentation.

### Version Management

Manage different versions of the infrastructure using tags and branches. Allow easy switching between versions.

## Quick Start

### One Command Fullstack

```bash
# Install
npm install -g blissful-infra

# Create and run a fullstack app (Spring Boot + React)
blissful-infra start my-app

# That's it! Your app is running:
# Frontend: http://localhost:3000
# Backend:  http://localhost:8080
```

### Customize Your Stack

```bash
# Different backend
blissful-infra start my-app --backend fastapi

# Add a database
blissful-infra start my-app --database postgres

# All options
blissful-infra start my-app \
  --backend spring-boot \
  --frontend react-vite \
  --database postgres-redis
```

### Step-by-Step (Advanced)

```bash
# Create project without running
blissful-infra create my-app --template fullstack

# Start later
cd my-app
blissful-infra up
```

### Development Mode (Hot Reload)

```bash
cd my-app

# Watch for changes and auto-rebuild in Docker
blissful-infra dev

# Or run locally (requires matching JDK)
blissful-infra dev --local
```

### Other Commands

```bash
blissful-infra logs      # View container logs
blissful-infra down      # Stop everything
```

## Project Types

| Type | Description |
|------|-------------|
| `fullstack` | Backend + Frontend monorepo with API proxy |
| `backend` | Backend API only |
| `frontend` | Frontend static site only |

## Backend Templates

| Template | Stack |
|----------|-------|
| `spring-boot` | Kotlin + Spring Boot + Kafka + WebSockets |
| `fastapi` | Python + FastAPI + Kafka + WebSockets |
| `express` | Node + Express + TypeScript + Kafka + WebSockets |
| `go-chi` | Go + Chi + Kafka + WebSockets |

## Frontend Templates

| Template | Stack |
|----------|-------|
| `react-vite` | React + Vite + TypeScript + TailwindCSS + React Query |
| `nextjs` | Next.js + TypeScript + TailwindCSS |

## Fullstack Architecture

When you create a fullstack project, you get:

```
my-app/
├── backend/           # Spring Boot / FastAPI / Express / Go
│   ├── src/
│   ├── Dockerfile
│   └── build.gradle.kts
├── frontend/          # React + Vite
│   ├── src/
│   ├── Dockerfile
│   └── package.json
├── docker-compose.yaml
└── blissful-infra.yaml
```

**Communication Flow:**
- Frontend calls `/api/*` → nginx proxies to backend
- Backend broadcasts events via WebSocket at `/ws/events`
- Frontend receives real-time updates via WebSocket hook

**Services:**
- Frontend: `http://localhost:3000` (nginx serving React)
- Backend: `http://localhost:8080` (Spring Boot API)
- Kafka: `localhost:9092` (event streaming)
- PostgreSQL: `localhost:5432` (if database selected)

## Specs

This project is built from two specifications:

| Spec | Description |
|------|-------------|
| **[Product Spec](./specs/product.md)** | CLI, templates, pipeline, chaos testing, version comparison |
| **[Agent Spec](./specs/agent.md)** | Local LLM integration, root cause analysis, self-learning knowledge base |
| **[Timeline](./specs/timeline.md)** | Phased development plan, MVP-first approach |

## Contributing

### Template Development

When working on templates, use `--link` mode to symlink templates instead of copying them. This allows you to edit templates directly and see changes immediately:

```bash
# Clone the repo
git clone https://github.com/cavanpage/blissful-infra.git
cd blissful-infra

# Install dependencies and build
npm install
cd packages/cli
npm run build

# Create a test project with linked templates
node dist/index.js start test-app --link
```

The symlinks mean:
- `test-app/backend/` → `packages/cli/templates/spring-boot/`
- `test-app/frontend/` → `packages/cli/templates/react-vite/`

**Edit templates, rebuild, and test - all from the repo root:**

```bash
# Edit templates directly in the repo
vim packages/cli/templates/spring-boot/src/main/kotlin/com/blissful/controller/HelloController.kt

# Rebuild to see changes (from repo root)
docker compose -f test-app/docker-compose.yaml up --build app

# View logs
docker compose -f test-app/docker-compose.yaml logs -f
```

**Note:** In link mode, template variables (like `{{PROJECT_NAME}}`) won't be substituted since files are symlinked rather than copied. Use link mode for developing template structure and code, then test with a normal `start` (without `--link`) to verify variable substitution works correctly.

### Cleanup

```bash
# Stop and remove (from repo root)
docker compose -f test-app/docker-compose.yaml down
rm -rf test-app
```

## Philosophy

1. **Iterate on ideas, not infrastructure** — The infra should disappear.
2. **Fail fast, fix faster** — Every failure teaches the system something.
3. **Trust but verify** — Parallel testing before promotion. Always.
4. **Own your stack** — No vendor lock-in. Eject anytime.

---

<div align="center">

**Built for engineers who'd rather ship than configure.**

</div>
