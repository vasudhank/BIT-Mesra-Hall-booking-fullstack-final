const Imap = require('imap-simple');
const dns = require('node:dns').promises;
const { simpleParser } = require('mailparser');
const { createNotice } = require('./noticeService');

const DEFAULT_TARGET_RECIPIENT = 'bitmesraa@gmail.com';
const SENT_BOX_CANDIDATES = [
  '[Gmail]/Sent Mail',
  '[Google Mail]/Sent Mail',
  'Sent Mail',
  'Sent',
  'INBOX.Sent'
];

let syncTimer = null;
let syncRunning = false;
let lastDnsFailureLogAt = 0;
let missingCredentialWarningPrinted = false;

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

const extractEmailsFromHeaderValue = (value) =>
  uniqueStrings(
    String(value || '')
      .match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []
  )
    .map((email) => email.toLowerCase());

const uniqueStrings = (list) =>
  Array.from(
    new Set(
      (Array.isArray(list) ? list : [])
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    )
  );

const collectRecipients = (parsed) => {
  const headers = parsed?.headers;
  return new Set(
    uniqueStrings([
      ...parseAddressList(parsed.to),
      ...parseAddressList(parsed.cc),
      ...parseAddressList(parsed.bcc),
      ...parseAddressList(parsed.deliveredTo),
      ...extractEmailsFromHeaderValue(headers?.get?.('delivered-to')),
      ...extractEmailsFromHeaderValue(headers?.get?.('x-original-to')),
      ...extractEmailsFromHeaderValue(headers?.get?.('envelope-to'))
    ]).map((email) => email.toLowerCase())
  );
};

const isAutomatedMailboxMessage = (parsed, fromEmail) => {
  const subject = String(parsed?.subject || '').trim();
  const autoSubmitted = String(parsed?.headers?.get?.('auto-submitted') || '').toLowerCase().trim();
  const precedence = String(parsed?.headers?.get?.('precedence') || '').toLowerCase().trim();

  return (
    /\b(mailer-daemon|postmaster)\b/i.test(String(fromEmail || '')) ||
    (autoSubmitted && autoSubmitted !== 'no') ||
    ['bulk', 'junk', 'list', 'auto_reply'].includes(precedence) ||
    /^(delivery status notification|undelivered mail returned to sender|automatic reply|auto reply|out of office)/i.test(subject)
  );
};

const getMailboxConfig = () => {
  const adminMailbox = String(process.env.EMAIL || '').toLowerCase().trim();
  const explicitNoticeUser = String(process.env.NOTICE_MAIL_USER || '').toLowerCase().trim();
  const user = String(explicitNoticeUser || adminMailbox || DEFAULT_TARGET_RECIPIENT).trim();
  const targetRecipient = String(process.env.NOTICE_TARGET_TO || user || DEFAULT_TARGET_RECIPIENT).toLowerCase().trim();
  const password = String(
    explicitNoticeUser
      ? process.env.NOTICE_MAIL_APP_PASSWORD || ''
      : process.env.NOTICE_MAIL_APP_PASSWORD || process.env.EMAIL_APP_PASSWORD || ''
  ).trim();
  const host = String(process.env.NOTICE_MAIL_IMAP_HOST || process.env.MAIL_IMAP_HOST || 'imap.gmail.com').trim();
  const allowedSender = String(process.env.NOTICE_ALLOWED_FROM || explicitNoticeUser || '').toLowerCase().trim();
  const includeSent = String(process.env.NOTICE_MAIL_SYNC_INCLUDE_SENT || 'false').toLowerCase() === 'true';
  const rejectUnauthorized =
    String(
      process.env.NOTICE_MAIL_SYNC_TLS_REJECT_UNAUTHORIZED ||
      process.env.COMPLAINT_MAIL_SYNC_TLS_REJECT_UNAUTHORIZED ||
      'false'
    ).toLowerCase() !== 'false';

  return {
    user,
    password,
    targetRecipient,
    allowedSender,
    includeSent,
    imap: {
      user,
      password,
      host,
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
    const recipients = collectRecipients(parsed);
    const mailboxUser = String(cfg.user || '').toLowerCase().trim();
    const sentByMailboxUser = mailboxUser && fromEmail === mailboxUser;
    const sentToTargetRecipient = recipients.has(cfg.targetRecipient);
    const isRelevantNoticeMail = sentToTargetRecipient || (cfg.includeSent && sentByMailboxUser);

    if (!fromEmail) continue;
    if (cfg.allowedSender && fromEmail !== cfg.allowedSender) continue;
    if (!isRelevantNoticeMail) continue;
    if (isAutomatedMailboxMessage(parsed, fromEmail)) continue;

    const messageId = String(parsed.messageId || `${boxName}:${cfg.user}:${msg.attributes?.uid || Date.now()}`).trim();

    const result = await createNotice({
      subject: subject || 'Email Notice',
      body,
      source: 'EMAIL',
      emailFrom: fromEmail,
      emailMessageId: messageId,
      postedBy: {
        id: null,
        type: 'EMAIL',
        name: fromEmail || 'Mail Sync'
      }
    });

    if (result?.created) createdCount += 1;
  }

  return createdCount;
};

const syncMailbox = async () => {
  const cfg = getMailboxConfig();
  if (!cfg.user || !cfg.password) {
    if (!missingCredentialWarningPrinted) {
      missingCredentialWarningPrinted = true;
      console.warn(
        '[NoticeMailSync] disabled: missing mailbox credentials. Set NOTICE_MAIL_USER and NOTICE_MAIL_APP_PASSWORD (or EMAIL and EMAIL_APP_PASSWORD). If NOTICE_MAIL_USER is set, NOTICE_MAIL_APP_PASSWORD is required.'
      );
    }
    return;
  }

  const sinceDays = Math.max(Number(process.env.NOTICE_MAIL_SYNC_LOOKBACK_DAYS || 5), 1);
  const sinceDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const markSeen = String(process.env.NOTICE_MAIL_SYNC_MARK_SEEN || 'false').toLowerCase() === 'true';
  const imapHost = String(cfg?.imap?.host || '').trim();

  if (imapHost) {
    try {
      await dns.lookup(imapHost);
    } catch (dnsErr) {
      const now = Date.now();
      if (now - lastDnsFailureLogAt > 60000) {
        lastDnsFailureLogAt = now;
        console.error(
          `[NoticeMailSync] DNS lookup failed for ${imapHost}: ${dnsErr?.code || dnsErr?.message || dnsErr}. Skipping this sync cycle.`
        );
      }
      return;
    }
  }

  let conn = null;
  try {
    conn = await Imap.connect({ imap: cfg.imap });

    let created = 0;

    const inboxOpened = await openFirstAvailableBox(conn, ['INBOX']);
    if (inboxOpened) {
      created += await processMessagesFromBox({
        conn,
        boxName: inboxOpened,
        searchCriteria: [['SINCE', sinceDate]],
        cfg,
        markSeen
      });
    }

    if (cfg.includeSent) {
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
    }

    if (created > 0) {
      console.log(`[NoticeMailSync] synced ${created} new notice(s)`);
    }
  } catch (err) {
    console.error('[NoticeMailSync] sync failed:', err?.code || err?.message || err);
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
    `[NoticeMailSync] started with interval ${intervalMs}ms (mailbox=${maskEmail(cfg.user)}, to=${maskEmail(cfg.targetRecipient)}, from=${cfg.allowedSender ? maskEmail(cfg.allowedSender) : 'any sender'}, includeSent=${cfg.includeSent})`
  );
};

module.exports = { startNoticeMailSync, runNoticeMailSyncNow: runSync };
