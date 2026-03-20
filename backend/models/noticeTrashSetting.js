const mongoose = require('mongoose');

const NoticeTrashSettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: 'default' },
    retentionDays: { type: Number, default: 30, min: 1, max: 365 },
    updatedBy: { type: String, default: '' }
  },
  { timestamps: true }
);

NoticeTrashSettingSchema.index({ key: 1 }, { unique: true });

module.exports = mongoose.model('NoticeTrashSetting', NoticeTrashSettingSchema);
