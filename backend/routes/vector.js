const express = require('express');
const { syncSupportKnowledgeVectors } = require('../services/vectorKnowledgeSyncService');
const { querySimilarVectors, DEFAULT_VECTOR_NAMESPACE, resolveVectorProvider } = require('../services/vectorStoreService');

const router = express.Router();

const getRole = (req) => String(req?.user?.type || '').toUpperCase();
const isTrusted = (req) => req.isAuthenticated && req.isAuthenticated() && ['ADMIN', 'DEVELOPER'].includes(getRole(req));

router.get('/status', async (req, res) => {
  return res.json({
    provider: resolveVectorProvider(),
    namespace: DEFAULT_VECTOR_NAMESPACE
  });
});

router.post('/sync', async (req, res) => {
  if (!isTrusted(req)) {
    return res.status(403).json({ error: 'Only admin/developer can trigger vector sync.' });
  }

  try {
    const summary = await syncSupportKnowledgeVectors({ force: true });
    return res.json({
      ok: true,
      summary
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message || 'Vector sync failed.'
    });
  }
});

router.post('/query', async (req, res) => {
  const query = String(req.body?.query || '').trim();
  if (!query) {
    return res.status(400).json({ error: 'query is required.' });
  }

  try {
    const hits = await querySimilarVectors({
      namespace: String(req.body?.namespace || DEFAULT_VECTOR_NAMESPACE),
      queryText: query,
      topK: Number(req.body?.topK || 5)
    });

    return res.json({
      ok: true,
      provider: resolveVectorProvider(),
      items: hits
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message || 'Vector query failed.'
    });
  }
});

module.exports = router;
