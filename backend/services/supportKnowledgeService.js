const FAQ = require('../models/faq');
const Notice = require('../models/notice');
const mongoose = require('mongoose');
const { querySimilarVectors, DEFAULT_VECTOR_NAMESPACE } = require('./vectorStoreService');

const KNOWLEDGE_CACHE_MS = Math.max(Number(process.env.AI_KNOWLEDGE_CACHE_MS || 90 * 1000), 10 * 1000);
const MAX_FAQ_SCAN = Math.max(Number(process.env.AI_KNOWLEDGE_MAX_FAQ_SCAN || 180), 30);
const MAX_NOTICE_SCAN = Math.max(Number(process.env.AI_KNOWLEDGE_MAX_NOTICE_SCAN || 120), 20);

const stopWords = new Set([
  'the', 'is', 'am', 'are', 'a', 'an', 'and', 'or', 'for', 'to', 'of', 'in', 'on',
  'with', 'from', 'by', 'at', 'it', 'this', 'that', 'as', 'be', 'can', 'please',
  'show', 'tell', 'what', 'how', 'when', 'where', 'who', 'which', 'do', 'does',
  'ki', 'ke', 'ka', 'ko', 'hai', 'ho', 'kya', 'aur', 'se', 'me', 'mein', 'mai',
  'aaj', 'kal'
]);

let cache = {
  loadedAt: 0,
  faqs: [],
  notices: []
};

const isMongoReady = () => Number(mongoose?.connection?.readyState || 0) === 1;

