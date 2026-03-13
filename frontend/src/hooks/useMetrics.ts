import { useEffect, useMemo, useState } from 'react';
import type { ConfigResponse, Sample } from '../lib/types';

type UseMetricsResult = {
  samples: Sample[];
  config: ConfigResponse | null;
  loading: boolean;
  error: string | null;
};

type UseMetricsOptions = {
  enabled?: boolean;
};

const SAMPLE_LIMIT = 5000;

export function useMetrics(options: UseMetricsOptions = {}): UseMetricsResult {
  const { enabled = true } = options;
  const [samples, setSamples] = useState<Sample[]>([]);
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setError(null);
      return;
    }

    let isCancelled = false;
    let eventSource: EventSource | null = null;

    const initialize = async () => {
      try {
        setLoading(true);
        const configResponse = await fetch('api/config');
        if (!configResponse.ok) {
          throw new Error(`config request failed: ${configResponse.status}`);
        }

        const loadedConfig = (await configResponse.json()) as ConfigResponse;
        if (isCancelled) {
          return;
        }

        setConfig(loadedConfig);

        const samplesResponse = await fetch(`api/samples?limit=${SAMPLE_LIMIT}`);
        if (!samplesResponse.ok) {
          throw new Error(`samples request failed: ${samplesResponse.status}`);
        }

        const initialSamples = (await samplesResponse.json()) as Sample[];
        if (!isCancelled) {
          setSamples(initialSamples);
        }

        eventSource = new EventSource('api/stream');
        eventSource.addEventListener('sample', event => {
          const nextSample = JSON.parse((event as MessageEvent).data) as Sample;
          setSamples(previous => {
            const updated = [...previous, nextSample];
            if (updated.length > SAMPLE_LIMIT) {
              return updated.slice(updated.length - SAMPLE_LIMIT);
            }
            return updated;
          });
        });

        eventSource.onerror = () => {
          setError('Live stream disconnected. Retrying automatically...');
        };

        setError(null);
      } catch (caughtError) {
        if (!isCancelled) {
          const message = caughtError instanceof Error ? caughtError.message : 'Unknown error';
          setError(message);
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    };

    initialize();

    return () => {
      isCancelled = true;
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [enabled]);

  return useMemo(
    () => ({ samples, config, loading, error }),
    [samples, config, loading, error]
  );
}
