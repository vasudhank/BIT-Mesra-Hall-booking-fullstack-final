'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('../config/mongoose');

const { syncSupportKnowledgeVectors } = require('../services/vectorKnowledgeSyncService');

const run = async () => {
  try {
    const summary = await syncSupportKnowledgeVectors({ force: true });
    console.log('Vector knowledge sync summary:', summary);
    process.exit(0);
  } catch (err) {
    console.error('Vector knowledge sync failed:', err?.message || err);
    process.exit(1);
  }
};

run();
