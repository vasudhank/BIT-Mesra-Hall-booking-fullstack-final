import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import api from "../../api/axiosInstance";
import "./AIChatWidget.css";
import { IconButton, Tooltip } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { exportPdfFromPrintHtml } from "../../utils/exportPdfFromPrintHtml";

import MicIcon from "@mui/icons-material/Mic";
import StopIcon from "@mui/icons-material/Stop";
import SendIcon from "@mui/icons-material/Send";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import CloseIcon from "@mui/icons-material/Close";
import GraphicEqIcon from "@mui/icons-material/GraphicEq";
import SettingsIcon from "@mui/icons-material/Settings";
import RecordVoiceOverIcon from "@mui/icons-material/RecordVoiceOver";
import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import CreateOutlinedIcon from "@mui/icons-material/CreateOutlined";
import ChevronLeftRoundedIcon from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import TranslateRoundedIcon from "@mui/icons-material/TranslateRounded";
import HomeRoundedIcon from "@mui/icons-material/HomeRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import MoreHorizRoundedIcon from "@mui/icons-material/MoreHorizRounded";
import AttachFileRoundedIcon from "@mui/icons-material/AttachFileRounded";
import DescriptionRoundedIcon from "@mui/icons-material/DescriptionRounded";
import ImageRoundedIcon from "@mui/icons-material/ImageRounded";
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";

import {
  playElevenLabsSpeech,
  stopElevenLabsPlayback
} from "../../utils/elevenLabsTts";
import QuickPageMenu from "../Navigation/QuickPageMenu";

const STORAGE_PREFIX = "bit_booking_ai_threads_v1";
const MAX_THREADS = Number.POSITIVE_INFINITY;
const MAX_MESSAGES_PER_THREAD = Number.POSITIVE_INFINITY;
const MAX_INPUT_HEIGHT = 140;
const MAX_EDIT_QUERY_HEIGHT = 220;
const MAX_ATTACHMENT_COUNT = 4;
const MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024;
const WELCOME_HEADLINE = "How can I help you today?";
const WELCOME_SUBTITLE = "Chat, ask in Hindi or English, or run booking actions.";

const LANGUAGE_OPTIONS = [
  { id: "auto", label: "Auto" },
  { id: "en", label: "English" },
  { id: "hi", label: "Hindi" }
];

const normalizeThinkingStatusLabel = (value, fallback = "Thinking") => {
  const raw = String(value || "")
    .replace(/[_:/-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return fallback;
  const words = raw.split(" ").slice(0, 2);
  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
};

const createId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const createMessage = (role, text, extra = {}) => ({
  id: createId(),
  role,
  text: String(text || ""),
  createdAt: Date.now(),
  data: extra.data && typeof extra.data === "object" ? extra.data : null,
  attachments: Array.isArray(extra.attachments) ? extra.attachments : []
});

const truncateText = (text, limit = 42) => {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "New chat";
  return cleaned.length > limit ? `${cleaned.slice(0, limit)}...` : cleaned;
};

const getThreadTitleFromMessages = (messages) => {
  const firstUser = (messages || []).find((msg) => msg?.role === "user" && msg?.text);
  return firstUser ? truncateText(firstUser.text) : "New chat";
};

const createThread = () => ({
  id: createId(),
  title: "New chat",
  isTitleManuallySet: false,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  messages: []
});

const detectHindiScript = (text) => /[\u0900-\u097F]/.test(String(text || ""));

const sanitizeStoredMessages = (rawMessages) => {
  if (!Array.isArray(rawMessages)) return [];
  return rawMessages
    .filter((msg) => msg && (msg.role === "user" || msg.role === "ai"))
    .map((msg) => ({
      id: msg.id || createId(),
      role: msg.role,
      text: String(msg.text || ""),
      createdAt: Number(msg.createdAt) || Date.now(),
      data: msg.data && typeof msg.data === "object" ? msg.data : null,
      attachments: Array.isArray(msg.attachments)
        ? msg.attachments
          .map((item) => ({
            id: item.id || createId(),
            name: String(item.name || "attachment"),
            type: String(item.type || ""),
            size: Number(item.size) || 0
          }))
          .slice(0, MAX_ATTACHMENT_COUNT)
        : []
    }))
    .slice(-MAX_MESSAGES_PER_THREAD);
};

const sanitizeStoredThreads = (rawThreads) => {
  if (!Array.isArray(rawThreads)) return [];
  return rawThreads
    .map((thread) => {
      if (!thread || typeof thread !== "object") return null;
      const messages = sanitizeStoredMessages(thread.messages);
      return {
        id: thread.id || createId(),
        title: thread.title || getThreadTitleFromMessages(messages),
        isTitleManuallySet: Boolean(thread.isTitleManuallySet),
        createdAt: Number(thread.createdAt) || Date.now(),
        updatedAt: Number(thread.updatedAt) || Date.now(),
        messages
      };
    })
    .filter(Boolean)
    .slice(0, MAX_THREADS);
};

const getStorageKey = (accountKey) => `${STORAGE_PREFIX}:${accountKey}`;

const toServerHistory = (messages) =>
  (messages || [])
    .filter((msg) => msg && (msg.role === "user" || msg.role === "ai") && msg.text)
    .slice(-24)
    .map((msg) => ({ role: msg.role, text: msg.text }));

const formatThreadTime = (timestamp) => {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "numeric"
  });
};

