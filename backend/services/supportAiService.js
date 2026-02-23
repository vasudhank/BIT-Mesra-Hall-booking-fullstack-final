const fetch = require('node-fetch');
const { getProjectSupportContext } = require('./projectSupportContextService');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'phi3';

const buildPrompt = async ({ kind, title, message, email, threadId }) => {
  const context = await getProjectSupportContext();
  return `
You are a support AI for the BIT Seminar Hall Booking System.
Respond with concise, practical, project-specific steps only.
Do not provide generic unrelated advice.
If unsure, say what exact app screen/menu to open and what info user should provide.

Thread type: ${kind}
Thread id: ${threadId}
Reporter email: ${email}
Title: ${title}
Message: ${message}

${context}

Output rules:
- Plain text only
- 3 to 10 lines
- Mention concrete page names or menu names in this app when relevant
`.trim();
};

const fallbackAnswer = ({ kind, title }) => {
  const type = kind === 'QUERY' ? 'query' : 'complaint';
  return [
    `AI Generated (${type}): I could not complete full analysis right now.`,
    `Please open the ${kind === 'QUERY' ? 'Queries' : 'Complaints'} page thread "${title}" and add:`,
    '1) exact hall/department/date-time details',
    '2) screenshot or error text',
    '3) expected behavior vs actual behavior',
    'Admin/Developer can then provide a trusted fix quickly.'
  ].join('\n');
};

const generateProjectSpecificSupportAnswer = async (input) => {
  try {
    const prompt = await buildPrompt(input);
    const response = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: { temperature: 0.2, num_predict: 450 }
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama request failed: ${response.status}`);
    }

    const data = await response.json();
    const text = String(data.response || '').trim();
    if (!text) {
      return fallbackAnswer(input);
    }
    return text;
  } catch (err) {
    return fallbackAnswer(input);
  }
};

module.exports = { generateProjectSpecificSupportAnswer };

