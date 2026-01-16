# Blissful Infra - Development Timeline

## Philosophy

Ship a working "steel thread" MVP as fast as possible. Each phase should produce something usable. Resist the urge to build everything at once.

## Phase Overview

| Phase | Focus | Deliverable | Status |
|-------|-------|-------------|--------|
| **Phase 0** | Specification | Product spec, agent spec, timeline | ✅ Complete |
| **Phase 1** | MVP | CLI + 1 template + local deploy + basic agent | 🚧 In Progress |
| **Phase 2** | Pipeline | Jenkins CI/CD + ephemeral environments | ⏳ Planned |
| **Phase 3** | Observability | Metrics, logs, dashboard v1 | ⏳ Planned |
| **Phase 4** | Resilience | Chaos testing + FMEA | ⏳ Planned |
| **Phase 5** | Intelligence | Full agent + knowledge base | ⏳ Planned |
| **Phase 6** | Scale | More templates + cloud deploy | ⏳ Planned |

---

## Phase 0: Specification ✅

**Goal:** Define the product vision, technical architecture, and development roadmap.

### 0.1 Documentation
- [x] Product specification ([product.md](./product.md))
- [x] Agent specification ([agent.md](./agent.md))
- [x] Development timeline ([timeline.md](./timeline.md))
- [x] README with project overview

### 0.2 Project Setup
- [x] Repository initialization
- [x] Versioning strategy (CHANGELOG.md)

---

## Phase 1: MVP (In Progress)

**Goal:** Developer can scaffold a project, run it locally, and ask the agent basic questions.

### 1.1 CLI Foundation
- [x] Project scaffolding with `blissful-infra create`
- [x] Interactive prompts (project name, template selection)
- [x] `blissful-infra up` - start local environment
- [x] `blissful-infra down` - stop local environment
- [x] `blissful-infra logs` - tail local logs
- [x] Configuration file parsing (`blissful-infra.yaml`)

**Tech:** Node.js + TypeScript, Commander.js + Inquirer

**Location:** `packages/cli/`

### 1.2 First Template (Spring Boot)
- [ ] Kotlin + Spring Boot hello world
- [ ] Standard endpoints (`/health`, `/hello`, `/hello/:name`, `/echo`)
- [ ] Dockerfile (multi-stage build)
- [ ] Docker Compose for local orchestration
- [ ] Basic unit tests (JUnit 5 + MockK)
- [ ] Structured JSON logging

**Why Spring Boot first:** Most complex template, proves the pattern works. Others will be easier.

### 1.3 Local Infrastructure
- [x] Docker Compose generation with:
  - Application container
  - Kafka (single broker, KRaft mode - no Zookeeper)
  - Redis (optional, based on user selection)
  - PostgreSQL (optional, based on user selection)
- [x] Health check orchestration (wait for dependencies)
- [ ] Port management and conflict detection

### 1.4 Basic Agent
- [ ] Ollama integration (connection, model detection)
- [ ] Simple query interface: `blissful-infra agent --query "..."`
- [ ] Interactive mode: `blissful-infra agent`
- [ ] Context collection:
  - Read local logs from Docker
  - Read recent git commits
- [ ] Basic analysis prompts (no knowledge base yet)
- [ ] Model fallback (70b → 8b if unavailable)

### MVP Definition of Done
```
$ npx blissful-infra create
? Project name: my-service
? Template: spring-boot
? Database: postgres

$ cd my-service
$ blissful-infra up
Starting my-service...
✓ Postgres ready
✓ Kafka ready
✓ Application ready

$ curl localhost:8080/hello/world
{"message": "Hello, world!"}

$ blissful-infra agent --query "show me recent logs"
Here are the last 50 log entries...

$ blissful-infra down
Stopped.
```

---

## Phase 2: Pipeline

**Goal:** Automated build, test, and deploy pipeline with ephemeral environments.

