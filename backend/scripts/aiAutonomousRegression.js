'use strict';

const assert = require('assert');
const Module = require('module');

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'node-fetch') {
    return async () => {
      const err = new Error('Network LLM call blocked during autonomous regression.');
      err.code = 'LLM_BLOCKED';
      throw err;
    };
  }
  return originalLoad.apply(this, arguments);
};

const Hall = require('../models/hall');
const BookingRequests = require('../models/booking_requests');
const aiExecuteRouter = require('../routes/aiExecute');
Module._load = originalLoad;

const executeLayer = aiExecuteRouter.stack.find((layer) => layer.route && layer.route.path === '/execute');
if (!executeLayer) {
  console.error('Could not find /execute handler in backend/routes/aiExecute.js');
  process.exit(1);
}

const executeHandler = executeLayer.route.stack[0].handle;

const makeBooking = ({ id, requestId, start, end, event = 'Regression Booking' }) => ({
  _id: id,
  bookingRequest: requestId,
  department: null,
  event,
  startDateTime: new Date(start),
  endDateTime: new Date(end)
});

const makeHall = ({ name, bookings = [] }) => ({
  name,
  bookings: [...bookings],
  status: 'Not Filled',
  department: null,
  event: '',
  isFilledAt(date = new Date()) {
    return this.bookings.some((booking) =>
      new Date(booking.startDateTime) <= date && new Date(booking.endDateTime) > date
    );
  },
  async save() {
    fakeDb.halls.set(this.name.toLowerCase(), this);
    return this;
  }
});

const fakeDb = {
  halls: new Map(),
  bookingUpdates: []
};

const resetFakeDb = () => {
  fakeDb.halls.clear();
  fakeDb.bookingUpdates = [];
};

const originalHallFindOne = Hall.findOne;
const originalBookingUpdateMany = BookingRequests.updateMany;

Hall.findOne = async (query = {}) => {
  if (query.name instanceof RegExp) {
    const row = Array.from(fakeDb.halls.values()).find((hall) => query.name.test(hall.name));
    return row || null;
  }
  const name = String(query.name || '').toLowerCase();
  return fakeDb.halls.get(name) || null;
};

BookingRequests.updateMany = async (filter, update) => {
  fakeDb.bookingUpdates.push({ filter, update });
  return { acknowledged: true, modifiedCount: 1 };
};

const invokeExecute = async ({ role = 'Admin', action, payload }) => {
  const req = {
    body: {
      intent: {
        type: 'ACTION',
        action,
        payload
      }
    },
    isAuthenticated: () => role !== 'GUEST',
    user: role === 'GUEST' ? null : { type: role, id: 'regression-user', email: 'regression@example.com' }
  };

  let statusCode = 200;
  let body = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payloadOut) {
      body = payloadOut;
      return payloadOut;
    }
  };

  await executeHandler(req, res);
  return { statusCode, body };
};

