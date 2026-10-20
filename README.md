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

## Pod details and logs

On the Compute tab, select a pod-group name in either horizon chart to open
its details drawer. Chart datapoints still pin the selected sample. Details
and logs describe current Kubernetes pods, not the historical chart time.

A single matching pod and its single regular container load automatically.
If there are replicas, choose a pod; if there are multiple regular
containers, choose a container. Init containers are also available in the
container selector. The drawer shows status, readiness, restarts, creation
time, node, image, and resource requests/limits.

The log preview includes up to 1,000 recent lines / 1 MiB. Kubernetes-added
timestamps are hidden by default; **Show added timestamps** enables them for
both the preview and download. Timestamps written by the application stay
unchanged. Hover or focus the pod/image fields to copy their full values.
Use **Refresh logs** for new output, or **Download available log** to download
without the preview limits. When a container has restarted, the previous
instance's logs can be selected. Live following is not implemented.

Downloads contain the selected container's available stdout/stderr log.
Kubernetes does not return rotated log files through this API, and logs for
removed pods may no longer exist. Monitor does not archive logs. Uploaded
snapshots do not provide live pod details or logs.

The Helm chart grants read-only `pods/log` access in `monitor.namespace`.
Upgrade the chart as well as the image when enabling this feature. A local
kubeconfig must have equivalent access. The pod endpoints always use the
configured namespace, and only a limited details projection is exposed.
Monitor has no built-in user authentication: restrict access at the ingress
or reverse proxy to users authorized to see pod details and logs.

Additional endpoints (under the configured base path):

- `GET /api/pods?group=<pod-group>`: current matching pods and containers.
- `GET /api/pod-logs?pod=<name>&uid=<uid>&container=<name>`: recent logs.
  Add `previous=true` for the previous container instance, and
  `download=true` for an attachment without the preview limits. Add
  `timestamps=true` to include Kubernetes-added timestamps. Downloads
  have a two-minute request timeout; very slow transfers may be incomplete.