const normalize = (text) =>
  String(text || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tokenize = (text) =>
  normalize(text)
    .split(' ')
    .filter((token) => token && token.length > 1 && !stopWords.has(token));

const clip = (text, limit = 320) => {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  return clean.length > limit ? `${clean.slice(0, limit - 3)}...` : clean;
};

const overlapScore = (queryTokens, candidateText, weight = 1) => {
  if (!Array.isArray(queryTokens) || queryTokens.length === 0) return 0;
  const candidateTokens = tokenize(candidateText);
  if (candidateTokens.length === 0) return 0;

  const candidateSet = new Set(candidateTokens);
  let score = 0;

  for (const token of queryTokens) {
    if (!candidateSet.has(token)) continue;
    score += token.length >= 7 ? 2 * weight : weight;
  }

  return score;
};

const rankFaq = (queryTokens, faqs = []) =>
  (faqs || [])
    .map((faq) => {
      const questionScore = overlapScore(queryTokens, faq.question, 4);
      const answerScore = overlapScore(queryTokens, faq.answer, 1);
      const intentScore = overlapScore(queryTokens, faq.intentKey, 3);
      const frequencyBoost = Math.min(4, Math.floor(Number(faq.frequencyScore || 0) / 15));

      return {
        doc: faq,
        score: questionScore + answerScore + intentScore + frequencyBoost
      };
    })
    .sort((a, b) => b.score - a.score);

const rankNotice = (queryTokens, notices = []) =>
  (notices || [])
    .map((notice) => {
      const titleScore = overlapScore(queryTokens, `${notice.title} ${notice.subject} ${notice.holidayName}`, 3);
      const summaryScore = overlapScore(queryTokens, `${notice.summary} ${notice.extracted}`, 2);
      const contentScore = overlapScore(queryTokens, `${notice.body} ${notice.content}`, 1);

      const createdAt = notice.createdAt ? new Date(notice.createdAt).getTime() : 0;
      const ageDays = createdAt ? Math.floor((Date.now() - createdAt) / (24 * 60 * 60 * 1000)) : 9999;
      const recencyBoost = ageDays <= 7 ? 3 : ageDays <= 30 ? 2 : ageDays <= 90 ? 1 : 0;

      return {
        doc: notice,
        score: titleScore + summaryScore + contentScore + recencyBoost
      };
    })
    .sort((a, b) => b.score - a.score);

const loadKnowledgeCache = async () => {
  const now = Date.now();
  if (now - cache.loadedAt < KNOWLEDGE_CACHE_MS && cache.loadedAt > 0) {
    return cache;
  }

  // Avoid waiting on buffered Mongoose queries in test/offline environments.
  if (!isMongoReady()) {
    cache = { loadedAt: now, faqs: [], notices: [] };
    return cache;
  }

  const [faqs, notices] = await Promise.all([
    FAQ.find(
      { $or: [{ active: true }, { active: { $exists: false } }] },
      'question answer intentKey frequencyScore updatedAt'
    )
      .sort({ frequencyScore: -1, updatedAt: -1, createdAt: -1 })
      .limit(MAX_FAQ_SCAN)
      .lean(),
    Notice.find(
      { isDeleted: { $ne: true } },
      'title subject summary extracted body content holidayName kind startDate endDate startDateTime endDateTime closureAllHalls rooms createdAt'
    )
      .sort({ createdAt: -1 })
      .limit(MAX_NOTICE_SCAN)
      .lean()
  ]);

  cache = {
    loadedAt: now,
    faqs: Array.isArray(faqs) ? faqs : [],
    notices: Array.isArray(notices) ? notices : []
  };

  return cache;
};

const buildFaqContextLines = (rankedFaq = [], maxFaq = 4) => {
  const selected = rankedFaq
    .filter((item) => item.score > 0)
    .slice(0, Math.max(Number(maxFaq || 4), 0));

  if (selected.length === 0) return [];

  return selected.map((item, idx) => {
    const question = clip(item.doc?.question, 160);
    const answer = clip(item.doc?.answer, 320);
    return `${idx + 1}. Q: ${question}\n   A: ${answer}`;
  });
};

const formatNoticeDateRange = (notice) => {
  const startRaw = notice?.startDate || (notice?.startDateTime ? new Date(notice.startDateTime).toISOString().slice(0, 10) : '');
  const endRaw = notice?.endDate || (notice?.endDateTime ? new Date(notice.endDateTime).toISOString().slice(0, 10) : '');

  if (!startRaw && !endRaw) return '';
  if (startRaw && endRaw && startRaw !== endRaw) return `${startRaw} to ${endRaw}`;
  return startRaw || endRaw;
};

const buildNoticeContextLines = (rankedNotice = [], maxNotices = 3) => {
  const selected = rankedNotice
    .filter((item) => item.score > 0)
    .slice(0, Math.max(Number(maxNotices || 3), 0));

  if (selected.length === 0) return [];

  return selected.map((item, idx) => {
    const notice = item.doc || {};
    const title = clip(notice.title || notice.subject || 'Notice', 120);
    const summary = clip(notice.summary || notice.extracted || notice.body || notice.content, 260);
    const dateRange = formatNoticeDateRange(notice);
    const closureTag = notice.closureAllHalls ? ' | closure: all halls' : '';
    const dateTag = dateRange ? ` | date: ${dateRange}` : '';
    return `${idx + 1}. ${title}${dateTag}${closureTag}\n   ${summary}`;
  });
};

const buildVectorContextLines = (vectorHits = [], maxItems = 3) => {
  const selected = (Array.isArray(vectorHits) ? vectorHits : [])
    .filter((item) => Number(item.score || 0) > 0)
    .slice(0, Math.max(Number(maxItems || 3), 0));

  if (selected.length === 0) return [];

  return selected.map((item, idx) => {
    const score = Number(item.score || 0).toFixed(3);
    const text = clip(item.text || item.metadata?.text || '', 250);
    return `${idx + 1}. score=${score} | ${text}`;
  });
};

const getKnowledgeContextForPrompt = async ({
  query,
  maxFaq = 4,
  maxNotices = 3,
  maxVector = 3
} = {}) => {
  const rawQuery = String(query || '').trim();
  if (!rawQuery) {
    return {
      block: 'No retrieval query provided.',
      meta: { faqCount: 0, noticeCount: 0, source: 'none' }
    };
  }

  try {
    const corpus = await loadKnowledgeCache();
    const queryTokens = tokenize(rawQuery).slice(0, 40);

    const [vectorHits] = await Promise.all([
      querySimilarVectors({
        namespace: DEFAULT_VECTOR_NAMESPACE,
        queryText: rawQuery,
        topK: maxVector
      }).catch(() => [])
    ]);

    const faqLines = buildFaqContextLines(rankFaq(queryTokens, corpus.faqs), maxFaq);
    const noticeLines = buildNoticeContextLines(rankNotice(queryTokens, corpus.notices), maxNotices);
    const vectorLines = buildVectorContextLines(vectorHits, maxVector);

    const sections = [];
    if (faqLines.length > 0) {
      sections.push(`Relevant FAQ context:\n${faqLines.join('\n')}`);
    }
    if (noticeLines.length > 0) {
      sections.push(`Relevant notice context:\n${noticeLines.join('\n')}`);
    }
    if (vectorLines.length > 0) {
      sections.push(`Relevant vector context:\n${vectorLines.join('\n')}`);
    }

    if (sections.length === 0) {
      return {
        block: 'No high-confidence knowledge snippets found for this query.',
        meta: { faqCount: 0, noticeCount: 0, vectorCount: 0, source: 'empty' }
      };
    }

    return {
      block: sections.join('\n\n'),
      meta: {
        faqCount: faqLines.length,
        noticeCount: noticeLines.length,
        vectorCount: vectorLines.length,
        source: 'cache'
      }
    };
  } catch (err) {
    return {
      block: 'Knowledge retrieval unavailable for this request.',
      meta: { faqCount: 0, noticeCount: 0, vectorCount: 0, source: 'error' }
    };
  }
};

module.exports = {
  getKnowledgeContextForPrompt
};
