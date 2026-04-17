const fetch = require('node-fetch');

const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const OPENAI_EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
const LOCAL_EMBED_DIM = Math.max(Math.min(Number(process.env.LOCAL_EMBED_DIM || 256), 1536), 64);

const normalize = (text) =>
  String(text || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const hashString = (value) => {
  let hash = 2166136261;
  const text = String(value || '');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const normalizeVector = (vector) => {
  const norm = Math.sqrt((vector || []).reduce((sum, value) => sum + Number(value || 0) ** 2, 0));
  if (!norm) return vector.map(() => 0);
  return vector.map((value) => Number(value || 0) / norm);
};

const cosineSimilarity = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || b.length === 0) return 0;
  const size = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < size; i += 1) {
    dot += Number(a[i] || 0) * Number(b[i] || 0);
  }
  return dot;
};

const localEmbeddingOne = (text) => {
  const clean = normalize(text);
  const vector = new Array(LOCAL_EMBED_DIM).fill(0);
  if (!clean) return vector;

  const words = clean.split(' ').filter(Boolean);
  words.forEach((word, idx) => {
    const h1 = hashString(`${word}:${idx}`);
    const h2 = hashString(`${idx}:${word.length}`);
    const pos = h1 % LOCAL_EMBED_DIM;
    const alt = h2 % LOCAL_EMBED_DIM;
    vector[pos] += 1 + (word.length % 5) * 0.1;
    vector[alt] += 0.5;
  });

  return normalizeVector(vector);
};

const localEmbeddings = (texts = []) =>
  (texts || []).map((text) => ({
    vector: localEmbeddingOne(text),
    model: `local-hash-${LOCAL_EMBED_DIM}`,
    provider: 'local'
  }));

const callOpenAIEmbeddings = async (texts) => {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY missing for remote embeddings.');

  const response = await fetch(`${OPENAI_BASE_URL}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: OPENAI_EMBEDDING_MODEL,
      input: texts
    })
  });

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`OpenAI embeddings failed (${response.status}) ${details.slice(0, 200)}`);
  }

  const data = await response.json();
  const rows = Array.isArray(data?.data) ? data.data : [];
  if (rows.length !== texts.length) {
    throw new Error(`OpenAI embedding size mismatch. expected=${texts.length}, got=${rows.length}`);
  }

  return rows.map((item) => ({
    vector: normalizeVector(Array.isArray(item?.embedding) ? item.embedding : []),
    model: OPENAI_EMBEDDING_MODEL,
    provider: 'openai'
  }));
};

const embedTexts = async (texts = [], { preferRemote = true } = {}) => {
  const cleanTexts = (texts || []).map((item) => String(item || '').slice(0, 12000));
  if (cleanTexts.length === 0) return [];

  if (preferRemote && String(process.env.OPENAI_API_KEY || '').trim()) {
    try {
      return await callOpenAIEmbeddings(cleanTexts);
    } catch (err) {
      // Fall back to local deterministic embeddings for resilience.
    }
  }

  return localEmbeddings(cleanTexts);
};

const embedText = async (text, options = {}) => {
  const rows = await embedTexts([text], options);
  return rows[0] || { vector: localEmbeddingOne(text), model: `local-hash-${LOCAL_EMBED_DIM}`, provider: 'local' };
};

module.exports = {
  embedText,
  embedTexts,
  cosineSimilarity,
  normalizeVector
};
