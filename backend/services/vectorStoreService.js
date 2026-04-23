const fetch = require('node-fetch');
const mongoose = require('mongoose');
const VectorDocument = require('../models/vectorDocument');
const { embedText, embedTexts, cosineSimilarity } = require('./embeddingService');
const { hasOpenAIApiKeyConfigured } = require('./openaiKeyPoolService');

const VECTOR_PROVIDER_ENV = String(process.env.VECTOR_DB_PROVIDER || 'local').trim().toLowerCase();
const LOCAL_SCAN_LIMIT = Math.max(Number(process.env.VECTOR_LOCAL_SCAN_LIMIT || 1800), 200);
const DEFAULT_NAMESPACE = process.env.VECTOR_DEFAULT_NAMESPACE || 'support_knowledge';
const VECTOR_PROBE_TIMEOUT_MS = Math.max(Number(process.env.VECTOR_PROBE_TIMEOUT_MS || 5000), 1500);
const VECTOR_STATUS_CACHE_MS = Math.max(Number(process.env.VECTOR_STATUS_CACHE_MS || 30000), 3000);

const pineconeConfig = {
  apiKey: String(process.env.PINECONE_API_KEY || '').trim(),
  indexUrl: String(process.env.PINECONE_INDEX_URL || '').trim().replace(/\/+$/, '')
};

const weaviateConfig = {
  apiKey: String(process.env.WEAVIATE_API_KEY || '').trim(),
  baseUrl: String(process.env.WEAVIATE_URL || '').trim().replace(/\/+$/, ''),
  className: String(process.env.WEAVIATE_CLASS || 'SupportChunk').trim()
};

const isMongoReady = () => Number(mongoose?.connection?.readyState || 0) === 1;
const nowIso = () => new Date().toISOString();

const resolveProvider = () => {
  if (VECTOR_PROVIDER_ENV === 'pinecone' && pineconeConfig.apiKey && pineconeConfig.indexUrl) return 'pinecone';
  if (VECTOR_PROVIDER_ENV === 'weaviate' && weaviateConfig.baseUrl) return 'weaviate';
  return 'local';
};

const isRemoteProvider = (provider) => provider === 'pinecone' || provider === 'weaviate';
const resolveEmbeddingProvider = () =>
  hasOpenAIApiKeyConfigured() ? 'openai' : 'local';

const providerIsConfigured = (provider) => {
  if (provider === 'pinecone') {
    return Boolean(pineconeConfig.apiKey && pineconeConfig.indexUrl);
  }
  if (provider === 'weaviate') {
    return Boolean(weaviateConfig.baseUrl);
  }
  return true;
};

const resolveDeploymentMode = (provider) => {
  if (provider === 'pinecone') return 'managed_remote';
  if (provider === 'weaviate') return 'remote_or_self_hosted';
  return 'embedded_local';
};

const sanitizeNamespace = (namespaceLike) =>
  String(namespaceLike || DEFAULT_NAMESPACE)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]/g, '_')
    .slice(0, 120) || DEFAULT_NAMESPACE;

