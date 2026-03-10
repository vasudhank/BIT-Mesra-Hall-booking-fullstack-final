const mongoose = require('mongoose');

const CalendarTaskSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 240 },
  description: { type: String, default: '', maxlength: 4000 },
  startDateTime: { type: Date, required: true },
  endDateTime: { type: Date, required: true },
  allDay: { type: Boolean, default: false },
  createdBy: {
    id: { type: mongoose.Schema.Types.ObjectId, default: null },
    type: { type: String, default: '' },
    name: { type: String, default: '' },
    email: { type: String, default: '' }
  }
}, { timestamps: true });

CalendarTaskSchema.index({ startDateTime: 1, endDateTime: 1 });
CalendarTaskSchema.index({ createdAt: -1 });

module.exports = mongoose.model('CalendarTask', CalendarTaskSchema);
