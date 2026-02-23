const express = require('express');
const nodemailer = require('nodemailer');
const { hashSync, compareSync } = require('bcrypt');
const Complaint = require('../models/complaint');
const { generateProjectSpecificSupportAnswer } = require('../services/supportAiService');

const router = express.Router();

const APP_BASE = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || process.env.EMAIL || '').toLowerCase().trim();
const DEV_EMAIL = (process.env.DEVELOPER_EMAIL || 'jarti2731@gmail.com').toLowerCase().trim();
const RESERVED_TRUSTED_EMAILS = [ADMIN_EMAIL, DEV_EMAIL].filter(Boolean);

const mailTransporter =
  process.env.EMAIL && process.env.EMAIL_APP_PASSWORD
    ? nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: { user: process.env.EMAIL, pass: process.env.EMAIL_APP_PASSWORD }
      })
    : null;

const getSessionRole = (req) => {
  if (!(req.isAuthenticated && req.isAuthenticated() && req.user)) return 'GUEST';
  const type = String(req.user.type || '').toUpperCase();
  if (type === 'ADMIN') return 'ADMIN';
  if (type === 'DEVELOPER') return 'DEVELOPER';
  if (type === 'DEPARTMENT') return 'DEPARTMENT';
  return 'GUEST';
};

const isTrustedRole = (role) => role === 'ADMIN' || role === 'DEVELOPER';

const safeMail = async (options) => {
  if (!mailTransporter) return;
  try {
    await mailTransporter.sendMail(options);
  } catch (err) {
    console.error('[ComplaintMail] send failed:', err.message);
  }
};

const sanitizeText = (value, max = 12000) => String(value || '').trim().slice(0, max);
const sanitizeEmail = (value) => String(value || '').trim().toLowerCase();
const fallbackGuestTag = () => Math.random().toString(36).slice(2, 10);
const getReactionVoterId = (req, fallbackVoterId = '') => {
  const role = getSessionRole(req);
  if (role !== 'GUEST' && req.user) {
    const stable = sanitizeEmail(req.user.email) || sanitizeText(req.user.id || req.user._id, 200).toLowerCase();
    if (stable) return `user:${stable}`;
  }
  return sanitizeText(fallbackVoterId, 200);
};
const readLegacyText = (obj, keys = []) => {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value);
    }
  }
  return '';
};
const resolveAuthorRole = (obj = {}) => {
  const role = String(obj.authorRole || obj.role || '').toUpperCase().trim();
  const type = String(obj.authorType || '').toUpperCase().trim();
  if ((!role || role === 'GUEST') && type) return type;
  return role || type || 'GUEST';
};

const formatDate = (d) =>
  new Date(d).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });

const getUserReaction = (reactions = [], voterId = '') => {
  const id = String(voterId || '').trim();
  if (!id) return 0;
  return Number((reactions.find((x) => String(x.voterId || '') === id) || {}).value || 0);
};

const toPublicSolution = (solution, voterId = '') => {
  const normalizedRole = resolveAuthorRole(solution);
  const normalizedVoterId = String(voterId || '').trim();
  const solutionReactions = Array.isArray(solution.reactions) ? solution.reactions : [];
  return ({
  _id: solution._id,
  authorName: solution.authorName || solution.name || 'Unknown',
  authorEmail: solution.authorEmail || solution.email || '',
  authorRole: normalizedRole,
  trusted:
    Boolean(solution.trusted) ||
    Boolean(solution.isTrusted) ||
    ['ADMIN', 'DEVELOPER'].includes(normalizedRole) ||
    RESERVED_TRUSTED_EMAILS.includes(sanitizeEmail(solution.authorEmail || solution.email || '')),
  isAIGenerated: Boolean(solution.isAIGenerated || solution.aiGenerated),
  isAIPending: Boolean(solution.isAIPending),
  source: solution.source || 'MANUAL',
  body:
    readLegacyText(solution, ['body', 'content', 'message', 'solution']) ||
    (solution.isAIPending ? 'Thinking...' : ''),
  likes: Number(solution.likes || solution.upvotes || 0),
  dislikes: Number(solution.dislikes || solution.downvotes || 0),
  userReaction: getUserReaction(solutionReactions, normalizedVoterId),
  replies:
    (solution.replies || []).map((reply) => ({
      // Resolve legacy role first so old docs don't show as Guest.
      ...(() => {
        const replyRole = resolveAuthorRole(reply);
        const replyReactions = Array.isArray(reply.reactions) ? reply.reactions : [];
        return {
      _id: reply._id,
      parentReplyId: reply.parentReplyId || reply.parentId || null,
      authorName: reply.authorName || reply.name || 'Unknown',
      authorEmail: reply.authorEmail || reply.email || '',
      authorRole: replyRole,
      trusted:
        Boolean(reply.trusted) ||
        Boolean(reply.isTrusted) ||
        ['ADMIN', 'DEVELOPER'].includes(replyRole) ||
        RESERVED_TRUSTED_EMAILS.includes(sanitizeEmail(reply.authorEmail || reply.email || '')),
      body: readLegacyText(reply, ['body', 'content', 'message', 'text']),
      upvotes: Number(reply.upvotes || reply.likes || 0),
      downvotes: Number(reply.downvotes || reply.dislikes || 0),
      userReaction: getUserReaction(replyReactions, normalizedVoterId),
      createdAt: reply.createdAt || reply.updatedAt || new Date()
        };
      })()
    })) || [],
  createdAt: solution.createdAt || solution.updatedAt || new Date()
});
};

