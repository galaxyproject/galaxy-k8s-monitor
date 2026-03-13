# Galaxy K8s Monitor

Galaxy K8s Monitor is a single-binary web app that collects and visualizes
per-pod CPU and memory usage in a Kubernetes namespace.

It supports:
- live collection via Kubernetes APIs
- per-pod-group and cumulative charts
- pod-group checkbox filters
- optional API/UI base path (for example `/monitor`)
- local run (with `KUBECONFIG`) and in-cluster Helm deployment

## Requirements

- Go 1.23+
- Node.js 20+
- access to a Kubernetes cluster with `metrics-server` enabled

## Local Development

### 1) Build frontend assets

```bash
make frontend-build
```

### 2) Run the app

```bash
go run . \
  --namespace galaxy \
  --interval 30s \
  --retention-hours 24 \
  --address :8080
```

Open:
- `http://localhost:8080/`

### 3) Run against a remote cluster

```bash
export KUBECONFIG=~/.kube/config

go run . \
  --namespace galaxy \
  --interval 30s \
  --retention-hours 24 \
  --address :8080
```

You can also pass `--kubeconfig /path/to/config`.

### 4) Run with a base path

```bash
go run . \
  --namespace galaxy \
  --base-path /monitor \
  --address :8080
```

Open:
- `http://localhost:8080/monitor/`

## API Endpoints

All endpoints are served under the base path.

With default base path (`/`):
- `GET /api/config`
- `GET /api/samples`
- `GET /api/stream` (SSE)
- `GET /api/healthz`

With `--base-path /monitor`:
- `GET /monitor/api/config`
- `GET /monitor/api/samples`
- `GET /monitor/api/stream`
- `GET /monitor/api/healthz`

## Build Binary

```bash
make backend-build
```

## Build and Push Container

```bash
# Set registry if different from 'afgane'
# export REGISTRY=my-registry
make docker-build
make docker-push
```

## Helm Deployment

Chart path:
- `./chart`

### Install with defaults

```bash
helm upgrade --install galaxy-k8s-monitor ./chart \
  --namespace galaxy \
  --set monitor.namespace=galaxy
```

### Install with base path and ingress (Example)

See `values-production-example.yaml` for a reference configuration that uses a custom base path and an ingress.

```bash
helm upgrade --install galaxy-k8s-monitor ./chart \
  --namespace galaxy \
  -f values-production-example.yaml
```

This configuration:
- Serves the app at `/monitor` base path.
- Enables Nginx ingress on `/monitor` path.
- Configures RBAC to monitor the `galaxy` namespace.

Open:
- `http://<cluster-ip>/monitor/`

## Notes

- Default sampling is 30 seconds.
- Default retention is 24 hours in memory.
- Data is in-memory only and is not persisted across restarts.
