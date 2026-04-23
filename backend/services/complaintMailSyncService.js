const Imap = require('imap-simple');
const dns = require('node:dns').promises;
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
let lastDnsFailureLogAt = 0;

const parseAddressList = (addressObj) => {
  const values = Array.isArray(addressObj?.value) ? addressObj.value : [];
  return values.map((x) => String(x.address || '').toLowerCase().trim()).filter(Boolean);
};

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

const findReplyMarkerIndex = (lines) =>
  lines.findIndex((line) => {
    const trimmed = String(line || '').trim();
    return (
      /^On .+ wrote:$/i.test(trimmed) ||
      /^-{2,}\s*Original Message\s*-{2,}$/i.test(trimmed)
    );
  });

const getPrimaryMailBody = (value) => {
  const normalized = stripMailSyncTrackingHints(String(value || '').replace(/\r\n/g, '\n'));
  const splitLines = normalized.split('\n');
  const replyMarkerIndex = findReplyMarkerIndex(splitLines);
  return (replyMarkerIndex >= 0 ? splitLines.slice(0, replyMarkerIndex) : splitLines).join('\n');
};

const sanitizeMailSyncedBody = (value) => {
  const normalized = getPrimaryMailBody(value);

  // If the message includes an explicit "Solution:" section, keep content after it.
  const solutionMarker = normalized.match(/(?:^|\n)\s*Solution:\s*/i);
  const coreText = solutionMarker
    ? normalized.slice(solutionMarker.index + solutionMarker[0].length)
    : normalized;

  const lines = coreText
    .split('\n')
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

const COMPLAINT_REF_PATTERNS = [
  /\[\s*Complaint\s*#\s*([a-f0-9]{24})\s*\]/gi,
  /\bComplaint\s*Ref(?:erence)?(?:\s*No\.?)?\s*[:#-]?\s*\[\s*Complaint\s*#\s*([a-f0-9]{24})\s*\]/gi,
  /\bComplaint\s*#\s*([a-f0-9]{24})\b/gi
];

const QUERY_REF_PATTERNS = [
  /\[\s*Query\s*#\s*([a-f0-9]{24})\s*\]/gi,
  /\bQuery\s*Ref(?:erence)?(?:\s*No\.?)?\s*[:#-]?\s*\[\s*Query\s*#\s*([a-f0-9]{24})\s*\]/gi,
  /\bQuery\s*#\s*([a-f0-9]{24})\b/gi
];

const collectReferencedIds = (body, patterns) => {
  const primaryBody = getPrimaryMailBody(body);
  const ids = new Set();

  for (const pattern of patterns) {
    for (const match of primaryBody.matchAll(pattern)) {
      const id = String(match?.[1] || '').toLowerCase().trim();
      if (id) ids.add(id);
    }
  }

  return Array.from(ids);
};

const extractThreadReferenceFromBody = (body) => {
  const complaintIds = collectReferencedIds(body, COMPLAINT_REF_PATTERNS);
  const queryIds = collectReferencedIds(body, QUERY_REF_PATTERNS);

  if ((complaintIds.length + queryIds.length) !== 1) return null;
  if (complaintIds.length === 1) {
    return { kind: 'COMPLAINT', id: complaintIds[0] };
  }
  if (queryIds.length === 1) {
    return { kind: 'QUERY', id: queryIds[0] };
  }
  return null;
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

    const body = toPlainBody(parsed);
    if (isSystemGeneratedNotifyBody(body)) continue;
    const recipients = Array.from(
      new Set([...parseAddressList(parsed.to), ...parseAddressList(parsed.cc)])
    );
    const threadRef = extractThreadReferenceFromBody(body);
    if (!threadRef) continue;
    const messageId = String(parsed.messageId || '').trim();

    if (threadRef.kind === 'COMPLAINT') {
      const complaint = await Complaint.findById(threadRef.id);
      if (!complaint) continue;
      if (!recipients.includes(normalizeEmail(complaint.email))) continue;

      await addComplaintSolutionFromMail({
        complaint,
        fromEmail,
        body,
        messageId
      });
      continue;
    }

    if (threadRef.kind !== 'QUERY') continue;

    const queryDoc = await Query.findById(threadRef.id);
    if (!queryDoc) continue;
    if (!recipients.includes(normalizeEmail(queryDoc.email))) continue;

    await addQuerySolutionFromMail({
      queryDoc,
      fromEmail,
      body,
      messageId
    });
  }
};

const buildImapConfig = ({ email, appPassword }) => {
  const normalizedUser = String(email || '').trim();
  const normalizedPassword = String(appPassword || '').trim();
  const host = String(process.env.COMPLAINT_MAIL_IMAP_HOST || process.env.MAIL_IMAP_HOST || 'imap.gmail.com').trim();
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
      host,
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
  const imapHost = String(cfg?.imap?.host || '').trim();
  if (imapHost) {
    try {
      await dns.lookup(imapHost);
    } catch (dnsErr) {
      const now = Date.now();
      if (now - lastDnsFailureLogAt > 60000) {
        lastDnsFailureLogAt = now;
        console.error(
          `[ComplaintMailSync] DNS lookup failed for ${imapHost}: ${dnsErr?.code || dnsErr?.message || dnsErr}. Skipping this sync cycle.`
        );
      }
      return;
    }
  }

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
    console.error('[ComplaintMailSync] mailbox sync failed:', err?.code || err?.message || err);
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