const toPublicComplaint = (doc, voterId = '') => {
  const solutions = (doc.solutions || []).map((s) => toPublicSolution(s, voterId));
  const trustedCount = solutions.filter((s) => s.trusted).length;
  const aiPendingCount = solutions.filter((s) => s.isAIPending).length;
  return {
    _id: doc._id,
    title: readLegacyText(doc, ['title', 'issueTitle', 'subject']) || 'Untitled Complaint',
    message: readLegacyText(doc, ['message', 'description', 'issue', 'body']),
    email: sanitizeEmail(readLegacyText(doc, ['email', 'reporterEmail', 'userEmail'])),
    status: doc.status,
    source: doc.source,
    createdByRole: doc.createdByRole || doc.createdByType || 'GUEST',
    resolvedAt: doc.resolvedAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    lastActivityAt: doc.lastActivityAt,
    solutionsCount: solutions.length,
    trustedCount,
    aiPendingCount,
    solutions
  };
};

const maybeAutoCloseResolved = async () => {
  const now = Date.now();
  const resolved = await Complaint.find({ status: 'RESOLVED' }, '_id lastActivityAt autoCloseAfterDays');
  const toCloseIds = resolved
    .filter((c) => {
      const days = Math.max(Number(c.autoCloseAfterDays || 7), 1);
      const expiry = new Date(c.lastActivityAt || c.updatedAt || c.createdAt).getTime() + days * 24 * 60 * 60 * 1000;
      return now >= expiry;
    })
    .map((c) => c._id);

  if (toCloseIds.length > 0) {
    await Complaint.updateMany(
      { _id: { $in: toCloseIds }, status: 'RESOLVED' },
      { $set: { status: 'CLOSED', lastActivityAt: new Date() } }
    );
  }
};

