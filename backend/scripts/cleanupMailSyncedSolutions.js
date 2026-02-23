require('dotenv').config();
const mongoose = require('mongoose');
const Complaint = require('../models/complaint');
const Query = require('../models/query');

const normalize = (value) => String(value || '').replace(/\r\n/g, '\n');

const stripTrackingHints = (value) =>
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
  /^Seminar Hall Booking System$/i
];

const isMetadataLine = (line) => {
  const text = String(line || '').trim();
  if (!text) return false;
  if (METADATA_LINE_PATTERNS.some((re) => re.test(text))) return true;
  if (/^https?:\/\/\S+$/i.test(text)) return true;
  if (/^\[.*mailto:.*\]$/i.test(text)) return true;
  if (text.includes('subject=Regarding%20') && text.includes('Query%20Ref%3A')) return true;
  return false;
};

const sanitize = (value) =>
  (function () {
    const normalized = stripTrackingHints(normalize(value));
    const solutionMarker = normalized.match(/(?:^|\n)\s*Solution:\s*/i);
    const coreText = solutionMarker
      ? normalized.slice(solutionMarker.index + solutionMarker[0].length)
      : normalized;
    return coreText;
  })()
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(
      (line) =>
        !isMetadataLine(line) &&
        !/^important:\s*do not change\/remove subject text or (complaint|query) reference number\.?$/i.test(
          line.trim()
        ) &&
        !/^do not change\/remove subject or reference number for tracking\.?$/i.test(line.trim())
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const isRaisedNotification = (value) => {
  const b = String(value || '').toLowerCase();
  return (
    (b.includes('new query raised') || b.includes('new complaint raised')) &&
    (b.includes('reply to reporter') ||
      b.includes('subject auto-filled') ||
      b.includes('open query thread') ||
      b.includes('open complaint thread'))
  );
};

const cleanCollection = async (Model, label) => {
  const docs = await Model.find({ 'solutions.source': 'EMAIL_SYNC' });
  let updatedDocs = 0;
  let removedSolutions = 0;
  let cleanedBodies = 0;

  for (const doc of docs) {
    let changed = false;
    const nextSolutions = [];

    for (const solution of doc.solutions || []) {
      if (solution.source !== 'EMAIL_SYNC') {
        nextSolutions.push(solution);
        continue;
      }

      const rawBody = String(solution.body || '');
      if (isRaisedNotification(rawBody)) {
        removedSolutions += 1;
        changed = true;
        continue;
      }

      const cleanedBody = sanitize(rawBody);
      if (!cleanedBody) {
        removedSolutions += 1;
        changed = true;
        continue;
      }

      if (cleanedBody !== rawBody) {
        solution.body = cleanedBody;
        cleanedBodies += 1;
        changed = true;
      }

      nextSolutions.push(solution);
    }

    if (changed) {
      doc.solutions = nextSolutions;
      doc.lastActivityAt = new Date();
      await doc.save();
      updatedDocs += 1;
    }
  }

  console.log(
    `[Cleanup][${label}] updatedDocs=${updatedDocs} removedSolutions=${removedSolutions} cleanedBodies=${cleanedBodies}`
  );
};

const run = async () => {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI is missing in environment.');
  }

  await mongoose.connect(mongoUri);
  try {
    await cleanCollection(Complaint, 'Complaint');
    await cleanCollection(Query, 'Query');
  } finally {
    await mongoose.disconnect();
  }
};

run()
  .then(() => {
    console.log('[Cleanup] done');
  })
  .catch((err) => {
    console.error('[Cleanup] failed:', err.message);
    process.exitCode = 1;
  });