### 2.1 Jenkinsfile Template
- [ ] Pipeline stages: build → test → containerize
- [ ] Parallel test execution
- [ ] Build caching for faster iterations
- [ ] Artifact publishing (container image)
- [ ] Pipeline status reporting

### 2.2 Container Registry
- [ ] Local registry option (for development)
- [ ] ECR/GCR/ACR integration (configurable)
- [ ] Image tagging strategy (git sha + latest)
- [ ] Security scanning with Trivy

### 2.3 Kubernetes Manifests
- [ ] Deployment, Service, ConfigMap templates
- [ ] Namespace per environment strategy
- [ ] Resource limits and requests
- [ ] Readiness/liveness probes

### 2.4 Argo CD Integration
- [ ] Application manifest generation
- [ ] GitOps sync configuration
- [ ] `blissful-infra deploy --env <env>` command
- [ ] `blissful-infra rollback --env <env>` command
- [ ] Sync status in CLI

### 2.5 Ephemeral Environments
- [ ] Spin up isolated namespace per PR/branch
- [ ] Automatic teardown after pipeline
- [ ] DNS/ingress for ephemeral access
- [ ] `blissful-infra pipeline --local` for local pipeline run

### Phase 2 Definition of Done
```
$ git push origin feature/my-change

# Jenkins automatically:
# 1. Builds and tests
# 2. Creates container image
# 3. Deploys to ephemeral environment
# 4. Runs smoke tests
# 5. Reports status back to PR

$ blissful-infra status
Environment  Version    Status
-----------  -------    ------
ephemeral    abc123     ✓ Synced
staging      def456     ✓ Synced
production   def456     ✓ Synced
```

---

## Phase 3: Observability

**Goal:** See what's happening in your services with metrics, logs, and a basic dashboard.

### 3.1 Metrics Collection
- [ ] Prometheus deployment (local + cluster)
- [ ] Application metrics endpoint (`/metrics`)
- [ ] Standard metrics: request rate, latency histograms, error rate
- [ ] JVM/runtime metrics (memory, GC, threads)
- [ ] Kafka consumer lag metrics
- [ ] `blissful-infra perf --env <env>` for on-demand metrics view

### 3.2 Log Aggregation
- [ ] Loki deployment
- [ ] Log shipping from containers
- [ ] Structured log parsing
- [ ] Log correlation by trace ID
- [ ] `blissful-infra logs --env <env>` with filtering

### 3.3 Performance Testing
- [ ] k6 test scripts in template
- [ ] `blissful-infra perf --env <env>` command
- [ ] Baseline thresholds (p95 < 200ms, error rate < 1%)
- [ ] Results output (CLI table + JSON)
- [ ] Integration with pipeline (fail on regression)

### 3.4 Dashboard v1 (Minimal)
- [ ] React + Vite + TypeScript + shadcn/ui scaffolding
- [ ] Environment status view (local/staging/prod)
- [ ] Current version per environment
- [ ] Basic metrics display (request rate, error rate, latency)
- [ ] Log viewer with search
- [ ] `blissful-infra dashboard` to open

**Note:** Keep dashboard minimal. CLI is primary interface. Dashboard is for visualization only.

### Phase 3 Definition of Done
```
$ blissful-infra perf --env staging

Running k6 load test...

Results:
  Requests:    12,847
  Duration:    60s
  RPS:         214
  p95 Latency: 145ms
  Error Rate:  0.02%

✓ All thresholds passed

$ blissful-infra dashboard
Opening http://localhost:3000...
```

---

## Phase 4: Resilience

**Goal:** Validate service behavior under failure conditions.

### 4.1 Chaos Mesh Setup
- [ ] Chaos Mesh deployment to cluster
- [ ] CLI integration for chaos commands
- [ ] Experiment templates per failure type

### 4.2 Failure Scenarios
- [ ] `pod-kill` - random pod termination
- [ ] `network-latency` - inject latency
- [ ] `kafka-down` - Kafka unavailability
- [ ] `db-latency` - database slowdown
- [ ] `memory-pressure` - memory stress
- [ ] Custom scenario support