const sendRaisedNotification = async (complaint) => {
  const threadUrl = `${APP_BASE}/complaints/${complaint._id}`;
  const subject = `New Complaint: ${complaint.title} [Complaint#${complaint._id}]`;
  const html = `
    <div style="font-family:Arial,sans-serif;padding:14px">
      <h2 style="margin:0 0 12px">New Complaint Raised</h2>
      <p><b>Title:</b> ${complaint.title}</p>
      <p><b>Reporter:</b> ${complaint.email}</p>
      <p><b>Posted:</b> ${formatDate(complaint.createdAt)}</p>
      <p><b>Complaint Ref:</b> [Complaint#${complaint._id}]</p>
      <div style="margin:14px 0;padding:10px;border:1px solid #ddd;border-radius:8px;white-space:pre-wrap">${complaint.message}</div>
      <p><a href="${threadUrl}" target="_blank" rel="noreferrer">Open complaint thread</a></p>
      <p>
        <a href="mailto:${complaint.email}?subject=${encodeURIComponent(`Regarding complaint: ${complaint.title}`)}&body=${encodeURIComponent(`Complaint Ref: [Complaint#${complaint._id}]\nDo not change/remove subject or reference number for tracking.`)}">
          Reply to reporter (subject auto-filled)
        </a>
      </p>
      <p>Reply email tip: use subject <b>Regarding complaint: ${complaint.title}</b> and keep complaint ref in body for sync.</p>
      <p><b>Important:</b> Do not change/remove subject text or complaint reference number.</p>
    </div>
  `;
  const receivers = [ADMIN_EMAIL, DEV_EMAIL].filter(Boolean).join(',');
  await safeMail({ to: receivers, subject, html });
};

const sendReporterSolutionMail = async ({ complaint, solution }) => {
  if (!complaint.email) return;
  const subject = `Regarding complaint: ${complaint.title}`;
  const senderName = sanitizeText(solution.authorName || 'Support', 120) || 'Support';
  const senderEmail = sanitizeEmail(solution.authorEmail || '');
  const html = `
    <div style="font-family:Arial,sans-serif;padding:14px">
      <h3 style="margin:0 0 12px">New ${solution.trusted ? 'trusted ' : ''}solution on your complaint</h3>
      <p><b>Complaint:</b> ${complaint.title}</p>
      <p><b>Complaint Ref:</b> [Complaint#${complaint._id}]</p>
      <p><b>From:</b> ${senderName}${senderEmail ? ` (${senderEmail})` : ''}</p>
      <div style="margin:14px 0;padding:10px;border:1px solid #ddd;border-radius:8px;white-space:pre-wrap">${solution.body}</div>
      <p><a href="${APP_BASE}/complaints/${complaint._id}" target="_blank" rel="noreferrer">Open thread</a></p>
    </div>
  `;
  const fromAddress = process.env.EMAIL ? `"${senderName} via BIT-Booking" <${process.env.EMAIL}>` : undefined;
  await safeMail({
    to: complaint.email,
    subject,
    html,
    from: fromAddress,
    replyTo: senderEmail || undefined,
    headers: {
      'X-BIT-Auto-Notify': '1',
      'X-BIT-Thread-Type': 'complaint',
      'X-BIT-Thread-Id': String(complaint._id)
    }
  });
};

const updateReactionBucket = (bucket, voterId, value) => {
  const normalizedVoterId = String(voterId || '').trim();
  if (!normalizedVoterId) return { likes: 0, dislikes: 0, userReaction: 0 };

  const current = Array.isArray(bucket.reactions) ? [...bucket.reactions] : [];
  const existingIndex = current.findIndex((x) => x.voterId === normalizedVoterId);
  const target = value === 1 || value === -1 ? value : 0;
  let next = current;

  if (existingIndex === -1 && target !== 0) {
    next = [...current, { voterId: normalizedVoterId, value: target }];
  } else if (existingIndex !== -1) {
    const existing = current[existingIndex];
    if (target === 0 || existing.value === target) {
      next = current.filter((x) => x.voterId !== normalizedVoterId);
    } else {
      next[existingIndex].value = target;
    }
  }

  bucket.reactions = next;
  bucket.likes = next.filter((x) => x.value === 1).length;
  bucket.dislikes = next.filter((x) => x.value === -1).length;
  const userReaction = (next.find((x) => x.voterId === normalizedVoterId) || {}).value || 0;

  return { likes: bucket.likes, dislikes: bucket.dislikes, userReaction };
};

const spawnAutoAiReply = async ({ complaintId, pendingSolutionId, title, message, email }) => {
  try {
    const aiText = await generateProjectSpecificSupportAnswer({
      kind: 'COMPLAINT',
      threadId: complaintId,
      title,
      message,
      email
    });

    const complaint = await Complaint.findById(complaintId);
    if (!complaint) return;
    const target = complaint.solutions.id(pendingSolutionId);
    if (!target) return;

    target.body = aiText;
    target.isAIPending = false;
    complaint.lastActivityAt = new Date();
    await complaint.save();
  } catch (err) {
    console.error('[Complaints][AI] async reply failed:', err.message);
    try {
      const complaint = await Complaint.findById(complaintId);
      if (!complaint) return;
      const target = complaint.solutions.id(pendingSolutionId);
      if (!target) return;
      target.body = 'AI Generated: Unable to complete right now. Please wait for trusted admin/developer response.';
      target.isAIPending = false;
      await complaint.save();
    } catch (_) {
      // ignore
    }
  }
};

router.get('/', async (req, res) => {
  try {
    await maybeAutoCloseResolved();
    const voterId = getReactionVoterId(req, req.query.viewerId);

    const filter = String(req.query.filter || 'ACTIVE').toUpperCase();
    const q = sanitizeText(req.query.q || '', 200);
    const sort = String(req.query.sort || 'DATE_DESC').toUpperCase();

    let statusQuery = {};
    if (filter === 'ACTIVE') {
      statusQuery = { status: { $in: ['IN_PROGRESS', 'REOPENED'] } };
    } else if (filter === 'RESOLVED') {
      statusQuery = { status: { $in: ['RESOLVED', 'CLOSED'] } };
    }

    const searchQuery = q
      ? {
          $or: [
            { title: { $regex: q, $options: 'i' } },
            { message: { $regex: q, $options: 'i' } },
            { email: { $regex: q, $options: 'i' } }
          ]
        }
      : {};

    const query = { ...statusQuery, ...searchQuery };
    let docs = await Complaint.find(query).sort({ createdAt: -1 });
    let list = docs.map((d) => toPublicComplaint(d, voterId));

    const sorters = {
      DATE_DESC: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
      DATE_ASC: (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
      TITLE_ASC: (a, b) => a.title.localeCompare(b.title),
      TITLE_DESC: (a, b) => b.title.localeCompare(a.title),
      EMAIL_ASC: (a, b) => a.email.localeCompare(b.email),
      EMAIL_DESC: (a, b) => b.email.localeCompare(a.email),
      SOLUTIONS_DESC: (a, b) => b.solutionsCount - a.solutionsCount,
      SOLUTIONS_ASC: (a, b) => a.solutionsCount - b.solutionsCount,
      TRUSTED_DESC: (a, b) => b.trustedCount - a.trustedCount,
      TRUSTED_ASC: (a, b) => a.trustedCount - b.trustedCount
    };
    list.sort(sorters[sort] || sorters.DATE_DESC);

    res.json({ complaints: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const voterId = getReactionVoterId(req, req.body.viewerId || req.body.voterId);
    const title = sanitizeText(req.body.title, 300);
    const message = sanitizeText(req.body.message, 20000);
    const email = sanitizeEmail(req.body.email);
    if (!title || !message || !email) {
      return res.status(400).json({ error: 'title, message and email are required' });
    }

    const role = getSessionRole(req);
    const complaint = new Complaint({
      title,
      message,
      email,
      source: role === 'ADMIN' ? 'ADMIN' : role === 'DEVELOPER' ? 'DEVELOPER' : 'WEB',
      createdByRole: role,
      createdById: req.user?.id || null
    });

    // Immediate visible AI placeholder
    complaint.solutions.push({
      authorName: 'AI Assistant',
      authorEmail: 'ai@bit-booking.local',
      authorRole: 'AI',
      trusted: false,
      isAIGenerated: true,
      isAIPending: true,
      source: 'AI_AUTOREPLY',
      body: 'Thinking...'
    });

    await complaint.save();
    await sendRaisedNotification(complaint);

    const pendingSolutionId = complaint.solutions[0]?._id;
    if (pendingSolutionId) {
      setTimeout(() => {
        spawnAutoAiReply({
          complaintId: complaint._id,
          pendingSolutionId,
          title,
          message,
          email
        });
      }, 100);
    }

    res.status(201).json({ complaint: toPublicComplaint(complaint, voterId) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    await maybeAutoCloseResolved();
    const voterId = getReactionVoterId(req, req.query.viewerId);
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) return res.status(404).json({ error: 'Complaint not found' });
    res.json({ complaint: toPublicComplaint(complaint, voterId) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/solutions', async (req, res) => {
  try {
    const voterId = getReactionVoterId(req, req.body.viewerId || req.body.voterId);
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) return res.status(404).json({ error: 'Complaint not found' });

    const body = sanitizeText(req.body.body, 12000);
    if (!body) return res.status(400).json({ error: 'Solution text is required' });

    const role = getSessionRole(req);
    const trusted = isTrustedRole(role);
    let authorEmail = trusted ? sanitizeEmail(req.user?.email) : sanitizeEmail(req.body.authorEmail);
    let authorName = sanitizeText(req.body.authorName || '', 120);

    if (trusted) {
      authorName = role === 'ADMIN' ? 'Admin' : 'Developer';
    }

    if (!authorEmail || !authorName) {
      return res.status(400).json({ error: 'authorName and authorEmail are required' });
    }

    if (!trusted && RESERVED_TRUSTED_EMAILS.includes(authorEmail)) {
      return res.status(403).json({ error: "You are using admin/developer's email id. Login with trusted account to post trusted solution." });
    }

    const solution = {
      authorName,
      authorEmail,
      authorRole: trusted ? role : 'GUEST',
      trusted,
      isAIGenerated: false,
      source: 'MANUAL',
      body
    };
    complaint.solutions.push(solution);
    complaint.lastActivityAt = new Date();
    if (complaint.status === 'RESOLVED' || complaint.status === 'CLOSED') {
      complaint.status = 'REOPENED';
      complaint.resolvedAt = null;
    }

    await complaint.save();

    const latest = complaint.solutions[complaint.solutions.length - 1];
    await sendReporterSolutionMail({ complaint, solution: latest });

    res.json({
      complaint: toPublicComplaint(complaint, voterId),
      solution: toPublicSolution(latest, voterId)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/quick-solution', async (req, res) => {
  const role = getSessionRole(req);
  if (!isTrustedRole(role)) {
    return res.status(403).json({ error: 'Only admin/developer can use quick solution.' });
  }

  try {
    const voterId = getReactionVoterId(req, req.body.viewerId || req.body.voterId);
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) return res.status(404).json({ error: 'Complaint not found' });

    const body = sanitizeText(req.body.body, 12000);
    if (!body) return res.status(400).json({ error: 'Solution text is required' });

    complaint.solutions.push({
      authorName: role === 'ADMIN' ? 'Admin' : 'Developer',
      authorEmail: sanitizeEmail(req.user?.email),
      authorRole: role,
      trusted: true,
      isAIGenerated: false,
      source: 'MANUAL',
      body
    });
    complaint.lastActivityAt = new Date();
    if (complaint.status === 'RESOLVED' || complaint.status === 'CLOSED') {
      complaint.status = 'REOPENED';
      complaint.resolvedAt = null;
    }
    await complaint.save();

    const latest = complaint.solutions[complaint.solutions.length - 1];
    await sendReporterSolutionMail({ complaint, solution: latest });
    res.json({ complaint: toPublicComplaint(complaint, voterId), solution: toPublicSolution(latest, voterId) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/solutions/:solutionId/react', async (req, res) => {
  try {
    const voterId = getReactionVoterId(req, req.body.voterId);
    const value = Number(req.body.value || 0);

    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) return res.status(404).json({ error: 'Complaint not found' });
    const solution = complaint.solutions.id(req.params.solutionId);
    if (!solution) return res.status(404).json({ error: 'Solution not found' });

    const result = updateReactionBucket(solution, voterId, value);
    complaint.lastActivityAt = new Date();
    await complaint.save();

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/solutions/:solutionId/replies', async (req, res) => {
  try {
    const voterId = getReactionVoterId(req, req.body.viewerId || req.body.voterId);
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) return res.status(404).json({ error: 'Complaint not found' });
    const solution = complaint.solutions.id(req.params.solutionId);
    if (!solution) return res.status(404).json({ error: 'Solution not found' });

    const role = getSessionRole(req);
    const trusted = isTrustedRole(role);
    const fallbackVoterId = getReactionVoterId(req, req.body.voterId);
    let authorEmail = trusted ? sanitizeEmail(req.user?.email) : sanitizeEmail(req.body.authorEmail);
    let authorName = sanitizeText(req.body.authorName || '', 120);
    const body = sanitizeText(req.body.body, 12000);
    const parentReplyId = req.body.parentReplyId || null;

    if (trusted) {
      authorName = role === 'ADMIN' ? 'Admin' : 'Developer';
    } else {
      if (!authorName) authorName = 'Guest';
      if (!authorEmail) {
        const guestTag = sanitizeText(fallbackVoterId || '', 200).replace(/[^a-zA-Z0-9]/g, '').slice(0, 24) || fallbackGuestTag();
        authorEmail = `guest+${guestTag}@bit-booking.local`;
      }
    }

    if (!body) {
      return res.status(400).json({ error: 'Reply message is required' });
    }

    if (!trusted && RESERVED_TRUSTED_EMAILS.includes(authorEmail)) {
      return res.status(403).json({ error: "You are using admin/developer's email id. Login with trusted account to reply as trusted." });
    }

    solution.replies.push({
      parentReplyId,
      authorName,
      authorEmail,
      authorRole: trusted ? role : 'GUEST',
      trusted,
      body
    });
    complaint.lastActivityAt = new Date();
    await complaint.save();

    const latest = solution.replies[solution.replies.length - 1];
    res.json({
      reply: {
        _id: latest._id,
        parentReplyId: latest.parentReplyId,
        authorName: latest.authorName,
        authorEmail: latest.authorEmail,
        trusted: latest.trusted,
        body: latest.body,
        upvotes: latest.upvotes,
        downvotes: latest.downvotes,
        createdAt: latest.createdAt
      },
      complaint: toPublicComplaint(complaint, voterId)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/solutions/:solutionId/replies/:replyId/react', async (req, res) => {
  try {
    const voterId = getReactionVoterId(req, req.body.voterId);
    const value = Number(req.body.value || 0);
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) return res.status(404).json({ error: 'Complaint not found' });
    const solution = complaint.solutions.id(req.params.solutionId);
    if (!solution) return res.status(404).json({ error: 'Solution not found' });
    const reply = solution.replies.id(req.params.replyId);
    if (!reply) return res.status(404).json({ error: 'Reply not found' });

    const result = updateReactionBucket(reply, voterId, value);
    reply.upvotes = result.likes;
    reply.downvotes = result.dislikes;
    complaint.lastActivityAt = new Date();
    await complaint.save();

    res.json({ upvotes: reply.upvotes, downvotes: reply.downvotes, userReaction: result.userReaction });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/status', async (req, res) => {
  try {
    const voterId = getReactionVoterId(req, req.body.viewerId || req.body.voterId);
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) return res.status(404).json({ error: 'Complaint not found' });

    const role = getSessionRole(req);
    const trusted = isTrustedRole(role);
    const nextStatus = String(req.body.status || '').toUpperCase();
    const allowed = ['IN_PROGRESS', 'RESOLVED', 'REOPENED', 'CLOSED'];
    if (!allowed.includes(nextStatus)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    if (!trusted) {
      return res.status(403).json({ error: 'Only admin/developer can change status directly.' });
    }

    if (nextStatus === 'RESOLVED') complaint.resolvedAt = new Date();
    if (nextStatus === 'REOPENED' || nextStatus === 'IN_PROGRESS') complaint.resolvedAt = null;

    complaint.status = nextStatus;
    complaint.lastActivityAt = new Date();
    await complaint.save();

    res.json({ complaint: toPublicComplaint(complaint, voterId) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/reopen/request-otp', async (req, res) => {
  try {
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) return res.status(404).json({ error: 'Complaint not found' });
    const email = sanitizeEmail(req.body.email);
    if (!email || email !== sanitizeEmail(complaint.email)) {
      return res.status(403).json({ error: 'Email does not match complaint reporter.' });
    }

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    complaint.emailReopenOtpHash = hashSync(otp, 10);
    complaint.emailReopenOtpExpiry = new Date(Date.now() + 10 * 60 * 1000);
    await complaint.save();

    await safeMail({
      to: email,
      subject: `Complaint Reopen OTP [Complaint#${complaint._id}]`,
      html: `
        <div style="font-family:Arial,sans-serif;padding:14px">
          <h3>Verify to Reopen Complaint</h3>
          <p>Complaint: <b>${complaint.title}</b></p>
          <p>Your OTP is: <b style="font-size:20px;letter-spacing:3px">${otp}</b></p>
          <p>OTP valid for 10 minutes.</p>
        </div>
      `
    });

    res.json({ success: true, message: 'OTP sent to complaint reporter email.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/reopen/verify-otp', async (req, res) => {
  try {
    const voterId = getReactionVoterId(req, req.body.viewerId || req.body.voterId);
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) return res.status(404).json({ error: 'Complaint not found' });
    const email = sanitizeEmail(req.body.email);
    const otp = sanitizeText(req.body.otp, 10);
    if (!email || !otp) return res.status(400).json({ error: 'email and otp are required' });
    if (email !== sanitizeEmail(complaint.email)) {
      return res.status(403).json({ error: 'Email does not match complaint reporter.' });
    }

    if (!complaint.emailReopenOtpHash || !complaint.emailReopenOtpExpiry || complaint.emailReopenOtpExpiry < new Date()) {
      return res.status(400).json({ error: 'OTP expired. Request new OTP.' });
    }
    if (!compareSync(otp, complaint.emailReopenOtpHash)) {
      return res.status(400).json({ error: 'Invalid OTP.' });
    }

    complaint.status = 'REOPENED';
    complaint.resolvedAt = null;
    complaint.lastActivityAt = new Date();
    complaint.emailReopenOtpHash = null;
    complaint.emailReopenOtpExpiry = null;
    await complaint.save();

    res.json({ complaint: toPublicComplaint(complaint, voterId) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
