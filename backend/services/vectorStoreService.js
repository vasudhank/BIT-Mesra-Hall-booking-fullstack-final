const fetch = require('node-fetch');
const mongoose = require('mongoose');
const VectorDocument = require('../models/vectorDocument');
const { embedText, embedTexts, cosineSimilarity } = require('./embeddingService');

const VECTOR_PROVIDER_ENV = String(process.env.VECTOR_DB_PROVIDER || 'local').trim().toLowerCase();
const LOCAL_SCAN_LIMIT = Math.max(Number(process.env.VECTOR_LOCAL_SCAN_LIMIT || 1800), 200);
const DEFAULT_NAMESPACE = process.env.VECTOR_DEFAULT_NAMESPACE || 'support_knowledge';

const pineconeConfig = {
  apiKey: String(process.env.PINECONE_API_KEY || '').trim(),
  indexUrl: String(process.env.PINECONE_INDEX_URL || '').trim()
};

const weaviateConfig = {
  apiKey: String(process.env.WEAVIATE_API_KEY || '').trim(),
  baseUrl: String(process.env.WEAVIATE_URL || '').trim().replace(/\/+$/, ''),
  className: String(process.env.WEAVIATE_CLASS || 'SupportChunk').trim()
};

const isMongoReady = () => Number(mongoose?.connection?.readyState || 0) === 1;

const resolveProvider = () => {
  if (VECTOR_PROVIDER_ENV === 'pinecone' && pineconeConfig.apiKey && pineconeConfig.indexUrl) return 'pinecone';
  if (VECTOR_PROVIDER_ENV === 'weaviate' && weaviateConfig.baseUrl) return 'weaviate';
  return 'local';
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

  const response = await fetch(`${pineconeConfig.indexUrl.replace(/\/+$/, '')}/vectors/upsert`, {
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
  const response = await fetch(`${pineconeConfig.indexUrl.replace(/\/+$/, '')}/query`, {
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

const upsertWeaviate = async ({ namespace, documents }) => {
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

const upsertVectorDocuments = async ({ namespace = DEFAULT_NAMESPACE, documents = [] } = {}) => {
  const normalizedNamespace = sanitizeNamespace(namespace);
  const normalizedDocs = normalizeDocuments(documents);
  if (normalizedDocs.length === 0) return { provider: resolveProvider(), upserted: 0, skipped: 0 };

  const provider = resolveProvider();
  if (provider === 'pinecone') {
    return upsertPinecone({ namespace: normalizedNamespace, documents: normalizedDocs });
  }
  if (provider === 'weaviate') {
    return upsertWeaviate({ namespace: normalizedNamespace, documents: normalizedDocs });
  }
  return upsertLocal({ namespace: normalizedNamespace, documents: normalizedDocs });
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
  if (provider === 'pinecone') {
    return queryPinecone({ namespace: normalizedNamespace, queryText: cleanQuery, topK: size });
  }
  if (provider === 'weaviate') {
    return queryWeaviate({ namespace: normalizedNamespace, queryText: cleanQuery, topK: size });
  }
  return queryLocal({ namespace: normalizedNamespace, queryText: cleanQuery, topK: size });
};

module.exports = {
  upsertVectorDocuments,
  querySimilarVectors,
  resolveVectorProvider: resolveProvider,
  DEFAULT_VECTOR_NAMESPACE: DEFAULT_NAMESPACE
};
