const imap = require('imap-simple');
const { simpleParser } = require('mailparser');
require('dotenv').config();

let noticeCache = {
  data: "",
  lastFetch: 0
};

// Cache duration: 10 minutes
const CACHE_DURATION = 10 * 60 * 1000; 

const getEmailNotices = async () => {
  const now = Date.now();
  if (noticeCache.data && (now - noticeCache.lastFetch < CACHE_DURATION)) {
    return noticeCache.data;
  }

  const config = {
    imap: {
      user: 'bitmesraa@gmail.com',
      password: process.env.EMAIL_PASSWORD, // Use App Password
      host: 'imap.gmail.com',
      port: 993,
      tls: true,
      // 🟢 FIX: Allow connection through Antivirus/Firewall
      tlsOptions: { rejectUnauthorized: false }, 
      authTimeout: 3000
    }
  };

  try {
    const connection = await imap.connect(config);
    await connection.openBox('INBOX');

    // Fetch last 5 emails
    const searchCriteria = ['ALL'];
    const fetchOptions = { bodies: ['HEADER', 'TEXT'], markSeen: false, struct: true };
    const messages = await connection.search(searchCriteria, fetchOptions);
    
    // Sort by date descending and take top 5
    const recentMessages = messages.sort((a, b) => 
      new Date(b.attributes.date) - new Date(a.attributes.date)
    ).slice(0, 5);

    let summary = "RECENT EMAIL NOTICES (Use this info to warn users about holidays/closures):\n";

    for (let item of recentMessages) {
      // Robust extraction without lodash dependency
      const headerPart = item.parts.find(p => p.which === 'HEADER');
      
      // Extract Subject safely
      let subject = 'No Subject';
      if (headerPart && headerPart.body && headerPart.body.subject && headerPart.body.subject.length > 0) {
        subject = headerPart.body.subject[0];
      }

      summary += `- Subject: ${subject} (Date: ${item.attributes.date})\n`;
    }

    connection.end();
    
    noticeCache.data = summary;
    noticeCache.lastFetch = now;
    return summary;

  } catch (err) {
    console.error("Email Fetch Error:", err.message); // Log message only to avoid clutter
    return "Could not fetch recent emails. Assume no special notices.";
  }
};

module.exports = { getEmailNotices };