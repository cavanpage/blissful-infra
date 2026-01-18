# my-idea

Generated with [blissful-infra](https://github.com/you/blissful-infra).

## Quick Start

```bash
# Start local environment
blissful-infra up

# View logs
blissful-infra logs

# Stop environment
blissful-infra down

# Test the API
curl http://localhost:8080/health
curl http://localhost:8080/hello
curl http://localhost:8080/hello/YourName
```

## Configuration

See `blissful-infra.yaml` for project settings.

## Template

- **Template:** spring-boot
- **Database:** none
- **Deploy Target:** local-only

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/ready` | GET | Kubernetes readiness probe |
| `/live` | GET | Kubernetes liveness probe |
| `/hello` | GET | Returns "Hello, World!" |
| `/hello/:name` | GET | Returns personalized greeting |
| `/echo` | POST | Echoes request body |
| `/ws/events` | WS | WebSocket for real-time events |
