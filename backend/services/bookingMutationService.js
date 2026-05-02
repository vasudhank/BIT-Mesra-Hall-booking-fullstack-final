const Hall = require('../models/hall');

const isMongoObjectIdString = (value) => /^[a-fA-F0-9]{24}$/.test(String(value || '').trim());

const toDateOrNull = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

const isTimeOverlap = (startA, endA, startB, endB) =>
  new Date(startA).getTime() < new Date(endB).getTime() &&
  new Date(endA).getTime() > new Date(startB).getTime();

const buildOverlapElemMatch = (startDateTime, endDateTime) => ({
  startDateTime: { $lt: endDateTime },
  endDateTime: { $gt: startDateTime }
});

const reserveHallSlotAtomically = async ({
  hallName,
  bookingRequestId = null,
  departmentId = null,
  event = '',
  startDateTime,
  endDateTime
}) => {
  const start = toDateOrNull(startDateTime);
  const end = toDateOrNull(endDateTime);
  const normalizedHall = String(hallName || '').trim();

  if (!normalizedHall || !start || !end || end <= start) {
    return { reserved: false, reason: 'INVALID_INPUT' };
  }

  const isActiveNow = start <= new Date() && end > new Date();
  const update = {
    $push: {
      bookings: {
        bookingRequest: bookingRequestId || null,
        department: departmentId || null,
        event: String(event || '').trim(),
        startDateTime: start,
        endDateTime: end
      }
    }
  };

  if (isActiveNow) {
    update.$set = { status: 'Filled' };
  }

  const result = await Hall.updateOne(
    {
      name: normalizedHall,
      bookings: {
        $not: {
          $elemMatch: buildOverlapElemMatch(start, end)
        }
      }
    },
    update
  );

  if (result.modifiedCount > 0) {
    return { reserved: true, reason: 'OK' };
  }

  const hallExists = await Hall.exists({ name: normalizedHall });
  if (!hallExists) return { reserved: false, reason: 'HALL_NOT_FOUND' };
  return { reserved: false, reason: 'OVERLAP' };
};

const pullHallBookingsByRequestIds = async ({ hallName, requestIds = [] }) => {
  const normalizedHall = String(hallName || '').trim();
  const ids = (Array.isArray(requestIds) ? requestIds : [])
    .map((id) => String(id || '').trim())
    .filter((id) => isMongoObjectIdString(id));

  if (!normalizedHall || ids.length === 0) return { modifiedCount: 0 };

  const result = await Hall.updateOne(
    { name: normalizedHall },
    {
      $pull: {
        bookings: {
          bookingRequest: { $in: ids }
        }
      }
    }
  );
  return { modifiedCount: Number(result.modifiedCount || 0) };
};

module.exports = {
  toDateOrNull,
  isTimeOverlap,
  reserveHallSlotAtomically,
  pullHallBookingsByRequestIds
};
