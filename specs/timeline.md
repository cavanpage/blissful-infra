# Blissful Infra - Development Timeline

## Philosophy

Ship a working "steel thread" MVP as fast as possible. Each phase should produce something usable. Resist the urge to build everything at once.

## Phase Overview

| Phase | Focus | Deliverable | Status |
|-------|-------|-------------|--------|
| **Phase 0** | Specification | Product spec, agent spec, timeline | ✅ Complete |
| **Phase 1** | MVP | CLI + 1 template + local deploy + basic agent | ✅ Complete |
| **Phase 2** | Pipeline | Jenkins CI/CD + ephemeral environments | ✅ Complete |
| **Phase 3** | Observability | Metrics, logs, dashboard v1 | ✅ Complete |
| **Phase 4** | Resilience | Chaos testing + FMEA + Canary deployments | ⏳ Planned |
| **Phase 5** | Intelligence | Full agent + knowledge base | ⏳ Planned |
| **Phase 6** | Scale | More templates + cloud deploy + enterprise components | ⏳ Planned |

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

## Phase 1: MVP ✅

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
- [x] Kotlin + Spring Boot hello world
- [x] Standard endpoints (`/health`, `/hello`, `/hello/:name`, `/echo`, `/ready`, `/live`)
- [x] Dockerfile (multi-stage build)
- [x] Docker Compose for local orchestration
- [x] Basic unit tests (JUnit 5 + MockK)
- [x] Structured JSON logging (logstash-logback-encoder)
- [x] Kafka producer/consumer with WebSocket bridge
- [x] Template variable substitution (`{{PROJECT_NAME}}`)

**Location:** `packages/cli/templates/spring-boot/`

### 1.3 Local Infrastructure
- [x] Docker Compose generation with:
  - Application container
  - Kafka (single broker, KRaft mode - no Zookeeper)
  - Redis (optional, based on user selection)
  - PostgreSQL (optional, based on user selection)
- [x] Health check orchestration (wait for dependencies)
- [x] Port management and conflict detection

### 1.4 Basic Agent
- [x] Ollama integration (connection, model detection)
- [x] Simple query interface: `blissful-infra agent --query "..."`
- [x] Interactive mode: `blissful-infra agent`
- [x] Context collection:
  - Read local logs from Docker
  - Read recent git commits
- [x] Basic analysis prompts (no knowledge base yet)
- [x] Model fallback (70b → 8b if unavailable)

### 1.5 Template Enhancements
- [x] HealthController: `/ready` checks database connectivity (use autowired DataSource)
- [x] HealthController: `/ready` checks Kafka connectivity
- [x] HealthController: Track and expose startup time (`/startup` endpoint)
- [x] Add Micrometer Prometheus registry for metrics endpoint (`/actuator/prometheus`)
- [x] Request duration histogram (for p95/p99 latency calculation)
- [x] Request counter with status code labels

**Location:**
- `packages/cli/templates/spring-boot/src/main/kotlin/com/blissful/controller/HealthController.kt`
- `packages/cli/templates/spring-boot/src/main/kotlin/com/blissful/config/MetricsConfig.kt`

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

## Phase 2: Pipeline ✅

**Goal:** Automated build, test, and deploy pipeline with ephemeral environments.

### 2.1 Jenkinsfile Template
- [x] Pipeline stages: build → test → containerize → security scan → push → deploy
- [x] Parallel test execution (unit tests + integration tests)
- [x] Build caching for faster iterations
- [x] Artifact publishing (container image)
- [x] Pipeline status reporting
- [x] Conditional K8s deployment stages

**Location:** `packages/cli/templates/spring-boot/Jenkinsfile`

### 2.2 Container Registry
- [x] Local registry option (localhost:5000)
- [x] ECR/GCR/ACR integration (configurable via blissful-infra.yaml)
- [x] Image tagging strategy (git sha + latest)
- [x] Security scanning with Trivy
- [x] Registry utilities (`packages/cli/src/utils/registry.ts`)

### 2.3 Kubernetes Manifests
- [x] Deployment, Service, ConfigMap, Secret templates
- [x] ServiceAccount with security context
- [x] Kustomize base + overlays (staging, production, ephemeral)
- [x] Namespace per environment strategy
- [x] Resource limits and requests (256Mi-2Gi memory, 100m-2000m CPU)
- [x] Readiness probe (`/ready`, 10s initial delay)
- [x] Liveness probe (`/live`, 30s initial delay)

