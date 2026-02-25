const Booking_Requests = require('../models/booking_requests');
const Hall = require('../models/hall');

let cleanupInProgress = false;
let lastCleanupAt = 0;

const MIN_CLEANUP_INTERVAL_MS = 30 * 1000;
const DEFAULT_SCHEDULE_INTERVAL_MS = 60 * 1000;

const cleanupExpiredBookings = async (cutoff) => {
  const halls = await Hall.find({ 'bookings.endDateTime': { $lte: cutoff } });
  let hallsTouched = 0;
  let removedBookings = 0;

  for (const hall of halls) {
    const before = hall.bookings.length;
    hall.bookings = (hall.bookings || []).filter(
      (booking) => new Date(booking.endDateTime) > cutoff
    );
    const removed = before - hall.bookings.length;
    if (removed > 0) {
      removedBookings += removed;
      hallsTouched += 1;
      hall.status = hall.isFilledAt(new Date()) ? 'Filled' : 'Not Filled';
      await hall.save();
    }
  }

  return { hallsTouched, removedBookings };
};

const cleanupExpiredRequests = async (cutoff) => {
  const endedRequests = await Booking_Requests.deleteMany({
    endDateTime: { $lte: cutoff }
  });

  const stalePendingRequests = await Booking_Requests.deleteMany({
    status: 'PENDING',
    startDateTime: { $lte: cutoff }
  });

  return {
    endedDeleted: endedRequests.deletedCount || 0,
    stalePendingDeleted: stalePendingRequests.deletedCount || 0
  };
};

const runBookingCleanup = async ({ force = false } = {}) => {
  const nowMs = Date.now();

  if (cleanupInProgress) {
    return { skipped: true, reason: 'in_progress' };
  }

  if (!force && nowMs - lastCleanupAt < MIN_CLEANUP_INTERVAL_MS) {
    return { skipped: true, reason: 'throttled' };
  }

  cleanupInProgress = true;
  try {
    const cutoff = new Date();
    const bookingSummary = await cleanupExpiredBookings(cutoff);
    const requestSummary = await cleanupExpiredRequests(cutoff);
    lastCleanupAt = Date.now();

    return {
      skipped: false,
      ...bookingSummary,
      ...requestSummary
    };
  } finally {
    cleanupInProgress = false;
  }
};

const startBookingCleanupSchedule = () => {
  runBookingCleanup({ force: true }).catch((err) => {
    console.error('[BookingCleanup] initial cleanup failed:', err.message);
  });

  const timer = setInterval(() => {
    runBookingCleanup().catch((err) => {
      console.error('[BookingCleanup] scheduled cleanup failed:', err.message);
    });
  }, DEFAULT_SCHEDULE_INTERVAL_MS);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  return timer;
};

module.exports = {
  runBookingCleanup,
  startBookingCleanupSchedule
};