### 4.3 FMEA Framework
- [ ] Baseline capture before chaos
- [ ] Automated validation during chaos
- [ ] Recovery verification after chaos
- [ ] SLO threshold configuration
- [ ] `blissful-infra chaos --env <env>` command
- [ ] `blissful-infra chaos --env <env> --scenario <s>` for specific tests

### 4.4 Resilience Scorecard
- [ ] Score calculation based on FMEA results
- [ ] Gap identification (missing circuit breakers, etc.)
- [ ] Recommendations for improvement
- [ ] Score tracking over time

### 4.5 Parallel Version Comparison
- [ ] Deploy two versions side-by-side
- [ ] Run identical load tests against both
- [ ] Collect and compare metrics
- [ ] `blissful-infra compare --old <ref> --new <ref>` command
- [ ] Winner determination with confidence

### Phase 4 Definition of Done
```
$ blissful-infra chaos --env staging

Running FMEA scenarios...

Scenario         Result  Recovery
--------         ------  --------
pod-kill         ✓ Pass  8s
network-latency  ✓ Pass  12s
kafka-down       ✗ Fail  N/A
db-latency       ✓ Pass  15s

Resilience Score: 75/100

❌ kafka-down: No fallback when Kafka unavailable
   Suggestion: Add circuit breaker for event publishing

$ blissful-infra compare --old main~1 --new main

Deploying both versions...
Running load tests...

Metric       Old     New     Winner
------       ---     ---     ------
p95 Latency  180ms   120ms   ✓ New
Throughput   1200/s  1350/s  ✓ New
Error Rate   0.1%    0.05%   ✓ New

Recommendation: Promote new version
```

---

## Phase 5: Intelligence

**Goal:** Agent learns from incidents and provides actionable insights.

### 5.1 Knowledge Base
- [ ] SQLite storage for incidents, patterns, fixes
- [ ] Embedding generation with nomic-embed-text
- [ ] Vector similarity search (sqlite-vss)
- [ ] Incident recording on failures
- [ ] Pattern extraction and normalization

### 5.2 Enhanced Data Collectors
- [ ] Jenkins collector (build logs, test results)
- [ ] Prometheus collector (metrics queries)
- [ ] Loki collector (log queries)
- [ ] Kubernetes collector (events, pod status)
- [ ] Argo CD collector (sync status, history)
- [ ] Chaos Mesh collector (experiment results)

### 5.3 Root Cause Analysis
- [ ] Timeline construction from multiple sources
- [ ] Correlation with code changes (git blame)
- [ ] Confidence scoring
- [ ] Similar incident retrieval
- [ ] `blissful-infra analyze` command
- [ ] `blissful-infra analyze --incident <id>` for deep dive

### 5.4 Fix Generation
- [ ] Code fix suggestions with diffs
- [ ] Auto-PR creation
- [ ] Fix outcome tracking
- [ ] Success rate by pattern type

### 5.5 Proactive Suggestions
- [ ] Daily suggestion generation (scheduled)
- [ ] Pattern-based recommendations
- [ ] Gap analysis against best practices
- [ ] `blissful-infra suggest` command
- [ ] Priority ranking (high/medium/low)

### 5.6 Learning Loop
- [ ] Track fix outcomes (resolved/partial/failed)
- [ ] Update pattern success rates
- [ ] Improve suggestions based on feedback
- [ ] Auto-fix for high-confidence patterns (with approval)

