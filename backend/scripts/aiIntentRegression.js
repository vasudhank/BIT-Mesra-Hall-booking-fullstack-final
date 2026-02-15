'use strict';

const Module = require('module');

// Block LLM calls during regression runs so we validate deterministic intent routing.
const originalLoad = Module._load;
let llmCallCount = 0;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'node-fetch') {
    return async () => {
      llmCallCount += 1;
      const err = new Error('LLM call blocked during AI intent regression suite.');
      err.code = 'LLM_BLOCKED';
      throw err;
    };
  }
  return originalLoad.apply(this, arguments);
};

const Hall = require('../models/hall');

const HALL_NAMES = [
  'hall20',
  'hall21',
  'hall22',
  'hall23',
  'hall24',
  'hall25',
  'hall26',
  'hall27',
  'hall28'
];

Hall.find = async () => HALL_NAMES.map((name) => ({ name }));

const aiRouter = require('../routes/ai');
Module._load = originalLoad;

const chatLayer = aiRouter.stack.find((layer) => layer.route && layer.route.path === '/chat');
if (!chatLayer) {
  console.error('Could not find /chat handler in backend/routes/ai.js');
  process.exit(1);
}
const chatHandler = chatLayer.route.stack[0].handle;

const normalize = (text) => String(text || '').toLowerCase();

const invokeChat = async ({ role, message }) => {
  const isAuthenticated = role !== 'GUEST';
  const req = {
    body: { message },
    isAuthenticated: () => isAuthenticated,
    user: isAuthenticated ? { type: role } : null
  };

  let statusCode = 200;
  let body = null;

  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      body = payload;
      return payload;
    }
  };

  try {
    await chatHandler(req, res);
  } catch (error) {
    return { statusCode: 500, body: null, thrown: error };
  }

  return { statusCode, body, thrown: null };
};

const checkIncludes = (haystack, needle) => normalize(haystack).includes(normalize(needle));

const assertCase = (testCase, result) => {
  const failures = [];

  if (result.thrown) {
    failures.push(`handler threw: ${result.thrown.message}`);
    return failures;
  }

  const expectedHttp = testCase.expect.httpStatus || 200;
  if (result.statusCode !== expectedHttp) {
    failures.push(`expected HTTP ${expectedHttp}, got ${result.statusCode}`);
  }

  if (!result.body || typeof result.body !== 'object') {
    failures.push('response body missing');
    return failures;
  }

  const reply = result.body.reply;
  if (!reply || typeof reply !== 'object') {
    failures.push('reply object missing');
    return failures;
  }

  if (testCase.expect.type && reply.type !== testCase.expect.type) {
    failures.push(`expected type=${testCase.expect.type}, got ${reply.type}`);
  }

  if (testCase.expect.action && reply.action !== testCase.expect.action) {
    failures.push(`expected action=${testCase.expect.action}, got ${reply.action}`);
  }

  if (testCase.expect.subAction) {
    const got = reply.payload && reply.payload.subAction;
    if (got !== testCase.expect.subAction) {
      failures.push(`expected subAction=${testCase.expect.subAction}, got ${got}`);
    }
  }

  if (testCase.expect.mode) {
    const got = reply.payload && reply.payload.mode;
    if (got !== testCase.expect.mode) {
      failures.push(`expected mode=${testCase.expect.mode}, got ${got}`);
    }
  }

  if (testCase.expect.filter) {
    const got = reply.payload && reply.payload.filter;
    if (got !== testCase.expect.filter) {
      failures.push(`expected filter=${testCase.expect.filter}, got ${got}`);
    }
  }

  if (testCase.expect.targetHall) {
    const got = reply.payload && reply.payload.targetHall;
    if (normalize(got) !== normalize(testCase.expect.targetHall)) {
      failures.push(`expected targetHall=${testCase.expect.targetHall}, got ${got}`);
    }
  }

  if (testCase.expect.messageIncludes) {
    const text = reply.message || reply.reply || '';
    if (!checkIncludes(text, testCase.expect.messageIncludes)) {
      failures.push(`expected message to include "${testCase.expect.messageIncludes}", got "${text}"`);
    }
  }

  if (testCase.expect.requestHallPresent) {
    const first = reply.payload && Array.isArray(reply.payload.requests) ? reply.payload.requests[0] : null;
    if (!first || !first.hall) {
      failures.push('expected payload.requests[0].hall to be present');
    }
  }

  return failures;
};

