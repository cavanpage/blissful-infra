<div align="center">

# blissful-infra

**Enterprise infrastructure on your laptop.**

Create, run, and manage fullstack apps with CI/CD pipelines, observability, canary deployments, chaos testing, and an AI agent — all locally.

---

[Get Started](#quick-start) · [Commands](#commands) · [Dashboard](#web-dashboard) · [Templates](#project-types) · [Contributing](#contributing)

---

</div>

## Prerequisites

- **[Docker Desktop](https://www.docker.com/products/docker-desktop/)** must be installed and **running**
- **Node.js 18+**
- (Optional) [Ollama](https://ollama.com/) for the local AI agent

## Quick Start

```bash
# Install globally
npm install -g blissful-infra

# Create and run a fullstack app (Spring Boot + React)
blissful-infra start my-app

# That's it! Your app is running:
#   Frontend: http://localhost:3000
#   Backend:  http://localhost:8080
```

### Customize Your Stack

```bash
# Different backend
blissful-infra start my-app --backend fastapi

# Add a database
blissful-infra start my-app --database postgres

# Add plugins
blissful-infra start my-app --plugins ai-pipeline

# Full control
blissful-infra start my-app \
  --backend spring-boot \
  --frontend react-vite \
  --database postgres-redis \
  --plugins ai-pipeline
```

### Step-by-Step

```bash
# Create project without running
blissful-infra create my-app --template fullstack

# Start later
cd my-app && blissful-infra up
```

## Commands

All commands support both `blissful-infra <command> <project>` and `blissful-infra <project> <command>` syntax.

### Core

| Command | Description |
|---------|-------------|
| `start <name>` | Create and run a new project |
| `create <name>` | Create project without starting |
| `up [name]` | Start a project |
| `down [name]` | Stop a project |
| `dev [name]` | Development mode with hot reload |
| `logs [name]` | View project logs |

### CI/CD & Deployments

| Command | Description |
|---------|-------------|
| `pipeline [name]` | View Jenkins pipeline status |
| `pipeline [name] --local` | Run CI/CD pipeline locally (build, test, containerize, scan) |
| `deploy [name]` | Deploy to an environment |
| `canary [name]` | Start a canary deployment |

### Observability & Analysis

| Command | Description |
|---------|-------------|
| `agent [name]` | AI agent for debugging (uses Ollama) |
| `analyze [name]` | Root cause analysis on failures |
| `perf [name]` | Performance analysis |
| `chaos [name]` | Run chaos/resilience tests |

### Infrastructure

| Command | Description |
|---------|-------------|
| `jenkins start/stop/status` | Manage Jenkins CI server |
| `jenkins add-project <name>` | Register project with Jenkins |
| `jenkins build <name>` | Trigger a Jenkins build |
| `dashboard` | Launch the web dashboard |

## Web Dashboard

```bash
blissful-infra dashboard
```

A single control panel at `http://localhost:3001` for managing all your projects:

- **Logs** — Real-time log streaming
- **Agent** — Chat with the AI about errors and issues
- **Metrics** — CPU, memory, HTTP latency, error rates with time-series charts
- **Pipeline** — View Jenkins pipeline stages, trigger builds
- **Environments** — Deploy and rollback across environments
- **Settings** — Configure alert thresholds, log retention, metrics export

Additional services started with dashboard:
- API: `http://localhost:3002`
- Jenkins: `http://localhost:8081` (admin/admin)
- Registry: `localhost:5000`

Options:
```bash
blissful-infra dashboard --dir ~/projects   # Specify projects directory
blissful-infra dashboard --port 3002        # Custom API port
blissful-infra dashboard --no-open          # Don't auto-open browser
blissful-infra dashboard --no-jenkins       # Don't start Jenkins
```

## Project Types

| Type | Description |
|------|-------------|
| `fullstack` | Backend + Frontend monorepo with API proxy |
| `backend` | Backend API only |
| `frontend` | Frontend static site only |

### Backend Templates

| Template | Stack |
|----------|-------|
| `spring-boot` | Kotlin + Spring Boot + Kafka + WebSockets |
| `fastapi` | Python + FastAPI + Kafka + WebSockets |
| `express` | Node + Express + TypeScript + Kafka + WebSockets |
| `go-chi` | Go + Chi + Kafka + WebSockets |

### Frontend Templates

| Template | Stack |
|----------|-------|
| `react-vite` | React + Vite + TypeScript + TailwindCSS + React Query |
| `nextjs` | Next.js + TypeScript + TailwindCSS |

## Plugins

Extend your project with optional plugins using the `--plugins` flag.

### Available Plugins

| Plugin | Description |
|--------|-------------|
| `ai-pipeline` | AI/ML pipeline with PySpark (batch + streaming), scikit-learn classifier, and FastAPI |

### Usage

```bash
# Add a plugin when creating a project
blissful-infra start my-app --plugins ai-pipeline

# Multiple plugins (comma-separated)
blissful-infra start my-app --plugins ai-pipeline,another-plugin

# With create command
blissful-infra create my-app --template fullstack --plugins ai-pipeline
```

When a plugin is added, its service is included in `docker-compose.yaml` and visible in the dashboard health checks.

### AI Pipeline Plugin

The `ai-pipeline` plugin adds a Python service that consumes Kafka events, classifies them using ML, and writes predictions back to Kafka.

- **API:** `http://localhost:8090`
- **Endpoints:**
  - `GET /health` — Service health + pipeline status
  - `POST /predict` — Classify a single event on demand
  - `GET /predictions` — Recent predictions (last 100)
  - `GET /pipeline/status` — Pipeline mode, running state, processed count
- **Modes:** Streaming (Spark Structured Streaming) or Batch
- **Stack:** Python 3.11, PySpark 3.5, FastAPI, scikit-learn, kafka-python-ng

```
my-app/
├── ai-pipeline/          # AI/ML pipeline service
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py       # FastAPI endpoints
│       ├── config.py     # Environment config
│       ├── kafka_utils.py
│       ├── model/
│       │   └── classifier.py   # TF-IDF + Naive Bayes
│       └── pipeline/
│           ├── streaming.py    # Spark Structured Streaming
│           └── batch.py        # Spark batch processing
```

## Project Structure

A fullstack project generates:

```
my-app/
├── backend/              # Spring Boot / FastAPI / Express / Go
│   ├── src/
│   ├── Dockerfile
│   └── build.gradle.kts
├── frontend/             # React + Vite
│   ├── src/
│   ├── Dockerfile
│   └── package.json
├── ai-pipeline/          # (if --plugins ai-pipeline)
├── k8s/
│   ├── base/             # Kubernetes manifests
│   ├── overlays/         # Environment-specific configs
│   └── argocd/           # GitOps application definition
├── Jenkinsfile           # CI/CD pipeline
├── docker-compose.yaml
└── blissful-infra.yaml
```

**Services:**
- Frontend: `http://localhost:3000` (nginx serving React, proxies `/api/*` to backend)
- Backend: `http://localhost:8080`
- Kafka: `localhost:9092` (event streaming)
- PostgreSQL: `localhost:5432` (if database selected)

## Contributing

```bash
# Clone and install
git clone https://github.com/cavanpage/blissful-infra.git
cd blissful-infra && npm install

# Build the CLI
cd packages/cli && npm run build

# Create a test project with linked templates (edits to templates reflect immediately)
node dist/index.js start test-app --link

# Cleanup
docker compose -f test-app/docker-compose.yaml down
rm -rf test-app
```

**Note:** In link mode, template variables (like `{{PROJECT_NAME}}`) won't be substituted since files are symlinked. Use `--link` for developing template code, then test without it to verify variable substitution.

## Additional Docs

- [Product Spec](./specs/product.md)
- [Agent Spec](./specs/agent.md)
- [Timeline](./specs/timeline.md)
- [Learning Guide](./docs/LEARNING_GUIDE.md)

---

<div align="center">

**Iterate in seconds. Deploy with confidence. No cloud required.**

</div>