### Phase 5 Definition of Done
```
$ blissful-infra analyze

Analyzing recent deployment failure...

📊 Correlating data sources:
  ✓ Git commits (3 commits in range)
  ✓ Jenkins build logs
  ✓ Prometheus metrics
  ✓ Application logs (2,847 entries)
  ✓ Kubernetes events

🔍 Root Cause Analysis:

FINDING: OOMKilled after deploy
CONFIDENCE: 94%

Timeline:
  14:32:01 - Deploy started (commit abc123)
  14:32:45 - New pods scheduled
  14:33:12 - Memory spike (450MB → 1.2GB)
  14:33:18 - OOMKilled

Root Cause:
  Unbounded cache in GreetingService.kt:47

Similar Incidents: 2 found (92% similarity)
  Both resolved by adding cache bounds

Suggested Fix:
  [AUTO-FIX AVAILABLE] Add bounded cache

Apply fix and create PR? [y/N] y

Created PR #142: fix/bounded-greeting-cache
```

---

## Phase 6: Scale

**Goal:** Support more languages, deployment targets, and team workflows.

### 6.1 Additional Templates
- [ ] FastAPI (Python)
- [ ] Express (Node.js + TypeScript)
- [ ] Go Chi
- [ ] React + Vite frontend
- [ ] Fullstack monorepo

### 6.2 Cloud Deployment
- [ ] EKS support
- [ ] GKE support
- [ ] AKS support
- [ ] Cloud-specific configurations
- [ ] Cost estimation

### 6.3 Dashboard v2
- [ ] Pipeline visualization
- [ ] Agent chat interface
- [ ] Incident timeline view
- [ ] Comparison test results
- [ ] Resilience scorecard visualization
- [ ] Suggestion feed

### 6.4 Team Features
- [ ] Multi-user support
- [ ] Shared knowledge base (PostgreSQL option)
- [ ] Audit logging
- [ ] Notification integrations (Slack, Teams)
- [ ] Ticket system integration (Jira, Linear, GitHub Issues)

### 6.5 Template Ecosystem
- [ ] Template versioning
- [ ] Upgrade path for existing projects
- [ ] Custom template support
- [ ] Template marketplace/registry

---

## Dependency Graph

```
Phase 1 (MVP)
    │
    ├──────────────────────┐
    ▼                      ▼
Phase 2 (Pipeline)    Phase 3 (Observability)
    │                      │
    └──────────┬───────────┘
               ▼
         Phase 4 (Resilience)
               │
               ▼
         Phase 5 (Intelligence)
               │
               ▼
         Phase 6 (Scale)
```

**Notes:**
- Phase 2 and 3 can be developed in parallel after Phase 1
- Phase 4 requires both Pipeline and Observability
- Phase 5 builds on all previous phases
- Phase 6 is additive and can be done incrementally

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Ollama hardware requirements | Ship with 8b model as default, 70b optional |
| Template maintenance burden | Start with 1 template, prove patterns before expanding |
| Dashboard scope creep | CLI-first approach, dashboard for visualization only |
| Pipeline complexity | Local pipeline option first, cluster later |
| Agent accuracy | Conservative confidence thresholds, always require approval for actions |

---

## Success Metrics

### Phase 1 (MVP)
- [ ] Time from `create` to `curl` < 3 minutes
- [ ] Agent responds to basic queries

### Phase 2 (Pipeline)
- [ ] Full pipeline completes < 10 minutes
- [ ] Ephemeral environments work reliably

### Phase 3 (Observability)
- [ ] Metrics available within 30s of request
- [ ] Logs searchable across services

### Phase 4 (Resilience)
- [ ] 5+ chaos scenarios working
- [ ] Comparison tests complete < 15 minutes

### Phase 5 (Intelligence)
- [ ] Root cause accuracy > 80%
- [ ] Fix suggestions accepted > 60% of time

### Phase 6 (Scale)
- [ ] All 6 templates working
- [ ] Cloud deployment verified on 1+ provider

---

## Getting Started

Begin with Phase 1. Do not move to Phase 2 until MVP is complete and tested.

```bash
# Start here
mkdir -p packages/cli
cd packages/cli
npm init -y
npm install typescript commander inquirer
```

Focus on the smallest possible increment that delivers value. Ship early, iterate often.
