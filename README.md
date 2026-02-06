<div align="center">

# ⚡ blissful-infra

**Enterprise infrastructure. Local sandbox. Instant feedback.**

Iterate in seconds, not hours. Deploy, test, and experiment with production-grade infrastructure — all on your laptop.

---

[Product Spec](./specs/product.md) · [Agent Spec](./specs/agent.md) · [Timeline](./specs/timeline.md) · [Get Started](#quick-start)

---

</div>

## The Problem

**Scenario:** It's 2am. Production is throwing OOMKilled errors. You need to fix a memory leak *now*.

The traditional path:
1. Make a fix locally — but your laptop doesn't have K8s, Prometheus, or the same resource limits
2. Push to CI — wait 15 minutes for the pipeline
3. Deploy to staging — except someone else is using it
4. Finally get to test — realize the fix doesn't work under production load
5. Repeat steps 1-4 until 6am

**The core issue:** Local development doesn't match production. You've always been able to test locally, but it doesn't reproduce the issues you see in production because it's missing:

- Kubernetes resource limits and pod scheduling
- Prometheus metrics and alerting thresholds
- Distributed tracing across services
- The same CI/CD pipeline that will deploy your fix
- Canary deployments to safely roll out changes

Enterprise infrastructure is complex. At most companies, you'll find CI/CD pipelines, Kubernetes clusters, GitOps, observability stacks, service meshes, and chaos testing. **But you can't easily experiment with any of it.** Shared environments are fragile. Cloud resources are expensive. And when production is on fire, waiting for environment access isn't an option.

**What if you had the full enterprise stack running locally?**

## The Solution

```bash
npx blissful-infra start my-idea
```

One command gives you a complete enterprise development environment:

- ✅ **CI/CD Pipeline** — Jenkins with container builds, testing, security scanning
- ✅ **Container Registry** — Local Docker registry for images
- ✅ **Kubernetes Manifests** — Deployment, Service, ConfigMap with Kustomize overlays
- ✅ **GitOps** — Argo CD application manifests
- ✅ **Observability** — Metrics, logs, health monitoring dashboard
- ✅ **Canary Deployments** — Progressive rollouts with automated analysis
- ✅ **Chaos Testing** — FMEA scenarios to validate resilience
- ✅ **AI Agent** — Local LLM that analyzes failures and suggests fixes

**All running on your machine. No cloud account required. No surprise bills.**

## Fast Feedback Loops

Local development means instant feedback:

| Action | Cloud Environment | blissful-infra Local |
|--------|------------------|---------------------|
| Deploy a change | 5-15 minutes | **30 seconds** |
| Run CI pipeline | 10-30 minutes | **2-5 minutes** |
| Test canary rollback | Hours (coordinate with team) | **Instant** |
| Experiment with config | Submit PR, wait for review | **Immediate** |
| Debug a failure | Access logs via Datadog/Splunk | **Right there in terminal** |

No waiting for CI queues. No coordinating with other teams. No fear of breaking shared environments. Just iterate, test, and learn.

## Enterprise Stack Comparison

What you'd pay for in the cloud vs what runs locally for free:

| Component | Enterprise Tool | blissful-infra Local | Cloud Cost/Month |
|-----------|----------------|---------------------|------------------|
| CI/CD | Jenkins / GitHub Actions | ✅ Jenkins (Docker) | $50-500 |
| Container Registry | ECR / GCR / ACR | ✅ Docker Registry | $10-100 |
| Kubernetes | EKS / GKE / AKS | ✅ Kind / Manifests | $150-1000+ |
| GitOps | Argo CD | ✅ Argo CD manifests | (included) |
| Observability | Datadog / New Relic | ✅ Local metrics/logs | $100-1000+ |
| Canary Deployments | Argo Rollouts | ✅ Rollout templates | (included) |
| Chaos Testing | Gremlin / Chaos Mesh | ✅ Chaos scenarios | $500+ |
| AI Analysis | — | ✅ Ollama (local LLM) | $0 |

**Estimated savings: $800-3000+/month** for a typical development environment.

The goal isn't to replace production infrastructure — it's to give you a sandbox where you can learn, experiment, and validate before touching shared environments.

## Learn Production Systems End-to-End

In enterprise environments, infrastructure is fragmented:

- **CI/CD** is owned by the Platform team, lives in a separate repo
- **Kubernetes configs** are managed by SRE, you submit tickets for changes
- **Observability** is Datadog/New Relic — you can view dashboards but don't control them
- **GitOps** is Argo CD in a locked-down cluster you can't access directly
- **Canary deployments** are configured by someone else, you just trigger them

**You never see the full picture.** When something breaks in production, you're debugging through three different team's systems, asking for access, waiting for responses.

blissful-infra puts everything in one place:

```
my-app/
├── Jenkinsfile              # CI/CD pipeline you control
├── k8s/
│   ├── base/                # K8s manifests you can read and modify
│   ├── overlays/            # Environment-specific configs
│   └── argocd/              # GitOps application definition
├── docker-compose.yaml      # Local orchestration
└── blissful-infra.yaml      # Single config for everything
```

**Now you understand the entire flow:**
1. Code change → Jenkinsfile stages → Container build
2. Image push → Argo CD sync → Kubernetes rollout
3. Prometheus scrape → Alert trigger → Rollback

When you debug a real production incident, you'll know exactly where to look because you've seen every piece working together.

## What This Doesn't Replace

**Be realistic about local limitations.** This is a sandbox, not a production replica.

| Scenario | Use Local Sandbox | Use Ephemeral/Staging |
|----------|-------------------|----------------------|
| Fast iteration on a fix | ✅ 30-second deploys | ❌ 5+ min provision |
| Test K8s resource limits | ✅ Same OOMKilled behavior | ✅ |
| Test real cloud services (RDS, SQS) | ❌ Local mocks only | ✅ Real integrations |
| Load test at production scale | ❌ Laptop constraints | ✅ Cloud resources |
| Test cross-region latency | ❌ Everything is localhost | ✅ Real network |
| Validate before merge | ✅ Confidence check | ✅ Final validation |
| Debug at 2am when staging is down | ✅ Always available | ❌ Depends on cloud |

**The right workflow:**
1. **Local sandbox** → Fast iteration, find the fix (30 seconds/deploy)
2. **Ephemeral environment** → PR validation with real cloud services
3. **Staging** → Final verification with production-like data
4. **Production** → Canary rollout with automated analysis

Local doesn't replace cloud environments — it accelerates your path to them.

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

### 💸 Zero Cloud Costs

Everything runs locally — no AWS/GCP/Azure account needed:

- **AI Agent** — Ollama runs LLMs on your machine (no OpenAI API costs)
- **CI/CD** — Jenkins runs in Docker (no GitHub Actions minutes)
- **Container Registry** — Local registry (no ECR/GCR storage fees)
- **Kubernetes** — Kind cluster or just manifests (no EKS/GKE charges)

Your code stays on your machine. No data leaves your laptop. No surprise bills.

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

### Project Commands

Once you have a project, you can use the project-first syntax for all commands:

```bash
# Project-first syntax (recommended)
blissful-infra my-app up          # Start the project
blissful-infra my-app down        # Stop the project
blissful-infra my-app logs        # View logs
blissful-infra my-app agent       # Start AI agent

# Or use command-first syntax
blissful-infra up my-app
blissful-infra agent my-app
```

### Web Dashboard (Orchestrator)

Launch the orchestrator dashboard to manage all your projects from one place:

```bash
blissful-infra dashboard
```

The dashboard is a central control panel that lets you:
- **Create New Projects**: Click "New Project" and configure your stack
- **Manage Multiple Projects**: See all projects in the sidebar
- **Start/Stop Services**: Control each project with one click
- **View Logs**: Real-time logs from any selected project
- **Agent Chat**: Ask the AI about errors for any project
- **Jenkins CI**: Shared Jenkins server auto-starts with the dashboard

**Services started with dashboard:**
- Dashboard: `http://localhost:3001`
- API: `http://localhost:3002`
- Jenkins: `http://localhost:8081` (admin/admin)
- Registry: `localhost:5000`

Options:
```bash
blissful-infra dashboard --dir ~/projects   # Specify projects directory
blissful-infra dashboard --port 3002        # Custom API port
blissful-infra dashboard --no-open          # Don't auto-open browser
blissful-infra dashboard --no-jenkins       # Don't start Jenkins CI server
```

### AI Agent (CLI)

Query the AI agent directly from the command line:

```bash
# Interactive mode
blissful-infra my-app agent

# Single query
blissful-infra my-app agent --query "What errors are in the logs?"
```

The agent analyzes your Docker logs and git history to help debug issues.

### Jenkins CI Server

Manage the shared Jenkins CI/CD server independently:

```bash
# Start Jenkins (also starts with dashboard)
blissful-infra jenkins start

# Stop Jenkins
blissful-infra jenkins stop

# Check status
blissful-infra jenkins status

# Register a project with Jenkins
blissful-infra jenkins add-project my-app

# Trigger a build
blissful-infra jenkins build my-app

# List registered projects
blissful-infra jenkins list
```

Jenkins runs with a local Docker registry for container images. Credentials are `admin/admin`.

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

## Who This Is For

- **Engineers joining companies with complex infrastructure** — Understand CI/CD, K8s, GitOps without breaking shared environments
- **Teams testing deployment strategies** — Experiment with canary deployments, rollback procedures, chaos testing
- **Developers building production-ready services** — Start with enterprise patterns from day one
- **Startups** — Get enterprise-grade infrastructure patterns without enterprise-grade costs

## Philosophy

1. **Seconds, not hours** — Fast feedback loops accelerate learning and iteration
2. **Production patterns, local execution** — Same infrastructure as enterprise, running on your laptop
3. **Learn by doing** — Experiment freely without fear of breaking shared environments
4. **Fail safely** — Test rollbacks, chaos scenarios, and failure modes before production
5. **Zero lock-in** — Standard tools (Jenkins, K8s, Argo CD) you can take anywhere

---

<div align="center">

**Iterate in seconds. Deploy with confidence. No cloud required.**

</div>