**Location:** `packages/cli/templates/spring-boot/k8s/`

### 2.4 Argo CD Integration
- [x] Application manifest generation
- [x] GitOps sync configuration with auto-heal
- [x] `blissful-infra deploy --env <env>` command
- [x] `blissful-infra rollback --env <env>` command
- [x] `blissful-infra status` command showing all environments

**Location:** `packages/cli/templates/spring-boot/k8s/argocd/application.yaml`

### 2.5 Ephemeral Environments
- [x] Spin up isolated namespace per PR/branch
- [x] Automatic teardown after pipeline (via Jenkinsfile post stage)
- [x] Ephemeral overlay with TTL annotation
- [x] `blissful-infra pipeline --local` for local pipeline run

### 2.6 New CLI Commands
- [x] `blissful-infra deploy` - Deploy via Argo CD or kubectl
- [x] `blissful-infra rollback` - Rollback to previous revision
- [x] `blissful-infra status` - Show deployment status table
- [x] `blissful-infra pipeline --local` - Run build/test/containerize locally

**Location:** `packages/cli/src/commands/{deploy,rollback,status,pipeline}.ts`

### 2.7 Shared Jenkins Server
- [x] `blissful-infra jenkins start` - Start Jenkins + local registry
- [x] `blissful-infra jenkins stop` - Stop Jenkins server
- [x] `blissful-infra jenkins status` - Show Jenkins status
- [x] `blissful-infra jenkins add-project <name>` - Register project with Jenkins
- [x] `blissful-infra jenkins build <name>` - Trigger a build
- [x] `blissful-infra jenkins list` - List registered projects
- [x] Pre-configured with Pipeline, Docker, Git, Blue Ocean plugins
- [x] Jenkins Configuration as Code (JCasC) for zero-touch setup
- [x] Local Docker registry on port 5000
- [x] Default credentials: admin/admin

**Location:** `packages/cli/templates/jenkins/`, `packages/cli/src/commands/jenkins.ts`

### 2.8 Pipeline Enhancements
- [ ] Build notifications (Slack webhook integration)
- [ ] Build notifications (email support)
- [ ] Gradle/Maven dependency caching in Jenkinsfile
- [ ] Docker layer caching for faster rebuilds
- [ ] Pipeline failure notifications with error context
- [ ] Build time tracking and trends

**Location:** `packages/cli/templates/spring-boot/Jenkinsfile`, `packages/cli/templates/jenkins/`

### Phase 2 Definition of Done
```
# Start shared Jenkins server
$ blissful-infra jenkins start
Starting Jenkins...
✓ Jenkins is ready
URL: http://localhost:8081
Username: admin
Password: admin
Registry: localhost:5000

# Create and register a project
$ blissful-infra create my-service --template spring-boot --deploy kubernetes
$ blissful-infra jenkins add-project my-service
✓ Added my-service to Jenkins

# Trigger a build
$ blissful-infra jenkins build my-service
✓ Build triggered for my-service

# Or run pipeline locally
$ blissful-infra pipeline --local
Running local pipeline...
✓ Build (12.3s)
✓ Test (8.5s)
✓ Containerize (15.2s)
✓ Security Scan (4.1s)
Pipeline completed successfully!
```

---

## Phase 3: Observability ✅

**Goal:** See what's happening in your local services with metrics, logs, and a basic dashboard.

### 3.1 Metrics Collection (Local)
- [x] Docker container metrics collection (CPU, memory, network I/O)
- [x] Spring Boot Actuator integration
- [x] HTTP metrics: request rate, response time, error rate
- [x] JVM/runtime metrics (memory, GC, threads)
- [x] Time series visualization with configurable windows (1m, 5m, 15m, 1h, 24h)
- [x] Real-time metrics polling

### 3.2 Log Aggregation (Local)
- [x] Docker log collection from containers
- [x] Structured log parsing (JSON)
- [x] Log viewer with real-time updates
- [x] `blissful-infra logs` command with filtering

### 3.3 Health Monitoring
- [x] Service health checks (backend, frontend, databases, Kafka)
- [x] Real-time health status display
- [x] Health endpoint polling

