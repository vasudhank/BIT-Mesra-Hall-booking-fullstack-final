import React, { useState, useEffect, useRef } from "react";
import api from "../../api/axiosInstance";
import "./AIChatWidget.css";
import { IconButton } from "@mui/material";

// Icons
import MicIcon from '@mui/icons-material/Mic';
import StopIcon from '@mui/icons-material/Stop';
import SendIcon from '@mui/icons-material/Send';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import KeyboardVoiceIcon from '@mui/icons-material/KeyboardVoice';
import CloseIcon from '@mui/icons-material/Close';
import GraphicEqIcon from '@mui/icons-material/GraphicEq';
import SettingsIcon from '@mui/icons-material/Settings'; 
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver'; 

export default function AIChatWidget({ immersive = false }) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  
  // LIVE MODE STATE
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [aiSpeaking, setAiSpeaking] = useState(false);

  // VOICE SETTINGS STATE
  const [availableVoices, setAvailableVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  const messagesEndRef = useRef(null);
  const recognitionRef = useRef(null);
  const isLiveModeRef = useRef(isLiveMode);

  useEffect(() => {
    isLiveModeRef.current = isLiveMode;
  }, [isLiveMode]);

  // --- 0. LOAD VOICES ON MOUNT ---
  useEffect(() => {
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      const englishVoices = voices.filter(v => v.lang.startsWith("en"));
      setAvailableVoices(englishVoices);

      if (!selectedVoice && englishVoices.length > 0) {
        const preferred = englishVoices.find(v => v.name.includes("Google US English")) 
                       || englishVoices.find(v => v.name.includes("Zira")) 
                       || englishVoices[0];
        setSelectedVoice(preferred);
      }
    };

    if ('speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
      loadVoices();
    }
  }, [selectedVoice]);

  // --- 1. SPEECH SYNTHESIS ---
  const speak = (text) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const cleanText = text.replace(/[*#]/g, '');
      const utterance = new SpeechSynthesisUtterance(cleanText);

      if (selectedVoice) utterance.voice = selectedVoice;
      
      utterance.rate = 1.05; 
      utterance.pitch = 1;

      utterance.onstart = () => setAiSpeaking(true);
      utterance.onend = () => {
        setAiSpeaking(false);
        if (isLiveModeRef.current) setTimeout(() => startListening(), 500);
      };
      window.speechSynthesis.speak(utterance);
    }
  };

  // --- 2. SPEECH RECOGNITION ---
  const startListening = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setMessages(prev => [...prev, { role: "ai", text: "⚠️ Voice input not supported." }]);
      return;
    }
    
    if (!recognitionRef.current) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.lang = 'en-US';
      recognitionRef.current.interimResults = false;

      recognitionRef.current.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        if (isLiveModeRef.current) sendMessage(transcript);
        else setInput(transcript);
      };

      recognitionRef.current.onend = () => setIsListening(false);
      recognitionRef.current.onerror = (e) => {
        console.error(e);
        setIsListening(false);
      };
    }

    try {
      recognitionRef.current.start();
      setIsListening(true);
    } catch (e) { /* ignore */ }
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }
  };

  const toggleMic = () => {
    if (isListening) stopListening();
    else startListening();
  };

  const toggleLiveMode = () => {
    const newMode = !isLiveMode;
    setIsLiveMode(newMode);
    if (newMode) speak("Welcome to Live Chat. I'm listening.");
    else {
      stopListening();
      window.speechSynthesis.cancel();
      setAiSpeaking(false);
    }
  };

  const formatHallStatus = (data) => {
    if (!Array.isArray(data)) return JSON.stringify(data);
    const sorted = [...data].sort((a,b) => (a.status === 'FREE' ? -1 : 1));
    let text = "🏛️ **Hall Status Report**\n\n";
    text += sorted.map(h => {
        const icon = h.status === "FREE" ? "🟢" : "🔴";
        const detail = h.status === "FREE" ? "Available" : `Occupied (${h.currentEvent})`;
        return `${icon} ${h.hall}: ${detail}`;
    }).join("\n");
    return text;
  };

  const sendMessage = async (textOverride = null) => {
    const textToSend = textOverride || input;
    if (!textToSend || !textToSend.trim()) return;

    setMessages(prev => [...prev, { role: "user", text: textToSend }]);
    setInput("");
    setIsLoading(true);

    try {
      const res = await api.post("/ai/chat", { message: textToSend });
      const replyData = res.data.reply;
      
      let aiText = "";
      let isAction = false;

      // IMPROVED LOGIC: Check type properly
      if (replyData && typeof replyData === 'object') {
         if(replyData.type === "CHAT") {
             // Use the long message field for conversations
             aiText = replyData.message || replyData.reply || "I'm not sure how to answer that.";
         } else if(replyData.type === "ACTION") {
             isAction = true;
             aiText = replyData.reply || "Processing your request...";
         } else {
             aiText = replyData.message || JSON.stringify(replyData);
         }
      } else {
         aiText = replyData || "Communication error.";
      }

      setMessages(prev => [...prev, { role: "ai", text: aiText }]);
      if (isLiveModeRef.current) speak(aiText);

      // Only execute if it's actually an ACTION
      if (isAction && replyData.action) {
        const exec = await api.post("/ai/execute", { intent: replyData });
        
        let execResultText = "";
        if (exec.data.status === "DONE") execResultText = `✅ ${exec.data.message}`;
        else if (exec.data.status === "INFO") execResultText = formatHallStatus(exec.data.data);
        else if (exec.data.status === "ERROR") execResultText = `⚠️ ${exec.data.msg}`;
        else if (exec.data.status === "READY") {
             try {
                await api.post(exec.data.call, exec.data.payload);
                execResultText = "✅ Booking Request Sent Successfully!";
             } catch (e) {
                execResultText = "❌ Failed: " + (e.response?.data?.msg || e.message);
             }
        }

        if(execResultText) {
            setMessages(prev => [...prev, { role: "ai", text: execResultText }]);
            if (isLiveModeRef.current) speak(execResultText);
        }
      }

    } catch (err) {
      console.error(err);
      setMessages(prev => [...prev, { role: "ai", text: "I'm having trouble connecting." }]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // --- RENDER LIVE MODE ---
  if (isLiveMode) {
    return (
      <div className={`gemini-live-wrapper ${immersive ? 'immersive-container' : ''}`}>
        <button className="close-live-btn" onClick={toggleLiveMode}>
            <CloseIcon />
        </button>
        
        {/* SETTINGS BUTTON (LIVE MODE) */}
        <button className="live-settings-btn" onClick={() => setShowSettings(!showSettings)}>
            <SettingsIcon />
        </button>

        {/* VOICE MENU */}
        {showSettings && (
            <div className="voice-menu-card">
                <div className="voice-menu-header">
                    <RecordVoiceOverIcon fontSize="small" /> Select Voice
                    <span className="close-voice-menu" onClick={() => setShowSettings(false)}>&times;</span>
                </div>
                <div className="voice-list">
                    {availableVoices.map((voice, idx) => (
                        <div 
                            key={idx} 
                            className={`voice-option ${selectedVoice?.name === voice.name ? 'selected' : ''}`}
                            onClick={() => {
                                setSelectedVoice(voice);
                                speak("Voice selected.");
                                setShowSettings(false);
                            }}
                        >
                            {voice.name.replace("Microsoft", "").replace("Google", "").trim()}
                        </div>
                    ))}
                </div>
            </div>
        )}
        
        <div className="live-content">
            <div className="live-status">
                {aiSpeaking ? "AI Speaking..." : isListening ? "Listening..." : "Processing..."}
            </div>
            
            <div className={`fluid-orb ${aiSpeaking ? 'orb-speaking' : ''} ${isListening ? 'orb-listening' : ''}`}>
                <div className="fluid-layer layer-1"></div>
                <div className="fluid-layer layer-2"></div>
                <div className="fluid-layer layer-3"></div>
            </div>

            <h2 className="live-greeting">
                {messages.length > 0 && messages[messages.length-1].role === 'ai'
                    ? messages[messages.length-1].text.substring(0, 80) + "..."
                    : "I'm listening..."}
            </h2>
        </div>

        <div className="live-controls-bar">
            <button className={`live-mic-btn ${isListening ? 'active' : ''}`} onClick={toggleMic}>
                {isListening ? <GraphicEqIcon /> : <MicIcon />}
            </button>
            <button className="live-end-btn" onClick={toggleLiveMode}>
                <StopIcon /> End
            </button>
        </div>
      </div>
    );
  }

  // --- RENDER CHAT MODE ---
  return (
    <div className={`gemini-chat-root ${immersive ? 'immersive-container' : ''}`}>
      
      {/* HEADER */}
      {immersive ? (
          <div className="gemini-header">
              <span className="gemini-sparkle-text"><AutoAwesomeIcon fontSize="small"/> AI Assistant</span>
              <div className="header-actions-group">
                  <IconButton size="small" onClick={() => setShowSettings(!showSettings)}>
                      <SettingsIcon fontSize="small"/>
                  </IconButton>
                  <button className="mode-toggle-btn" onClick={toggleLiveMode}>
                      <KeyboardVoiceIcon fontSize="small"/> Live
                  </button>
              </div>
          </div>
      ) : (
          /* Non-Immersive Settings Button (Absolute Top Right) */
          <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 10 }}>
              <IconButton size="small" onClick={() => setShowSettings(!showSettings)}>
                  <SettingsIcon fontSize="small"/>
              </IconButton>
          </div>
      )}

      {/* VOICE MENU (CHAT MODE) */}
      {showSettings && (
            <div className="voice-menu-card chat-mode-menu">
                <div className="voice-menu-header">
                    <RecordVoiceOverIcon fontSize="small" /> Select Voice
                    <span className="close-voice-menu" onClick={() => setShowSettings(false)}>&times;</span>
                </div>
                <div className="voice-list">
                    {availableVoices.map((voice, idx) => (
                        <div 
                            key={idx} 
                            className={`voice-option ${selectedVoice?.name === voice.name ? 'selected' : ''}`}
                            onClick={() => {
                                setSelectedVoice(voice);
                                speak("Voice selected."); // Test sound
                                setShowSettings(false);
                            }}
                        >
                            {voice.name.replace("Microsoft", "").replace("Google", "").trim()}
                        </div>
                    ))}
                </div>
            </div>
      )}

      <div className="gemini-messages">
        {messages.length === 0 && (
            <div className="gemini-welcome">
                <div className="welcome-icon"><AutoAwesomeIcon sx={{ fontSize: 40 }}/></div>
                <h3>How can I help you today?</h3>
                <p>I can help with bookings or just chat!</p>
            </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`gemini-msg-row ${m.role}`}>
            {m.role === 'ai' && <div className="ai-avatar"><AutoAwesomeIcon sx={{ fontSize: 16 }}/></div>}
            <div className={`gemini-bubble ${m.role}`}>
              <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0 }}>
                  {m.text}
              </pre>
            </div>
          </div>
        ))}

        {isLoading && (
            <div className="gemini-msg-row ai">
                <div className="ai-avatar"><AutoAwesomeIcon sx={{ fontSize: 16 }}/></div>
                <div className="gemini-bubble ai loading-bubble">
                    <span className="gemini-sparkle-anim">✨</span> Thinking...
                </div>
            </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="gemini-input-wrapper">
        {!immersive && (
             <button className="mini-live-btn" onClick={toggleLiveMode} title="Go Live">
                <GraphicEqIcon fontSize="small" />
             </button>
        )}
        <div className="gemini-input-pill">
            <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && sendMessage()}
            placeholder="Ask anything..."
            />
            <div className="pill-actions">
                {/* 🔥 MIC ICON COLOR FIX 🔥
                   - Idle: Uses 'var(--gemini-user-text)' (Black in Light Mode, White in Dark Mode)
                   - Active (Listening): Uses 'error.main' (Red) 
                */}
                <IconButton 
                    size="small" 
                    onClick={toggleMic} 
                    sx={{ 
                        color: isListening ? 'error.main' : 'var(--gemini-user-text)' 
                    }}
                >
                    <MicIcon />
                </IconButton>

                {input.trim() && (
                    <IconButton size="small" onClick={() => sendMessage()} className="send-btn-active">
                        <SendIcon />
                    </IconButton>
                )}
            </div>
        </div>
      </div>
    </div>
  );
}