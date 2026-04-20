import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { resolveApiBaseUrl } from '../api/apiBase';
import api from '../api/axiosInstance';
import QuickPageMenu from '../components/Navigation/QuickPageMenu';
import './DeveloperMonitoringPage.css';

const numberFmt = new Intl.NumberFormat('en-IN');
const compactNumberFmt = new Intl.NumberFormat('en-IN', {
  notation: 'compact',
  maximumFractionDigits: 1
});
const percentFmt = new Intl.NumberFormat('en-IN', {
  style: 'percent',
  maximumFractionDigits: 1
});

const PROVIDER_NAME_MAP = {
  ollama: 'Ollama',
  openai: 'OpenAI',
  anthropic: 'Claude'
};

const MODE_NAME_MAP = {
  http_chat: 'Standard chat reply',
  websocket_stream: 'Live streaming reply',
  http_execute: 'Action workflow request'
};

const WORKFLOW_STAGE_MAP = {
  strategist: 'Planning',
  retriever: 'Knowledge lookup',
  responder: 'Answer drafting',
  critic: 'Quality review',
  fallback: 'Fallback handling',
  memory: 'Memory update',
  executor: 'Action execution'
};

const asNumber = (value) => Number(value || 0);
const trimSlash = (value = '') => String(value || '').trim().replace(/\/+$/, '');

const formatCount = (value) => {
  const safeValue = asNumber(value);
  return safeValue >= 1000 ? compactNumberFmt.format(safeValue) : numberFmt.format(safeValue);
};

const formatDuration = (value) => {
  const durationMs = Math.max(asNumber(value), 0);
  if (!durationMs) return '0 ms';
  if (durationMs >= 1000) return `${(durationMs / 1000).toFixed(durationMs >= 10000 ? 0 : 1)} s`;
  return `${Math.round(durationMs)} ms`;
};

const formatTimestamp = (value) => {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
};

const formatRelativeTime = (value) => {
  if (!value) return '--';
  const stamp = new Date(value).getTime();
  if (Number.isNaN(stamp)) return '--';

  const diffSeconds = Math.round((Date.now() - stamp) / 1000);
  if (Math.abs(diffSeconds) < 5) return 'just now';
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
  return `${Math.floor(diffSeconds / 3600)}h ago`;
};

const formatClockTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit'
  });
};

const toRatio = (numerator, denominator) => {
  const total = asNumber(denominator);
  if (!total) return 0;
  return asNumber(numerator) / total;
};

const safePercent = (value) => percentFmt.format(Math.max(0, Math.min(asNumber(value), 1)));

