const mongoose = require('mongoose');

const CalendarPreferenceSchema = new mongoose.Schema(
  {
    ownerId: {
      type: String,
      required: true,
      trim: true
    },
    ownerType: {
      type: String,
      required: true,
      trim: true
    },
    themeMode: {
      type: String,
      enum: ['Light', 'Dark', 'Auto'],
      default: 'Light'
    }
  },
  { timestamps: true }
);

CalendarPreferenceSchema.index({ ownerId: 1, ownerType: 1 }, { unique: true });

module.exports = mongoose.model('CalendarPreference', CalendarPreferenceSchema);