const sanitizeId = (idLike) =>
  String(idLike || '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_.:-]/g, '_')
    .slice(0, 180);

const buildMetadata = (metadataLike = {}, text = '') => {
  const base = metadataLike && typeof metadataLike === 'object' ? metadataLike : {};
  return {
    ...base,
    text: String(text || '').slice(0, 6000)
  };
};

const safeUrlPreview = (value = '') => {
  const raw = String(value || '').trim();
  if (!raw) return '';

  try {
    const parsed = new URL(raw);
    return `${parsed.protocol}//${parsed.host}`;
  } catch (err) {
    return raw.replace(/\/+$/, '');
  }
};

let runtimeCache = {
  checkedAt: null,
  lastSuccessAt: null,
  connected: false,
  live: false,
  health: 'unknown',
  detail: '',
  stats: {}
};

const buildProviderConfigSummary = (provider) => {
  if (provider === 'pinecone') {
    return {
      endpoint: safeUrlPreview(pineconeConfig.indexUrl),
      apiKeyConfigured: Boolean(pineconeConfig.apiKey),
      remoteManaged: true
    };
  }

  if (provider === 'weaviate') {
    return {
      endpoint: safeUrlPreview(weaviateConfig.baseUrl),
      className: weaviateConfig.className,
      apiKeyConfigured: Boolean(weaviateConfig.apiKey),
      remoteManaged: false
    };
  }

  return {
    endpoint: 'mongodb',
    mongoReady: isMongoReady(),
    remoteManaged: false
  };
};

const buildDefaultStatus = () => {
  const provider = resolveProvider();
  const configured = providerIsConfigured(provider);
  const connected = provider === 'local' ? isMongoReady() : false;
  const live = provider === 'local' ? connected : false;
  const health = provider === 'local'
    ? (connected ? 'live' : 'degraded')
    : (configured ? 'degraded' : 'setup_required');

  return {
    provider,
    namespace: DEFAULT_NAMESPACE,
    configured,
    remote: isRemoteProvider(provider),
    deployment: resolveDeploymentMode(provider),
    embeddingProvider: resolveEmbeddingProvider(),
    connected,
    live,
    health,
    checkedAt: runtimeCache.checkedAt,
    lastSuccessAt: runtimeCache.lastSuccessAt,
    detail: provider === 'local'
      ? (connected
        ? 'Mongo-backed local vector store is ready.'
        : 'Mongo-backed local vector store is waiting for MongoDB.')
      : configured
        ? 'Remote vector store is configured and waiting for a live probe.'
        : 'Remote vector store credentials are not configured.',
    config: buildProviderConfigSummary(provider),
    stats: runtimeCache.stats || {}
  };
};

const updateRuntimeCache = (overrides = {}) => {
  runtimeCache = {
    ...runtimeCache,
    ...overrides
  };
  return getCachedVectorStoreRuntimeStatus();
};

const getCachedVectorStoreRuntimeStatus = () => ({
  ...buildDefaultStatus(),
  ...runtimeCache,
  provider: resolveProvider(),
  namespace: DEFAULT_NAMESPACE,
  configured: providerIsConfigured(resolveProvider()),
  remote: isRemoteProvider(resolveProvider()),
  deployment: resolveDeploymentMode(resolveProvider()),
  embeddingProvider: resolveEmbeddingProvider(),
  config: buildProviderConfigSummary(resolveProvider())
});

const withTimeout = async (url, options = {}, timeoutMs = VECTOR_PROBE_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const parseJsonSafely = async (response) => {
  try {
    return await response.json();
  } catch (err) {
    return null;
  }
};

const executeVectorOperation = async (provider, action, work) => {
  try {
    const result = await work();
    const successAt = nowIso();
    updateRuntimeCache({
      checkedAt: successAt,
      lastSuccessAt: successAt,
      connected: provider === 'local' ? isMongoReady() : true,
      live: provider === 'local' ? isMongoReady() : true,
      health: provider === 'local'
        ? (isMongoReady() ? 'live' : 'degraded')
        : 'live',
      detail: `${provider.toUpperCase()} ${action} completed successfully.`
    });
    return result;
  } catch (err) {
    updateRuntimeCache({
      checkedAt: nowIso(),
      connected: provider === 'local' ? isMongoReady() : false,
      live: false,
      health: providerIsConfigured(provider) ? 'degraded' : 'setup_required',
      detail: `${provider.toUpperCase()} ${action} failed: ${err.message || err}`
    });
    throw err;
  }
};

const upsertLocal = async ({ namespace, documents }) => {
  if (!isMongoReady()) return { provider: 'local', upserted: 0, skipped: documents.length };

  const embeddings = await embedTexts(documents.map((item) => item.text));
  const operations = [];

  documents.forEach((doc, idx) => {
    const embedded = embeddings[idx] || {};
    operations.push({
      updateOne: {
        filter: { namespace, externalId: doc.id },
        update: {
          $set: {
            text: doc.text,
            metadata: buildMetadata(doc.metadata, doc.text),
            embedding: Array.isArray(embedded.vector) ? embedded.vector : [],
            embeddingModel: embedded.model || '',
            provider: embedded.provider || 'local'
          }
        },
        upsert: true
      }
    });
  });

  if (operations.length === 0) {
    return { provider: 'local', upserted: 0, skipped: 0 };
  }

  const result = await VectorDocument.bulkWrite(operations, { ordered: false });
  const upserted = Number(result?.upsertedCount || 0) + Number(result?.modifiedCount || 0);
  return { provider: 'local', upserted, skipped: 0 };
};

const queryLocal = async ({ namespace, queryText, topK }) => {
  if (!isMongoReady()) return [];

  const queryEmbedding = await embedText(queryText);
  const docs = await VectorDocument.find({ namespace }, 'externalId text metadata embedding updatedAt')
    .sort({ updatedAt: -1 })
    .limit(LOCAL_SCAN_LIMIT)
    .lean();

  const scored = docs
    .map((doc) => ({
      id: doc.externalId,
      score: cosineSimilarity(queryEmbedding.vector, Array.isArray(doc.embedding) ? doc.embedding : []),
      text: doc.text || '',
      metadata: doc.metadata || {}
    }))
    .filter((row) => Number.isFinite(row.score) && row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored;
};

const upsertPinecone = async ({ namespace, documents }) => {
  const embeddings = await embedTexts(documents.map((item) => item.text));
  const vectors = documents.map((doc, idx) => {
    const embedded = embeddings[idx] || {};
    return {
      id: doc.id,
      values: embedded.vector || [],
      metadata: buildMetadata(doc.metadata, doc.text)
    };
  });

  const response = await fetch(`${pineconeConfig.indexUrl}/vectors/upsert`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Api-Key': pineconeConfig.apiKey
    },
    body: JSON.stringify({
      namespace,
      vectors
    })
  });

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`Pinecone upsert failed (${response.status}) ${details.slice(0, 200)}`);
  }

  return { provider: 'pinecone', upserted: vectors.length, skipped: 0 };
};

