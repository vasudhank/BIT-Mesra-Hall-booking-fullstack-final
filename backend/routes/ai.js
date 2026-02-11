const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();
const Hall = require('../models/hall');
const Fuse = require('fuse.js'); 
const { getEmailNotices } = require('../services/emailNoticeService');

const getISTDate = () => {
  const now = new Date();
  const str = now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
  const dateObj = new Date(str);
  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getDate()).padStart(2, '0');
  const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
  const time = dateObj.toLocaleTimeString('en-US', { hour12: true, hour: 'numeric', minute:'2-digit' });
  return { fullDate: `${yyyy}-${mm}-${dd}`, dayName, time, year: yyyy };
};

// Fuzzy search to fix hall names
const fixHallName = (inputName, allHalls) => {
  if (!inputName) return null;
  const fuse = new Fuse(allHalls, { keys: ['name'], threshold: 0.4 });
  const result = fuse.search(inputName);
  return result.length > 0 ? result[0].item.name : inputName;
};

// --- 🔥 SMART JSON EXTRACTOR ---
const extractFirstJSON = (txt) => {
    const start = txt.indexOf('{');
    if (start === -1) return null;

    let balance = 0;
    let end = -1;

    // Scan from the first '{' to find the matching '}'
    for (let i = start; i < txt.length; i++) {
        if (txt[i] === '{') balance++;
        else if (txt[i] === '}') balance--;

        if (balance === 0) {
            end = i;
            break;
        }
    }

    if (end !== -1) {
        const jsonStr = txt.substring(start, end + 1);
        try {
            return JSON.parse(jsonStr);
        } catch (e) {
            console.error("Manual Extraction Parse Error:", e);
            return null;
        }
    }
    return null;
};

router.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    let userRole = "GUEST"; 
    if (req.isAuthenticated()) {
      userRole = req.user.type.toUpperCase();
    }

    const halls = await Hall.find({}, 'name');
    const hallNames = halls.map(h => h.name).join(", ");
    // eslint-disable-next-line no-unused-vars
    const emailContext = await getEmailNotices().catch(() => "No recent notices."); 
    const { fullDate, dayName, time, year } = getISTDate();

    // SYSTEM PROMPT
    const systemPrompt = `
    You are a versatile and helpful AI Assistant.

    YOUR ROLES:
    1. **Hall Booking Agent:** You manage the BIT Mesra Hall Booking System.
    2. **General Assistant:** You answer general questions about the world (Science, Sports, Coding, History, etc.).

    SYSTEM CONTEXT:
    - Today: ${fullDate} (${dayName})
    - Time: ${time}
    - Year: ${year}
    - User Role: ${userRole}
    - Available Halls: [${hallNames}]

    INSTRUCTIONS:
    - If the user asks about booking, halls, or admin tasks -> Use "type": "ACTION".
    - If the user asks anything else (Who is Virat Kohli? What is React? Hello) -> Use "type": "CHAT" and put your answer in the "message" field.
    - Output EXACTLY ONE JSON object.

    --- FEW-SHOT EXAMPLES ---

    User: "Hi, who are you?"
    Response: { "type": "CHAT", "action": null, "message": "I am the Hall Booking Assistant. I can also help with general questions!" }

    User: "Tell me about Virat Kohli in short."
    Response: { "type": "CHAT", "action": null, "message": "Virat Kohli is a famous Indian cricketer and former captain of the Indian national team. He is regarded as one of the greatest batsmen in the history of the sport." }

    User: "Book Hall 20 for Coding Event on 11th Feb from 10am to 12pm"
    Response: {
      "type": "ACTION",
      "action": "BOOK_REQUEST",
      "payload": {
        "requests": [
          { "hall": "Hall 20", "date": "${year}-02-11", "start": "10:00 AM", "end": "12:00 PM", "event": "Coding Event" }
        ]
      },
      "reply": "I have initiated the booking for Hall 20."
    }

    User: "Approve Hall 20 booking" (Admin Only)
    Response: {
      "type": "ACTION",
      "action": "ADMIN_EXECUTE",
      "payload": { "subAction": "APPROVE_SPECIFIC", "targetHall": "Hall 20" },
      "reply": "Approving Hall 20."
    }

    --- END EXAMPLES ---

    User Input: "${message}"
    Response:`;

    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'phi3', 
        prompt: systemPrompt,
        stream: false,
        options: { 
          temperature: 0.3, // Slightly higher to allow creative general answers
          num_predict: 500,
          stop: ["User Input:", "User:", "Response:", "<|end|>"] 
        }
      })
    });

    const data = await response.json();
    const rawText = (data.response || '').trim();

    console.log("AI Raw Output:", rawText); // Debugging

    // 1. Attempt smart extraction
    let parsed = extractFirstJSON(rawText);

    // 2. Fallback: If no JSON found, treat as plain text chat
    if (!parsed) {
        // Strip out markdown code blocks if they exist but failed parsing
        const cleaned = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        parsed = { 
            type: "CHAT", 
            message: cleaned || "I didn't understand that.", 
            action: null 
        };
    }

    // 3. Post-Processing: Fix Hall Names
    if (parsed.type === 'ACTION' && parsed.payload) {
        if (parsed.payload.requests) {
            parsed.payload.requests.forEach(req => {
                if (req.hall && req.hall.toLowerCase() !== 'any') {
                    req.hall = fixHallName(req.hall, halls) || req.hall; 
                }
            });
        }
        if (parsed.payload.targetHall) {
            parsed.payload.targetHall = fixHallName(parsed.payload.targetHall, halls) || parsed.payload.targetHall;
        }
    }

    res.json({ reply: parsed });

  } catch (err) {
    console.error('AI error:', err);
    res.status(500).json({ error: 'AI service failed' });
  }
});

module.exports = router;