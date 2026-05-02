const Booking_Requests = require('../models/booking_requests');
const Hall = require('../models/hall');

let cleanupInProgress = false;
let lastCleanupAt = 0;

const MIN_CLEANUP_INTERVAL_MS = 30 * 1000;
const DEFAULT_SCHEDULE_INTERVAL_MS = 60 * 1000;

const cleanupExpiredBookings = async (cutoff) => {
  const halls = await Hall.find({ 'bookings.endDateTime': { $lte: cutoff } })
    .select('_id bookings')
    .lean();

  if (!halls.length) {
    return { hallsTouched: 0, removedBookings: 0 };
  }

  const hallIds = halls.map((hall) => hall._id);
  const removedBookings = halls.reduce((total, hall) => {
    const removed = (hall.bookings || []).filter(
      (booking) => new Date(booking.endDateTime) <= cutoff
    ).length;
    return total + removed;
  }, 0);

  await Hall.updateMany(
    { _id: { $in: hallIds } },
    {
      $pull: {
        bookings: {
          endDateTime: { $lte: cutoff }
        }
      }
    }
  );

  const refreshed = await Hall.find({ _id: { $in: hallIds } })
    .select('_id bookings')
    .lean();
  const now = new Date();
  const statusUpdates = refreshed.map((hall) => {
    const isFilled = (hall.bookings || []).some(
      (booking) => new Date(booking.startDateTime) <= now && new Date(booking.endDateTime) > now
    );
    return {
      updateOne: {
        filter: { _id: hall._id },
        update: { $set: { status: isFilled ? 'Filled' : 'Not Filled' } }
      }
    };
  });

  if (statusUpdates.length > 0) {
    await Hall.bulkWrite(statusUpdates, { ordered: false });
  }

  return { hallsTouched: hallIds.length, removedBookings };
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
