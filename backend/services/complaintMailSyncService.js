const Imap = require('imap-simple');
const { simpleParser } = require('mailparser');
const Complaint = require('../models/complaint');
const Query = require('../models/query');

const SENT_BOX_CANDIDATES = [
  '[Gmail]/Sent Mail',
  '[Google Mail]/Sent Mail',
  'Sent Mail',
  'Sent',
  'INBOX.Sent'
];

const DEFAULT_DEVELOPER_EMAIL = 'jarti2731@gmail.com';

let syncTimer = null;
let syncRunning = false;
let selfSignedWarningPrinted = false;

const parseAddressList = (addressObj) => {
  const values = Array.isArray(addressObj?.value) ? addressObj.value : [];
  return values.map((x) => String(x.address || '').toLowerCase().trim()).filter(Boolean);
};

const normalizeSubject = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^((re|fw|fwd)\s*:\s*)+/i, '')
    .trim();

const normalizeTitle = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .trim();

const normalizeEmail = (value) => String(value || '').toLowerCase().trim();

const getDeveloperSyncEmail = () =>
  normalizeEmail(process.env.DEVELOPER_EMAIL || DEFAULT_DEVELOPER_EMAIL);

const getAdminSyncEmail = () =>
  normalizeEmail(process.env.EMAIL || process.env.ADMIN_EMAIL);

const stripMailSyncTrackingHints = (value) =>
  String(value || '')
    .replace(/Do not change\/remove subject or reference number for tracking\.?/gi, '')
    .replace(
      /Important:\s*Do not change\/remove subject text or (complaint|query) reference number\.?/gi,
      ''
    )
    .replace(/Do not change\/remove subject text or (complaint|query) reference number\.?/gi, '');

const METADATA_LINE_PATTERNS = [
  /^TRUSTED SOLUTION POSTED$/i,
  /^ADMIN RESPONSE TO YOUR COMPLAINT$/i,
  /^DEVELOPER RESPONSE TO YOUR COMPLAINT$/i,
  /^ADMIN RESPONSE TO YOUR QUERY$/i,
  /^DEVELOPER RESPONSE TO YOUR QUERY$/i,
  /^NEW TRUSTED SOLUTION ON YOUR COMPLAINT$/i,
  /^NEW SOLUTION ON YOUR COMPLAINT$/i,
  /^NEW TRUSTED SOLUTION ON YOUR QUERY$/i,
  /^NEW SOLUTION ON YOUR QUERY$/i,
  /^Complaint:\s*/i,
  /^Query:\s*/i,
  /^Complaint Ref:\s*/i,
  /^Query Ref:\s*/i,
  /^From:\s*/i,
  /^Responded by:\s*/i,
  /^At:\s*/i,
  /^Posted:\s*/i,
  /^Open (complaint|query) thread/i,
  /^Reply to reporter \(subject auto-filled\)/i,
  /^Important:\s*Do not change\/remove subject text or (complaint|query) reference number\.?$/i,
  /^Seminar Hall Booking System$/i,
  /^On .+ wrote:$/i,
  /^-{2,}\s*Original Message\s*-{2,}$/i
];

const isMetadataLine = (line) => {
  const text = String(line || '').trim();
  if (!text) return false;
  if (METADATA_LINE_PATTERNS.some((re) => re.test(text))) return true;
  if (/^\s*>/.test(text)) return true;
  if (/^https?:\/\/\S+$/i.test(text)) return true;
  if (/^\[.*mailto:.*\]$/i.test(text)) return true;
  if (text.includes('subject=Regarding%20') && text.includes('Query%20Ref%3A')) return true;
  return false;
};

const sanitizeMailSyncedBody = (value) => {
  const normalized = stripMailSyncTrackingHints(String(value || '').replace(/\r\n/g, '\n'));

  // If the message includes an explicit "Solution:" section, keep content after it.
  const solutionMarker = normalized.match(/(?:^|\n)\s*Solution:\s*/i);
  const coreText = solutionMarker
    ? normalized.slice(solutionMarker.index + solutionMarker[0].length)
    : normalized;

  const splitLines = coreText.split('\n');
  const replyMarkerIndex = splitLines.findIndex((line) => {
    const trimmed = String(line || '').trim();
    return (
      /^On .+ wrote:$/i.test(trimmed) ||
      /^-{2,}\s*Original Message\s*-{2,}$/i.test(trimmed)
    );
  });

  const lines = (replyMarkerIndex >= 0 ? splitLines.slice(0, replyMarkerIndex) : splitLines)
    .map((line) => line.trimEnd())
    .filter(
      (line) =>
        !isMetadataLine(line) &&
        !/^important:\s*do not change\/remove subject text or (complaint|query) reference number\.?$/i.test(
          line.trim()
        ) &&
        !/^do not change\/remove subject or reference number for tracking\.?$/i.test(line.trim())
    );

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 10000);
};

