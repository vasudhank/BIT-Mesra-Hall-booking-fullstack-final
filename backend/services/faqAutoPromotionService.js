const Query = require('../models/query');
const FAQ = require('../models/faq');
const { generateProjectSpecificSupportAnswer } = require('./supportAiService');

let promoTimer = null;
let running = false;

const normalizeIntent = (text) =>
  String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);

const runAutoPromotion = async () => {
  if (running) return;
  running = true;

  try {
    const windowDays = Math.max(Number(process.env.FAQ_PROMOTION_WINDOW_DAYS || 30), 7);
    const minUnique = Math.max(Number(process.env.FAQ_PROMOTION_MIN_UNIQUE || 50), 5);
    const fromDate = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    const candidates = await Query.find({ createdAt: { $gte: fromDate } }, 'title message email');
    const bucket = new Map();

    for (const row of candidates) {
      const intentKey = normalizeIntent(row.title || row.message);
      if (!intentKey) continue;
      if (!bucket.has(intentKey)) {
        bucket.set(intentKey, {
          intentKey,
          titleSamples: [],
          emails: new Set(),
          rows: 0
        });
      }
      const entry = bucket.get(intentKey);
      entry.rows += 1;
      entry.titleSamples.push(row.title || row.message);
      entry.emails.add(String(row.email || '').toLowerCase().trim());
    }

    for (const [, entry] of bucket) {
      const uniqueUsers = entry.emails.size;
      if (uniqueUsers < minUnique) continue;

      const existing = await FAQ.findOne({ intentKey: entry.intentKey, active: true });
      if (existing) continue;

      const question = entry.titleSamples[0] || 'Frequently asked query';
      const answer = await generateProjectSpecificSupportAnswer({
        kind: 'FAQ',
        threadId: `auto-${entry.intentKey.slice(0, 24)}`,
        title: question,
        message: `Provide FAQ answer for intent "${entry.intentKey}" within this project.`,
        email: 'system@faq.local'
      });

      await FAQ.create({
        question,
        answer,
        intentKey: entry.intentKey,
        frequencyScore: uniqueUsers,
        source: 'AI_PROMOTED',
        isAIGenerated: true,
        createdByRole: 'SYSTEM',
        createdByEmail: 'system@bit-booking.local',
        active: true
      });
    }
  } catch (err) {
    console.error('[FAQAutoPromotion] failed:', err.message);
  } finally {
    running = false;
  }
};

const startFaqAutoPromotion = () => {
  if (String(process.env.FAQ_AUTO_PROMOTION_ENABLED || 'true').toLowerCase() === 'false') return;
  if (promoTimer) return;
  const intervalMs = Math.max(Number(process.env.FAQ_AUTO_PROMOTION_INTERVAL_MS || 6 * 60 * 60 * 1000), 60 * 1000);
  promoTimer = setInterval(runAutoPromotion, intervalMs);
  runAutoPromotion().catch(() => {});
  console.log(`[FAQAutoPromotion] started with interval ${intervalMs}ms`);
};

module.exports = { startFaqAutoPromotion, runFaqAutoPromotionNow: runAutoPromotion };