### 3.4 Dashboard v1 (Minimal)
- [x] React + Vite + TypeScript scaffolding
- [x] Environment status view (local)
- [x] Service health status cards
- [x] Time series metrics display (CPU, memory, request rate, response time)
- [x] Log viewer with search and filtering
- [x] Agent chat interface with markdown support
- [x] `blissful-infra dashboard` command to open

**Location:** `packages/dashboard/`

**Note:** Phase 3 focuses on local observability only. Cluster-based observability (Prometheus, Loki) and performance testing (k6) moved to Phase 4.

### 3.5 Observability Enhancements
- [ ] Historical metrics storage (persist metrics to file/SQLite)
- [ ] Metrics export to JSON/CSV
- [ ] Dashboard: Request latency percentiles (p50, p95, p99)
- [ ] Dashboard: Error rate trends over time
- [ ] Dashboard: Comparison view (before/after deploy)
- [ ] Log retention and rotation settings
- [ ] Alert thresholds configuration (notify on high error rate)

**Location:** `packages/cli/src/server/api.ts`, `packages/dashboard/src/components/`

### Phase 3 Definition of Done
```
$ blissful-infra dashboard
Opening http://localhost:3000...

# Dashboard shows:
# - Service health status (all services green)
# - Time series charts for CPU, memory, request rate, response time
# - Configurable time windows (1m to 24h)
# - Real-time log viewer with search
# - Agent chat with markdown-formatted responses
```

---

## Phase 4: Resilience

**Goal:** Validate service behavior under failure conditions with performance and chaos testing.

### 4.1 Performance Testing
- [ ] k6 test scripts in template
- [ ] `blissful-infra perf --env <env>` command
- [ ] Baseline thresholds (p95 < 200ms, error rate < 1%)
- [ ] Results output (CLI table + JSON)
- [ ] Integration with pipeline (fail on regression)

### 4.2 Chaos Mesh Setup
- [ ] Chaos Mesh deployment to cluster
- [ ] CLI integration for chaos commands
- [ ] Experiment templates per failure type

### 4.3 Failure Scenarios
- [ ] `pod-kill` - random pod termination
- [ ] `network-latency` - inject latency
- [ ] `kafka-down` - Kafka unavailability
- [ ] `db-latency` - database slowdown
- [ ] `memory-pressure` - memory stress
- [ ] Custom scenario support

### 4.4 FMEA Framework
- [ ] Baseline capture before chaos
- [ ] Automated validation during chaos
- [ ] Recovery verification after chaos
- [ ] SLO threshold configuration
- [ ] `blissful-infra chaos --env <env>` command
- [ ] `blissful-infra chaos --env <env> --scenario <s>` for specific tests

### 4.5 Resilience Scorecard
- [ ] Score calculation based on FMEA results
- [ ] Gap identification (missing circuit breakers, etc.)
- [ ] Recommendations for improvement
- [ ] Score tracking over time

### 4.6 Parallel Version Comparison
- [ ] Deploy two versions side-by-side
- [ ] Run identical load tests against both
- [ ] Collect and compare metrics
- [ ] `blissful-infra compare --old <ref> --new <ref>` command
- [ ] Winner determination with confidence

### 4.7 Canary Deployments (Argo Rollouts)
**Goal:** Progressive delivery with automated analysis and rollback.

**Framework:** [Argo Rollouts](https://argoproj.github.io/argo-rollouts/) - Kubernetes controller for progressive delivery strategies.

#### 4.7.1 Argo Rollouts Setup
- [ ] Argo Rollouts controller installation (Helm chart)
- [ ] Prometheus integration for metrics analysis
- [ ] Dashboard plugin for Argo CD

**Location:** `packages/cli/templates/cluster/argo-rollouts/`

#### 4.7.2 Rollout Template (replaces Deployment)
- [ ] Rollout CRD with canary strategy
- [ ] Configurable traffic steps (10% → 25% → 50% → 100%)
- [ ] Pause duration between steps
- [ ] Anti-affinity for canary/stable pods

**Location:** `packages/cli/templates/spring-boot/k8s/base/rollout.yaml`

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
spec:
  strategy:
    canary:
      steps:
        - setWeight: 10
        - pause: { duration: 2m }
        - analysis:
            templates:
              - templateName: {{PROJECT_NAME}}-analysis
        - setWeight: 25
        - pause: { duration: 2m }
        - setWeight: 50
        - pause: { duration: 5m }
        - setWeight: 100
```

#### 4.7.3 Analysis Templates
- [ ] AnalysisTemplate CRD for metric queries
- [ ] Prometheus metric providers
- [ ] Configurable success criteria (thresholds)
- [ ] Multiple metric support (error rate, latency, custom)

**Location:** `packages/cli/templates/spring-boot/k8s/base/analysis-template.yaml`

```yaml
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
spec:
  metrics:
    - name: error-rate
      provider:
        prometheus:
          address: http://prometheus:9090
          query: |
            sum(rate(http_requests_total{status=~"5.*",app="{{PROJECT_NAME}}"}[5m]))
            / sum(rate(http_requests_total{app="{{PROJECT_NAME}}"}[5m])) * 100
      successCondition: result[0] < 1
      failureLimit: 3
    - name: p95-latency
      provider:
        prometheus:
          query: |
            histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{app="{{PROJECT_NAME}}"}[5m])) by (le))
      successCondition: result[0] < 0.2
