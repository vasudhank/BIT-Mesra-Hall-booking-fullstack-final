const nodemailer = require('nodemailer');
const Notice = require('../models/notice');
const Department = require('../models/department');
const Admin = require('../models/admin');

const MAX_RECIPIENTS = 1000;
const SEND_CONCURRENCY = 5;
const inFlightNoticeIds = new Set();

const safeText = (value, max = 5000) =>
  String(value || '')
    .trim()
    .slice(0, max);

const toDateOrNull = (value) => {
  if (!value) return null;
  const dt = value instanceof Date ? value : new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
};

const escapeIcs = (text) =>
  String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');

const formatUtc = (value) => {
  const dt = toDateOrNull(value);
  if (!dt) return '';
  return dt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
};

const formatDateOnly = (value) => {
  const dt = toDateOrNull(value);
  if (!dt) return '';
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
};

const parseIsoBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
};

const isSyncEnabled = () => parseIsoBool(process.env.NOTICE_CALENDAR_SYNC_ENABLED, true);

const createTransporter = () => {
  const user = safeText(process.env.EMAIL, 240);
  const pass = safeText(process.env.EMAIL_APP_PASSWORD, 240);
  if (!user || !pass) return null;

  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass }
  });
};

const getFrontendBaseUrl = () => {
  const fromEnv = safeText(process.env.FRONTEND_BASE_URL, 240);
  return fromEnv || 'http://localhost:3000';
};

const getNoticeBounds = (notice) => {
  const start = toDateOrNull(notice?.startDateTime || notice?.createdAt || new Date());
  let end = toDateOrNull(notice?.endDateTime || null);
  if (!start) return null;
  if (!end || end <= start) {
    end = new Date(start.getTime());
    end.setHours(end.getHours() + 2);
  }
  return { start, end };
};

const isAllDayNotice = (notice, start, end) => {
  if (String(notice?.kind || '').toUpperCase() === 'HOLIDAY') return true;

  const startAtMidnight =
    start.getHours() === 0 &&
    start.getMinutes() === 0 &&
    start.getSeconds() === 0;

  const endAtDayEnd =
    end.getHours() === 23 &&
    end.getMinutes() >= 59;

  return startAtMidnight && endAtDayEnd;
};

const buildNoticeIcs = ({ notice, attendeeEmail = '' }) => {
  const bounds = getNoticeBounds(notice);
  if (!bounds) return null;

  const { start, end } = bounds;
  const uid = `notice-${safeText(notice?._id, 120)}@bit-booking`;
  const title = safeText(
    `${String(notice?.kind || '').toUpperCase() === 'HOLIDAY' ? 'ALERT' : 'NOTICE'}: ${notice?.title || notice?.subject || 'Notice'}`,
    240
  );
  const description = safeText(notice?.content || notice?.body || notice?.summary || '', 3000);
  const location = Array.isArray(notice?.rooms) && notice.rooms.length
    ? safeText(notice.rooms.join(', '), 500)
    : String(notice?.closureAllHalls) === 'true' || notice?.closureAllHalls
      ? 'All halls/rooms'
      : 'BIT Mesra';
  const url = `${getFrontendBaseUrl().replace(/\/+$/, '')}/notices/${String(notice?._id || '').trim()}`;

  const allDay = isAllDayNotice(notice, start, end);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BIT Booking//Notice Calendar Sync//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${escapeIcs(uid)}`,
    `DTSTAMP:${formatUtc(new Date())}`,
    'SEQUENCE:0',
    `SUMMARY:${escapeIcs(title)}`,
    `DESCRIPTION:${escapeIcs(description)}`,
    `LOCATION:${escapeIcs(location)}`,
    `URL:${escapeIcs(url)}`,
    `ORGANIZER;CN=BIT Booking Notices:mailto:${escapeIcs(process.env.EMAIL || '')}`,
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE'
  ];

  if (attendeeEmail) {
    lines.push(`ATTENDEE;CN=${escapeIcs(attendeeEmail)};PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${escapeIcs(attendeeEmail)}`);
  }

  if (allDay) {
    const startDay = new Date(start);
    startDay.setHours(0, 0, 0, 0);
    const endDay = new Date(end);
    endDay.setHours(0, 0, 0, 0);
    endDay.setDate(endDay.getDate() + 1); // exclusive end
    lines.push(`DTSTART;VALUE=DATE:${formatDateOnly(startDay)}`);
    lines.push(`DTEND;VALUE=DATE:${formatDateOnly(endDay)}`);
  } else {
    lines.push(`DTSTART:${formatUtc(start)}`);
    lines.push(`DTEND:${formatUtc(end)}`);
  }

  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
};

