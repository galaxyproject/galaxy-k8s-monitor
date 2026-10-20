import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, Download, RefreshCw, X } from 'lucide-react';

type Container = {
  name: string;
  image: string;
  init: boolean;
  ready: boolean;
  restarts: number;
  state: string;
  cpuRequest: string;
  memoryRequest: string;
  cpuLimit: string;
  memoryLimit: string;
};
type Pod = {
  name: string;
  uid: string;
  namespace: string;
  phase: string;
  node: string;
  created: string;
  containers: Container[];
};
type Props = { group: string; live: boolean; onClose: () => void };

async function responseError(response: Response): Promise<Error> {
  const message = await response.text();
  return new Error(message.trim() || `Request failed (${response.status})`);
}

export default function PodDrawer({ group, live, onClose }: Props) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const logRef = useRef<HTMLPreElement>(null);
  const [pods, setPods] = useState<Pod[]>([]);
  const [podUID, setPodUID] = useState('');
  const [containerName, setContainerName] = useState('');
  const [previous, setPrevious] = useState(false);
  const [showTimestamps, setShowTimestamps] = useState(false);
  const [copiedField, setCopiedField] = useState('');
  const [copyMessage, setCopyMessage] = useState('');
  const [revision, setRevision] = useState(0);
  const [logRevision, setLogRevision] = useState(0);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState('');
  const [logs, setLogs] = useState('');

  // The native modal supplies focus containment and makes the dashboard inert.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.showModal();
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      dialog?.close();
      document.body.style.overflow = oldOverflow;
      opener?.focus();
    };
  }, []);

  useEffect(() => {
    setPods([]);
    setPodUID('');
    setContainerName('');
    setPrevious(false);
    setDetailsError('');
    setLogs('');
    setLogsError('');
    if (!live) return;
    const controller = new AbortController();
    setDetailsLoading(true);
    void (async () => {
      try {
        const response = await fetch(
          `api/pods?${new URLSearchParams({ group })}`,
          { signal: controller.signal, cache: 'no-store' },
        );
        if (!response.ok) throw await responseError(response);
        const loaded = (await response.json()) as Pod[];
        if (controller.signal.aborted) return;
        setPods(loaded);
        // A single pod always opens directly. With replicas, require a choice.
        if (loaded.length === 1) {
          setPodUID(loaded[0].uid);
          const regular = loaded[0].containers.filter((c) => !c.init);
          if (regular.length === 1) setContainerName(regular[0].name);
          else if (loaded[0].containers.length === 1)
            setContainerName(loaded[0].containers[0].name);
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setDetailsError(
            error instanceof Error
              ? error.message
              : 'Could not load pod details',
          );
      } finally {
        if (!controller.signal.aborted) setDetailsLoading(false);
      }
    })();
    return () => controller.abort();
  }, [group, live, revision]);

  const pod = pods.find((item) => item.uid === podUID);
  const container = pod?.containers.find((item) => item.name === containerName);
  const logParams =
    pod && container
      ? new URLSearchParams({
          pod: pod.name,
          uid: pod.uid,
          container: container.name,
          previous: String(previous),
          timestamps: String(showTimestamps),
        })
      : null;
  const logURL = logParams ? `api/pod-logs?${logParams}` : '';

  useEffect(() => {
    setLogs('');
    setLogsError('');
    setLogsLoading(false);
    if (!live || !logURL) return;
    const controller = new AbortController();
    setLogsLoading(true);
    void (async () => {
      try {
        const response = await fetch(logURL, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok) throw await responseError(response);
        const text = await response.text();
        if (!controller.signal.aborted) setLogs(text);
      } catch (error) {
        if (!controller.signal.aborted)
          setLogsError(
            error instanceof Error ? error.message : 'Could not load logs',
          );
      } finally {
        if (!controller.signal.aborted) setLogsLoading(false);
      }
    })();
    return () => controller.abort();
  }, [live, logURL, logRevision]);

  useLayoutEffect(() => {
    if (!logsLoading && !logsError && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs, logsLoading, logsError]);

  useEffect(() => {
    if (!copiedField) return;
    const timer = window.setTimeout(() => setCopiedField(''), 2000);
    return () => window.clearTimeout(timer);
  }, [copiedField]);

  useEffect(() => {
    setCopiedField('');
    setCopyMessage('');
  }, [podUID, containerName]);

  async function copyDetail(label: string, value: string) {
    const name = label === 'Pod' ? 'pod name' : 'image name';
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(label);
      setCopyMessage(`${name === 'pod name' ? 'Pod' : 'Image'} name copied`);
    } catch {
      setCopyMessage(
        `Could not copy ${name}. Select the value and copy it manually.`,
      );
    }
  }

  function selectPod(uid: string) {
    setPodUID(uid);
    setPrevious(false);
    const next = pods.find((item) => item.uid === uid);
    const regular = next?.containers.filter((c) => !c.init) ?? [];
    setContainerName(
      regular.length === 1
        ? regular[0].name
        : next?.containers.length === 1
          ? next.containers[0].name
          : '',
    );
  }

  const details = pod
    ? [
        ['Pod', pod.name],
        ['Namespace', pod.namespace],
        ['Status', pod.phase],
        ['Node', pod.node || 'Not scheduled'],
        [
          'Created',
          pod.created ? new Date(pod.created).toLocaleString() : 'Unknown',
        ],
        ...(container
          ? [
              [
                'Container',
                `${container.name}${container.init ? ' (init)' : ''}`,
              ],
              [
                'State',
                `${container.state} · ${container.ready ? 'Ready' : 'Not ready'}`,
              ],
              ['Restarts', String(container.restarts)],
              ['Image', container.image],
              [
                'CPU request / limit',
                `${container.cpuRequest} / ${container.cpuLimit}`,
              ],
              [
                'Memory request / limit',
                `${container.memoryRequest} / ${container.memoryLimit}`,
              ],
            ]
          : []),
      ]
    : [];

  return createPortal(
    <dialog
      ref={dialogRef}
      className="pod-drawer"
      data-no-print
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            onClose();
        }
      }}
    >
      <header className="pod-drawer-header">
        <h2 id={titleId}>{group}</h2>
        {live && (
          <>
            {pods.length > 1 && (
              <label className="pod-drawer-field">
                Pod
                <select
                  value={podUID}
                  onChange={(event) => selectPod(event.target.value)}
                >
                  <option value="">
                    Select a pod ({pods.length} available)
                  </option>
                  {pods.map((item) => (
                    <option key={item.uid} value={item.uid}>
                      {item.name} · {item.phase}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {pod && pod.containers.length > 1 && (
              <label className="pod-drawer-field">
                Container
                <select
                  value={containerName}
                  onChange={(event) => {
                    setContainerName(event.target.value);
                    setPrevious(false);
                  }}
                >
                  <option value="">Select a container</option>
                  {pod.containers.map((item) => (
                    <option key={item.name} value={item.name}>
                      {item.name}
                      {item.init ? ' (init)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="button"
              className="btn-compact pod-refresh-details"
              onClick={() => setRevision((value) => value + 1)}
              disabled={detailsLoading}
            >
              <RefreshCw size={14} aria-hidden="true" /> Refresh pod details
            </button>
          </>
        )}
        <button
          type="button"
          className="btn-compact pod-drawer-close"
          aria-label="Close pod details"
          onClick={onClose}
          autoFocus
        >
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      <span className="sr-only" role="status">
        {copyMessage}
      </span>
      <div className="pod-drawer-body">
        {!live ? (
          <p role="status">
            Live pod details and logs are not available for uploaded snapshots.
          </p>
        ) : (
          <>
            {detailsLoading && <p role="status">Loading pod details…</p>}
            {detailsError && (
              <p role="alert" className="pod-drawer-error">
                {detailsError}
              </p>
            )}
            {!detailsLoading && !detailsError && pods.length === 0 && (
              <p role="status">
                No current pods match this group. Historical pods may have been
                removed.
              </p>
            )}
            {pod && (
              <dl className="pod-details" aria-label="Current pod details">
                {details.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd title={value}>{value}</dd>
                    {(label === 'Pod' || label === 'Image') && (
                      <button
                        type="button"
                        className="pod-detail-copy"
                        aria-label={`Copy ${label === 'Pod' ? 'pod' : 'image'} name`}
                        title={
                          copiedField === label
                            ? 'Copied'
                            : `Copy full ${label === 'Pod' ? 'pod' : 'image'} name`
                        }
                        onClick={() => void copyDetail(label, value)}
                      >
                        {copiedField === label ? (
                          <Check size={13} aria-hidden="true" />
                        ) : (
                          <Copy size={13} aria-hidden="true" />
                        )}
                      </button>
                    )}
                  </div>
                ))}
              </dl>
            )}
            {pod && container && (
              <section
                className="pod-log-section"
                aria-labelledby={`${titleId}-logs`}
              >
                <div className="pod-drawer-toolbar">
                  <h3 id={`${titleId}-logs`}>Logs</h3>
                  <button
                    type="button"
                    className="btn-compact"
                    disabled={logsLoading}
                    onClick={() => setLogRevision((value) => value + 1)}
                  >
                    <RefreshCw size={14} aria-hidden="true" /> Refresh logs
                  </button>
                  <a
                    className="btn-compact pod-log-download"
                    href={`${logURL}&download=true`}
                    download
                  >
                    <Download size={14} aria-hidden="true" /> Download available
                    log
                  </a>
                  <button
                    type="button"
                    className="btn-compact"
                    aria-pressed={showTimestamps}
                    onClick={() => setShowTimestamps((value) => !value)}
                    title="Toggle timestamps added by Kubernetes; application timestamps are unchanged"
                  >
                    {showTimestamps
                      ? 'Hide added timestamps'
                      : 'Show added timestamps'}
                  </button>
                  {container.restarts > 0 && (
                    <label className="pod-previous">
                      <input
                        type="checkbox"
                        checked={previous}
                        onChange={(event) => setPrevious(event.target.checked)}
                      />{' '}
                      Previous container instance
                    </label>
                  )}
                </div>
                {logsLoading && <p role="status">Loading logs…</p>}
                {logsError && (
                  <p role="alert" className="pod-drawer-error">
                    {logsError}
                  </p>
                )}
                {!logsLoading && !logsError && (
                  <pre
                    ref={logRef}
                    className="pod-logs"
                    tabIndex={0}
                    aria-label={`Logs for ${pod.name}, ${container.name}`}
                  >
                    {logs || 'No log output available.'}
                  </pre>
                )}
                <p className="pod-drawer-note">
                  Live logs · Latest 1,000 lines / 1 MiB · Download excludes
                  rotated files · Independent of chart time
                </p>
              </section>
            )}
          </>
        )}
      </div>
    </dialog>,
    document.body,
  );
}
