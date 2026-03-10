const mongoose = require('mongoose');

const NoticeSchema = new mongoose.Schema({
  title: { type: String, default: '' },
  subject: { type: String, default: '' },
  body: { type: String, default: '' },
  content: { type: String, default: '' },
  extracted: { type: String, default: '' }, // compatibility: short summary
  summary: { type: String, default: '' },
  source: {
    type: String,
    enum: ['ADMIN', 'EMAIL', 'SYSTEM'],
    default: 'ADMIN'
  },
  kind: {
    type: String,
    enum: ['GENERAL', 'HOLIDAY'],
    default: 'GENERAL'
  },
  holidayName: { type: String, default: '' },
  startDate: { type: String, default: '' }, // compatibility with older data
  endDate: { type: String, default: '' },   // compatibility with older data
  startDateTime: { type: Date, default: null },
  endDateTime: { type: Date, default: null },
  closureAllHalls: { type: Boolean, default: false },
  halls: { type: [String], default: [] }, // compatibility
  rooms: { type: [String], default: [] },
  emailMessageId: { type: String, default: '', index: true },
  emailFrom: { type: String, default: '' },
  parsedMeta: { type: mongoose.Schema.Types.Mixed, default: {} },
  publicStyle: {
    titleColor: { type: String, default: '' },
    descriptionColor: { type: String, default: '' },
    contentHtml: { type: String, default: '' },
    updatedAt: { type: Date, default: null },
    updatedBy: { type: String, default: '' }
  },
  postedBy: {
    id: { type: mongoose.Schema.Types.ObjectId, default: null },
    type: { type: String, default: '' },
    name: { type: String, default: '' }
  },
  isDeleted: { type: Boolean, default: false, index: true },
  deletedAt: { type: Date, default: null },
  deletedBy: {
    id: { type: mongoose.Schema.Types.ObjectId, default: null },
    type: { type: String, default: '' },
    name: { type: String, default: '' }
  }
}, { timestamps: true });

NoticeSchema.index({ createdAt: -1 });
NoticeSchema.index({ kind: 1, startDateTime: 1, endDateTime: 1 });
NoticeSchema.index({ isDeleted: 1, deletedAt: -1 });
NoticeSchema.index({ title: 'text', subject: 'text', body: 'text', content: 'text', summary: 'text', holidayName: 'text' });

module.exports = mongoose.model('Notice', NoticeSchema);
