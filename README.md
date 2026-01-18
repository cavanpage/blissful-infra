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
npx blissful-infra create my-idea --template spring-boot
cd my-idea
blissful-infra up
```

That's it. You now have:

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

```bash
# Install
npm install -g blissful-infra

# Create a project
blissful-infra create my-service --template spring-boot

# Run locally
cd my-service
blissful-infra up

# See it work
curl http://localhost:8080/hello/world

# Open the dashboard
blissful-infra dashboard
```

## Templates

| Template | Stack |
|----------|-------|
| `spring-boot` | Kotlin + Spring Boot + Kafka + WebSockets |
| `fastapi` | Python + FastAPI + Kafka + WebSockets |
| `express` | Node + Express + TypeScript + Kafka + WebSockets |
| `go-chi` | Go + Chi + Kafka + WebSockets |
| `react-vite` | React + Vite + TypeScript + Redux + shadcn/ui |
| `fullstack` | Backend + Frontend monorepo |

## Specs

This project is built from two specifications:

| Spec | Description |
|------|-------------|
| **[Product Spec](./specs/product.md)** | CLI, templates, pipeline, chaos testing, version comparison |
| **[Agent Spec](./specs/agent.md)** | Local LLM integration, root cause analysis, self-learning knowledge base |
| **[Timeline](./specs/timeline.md)** | Phased development plan, MVP-first approach |

## Philosophy

1. **Iterate on ideas, not infrastructure** — The infra should disappear.
2. **Fail fast, fix faster** — Every failure teaches the system something.
3. **Trust but verify** — Parallel testing before promotion. Always.
4. **Own your stack** — No vendor lock-in. Eject anytime.

---

<div align="center">

**Built for engineers who'd rather ship than configure.**

</div>
