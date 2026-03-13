# Goal

Build a web app to monitor and visualize per-pod resource usage in a kubernetes
namespace. Build a Helm chart to deploy the web app.

# Background

I have some one-off scripts in the current folder that collect usage data about
pods in a namespace and then produce a set of plots based on the collected data.
The data collection script is in `monitor_galaxy.sh`. Sample logs are in
`galaxy_usage_report-02-25-11-50.log`, and plotting is in `gen_plots.ts`. The
plotting script is an old version that used pasted data with current pod usage,
not the 4-column version with resource requirements.

# Tasks

## Task 1: Architecture and Implementation Plan

### Overview

A lightweight, single-binary web application that continuously collects
per-pod resource usage from a Kubernetes namespace and serves a real-time
dashboard. Runs locally (targeting a remote cluster via KUBECONFIG) or
in-cluster (deployed via Helm chart with appropriate RBAC).

### Technology Choices

**Backend: Go**
- Native K8s client (`client-go`, `metrics/pkg/client`) — mature, typed,
  minimal overhead.
- Single static binary, small container image (~20 MB scratch-based).
- Embeds the built frontend via `embed.FS`, so one artifact to ship.

**Frontend: React + Recharts**
- Builds on the existing `gen_plots.ts` visualization patterns.
- Stacked area, line, and bar charts from Recharts.
- Vite for builds; output is a static `dist/` directory embedded into the
  Go binary.

**Communication: Server-Sent Events (SSE)**
- One-way server→client push is sufficient (metric samples flow one
  direction).
- Simpler than WebSocket — no upgrade handshake, works through proxies,
  auto-reconnects natively in `EventSource`.
- REST endpoint for historical data on initial page load.

### Data Collection

The backend polls two K8s APIs on a configurable interval (default 30s):

1. **Metrics API** (`metrics.k8s.io/v1beta1` → `PodMetrics`)
   - Current CPU usage (nanocores) and memory usage (bytes) per
     container.
   - Equivalent to `kubectl top pods -n <namespace>`.

2. **Core API** (`v1` → `Pod.spec.containers[].resources.requests`)
   - CPU and memory requests per container.
   - Fetched less frequently (every 30s or on pod set change) since
     requests are static for a pod's lifetime.

Each sample is normalized into:

```
type Sample struct {
    Timestamp   time.Time
    Pods        []PodSample
}

type PodSample struct {
    Name       string
    CPUUsage   int64   // millicores
    CPURequest int64   // millicores (0 if unset)
    MemUsage   int64   // bytes
    MemRequest int64   // bytes (0 if unset)
}
```

Pod names are shortened to functional group names (e.g.,
`galaxy-web-5df98595dd-vwml5` → `galaxy-web`) for aggregation, matching
the existing `gen_plots.ts` approach. When multiple pods share a group
(e.g., two workflow replicas), their usage is summed; their requests are
also summed to reflect the total allocation to that group.

### Storage

In-memory ring buffer with configurable retention (default: 24 hours at
30s interval = ~2880 samples). No external database. The data is
ephemeral — the app is a monitoring tool, not a metrics store. If
persistent history is needed later, an export-to-file endpoint can be
added.

### API Design

All routes are mounted under an optional base path (configured via
`--base-path`, default `/`). For example, `--base-path /monitor` yields
`/monitor/api/samples`, `/monitor/api/stream`, etc. This allows the app
to sit behind a shared ingress or reverse proxy without path conflicts.

```
GET  {base}/api/samples?since=<RFC3339>&limit=<int>
     Returns historical samples as JSON array. Used on initial page
     load.

GET  {base}/api/stream
     SSE endpoint. Each event is a JSON-encoded Sample. The client
     appends incoming samples to its local state and re-renders charts.

GET  {base}/api/config
     Returns current settings: namespace, interval, retention,
     base path, pod groups.

GET  {base}/
     Serves the embedded React SPA (index.html + assets).
```

The `/api/config` response includes the base path so the frontend can
discover it at runtime rather than hard-coding route prefixes.

### Frontend Architecture

The React app maintains an array of `Sample` objects in state, seeded
from `/api/samples` on load and appended via `/api/stream`.

**Charts (4 panels):**

1. **Cumulative CPU** — Stacked area chart. Each band is a pod group's
   CPU usage over time. Y-axis in millicores. A horizontal dashed line
   shows the sum of all CPU requests as a "budget" reference.

2. **Cumulative Memory** — Same layout as CPU, but for memory (Y-axis
   in MiB/GiB).

3. **Per-Pod CPU** — Grouped bar or line chart. For each pod group,
   shows current usage as a filled bar and request as an outline/cap.
   This makes over/under-provisioning immediately visible.

4. **Per-Pod Memory** — Same layout as CPU per-pod chart.

**Request overlay approach:** On the per-pod charts, each pod group's
request is drawn as a horizontal dashed line or a translucent band at
the request level, so the viewer can see at a glance which pods are
near, at, or above their requested resources.