const cases = [];
let seq = 1;
const addCase = (suite, role, message, expect) => {
  cases.push({
    id: `T${String(seq).padStart(4, '0')}`,
    suite,
    role,
    message,
    expect
  });
  seq += 1;
};

const buildHallStatusCases = () => {
  const verbs = ['show', 'list', 'display', 'view', 'check'];
  const dates = ['today', 'on 15 feb', 'on 16 feb', 'on 2026-02-17'];
  const availableSignals = ['available', 'free', 'vacant', 'not booked', 'unbooked', 'without bookings'];
  const filledSignals = ['filled', 'booked', 'occupied', 'busy', 'not available'];

  for (const verb of verbs) {
    for (const signal of availableSignals) {
      for (const date of dates) {
        addCase(
          'hall_status_available',
          'Admin',
          `${verb} list of halls ${signal} ${date}`,
          { type: 'ACTION', action: 'SHOW_HALL_STATUS', mode: 'AVAILABLE' }
        );
      }
    }
  }

  for (const verb of verbs) {
    for (const signal of filledSignals) {
      for (const date of dates) {
        addCase(
          'hall_status_filled',
          'Admin',
          `${verb} list of halls ${signal} ${date}`,
          { type: 'ACTION', action: 'SHOW_HALL_STATUS', mode: 'FILLED' }
        );
      }
    }
  }
};

const buildBookingListCases = () => {
  const verbs = ['show', 'list', 'display', 'view', 'tell', 'hsow'];
  const filters = [
    { phrase: 'all conflicting and non conflicting booking requests', filter: 'ALL' },
    { phrase: 'all pending booking requests', filter: 'ALL' },
    { phrase: 'conflicting booking requests', filter: 'CONFLICTING' },
    { phrase: 'non conflicting booking requests', filter: 'NON_CONFLICTING' },
    { phrase: 'no conflict booking requests', filter: 'NON_CONFLICTING' },
    { phrase: 'safe booking requests', filter: 'NON_CONFLICTING' }
  ];

  for (const verb of verbs) {
    for (const entry of filters) {
      addCase(
        'booking_request_list',
        'Admin',
        `${verb} ${entry.phrase}`,
        { type: 'ACTION', action: 'LIST_BOOKING_REQUESTS', filter: entry.filter }
      );
      addCase(
        'booking_request_list',
        'Admin',
        `${verb} ${entry.phrase} for hall23 on 15 feb`,
        { type: 'ACTION', action: 'LIST_BOOKING_REQUESTS', filter: entry.filter, targetHall: 'hall23' }
      );
    }
  }
};

const buildAdminExecutionCases = () => {
  const phrases = [
    ['approve all non conflicting requests', 'APPROVE_SAFE'],
    ['approve all no conflict requests', 'APPROVE_SAFE'],
    ['approve all safe bookings', 'APPROVE_SAFE'],
    ['aproove all non cliflicting bookings', 'APPROVE_SAFE'],
    ['approve all requests', 'APPROVE_ALL'],
    ['approve every pending request', 'APPROVE_ALL'],
    ['accept all pending booking requests', 'APPROVE_ALL'],
    ['reject conflicting requests', 'REJECT_CONFLICTS'],
    ['reject overlap requests', 'REJECT_CONFLICTS'],
    ['decline clash bookings', 'REJECT_CONFLICTS'],
    ['reject all requests', 'REJECT_ALL'],
    ['decline all pending bookings', 'REJECT_ALL'],
    ['cancel all pending requests', 'REJECT_ALL'],
    ['approve hall23 bookings', 'APPROVE_SPECIFIC', 'hall23'],
    ['reject hall24 bookings', 'REJECT_SPECIFIC', 'hall24'],
    ['accept hall25 requests', 'APPROVE_SPECIFIC', 'hall25'],
    ['decline hall26 requests', 'REJECT_SPECIFIC', 'hall26'],
    ['book all non conflicting halls', 'APPROVE_SAFE'],
    ['book every safe hall request', 'APPROVE_SAFE'],
    ['approve all pending requests for hall23', 'APPROVE_ALL', 'hall23']
  ];

  for (const row of phrases) {
    addCase(
      'admin_execute',
      'Admin',
      row[0],
      {
        type: 'ACTION',
        action: 'ADMIN_EXECUTE',
        subAction: row[1],
        targetHall: row[2] || undefined
      }
    );
  }
};

