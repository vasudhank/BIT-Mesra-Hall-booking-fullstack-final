const crypto = require('crypto');

exports.generateApprovalToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

exports.getTokenExpiry = (minutes = 15) => {
  return new Date(Date.now() + minutes * 60 * 1000);
};
