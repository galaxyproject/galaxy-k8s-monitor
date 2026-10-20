import React, { useEffect, useState } from 'react';
import { Check, Copy, Download, RefreshCw } from 'lucide-react';

type Props = { name: string; uid: string };

export default function PodManifest({ name, uid }: Props) {
  const [manifest, setManifest] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [copied, setCopied] = useState(false);
  const [copyMessage, setCopyMessage] = useState('');
  const url = `api/pod-manifest?${new URLSearchParams({ pod: name, uid })}`;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setManifest('');
    setCopied(false);
    setCopyMessage('');
    void (async () => {
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok)
          throw new Error(
            (await response.text()).trim() ||
              `Request failed (${response.status})`,
          );
        const yaml = await response.text();
        if (!controller.signal.aborted) setManifest(yaml);
      } catch (reason) {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : 'Could not load pod manifest',
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [url, revision]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copyManifest() {
    try {
      await navigator.clipboard.writeText(manifest);
      setCopied(true);
      setCopyMessage('Manifest copied');
    } catch {
      setCopyMessage(
        'Could not copy manifest. Select the YAML and copy it manually.',
      );
    }
  }

  return (
    <section className="pod-log-section" aria-label="Pod manifest">
      <div className="pod-drawer-toolbar">
        <button
          type="button"
          className="btn-compact"
          disabled={loading}
          onClick={() => setRevision((value) => value + 1)}
        >
          <RefreshCw size={14} aria-hidden="true" /> Refresh manifest
        </button>
        <button
          type="button"
          className="btn-compact"
          disabled={loading || !manifest || !!error}
          onClick={() => void copyManifest()}
        >
          {copied ? (
            <Check size={14} aria-hidden="true" />
          ) : (
            <Copy size={14} aria-hidden="true" />
          )}{' '}
          Copy YAML
        </button>
        {!loading && !error && manifest && (
          <a
            className="btn-compact pod-log-download"
            href={`${url}&download=true`}
            download
          >
            <Download size={14} aria-hidden="true" /> Download YAML
          </a>
        )}
      </div>
      <span role="status" className="sr-only">
        {copyMessage}
      </span>
      {loading && <p role="status">Loading pod manifest…</p>}
      {error && (
        <p role="alert" className="pod-drawer-error">
          {error}
        </p>
      )}
      {!loading && !error && (
        <pre
          className="pod-logs pod-manifest"
          tabIndex={0}
          aria-label={`Manifest for ${name}`}
        >
          {manifest}
        </pre>
      )}
      <p
        className="pod-drawer-note"
        title="Live Pod object including Kubernetes defaults, injected configuration and status. Managed fields are omitted. This is not the Helm template."
      >
        Live Pod YAML · Includes defaults and status · Managed fields omitted
      </p>
    </section>
  );
}
