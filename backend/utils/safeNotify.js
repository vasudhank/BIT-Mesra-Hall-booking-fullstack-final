// backend/utils/safeNotify.js

exports.safeExecute = async (fn, label = 'TASK') => {
  try {
    await fn();
  } catch (err) {
    console.error(`⚠️ ${label} FAILED:`, err.message);
  }
};