const tests = [
  {
    name: 'admin direct booking succeeds without department request record',
    run: async () => {
      resetFakeDb();
      fakeDb.halls.set('hall23', makeHall({ name: 'hall23' }));

      const result = await invokeExecute({
        role: 'Admin',
        action: 'BOOK_REQUEST',
        payload: {
          requests: [
            {
              hall: 'hall23',
              date: '2026-04-20',
              start: '1:00 PM',
              end: '2:00 PM',
              event: 'Admin Regression Meeting'
            }
          ]
        }
      });

      assert.strictEqual(result.statusCode, 200);
      assert.strictEqual(result.body.status, 'DONE');
      assert.match(result.body.message, /Admin booked 1 hall slot/i);
      assert.strictEqual(fakeDb.halls.get('hall23').bookings.length, 1);
    }
  },
  {
    name: 'admin direct booking blocks time conflicts',
    run: async () => {
      resetFakeDb();
      fakeDb.halls.set('hall23', makeHall({
        name: 'hall23',
        bookings: [
          makeBooking({
            id: 'b1',
            requestId: null,
            start: '2026-04-20T13:00:00',
            end: '2026-04-20T14:00:00'
          })
        ]
      }));

      const result = await invokeExecute({
        role: 'Admin',
        action: 'BOOK_REQUEST',
        payload: {
          requests: [
            {
              hall: 'hall23',
              date: '2026-04-20',
              start: '1:30 PM',
              end: '2:30 PM',
              event: 'Conflict'
            }
          ]
        }
      });

      assert.strictEqual(result.body.status, 'ERROR');
      assert.match(result.body.msg, /already booked/i);
      assert.strictEqual(fakeDb.halls.get('hall23').bookings.length, 1);
    }
  },
  {
    name: 'vacate hall removes matching date booking and updates request status',
    run: async () => {
      resetFakeDb();
      fakeDb.halls.set('hall23', makeHall({
        name: 'hall23',
        bookings: [
          makeBooking({
            id: 'b20',
            requestId: 'req20',
            start: '2026-04-20T09:00:00',
            end: '2026-04-20T10:00:00'
          }),
          makeBooking({
            id: 'b21',
            requestId: 'req21',
            start: '2026-04-21T09:00:00',
            end: '2026-04-21T10:00:00'
          })
        ]
      }));

      const result = await invokeExecute({
        role: 'Admin',
        action: 'VACATE_HALL',
        payload: {
          targetHall: 'hall23',
          date: '2026-04-20'
        }
      });

      assert.strictEqual(result.body.status, 'DONE');
      assert.match(result.body.message, /Vacated 1 booking/i);
      assert.strictEqual(fakeDb.halls.get('hall23').bookings.length, 1);
      assert.strictEqual(fakeDb.halls.get('hall23').bookings[0]._id, 'b21');
      assert.strictEqual(fakeDb.bookingUpdates.length, 1);
      assert.strictEqual(fakeDb.bookingUpdates[0].update.$set.status, 'VACATED');
    }
  },
  {
    name: 'vacate hall explains missing hall',
    run: async () => {
      resetFakeDb();
      const result = await invokeExecute({
        role: 'Admin',
        action: 'VACATE_HALL',
        payload: {
          targetHall: 'hall404',
          date: '2026-04-20'
        }
      });

      assert.strictEqual(result.body.status, 'ERROR');
      assert.match(result.body.msg, /no such hall named hall404/i);
    }
  },
  {
    name: 'vacate hall explains no booking on selected date',
    run: async () => {
      resetFakeDb();
      fakeDb.halls.set('hall23', makeHall({ name: 'hall23', bookings: [] }));

      const result = await invokeExecute({
        role: 'Admin',
        action: 'VACATE_HALL',
        payload: {
          targetHall: 'hall23',
          date: '2026-04-20'
        }
      });

      assert.strictEqual(result.body.status, 'ERROR');
      assert.match(result.body.msg, /not booked on 2026-04-20/i);
    }
  },
  {
    name: 'vacate hall rejects non-admin users',
    run: async () => {
      resetFakeDb();
      fakeDb.halls.set('hall23', makeHall({ name: 'hall23' }));

      const result = await invokeExecute({
        role: 'Department',
        action: 'VACATE_HALL',
        payload: {
          targetHall: 'hall23',
          date: '2026-04-20'
        }
      });

      assert.strictEqual(result.body.status, 'ERROR');
      assert.match(result.body.msg, /admin-only/i);
    }
  }
];

const run = async () => {
  console.log(`Running autonomous AI execution regression suite with ${tests.length} cases...`);
  const failures = [];

  for (const test of tests) {
    try {
      await test.run();
      console.log(`- PASS ${test.name}`);
    } catch (err) {
      failures.push({ name: test.name, error: err });
      console.log(`- FAIL ${test.name}: ${err.message}`);
    }
  }

  Hall.findOne = originalHallFindOne;
  BookingRequests.updateMany = originalBookingUpdateMany;

  if (failures.length > 0) {
    console.log(`\nAutonomous regression failed: ${failures.length}/${tests.length}`);
    process.exit(1);
  }

  console.log('\nAutonomous AI execution regression suite passed.');
  process.exit(0);
};

run().catch((err) => {
  Hall.findOne = originalHallFindOne;
  BookingRequests.updateMany = originalBookingUpdateMany;
  console.error('Autonomous regression crashed:', err);
  process.exit(1);
});
