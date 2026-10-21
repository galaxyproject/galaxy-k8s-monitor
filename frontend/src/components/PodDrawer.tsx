import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  RefreshCw,
  X,
} from 'lucide-react';
import PodManifest from './PodManifest';

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
  const dragRef = useRef<{
    pointerId: number;
    y: number;
    height: number;
  } | null>(null);
  const followLogBottom = useRef(true);
  const [viewportHeight, setViewportHeight] = useState(
    () => window.innerHeight,
  );
  const [preferredHeight, setPreferredHeight] = useState(50);
  const [resizing, setResizing] = useState(false);
  const [infoCollapsed, setInfoCollapsed] = useState(false);
  const minimumHeight = Math.min(50, (280 / viewportHeight) * 100);
  const drawerHeight = Math.max(minimumHeight, Math.min(90, preferredHeight));
  const infoId = `${titleId}-info`;
  const bodyId = `${titleId}-body`;

  useEffect(() => {
    const resize = () => setViewportHeight(window.innerHeight);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  function resizeFromPointer(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    const height =
      ((drag.height + drag.y - event.clientY) / window.innerHeight) * 100;
    setPreferredHeight(
      Math.max(
        Math.min(50, (280 / window.innerHeight) * 100),
        Math.min(90, height),
      ),
    );
  }

  function finishResize(event: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function resizeFromKeyboard(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 10 : 5;
    const heights: Record<string, number> = {
      ArrowUp: drawerHeight + step,
      ArrowDown: drawerHeight - step,
      PageUp: drawerHeight + 10,
      PageDown: drawerHeight - 10,
      Home: minimumHeight,
      End: 90,
    };
    if (!(event.key in heights)) return;
    event.preventDefault();
    setPreferredHeight(
      Math.max(minimumHeight, Math.min(90, heights[event.key])),
    );
  }
  const [pods, setPods] = useState<Pod[]>([]);
  const [podUID, setPodUID] = useState('');
  const [containerName, setContainerName] = useState('');
  const [view, setView] = useState<'logs' | 'manifest'>('logs');
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
    if (!live || !logURL || view !== 'logs') return;
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
  }, [live, logURL, logRevision, view]);

  useLayoutEffect(() => {
    if (!logsLoading && !logsError && logRef.current) {
      followLogBottom.current = true;
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs, logsLoading, logsError]);

  // Resizing should keep the tail visible only when the reader was already there.
  useLayoutEffect(() => {
    if (followLogBottom.current && logRef.current)
      logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [drawerHeight, infoCollapsed, viewportHeight]);

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

  const contentSwitch = (
    <div
      className="pod-content-views"
      role="group"
      aria-label="Pod content view"
    >
      <button
        type="button"
        className="btn-compact"
        aria-pressed={view === 'logs'}
        onClick={() => setView('logs')}
      >
        Logs
      </button>
      <button
        type="button"
        className="btn-compact"
        aria-pressed={view === 'manifest'}
        onClick={() => setView('manifest')}
      >
        Manifest
      </button>
    </div>
  );

  return createPortal(
    <dialog
      ref={dialogRef}
      className="pod-drawer"
      style={{ height: `${drawerHeight}dvh` }}
      data-resizing={resizing ? 'true' : 'false'}
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
      <div
        className="pod-drawer-resize"
        role="separator"
        tabIndex={0}
        aria-label="Resize pod details drawer"
        aria-orientation="horizontal"
        aria-controls={bodyId}
        aria-valuemin={Math.round(minimumHeight)}
        aria-valuemax={90}
        aria-valuenow={Math.round(drawerHeight)}
        aria-valuetext={`${Math.round(drawerHeight)}% of screen height`}
        title="Drag to resize. Use Up/Down arrows to resize with the keyboard."
        onKeyDown={resizeFromKeyboard}
        onPointerDown={(event) => {
          if (event.button !== 0 || !event.isPrimary) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = {
            pointerId: event.pointerId,
            y: event.clientY,
            height: dialogRef.current?.getBoundingClientRect().height ?? 0,
          };
          setResizing(true);
        }}
        onPointerMove={resizeFromPointer}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
        onLostPointerCapture={finishResize}
      />
      <header className="pod-drawer-header">
        <h2 id={titleId}>{group}</h2>
        {pod && contentSwitch}
        {live && (!infoCollapsed || !pod) && (
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
        <div className="pod-drawer-actions">
          {pod && (
            <button
              type="button"
              className="btn-compact"
              aria-expanded={!infoCollapsed}
              aria-controls={infoId}
              onClick={() => setInfoCollapsed((value) => !value)}
            >
              {infoCollapsed ? (
                <ChevronDown size={14} aria-hidden="true" />
              ) : (
                <ChevronUp size={14} aria-hidden="true" />
              )}
              {infoCollapsed ? 'Show pod info' : 'Hide pod info'}
            </button>
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
        </div>
      </header>
      <span className="sr-only" role="status">
        {copyMessage}
      </span>
      <div className="pod-drawer-body" id={bodyId}>
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
              <dl
                className="pod-details"
                id={infoId}
                hidden={infoCollapsed}
                aria-label="Current pod details"
              >
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
            {pod && view === 'manifest' && (
              <PodManifest key={pod.uid} name={pod.name} uid={pod.uid} />
            )}
            {pod && view === 'logs' && (
              <section className="pod-log-section" aria-label="Pod logs">
                <div className="pod-drawer-toolbar">
                  {container && (
                    <>
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
                        <Download size={14} aria-hidden="true" /> Download
                        available log
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
                            onChange={(event) =>
                              setPrevious(event.target.checked)
                            }
                          />{' '}
                          Previous container instance
                        </label>
                      )}
                    </>
                  )}
                </div>
                {!container && (
                  <p>
                    Choose a container to view its logs, or select Manifest to
                    inspect the pod.
                  </p>
                )}
                {container && logsLoading && <p role="status">Loading logs…</p>}
                {container && logsError && (
                  <p role="alert" className="pod-drawer-error">
                    {logsError}
                  </p>
                )}
                {container && !logsLoading && !logsError && (
                  <pre
                    ref={logRef}
                    onScroll={(event) => {
                      const element = event.currentTarget;
                      followLogBottom.current =
                        element.scrollHeight -
                          element.clientHeight -
                          element.scrollTop <
                        2;
                    }}
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