const toPlainBody = (parsed) => {
  const txt = String(parsed?.text || '').trim();
  if (txt) return txt.slice(0, 10000);
  const html = String(parsed?.html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return html.slice(0, 10000);
};

const isSystemGeneratedNotifyBody = (body) => {
  const b = String(body || '').toLowerCase();
  if (!b) return false;
  return (
    b.includes('new trusted solution on your complaint') ||
    b.includes('new solution on your complaint') ||
    b.includes('new trusted solution on your query') ||
    b.includes('new solution on your query') ||
    (b.includes('new query raised') && b.includes('query ref: [query#')) ||
    (b.includes('new complaint raised') && b.includes('complaint ref: [complaint#')) ||
    (b.includes('reply to reporter') && b.includes('subject auto-filled')) ||
    (b.includes('complaint ref: [complaint#') && b.includes('open thread')) ||
    (b.includes('query ref: [query#') && b.includes('open thread'))
  );
};

const extractComplaintId = (subject, body) => {
  const combined = `${subject || ''}\n${body || ''}`;
  const match = combined.match(/\[Complaint#([a-f0-9]{24})\]/i);
  return match?.[1] || null;
};

const extractQueryId = (subject, body) => {
  const combined = `${subject || ''}\n${body || ''}`;
  const match = combined.match(/\[Query#([a-f0-9]{24})\]/i);
  return match?.[1] || null;
};

const matchesStrictSubject = (kind, subject, title) => {
  const normalized = normalizeSubject(subject);
  const target = `regarding ${kind}: ${String(title || '').trim().toLowerCase()}`;
  return normalized === target;
};

const matchesTitleSubject = (subject, title) => {
  const normalizedSubject = normalizeTitle(normalizeSubject(subject));
  const normalizedTitle = normalizeTitle(title);
  if (!normalizedSubject || !normalizedTitle) return false;
  return normalizedSubject === normalizedTitle;
};

const isTrustedSender = (email) => {
  const sender = String(email || '').toLowerCase().trim();
  const trustedEmails = [
    getDeveloperSyncEmail(),
    String(process.env.EMAIL || '').toLowerCase().trim(),
    String(process.env.ADMIN_EMAIL || '').toLowerCase().trim()
  ].filter(Boolean);
  return trustedEmails.includes(sender);
};

const senderRoleByEmail = (email) => {
  const sender = String(email || '').toLowerCase().trim();
  const dev = getDeveloperSyncEmail();
  return sender === dev ? 'DEVELOPER' : 'ADMIN';
};

const addComplaintSolutionFromMail = async ({ complaint, fromEmail, body, messageId }) => {
  const cleanedBody = sanitizeMailSyncedBody(body);
  if (!cleanedBody) return false;
  const sender = String(fromEmail || '').toLowerCase().trim();
  const role = senderRoleByEmail(sender);
  const fallbackId = `complaint:${sender}:${String(complaint._id)}:${String(cleanedBody).slice(0, 140).toLowerCase()}`;
  const externalId = String(messageId || '').trim() || fallbackId;

  const exists = complaint.solutions.some(
    (s) => s.source === 'EMAIL_SYNC' && s.externalMessageId && s.externalMessageId === externalId
  );
  if (exists) return false;

  complaint.solutions.push({
    authorName: role === 'DEVELOPER' ? 'Developer' : 'Admin',
    authorEmail: sender,
    authorRole: role,
    trusted: true,
    isAIGenerated: false,
    source: 'EMAIL_SYNC',
    externalMessageId: externalId,
    body: cleanedBody
  });
  complaint.lastActivityAt = new Date();
  await complaint.save();
  return true;
};

const addQuerySolutionFromMail = async ({ queryDoc, fromEmail, body, messageId }) => {
  const cleanedBody = sanitizeMailSyncedBody(body);
  if (!cleanedBody) return false;
  const sender = String(fromEmail || '').toLowerCase().trim();
  const role = senderRoleByEmail(sender);
  const fallbackId = `query:${sender}:${String(queryDoc._id)}:${String(cleanedBody).slice(0, 140).toLowerCase()}`;
  const externalId = String(messageId || '').trim() || fallbackId;

  const exists = queryDoc.solutions.some(
    (s) => s.source === 'EMAIL_SYNC' && s.externalMessageId && s.externalMessageId === externalId
  );
  if (exists) return false;

  queryDoc.solutions.push({
    authorName: role === 'DEVELOPER' ? 'Developer' : 'Admin',
    authorEmail: sender,
    authorRole: role,
    trusted: true,
    isAIGenerated: false,
    source: 'EMAIL_SYNC',
    externalMessageId: externalId,
    body: cleanedBody
  });
  queryDoc.lastActivityAt = new Date();
  if (queryDoc.status === 'RESOLVED' || queryDoc.status === 'CLOSED') {
    queryDoc.status = 'REOPENED';
    queryDoc.resolvedAt = null;
  }
  await queryDoc.save();
  return true;
};

const openFirstAvailableBox = async (conn, names) => {
  for (const name of names) {
    try {
      await conn.openBox(name);
      return name;
    } catch (_) {
      // try next
    }
  }
  return null;
};

const findComplaintByFallback = async ({ subject, recipients }) => {
  const candidateComplaints = await Complaint.find({
    status: { $in: ['IN_PROGRESS', 'REOPENED', 'RESOLVED', 'CLOSED'] }
  })
    .sort({ updatedAt: -1 })
    .limit(500);

  const recipientMatched = candidateComplaints.filter((c) =>
    recipients.includes(String(c.email || '').toLowerCase().trim())
  );

  return (
    recipientMatched.find((c) => matchesStrictSubject('complaint', subject, c.title)) ||
    recipientMatched.find((c) => matchesTitleSubject(subject, c.title)) ||
    null
  );
};

const findQueryByFallback = async ({ subject, recipients }) => {
  const candidateQueries = await Query.find({
    status: { $in: ['IN_PROGRESS', 'REOPENED', 'RESOLVED', 'CLOSED'] }
  })
    .sort({ updatedAt: -1 })
    .limit(500);

  const recipientMatched = candidateQueries.filter((q) =>
    recipients.includes(String(q.email || '').toLowerCase().trim())
  );

  return (
    recipientMatched.find((q) => matchesStrictSubject('query', subject, q.title)) ||
    recipientMatched.find((q) => matchesTitleSubject(subject, q.title)) ||
    null
  );
};

const processMailboxMessages = async ({ conn, searchCriteria }) => {
  const fetchOptions = { bodies: [''], markSeen: false, struct: true };
  const messages = await conn.search(searchCriteria, fetchOptions);

  for (const msg of messages) {
    const all = msg.parts.find((p) => p.which === '');
    if (!all?.body) continue;

    const parsed = await simpleParser(all.body);
    const autoNotify = String(parsed?.headers?.get?.('x-bit-auto-notify') || '').trim();
    if (autoNotify === '1') continue;

    const fromEmail = parseAddressList(parsed.from)[0] || '';
    if (!isTrustedSender(fromEmail)) continue;

    const subject = String(parsed.subject || '').trim();
    const body = toPlainBody(parsed);
    if (isSystemGeneratedNotifyBody(body)) continue;
    const recipients = Array.from(
      new Set([...parseAddressList(parsed.to), ...parseAddressList(parsed.cc)])
    );
    const complaintId = extractComplaintId(subject, body);
    const queryId = extractQueryId(subject, body);
    const messageId = String(parsed.messageId || '').trim();

    let complaint = null;
    let queryDoc = null;
    let matchedByUniqueRecipient = false;

    if (complaintId) {
      complaint = await Complaint.findById(complaintId);
    }
    if (!complaint && queryId) {
      queryDoc = await Query.findById(queryId);
    }

    if (!complaint && !queryDoc) {
      complaint = await findComplaintByFallback({ subject, recipients });
      if (!complaint) {
        queryDoc = await findQueryByFallback({ subject, recipients });
      }
    }

    // Fallback for "new compose" mails where sender did not keep subject/reference:
    // if recipient maps to exactly one open support thread, attach to that one.
    if (!complaint && !queryDoc && recipients.length > 0) {
      const [recipientComplaints, recipientQueries] = await Promise.all([
        Complaint.find({
          email: { $in: recipients },
          status: { $in: ['IN_PROGRESS', 'REOPENED', 'RESOLVED'] }
        })
          .sort({ updatedAt: -1 })
          .limit(2),
        Query.find({
          email: { $in: recipients },
          status: { $in: ['IN_PROGRESS', 'REOPENED', 'RESOLVED'] }
        })
          .sort({ updatedAt: -1 })
          .limit(2)
      ]);

      if (recipientComplaints.length === 1 && recipientQueries.length === 0) {
        complaint = recipientComplaints[0];
        matchedByUniqueRecipient = true;
      } else if (recipientQueries.length === 1 && recipientComplaints.length === 0) {
        queryDoc = recipientQueries[0];
        matchedByUniqueRecipient = true;
      }
    }

    if (complaint) {
      const isAccepted =
        Boolean(complaintId) ||
        matchesStrictSubject('complaint', subject, complaint.title) ||
        matchesTitleSubject(subject, complaint.title) ||
        matchedByUniqueRecipient;
      if (!isAccepted) continue;
      if (!recipients.includes(normalizeEmail(complaint.email))) continue;

      await addComplaintSolutionFromMail({
        complaint,
        fromEmail,
        body,
        messageId
      });
      continue;
    }

    if (queryDoc) {
      const isAccepted =
        Boolean(queryId) ||
        matchesStrictSubject('query', subject, queryDoc.title) ||
        matchesTitleSubject(subject, queryDoc.title) ||
        matchedByUniqueRecipient;
      if (!isAccepted) continue;
      if (!recipients.includes(normalizeEmail(queryDoc.email))) continue;

      await addQuerySolutionFromMail({
        queryDoc,
        fromEmail,
        body,
        messageId
      });
    }
  }
};

const buildImapConfig = ({ email, appPassword }) => {
  const normalizedUser = String(email || '').trim();
  const normalizedPassword = String(appPassword || '').trim();
  const rejectUnauthorized =
    String(process.env.COMPLAINT_MAIL_SYNC_TLS_REJECT_UNAUTHORIZED || 'true').toLowerCase() !== 'false';

  if (!rejectUnauthorized && !selfSignedWarningPrinted) {
    console.warn('[ComplaintMailSync] TLS certificate validation disabled for IMAP (self-signed allowed).');
    selfSignedWarningPrinted = true;
  }

  return {
    imap: {
      user: normalizedUser,
      password: normalizedPassword,
      host: 'imap.gmail.com',
      port: 993,
      tls: true,
      authTimeout: 10000,
      tlsOptions: { rejectUnauthorized }
    }
  };
};

const syncMailbox = async ({ email, appPassword }) => {
  const normalizedEmail = String(email || '').trim();
  const normalizedPassword = String(appPassword || '').trim();
  if (!normalizedEmail || !normalizedPassword) return;

  const cfg = buildImapConfig({ email: normalizedEmail, appPassword: normalizedPassword });
  const sinceDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);

  let conn;
  try {
    conn = await Imap.connect(cfg);

    const inboxOpened = await openFirstAvailableBox(conn, ['INBOX']);
    if (inboxOpened) {
      await processMailboxMessages({
        conn,
        searchCriteria: ['UNSEEN', ['SINCE', sinceDate]]
      });
    }

    const sentOpened = await openFirstAvailableBox(conn, SENT_BOX_CANDIDATES);
    if (sentOpened) {
      await processMailboxMessages({
        conn,
        searchCriteria: [['SINCE', sinceDate]]
      });
    }
  } catch (err) {
    console.error('[ComplaintMailSync] mailbox sync failed:', err.message);
  } finally {
    if (conn) {
      try {
        await conn.end();
      } catch (_) {
        // ignore
      }
    }
  }
};

const runSync = async () => {
  if (syncRunning) return;
  syncRunning = true;
  try {
    await syncMailbox({
      email: getAdminSyncEmail(),
      appPassword: process.env.EMAIL_APP_PASSWORD || process.env.ADMIN_EMAIL_APP_PASSWORD
    });

    await syncMailbox({
      email: getDeveloperSyncEmail(),
      appPassword: process.env.DEVELOPER_EMAIL_APP_PASSWORD
    });
  } finally {
    syncRunning = false;
  }
};

const startComplaintMailSync = () => {
  if (String(process.env.COMPLAINT_MAIL_SYNC_ENABLED || 'true').toLowerCase() === 'false') return;
  if (syncTimer) return;

  const intervalMs = Math.max(Number(process.env.COMPLAINT_MAIL_SYNC_INTERVAL_MS || 90000), 30000);
  syncTimer = setInterval(runSync, intervalMs);
  runSync().catch(() => {});
  console.log(`[ComplaintMailSync] started with interval ${intervalMs}ms`);
};

module.exports = { startComplaintMailSync, runComplaintMailSyncNow: runSync };