const collectRegisteredEmails = async () => {
  const [admins, departments] = await Promise.all([
    Admin.find({}, { email: 1 }).lean(),
    Department.find({}, { email: 1 }).lean()
  ]);

  const set = new Set();
  [...admins, ...departments].forEach((row) => {
    const email = safeText(row?.email, 240).toLowerCase();
    if (email && email.includes('@')) set.add(email);
  });

  return Array.from(set).slice(0, MAX_RECIPIENTS);
};

const sendInvite = async ({ transporter, recipient, notice, ics }) => {
  const displayTitle = safeText(notice?.title || notice?.subject || 'Notice', 180);
  const isHoliday = String(notice?.kind || '').toUpperCase() === 'HOLIDAY';
  const subject = `${isHoliday ? 'Alert' : 'Notice'} calendar update: ${displayTitle}`;
  const frontendBaseUrl = getFrontendBaseUrl().replace(/\/+$/, '');
  const detailUrl = `${frontendBaseUrl}/notices/${String(notice?._id || '').trim()}`;
  const calendarUrl = `${frontendBaseUrl}/calendar`;

  await transporter.sendMail({
    to: recipient,
    from: process.env.EMAIL,
    subject,
    text:
`A new ${isHoliday ? 'alert/closure' : 'notice'} has been published.

Title: ${displayTitle}
Open notice: ${detailUrl}
Open shared calendar: ${calendarUrl}

This message includes a calendar invite (.ics) for Google/phone calendar apps.`,
    html:
`<div style="font-family:Arial,sans-serif;color:#1f2937">
  <p>A new <b>${isHoliday ? 'alert/closure' : 'notice'}</b> has been published.</p>
  <p><b>Title:</b> ${escapeIcs(displayTitle)}</p>
  <p><a href="${detailUrl}">Open notice</a></p>
  <p><a href="${calendarUrl}">Open shared calendar</a></p>
  <p style="color:#6b7280">This email includes a calendar invite (.ics) for Google/phone calendar apps.</p>
</div>`,
    alternatives: [
      {
        contentType: 'text/calendar; method=REQUEST; charset="UTF-8"',
        content: ics
      }
    ],
    attachments: [
      {
        filename: `notice-${String(notice?._id || 'event').trim()}.ics`,
        content: ics,
        contentType: 'text/calendar; charset=utf-8; method=REQUEST'
      }
    ]
  });
};

const runWithConcurrency = async (items, worker, concurrency = SEND_CONCURRENCY) => {
  const queue = Array.isArray(items) ? items.slice() : [];
  const size = Math.max(1, Number(concurrency) || 1);
  let ok = 0;
  let failed = 0;

  const runner = async () => {
    while (queue.length) {
      const next = queue.shift();
      if (!next) continue;
      try {
        await worker(next);
        ok += 1;
      } catch (_) {
        failed += 1;
      }
    }
  };

  await Promise.all(Array.from({ length: size }, () => runner()));
  return { ok, failed };
};

const syncNoticeToRegisteredCalendars = async (noticeInput) => {
  if (!isSyncEnabled()) return { sent: 0, failed: 0, skipped: true, reason: 'disabled' };

  const notice =
    noticeInput && noticeInput._id
      ? noticeInput
      : await Notice.findById(noticeInput).lean();

  if (!notice) return { sent: 0, failed: 0, skipped: true, reason: 'not_found' };

  const transporter = createTransporter();
  if (!transporter) return { sent: 0, failed: 0, skipped: true, reason: 'smtp_not_configured' };

  const recipients = await collectRegisteredEmails();
  if (!recipients.length) return { sent: 0, failed: 0, skipped: true, reason: 'no_recipients' };

  const result = await runWithConcurrency(
    recipients,
    (email) => {
      const ics = buildNoticeIcs({ notice, attendeeEmail: email });
      if (!ics) throw new Error('invalid_notice_dates');
      return sendInvite({ transporter, recipient: email, notice, ics });
    },
    SEND_CONCURRENCY
  );

  return {
    sent: result.ok,
    failed: result.failed,
    skipped: false,
    recipients: recipients.length
  };
};

const queueNoticeCalendarSync = (noticeInput) => {
  if (!isSyncEnabled()) return;
  const id = safeText(noticeInput?._id || noticeInput, 120);
  if (!id) return;
  if (inFlightNoticeIds.has(id)) return;
  inFlightNoticeIds.add(id);

  setImmediate(async () => {
    try {
      const result = await syncNoticeToRegisteredCalendars(noticeInput);
      if (!result.skipped) {
        console.log(`[NoticeCalendarSync] notice=${id} sent=${result.sent} failed=${result.failed}`);
      } else {
        console.log(`[NoticeCalendarSync] notice=${id} skipped (${result.reason})`);
      }
    } catch (err) {
      console.error(`[NoticeCalendarSync] notice=${id} failed:`, err.message);
    } finally {
      inFlightNoticeIds.delete(id);
    }
  });
};

module.exports = {
  syncNoticeToRegisteredCalendars,
  queueNoticeCalendarSync
};