```

#### 4.7.4 Configuration Schema
- [ ] Canary configuration in `blissful-infra.yaml`
- [ ] Metric thresholds (error rate, latency percentiles)
- [ ] Traffic steps customization
- [ ] Analysis interval and failure limits

**Configuration example:**
```yaml
# blissful-infra.yaml
canary:
  enabled: true
  steps:
    - weight: 10
      pause: 2m
    - weight: 25
      pause: 2m
    - weight: 50
      pause: 5m
    - weight: 100

  analysis:
    interval: 30s
    failureLimit: 3
    metrics:
      - name: error-rate
        threshold: "< 1%"          # Less than 1% error rate
        query: custom              # Or use built-in
      - name: p95-latency
        threshold: "< 200ms"       # p95 under 200ms
      - name: p99-latency
        threshold: "< 500ms"
      - name: success-rate
        threshold: "> 99%"
```

#### 4.7.5 CLI Commands
- [ ] `blissful-infra deploy --canary` - Deploy with canary strategy
- [ ] `blissful-infra canary status` - Show rollout progress
- [ ] `blissful-infra canary promote` - Skip analysis, promote immediately
- [ ] `blissful-infra canary abort` - Abort and rollback
- [ ] `blissful-infra canary pause` - Pause rollout
- [ ] `blissful-infra canary resume` - Resume paused rollout

**Location:** `packages/cli/src/commands/canary.ts`

#### 4.7.6 Rollback Testing Mode
- [ ] `blissful-infra canary test --simulate-failure` - Test auto-rollback
- [ ] Inject bad metrics to trigger analysis failure
- [ ] Verify rollback completes successfully
- [ ] Report on rollback timing and behavior

**Test scenarios:**
```bash
# Test 1: Simulate high error rate
blissful-infra canary test --simulate-failure error-rate --value 5%

# Test 2: Simulate high latency
blissful-infra canary test --simulate-failure p95-latency --value 500ms

