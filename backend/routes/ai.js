const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();
const Hall = require('../models/hall');
const Fuse = require('fuse.js'); 
const { extractJSON } = require('../utils/jsonHelper'); 
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
  return { fullDate: `${yyyy}-${mm}-${dd}`, dayName, time };
};

const fixHallName = (inputName, allHalls) => {
  if (!inputName) return null;
  const fuse = new Fuse(allHalls, { keys: ['name'], threshold: 0.4 });
  const result = fuse.search(inputName);
  return result.length > 0 ? result[0].item.name : inputName;
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
    const emailContext = await getEmailNotices().catch(() => "No recent notices."); 
    const { fullDate, dayName, time } = getISTDate();

    // IMPROVED SYSTEM PROMPT
    const systemPrompt = `
    You are a helpful and versatile AI Assistant for the BIT Mesra Hall Booking System.
    
    CONTEXT:
    - Current Time: ${fullDate}, ${time} (${dayName})
    - Available Halls: [${hallNames}]
    - User Role: ${userRole}
    - Recent Notices: ${emailContext}

    GOAL:
    You have two modes:
    1. CONVERSATIONAL: If the user asks general questions (Elon Musk, science, greetings, help), respond naturally and comprehensively.
    2. AGENTIC: If the user wants to book, check status, or manage halls, provide the structured JSON action.

    OUTPUT FORMAT:
    You MUST output a single JSON object with this structure:
    {
      "type": "CHAT" | "ACTION",
      "action": "BOOK_REQUEST" | "ADMIN_QUERY" | "ADMIN_EXECUTE" | "SHOW_HALL_STATUS" | null,
      "payload": { ... },
      "message": "Your long-form conversational reply here for CHAT type",
      "reply": "Short acknowledgement for ACTION type"
    }

    RULES:
    - If "type" is "CHAT", put your entire helpful response in the "message" field. (e.g., if asked for 100 words on Elon Musk, write them inside "message").
    - If "type" is "ACTION", fill the "action" and "payload" fields.
    - NEVER add text outside the JSON.

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
          temperature: 0.3, // Slightly higher for better conversation
          num_predict: 2048, // Increased for long replies like "100 lines"
          stop: ["<|end|>", "User:"] 
        }
      })
    });

    const data = await response.json();
    const rawText = (data.response || '').trim();

    let parsed = extractJSON(rawText);

    // Fallback if the model fails to JSON format a long reply
    if (!parsed) {
      parsed = { type: "CHAT", message: rawText, action: null };
    }

    if (parsed.type === 'ACTION' && parsed.action === 'BOOK_REQUEST' && parsed.payload?.requests) {
      parsed.payload.requests.forEach(req => {
        if (req.hall) req.hall = fixHallName(req.hall, halls);
      });
    }

    res.json({ reply: parsed });

  } catch (err) {
    console.error('AI error:', err);
    res.status(500).json({ error: 'AI service failed' });
  }
});

module.exports = router;