**Layout:** Sidebar + main content area.

- **Left sidebar** — Pod group filter panel. Each discovered pod group
  gets a checkbox (all checked by default). Checking/unchecking a group
  immediately includes/excludes it from every chart. A "Select All /
  None" toggle at the top for convenience. Groups are listed
  alphabetically with a small color swatch matching their chart color.
- **Main area** — The four chart panels plus summary stat cards.

**Interactivity:**
- Toggle CPU/Memory (existing pattern from `gen_plots.ts`).
- Pod group checkboxes in the sidebar for multi-select filtering.
- Hover for tooltip with exact values.
- Time range selector (last 5m / 15m / 1h / all).
- Auto-scroll: chart follows latest data, but pauses when the user
  pans/zooms.

### Running Locally

```bash
# Point at a remote cluster
export KUBECONFIG=~/.kube/my-cluster-config
galaxy-k8s-monitor --namespace galaxy --interval 30s --port 8080

# With a base path (useful behind a reverse proxy)
galaxy-k8s-monitor --namespace galaxy --base-path /monitor --port 8080

# Opens http://localhost:8080  (or /monitor/ with base path)
```

The Go binary reads `KUBECONFIG` from the environment or `--kubeconfig`
flag, falling back to in-cluster config when neither is set.

### Running In-Cluster (Helm)

The Helm chart creates:
- **Deployment** (1 replica) running the Go binary with
  `--namespace={{ .Values.targetNamespace }}`.
- **ServiceAccount** + **Role** + **RoleBinding** granting `get`/`list`
  on `pods` and `pods/metrics` (or a `ClusterRole` for
  `metrics.k8s.io` resources, since PodMetrics are cluster-scoped in
  some setups).
- **Service** (ClusterIP, port 8080).
- **Ingress** (optional) or **NodePort** for external access.
- **ConfigMap** for non-secret settings (namespace, interval,
  retention, base path).

```
chart/
  Chart.yaml
  values.yaml
  templates/
    deployment.yaml
    service.yaml
    serviceaccount.yaml
    rbac.yaml
    ingress.yaml       # optional
    configmap.yaml
```

### Project Layout

```
galaxy-k8s-monitor/
  plan.md
  monitor_galaxy.sh      # existing — keep for reference
  gen_plots.ts           # existing — keep for reference
  go.mod
  go.sum
  main.go                # entrypoint: flags (--base-path, etc.), config, starts server
  cmd/
    server/
      server.go          # HTTP server, SSE handler, static file serving
  internal/
    collector/
      collector.go       # K8s API polling loop, sample construction
      podgroups.go       # pod name → group name mapping
    store/
      ringbuffer.go      # in-memory time-series storage
    api/
      handlers.go        # /api/samples, /api/stream, /api/config
      types.go           # JSON-serializable types
  frontend/
    package.json
    vite.config.ts
    tsconfig.json
    src/
      main.tsx
      App.tsx
      hooks/
        useMetrics.ts    # SSE subscription + REST bootstrap
      components/
        Dashboard.tsx    # sidebar + main area layout, time range
        PodGroupFilter.tsx  # checkbox list of pod groups
        CumulativeChart.tsx
        PerPodChart.tsx
        StatsBar.tsx     # summary cards (avg, peak, pod count)
      lib/
        types.ts         # shared TypeScript types
        units.ts         # millicore/MiB formatting
  chart/
    Chart.yaml
    values.yaml
    templates/
      deployment.yaml
      service.yaml
      serviceaccount.yaml
      rbac.yaml
      ingress.yaml
      configmap.yaml
  Dockerfile
  Makefile               # build frontend, embed, compile Go binary
```

### Build Process

```makefile
# 1. Build frontend → frontend/dist/
cd frontend && npm ci && npm run build

# 2. Build Go binary (embeds frontend/dist/)
CGO_ENABLED=0 go build -o galaxy-k8s-monitor .

# 3. Docker image
docker build -t galaxy-k8s-monitor:latest .
```

The Dockerfile uses a multi-stage build: Node stage for the frontend,
Go stage for the binary, scratch/distroless for the final image.

### Implementation Order

1. **Go skeleton**: flags, config struct, K8s client initialization,
   health endpoint.
2. **Collector**: polling loop that produces `Sample` structs.
3. **Store**: ring buffer with `Append()`, `Since()`, `Latest()`.
4. **API**: REST `/api/samples` + SSE `/api/stream`.
5. **Frontend scaffold**: Vite + React, `useMetrics` hook consuming
   SSE.
6. **Charts**: Port and extend existing `gen_plots.ts` — add request
   overlays, time range selector.
7. **Embed + Dockerfile**: Wire static serving, multi-stage build.
8. **Helm chart**: Templates, RBAC, values.
9. **Polish**: Error handling, reconnection logic, loading states,
   responsive layout.