const titleCaseWords = (value = '') =>
  String(value || '')
    .split(/[_:/.-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const providerLabel = (value, fallback = '') =>
  PROVIDER_NAME_MAP[String(value || '').toLowerCase()] || fallback || titleCaseWords(value || 'Provider');

const toolStateLabel = (state) => {
  const normalized = String(state || '').toLowerCase();
  if (normalized === 'live') return 'Live';
  if (normalized === 'connected') return 'Connected';
  if (normalized === 'offline') return 'Offline';
  return 'Setup needed';
};

const toolStateTone = (state) => {
  const normalized = String(state || '').toLowerCase();
  if (normalized === 'live' || normalized === 'connected') return 'healthy';
  if (normalized === 'offline') return 'watch';
  return 'setup';
};

const statusLabel = (policy) => {
  const status = String(policy?.status || 'OK').toUpperCase();
  if (status === 'FIRING') return 'Critical';
  if (status === 'WATCH') return 'Watch';
  return 'Healthy';
};

const metricRowsFromObject = (items = {}, humanizer = null, limit = 5) =>
  Object.entries(items || {})
    .sort((left, right) => asNumber(right[1]) - asNumber(left[1]))
    .slice(0, limit)
    .map(([rawLabel, value]) => ({
      rawLabel,
      label: typeof humanizer === 'function' ? humanizer(rawLabel) : rawLabel,
      value: asNumber(value)
    }));

const humanizeModeLabel = (value = '') =>
  MODE_NAME_MAP[String(value || '').toLowerCase()] || titleCaseWords(value || '');

const humanizeWorkflowLabel = (value = '') => {
  const [runtime, node] = String(value || '').split(':');
  const runtimeLabel = String(runtime || '').toLowerCase() === 'langgraph_compat'
    ? 'LangGraph'
    : String(runtime || '').toLowerCase() === 'agentic_model_tools'
      ? 'Agentic tools'
    : String(runtime || '').toLowerCase() === 'agent_graph'
      ? 'Agent graph'
      : titleCaseWords(runtime || 'workflow');
  const nodeLabel = WORKFLOW_STAGE_MAP[String(node || '').toLowerCase()] || titleCaseWords(node || 'stage');
  return `${nodeLabel} (${runtimeLabel})`;
};

const humanizeOrchestration = (value = '') => {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'agentic_model_tools') return 'Agentic tool runtime';
  if (normalized === 'langgraph_compat') return 'LangGraph-compatible';
  if (normalized === 'agent_graph') return 'Agent graph';
  return titleCaseWords(value || 'workflow');
};

const humanizeMemoryLabel = (value = '') => titleCaseWords(value || '');

const classifyProductArea = (routeLabel = '') => {
  const lower = String(routeLabel || '').toLowerCase();
  if (lower.includes('/api/ai')) return 'AI assistant';
  if (lower.includes('/api/ops')) return 'Monitoring tools';
  if (lower.includes('/booking')) return 'Bookings';
  if (lower.includes('/calendar')) return 'Calendar';
  if (lower.includes('/notices')) return 'Notices';
  if (lower.includes('/queries')) return 'Queries';
  if (lower.includes('/complaints')) return 'Complaints';
  if (lower.includes('/feedback')) return 'Feedback';
  if (lower.includes('/approval')) return 'Approval flow';
  if (lower.includes('/department') || lower.includes('/account') || lower.includes('/details') || lower.includes('login')) {
    return 'Accounts and sign-in';
  }
  return 'Other backend traffic';
};

const buildMonitoringError = (err, apiBase) => {
  const responseMessage = err?.response?.data?.error;
  if (responseMessage) return responseMessage;

  const fallbackMessage = String(err?.message || '').trim();
  if (String(err?.code || '').toUpperCase() === 'ERR_NETWORK' || /network error/i.test(fallbackMessage)) {
    return `Network error while loading monitoring data. Current API base: ${apiBase}. If the frontend is deployed separately from the backend, set REACT_APP_API_URL to the backend /api URL and redeploy.`;
  }

  return fallbackMessage || 'Unable to load monitoring overview.';
};

const resolveBackendLink = (endpoint, apiBase) => {
  const raw = String(endpoint || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;

  const apiOrigin = trimSlash(String(apiBase || '').replace(/\/api$/i, ''));
  if (apiOrigin && raw.startsWith('/')) return `${apiOrigin}${raw}`;
  return raw;
};

const aggregateRows = (rows = []) =>
  rows.reduce((accumulator, row) => {
    const label = String(row.label || '').trim();
    if (!label) return accumulator;
    accumulator[label] = Number(accumulator[label] || 0) + asNumber(row.value);
    return accumulator;
  }, {});

const renderFriendlyList = (rows, emptyLabel, formatter = formatCount) => {
  if (!rows.length) {
    return <div className="monitoring-empty-row">{emptyLabel}</div>;
  }

  return rows.map((row) => (
    <div key={row.rawLabel || row.label}>
      <span title={row.label}>{row.label}</span>
      <b>{formatter(row.value)}</b>
    </div>
  ));
};

const buildChartPoints = (data = [], getValue, width, height, paddingX, paddingY, maxOverride = null) => {
  if (!data.length) return { points: [], maxValue: 0 };

  const values = data.map((item) => Math.max(asNumber(getValue(item)), 0));
  const maxValue = Math.max(maxOverride == null ? Math.max(...values, 0) : maxOverride, 1);
  const usableWidth = Math.max(width - paddingX * 2, 1);
  const usableHeight = Math.max(height - paddingY * 2, 1);

  const points = data.map((item, index) => {
    const x = data.length === 1 ? width / 2 : paddingX + (usableWidth * index) / Math.max(data.length - 1, 1);
    const y = height - paddingY - (Math.max(asNumber(getValue(item)), 0) / maxValue) * usableHeight;
    return {
      x,
      y,
      value: Math.max(asNumber(getValue(item)), 0),
      label: item.label || '',
      raw: item
    };
  });

  return { points, maxValue };
};

function ChartCard({ title, typeLabel, subtitle, footer, children }) {
  return (
    <article className="monitoring-chart-card">
      <div className="monitoring-chart-head">
        <div>
          <span>{typeLabel}</span>
          <h3>{title}</h3>
        </div>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {children}
      {footer ? <small className="monitoring-chart-footer">{footer}</small> : null}
    </article>
  );
}

function ChartEmptyState({ label }) {
  return <div className="monitoring-chart-empty">{label}</div>;
}

function LineTrendChart({ data, emptyLabel, colorClass = '' }) {
  if (!data.length) return <ChartEmptyState label={emptyLabel} />;

  const width = 360;
  const height = 210;
  const paddingX = 26;
  const paddingY = 22;
  const { points } = buildChartPoints(data, (item) => item.value, width, height, paddingX, paddingY);
  const baselineY = height - paddingY;
  const linePath = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${baselineY} L ${points[0].x} ${baselineY} Z`;
  const maxValue = Math.max(...data.map((item) => asNumber(item.value)), 1);
  const tickIndices = Array.from(new Set([0, Math.floor((data.length - 1) / 2), Math.max(data.length - 1, 0)]));

  return (
    <svg className={`monitoring-chart-svg ${colorClass}`.trim()} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Trend chart">
      {[0, 1, 2, 3].map((tick) => {
        const y = paddingY + ((height - paddingY * 2) * tick) / 3;
        return (
          <line
            key={tick}
            className="monitoring-grid-line"
            x1={paddingX}
            y1={y}
            x2={width - paddingX}
            y2={y}
          />
        );
      })}

      <path className="monitoring-line-area" d={areaPath} />
      <path className="monitoring-line-path" d={linePath} />

      {points.map((point) => (
        <circle key={`${point.label}-${point.x}`} className="monitoring-line-point" cx={point.x} cy={point.y} r="3.8" />
      ))}

      {tickIndices.map((index) => (
        <text
          key={index}
          className="monitoring-axis-text"
          x={points[index]?.x || paddingX}
          y={height - 4}
          textAnchor={index === 0 ? 'start' : index === tickIndices[tickIndices.length - 1] ? 'end' : 'middle'}
        >
          {data[index]?.label || ''}
        </text>
      ))}

      <text className="monitoring-axis-text strong" x={paddingX} y={16}>
        Peak {formatCount(maxValue)}
      </text>
    </svg>
  );
}

function VerticalBarChart({ data, emptyLabel }) {
  if (!data.length) return <ChartEmptyState label={emptyLabel} />;

  const width = 360;
  const height = 210;
  const paddingX = 28;
  const paddingY = 24;
  const maxValue = Math.max(...data.map((item) => asNumber(item.value)), 1);
  const usableWidth = width - paddingX * 2;
  const usableHeight = height - paddingY * 2;
  const gap = 12;
  const barWidth = Math.max((usableWidth - gap * (data.length - 1)) / Math.max(data.length, 1), 18);

  return (
    <svg className="monitoring-chart-svg monitoring-bars" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Bar chart">
      {[0, 1, 2, 3].map((tick) => {
        const y = paddingY + (usableHeight * tick) / 3;
        return (
          <line
            key={tick}
            className="monitoring-grid-line"
            x1={paddingX}
            y1={y}
            x2={width - paddingX}
            y2={y}
          />
        );
      })}

      {data.map((item, index) => {
        const value = Math.max(asNumber(item.value), 0);
        const barHeight = (value / maxValue) * usableHeight;
        const x = paddingX + index * (barWidth + gap);
        const y = height - paddingY - barHeight;
        return (
          <g key={item.label}>
            <rect
              className={`monitoring-bar ${item.highlight ? 'highlight' : ''}`.trim()}
              x={x}
              y={y}
              width={barWidth}
              height={Math.max(barHeight, 4)}
              rx="10"
            />
            <text className="monitoring-axis-text strong" x={x + barWidth / 2} y={y - 6} textAnchor="middle">
              {formatCount(value)}
            </text>
            <text className="monitoring-axis-text" x={x + barWidth / 2} y={height - 6} textAnchor="middle">
              {item.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function HistogramChart({ data, emptyLabel }) {
  if (!data.length || data.every((item) => asNumber(item.value) <= 0)) {
    return <ChartEmptyState label={emptyLabel} />;
  }

  const width = 360;
  const height = 210;
  const paddingX = 20;
  const paddingY = 24;
  const maxValue = Math.max(...data.map((item) => asNumber(item.value)), 1);
  const usableWidth = width - paddingX * 2;
  const usableHeight = height - paddingY * 2;
  const barWidth = usableWidth / Math.max(data.length, 1);

  return (
    <svg className="monitoring-chart-svg monitoring-histogram" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Histogram">
      {[0, 1, 2, 3].map((tick) => {
        const y = paddingY + (usableHeight * tick) / 3;
        return (
          <line
            key={tick}
            className="monitoring-grid-line"
            x1={paddingX}
            y1={y}
            x2={width - paddingX}
            y2={y}
          />
        );
      })}

      {data.map((item, index) => {
        const value = Math.max(asNumber(item.value), 0);
        const barHeight = (value / maxValue) * usableHeight;
        const x = paddingX + index * barWidth;
        const y = height - paddingY - barHeight;
        const label = index % 2 === 0 ? item.label : '';
        return (
          <g key={item.label}>
            <rect
              className="monitoring-hist-bar"
              x={x + 2}
              y={y}
              width={Math.max(barWidth - 4, 10)}
              height={Math.max(barHeight, 4)}
              rx="6"
            />
            {label ? (
              <text className="monitoring-axis-text" x={x + barWidth / 2} y={height - 6} textAnchor="middle">
                {label}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function OgiveChart({ data, emptyLabel }) {
  const total = data.reduce((sum, item) => sum + asNumber(item.value), 0);
  if (!data.length || !total) return <ChartEmptyState label={emptyLabel} />;

  let runningTotal = 0;
  const cumulativeRows = data.map((item) => {
    runningTotal += asNumber(item.value);
    return {
      label: item.label,
      value: (runningTotal / total) * 100
    };
  });

  const width = 360;
  const height = 210;
  const paddingX = 26;
  const paddingY = 24;
  const { points } = buildChartPoints(cumulativeRows, (item) => item.value, width, height, paddingX, paddingY, 100);
  const linePath = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');

  return (
    <svg className="monitoring-chart-svg monitoring-ogive" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Ogive chart">
      {[0, 1, 2, 3, 4].map((tick) => {
        const y = paddingY + ((height - paddingY * 2) * tick) / 4;
        return (
          <line
            key={tick}
            className="monitoring-grid-line"
            x1={paddingX}
            y1={y}
            x2={width - paddingX}
            y2={y}
          />
        );
      })}

      <path className="monitoring-ogive-path" d={linePath} />
      {points.map((point) => (
        <circle key={`${point.label}-${point.x}`} className="monitoring-ogive-point" cx={point.x} cy={point.y} r="3.5" />
      ))}

      {[0, Math.floor((cumulativeRows.length - 1) / 2), cumulativeRows.length - 1].filter((value, index, list) => list.indexOf(value) === index).map((index) => (
        <text
          key={index}
          className="monitoring-axis-text"
          x={points[index]?.x || paddingX}
          y={height - 6}
          textAnchor={index === 0 ? 'start' : index === cumulativeRows.length - 1 ? 'end' : 'middle'}
        >
          {cumulativeRows[index]?.label || ''}
        </text>
      ))}

      <text className="monitoring-axis-text strong" x={width - paddingX} y={18} textAnchor="end">
        100%
      </text>
    </svg>
  );
}

function DotPlotChart({ data, emptyLabel }) {
  if (!data.length) return <ChartEmptyState label={emptyLabel} />;

  const width = 360;
  const rowHeight = 38;
  const height = Math.max(120, 46 + data.length * rowHeight);
  const labelWidth = 118;
  const paddingRight = 24;
  const topPadding = 22;
  const bottomPadding = 20;
  const plotWidth = width - labelWidth - paddingRight;

  return (
    <svg className="monitoring-chart-svg monitoring-dotplot" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Dot plot">
      {[0, 25, 50, 75, 100].map((tick) => {
        const x = labelWidth + (plotWidth * tick) / 100;
        return (
          <g key={tick}>
            <line className="monitoring-grid-line" x1={x} y1={topPadding} x2={x} y2={height - bottomPadding} />
            <text className="monitoring-axis-text" x={x} y={height - 4} textAnchor="middle">
              {tick}%
            </text>
          </g>
        );
      })}

      {data.map((item, index) => {
        const y = topPadding + index * rowHeight + 16;
        const x = labelWidth + (plotWidth * Math.max(0, Math.min(asNumber(item.value), 100))) / 100;
        return (
          <g key={item.label}>
            <text className="monitoring-axis-text strong" x={0} y={y + 4}>
              {item.label}
            </text>
            <line className="monitoring-dot-guide" x1={labelWidth} y1={y} x2={labelWidth + plotWidth} y2={y} />
            <circle className={`monitoring-dot ${item.highlight ? 'highlight' : ''}`.trim()} cx={x} cy={y} r={item.highlight ? 7 : 5.5} />
            <text className="monitoring-axis-text" x={x + 10} y={y + 4}>
              {Math.round(asNumber(item.value))}%
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function DeveloperMonitoringPage() {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [syntheticStatus, setSyntheticStatus] = useState({ tone: '', message: '' });
  const [pendingSynthetic, setPendingSynthetic] = useState('');
  const [reviewActionStatus, setReviewActionStatus] = useState({ tone: '', message: '' });
  const [pendingReviewAction, setPendingReviewAction] = useState('');
  const [lastLoadedAt, setLastLoadedAt] = useState('');

  const apiBase = useMemo(() => resolveApiBaseUrl(), []);

  const loadOverview = useCallback(async ({ background = false } = {}) => {
    if (background) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError('');
    try {
      const res = await api.get('/ops/monitoring');
      setOverview(res.data || null);
      setLastLoadedAt(new Date().toISOString());
    } catch (err) {
      setError(buildMonitoringError(err, apiBase));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [apiBase]);

  useEffect(() => {
    loadOverview();
    const timer = setInterval(() => {
      loadOverview({ background: true });
    }, 30000);
    return () => clearInterval(timer);
  }, [loadOverview]);

  const metrics = overview?.metrics || {};
  const service = overview?.service || {};
  const endpoints = overview?.endpoints || {};
  const aiRuntime = overview?.aiRuntime || {};
  const reviewQueue = overview?.reviewQueue || {};
  const observability = overview?.observability || {};
  const policies = useMemo(
    () => (Array.isArray(overview?.alertPolicies) ? overview.alertPolicies : []),
    [overview]
  );

  const healthScore = useMemo(() => {
    if (!overview) return 0;
    const critical = policies.filter((item) => item.status === 'FIRING').length;
    const watch = policies.filter((item) => item.status === 'WATCH').length;
    return Math.max(0, 100 - critical * 35 - watch * 12);
  }, [overview, policies]);

  const currentProvider = aiRuntime.currentProvider || null;
  const observabilityTools = useMemo(
    () => (Array.isArray(observability.tools) ? observability.tools : []),
    [observability.tools]
  );
  const liveToolCount = observabilityTools.filter((tool) => ['live', 'connected'].includes(String(tool.status || '').toLowerCase())).length;
  const configuredProviderRows = useMemo(
    () => (Array.isArray(aiRuntime.providers) ? aiRuntime.providers : []),
    [aiRuntime.providers]
  );

  const hasAiTraffic = asNumber(metrics.ai?.requestsTotal) > 0;
  const aiErrorRate = toRatio(metrics.ai?.errorsTotal, metrics.ai?.requestsTotal);
  const aiSuccessRate = hasAiTraffic ? 1 - aiErrorRate : null;
  const productAreaRows = useMemo(() => {
    const areaAggregate = aggregateRows(
      Object.entries(metrics.http?.byRoute || {}).map(([routeLabel, value]) => ({
        label: classifyProductArea(routeLabel),
        value
      }))
    );
    return metricRowsFromObject(areaAggregate, null, 6);
  }, [metrics.http]);

  const aiModeRows = useMemo(
    () => metricRowsFromObject(metrics.ai?.byMode, humanizeModeLabel, 5),
    [metrics.ai]
  );
  const workflowRows = useMemo(
    () => metricRowsFromObject(metrics.graph?.byNode, humanizeWorkflowLabel, 6),
    [metrics.graph]
  );
  const toolRows = useMemo(
    () => metricRowsFromObject(metrics.tools?.byTool, (value) => titleCaseWords(value || ''), 6),
    [metrics.tools]
  );
  const memoryRows = useMemo(
    () => metricRowsFromObject(metrics.memory?.byOperation, humanizeMemoryLabel, 5),
    [metrics.memory]
  );
  const modelRows = useMemo(
    () => metricRowsFromObject(metrics.llm?.byModel, (rawLabel) => {
      const [providerId, ...modelParts] = String(rawLabel || '').split(':');
      return `${providerLabel(providerId)} | ${modelParts.join(':') || 'default model'}`;
    }, 5),
    [metrics.llm]
  );

  const providerBarRows = useMemo(
    () => configuredProviderRows
      .filter((provider) => provider.totalCalls > 0)
      .map((provider) => ({
        label: provider.label || providerLabel(provider.id),
        value: provider.totalCalls,
        highlight: Boolean(provider.isCurrent)
      })),
    [configuredProviderRows]
  );

  const providerReliabilityRows = useMemo(
    () => configuredProviderRows
      .filter((provider) => provider.totalCalls > 0)
      .map((provider) => ({
        label: provider.label || providerLabel(provider.id),
        value: (1 - asNumber(provider.errorRate || 0)) * 100,
        highlight: Boolean(provider.isCurrent)
      })),
    [configuredProviderRows]
  );

  const latencyHistogramRows = useMemo(
    () => (Array.isArray(metrics.ai?.latencyDistribution) ? metrics.ai.latencyDistribution : []).map((bucket) => ({
      label: bucket.label,
      value: bucket.count
    })),
    [metrics.ai]
  );
  const reviewPreview = useMemo(
    () => (Array.isArray(reviewQueue.preview) ? reviewQueue.preview : []),
    [reviewQueue.preview]
  );

  const trendRows = useMemo(() => {
    const samples = Array.isArray(metrics.history?.samples) ? metrics.history.samples.slice(-18) : [];
    return samples.map((sample, index) => {
      const previous = index > 0 ? samples[index - 1] : null;
      return {
        label: formatClockTime(sample.at),
        value: previous ? Math.max(asNumber(sample.aiRequestsTotal) - asNumber(previous.aiRequestsTotal), 0) : 0
      };
    }).filter((row, index, rows) => rows.length <= 1 || index > 0);
  }, [metrics.history]);

  const fallbackProviders = configuredProviderRows
    .filter((provider) => !provider.isCurrent)
    .map((provider) => provider.label || providerLabel(provider.id))
    .join(' -> ');

  const triggerSynthetic = async (kind) => {
    setPendingSynthetic(kind);
    setSyntheticStatus({
      tone: 'info',
      message: kind === 'sentry' ? 'Sending Sentry test issue...' : 'Emitting Datadog trace...'
    });

    try {
      const endpoint = kind === 'sentry' ? '/ops/sentry-test' : '/ops/datadog-test';
      const res = await api.post(endpoint, {});
      const message = res?.data?.message || (kind === 'sentry' ? 'Synthetic Sentry issue queued.' : 'Synthetic Datadog trace emitted.');
      setSyntheticStatus({
        tone: res?.data?.ok === false ? 'danger' : 'success',
        message
      });
      await loadOverview({ background: true });
    } catch (err) {
      setSyntheticStatus({
        tone: 'danger',
        message: buildMonitoringError(err, apiBase)
      });
    } finally {
      setPendingSynthetic('');
    }
  };

  const handleReviewDecision = async (task, decision) => {
    if (!task?.id) return;

    const label = decision === 'approve' ? 'Approving and executing review task...' : 'Rejecting review task...';
    setPendingReviewAction(`${decision}:${task.id}`);
    setReviewActionStatus({
      tone: 'info',
      message: label
    });

    try {
      if (decision === 'approve') {
        await api.post(`/ai/reviews/${task.id}/approve`, {});
        const exec = await api.post('/ai/execute', { reviewId: task.id });
        const message = exec?.data?.message || exec?.data?.msg || 'Review task approved and executed.';
        setReviewActionStatus({
          tone: exec?.data?.status === 'ERROR' ? 'danger' : 'success',
          message
        });
      } else {
        const res = await api.post(`/ai/reviews/${task.id}/reject`, {});
        setReviewActionStatus({
          tone: 'success',
          message: res?.data?.task?.summary || 'Review task rejected successfully.'
        });
      }

      await loadOverview({ background: true });
    } catch (err) {
      setReviewActionStatus({
        tone: 'danger',
        message: buildMonitoringError(err, apiBase)
      });
    } finally {
      setPendingReviewAction('');
    }
  };

  return (
    <main className="developer-monitoring-page">
      <section className="monitoring-hero">
        <div className="monitoring-topbar">
          <Link to="/developer/complaints" className="monitoring-back-link">Developer Portal</Link>
          <QuickPageMenu
            buttonLabel="Menu"
            buttonClassName="monitoring-menu-btn"
            panelClassName="monitoring-menu-panel"
            itemClassName="monitoring-menu-item"
            excludeKeys={['complaints', 'queries', 'feedback']}
            extraItems={[
              { key: 'developer-account', label: 'Developer Account', path: '/developer/account' },
              { key: 'developer-feedback', label: 'Feedback', path: '/developer/feedback' }
            ]}
          />
        </div>

        <div className="monitoring-hero-grid">
          <div>
            <p className="monitoring-kicker">AI Observability</p>
            <h1>AI Monitoring Dashboard</h1>
            <p className="monitoring-subtitle">
              Clean, presentation-ready visibility into the live AI engine, tool-calling workflow, human-review queue, monitoring stack, and trend charts for the booking assistant.
            </p>

            <div className="monitoring-meta-strip">
              <span>Snapshot: {formatTimestamp(overview?.generatedAt)}</span>
              <span>Last refresh: {formatRelativeTime(lastLoadedAt)}</span>
              <span>API base: {apiBase}</span>
              <span>Workflow: {humanizeOrchestration(aiRuntime.orchestration)}</span>
            </div>
          </div>

          <div className={`monitoring-score-card ${healthScore >= 90 ? 'healthy' : healthScore >= 60 ? 'watch' : 'critical'}`}>
            <span>Health Score</span>
            <strong>{loading && !overview ? '--' : healthScore}</strong>
            <p>{service.dbReady ? 'Database ready for live traffic' : 'Database needs attention'} | {service.env || 'development'}</p>
          </div>
        </div>
      </section>

      {error && (
        <div className="monitoring-banner danger">
          <strong>Monitoring data unavailable</strong>
          <p>{error}</p>
        </div>
      )}

      {syntheticStatus.message && (
        <div className={`monitoring-banner ${syntheticStatus.tone}`}>
          <strong>Observability action</strong>
          <p>{syntheticStatus.message}</p>
        </div>
      )}

      {reviewActionStatus.message && (
        <div className={`monitoring-banner ${reviewActionStatus.tone}`}>
          <strong>Review queue action</strong>
          <p>{reviewActionStatus.message}</p>
        </div>
      )}

      <section className="monitoring-actions">
        <button
          type="button"
          onClick={() => loadOverview({ background: Boolean(overview) })}
          disabled={loading || refreshing || Boolean(pendingSynthetic)}
        >
          {refreshing ? 'Refreshing...' : 'Refresh now'}
        </button>
        <a href={resolveBackendLink(endpoints.health || '/api/ops/health', apiBase)} target="_blank" rel="noreferrer">Health</a>
        <a href={resolveBackendLink(endpoints.ready || '/api/ops/ready', apiBase)} target="_blank" rel="noreferrer">Ready</a>
        <a href={resolveBackendLink(endpoints.metricsJson || '/api/ops/metrics', apiBase)} target="_blank" rel="noreferrer">Metrics JSON</a>
        <a href={resolveBackendLink(endpoints.metricsPrometheus || '/api/ops/metrics?format=prom', apiBase)} target="_blank" rel="noreferrer">Prometheus metrics</a>
      </section>

      <section className="monitoring-kpi-grid">
        <article className="monitoring-kpi-card spotlight">
          <span>Current AI engine</span>
          <strong>{currentProvider ? currentProvider.label || providerLabel(currentProvider.id) : 'Waiting for first AI call'}</strong>
          <p>
            {currentProvider
              ? `${currentProvider.model || 'default model'} | ${currentProvider.vendor || currentProvider.delivery || 'AI provider'}`
              : 'The dashboard will show the active provider after the next assistant response.'}
          </p>
        </article>

        <article className="monitoring-kpi-card">
          <span>Assistant success rate</span>
          <strong>{aiSuccessRate == null ? '--' : safePercent(aiSuccessRate)}</strong>
          <p>{hasAiTraffic ? `${formatCount(metrics.ai?.errorsTotal)} issues from ${formatCount(metrics.ai?.requestsTotal)} assistant requests.` : 'The success rate will appear after the assistant handles live traffic.'}</p>
        </article>

        <article className="monitoring-kpi-card">
          <span>Average response time</span>
          <strong>{formatDuration(metrics.ai?.avgDurationMs)}</strong>
          <p>Average end-to-end time for the assistant across chat and action handling.</p>
        </article>

        <article className="monitoring-kpi-card">
          <span>Monitoring coverage</span>
          <strong>{observabilityTools.length ? `${liveToolCount}/${observabilityTools.length}` : '--'}</strong>
          <p>{liveToolCount === observabilityTools.length && observabilityTools.length ? 'All connected tools are responding.' : 'Some tools still need setup or are offline.'}</p>
        </article>

        <article className="monitoring-kpi-card">
          <span>Tool calls</span>
          <strong>{formatCount(metrics.tools?.callsTotal)}</strong>
          <p>{formatCount(metrics.tools?.errorsTotal)} tool failures recorded across the agent runtime.</p>
        </article>

        <article className="monitoring-kpi-card">
          <span>Pending reviews</span>
          <strong>{formatCount(reviewQueue.pending)}</strong>
          <p>{reviewPreview.length ? 'Sensitive agent actions are waiting for human approval.' : 'No agent actions are waiting in the review queue.'}</p>
        </article>
      </section>

      <section className="monitoring-section">
        <div className="monitoring-section-head">
          <div>
            <p className="monitoring-kicker">Current Runtime</p>
            <h2>AI Provider Spotlight</h2>
          </div>
          <p className="monitoring-section-copy">
            This section focuses on the AI engine currently driving the assistant, including the active model, last successful provider, and the configured fallback path.
          </p>
        </div>

        <div className="monitoring-provider-spotlight">
          <article className="monitoring-card provider-highlight">
            <div className="monitoring-card-head">
              <span>Live engine</span>
              <strong>{currentProvider ? currentProvider.label || providerLabel(currentProvider.id) : 'No provider used yet'}</strong>
            </div>
            <div className="monitoring-provider-highlight-grid">
              <div>
                <span>Model</span>
                <strong>{currentProvider?.model || 'Waiting for first call'}</strong>
              </div>
              <div>
                <span>Last successful reply</span>
                <strong>{formatRelativeTime(currentProvider?.lastUsedAt)}</strong>
              </div>
              <div>
                <span>Total handled calls</span>
                <strong>{formatCount(currentProvider?.totalCalls)}</strong>
              </div>
              <div>
                <span>Fallback path</span>
                <strong>{fallbackProviders || 'No fallback provider configured'}</strong>
              </div>
            </div>
          </article>

          <div className="monitoring-provider-summary">
            {configuredProviderRows.map((provider) => (
              <article
                key={provider.id}
                className={`monitoring-provider-chip ${provider.isCurrent ? 'current' : ''}`.trim()}
              >
                <div>
                  <span>{provider.isCurrent ? 'Current engine' : `Fallback ${provider.preferredRank}`}</span>
                  <strong>{provider.label || providerLabel(provider.id)}</strong>
                </div>
                <p>{provider.model || 'default model'}</p>
                <small>
                  {provider.totalCalls > 0
                    ? `${formatCount(provider.totalCalls)} calls | ${safePercent(1 - asNumber(provider.errorRate || 0))} success`
                    : provider.configured
                      ? 'Configured and ready to take traffic if needed.'
                      : 'Not configured for this environment yet.'}
                </small>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="monitoring-section">
        <div className="monitoring-section-head">
          <div>
            <p className="monitoring-kicker">Monitoring Stack</p>
            <h2>Observability Tools</h2>
          </div>
          <p className="monitoring-section-copy">
            Clear status for each monitoring tool, with working links when available and setup guidance when a tool has not been connected yet.
          </p>
        </div>

        <div className="monitoring-tools-grid">
          {observabilityTools.map((tool) => {
            const tone = toolStateTone(tool.status);
            const isSyntheticTool = tool.id === 'sentry' || tool.id === 'datadog';
            const canTriggerSynthetic = isSyntheticTool && tone === 'healthy';
            const syntheticKind = tool.id === 'sentry' ? 'sentry' : 'datadog';

            return (
              <article key={tool.id} className={`monitoring-tool-card ${tone}`.trim()}>
                <div className="monitoring-tool-head">
                  <div>
                    <span>{toolStateLabel(tool.status)}</span>
                    <h3>{tool.name}</h3>
                  </div>
                  <b>{toolStateLabel(tool.status)}</b>
                </div>
                <p>{tool.summary}</p>
                <small>{tool.detail}</small>

                <div className="monitoring-tool-actions">
                  {tool.url && !isSyntheticTool ? (
                    <a href={tool.url} target="_blank" rel="noreferrer">{tool.actionLabel || `Open ${tool.name}`}</a>
                  ) : (
                    <button
                      type="button"
                      onClick={canTriggerSynthetic ? () => triggerSynthetic(syntheticKind) : undefined}
                      disabled={!canTriggerSynthetic || Boolean(pendingSynthetic)}
                    >
                      {tool.id === 'sentry'
                        ? pendingSynthetic === 'sentry'
                          ? 'Sending...'
                          : 'Send test issue'
                        : tool.id === 'datadog'
                          ? pendingSynthetic === 'datadog'
                            ? 'Tracing...'
                            : 'Send test trace'
                          : tool.actionLabel || 'Open'}
                    </button>
                  )}

                  {tool.url && isSyntheticTool ? (
                    <a href={tool.url} target="_blank" rel="noreferrer">Open dashboard</a>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="monitoring-section">
        <div className="monitoring-section-head">
          <div>
            <p className="monitoring-kicker">Visual Reports</p>
            <h2>Graphs and Trends</h2>
          </div>
          <p className="monitoring-section-copy">
            Multiple chart formats for quick demos and easier pattern spotting: trend lines, provider comparison bars, latency distributions, cumulative curves, and reliability dots.
          </p>
        </div>

        <div className="monitoring-chart-grid">
          <ChartCard
            typeLabel="Line graph"
            title="Assistant traffic trend"
            subtitle={`Assistant request volume sampled every ${Math.round(asNumber(metrics.history?.sampleIntervalMs) / 1000) || 30}s.`}
            footer="Shows how many assistant requests arrived during each recent monitoring window."
          >
            <LineTrendChart
              data={trendRows}
              emptyLabel="Trend data builds up as the backend stays online and collects more samples."
            />
          </ChartCard>

          <ChartCard
            typeLabel="Bar graph"
            title="Provider usage"
            subtitle="Which AI provider handled the most recent assistant traffic."
            footer="The highlighted bar marks the current active AI engine."
          >
            <VerticalBarChart
              data={providerBarRows}
              emptyLabel="Provider usage will appear after the assistant processes live requests."
            />
          </ChartCard>

          <ChartCard
            typeLabel="Histogram"
            title="AI response time distribution"
            subtitle="How assistant replies are spread across fast and slow latency bands."
            footer="More activity on the left means the assistant is staying fast."
          >
            <HistogramChart
              data={latencyHistogramRows}
              emptyLabel="Response-time distribution will appear after assistant traffic is recorded."
            />
          </ChartCard>

          <ChartCard
            typeLabel="Ogive"
            title="Cumulative response curve"
            subtitle="How quickly the total share of assistant replies finishes over time."
            footer="A curve that rises early means most replies are completing in the faster bands."
          >
            <OgiveChart
              data={latencyHistogramRows}
              emptyLabel="Cumulative timing data will appear once response-time distribution is available."
            />
          </ChartCard>

          <ChartCard
            typeLabel="Dot plot"
            title="Provider reliability"
            subtitle="Success score by provider, based on recorded assistant calls."
            footer="Dots farther to the right indicate higher successful completion rates."
          >
            <DotPlotChart
              data={providerReliabilityRows}
              emptyLabel="Reliability dots will appear after providers handle live assistant traffic."
            />
          </ChartCard>
        </div>
      </section>

      <section className="monitoring-grid">
        <article className="monitoring-card wide">
          <div className="monitoring-card-head">
            <span>Executive Summary</span>
            <strong>{loading && !overview ? 'Loading' : service.dbReady ? 'Ready' : 'Needs attention'}</strong>
          </div>
          <p>
            Backend uptime {formatCount(service.uptimeSeconds)}s. Snapshot generated {formatTimestamp(overview?.generatedAt)}.
          </p>
          <div className="monitoring-stat-grid">
            <div>
              <span>Total backend requests</span>
              <strong>{formatCount(metrics.http?.requestsTotal)}</strong>
            </div>
            <div>
              <span>Assistant requests</span>
              <strong>{formatCount(metrics.ai?.requestsTotal)}</strong>
            </div>
            <div>
              <span>Live AI requests</span>
              <strong>{formatCount(metrics.ai?.activeRequests)}</strong>
            </div>
            <div>
              <span>Average backend speed</span>
              <strong>{formatDuration(metrics.http?.avgDurationMs)}</strong>
            </div>
            <div>
              <span>Workflow steps run</span>
              <strong>{formatCount(metrics.graph?.nodeExecutionsTotal)}</strong>
            </div>
          </div>
        </article>

        <article className="monitoring-card">
          <div className="monitoring-card-head">
            <span>Assistant experiences</span>
            <strong>{formatCount(metrics.ai?.requestsTotal)}</strong>
          </div>
          <p>How people are using the assistant right now.</p>
          <div className="monitoring-mini-list">
            {renderFriendlyList(aiModeRows, 'No assistant traffic has been recorded yet.')}
          </div>
        </article>

        <article className="monitoring-card">
          <div className="monitoring-card-head">
            <span>Workflow stages</span>
            <strong>{formatCount(metrics.graph?.nodeExecutionsTotal)}</strong>
          </div>
          <p>Which parts of the assistant workflow are doing the most work.</p>
          <div className="monitoring-mini-list">
            {renderFriendlyList(workflowRows, 'No workflow stage activity recorded yet.')}
          </div>
        </article>

        <article className="monitoring-card">
          <div className="monitoring-card-head">
            <span>Tool usage</span>
            <strong>{formatCount(metrics.tools?.callsTotal)}</strong>
          </div>
          <p>Which registered tools the agent is calling most often.</p>
          <div className="monitoring-mini-list">
            {renderFriendlyList(toolRows, 'No tool usage recorded yet.')}
          </div>
        </article>

        <article className="monitoring-card">
          <div className="monitoring-card-head">
            <span>Product activity</span>
            <strong>{formatCount(productAreaRows.length)}</strong>
          </div>
          <p>The busiest user-facing parts of the platform from backend traffic.</p>
          <div className="monitoring-mini-list">
            {renderFriendlyList(productAreaRows, 'No backend traffic recorded yet.')}
          </div>
        </article>

        <article className="monitoring-card">
          <div className="monitoring-card-head">
            <span>Memory operations</span>
            <strong>{formatCount(metrics.memory?.operationsTotal)}</strong>
          </div>
          <p>Conversation memory saved and read by the assistant.</p>
          <div className="monitoring-mini-list">
            {renderFriendlyList(memoryRows, 'No memory operations recorded yet.')}
          </div>
        </article>

        <article className="monitoring-card">
          <div className="monitoring-card-head">
            <span>Model activity</span>
            <strong>{formatCount(metrics.llm?.callsTotal)}</strong>
          </div>
          <p>Which models were actually used by the assistant runtime.</p>
          <div className="monitoring-mini-list">
            {renderFriendlyList(modelRows, 'No model activity has been recorded yet.')}
          </div>
        </article>
      </section>

      <section className="monitoring-section">
        <div className="monitoring-section-head">
          <div>
            <p className="monitoring-kicker">Human In The Loop</p>
            <h2>Review Queue</h2>
          </div>
          <p className="monitoring-section-copy">
            Sensitive agent actions land here before execution, creating an auditable approval layer for Slack, WhatsApp, CRM, and high-impact booking workflows.
          </p>
        </div>

        <div className="monitoring-grid">
          {reviewPreview.length ? (
            reviewPreview.map((task) => {
              const actionKeyBase = task.id || task.actionType || 'review';
              const pendingApprove = pendingReviewAction === `approve:${task.id}`;
              const pendingReject = pendingReviewAction === `reject:${task.id}`;
              return (
                <article key={actionKeyBase} className="monitoring-card">
                  <div className="monitoring-card-head">
                    <span>{task.status || 'PENDING'}</span>
                    <strong>{task.title || task.actionType || 'Review task'}</strong>
                  </div>
                  <p>{task.summary || 'Pending agent action review.'}</p>
                  <div className="monitoring-mini-list">
                    <div>
                      <span>Action</span>
                      <b>{task.actionType || '--'}</b>
                    </div>
                    <div>
                      <span>Risk</span>
                      <b>{task.riskLevel || '--'}</b>
                    </div>
                    <div>
                      <span>Requested by</span>
                      <b>{task.requestedByRole || '--'}</b>
                    </div>
                    <div>
                      <span>Created</span>
                      <b>{formatRelativeTime(task.createdAt)}</b>
                    </div>
                  </div>
                  <div className="monitoring-tool-actions">
                    <button
                      type="button"
                      onClick={() => handleReviewDecision(task, 'approve')}
                      disabled={Boolean(pendingReviewAction)}
                    >
                      {pendingApprove ? 'Approving...' : 'Approve & execute'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReviewDecision(task, 'reject')}
                      disabled={Boolean(pendingReviewAction)}
                    >
                      {pendingReject ? 'Rejecting...' : 'Reject'}
                    </button>
                  </div>
                </article>
              );
            })
          ) : (
            <article className="monitoring-card wide">
              <div className="monitoring-card-head">
                <span>Queue status</span>
                <strong>Empty</strong>
              </div>
              <p>No sensitive agent actions are waiting for approval right now.</p>
            </article>
          )}
        </div>
      </section>

      <section className="monitoring-alert-section">
        <div className="monitoring-section-head">
          <div>
            <p className="monitoring-kicker">Guardrails</p>
            <h2>Alert Policies</h2>
          </div>
          <p className="monitoring-section-copy">
            Simple, easy-to-read guardrails for the live assistant: database readiness, assistant reliability, provider stability, workflow health, tool reliability, review backlog, and memory safety.
          </p>
        </div>

        <div className="monitoring-alert-grid">
          {policies.length ? (
            policies.map((policy) => (
              <article
                key={policy.id}
                className={`monitoring-alert ${policy.status === 'FIRING' ? 'critical' : policy.status === 'WATCH' ? 'watch' : 'healthy'}`}
              >
                <div>
                  <span>{statusLabel(policy)}</span>
                  <h3>{policy.name}</h3>
                </div>
                <p>{policy.condition}</p>
                <small>{policy.recommendation}</small>
              </article>
            ))
          ) : (
            <article className="monitoring-alert healthy monitoring-alert-empty">
              <div>
                <span>Healthy</span>
                <h3>No alert policies returned</h3>
              </div>
              <p>The backend did not return any alert policies in this snapshot.</p>
              <small>Refresh the page after the monitoring route is available.</small>
            </article>
          )}
        </div>
      </section>
    </main>
  );
}