# Test 3: Full rollback drill
blissful-infra canary test --full-drill
# Deploys canary → injects failure → verifies rollback → reports timing
```

#### 4.7.7 Dashboard Integration
- [ ] Rollout progress visualization
- [ ] Analysis results display
- [ ] Promote/Abort buttons
- [ ] Rollback history

#### Canary Files Summary

| Action | File Path |
|--------|-----------|
| CREATE | `packages/cli/templates/cluster/argo-rollouts/values.yaml` |
| CREATE | `packages/cli/templates/spring-boot/k8s/base/rollout.yaml` |
| CREATE | `packages/cli/templates/spring-boot/k8s/base/analysis-template.yaml` |
| CREATE | `packages/cli/src/commands/canary.ts` |
| CREATE | `packages/cli/src/utils/rollouts.ts` |
| MODIFY | `packages/cli/src/utils/config.ts` (add canary config interface) |
| MODIFY | `packages/cli/src/commands/deploy.ts` (add --canary flag) |
| MODIFY | `packages/cli/src/index.ts` (register canary command) |
| MODIFY | `packages/dashboard/src/components/CanaryStatus.tsx` |

### Phase 4 Definition of Done
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

# Canary Deployment
$ blissful-infra deploy --canary --env production

Starting canary deployment...
✓ Canary pods deployed (10% traffic)
⏳ Running analysis (2m pause)...

Analysis Results:
  error-rate:   0.3% (threshold: < 1%)    ✓ Pass
  p95-latency:  145ms (threshold: < 200ms) ✓ Pass

✓ Step 1 passed, promoting to 25%...
⏳ Running analysis (2m pause)...
✓ Step 2 passed, promoting to 50%...
⏳ Running analysis (5m pause)...
✓ Step 3 passed, promoting to 100%...

✅ Canary deployment complete!

$ blissful-infra canary status

Rollout: my-service
Status:  Progressing
Weight:  50% canary / 50% stable

Step     Weight  Status    Analysis
----     ------  ------    --------
1        10%     Complete  ✓ Passed
2        25%     Complete  ✓ Passed
3        50%     Running   ⏳ In Progress
4        100%    Pending   -

Current Analysis:
  error-rate:   0.2%   ✓ Pass (< 1%)
  p95-latency:  132ms  ✓ Pass (< 200ms)
  p99-latency:  198ms  ✓ Pass (< 500ms)

# Test rollback functionality
$ blissful-infra canary test --simulate-failure error-rate --value 5%

Testing canary rollback...
✓ Deployed canary (10% traffic)
⚡ Injecting failure: error-rate = 5%
⏳ Waiting for analysis...

Analysis detected failure:
  error-rate: 5.2% (threshold: < 1%) ✗ FAIL

🔄 Automatic rollback triggered...
✓ Traffic shifted to stable (100%)
✓ Canary pods terminated
✓ Rollback completed in 12s

Test Result: PASSED
  - Analysis correctly detected failure
  - Rollback triggered automatically
  - Service recovered within SLO (< 30s)
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

### 6.6 Enterprise Infrastructure Components
**Goal:** Additional enterprise patterns for comprehensive local simulation.

#### 6.6.1 Service Mesh (Istio/Linkerd)
- [ ] Istio installation template for Kind cluster
- [ ] mTLS between services (automatic encryption)
- [ ] Traffic policies (rate limiting, retries, timeouts)
- [ ] Service-to-service authorization
- [ ] Kiali dashboard for visualization

**Location:** `packages/cli/templates/cluster/istio/`

#### 6.6.2 Secrets Management (Vault)
- [ ] HashiCorp Vault deployment (dev mode)
- [ ] Kubernetes auth method
- [ ] External Secrets Operator integration
- [ ] Secret rotation patterns
- [ ] `blissful-infra secrets` command

**Location:** `packages/cli/templates/cluster/vault/`

#### 6.6.3 Distributed Tracing (Jaeger)
- [ ] Jaeger all-in-one deployment
- [ ] OpenTelemetry SDK in templates
- [ ] Trace correlation in dashboard
- [ ] Span analysis in agent

**Location:** `packages/cli/templates/cluster/jaeger/`

#### 6.6.4 API Gateway (Kong/Traefik)
- [ ] Ingress controller setup
- [ ] Rate limiting configuration
- [ ] Authentication middleware
- [ ] API versioning patterns

#### 6.6.5 Network Policies
- [ ] Default deny policies
- [ ] Service-specific allow rules
- [ ] Namespace isolation
- [ ] Policy templates per service type

#### 6.6.6 Certificate Management
- [ ] cert-manager installation
- [ ] Self-signed CA for local development
- [ ] TLS ingress configuration
- [ ] Certificate rotation

#### Enterprise Components Summary

| Component | Tool | Purpose | Complexity |
|-----------|------|---------|------------|
| Service Mesh | Istio | mTLS, traffic management | High |
| Secrets | Vault | Credential management | Medium |
| Tracing | Jaeger | Distributed tracing | Low |
| Gateway | Traefik | Ingress, rate limiting | Medium |
| Network Policies | K8s native | Pod isolation | Low |
| Certificates | cert-manager | TLS management | Medium |

**Note:** These components are optional and add significant resource requirements. Enable selectively based on learning goals.

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
- [x] Full pipeline completes < 10 minutes
- [x] Ephemeral environments work reliably
- [x] Local pipeline command available

### Phase 3 (Observability)
- [x] Metrics available within 30s of request
- [x] Logs searchable across services
- [x] Dashboard displays real-time metrics and health status

### Phase 4 (Resilience)
- [ ] Performance tests complete < 5 minutes
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
