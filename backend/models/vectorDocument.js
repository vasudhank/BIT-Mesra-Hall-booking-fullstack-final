const mongoose = require('mongoose');

const vectorDocumentSchema = new mongoose.Schema(
  {
    namespace: { type: String, required: true, index: true },
    externalId: { type: String, required: true },
    text: { type: String, default: '' },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    embedding: { type: [Number], default: [] },
    embeddingModel: { type: String, default: '' },
    provider: { type: String, default: 'local' }
  },
  { timestamps: true }
);

vectorDocumentSchema.index({ namespace: 1, externalId: 1 }, { unique: true });
vectorDocumentSchema.index({ namespace: 1, updatedAt: -1 });

module.exports = mongoose.model('VectorDocument', vectorDocumentSchema);