const normalizeSearchValue = (value) =>
  String(value || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();

const simplifySearchValue = (value) =>
  normalizeSearchValue(value).replace(/[^\p{L}\p{N}\s]/gu, "");

const textMatchesSearch = (text, query) => {
  const normalizedQuery = normalizeSearchValue(query);
  if (!normalizedQuery) return false;

  const normalizedText = normalizeSearchValue(text);
  if (normalizedText.includes(normalizedQuery)) return true;

  const simplifiedQuery = simplifySearchValue(query);
  if (!simplifiedQuery) return false;

  const simplifiedText = simplifySearchValue(text);
  return simplifiedText.includes(simplifiedQuery);
};

const findThreadSearchMatch = (thread, query) => {
  const matchedMessage = (thread?.messages || []).find((message) =>
    textMatchesSearch(message?.text || "", query)
  );

  if (matchedMessage) {
    return {
      matched: true,
      matchedMessageId: matchedMessage.id,
      snippet: truncateText(matchedMessage.text, 88)
    };
  }

  if (textMatchesSearch(thread?.title || "", query)) {
    return { matched: true, matchedMessageId: "", snippet: "" };
  }

  return { matched: false, matchedMessageId: "", snippet: "" };
};

const escapeRegExp = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const renderHighlightedText = (text, query) => {
  const source = String(text || "");
  const trimmedQuery = String(query || "").trim();
  if (!source || !trimmedQuery) return source;

  const pattern = escapeRegExp(trimmedQuery).replace(/\s+/g, "\\s+");
  const regex = new RegExp(pattern, "ig");
  const nodes = [];
  let cursor = 0;
  let idx = 0;
  let match;

  while ((match = regex.exec(source)) !== null) {
    const start = match.index;
    const end = start + match[0].length;

    if (start > cursor) {
      nodes.push(source.slice(cursor, start));
    }

    nodes.push(
      <mark key={`search-hit-${idx}`} className="message-search-mark">
        {source.slice(start, end)}
      </mark>
    );

    cursor = end;
    idx += 1;

    if (regex.lastIndex === match.index) {
      regex.lastIndex += 1;
    }
  }

  if (cursor < source.length) {
    nodes.push(source.slice(cursor));
  }

  return nodes.length ? nodes : source;
};

const formatBytes = (bytes) => {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const normalizeWsBase = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withoutTrailingSlash = raw.replace(/\/+$/, "");
  const noApiSuffix = withoutTrailingSlash.replace(/\/api$/i, "");
  return noApiSuffix;
};

const resolveAiWebSocketUrl = () => {
  const explicit = normalizeWsBase(process.env.REACT_APP_WS_URL);
  if (explicit) {
    const wsBase = explicit
      .replace(/^https:\/\//i, "wss://")
      .replace(/^http:\/\//i, "ws://");
    return `${wsBase}/api/ai/ws`;
  }

  const apiBase = normalizeWsBase(process.env.REACT_APP_API_URL);
  if (apiBase) {
    const wsBase = apiBase
      .replace(/^https:\/\//i, "wss://")
      .replace(/^http:\/\//i, "ws://");
    return `${wsBase}/api/ai/ws`;
  }

  if (typeof window !== "undefined") {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/api/ai/ws`;
  }

  return "";
};

const isLikelyActionPrompt = (text) => {
  const lower = String(text || "").toLowerCase();
  const directAction =
    /\b(book|booking|reserve|approve|reject|pending requests|hall status|show halls|show rooms|which rooms|open halls|closed halls|public task|calendar task|public event|create notice|post notice|notice|send email|send mail|email|mail|export schedule|download schedule|slack|whatsapp|crm|hubspot|notify)\b/i.test(lower);
  const hallContinuation =
    /\bhall\s*[-:]?\s*[a-z0-9]+\b/i.test(lower)
    && /\b(also|too|add|book|reserve|request|from|to|today|tomorrow|next|this)\b/i.test(lower);

  return directAction || hallContinuation;
};

const extractFirstJSONObject = (text) => {
  const raw = String(text || "");
  const start = raw.indexOf("{");
  if (start < 0) return null;

  let balance = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < raw.length; index += 1) {
    const ch = raw[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      continue;
    }

    if (ch === "{") balance += 1;
    if (ch === "}") balance -= 1;

    if (balance === 0) {
      try {
        return JSON.parse(raw.slice(start, index + 1));
      } catch (err) {
        return null;
      }
    }
  }

  return null;
};

const extractActionIntentFromText = (text) => {
  const parsed = extractFirstJSONObject(text);
  if (!parsed || typeof parsed !== "object") return null;

  const type = String(parsed?.type || "").toUpperCase();
  const action = String(parsed?.action || parsed?.actionType || "").toUpperCase().trim();
  const payload = parsed?.payload && typeof parsed.payload === "object" ? parsed.payload : {};
  const reply = String(parsed?.reply || parsed?.message || "").trim();

  if (type !== "ACTION" && !action) return null;
  if (!action) return null;
  return { action, payload, reply };
};

const looksLikeActionJsonLeak = (text) => {
  const raw = String(text || "").trim();
  if (!raw) return false;
  return /"type"\s*:\s*"ACTION"|"\s*action\s*"\s*:|"payload"\s*:/.test(raw);
};

const downloadBase64Artifact = (artifact) => {
  if (!artifact || !artifact.base64) return;
  try {
    const binary = window.atob(String(artifact.base64));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: artifact.mimeType || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = artifact.name || "download";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    // Ignore download errors.
  }
};

const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const buildConfirmationEditDraft = (data) => {
  const fields = Array.isArray(data?.editForm?.fields) ? data.editForm.fields : [];
  return fields.reduce((draft, field) => {
    const key = String(field?.key || "").trim();
    if (!key) return draft;

    if (field.input === "checkbox_list") {
      draft[key] = Array.isArray(field.options)
        ? field.options.filter((option) => option?.checked).map((option) => String(option.value || ""))
        : [];
      return draft;
    }

    draft[key] = field?.value ?? "";
    return draft;
  }, {});
};

const buildNoticePdfDocument = (notice) => {
  const title = String(notice?.title || notice?.subject || "Notice").trim() || "Notice";
  const body = String(notice?.content || notice?.body || notice?.summary || "").trim();
  const start = notice?.startDateTime
    ? new Date(notice.startDateTime).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
    : "N/A";
  const end = notice?.endDateTime
    ? new Date(notice.endDateTime).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
    : "N/A";
  const kind = String(notice?.kind || "GENERAL").trim() || "GENERAL";
  const rooms = Array.isArray(notice?.rooms) && notice.rooms.length > 0
    ? notice.rooms.join(", ")
    : (notice?.closureAllHalls ? "All halls" : "Not specified");
  const bodyHtml = body
    ? body
      .split(/\n{2,}/)
      .map((chunk) => `<p>${escapeHtml(chunk.trim())}</p>`)
      .join("")
    : "<p>No notice body provided.</p>";

  return {
    title,
    html: `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${escapeHtml(title)}</title>
          <style>
            body {
              font-family: "Segoe UI", Arial, sans-serif;
              margin: 0;
              color: #111827;
              background: #ffffff;
            }
            .page {
              max-width: 760px;
              margin: 0 auto;
              padding: 32px;
            }
            h1 {
              margin: 0 0 12px;
              font-size: 30px;
              line-height: 1.2;
            }
            .meta {
              margin-bottom: 18px;
              border: 1px solid #d1d5db;
              border-radius: 12px;
              overflow: hidden;
            }
            .row {
              display: grid;
              grid-template-columns: 180px 1fr;
            }
            .row + .row {
              border-top: 1px solid #d1d5db;
            }
            .label, .value {
              padding: 10px 12px;
              font-size: 14px;
            }
            .label {
              font-weight: 700;
              background: #f8fafc;
            }
            .body p {
              margin: 0 0 12px;
              font-size: 15px;
              line-height: 1.65;
            }
          </style>
        </head>
        <body>
          <div class="page">
            <h1>${escapeHtml(title)}</h1>
            <div class="meta">
              <div class="row"><div class="label">Type</div><div class="value">${escapeHtml(kind)}</div></div>
              <div class="row"><div class="label">From</div><div class="value">${escapeHtml(start)}</div></div>
              <div class="row"><div class="label">To</div><div class="value">${escapeHtml(end)}</div></div>
              <div class="row"><div class="label">Rooms</div><div class="value">${escapeHtml(rooms)}</div></div>
            </div>
            <div class="body">${bodyHtml}</div>
          </div>
        </body>
      </html>
    `
  };
};

const GeminiDiamondIcon = ({ size = 22, className = "" }) => {
  const gradientId = useId();
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#4285f4" />
          <stop offset="100%" stopColor="#24c1e0" />
        </linearGradient>
      </defs>
      <path
        d="M12 0C12 6.627 17.373 12 24 12C17.373 12 12 17.373 12 24C12 17.373 6.627 12 0 12C6.627 12 12 6.627 12 0Z"
        fill={`url(#${gradientId})`}
      />
    </svg>
  );
};

const SidebarCollapseArrowIcon = ({ direction = "right" }) => (
  <span
    className={`ai-sidebar-collapse-icon ${direction === "left" ? "left" : "right"}`.trim()}
    aria-hidden="true"
  >
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" id="collapse-right">
      <path d="M11,17a1,1,0,0,1-.71-1.71L13.59,12,10.29,8.71a1,1,0,0,1,1.41-1.41l4,4a1,1,0,0,1,0,1.41l-4,4A1,1,0,0,1,11,17Z"></path>
      <path d="M15 13H5a1 1 0 0 1 0-2H15a1 1 0 0 1 0 2zM19 20a1 1 0 0 1-1-1V5a1 1 0 0 1 2 0V19A1 1 0 0 1 19 20z"></path>
    </svg>
  </span>
);

export default function AIChatWidget({
  immersive = false,
  showHeaderBrand = true,
  onSidebarHiddenChange = null,
  externalRestoreSignal = 0,
  defaultSidebarHidden = false
}) {
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [threads, setThreads] = useState([]);
  const [activeThreadId, setActiveThreadId] = useState("");
  const [historyReady, setHistoryReady] = useState(false);

  const [accountKey, setAccountKey] = useState("GUEST:local");
  const [identityReady, setIdentityReady] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => Boolean(immersive && !defaultSidebarHidden));
  const [sidebarHidden, setSidebarHidden] = useState(() => Boolean(defaultSidebarHidden));
  const [sidebarWidth, setSidebarWidth] = useState(null);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [isCompactLayout, setIsCompactLayout] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth <= 700 : false
  );

  const [isLiveMode, setIsLiveMode] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [aiSpeaking, setAiSpeaking] = useState(false);

  const [showSettings, setShowSettings] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState("auto");
  const [availableVoices, setAvailableVoices] = useState([]);
  const [selectedVoiceName, setSelectedVoiceName] = useState("");
  const [thinkingStatusLabel, setThinkingStatusLabel] = useState("");

  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editingDraft, setEditingDraft] = useState("");
  const [copiedMessageId, setCopiedMessageId] = useState("");
  const [animatedWelcomeText, setAnimatedWelcomeText] = useState("");
  const [isInputExpanded, setIsInputExpanded] = useState(false);
  const [showSidebarSearch, setShowSidebarSearch] = useState(false);
  const [sidebarSearchTerm, setSidebarSearchTerm] = useState("");
  const [isChatsSectionOpen, setIsChatsSectionOpen] = useState(true);
  const [pendingSearchJump, setPendingSearchJump] = useState(null);
  const [searchHighlight, setSearchHighlight] = useState(null);
  const [pendingAttachments, setPendingAttachments] = useState([]);
  const [editingConfirmationMessageId, setEditingConfirmationMessageId] = useState("");
  const [editingConfirmationDraft, setEditingConfirmationDraft] = useState({});
  const [confirmationSaveBusy, setConfirmationSaveBusy] = useState(false);
  const [confirmationEditError, setConfirmationEditError] = useState("");
  const [openThreadMenuId, setOpenThreadMenuId] = useState("");
  const [renamingThreadId, setRenamingThreadId] = useState("");
  const [threadTitleDraft, setThreadTitleDraft] = useState("");
  const [deleteConfirmThreadId, setDeleteConfirmThreadId] = useState("");
  const [freshViewportPromptId, setFreshViewportPromptId] = useState("");
  const [freshViewportSpacerHeight, setFreshViewportSpacerHeight] = useState(0);

  const chatShellRef = useRef(null);
  const sidebarRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const inputFieldRef = useRef(null);
  const editingInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const recognitionRef = useRef(null);
  const isLiveModeRef = useRef(isLiveMode);
  const activeChatRequestRef = useRef(null);
  const messageRowRefs = useRef(new Map());
  const thinkingRowRef = useRef(null);
  const pendingPromptViewportRef = useRef(null);
  const freshViewportBaseGapRef = useRef(0);
  const freshViewportAnchorScrollTopRef = useRef(0);
  const freshViewportMaxScrollUpRef = useRef(0);
  const lastVoiceFailureRef = useRef("");
  const sidebarResizeMetaRef = useRef({ dragging: false, startX: 0, startWidth: 250 });
  const threadMenuRefs = useRef(new Map());

  const storageKey = useMemo(() => getStorageKey(accountKey), [accountKey]);

  useEffect(() => {
    isLiveModeRef.current = isLiveMode;
  }, [isLiveMode]);

  const getSidebarBounds = useCallback(() => {
    const shellWidth = chatShellRef.current?.getBoundingClientRect()?.width || window.innerWidth || 1200;
    const min = 170;
    const max = Math.max(min + 40, Math.min(460, shellWidth - 250));
    return { min, max };
  }, []);

  const handleSidebarResizeMove = useCallback(
    (event) => {
      if (!sidebarResizeMetaRef.current.dragging) return;
      const { startX, startWidth } = sidebarResizeMetaRef.current;
      const deltaX = event.clientX - startX;
      const { min, max } = getSidebarBounds();
      const nextWidth = Math.max(min, Math.min(max, startWidth + deltaX));
      setSidebarWidth(Math.round(nextWidth));
    },
    [getSidebarBounds]
  );

  const stopSidebarResize = useCallback(() => {
    if (!sidebarResizeMetaRef.current.dragging) return;
    sidebarResizeMetaRef.current.dragging = false;
    setIsResizingSidebar(false);
    document.body.classList.remove("gemini-resizing-sidebar");
    window.removeEventListener("mousemove", handleSidebarResizeMove);
    window.removeEventListener("mouseup", stopSidebarResize);
  }, [handleSidebarResizeMove]);

  const startSidebarResize = useCallback(
    (event) => {
      if (!sidebarOpen || isCompactLayout) return;
      event.preventDefault();
      event.stopPropagation();

      const currentWidth = sidebarWidth || sidebarRef.current?.getBoundingClientRect()?.width || 250;
      sidebarResizeMetaRef.current = {
        dragging: true,
        startX: event.clientX,
        startWidth: currentWidth
      };

      setIsResizingSidebar(true);
      document.body.classList.add("gemini-resizing-sidebar");
      window.addEventListener("mousemove", handleSidebarResizeMove);
      window.addEventListener("mouseup", stopSidebarResize);
    },
    [handleSidebarResizeMove, isCompactLayout, sidebarOpen, sidebarWidth, stopSidebarResize]
  );

  useEffect(() => {
    const onWindowResize = () => {
      const compact = window.innerWidth <= 700;
      setIsCompactLayout(compact);
      if (compact) stopSidebarResize();
    };

    onWindowResize();
    window.addEventListener("resize", onWindowResize);
    return () => window.removeEventListener("resize", onWindowResize);
  }, [stopSidebarResize]);

  useEffect(() => {
    if (!sidebarOpen) stopSidebarResize();
  }, [sidebarOpen, stopSidebarResize]);

  useEffect(() => {
    if (sidebarHidden) stopSidebarResize();
  }, [sidebarHidden, stopSidebarResize]);

  useEffect(() => {
    if (typeof onSidebarHiddenChange === "function") {
      onSidebarHiddenChange(sidebarHidden);
    }
  }, [onSidebarHiddenChange, sidebarHidden]);

  useEffect(() => {
    if (!externalRestoreSignal) return;
    if (!sidebarHidden) return;
    setSidebarHidden(false);
    setSidebarOpen(false);
  }, [externalRestoreSignal, sidebarHidden]);

  useEffect(() => () => stopSidebarResize(), [stopSidebarResize]);

  useEffect(() => {
    if (sidebarOpen) return;
    setShowSidebarSearch(false);
    setSidebarSearchTerm("");
    setOpenThreadMenuId("");
    setRenamingThreadId("");
    setThreadTitleDraft("");
  }, [sidebarOpen]);

  const sortedThreads = useMemo(
    () => [...threads].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
    [threads]
  );

  const normalizedSidebarSearch = useMemo(
    () => normalizeSearchValue(sidebarSearchTerm),
    [sidebarSearchTerm]
  );

  const sidebarSearchResults = useMemo(() => {
    if (!normalizedSidebarSearch) {
      return sortedThreads.map((thread) => ({
        thread,
        matchedMessageId: "",
        snippet: ""
      }));
    }

    return sortedThreads
      .map((thread) => {
        const matchInfo = findThreadSearchMatch(thread, normalizedSidebarSearch);
        if (!matchInfo.matched) return null;
        return {
          thread,
          matchedMessageId: matchInfo.matchedMessageId || "",
          snippet: matchInfo.snippet || ""
        };
      })
      .filter(Boolean);
  }, [normalizedSidebarSearch, sortedThreads]);

  const selectThreadFromSidebar = useCallback(
    (threadId, matchedMessageId = "") => {
      if (!threadId) return;
      setActiveThreadId(threadId);
      setEditingMessageId(null);
      setEditingDraft("");
      setOpenThreadMenuId("");
      setRenamingThreadId("");
      setThreadTitleDraft("");

      if (normalizedSidebarSearch && matchedMessageId) {
        setPendingSearchJump({
          threadId,
          messageId: matchedMessageId,
          query: sidebarSearchTerm
        });
      } else {
        setPendingSearchJump(null);
        setSearchHighlight(null);
      }
    },
    [normalizedSidebarSearch, sidebarSearchTerm]
  );

  const beginThreadRename = useCallback((thread) => {
    if (!thread?.id) return;
    setOpenThreadMenuId("");
    setRenamingThreadId(thread.id);
    setThreadTitleDraft(thread.title || "");
  }, []);

  const cancelThreadRename = useCallback(() => {
    setRenamingThreadId("");
    setThreadTitleDraft("");
  }, []);

  const saveThreadRename = useCallback(
    (threadId) => {
      const normalizedTitle = String(threadTitleDraft || "").replace(/\s+/g, " ").trim();
      if (!threadId || !normalizedTitle) {
        cancelThreadRename();
        return;
      }

      setThreads((prevThreads) =>
        prevThreads.map((thread) =>
          thread.id === threadId
            ? {
              ...thread,
              title: truncateText(normalizedTitle, 62),
              isTitleManuallySet: true
            }
            : thread
        )
      );

      cancelThreadRename();
    },
    [cancelThreadRename, threadTitleDraft]
  );

  const requestThreadDelete = useCallback((threadId) => {
    if (!threadId) return;
    setOpenThreadMenuId("");
    setDeleteConfirmThreadId(threadId);
  }, []);

  const cancelThreadDelete = useCallback(() => {
    setDeleteConfirmThreadId("");
  }, []);

  const confirmThreadDelete = useCallback(() => {
    if (!deleteConfirmThreadId) return;
    setThreads((prevThreads) => prevThreads.filter((thread) => thread.id !== deleteConfirmThreadId));
    setDeleteConfirmThreadId("");
    setOpenThreadMenuId("");
    if (renamingThreadId === deleteConfirmThreadId) {
      setRenamingThreadId("");
      setThreadTitleDraft("");
    }
  }, [deleteConfirmThreadId, renamingThreadId]);

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) || null,
    [threads, activeThreadId]
  );
  const threadPendingDelete = useMemo(
    () => threads.find((thread) => thread.id === deleteConfirmThreadId) || null,
    [threads, deleteConfirmThreadId]
  );

  const messages = useMemo(() => activeThread?.messages || [], [activeThread]);
  const freshViewportPromptIndex = useMemo(
    () => messages.findIndex((message) => message.id === freshViewportPromptId),
    [messages, freshViewportPromptId]
  );
  const showFreshViewportSpacer = Boolean(
    freshViewportPromptId
    && freshViewportPromptIndex >= 0
    && freshViewportSpacerHeight > 0
  );
  const thinkingStatusWord = normalizeThinkingStatusLabel(thinkingStatusLabel, "Thinking");
  const calculateFreshViewportBaseGap = useCallback(() => {
    if (!freshViewportPromptId || freshViewportPromptIndex < 0) return 0;

    const containerNode = messagesContainerRef.current;
    const promptNode = messageRowRefs.current.get(freshViewportPromptId);
    if (!(containerNode instanceof Element) || !(promptNode instanceof Element)) return 0;

    const promptHeight = promptNode.getBoundingClientRect().height || 0;
    const thinkingHeight = isLoading
      ? (
        thinkingRowRef.current instanceof Element
          ? (thinkingRowRef.current.getBoundingClientRect().height || 0)
          : 46
      )
      : 0;
    const containerHeight = containerNode.clientHeight || 0;
    const viewportPaddingAllowance = 26;

    return Math.max(
      0,
      Math.floor(containerHeight - promptHeight - thinkingHeight - viewportPaddingAllowance)
    );
  }, [freshViewportPromptId, freshViewportPromptIndex, isLoading]);
  const sidebarInlineStyle = useMemo(() => {
    if (sidebarHidden || !sidebarOpen || isCompactLayout || !sidebarWidth) return undefined;
    return { "--gemini-sidebar-open-width": `${sidebarWidth}px` };
  }, [isCompactLayout, sidebarHidden, sidebarOpen, sidebarWidth]);

  const [welcomeHeadlineText, welcomeSubtitleText] = useMemo(() => {
    const parts = String(animatedWelcomeText || "").split("\n");
    return [parts[0] || "", parts.slice(1).join("\n") || ""];
  }, [animatedWelcomeText]);

  const resizeInputField = useCallback(() => {
    const inputEl = inputFieldRef.current;
    if (!inputEl) return;

    inputEl.style.height = "0px";
    const nextHeight = Math.min(Math.max(inputEl.scrollHeight, 24), MAX_INPUT_HEIGHT);
    inputEl.style.height = `${nextHeight}px`;
    inputEl.style.overflowY = inputEl.scrollHeight > MAX_INPUT_HEIGHT ? "auto" : "hidden";
    inputEl.style.overflowX = "hidden";
    setIsInputExpanded(nextHeight > 34);
  }, []);

  const resizeEditingField = useCallback(() => {
    const inputEl = editingInputRef.current;
    if (!inputEl) return;

    inputEl.style.height = "0px";
    const nextHeight = Math.min(Math.max(inputEl.scrollHeight, 56), MAX_EDIT_QUERY_HEIGHT);
    inputEl.style.height = `${nextHeight}px`;
    inputEl.style.overflowY = inputEl.scrollHeight > MAX_EDIT_QUERY_HEIGHT ? "auto" : "hidden";
  }, []);

  useEffect(() => {
    resizeInputField();
  }, [input, resizeInputField]);

  useEffect(() => {
    if (!editingMessageId) return;
    resizeEditingField();
  }, [editingDraft, editingMessageId, resizeEditingField]);

  useEffect(() => {
    const fullWelcomeText = `${WELCOME_HEADLINE}\n${WELCOME_SUBTITLE}`;

    if (messages.length > 0) {
      setAnimatedWelcomeText(fullWelcomeText);
      return undefined;
    }

    let cursor = 0;
    let deleting = false;
    let holdCount = 0;
    let timeoutId = null;
    let cancelled = false;

    setAnimatedWelcomeText("");

    const step = () => {
      if (cancelled) return;

      if (!deleting) {
        cursor = Math.min(fullWelcomeText.length, cursor + 1);
        setAnimatedWelcomeText(fullWelcomeText.slice(0, cursor));

        if (cursor === fullWelcomeText.length) {
          holdCount += 1;
          if (holdCount >= 7) {
            deleting = true;
            holdCount = 0;
          }
        }
      } else {
        cursor = Math.max(0, cursor - 1);
        setAnimatedWelcomeText(fullWelcomeText.slice(0, cursor));

        if (cursor === 0) {
          deleting = false;
        }
      }

      const delay = cursor === fullWelcomeText.length && !deleting
        ? 120
        : deleting
          ? 24
          : 46;

      timeoutId = setTimeout(step, delay);
    };

    timeoutId = setTimeout(step, 260);

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [activeThreadId, messages.length]);

  const filteredVoices = useMemo(() => {
    if (!Array.isArray(availableVoices) || availableVoices.length === 0) return [];

    const filterByLangPrefix = (prefixes) =>
      availableVoices.filter((voice) =>
        prefixes.some((prefix) => String(voice.lang || "").toLowerCase().startsWith(prefix))
      );

    if (selectedLanguage === "hi") {
      const hindi = filterByLangPrefix(["hi"]);
      return hindi.length ? hindi : availableVoices;
    }

    if (selectedLanguage === "en") {
      const english = filterByLangPrefix(["en"]);
      return english.length ? english : availableVoices;
    }

    const auto = filterByLangPrefix(["en", "hi"]);
    return auto.length ? auto : availableVoices;
  }, [availableVoices, selectedLanguage]);

  const selectedVoice = useMemo(() => {
    const fromAll = availableVoices.find((voice) => voice.name === selectedVoiceName);
    if (fromAll) return fromAll;
    return filteredVoices[0] || null;
  }, [availableVoices, filteredVoices, selectedVoiceName]);

  const applyMessagesToThread = (thread, nextMessages) => {
    const clippedMessages = (nextMessages || []).slice(-MAX_MESSAGES_PER_THREAD);
    const autoTitle = getThreadTitleFromMessages(clippedMessages);
    return {
      ...thread,
      messages: clippedMessages,
      title: thread.isTitleManuallySet ? (thread.title || autoTitle) : autoTitle,
      updatedAt: Date.now()
    };
  };

  const updateActiveThreadMessages = (buildNextMessages) => {
    if (!activeThreadId) return;

    setThreads((prevThreads) =>
      prevThreads.map((thread) => {
        if (thread.id !== activeThreadId) return thread;
        const nextMessages = typeof buildNextMessages === "function"
          ? buildNextMessages(thread.messages || [])
          : buildNextMessages;
        return applyMessagesToThread(thread, nextMessages);
      })
    );
  };

  const updateActiveMessageById = (messageId, updater) => {
    if (!messageId) return;
    updateActiveThreadMessages((existingMessages) =>
      existingMessages.map((message) => {
        if (message.id !== messageId) return message;
        return typeof updater === "function" ? updater(message) : message;
      })
    );
  };

  const appendAiMessage = (text) => {
    updateActiveThreadMessages((existingMessages) => [
      ...existingMessages,
      createMessage("ai", text)
    ]);
  };

  const isAwaitingConfirmationMessage = (message) => {
    if (!message?.id || message?.role !== "ai") return false;
    if (message?.data?.agentResult?.kind !== "CONFIRMATION") return false;
    if (!message?.data?.agentMeta?.awaitingConfirmation) return false;

    const latestAiMessage = [...(activeThread?.messages || [])]
      .reverse()
      .find((item) => item?.role === "ai");

    return latestAiMessage?.id === message.id;
  };

  const updateConfirmationDraftValue = (key, value) => {
    setEditingConfirmationDraft((prev) => ({
      ...prev,
      [key]: value
    }));
  };

  const saveConfirmationEdit = async (message) => {
    const messageId = message?.id || "";
    if (!messageId || confirmationSaveBusy) return;

    setConfirmationSaveBusy(true);
    setConfirmationEditError("");
    try {
      const res = await api.post("/ai/pending-action/update", {
        threadId: activeThreadId,
        accountKey,
        patch: editingConfirmationDraft
      });

      const nextConfirmation = formatInfoPayload(res?.data?.confirmation || null);
      if (nextConfirmation?.kind === "CONFIRMATION") {
        updateActiveMessageById(messageId, (currentMessage) => ({
          ...currentMessage,
          data: {
            ...(currentMessage.data && typeof currentMessage.data === "object" ? currentMessage.data : {}),
            agentResult: nextConfirmation
          }
        }));
      }

      closeConfirmationEditor();
    } catch (err) {
      setConfirmationEditError(
        err?.response?.data?.error
        || err?.message
        || "Unable to update the confirmation draft right now."
      );
    } finally {
      setConfirmationSaveBusy(false);
    }
  };

  const handleArtifactAction = async (artifact) => {
    if (!artifact || typeof artifact !== "object") return;

    if (artifact.base64) {
      downloadBase64Artifact(artifact);
      return;
    }

    if (artifact.type === "NOTICE_OPEN" && artifact.noticeId) {
      navigate(`/notices/${artifact.noticeId}`);
      return;
    }

    if (artifact.type === "NOTICE_PDF" && artifact.noticeId) {
      try {
        const res = await api.get(`/notices/${artifact.noticeId}`);
        const notice = res?.data?.notice;
        if (!notice) {
          appendAiMessage("I could not find that notice to prepare the PDF.");
          return;
        }

        const pdfDoc = buildNoticePdfDocument(notice);
        await exportPdfFromPrintHtml({
          html: pdfDoc.html,
          title: pdfDoc.title,
          marginMm: 14
        });
      } catch (err) {
        appendAiMessage("I could not download that notice PDF right now.");
      }
    }
  };

  const closeConfirmationEditor = useCallback(() => {
    setEditingConfirmationMessageId("");
    setEditingConfirmationDraft({});
    setConfirmationEditError("");
  }, []);

  const openConfirmationEditor = (message) => {
    const confirmationData = message?.data?.agentResult;
    if (!confirmationData || confirmationData.kind !== "CONFIRMATION") return;
    setEditingConfirmationMessageId(message.id || "");
    setEditingConfirmationDraft(buildConfirmationEditDraft(confirmationData));
    setConfirmationEditError("");
  };

  const stopThinking = useCallback(() => {
    if (activeChatRequestRef.current) {
      activeChatRequestRef.current.abort();
      activeChatRequestRef.current = null;
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    const loadIdentity = async () => {
      try {
        const res = await api.get("/details");
        if (res?.data?.status === "Authenticated") {
          const details = res.data.details || {};
          const roleRaw = String(details.type || "").toUpperCase();
          const role = roleRaw === "ADMIN" ? "ADMIN" : roleRaw === "DEPARTMENT" ? "DEPARTMENT" : "USER";

          const emailLike = String(details.email || details._id || "unknown").toLowerCase();

          setAccountKey(`${role}:${emailLike}`);
        } else {
          setAccountKey("GUEST:local");
        }
      } catch (err) {
        setAccountKey("GUEST:local");
      } finally {
        setIdentityReady(true);
      }
    };

    loadIdentity();
  }, []);

  useEffect(() => {
    if (!identityReady) return;

    let loadedThreads = [];
    let loadedActiveId = "";

    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        loadedThreads = sanitizeStoredThreads(parsed?.threads || []);
        loadedActiveId = String(parsed?.activeThreadId || "");
      }
    } catch (err) {
      loadedThreads = [];
      loadedActiveId = "";
    }

    if (loadedThreads.length === 0) {
      const starter = createThread();
      loadedThreads = [starter];
      loadedActiveId = starter.id;
    }

    if (!loadedThreads.some((thread) => thread.id === loadedActiveId)) {
      loadedActiveId = loadedThreads[0].id;
    }

    setThreads(loadedThreads);
    setActiveThreadId(loadedActiveId);
    setEditingMessageId(null);
    setEditingDraft("");
    setOpenThreadMenuId("");
    setRenamingThreadId("");
    setThreadTitleDraft("");
    setDeleteConfirmThreadId("");
    closeConfirmationEditor();
    setHistoryReady(true);
  }, [closeConfirmationEditor, identityReady, storageKey]);

  useEffect(() => {
    if (!historyReady || !identityReady) return;

    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          threads: threads.slice(0, MAX_THREADS),
          activeThreadId
        })
      );
    } catch (err) {
      // Ignore storage write errors.
    }
  }, [threads, activeThreadId, storageKey, historyReady, identityReady]);

  useEffect(() => {
    if (!historyReady) return;
    if (threads.length > 0) return;

    const starter = createThread();
    setThreads([starter]);
    setActiveThreadId(starter.id);
  }, [threads, historyReady]);

  useEffect(() => {
    if (!threads.length) return;
    if (!threads.some((thread) => thread.id === activeThreadId)) {
      setActiveThreadId(threads[0].id);
    }
  }, [threads, activeThreadId]);

  useEffect(() => {
    if (openThreadMenuId && !threads.some((thread) => thread.id === openThreadMenuId)) {
      setOpenThreadMenuId("");
    }
    if (renamingThreadId && !threads.some((thread) => thread.id === renamingThreadId)) {
      setRenamingThreadId("");
      setThreadTitleDraft("");
    }
    if (deleteConfirmThreadId && !threads.some((thread) => thread.id === deleteConfirmThreadId)) {
      setDeleteConfirmThreadId("");
    }
  }, [threads, openThreadMenuId, renamingThreadId, deleteConfirmThreadId]);

  useEffect(() => {
    if (!openThreadMenuId) return undefined;

    const handleOutsideClick = (event) => {
      const menuNode = threadMenuRefs.current.get(openThreadMenuId);
      if (!menuNode) {
        setOpenThreadMenuId("");
        return;
      }
      if (menuNode.contains(event.target)) return;
      setOpenThreadMenuId("");
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setOpenThreadMenuId("");
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [openThreadMenuId]);

  useEffect(() => {
    if (!renamingThreadId && !deleteConfirmThreadId) return undefined;

    const handleEscape = (event) => {
      if (event.key !== "Escape") return;
      if (deleteConfirmThreadId) {
        setDeleteConfirmThreadId("");
        return;
      }
      cancelThreadRename();
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [cancelThreadRename, renamingThreadId, deleteConfirmThreadId]);

  useEffect(() => {
    closeConfirmationEditor();
  }, [activeThreadId, closeConfirmationEditor]);

  useLayoutEffect(() => {
    const pendingPromptViewport = pendingPromptViewportRef.current;
    if (!pendingPromptViewport || pendingPromptViewport.threadId !== activeThreadId) return undefined;

    let firstRafId = 0;
    let secondRafId = 0;
    let attempt = 0;

    const alignPromptAtViewportTop = () => {
      const containerNode = messagesContainerRef.current;
      const targetNode = messageRowRefs.current.get(pendingPromptViewport.messageId);
      if (!(containerNode instanceof Element) || !(targetNode instanceof Element)) {
        secondRafId = window.requestAnimationFrame(alignPromptAtViewportTop);
        return;
      }

      const containerRect = containerNode.getBoundingClientRect();
      const targetRect = targetNode.getBoundingClientRect();
      const offsetY = targetRect.top - containerRect.top;
      if (Math.abs(offsetY) > 0.5) {
        containerNode.scrollTop += offsetY;
      }
      containerNode.scrollLeft = 0;

      const baseGap = calculateFreshViewportBaseGap();
      freshViewportBaseGapRef.current = baseGap;
      setFreshViewportSpacerHeight(baseGap);

      const postContainerRect = containerNode.getBoundingClientRect();
      const postTargetRect = targetNode.getBoundingClientRect();
      const residualOffset = postTargetRect.top - postContainerRect.top;

      if (Math.abs(residualOffset) > 0.5 && attempt < 6) {
        attempt += 1;
        secondRafId = window.requestAnimationFrame(alignPromptAtViewportTop);
        return;
      }

      freshViewportAnchorScrollTopRef.current = containerNode.scrollTop;
      freshViewportMaxScrollUpRef.current = 0;
      pendingPromptViewportRef.current = null;
    };

    firstRafId = window.requestAnimationFrame(() => {
      secondRafId = window.requestAnimationFrame(alignPromptAtViewportTop);
    });

    return () => {
      if (firstRafId) window.cancelAnimationFrame(firstRafId);
      if (secondRafId) window.cancelAnimationFrame(secondRafId);
    };
  }, [messages, activeThreadId, calculateFreshViewportBaseGap]);

  useEffect(() => {
    if (!freshViewportPromptId) return;
    if (freshViewportPromptIndex >= 0) return;
    setFreshViewportPromptId("");
    setFreshViewportSpacerHeight(0);
    freshViewportBaseGapRef.current = 0;
    freshViewportMaxScrollUpRef.current = 0;
  }, [freshViewportPromptId, freshViewportPromptIndex]);

  useEffect(() => {
    const containerNode = messagesContainerRef.current;
    if (
      !freshViewportPromptId
      || freshViewportPromptIndex < 0
      || !(containerNode instanceof Element)
    ) return undefined;

    const handleScroll = () => {
      const traveledDistance = Math.abs(containerNode.scrollTop - freshViewportAnchorScrollTopRef.current);
      if (traveledDistance <= freshViewportMaxScrollUpRef.current) return;

      freshViewportMaxScrollUpRef.current = traveledDistance;
      const nextGap = Math.max(0, freshViewportBaseGapRef.current - traveledDistance);
      setFreshViewportSpacerHeight((prevGap) => (Math.abs(prevGap - nextGap) < 1 ? prevGap : nextGap));

      if (nextGap <= 0) {
        setFreshViewportPromptId("");
      }
    };

    containerNode.addEventListener("scroll", handleScroll, { passive: true });
    return () => containerNode.removeEventListener("scroll", handleScroll);
  }, [freshViewportPromptId, freshViewportPromptIndex]);

  useEffect(() => {
    if (!freshViewportPromptId || freshViewportPromptIndex < 0) return undefined;

    const handleResize = () => {
      const containerNode = messagesContainerRef.current;
      const promptNode = messageRowRefs.current.get(freshViewportPromptId);
      const canReAnchor =
        freshViewportMaxScrollUpRef.current <= 1
        && containerNode instanceof Element
        && promptNode instanceof Element;

      if (canReAnchor) {
        const containerRect = containerNode.getBoundingClientRect();
        const promptRect = promptNode.getBoundingClientRect();
        const offsetY = promptRect.top - containerRect.top;
        if (Math.abs(offsetY) > 0.5) {
          containerNode.scrollTop += offsetY;
        }
        freshViewportAnchorScrollTopRef.current = containerNode.scrollTop;
      }

      const nextBaseGap = calculateFreshViewportBaseGap();
      freshViewportBaseGapRef.current = nextBaseGap;
      const nextGap = Math.max(0, nextBaseGap - freshViewportMaxScrollUpRef.current);
      setFreshViewportSpacerHeight(nextGap);
      if (nextGap <= 0) {
        setFreshViewportPromptId("");
      }
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    const visualViewport = window.visualViewport;
    if (visualViewport) {
      visualViewport.addEventListener("resize", handleResize);
      visualViewport.addEventListener("scroll", handleResize);
    }

    return () => {
      window.removeEventListener("resize", handleResize);
      if (visualViewport) {
        visualViewport.removeEventListener("resize", handleResize);
        visualViewport.removeEventListener("scroll", handleResize);
      }
    };
  }, [freshViewportPromptId, freshViewportPromptIndex, calculateFreshViewportBaseGap]);

  useEffect(() => {
    if (!pendingSearchJump) return;
    if (pendingSearchJump.threadId !== activeThreadId) return;

    const targetNode = messageRowRefs.current.get(pendingSearchJump.messageId);
    if (!targetNode) {
      setPendingSearchJump(null);
      return;
    }

    requestAnimationFrame(() => {
      targetNode.scrollIntoView({ behavior: "smooth", block: "center" });
    });

    setSearchHighlight({
      threadId: pendingSearchJump.threadId,
      messageId: pendingSearchJump.messageId,
      query: pendingSearchJump.query
    });
    setPendingSearchJump(null);
  }, [pendingSearchJump, activeThreadId, messages]);

  useEffect(() => {
    if (!searchHighlight?.messageId) return;
    const timeoutId = setTimeout(() => setSearchHighlight(null), 5200);
    return () => clearTimeout(timeoutId);
  }, [searchHighlight]);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return undefined;

    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices() || [];
      setAvailableVoices(voices);
    };

    window.speechSynthesis.onvoiceschanged = loadVoices;
    loadVoices();

    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  useEffect(() => {
    if (!filteredVoices.length) {
      setSelectedVoiceName("");
      return;
    }

    const isCurrentValid = filteredVoices.some((voice) => voice.name === selectedVoiceName);
    if (isCurrentValid) return;

    const preferred =
      selectedLanguage === "hi"
        ? filteredVoices.find((voice) => String(voice.lang || "").toLowerCase().startsWith("hi"))
        : filteredVoices.find((voice) =>
          /google|zira|david|heera|male|female/i.test(String(voice.name || ""))
        ) || filteredVoices[0];

    setSelectedVoiceName(preferred?.name || "");
  }, [filteredVoices, selectedLanguage, selectedVoiceName]);

  const resolveSpeechLanguage = (text) => {
    if (selectedLanguage === "hi") return "hi";
    if (selectedLanguage === "en") return "en";
    return detectHindiScript(text) ? "hi" : "en";
  };

  const speakWithBrowserFallback = (cleanText) => {
    if (!("speechSynthesis" in window)) {
      setAiSpeaking(false);
      if (isLiveModeRef.current) setTimeout(() => startListening(), 350);
      return;
    }

    const outputLanguage = resolveSpeechLanguage(cleanText);

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = outputLanguage === "hi" ? "hi-IN" : "en-US";

    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }

    utterance.rate = 1.02;
    utterance.pitch = 1;

    utterance.onstart = () => setAiSpeaking(true);
    utterance.onend = () => {
      setAiSpeaking(false);
      if (isLiveModeRef.current) setTimeout(() => startListening(), 350);
    };
    utterance.onerror = () => {
      setAiSpeaking(false);
      if (isLiveModeRef.current) setTimeout(() => startListening(), 350);
    };

    window.speechSynthesis.speak(utterance);
  };

  const speak = async (text, options = {}) => {
    const cleanText = String(text || "").replace(/[*#]/g, "").trim();
    if (!cleanText) return;

    const mode = options.mode || "live_chat";
    const modelId = options.modelId || null;
    const language = resolveSpeechLanguage(cleanText);

    const played = await playElevenLabsSpeech({
      text: cleanText,
      mode,
      modelId,
      language,
      onStart: () => setAiSpeaking(true),
      onEnd: () => {
        setAiSpeaking(false);
        if (isLiveModeRef.current) setTimeout(() => startListening(), 350);
      },
      onError: (err) => {
        setAiSpeaking(false);
        const status = Number(err?.status) || 0;
        const code = String(err?.code || "").trim().toUpperCase();
        const signature = `${status}:${code}`;
        if (signature && signature !== lastVoiceFailureRef.current) {
          lastVoiceFailureRef.current = signature;
          const detail = String(err?.message || "Unknown voice error");
          console.warn(
            `[AI voice] ElevenLabs failed (${status || "status-unknown"}${code ? `, ${code}` : ""}). ${detail}`
          );
        }
      }
    });

    if (!played) {
      speakWithBrowserFallback(cleanText);
    }
  };

  const startListening = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      appendAiMessage("Voice input is not supported in this browser.");
      return;
    }

    if (!recognitionRef.current) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;

      recognitionRef.current.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        if (isLiveModeRef.current) {
          sendMessage(transcript);
        } else {
          setInput(transcript);
        }
      };

      recognitionRef.current.onend = () => setIsListening(false);
      recognitionRef.current.onerror = () => setIsListening(false);
    }

    recognitionRef.current.lang = selectedLanguage === "hi"
      ? "hi-IN"
      : selectedLanguage === "en"
        ? "en-US"
        : "en-IN";

    try {
      recognitionRef.current.start();
      setIsListening(true);
    } catch (err) {
      // Ignore start race errors.
    }
  };

  const stopListening = () => {
    if (!recognitionRef.current) return;
    recognitionRef.current.stop();
    setIsListening(false);
  };

  const toggleMic = () => {
    if (isListening) stopListening();
    else startListening();
  };

  const createNewThread = () => {
    const thread = createThread();
    setThreads((prev) => [thread, ...prev].slice(0, MAX_THREADS));
    setActiveThreadId(thread.id);
    setInput("");
    setEditingMessageId(null);
    setEditingDraft("");
    setOpenThreadMenuId("");
    setRenamingThreadId("");
    setThreadTitleDraft("");
    setDeleteConfirmThreadId("");
    closeConfirmationEditor();
  };

  const copyToClipboard = async (text, messageId) => {
    const value = String(text || "");
    if (!value.trim()) return;

    try {
      await navigator.clipboard.writeText(value);
      setCopiedMessageId(messageId);
      setTimeout(() => {
        setCopiedMessageId((current) => (current === messageId ? "" : current));
      }, 1500);
    } catch (err) {
      // Clipboard can fail in non-secure contexts.
    }
  };

  const openAttachmentPicker = () => {
    if (isLoading) return;
    fileInputRef.current?.click();
  };

  const removePendingAttachment = (attachmentId) => {
    setPendingAttachments((prev) => prev.filter((item) => item.id !== attachmentId));
  };

  const handleAttachmentInputChange = async (event) => {
    const selectedFiles = Array.from(event.target.files || []);
    if (selectedFiles.length === 0) return;

    const availableSlots = Math.max(0, MAX_ATTACHMENT_COUNT - pendingAttachments.length);
    if (availableSlots <= 0) {
      event.target.value = "";
      return;
    }

    const filesToRead = selectedFiles.slice(0, availableSlots);
    const attachmentEntries = await Promise.all(
      filesToRead.map(
        (file) =>
          new Promise((resolve) => {
            if (!file || file.size > MAX_ATTACHMENT_BYTES) {
              resolve(null);
              return;
            }

            const reader = new FileReader();
            reader.onload = () => {
              const dataUrl = String(reader.result || "");
              if (!dataUrl) {
                resolve(null);
                return;
              }

              resolve({
                id: createId(),
                name: file.name || "attachment",
                type: file.type || "application/octet-stream",
                size: file.size || 0,
                contentBase64: dataUrl
              });
            };
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(file);
          })
      )
    );

    const validEntries = attachmentEntries.filter(Boolean);
    if (validEntries.length > 0) {
      setPendingAttachments((prev) => [...prev, ...validEntries].slice(0, MAX_ATTACHMENT_COUNT));
    }

    event.target.value = "";
  };

  const formatInfoPayload = (data) => {
    if (Array.isArray(data)) {
      const sorted = [...data].sort((a, b) => (String(a.status || "").toUpperCase() === "FREE" ? -1 : 1));
      return {
        kind: "TABLE",
        title: "Hall Status Report",
        summary: `Total halls: ${sorted.length}`,
        columns: ["Hall", "Status", "Booked", "Closed", "Event", "Closure Reason"],
        rows: sorted.map((hall) => {
          const normalized = String(hall.status || "").toUpperCase();
          const status = normalized === "FREE" || normalized === "AVAILABLE" ? "AVAILABLE" : "FILLED";
          return [
            hall.hall || "",
            status,
            status === "AVAILABLE" ? "NOT BOOKED" : "BOOKED",
            status === "AVAILABLE" ? "OPEN" : "OPEN",
            status === "AVAILABLE" ? "-" : (hall.currentEvent || "None"),
            "-"
          ];
        }),
        plainText: sorted
          .map((hall) => {
            const normalized = String(hall.status || "").toUpperCase();
            const detail = normalized === "FREE" || normalized === "AVAILABLE"
              ? "Available"
              : `Filled (${hall.currentEvent || "None"})`;
            return `- ${hall.hall}: ${detail}`;
          })
          .join("\n")
      };
    }

    if (!data || typeof data !== "object") {
      return {
        kind: "TEXT",
        title: "AI Result",
        plainText: JSON.stringify(data)
      };
    }

    if (data.kind === "CONFIRMATION") {
      const rows = Array.isArray(data.rows) ? data.rows : [];
      return {
        kind: "CONFIRMATION",
        confirmationType: data.confirmationType || "",
        title: data.title || "Please Confirm",
        summary: data.summary || "",
        prompt: data.prompt || "Please confirm whether this is correct.",
        columns: Array.isArray(data.columns) ? data.columns : ["Field", "Value"],
        rows,
        editForm: data.editForm && typeof data.editForm === "object" ? data.editForm : null,
        plainText: data.plainText || rows.map((row) => (Array.isArray(row) ? row.join(" - ") : "")).join("\n")
      };
    }

    if (data.kind === "HALL_STATUS") {
      const items = Array.isArray(data.items) ? data.items : [];
      const dateLabel = data.date
        ? data.date
        : (data.dateFrom && data.dateTo ? `${data.dateFrom} to ${data.dateTo}` : (data.dateFrom || data.dateTo || ""));
      const dateTitle = dateLabel ? ` (${dateLabel})` : "";
      const modeLine = data.mode && data.mode !== "ALL" ? `Filter: ${data.mode}\n` : "";
      const hallLine = data.targetHall ? `Hall: ${data.targetHall}\n` : "";

      if (items.length === 0) {
        return {
          kind: "TABLE",
          title: `Hall Status${dateTitle}`,
          summary: `${modeLine}${hallLine}`.trim(),
          columns: ["Hall", "Overall Status", "Booked", "Closed", "Event", "Timings", "Closure Reason"],
          rows: [],
          plainText: ""
        };
      }

      return {
        kind: "TABLE",
        title: `Hall Status${dateTitle}`,
        summary: `${modeLine}${hallLine}`.trim(),
        columns: ["Hall", "Overall Status", "Booked", "Closed", "Event", "Timings", "Closure Reason"],
        rows: items.map((item) => [
          item.hall || "",
          item.status || "",
          item.bookingStatus || "",
          item.closureStatus || "",
          item.currentEvent || "-",
          item.bookingTimingsText || (
            Array.isArray(item.bookingTimings) && item.bookingTimings.length > 0
              ? item.bookingTimings.join(", ")
              : "-"
          ),
          item.closureReason || "-"
        ]),
        plainText: ""
      };
    }

    if (data.kind === "BOOKING_REQUESTS") {
      const items = Array.isArray(data.items) ? data.items : [];
      const summary = data.summary || {};
      const dateLabel = data.date
        ? data.date
        : (data.dateFrom && data.dateTo ? `${data.dateFrom} to ${data.dateTo}` : (data.dateFrom || data.dateTo || ""));
      const dateTitle = dateLabel ? ` (${dateLabel})` : "";
      const filterLine = `Filter: ${data.filter || "ALL"}`;
      const hallLine = data.targetHall ? ` | Hall: ${data.targetHall}` : "";

      let text = `Pending Booking Requests${dateTitle}\n${filterLine}${hallLine}\n`;
      text += `Total: ${summary.total || 0}, Conflicting: ${summary.conflicting || 0}, Non-conflicting: ${summary.nonConflicting || 0}, Time conflicts: ${summary.timeConflicts || 0}, Date conflicts: ${summary.dateConflicts || 0}, Closures: ${summary.closureConflicts || 0}`;

      if (items.length === 0) {
        return {
          kind: "TABLE",
          title: `Pending Booking Requests${dateTitle}`,
          summary: `${filterLine}${hallLine} | Total: ${summary.total || 0}, Conflicting: ${summary.conflicting || 0}, Non-conflicting: ${summary.nonConflicting || 0}`,
          columns: ["Hall", "Date", "Time", "Event", "Requested By", "Conflict", "Detail"],
          rows: [],
          plainText: `${text}\n\nNo requests matched this query.`
        };
      }

      const lines = items.map((item, idx) => {
        const label = item.conflict === "CONFLICTING" ? (item.conflictType || "CONFLICTING") : "NON-CONFLICTING";
        return `${idx + 1}. [${label}] ${item.hall} | ${item.date} ${item.start} - ${item.end}\n   Event: ${item.event}\n   By: ${item.requestedBy} (${item.requestedEmail})\n   Detail: ${item.conflictDetail || "No conflict detected."}`;
      });

      return {
        kind: "TABLE",
        title: `Pending Booking Requests${dateTitle}`,
        summary: `${filterLine}${hallLine} | Total: ${summary.total || 0}, Conflicting: ${summary.conflicting || 0}, Non-conflicting: ${summary.nonConflicting || 0}`,
        columns: ["Hall", "Date", "Time", "Event", "Requested By", "Conflict", "Detail"],
        rows: items.map((item) => [
          item.hall || "",
          item.date || "",
          `${item.start || ""} - ${item.end || ""}`.trim(),
          item.event || "",
          `${item.requestedBy || ""} (${item.requestedEmail || ""})`.trim(),
          item.conflict === "CONFLICTING" ? (item.conflictType || "CONFLICTING") : "NON-CONFLICTING",
          item.conflictDetail || (item.conflict === "CONFLICTING" ? "Conflict detected." : "No conflict")
        ]),
        plainText: `${text}\n\n${lines.join("\n")}`
      };
    }

    if (data.kind === "CALENDAR_TASK") {
      const rows = Array.isArray(data.rows) ? data.rows : [];
      return {
        kind: "TABLE",
        title: data.title || "Calendar Task",
        summary: data.summary || "Public calendar task created successfully.",
        columns: Array.isArray(data.columns) ? data.columns : ["Field", "Value"],
        rows,
        plainText: rows.map((row) => (Array.isArray(row) ? row.join(" - ") : "")).join("\n")
      };
    }

    if (data.kind === "NOTICE_RESULT") {
      const rows = Array.isArray(data.rows) ? data.rows : [];
      return {
        kind: "TABLE",
        title: data.title || "Notice Posted",
        summary: data.summary || "Notice posted successfully.",
        columns: Array.isArray(data.columns) ? data.columns : ["Field", "Value"],
        rows,
        artifacts: data.noticeId
          ? [
              { type: "NOTICE_OPEN", name: "Open Notice", noticeId: data.noticeId },
              { type: "NOTICE_PDF", name: "Download Notice PDF", noticeId: data.noticeId }
            ]
          : [],
        plainText: [data.summary, data.content].filter(Boolean).join("\n\n") || rows.map((row) => (Array.isArray(row) ? row.join(" - ") : "")).join("\n")
      };
    }

    if (data.kind === "EMAIL_RESULT") {
      const rows = Array.isArray(data.rows) ? data.rows : [];
      return {
        kind: "TABLE",
        title: data.title || "Email Sent",
        summary: data.summary || "",
        columns: Array.isArray(data.columns) ? data.columns : ["Field", "Value"],
        rows,
        plainText: [data.title, data.summary].filter(Boolean).join("\n") || rows.map((row) => (Array.isArray(row) ? row.join(" - ") : "")).join("\n")
      };
    }

    if (data.kind === "SCHEDULE_EXPORT") {
      const rows = Array.isArray(data.rows) ? data.rows : [];
      const artifacts = Array.isArray(data.artifacts) ? data.artifacts : [];
      return {
        kind: "SCHEDULE_EXPORT",
        title: `Schedule Export (${data.date || "Selected date"})`,
        summary: `Requested format: ${data.formatRequested || "PDF"} | Rows: ${rows.length}`,
        columns: Array.isArray(data.columns) && data.columns.length ? data.columns : ["Hall", "Status", "Event", "Department", "Time"],
        rows: rows.map((row) => [
          row.hall || "",
          row.status || "",
          row.event || "",
          row.department || "",
          row.timeRange || ""
        ]),
        artifacts,
        plainText: `Prepared schedule export for ${data.date || "selected date"} with ${rows.length} row(s).`
      };
    }

    if (Array.isArray(data.rows) && Array.isArray(data.columns)) {
      return {
        kind: "TABLE",
        title: data.title || "AI Result",
        summary: data.summary || "",
        columns: data.columns,
        rows: data.rows,
        artifacts: Array.isArray(data.artifacts) ? data.artifacts : [],
        plainText: data.plainText || data.rows.map((row) => (Array.isArray(row) ? row.join(" - ") : "")).join("\n")
      };
    }

    return {
      kind: "TEXT",
      title: "AI Result",
      plainText: JSON.stringify(data, null, 2)
    };
  };

  const buildAgentMessageData = (meta, extra = {}) => {
    const normalizedMeta = meta && typeof meta === "object" ? meta : null;
    if (!normalizedMeta && !extra.actionIntent) return null;

    const formattedResultData = normalizedMeta?.resultData
      ? formatInfoPayload(normalizedMeta.resultData)
      : null;
    const resultData = formattedResultData?.kind === "CONFIRMATION" && !normalizedMeta?.awaitingConfirmation
      ? null
      : formattedResultData;

    return {
      agentMeta: normalizedMeta,
      agentResult: resultData,
      actionIntent: extra.actionIntent && typeof extra.actionIntent === "object" ? extra.actionIntent : null
    };
  };

  const buildReplyMessageData = (replyData) => {
    if (!replyData || typeof replyData !== "object") return null;
    const meta = replyData.meta && typeof replyData.meta === "object" ? replyData.meta : null;
    const actionIntent = replyData.type === "ACTION"
      ? {
          action: replyData.action || "",
          payload: replyData.payload || {},
          reply: replyData.reply || ""
        }
      : null;
    return buildAgentMessageData(meta, { actionIntent });
  };

  const formatAgentLabel = (value) =>
    String(value || "")
      .split(/[_:/-]+/g)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ");

  const renderAgentMeta = (data) => {
    const meta = data?.agentMeta || data?.streamMeta || null;
    if (!meta || typeof meta !== "object") return null;

    const toolCalls = Array.isArray(meta.toolCalls) ? meta.toolCalls.slice(0, 6) : [];
    const trace = Array.isArray(meta.trace) ? meta.trace.slice(0, 4) : [];
    const reviewTask = meta.reviewTask && typeof meta.reviewTask === "object" ? meta.reviewTask : null;

    return (
      <div className="ai-agent-panel">
        <div className="ai-agent-badges">
          {meta.mode && <span className="ai-agent-badge">{formatAgentLabel(meta.mode)}</span>}
          {meta.provider && <span className="ai-agent-badge">{formatAgentLabel(meta.provider)}</span>}
          {meta.complexity && <span className="ai-agent-badge">{formatAgentLabel(meta.complexity)}</span>}
          {meta.queryMode && <span className="ai-agent-badge">{formatAgentLabel(meta.queryMode)}</span>}
          {meta.humanReviewRecommended && (
            <span className="ai-agent-badge warning">Human Review</span>
          )}
        </div>

        {meta.planSummary && <div className="ai-agent-summary">{meta.planSummary}</div>}

        {reviewTask && (
          <div className="ai-review-card">
            <div className="ai-review-card-head">
              <strong>{reviewTask.title || "Review Task Created"}</strong>
              <span>{reviewTask.status || "PENDING"}</span>
            </div>
            <p>{reviewTask.summary || "This action is waiting for human approval before execution."}</p>
            <div className="ai-review-card-meta">
              <span>Risk: {reviewTask.riskLevel || "HIGH"}</span>
              <span>Task ID: {reviewTask.id || "--"}</span>
            </div>
          </div>
        )}

        {toolCalls.length > 0 && (
          <div className="ai-agent-call-list">
            {toolCalls.map((call, index) => (
              <div key={`${call.name || "tool"}-${index}`} className="ai-agent-call">
                <div className="ai-agent-call-head">
                  <strong>{formatAgentLabel(call.name || "tool")}</strong>
                  <span>{formatAgentLabel(call.status || "ok")}</span>
                </div>
                {call.summary && <p>{call.summary}</p>}
              </div>
            ))}
          </div>
        )}

        {trace.length > 0 && (
          <div className="ai-agent-trace">
            {trace.map((step, index) => (
              <span key={`${step.node || step.agent || "trace"}-${index}`}>
                {formatAgentLabel(step.node || step.agent || "stage")}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  };

  const streamConversationViaWebSocket = ({
    message,
    history,
    language,
    userRole,
    threadId,
    accountKey,
    abortSignal,
    onStatus
  }) =>
    new Promise((resolve) => {
      const wsUrl = resolveAiWebSocketUrl();
      if (!wsUrl || typeof window === "undefined" || typeof window.WebSocket === "undefined") {
        resolve({ status: "unsupported", text: "" });
        return;
      }

      const requestId = createId();
      let completed = false;
      let accumulated = "";
      let responseStarted = false;
      let socket;

      const finish = (result) => {
        if (completed) return;
        completed = true;
        try {
          socket?.close();
        } catch (err) {
          // Ignore close errors.
        }
        resolve(result);
      };

      const onAbort = () => finish({ status: "aborted", text: "" });
      if (abortSignal) {
        if (abortSignal.aborted) {
          onAbort();
          return;
        }
        abortSignal.addEventListener("abort", onAbort, { once: true });
      }

      try {
        socket = new window.WebSocket(wsUrl);
      } catch (err) {
        finish({ status: "unsupported", text: "" });
        return;
      }

      const timeoutId = setTimeout(() => {
        finish({ status: "timeout", text: "" });
      }, 30000);

      socket.onopen = () => {
        socket.send(
          JSON.stringify({
            type: "chat.stream",
            requestId,
            payload: {
              message,
              history,
              language,
              userRole,
              threadId,
              accountKey
            }
          })
        );
      };

      socket.onmessage = (event) => {
        let packet = null;
        try {
          packet = JSON.parse(String(event.data || "{}"));
        } catch (err) {
          return;
        }

        if (packet?.requestId && packet.requestId !== requestId) return;

        if (packet?.type === "chat.stream.redirect_http") {
          clearTimeout(timeoutId);
          finish({ status: "redirect", text: "" });
          return;
        }

        if (packet?.type === "chat.stream.start") {
          const statusLabel = packet?.meta?.status || packet?.meta?.mode || "Analyzing";
          if (typeof onStatus === "function") onStatus(normalizeThinkingStatusLabel(statusLabel, "Analyzing"));
          return;
        }

        if (packet?.type === "chat.stream.status") {
          const statusLabel =
            packet?.status
            || packet?.label
            || packet?.stage
            || packet?.text
            || "Thinking";
          if (typeof onStatus === "function") onStatus(normalizeThinkingStatusLabel(statusLabel, "Thinking"));
          return;
        }

        if (packet?.type === "chat.stream.delta") {
          if (!responseStarted) {
            responseStarted = true;
            if (typeof onStatus === "function") onStatus("Responding");
          }
          accumulated += String(packet.token || "");
          return;
        }

        if (packet?.type === "chat.stream.end") {
          clearTimeout(timeoutId);
          const finalText = String(packet.text || accumulated || "").trim();
          finish({
            status: "ok",
            text: finalText,
            meta: packet.meta && typeof packet.meta === "object" ? packet.meta : null
          });
          return;
        }

        if (packet?.type === "chat.stream.error") {
          clearTimeout(timeoutId);
          finish({
            status: "error",
            text: "",
            error: String(packet.error || "stream_error")
          });
        }
      };

      socket.onerror = () => {
        clearTimeout(timeoutId);
        finish({ status: "error", text: "" });
      };

      socket.onclose = () => {
        if (!completed) {
          clearTimeout(timeoutId);
          finish({ status: accumulated ? "ok" : "error", text: accumulated.trim() });
        }
      };
    });

  const sendMessage = async (textOverride = null, options = {}) => {
    const rawText = textOverride == null ? input : textOverride;
    const textToSend = String(rawText || "").trim();
    const ignoreComposerAttachments = Boolean(options.ignoreComposerAttachments);
    const activePendingAttachments = ignoreComposerAttachments ? [] : pendingAttachments;

    if ((!textToSend && activePendingAttachments.length === 0) || !activeThreadId || isLoading) return;

    const replaceFromIndex = Number.isInteger(options.replaceFromIndex)
      ? Math.max(0, options.replaceFromIndex)
      : null;

    const currentMessages = activeThread?.messages || [];
    const historyMessages = replaceFromIndex == null
      ? currentMessages
      : currentMessages.slice(0, replaceFromIndex);
    const latestAiThreadMessage = [...historyMessages].reverse().find((msg) => msg?.role === "ai") || null;
    const awaitingThreadConfirmation = Boolean(
      latestAiThreadMessage?.data?.agentMeta?.awaitingConfirmation
    );

    const requestAttachments = activePendingAttachments.map((item) => ({
      name: item.name,
      type: item.type,
      contentBase64: item.contentBase64
    }));

    const userAttachmentMeta = activePendingAttachments.map((item) => ({
      id: item.id,
      name: item.name,
      type: item.type,
      size: item.size
    }));

    const composedUserText = textToSend || (userAttachmentMeta.length > 0
      ? `Uploaded ${userAttachmentMeta.length} attachment(s).`
      : "");

    const userMessage = createMessage("user", composedUserText, {
      attachments: userAttachmentMeta
    });
    pendingPromptViewportRef.current = {
      threadId: activeThreadId,
      messageId: userMessage.id
    };
    setFreshViewportPromptId(userMessage.id);
    setFreshViewportSpacerHeight(0);
    freshViewportBaseGapRef.current = 0;
    freshViewportAnchorScrollTopRef.current = 0;
    freshViewportMaxScrollUpRef.current = 0;

    updateActiveThreadMessages(() => [...historyMessages, userMessage]);
    setInput("");
    if (!ignoreComposerAttachments) {
      setPendingAttachments([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
    setThinkingStatusLabel("Analyzing");
    setIsLoading(true);
    const requestController = new AbortController();
    activeChatRequestRef.current = requestController;

    try {
      const roleForStream = String(accountKey || "GUEST").split(":")[0] || "GUEST";
      const shouldTryStream =
        requestAttachments.length === 0
        && !isLikelyActionPrompt(composedUserText)
        && !awaitingThreadConfirmation
        && !options.forceHttp;

      if (shouldTryStream) {
        const streamResult = await streamConversationViaWebSocket({
          message: composedUserText,
          history: toServerHistory(historyMessages),
          language: selectedLanguage,
          userRole: roleForStream,
          threadId: activeThreadId,
          accountKey,
          abortSignal: requestController.signal,
          onStatus: (nextStatus) => setThinkingStatusLabel(normalizeThinkingStatusLabel(nextStatus))
        });

        if (requestController.signal.aborted) return;

        if (streamResult.status === "ok" && streamResult.text) {
          const streamedActionIntent = streamResult?.meta?.actionIntent && typeof streamResult.meta.actionIntent === "object"
            ? {
                action: String(streamResult.meta.actionIntent.action || "").toUpperCase().trim(),
                payload: streamResult.meta.actionIntent.payload && typeof streamResult.meta.actionIntent.payload === "object"
                  ? streamResult.meta.actionIntent.payload
                  : {},
                reply: String(streamResult.meta.actionIntent.reply || "").trim()
              }
            : extractActionIntentFromText(streamResult.text);

          // If stream produced an action-shaped output, switch to HTTP path so it can execute via /ai/execute.
          if (streamedActionIntent?.action) {
            // Continue to HTTP fallback path below.
          } else if (looksLikeActionJsonLeak(streamResult.text)) {
            // Continue to HTTP fallback path below.
          } else {
            updateActiveThreadMessages((existingMessages) => [
              ...existingMessages,
              createMessage("ai", streamResult.text, {
                data: buildAgentMessageData(streamResult.meta)
              })
            ]);

            if (isLiveModeRef.current) {
              speak(streamResult.text);
            }
            return;
          }
        }

        if (streamResult.status === "aborted") return;
      }

      setThinkingStatusLabel("Planning");
      const res = await api.post("/ai/chat", {
        message: composedUserText,
        history: toServerHistory(historyMessages),
        language: selectedLanguage,
        threadId: activeThreadId,
        accountKey,
        attachments: requestAttachments
      }, { signal: requestController.signal });

      if (requestController.signal.aborted) return;

      const replyData = res?.data?.reply;
      let normalizedReplyData = replyData;

      let aiText = "";
      let isAction = false;

      if (normalizedReplyData && typeof normalizedReplyData === "object") {
        if (normalizedReplyData.type === "CHAT") {
          aiText = normalizedReplyData.message || normalizedReplyData.reply || "I could not understand that fully.";
        } else if (normalizedReplyData.type === "ACTION") {
          isAction = true;
          aiText = normalizedReplyData.reply || "Processing your request.";
        } else {
          aiText = normalizedReplyData.message || JSON.stringify(normalizedReplyData);
        }
      } else {
        aiText = String(normalizedReplyData || "Communication error.");
      }

      if (!isAction) {
        const leakedAction = extractActionIntentFromText(aiText);
        if (leakedAction?.action) {
          isAction = true;
          normalizedReplyData = {
            type: "ACTION",
            action: leakedAction.action,
            payload: leakedAction.payload || {},
            reply: leakedAction.reply || "Processing your request."
          };
          aiText = normalizedReplyData.reply;
        }
      }

      if (!isAction && looksLikeActionJsonLeak(aiText)) {
        aiText = "I understood your request. Processing it now.";
      }

      if (aiText) {
        updateActiveThreadMessages((existingMessages) => [
          ...existingMessages,
          createMessage("ai", aiText, {
            data: buildReplyMessageData(normalizedReplyData)
          })
        ]);

        if (isLiveModeRef.current) {
          speak(aiText);
        }
      }

      if (isAction && normalizedReplyData?.action && !normalizedReplyData?.meta?.awaitingConfirmation) {
        setThinkingStatusLabel("Executing");
        const exec = await api.post("/ai/execute", {
          intent: normalizedReplyData,
          threadId: activeThreadId,
          accountKey
        }, { signal: requestController.signal });
        if (requestController.signal.aborted) return;

        let execResultText = "";
        let execResultData = null;
        let execSpeechText = "";
        if (exec.data.status === "DONE") {
          execResultText = String(exec.data.message || "I completed your request successfully.");
          execSpeechText = execResultText;
        } else if (exec.data.status === "INFO") {
          const infoPayload = formatInfoPayload(exec.data.data);
          execResultData = infoPayload;
          const isHallStatusTable = String(exec?.data?.data?.kind || "").toUpperCase() === "HALL_STATUS";
          execResultText = isHallStatusTable
            ? ""
            : (infoPayload?.plainText || infoPayload?.summary || "Here is the generated result.");
          execSpeechText = [infoPayload?.title, infoPayload?.summary].filter(Boolean).join(". ")
            || execResultText
            || "Here is the generated result.";
        } else if (exec.data.status === "ERROR") {
          execResultText = `I couldn't complete that request: ${exec.data.msg || "Unknown error."}`;
          execSpeechText = execResultText;
        } else if (exec.data.status === "READY") {
          try {
            await api.post(exec.data.call, exec.data.payload, { signal: requestController.signal });
            if (requestController.signal.aborted) return;
            execResultText = "I have sent the booking request successfully.";
            execSpeechText = execResultText;
          } catch (executionErr) {
            const executionCancelled = executionErr?.code === "ERR_CANCELED"
              || executionErr?.name === "CanceledError";
            if (executionCancelled) return;
            execResultText = `I couldn't complete that request: ${executionErr.response?.data?.msg || executionErr.message}`;
            execSpeechText = execResultText;
          }
        }

        if (execResultText || execResultData) {
          updateActiveThreadMessages((existingMessages) => [
            ...existingMessages,
            createMessage("ai", execResultText, {
              data: execResultData
            })
          ]);

          if (isLiveModeRef.current) {
            speak(execSpeechText || execResultText);
          }
        }
      }
    } catch (err) {
      const requestCancelled = err?.code === "ERR_CANCELED"
        || err?.name === "CanceledError"
        || /canceled/i.test(String(err?.message || ""));
      if (requestCancelled) return;

      updateActiveThreadMessages((existingMessages) => [
        ...existingMessages,
        createMessage("ai", "I am having trouble connecting right now.")
      ]);
    } finally {
      if (activeChatRequestRef.current === requestController) {
        activeChatRequestRef.current = null;
      }
      setThinkingStatusLabel("");
      setIsLoading(false);
    }
  };

  async function submitConfirmationDecision(decision) {
    const normalizedDecision = String(decision || "").trim().toLowerCase();
    if (!normalizedDecision || isLoading) return;

    closeConfirmationEditor();
    await sendMessage(normalizedDecision, {
      forceHttp: true,
      ignoreComposerAttachments: true
    });
  }

  const startEditMessage = (message) => {
    setEditingMessageId(message.id);
    setEditingDraft(message.text || "");
  };

  const cancelEditMessage = () => {
    setEditingMessageId(null);
    setEditingDraft("");
  };

  const regenerateFromEdit = async (messageIndex) => {
    const trimmed = String(editingDraft || "").trim();
    if (!trimmed || isLoading) return;

    cancelEditMessage();
    await sendMessage(trimmed, { replaceFromIndex: messageIndex });
  };

  const toggleLiveMode = () => {
    const nextMode = !isLiveMode;
    setIsLiveMode(nextMode);
    setShowSettings(false);

    if (nextMode) {
      const intro = selectedLanguage === "hi"
        ? "Live chat mein aapka swagat hai."
        : "Welcome to live chat.";

      speak(intro, { mode: "live_chat" });
      return;
    }

    stopListening();
    stopElevenLabsPlayback();

    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }

    setAiSpeaking(false);
  };

  const renderAttachmentIcon = (mimeType) => {
    const raw = String(mimeType || "").toLowerCase();
    if (raw.startsWith("image/")) {
      return <ImageRoundedIcon fontSize="inherit" />;
    }
    return <DescriptionRoundedIcon fontSize="inherit" />;
  };

  const renderStructuredData = (data, message = null) => {
    if (!data || typeof data !== "object") return null;

    const columns = Array.isArray(data.columns) ? data.columns : [];
    const rows = Array.isArray(data.rows) ? data.rows : [];
    const artifacts = Array.isArray(data.artifacts) ? data.artifacts : [];
    const isEditingConfirmation = Boolean(message?.id) && editingConfirmationMessageId === message.id;

    const renderTable = () => (
      columns.length > 0 && (
        <div className="ai-table-wrap">
          <table className="ai-table">
            <thead>
              <tr>
                {columns.map((column, index) => (
                  <th key={`${column}-${index}`}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length}>No rows.</td>
                </tr>
              ) : (
                rows.map((row, rowIndex) => (
                  <tr key={`row-${rowIndex}`}>
                    {(Array.isArray(row) ? row : []).map((cell, cellIndex) => (
                      <td key={`cell-${rowIndex}-${cellIndex}`}>{String(cell || "")}</td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )
    );

    if (data.kind === "CONFIRMATION") {
      const fields = Array.isArray(data?.editForm?.fields) ? data.editForm.fields : [];
      const showDecisionButtons = isAwaitingConfirmationMessage(message) && !isEditingConfirmation;

      const renderConfirmationField = (field) => {
        const key = String(field?.key || "").trim();
        if (!key) return null;

        if (field.input === "textarea") {
          return (
            <label key={key} className="ai-confirmation-field">
              <span>{field.label || key}</span>
              <textarea
                value={String(editingConfirmationDraft[key] ?? "")}
                onChange={(event) => updateConfirmationDraftValue(key, event.target.value)}
                rows={4}
                className="ai-confirmation-input textarea"
              />
            </label>
          );
        }

        if (field.input === "select") {
          return (
            <label key={key} className="ai-confirmation-field">
              <span>{field.label || key}</span>
              <select
                value={String(editingConfirmationDraft[key] ?? "")}
                onChange={(event) => updateConfirmationDraftValue(key, event.target.value)}
                className="ai-confirmation-input"
              >
                {(Array.isArray(field.options) ? field.options : []).map((option, index) => (
                  <option key={`${key}-option-${index}`} value={String(option?.value ?? "")}>
                    {option?.label || option?.value || ""}
                  </option>
                ))}
              </select>
            </label>
          );
        }

        if (field.input === "checkbox_list") {
          const selectedValues = Array.isArray(editingConfirmationDraft[key])
            ? editingConfirmationDraft[key].map((item) => String(item || ""))
            : [];

          return (
            <div key={key} className="ai-confirmation-field full">
              <span>{field.label || key}</span>
              <div className="ai-confirmation-checkbox-list">
                {(Array.isArray(field.options) ? field.options : []).map((option, index) => {
                  const optionValue = String(option?.value ?? "");
                  const checked = selectedValues.includes(optionValue);
                  return (
                    <label key={`${key}-check-${index}`} className="ai-confirmation-checkbox-item">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          const nextValues = event.target.checked
                            ? [...selectedValues, optionValue]
                            : selectedValues.filter((value) => value !== optionValue);
                          updateConfirmationDraftValue(key, nextValues);
                        }}
                      />
                      <span>{option?.label || optionValue}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        }

        return (
          <label key={key} className="ai-confirmation-field">
            <span>{field.label || key}</span>
            <input
              type={field.input === "date" ? "date" : "text"}
              value={String(editingConfirmationDraft[key] ?? "")}
              onChange={(event) => updateConfirmationDraftValue(key, event.target.value)}
              className="ai-confirmation-input"
            />
          </label>
        );
      };

      return (
        <div className="ai-structured-block ai-confirmation-block">
          <div className="ai-confirmation-head">
            <div>
              {data.title && <div className="ai-structured-title">{data.title}</div>}
              {data.summary && <div className="ai-structured-summary">{data.summary}</div>}
            </div>

            {data.editForm && message?.id && !isEditingConfirmation && (
              <button
                type="button"
                className="ai-confirmation-edit-btn"
                onClick={() => openConfirmationEditor(message)}
                disabled={isLoading || confirmationSaveBusy}
                aria-label="Edit confirmation details"
              >
                <EditOutlinedIcon fontSize="inherit" />
              </button>
            )}
          </div>

          {isEditingConfirmation ? (
            <div className="ai-confirmation-edit-wrap">
              <div className="ai-confirmation-edit-grid">
                {fields.map((field) => renderConfirmationField(field))}
              </div>

              {confirmationEditError && (
                <div className="ai-confirmation-error">{confirmationEditError}</div>
              )}

              <div className="ai-confirmation-actions">
                <button
                  type="button"
                  className="msg-action-btn"
                  onClick={closeConfirmationEditor}
                  disabled={confirmationSaveBusy}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="msg-action-btn primary"
                  onClick={() => saveConfirmationEdit(message)}
                  disabled={confirmationSaveBusy}
                >
                  {confirmationSaveBusy ? "Saving..." : "Save Draft"}
                </button>
              </div>
            </div>
          ) : (
            <>
              {renderTable()}
              {data.prompt && <div className="ai-confirmation-prompt">{data.prompt}</div>}

              {showDecisionButtons && (
                <div className="ai-confirmation-decision-row">
                  <button
                    type="button"
                    className="msg-action-btn danger"
                    onClick={() => submitConfirmationDecision("no")}
                    disabled={isLoading || confirmationSaveBusy}
                  >
                    No
                  </button>
                  <button
                    type="button"
                    className="msg-action-btn primary"
                    onClick={() => submitConfirmationDecision("yes")}
                    disabled={isLoading || confirmationSaveBusy}
                  >
                    Yes
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      );
    }

    if (data.kind === "TABLE" || data.kind === "SCHEDULE_EXPORT") {
      return (
        <div className="ai-structured-block">
          {data.title && <div className="ai-structured-title">{data.title}</div>}
          {data.summary && <div className="ai-structured-summary">{data.summary}</div>}

          {renderTable()}

          {artifacts.length > 0 && (
            <div className="ai-artifact-list">
              {artifacts.map((artifact, index) => (
                <button
                  key={`${artifact.name || artifact.type || "artifact"}-${index}`}
                  type="button"
                  className="ai-artifact-btn"
                  onClick={() => handleArtifactAction(artifact)}
                >
                  <DownloadRoundedIcon fontSize="inherit" />
                  <span>{artifact.name || artifact.type || "Download"}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      );
    }

    if (data.kind === "TEXT" && data.plainText) {
      return (
        <div className="ai-structured-block">
          {data.title && <div className="ai-structured-title">{data.title}</div>}
          <pre className="msg-text-pre">{data.plainText}</pre>
        </div>
      );
    }

    return null;
  };

  useEffect(
    () => () => {
      if (activeChatRequestRef.current) {
        activeChatRequestRef.current.abort();
        activeChatRequestRef.current = null;
      }
      stopElevenLabsPlayback();
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    },
    []
  );

  const renderVoiceSettings = (className = "") => (
    <div className={`voice-menu-card ${className}`.trim()}>
      <div className="voice-menu-header">
        <RecordVoiceOverIcon fontSize="small" /> Voice and Language
        <span className="close-voice-menu" onClick={() => setShowSettings(false)}>
          &times;
        </span>
      </div>

      <div className="voice-language-strip">
        <div className="voice-language-title">
          <TranslateRoundedIcon fontSize="small" /> Language
        </div>

        <div className="voice-language-options">
          {LANGUAGE_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`voice-lang-btn ${selectedLanguage === option.id ? "active" : ""}`}
              onClick={() => setSelectedLanguage(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="voice-list">
        {filteredVoices.length === 0 ? (
          <div className="voice-empty">No browser voices found.</div>
        ) : (
          filteredVoices.map((voice, idx) => (
            <div
              key={`${voice.name}-${idx}`}
              className={`voice-option ${selectedVoice?.name === voice.name ? "selected" : ""}`}
              onClick={() => {
                setSelectedVoiceName(voice.name);
                setShowSettings(false);
                speak(selectedLanguage === "hi" ? "Voice select ho gaya." : "Voice selected.");
              }}
            >
              <span>{voice.name}</span>
              <small>{voice.lang}</small>
            </div>
          ))
        )}
      </div>
    </div>
  );

  if (isLiveMode) {
    const lastAiMessage = [...messages].reverse().find((msg) => msg.role === "ai");

    return (
      <div className={`gemini-live-wrapper ${immersive ? "immersive-container" : ""}`}>
        <button className="close-live-btn" onClick={toggleLiveMode}>
          <CloseIcon />
        </button>

        <button className="live-settings-btn" onClick={() => setShowSettings((prev) => !prev)}>
          <SettingsIcon />
        </button>

        {showSettings && renderVoiceSettings("live-mode-menu")}

        <div className="live-content">
          <div className="live-status">
            {aiSpeaking ? "AI Speaking" : isListening ? "Listening" : "Processing"}
          </div>

          <div className={`fluid-orb ${aiSpeaking ? "orb-speaking" : ""} ${isListening ? "orb-listening" : ""}`}>
            <div className="fluid-layer layer-1"></div>
            <div className="fluid-layer layer-2"></div>
            <div className="fluid-layer layer-3"></div>
          </div>

          <h2 className="live-greeting">
            {lastAiMessage?.text
              ? `${lastAiMessage.text.slice(0, 110)}${lastAiMessage.text.length > 110 ? "..." : ""}`
              : selectedLanguage === "hi"
                ? "Main sun raha hoon..."
                : "I'm listening..."}
          </h2>
        </div>

        <div className="live-controls-bar">
          <button className={`live-mic-btn ${isListening ? "active" : ""}`} onClick={toggleMic}>
            {isListening ? <GraphicEqIcon /> : <MicIcon />}
          </button>
          <button className="live-end-btn" onClick={toggleLiveMode}>
            <StopIcon /> End
          </button>
        </div>
      </div>
    );
  }

  const hideSidebarCompletely = () => {
    setSidebarOpen(false);
    setSidebarHidden(true);
    setShowSettings(false);
  };
  const restoreCollapsedSidebar = () => {
    setSidebarHidden(false);
    setSidebarOpen(false);
  };
  const showImmersiveLiveButton = Boolean(immersive);
  const showInputLiveButton = !showImmersiveLiveButton;

  return (
    <div ref={chatShellRef} className={`gemini-chat-shell ${immersive ? "immersive-shell" : ""}`}>
      <aside
        ref={sidebarRef}
        className={`gemini-sidebar ${sidebarHidden ? "hidden" : sidebarOpen ? "open" : "collapsed"} ${isResizingSidebar ? "resizing" : ""}`.trim()}
        style={sidebarInlineStyle}
      >
        <div className="sidebar-top-row">
          <Tooltip title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}>
            <IconButton size="small" onClick={() => setSidebarOpen((prev) => !prev)}>
              {sidebarOpen ? <ChevronLeftRoundedIcon fontSize="small" /> : <ChevronRightRoundedIcon fontSize="small" />}
            </IconButton>
          </Tooltip>

          {sidebarOpen ? (
            <button type="button" className="new-thread-btn" onClick={createNewThread}>
              <CreateOutlinedIcon fontSize="small" /> New chat
            </button>
          ) : (
            <Tooltip title="New chat">
              <IconButton size="small" onClick={createNewThread}>
                <CreateOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </div>

        {sidebarOpen && (
          <div className="sidebar-search-wrap">
            <button
              type="button"
              className={`search-thread-btn ${showSidebarSearch ? "active" : ""}`.trim()}
              onClick={() => {
                setShowSidebarSearch((prev) => {
                  const next = !prev;
                  if (!next) setSidebarSearchTerm("");
                  return next;
                });
              }}
            >
              <SearchRoundedIcon fontSize="small" /> Search chats
            </button>

            {showSidebarSearch && (
              <div className="sidebar-search-input-wrap">
                <input
                  type="text"
                  value={sidebarSearchTerm}
                  onChange={(event) => setSidebarSearchTerm(event.target.value)}
                  placeholder="Search by title or content..."
                  className="sidebar-search-input"
                />
              </div>
            )}
          </div>
        )}

        {sidebarOpen && (
          <button
            type="button"
            className="sidebar-chats-toggle"
            onClick={() => setIsChatsSectionOpen((prev) => !prev)}
          >
            <span>Your Chats</span>
            <ChevronRightRoundedIcon
              fontSize="small"
              className={`sidebar-chats-arrow ${isChatsSectionOpen ? "open" : ""}`.trim()}
            />
          </button>
        )}

        {sidebarOpen && isChatsSectionOpen && (
          <div className="sidebar-thread-list">
            {sidebarSearchResults.length === 0 ? (
              <div className="sidebar-no-results">
                {normalizedSidebarSearch ? "No chats found for this search." : "No chats yet."}
              </div>
            ) : (
              sidebarSearchResults.map((result) => {
                const thread = result.thread;
                const active = thread.id === activeThreadId;
                const searchSnippet = result.snippet;
                const isRenaming = renamingThreadId === thread.id;
                const isMenuOpen = openThreadMenuId === thread.id;
                return (
                  <div
                    key={thread.id}
                    className={`thread-item-row ${active ? "active" : ""}`.trim()}
                    title={thread.title}
                  >
                    <button
                      type="button"
                      className={`thread-item ${active ? "active" : ""}`.trim()}
                      onClick={() => selectThreadFromSidebar(thread.id, result.matchedMessageId)}
                    >
                      {isRenaming ? (
                        <input
                          type="text"
                          className="thread-title-input"
                          value={threadTitleDraft}
                          onChange={(event) => setThreadTitleDraft(event.target.value)}
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              event.stopPropagation();
                              saveThreadRename(thread.id);
                            }
                            if (event.key === "Escape") {
                              event.preventDefault();
                              event.stopPropagation();
                              cancelThreadRename();
                            }
                          }}
                          onBlur={cancelThreadRename}
                          autoFocus
                          maxLength={62}
                          aria-label="Rename chat title"
                        />
                      ) : (
                        <span className="thread-title">{thread.title}</span>
                      )}
                      {searchSnippet && <span className="thread-snippet">{searchSnippet}</span>}
                      <span className="thread-time">{formatThreadTime(thread.updatedAt)}</span>
                    </button>

                    <div
                      className={`thread-item-actions ${isMenuOpen ? "open" : ""}`.trim()}
                      ref={(node) => {
                        if (node) threadMenuRefs.current.set(thread.id, node);
                        else threadMenuRefs.current.delete(thread.id);
                      }}
                    >
                      <button
                        type="button"
                        className={`thread-more-btn ${isMenuOpen ? "open" : ""}`.trim()}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setOpenThreadMenuId((current) => (current === thread.id ? "" : thread.id));
                          if (renamingThreadId && renamingThreadId !== thread.id) {
                            setRenamingThreadId("");
                            setThreadTitleDraft("");
                          }
                        }}
                        aria-label={`Open actions for ${thread.title}`}
                        aria-expanded={isMenuOpen}
                        aria-haspopup="menu"
                      >
                        <MoreHorizRoundedIcon fontSize="small" />
                      </button>

                      {isMenuOpen && (
                        <div className="thread-actions-menu" role="menu">
                          <button
                            type="button"
                            className="thread-actions-menu-item"
                            role="menuitem"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              beginThreadRename(thread);
                            }}
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            className="thread-actions-menu-item danger"
                            role="menuitem"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              requestThreadDelete(thread.id);
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        <div className="sidebar-bottom-row">
          {sidebarOpen ? (
            <div className="sidebar-bottom-actions">
              <button type="button" className="sidebar-hide-btn" onClick={hideSidebarCompletely}>
                <SidebarCollapseArrowIcon direction="left" /> Hide
              </button>
              <QuickPageMenu
                buttonLabel="Menu"
                buttonClassName="sidebar-menu-btn"
                panelClassName="ai-sidebar-menu-panel"
                itemClassName="ai-sidebar-menu-item"
                align="left"
                openDirection="up"
              />
              <button type="button" className="sidebar-settings-btn" onClick={() => setShowSettings((prev) => !prev)}>
                <SettingsIcon fontSize="small" /> Settings
              </button>
              <button type="button" className="sidebar-home-btn" onClick={() => navigate("/")}>
                <HomeRoundedIcon fontSize="small" /> Home
              </button>
            </div>
          ) : (
            <div className="sidebar-bottom-icons">
              <Tooltip title="Hide sidebar completely">
                <IconButton
                  size="small"
                  className="sidebar-hide-icon-btn"
                  onClick={hideSidebarCompletely}
                >
                  <SidebarCollapseArrowIcon direction="left" />
                </IconButton>
              </Tooltip>
              <QuickPageMenu
                iconOnly
                buttonClassName="sidebar-menu-icon-btn"
                panelClassName="ai-sidebar-menu-panel"
                itemClassName="ai-sidebar-menu-item"
                align="left"
                openDirection="up"
                ariaLabel="Open page menu"
              />
              <Tooltip title="Voice settings">
                <IconButton
                  size="small"
                  className="sidebar-settings-icon-btn"
                  onClick={() => setShowSettings((prev) => !prev)}
                >
                  <SettingsIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Home">
                <IconButton size="small" className="sidebar-home-icon-btn" onClick={() => navigate("/")}>
                  <HomeRoundedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </div>
          )}
        </div>

        {sidebarOpen && !isCompactLayout && (
          <div
            className={`sidebar-resize-handle ${isResizingSidebar ? "active" : ""}`}
            onMouseDown={startSidebarResize}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            title="Drag to resize sidebar"
          />
        )}
      </aside>

      <div className={`gemini-chat-root ${immersive ? "immersive-container" : ""}`}>
        <div className="gemini-header">
          <div className="gemini-header-left">
            {sidebarHidden && showHeaderBrand && (
              <Tooltip title="Show collapsed sidebar">
                <button
                  type="button"
                  className="header-sidebar-restore-btn"
                  onClick={restoreCollapsedSidebar}
                  aria-label="Show collapsed sidebar"
                >
                  <SidebarCollapseArrowIcon direction="right" />
                </button>
              </Tooltip>
            )}
            {showHeaderBrand && (
              <span className="gemini-popup-brand">
                <AutoAwesomeIcon className="gemini-popup-sparkle" />
                <span className="gemini-popup-title">AI Assistant</span>
              </span>
            )}
          </div>

          {showImmersiveLiveButton && (
            <div className="header-actions-group">
              <Tooltip title={isLiveMode ? "End live chat" : "Start live chat"}>
                <IconButton
                  size="small"
                  onClick={toggleLiveMode}
                  className={`immersive-live-top-btn ${isLiveMode ? "active" : ""}`}
                  aria-label={isLiveMode ? "End live chat" : "Start live chat"}
                >
                  <GraphicEqIcon />
                </IconButton>
              </Tooltip>
            </div>
          )}
        </div>

        {showSettings && renderVoiceSettings("chat-mode-menu")}

        <div ref={messagesContainerRef} className="gemini-messages">
          {messages.length === 0 && (
            <div className="gemini-welcome">
              <div className="welcome-icon">
                <AutoAwesomeIcon sx={{ fontSize: 40 }} />
              </div>
              <h3>{welcomeHeadlineText || "\u00A0"}</h3>
              <p>{welcomeSubtitleText || "\u00A0"}</p>
            </div>
          )}

          {messages.map((message, index) => {
            const isUser = message.role === "user";
            const isEditing = editingMessageId === message.id;
            const copied = copiedMessageId === message.id;
            const isSearchHit = Boolean(
              searchHighlight
              && searchHighlight.threadId === activeThreadId
              && searchHighlight.messageId === message.id
            );

            return (
              <React.Fragment key={message.id}>
                <div
                  className={`gemini-msg-row ${message.role} ${isSearchHit ? "search-hit" : ""}`.trim()}
                  ref={(node) => {
                    if (node) {
                      messageRowRefs.current.set(message.id, node);
                    } else {
                      messageRowRefs.current.delete(message.id);
                    }
                  }}
                >
                  {!isUser && (
                    <div className="ai-avatar">
                      <GeminiDiamondIcon size={17} className="gemini-diamond-icon" />
                    </div>
                  )}

                  <div className={`gemini-message-stack ${isEditing && isUser ? "editing-user" : ""}`.trim()}>
                    <div className={`gemini-bubble ${message.role} ${isEditing && isUser ? "editing-user" : ""}`.trim()}>
                      {isEditing ? (
                        <textarea
                          ref={editingInputRef}
                          value={editingDraft}
                          onChange={(event) => setEditingDraft(event.target.value)}
                          className="edit-query-input"
                          rows={1}
                          autoFocus
                        />
                      ) : (
                        <>
                          {message.text ? (
                            <pre className="msg-text-pre">
                              {isSearchHit ? renderHighlightedText(message.text, searchHighlight?.query) : message.text}
                            </pre>
                          ) : null}

                          {renderStructuredData(message.data?.agentResult || message.data, message)}
                          {renderAgentMeta(message.data)}

                          {Array.isArray(message.attachments) && message.attachments.length > 0 && (
                            <div className="msg-attachment-list">
                              {message.attachments.map((attachment) => (
                                <span key={attachment.id || attachment.name} className="msg-attachment-chip">
                                  <span className="msg-attachment-icon">{renderAttachmentIcon(attachment.type)}</span>
                                  <span className="msg-attachment-name">{attachment.name}</span>
                                  <span className="msg-attachment-size">{formatBytes(attachment.size)}</span>
                                </span>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    <div className={`msg-actions ${message.role} ${isEditing ? "editing edit-controls" : ""}`.trim()}>
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            className="msg-action-btn"
                            onClick={cancelEditMessage}
                            disabled={isLoading}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="msg-action-btn primary"
                            onClick={() => regenerateFromEdit(index)}
                            disabled={isLoading || !editingDraft.trim()}
                          >
                            Update
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="msg-action-btn"
                            onClick={() => copyToClipboard(message.text, message.id)}
                          >
                            <ContentCopyRoundedIcon fontSize="inherit" /> {copied ? "Copied" : ""}
                          </button>

                          {isUser && (
                            <button
                              type="button"
                              className="msg-action-btn"
                              onClick={() => startEditMessage(message)}
                              disabled={isLoading}
                            >
                              <EditOutlinedIcon fontSize="inherit" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </React.Fragment>
            );
          })}

          {isLoading && (
            <div ref={thinkingRowRef} className="gemini-msg-row ai ai-thinking-row">
              <div className="gemini-loader thinking" role="status" aria-label="AI is thinking">
                <div className="gemini-thinking-swirl"></div>
                <GeminiDiamondIcon size={22} className="gemini-thinking-star" />
              </div>
              <div className="ai-thinking-status-text" aria-live="polite">
                {thinkingStatusWord}
              </div>
            </div>
          )}
          {showFreshViewportSpacer && (
            <div
              className="gemini-fresh-viewport-spacer"
              style={{ height: `${freshViewportSpacerHeight}px` }}
              aria-hidden="true"
            />
          )}

        </div>

        <div className="gemini-input-wrapper">
          <input
            ref={fileInputRef}
            type="file"
            className="ai-hidden-file-input"
            onChange={handleAttachmentInputChange}
            multiple
          />

          {pendingAttachments.length > 0 && (
            <div className="pending-attachment-list">
              {pendingAttachments.map((attachment) => (
                <span key={attachment.id} className="pending-attachment-chip">
                  <span className="pending-attachment-icon">{renderAttachmentIcon(attachment.type)}</span>
                  <span className="pending-attachment-name">{attachment.name}</span>
                  <span className="pending-attachment-size">{formatBytes(attachment.size)}</span>
                  <button
                    type="button"
                    className="pending-attachment-remove"
                    onClick={() => removePendingAttachment(attachment.id)}
                    aria-label={`Remove ${attachment.name}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className={`gemini-input-pill ${isInputExpanded ? "expanded" : ""}`.trim()}>
            <textarea
              ref={inputFieldRef}
              className="gemini-input-field"
              rows={1}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  if (event.shiftKey) return;
                  event.preventDefault();
                  if (isLoading) {
                    stopThinking();
                    return;
                  }
                  sendMessage();
                }
              }}
              placeholder="Ask anything in Hindi or English..."
            />

            <div className="pill-actions">
              <Tooltip title="Attach files or images">
                <IconButton
                  className="attach-files-btn"
                  size="small"
                  onClick={openAttachmentPicker}
                  disabled={isLoading || pendingAttachments.length >= MAX_ATTACHMENT_COUNT}
                  aria-label="Attach files or images"
                >
                  <AttachFileRoundedIcon />
                </IconButton>
              </Tooltip>

              {showInputLiveButton && (
                <Tooltip title={isLiveMode ? "End live chat" : "Start live chat"}>
                  <IconButton
                    size="small"
                    onClick={toggleLiveMode}
                    className={`live-pill-btn ${isLiveMode ? "active" : ""}`}
                    aria-label={isLiveMode ? "End live chat" : "Start live chat"}
                  >
                    <GraphicEqIcon />
                  </IconButton>
                </Tooltip>
              )}

              <Tooltip title={isListening ? "Stop mic" : "Start mic"}>
                <IconButton
                  size="small"
                  onClick={toggleMic}
                  sx={{ color: isListening ? "error.main" : "var(--gemini-user-text)" }}
                >
                  <MicIcon />
                </IconButton>
              </Tooltip>

              {(isLoading || input.trim() || pendingAttachments.length > 0) && (
                <Tooltip title={isLoading ? "Stop generating" : "Send"}>
                  <IconButton
                    size="small"
                    onClick={() => {
                      if (isLoading) {
                        stopThinking();
                        return;
                      }
                      sendMessage();
                    }}
                    className={`send-btn-active ${isLoading ? "stop-mode" : ""}`}
                    aria-label={isLoading ? "Stop generating" : "Send"}
                  >
                    {isLoading ? <StopIcon /> : <SendIcon />}
                  </IconButton>
                </Tooltip>
              )}
            </div>
          </div>
        </div>
      </div>

      {threadPendingDelete && (
        <div
          className="thread-delete-modal-backdrop"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              cancelThreadDelete();
            }
          }}
        >
          <div className="thread-delete-modal-card" role="dialog" aria-modal="true" aria-labelledby="thread-delete-title">
            <h3 id="thread-delete-title" className="thread-delete-title">Delete Chat?</h3>
            <p className="thread-delete-text">
              This will permanently delete
              {" "}
              <strong>{threadPendingDelete.title || "this chat"}</strong>
              {" "}
              from your chat list.
            </p>
            <div className="thread-delete-actions">
              <button type="button" className="thread-delete-cancel-btn" onClick={cancelThreadDelete}>
                Cancel
              </button>
              <button type="button" className="thread-delete-confirm-btn" onClick={confirmThreadDelete}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
