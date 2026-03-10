const Imap = require('imap-simple');
const { simpleParser } = require('mailparser');
const { createNotice } = require('./noticeService');

const DEFAULT_TARGET_RECIPIENT = 'bitmesraa@gmail.com';
const DEFAULT_ALLOWED_SENDER = 'vasudhank440@gmail.com';
const SENT_BOX_CANDIDATES = [
  '[Gmail]/Sent Mail',
  '[Google Mail]/Sent Mail',
  'Sent Mail',
  'Sent',
  'INBOX.Sent'
];

let syncTimer = null;
let syncRunning = false;

const maskEmail = (email) => {
  const value = String(email || '').trim();
  const [userPart, domainPart] = value.split('@');
  if (!userPart || !domainPart) return value || '-';
  if (userPart.length <= 2) return `${userPart[0] || '*'}*@${domainPart}`;
  return `${userPart.slice(0, 2)}***@${domainPart}`;
};

const toPlainBody = (parsed) => {
  const text = String(parsed?.text || '').trim();
  if (text) return text.slice(0, 20000);
  const html = String(parsed?.html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return html.slice(0, 20000);
};

const parseAddress = (addressObj) => {
  const value = Array.isArray(addressObj?.value) ? addressObj.value[0] : null;
  return String(value?.address || '').toLowerCase().trim();
};

const parseAddressList = (addressObj) =>
  (Array.isArray(addressObj?.value) ? addressObj.value : [])
    .map((x) => String(x?.address || '').toLowerCase().trim())
    .filter(Boolean);

const getMailboxConfig = () => {
  const user = String(process.env.NOTICE_MAIL_USER || process.env.EMAIL || DEFAULT_ALLOWED_SENDER).trim();
  const password = String(process.env.NOTICE_MAIL_APP_PASSWORD || process.env.EMAIL_APP_PASSWORD || '').trim();
  const rejectUnauthorized =
    String(
      process.env.NOTICE_MAIL_SYNC_TLS_REJECT_UNAUTHORIZED ||
      process.env.COMPLAINT_MAIL_SYNC_TLS_REJECT_UNAUTHORIZED ||
      'false'
    ).toLowerCase() !== 'false';

  const targetRecipient = String(process.env.NOTICE_TARGET_TO || DEFAULT_TARGET_RECIPIENT).toLowerCase().trim();
  const allowedSender = String(process.env.NOTICE_ALLOWED_FROM || DEFAULT_ALLOWED_SENDER).toLowerCase().trim();

  return {
    user,
    password,
    targetRecipient,
    allowedSender,
    imap: {
      user,
      password,
      host: 'imap.gmail.com',
      port: 993,
      tls: true,
      authTimeout: 10000,
      tlsOptions: { rejectUnauthorized }
    }
  };
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

const processMessagesFromBox = async ({ conn, boxName, searchCriteria, cfg, markSeen }) => {
  const messages = await conn.search(searchCriteria, {
    bodies: [''],
    markSeen,
    struct: true
  });

  let createdCount = 0;

  for (const msg of messages) {
    const part = msg.parts.find((p) => p.which === '');
    if (!part?.body) continue;

    const parsed = await simpleParser(part.body);
    const subject = String(parsed.subject || '').trim();
    const body = toPlainBody(parsed);
    if (!subject && !body) continue;

    const fromEmail = parseAddress(parsed.from);
    const recipients = new Set([
      ...parseAddressList(parsed.to),
      ...parseAddressList(parsed.cc),
      ...parseAddressList(parsed.bcc),
      ...parseAddressList(parsed.deliveredTo)
    ]);

    // Rule requested: only sender=vasudhank440@gmail.com and recipient includes bitmesraa@gmail.com
    if (fromEmail !== cfg.allowedSender) continue;
    if (!recipients.has(cfg.targetRecipient)) continue;

    const messageId = String(parsed.messageId || `${boxName}:${cfg.user}:${msg.attributes?.uid || Date.now()}`).trim();

    const result = await createNotice({
      subject: subject || 'Email Notice',
      body,
      source: 'EMAIL',
      emailFrom: fromEmail,
      emailMessageId: messageId,
      postedBy: {
        id: null,
        type: 'SYSTEM',
        name: fromEmail || 'Mail Sync'
      }
    });

    if (result?.created) createdCount += 1;
  }

  return createdCount;
};

const syncMailbox = async () => {
  const cfg = getMailboxConfig();
  if (!cfg.user || !cfg.password) return;

  const sinceDays = Math.max(Number(process.env.NOTICE_MAIL_SYNC_LOOKBACK_DAYS || 5), 1);
  const sinceDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const markSeen = String(process.env.NOTICE_MAIL_SYNC_MARK_SEEN || 'false').toLowerCase() === 'true';

  let conn = null;
  try {
    conn = await Imap.connect({ imap: cfg.imap });

    let created = 0;

    const inboxOpened = await openFirstAvailableBox(conn, ['INBOX']);
    if (inboxOpened) {
      created += await processMessagesFromBox({
        conn,
        boxName: inboxOpened,
        searchCriteria: ['UNSEEN', ['SINCE', sinceDate]],
        cfg,
        markSeen
      });
    }

    const sentOpened = await openFirstAvailableBox(conn, SENT_BOX_CANDIDATES);
    if (sentOpened) {
      created += await processMessagesFromBox({
        conn,
        boxName: sentOpened,
        searchCriteria: [['SINCE', sinceDate]],
        cfg,
        markSeen: false
      });
    }

    if (created > 0) {
      console.log(`[NoticeMailSync] synced ${created} new notice(s)`);
    }
  } catch (err) {
    console.error('[NoticeMailSync] sync failed:', err.message);
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
    await syncMailbox();
  } finally {
    syncRunning = false;
  }
};

const startNoticeMailSync = () => {
  if (String(process.env.NOTICE_MAIL_SYNC_ENABLED || 'true').toLowerCase() === 'false') return;
  if (syncTimer) return;

  const cfg = getMailboxConfig();
  const intervalMs = Math.max(Number(process.env.NOTICE_MAIL_SYNC_INTERVAL_MS || 60000), 30000);
  syncTimer = setInterval(runSync, intervalMs);
  runSync().catch(() => {});
  console.log(
    `[NoticeMailSync] started with interval ${intervalMs}ms (mailbox=${maskEmail(cfg.user)}, from=${maskEmail(cfg.allowedSender)}, to=${maskEmail(cfg.targetRecipient)})`
  );
};

module.exports = { startNoticeMailSync, runNoticeMailSyncNow: runSync };