const buildDepartmentBookingCases = () => {
  const verbs = ['book', 'reserve', 'schedule', 'request'];
  const halls = ['hall23', 'hall24', 'hall25'];
  const slots = [
    'from 1pm to 2pm',
    'from 1pm to 2:30pm',
    'from 09:00 to 10:00',
    '10 am to 12 pm'
  ];
  const dates = ['on 15 feb', 'on 16 feb', 'on 2026-02-17'];
  const events = ['latex project', 'arduino workshop', 'ml seminar'];

  for (const verb of verbs) {
    for (const hall of halls) {
      for (const slot of slots) {
        for (const date of dates) {
          for (const event of events) {
            addCase(
              'department_booking',
              'Department',
              `${verb} ${hall} ${slot} ${date} for ${event}`,
              { type: 'ACTION', action: 'BOOK_REQUEST', requestHallPresent: true }
            );
          }
        }
      }
    }
  }
};

const buildAccessControlCases = () => {
  const bookingMessages = [
    'book hall23 from 1pm to 2pm on 15 feb for latex project',
    'reserve hall24 from 10 am to 12 pm on 16 feb for workshop',
    'schedule hall25 from 09:00 to 10:00 on 15 feb for seminar'
  ];

  for (const message of bookingMessages) {
    addCase(
      'access_control_guest_booking',
      'GUEST',
      message,
      { type: 'CHAT', messageIncludes: 'log in as faculty/department' }
    );
  }

  const adminOnlyRead = [
    'show all conflicting and non conflicting booking requests',
    'list non conflicting booking requests',
    'display conflicting booking requests for hall23 on 15 feb'
  ];

  for (const message of adminOnlyRead) {
    addCase(
      'access_control_non_admin_read',
      'Department',
      message,
      { type: 'CHAT', messageIncludes: 'requires admin access' }
    );
    addCase(
      'access_control_non_admin_read',
      'GUEST',
      message,
      { type: 'CHAT', messageIncludes: 'requires admin access' }
    );
  }

  const adminOnlyWrite = [
    'approve all non conflicting requests',
    'reject all requests',
    'approve hall23 bookings'
  ];

  for (const message of adminOnlyWrite) {
    addCase(
      'access_control_non_admin_write',
      'Department',
      message,
      { type: 'CHAT', messageIncludes: 'needs admin access' }
    );
    addCase(
      'access_control_non_admin_write',
      'GUEST',
      message,
      { type: 'CHAT', messageIncludes: 'needs admin access' }
    );
  }
};

buildHallStatusCases();
buildBookingListCases();
buildAdminExecutionCases();
buildDepartmentBookingCases();
buildAccessControlCases();

const run = async () => {
  console.log(`Running AI intent regression suite with ${cases.length} prompt cases...`);

  const failures = [];
  const suiteStats = {};

  for (const testCase of cases) {
    const result = await invokeChat({
      role: testCase.role,
      message: testCase.message
    });

    suiteStats[testCase.suite] = suiteStats[testCase.suite] || { total: 0, passed: 0 };
    suiteStats[testCase.suite].total += 1;

    const caseFailures = assertCase(testCase, result);
    if (caseFailures.length > 0) {
      failures.push({ testCase, result, caseFailures });
      continue;
    }

    suiteStats[testCase.suite].passed += 1;
  }

  console.log('\nSuite Summary:');
  Object.keys(suiteStats).sort().forEach((suite) => {
    const stat = suiteStats[suite];
    const failed = stat.total - stat.passed;
    console.log(`- ${suite}: passed ${stat.passed}/${stat.total}, failed ${failed}`);
  });

  console.log(`\nLLM calls blocked during run: ${llmCallCount}`);
  console.log(`Total failures: ${failures.length}/${cases.length}`);

  if (failures.length > 0) {
    console.log('\nTop failures:');
    failures.slice(0, 25).forEach((item, idx) => {
      const reply = item.result.body && item.result.body.reply ? item.result.body.reply : null;
      console.log(`\n${idx + 1}) ${item.testCase.id} [${item.testCase.suite}]`);
      console.log(`Role: ${item.testCase.role}`);
      console.log(`Message: ${item.testCase.message}`);
      console.log(`Expected: ${JSON.stringify(item.testCase.expect)}`);
      console.log(`Got: ${JSON.stringify(reply)}`);
      console.log(`Reason: ${item.caseFailures.join(' | ')}`);
    });
    process.exit(1);
  }

  console.log('\nAI intent regression suite passed.');
  process.exit(0);
};

run().catch((error) => {
  console.error('Regression suite crashed:', error);
  process.exit(1);
});