const queryPinecone = async ({ namespace, queryText, topK }) => {
  const queryEmbedding = await embedText(queryText);
  const response = await fetch(`${pineconeConfig.indexUrl}/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Api-Key': pineconeConfig.apiKey
    },
    body: JSON.stringify({
      namespace,
      topK,
      includeMetadata: true,
      includeValues: false,
      vector: queryEmbedding.vector
    })
  });

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`Pinecone query failed (${response.status}) ${details.slice(0, 200)}`);
  }

  const data = await response.json();
  const matches = Array.isArray(data?.matches) ? data.matches : [];
  return matches.map((item) => ({
    id: String(item?.id || ''),
    score: Number(item?.score || 0),
    text: String(item?.metadata?.text || ''),
    metadata: item?.metadata || {}
  }));
};

const weaviateHeaders = () => {
  const headers = { 'Content-Type': 'application/json' };
  if (weaviateConfig.apiKey) {
    headers.Authorization = `Bearer ${weaviateConfig.apiKey}`;
  }
  return headers;
};

const ensureWeaviateClass = async () => {
  const schemaUrl = `${weaviateConfig.baseUrl}/v1/schema/${encodeURIComponent(weaviateConfig.className)}`;
  const existing = await fetch(schemaUrl, {
    method: 'GET',
    headers: weaviateHeaders()
  });

  if (existing.ok) return { created: false };
  if (existing.status !== 404) {
    const details = await existing.text().catch(() => '');
    throw new Error(`Weaviate schema check failed (${existing.status}) ${details.slice(0, 200)}`);
  }

  const response = await fetch(`${weaviateConfig.baseUrl}/v1/schema`, {
    method: 'POST',
    headers: weaviateHeaders(),
    body: JSON.stringify({
      class: weaviateConfig.className,
      description: 'BIT Booking support knowledge vectors',
      vectorizer: 'none',
      properties: [
        { name: 'namespace', dataType: ['text'] },
        { name: 'externalId', dataType: ['text'] },
        { name: 'text', dataType: ['text'] },
        { name: 'metadata', dataType: ['text'] }
      ]
    })
  });

  if (!response.ok && response.status !== 422) {
    const details = await response.text().catch(() => '');
    throw new Error(`Weaviate schema create failed (${response.status}) ${details.slice(0, 200)}`);
  }

  return { created: response.ok };
};

const upsertWeaviate = async ({ namespace, documents }) => {
  await ensureWeaviateClass();
  const embeddings = await embedTexts(documents.map((item) => item.text));

  for (let i = 0; i < documents.length; i += 1) {
    const doc = documents[i];
    const embedded = embeddings[i] || {};
    const response = await fetch(`${weaviateConfig.baseUrl}/v1/objects`, {
      method: 'POST',
      headers: weaviateHeaders(),
      body: JSON.stringify({
        class: weaviateConfig.className,
        id: doc.id,
        vector: embedded.vector || [],
        properties: {
          namespace,
          externalId: doc.id,
          text: doc.text,
          metadata: JSON.stringify(buildMetadata(doc.metadata, doc.text))
        }
      })
    });

    if (!response.ok && response.status !== 422) {
      const details = await response.text().catch(() => '');
      throw new Error(`Weaviate upsert failed (${response.status}) ${details.slice(0, 200)}`);
    }
  }

  return { provider: 'weaviate', upserted: documents.length, skipped: 0 };
};

const queryWeaviate = async ({ namespace, queryText, topK }) => {
  const queryEmbedding = await embedText(queryText);

  const graphQlQuery = {
    query: `{
      Get {
        ${weaviateConfig.className}(
          limit: ${Math.max(Number(topK) || 5, 1)}
          where: { path: ["namespace"], operator: Equal, valueText: "${namespace}" }
          nearVector: { vector: [${(queryEmbedding.vector || []).join(',')}] }
        ) {
          externalId
          text
          metadata
          _additional { id distance }
        }
      }
    }`
  };

  const response = await fetch(`${weaviateConfig.baseUrl}/v1/graphql`, {
    method: 'POST',
    headers: weaviateHeaders(),
    body: JSON.stringify(graphQlQuery)
  });

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`Weaviate query failed (${response.status}) ${details.slice(0, 200)}`);
  }

  const data = await response.json();
  const rows = data?.data?.Get?.[weaviateConfig.className] || [];
  return rows.map((row) => {
    let parsedMetadata = {};
    try {
      parsedMetadata = row?.metadata ? JSON.parse(row.metadata) : {};
    } catch (err) {
      parsedMetadata = {};
    }
    return {
      id: String(row?.externalId || row?._additional?.id || ''),
      score: 1 - Number(row?._additional?.distance || 0),
      text: String(row?.text || ''),
      metadata: parsedMetadata
    };
  });
};

const normalizeDocuments = (documents = []) =>
  (Array.isArray(documents) ? documents : [])
    .map((doc, idx) => {
      const id = sanitizeId(doc?.id || `doc_${idx + 1}_${Date.now()}`);
      const text = String(doc?.text || '').trim().slice(0, 12000);
      if (!id || !text) return null;
      return {
        id,
        text,
        metadata: doc?.metadata && typeof doc.metadata === 'object' ? doc.metadata : {}
      };
    })
    .filter(Boolean);

const probeLocalProvider = async () => {
  const connected = isMongoReady();
  const docCount = connected
    ? await VectorDocument.countDocuments({ namespace: DEFAULT_NAMESPACE }).catch(() => 0)
    : 0;
  const checkedAt = nowIso();

  return updateRuntimeCache({
    checkedAt,
    lastSuccessAt: connected ? checkedAt : runtimeCache.lastSuccessAt,
    connected,
    live: connected,
    health: connected ? 'live' : 'degraded',
    detail: connected
      ? 'Mongo-backed local vector store is serving live reads and writes.'
      : 'Mongo-backed local vector store is unavailable because MongoDB is not connected.',
    stats: {
      namespaceDocumentCount: Number(docCount || 0)
    }
  });
};

const describePineconeIndexStats = async () => {
  const methods = ['POST', 'GET'];

  for (const method of methods) {
    const response = await withTimeout(
      `${pineconeConfig.indexUrl}/describe_index_stats`,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Api-Key': pineconeConfig.apiKey
        },
        body: method === 'POST' ? JSON.stringify({}) : undefined
      }
    );

    if (response.ok) {
      return parseJsonSafely(response);
    }

    if (response.status !== 404 && response.status !== 405) {
      const details = await response.text().catch(() => '');
      throw new Error(`Pinecone probe failed (${response.status}) ${details.slice(0, 200)}`);
    }
  }

  throw new Error('Pinecone describe_index_stats endpoint was not available.');
};

const probePineconeProvider = async () => {
  const checkedAt = nowIso();
  if (!providerIsConfigured('pinecone')) {
    return updateRuntimeCache({
      checkedAt,
      connected: false,
      live: false,
      health: 'setup_required',
      detail: 'Set PINECONE_API_KEY and PINECONE_INDEX_URL to enable the live Pinecone deployment.',
      stats: {}
    });
  }

  const stats = await describePineconeIndexStats();
  const namespaces = stats?.namespaces && typeof stats.namespaces === 'object'
    ? Object.keys(stats.namespaces)
    : [];

  return updateRuntimeCache({
    checkedAt,
    lastSuccessAt: checkedAt,
    connected: true,
    live: true,
    health: 'live',
    detail: 'Managed Pinecone index is connected and ready for live retrieval.',
    stats: {
      totalVectorCount: Number(stats?.totalVectorCount || stats?.total_vector_count || 0),
      namespaceCount: namespaces.length,
      namespaces: namespaces.slice(0, 10)
    }
  });
};

const probeWeaviateProvider = async () => {
  const checkedAt = nowIso();
  if (!providerIsConfigured('weaviate')) {
    return updateRuntimeCache({
      checkedAt,
      connected: false,
      live: false,
      health: 'setup_required',
      detail: 'Set WEAVIATE_URL to enable the live Weaviate deployment.',
      stats: {}
    });
  }

  const readyResponse = await withTimeout(`${weaviateConfig.baseUrl}/v1/.well-known/ready`, {
    method: 'GET',
    headers: weaviateHeaders()
  });

  if (!readyResponse.ok) {
    const details = await readyResponse.text().catch(() => '');
    throw new Error(`Weaviate readiness probe failed (${readyResponse.status}) ${details.slice(0, 200)}`);
  }

  const schemaResponse = await withTimeout(
    `${weaviateConfig.baseUrl}/v1/schema/${encodeURIComponent(weaviateConfig.className)}`,
    {
      method: 'GET',
      headers: weaviateHeaders()
    }
  );

  if (schemaResponse.ok) {
    return updateRuntimeCache({
      checkedAt,
      lastSuccessAt: checkedAt,
      connected: true,
      live: true,
      health: 'live',
      detail: 'Weaviate cluster is connected and the vector class is ready for live retrieval.',
      stats: {
        classReady: true,
        className: weaviateConfig.className
      }
    });
  }

  if (schemaResponse.status === 404) {
    return updateRuntimeCache({
      checkedAt,
      connected: true,
      live: false,
      health: 'degraded',
      detail: 'Weaviate is reachable, but the vector class has not been created yet. The next vector sync will create it automatically.',
      stats: {
        classReady: false,
        className: weaviateConfig.className
      }
    });
  }

  const details = await schemaResponse.text().catch(() => '');
  throw new Error(`Weaviate schema probe failed (${schemaResponse.status}) ${details.slice(0, 200)}`);
};

const getVectorStoreRuntimeStatus = async ({ force = false } = {}) => {
  const checkedAtMs = runtimeCache.checkedAt ? new Date(runtimeCache.checkedAt).getTime() : 0;
  if (!force && checkedAtMs && Date.now() - checkedAtMs < VECTOR_STATUS_CACHE_MS) {
    return getCachedVectorStoreRuntimeStatus();
  }

  const provider = resolveProvider();
  if (provider === 'pinecone') return probePineconeProvider();
  if (provider === 'weaviate') return probeWeaviateProvider();
  return probeLocalProvider();
};

const upsertVectorDocuments = async ({ namespace = DEFAULT_NAMESPACE, documents = [] } = {}) => {
  const normalizedNamespace = sanitizeNamespace(namespace);
  const normalizedDocs = normalizeDocuments(documents);
  const provider = resolveProvider();

  if (normalizedDocs.length === 0) {
    return { provider, upserted: 0, skipped: 0 };
  }

  return executeVectorOperation(provider, 'upsert', async () => {
    if (provider === 'pinecone') {
      return upsertPinecone({ namespace: normalizedNamespace, documents: normalizedDocs });
    }
    if (provider === 'weaviate') {
      return upsertWeaviate({ namespace: normalizedNamespace, documents: normalizedDocs });
    }
    return upsertLocal({ namespace: normalizedNamespace, documents: normalizedDocs });
  });
};

const querySimilarVectors = async ({
  namespace = DEFAULT_NAMESPACE,
  queryText = '',
  topK = 5
} = {}) => {
  const normalizedNamespace = sanitizeNamespace(namespace);
  const cleanQuery = String(queryText || '').trim();
  if (!cleanQuery) return [];
  const size = Math.max(Math.min(Number(topK) || 5, 20), 1);
  const provider = resolveProvider();

  return executeVectorOperation(provider, 'query', async () => {
    if (provider === 'pinecone') {
      return queryPinecone({ namespace: normalizedNamespace, queryText: cleanQuery, topK: size });
    }
    if (provider === 'weaviate') {
      return queryWeaviate({ namespace: normalizedNamespace, queryText: cleanQuery, topK: size });
    }
    return queryLocal({ namespace: normalizedNamespace, queryText: cleanQuery, topK: size });
  });
};

module.exports = {
  upsertVectorDocuments,
  querySimilarVectors,
  getVectorStoreRuntimeStatus,
  getCachedVectorStoreRuntimeStatus,
  resolveVectorProvider: resolveProvider,
  DEFAULT_VECTOR_NAMESPACE: DEFAULT_NAMESPACE
};
