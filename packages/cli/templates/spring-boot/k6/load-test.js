import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const healthCheckDuration = new Trend('health_check_duration');

// Test configuration - override with environment variables
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const STAGE_DURATION = __ENV.STAGE_DURATION || '30s';
const MAX_VUS = parseInt(__ENV.MAX_VUS || '50');

export const options = {
  stages: [
    { duration: STAGE_DURATION, target: Math.ceil(MAX_VUS * 0.2) },  // Ramp up to 20%
    { duration: STAGE_DURATION, target: MAX_VUS },                     // Ramp up to 100%
    { duration: STAGE_DURATION, target: MAX_VUS },                     // Sustain peak
    { duration: STAGE_DURATION, target: 0 },                           // Ramp down
  ],
  thresholds: {
    http_req_duration: [
      'p(95)<500',   // 95% of requests under 500ms
      'p(99)<1000',  // 99% of requests under 1s
    ],
    http_req_failed: ['rate<0.01'],  // Error rate under 1%
    errors: ['rate<0.01'],
  },
};

// Weighted scenario distribution
const endpoints = [
  { path: '/hello', weight: 30 },
  { path: '/hello/k6-user', weight: 25 },
  { path: '/health', weight: 15 },
  { path: '/ready', weight: 10 },
  { path: '/echo', weight: 20, method: 'POST', body: JSON.stringify({ message: 'k6 load test', timestamp: Date.now() }) },
];

function selectEndpoint() {
  const totalWeight = endpoints.reduce((sum, e) => sum + e.weight, 0);
  let random = Math.random() * totalWeight;

  for (const endpoint of endpoints) {
    random -= endpoint.weight;
    if (random <= 0) return endpoint;
  }
  return endpoints[0];
}

export default function () {
  const endpoint = selectEndpoint();
  const url = `${BASE_URL}${endpoint.path}`;

  let response;
  const params = {
    headers: { 'Content-Type': 'application/json' },
    tags: { endpoint: endpoint.path },
  };

  if (endpoint.method === 'POST') {
    response = http.post(url, endpoint.body, params);
  } else {
    response = http.get(url, params);
  }

  // Track errors
  const success = check(response, {
    'status is 2xx': (r) => r.status >= 200 && r.status < 300,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });

  errorRate.add(!success);

  // Track health check latency separately
  if (endpoint.path === '/health' || endpoint.path === '/ready') {
    healthCheckDuration.add(response.timings.duration);
  }

  sleep(0.1 + Math.random() * 0.4); // 100-500ms between requests
}

export function handleSummary(data) {
  // Output JSON summary for CLI parsing
  const summary = {
    timestamp: new Date().toISOString(),
    duration: data.state.testRunDurationMs,
    vus: {
      max: data.metrics.vus_max ? data.metrics.vus_max.values.max : 0,
    },
    requests: {
      total: data.metrics.http_reqs ? data.metrics.http_reqs.values.count : 0,
      rate: data.metrics.http_reqs ? data.metrics.http_reqs.values.rate : 0,
      failed: data.metrics.http_req_failed ? data.metrics.http_req_failed.values.rate : 0,
    },
    latency: {
      avg: data.metrics.http_req_duration ? data.metrics.http_req_duration.values.avg : 0,
      min: data.metrics.http_req_duration ? data.metrics.http_req_duration.values.min : 0,
      max: data.metrics.http_req_duration ? data.metrics.http_req_duration.values.max : 0,
      p50: data.metrics.http_req_duration ? data.metrics.http_req_duration.values['p(50)'] : 0,
      p90: data.metrics.http_req_duration ? data.metrics.http_req_duration.values['p(90)'] : 0,
      p95: data.metrics.http_req_duration ? data.metrics.http_req_duration.values['p(95)'] : 0,
      p99: data.metrics.http_req_duration ? data.metrics.http_req_duration.values['p(99)'] : 0,
    },
    errorRate: data.metrics.errors ? data.metrics.errors.values.rate : 0,
    thresholds: {},
  };

  // Extract threshold results
  if (data.root_group && data.root_group.checks) {
    for (const check of data.root_group.checks) {
      summary.thresholds[check.name] = {
        passes: check.passes,
        fails: check.fails,
        rate: check.passes / (check.passes + check.fails),
      };
    }
  }

  return {
    'stdout': JSON.stringify(summary, null, 2) + '\n',
    'k6-results.json': JSON.stringify(summary, null, 2),
  };
}
