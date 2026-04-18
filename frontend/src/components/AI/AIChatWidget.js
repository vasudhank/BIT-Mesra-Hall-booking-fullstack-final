import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "../../api/axiosInstance";
import "./AIChatWidget.css";
import { IconButton, Tooltip } from "@mui/material";
import { useNavigate } from "react-router-dom";

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
import ReplayRoundedIcon from "@mui/icons-material/ReplayRounded";
import CreateOutlinedIcon from "@mui/icons-material/CreateOutlined";
import ChevronLeftRoundedIcon from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import TranslateRoundedIcon from "@mui/icons-material/TranslateRounded";
import HomeRoundedIcon from "@mui/icons-material/HomeRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
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
const MAX_ATTACHMENT_COUNT = 4;
const MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024;
const WELCOME_HEADLINE = "How can I help you today?";
const WELCOME_SUBTITLE = "Chat, ask in Hindi or English, or run booking actions.";

const LANGUAGE_OPTIONS = [
  { id: "auto", label: "Auto" },
  { id: "en", label: "English" },
  { id: "hi", label: "Hindi" }
];

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
    .slice(-14)
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

const isLikelyActionPrompt = (text) =>
  /\b(book|booking|reserve|approve|reject|pending requests|hall status|show halls|export schedule|download schedule)\b/i.test(String(text || ""));

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

  const chatShellRef = useRef(null);
  const sidebarRef = useRef(null);
  const messagesEndRef = useRef(null);
  const inputFieldRef = useRef(null);
  const fileInputRef = useRef(null);
  const recognitionRef = useRef(null);
  const isLiveModeRef = useRef(isLiveMode);
  const activeChatRequestRef = useRef(null);
  const messageRowRefs = useRef(new Map());
  const sidebarResizeMetaRef = useRef({ dragging: false, startX: 0, startWidth: 250 });

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

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) || null,
    [threads, activeThreadId]
  );

  const messages = useMemo(() => activeThread?.messages || [], [activeThread]);
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

  useEffect(() => {
    resizeInputField();
  }, [input, resizeInputField]);

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
    return {
      ...thread,
      messages: clippedMessages,
      title: getThreadTitleFromMessages(clippedMessages),
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

  const appendAiMessage = (text) => {
    updateActiveThreadMessages((existingMessages) => [
      ...existingMessages,
      createMessage("ai", text)
    ]);
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
    setHistoryReady(true);
  }, [identityReady, storageKey]);

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
    if (pendingSearchJump && pendingSearchJump.threadId === activeThreadId) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading, activeThreadId, pendingSearchJump]);

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
      onError: () => {
        setAiSpeaking(false);
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
      const sorted = [...data].sort((a, b) => (a.status === "FREE" ? -1 : 1));
      return {
        kind: "TABLE",
        title: "Hall Status Report",
        summary: `Total halls: ${sorted.length}`,
        columns: ["Hall", "Status", "Event"],
        rows: sorted.map((hall) => {
          const normalized = String(hall.status || "").toUpperCase();
          const status = normalized === "FREE" || normalized === "AVAILABLE" ? "AVAILABLE" : "FILLED";
          return [
            hall.hall || "",
            status,
            status === "AVAILABLE" ? "-" : (hall.currentEvent || "None")
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

    if (data.kind === "HALL_STATUS") {
      const items = Array.isArray(data.items) ? data.items : [];
      const dateTitle = data.date ? ` (${data.date})` : "";
      const modeLine = data.mode && data.mode !== "ALL" ? `Filter: ${data.mode}\n` : "";
      const hallLine = data.targetHall ? `Hall: ${data.targetHall}\n` : "";
      const header = `Hall Status${dateTitle}\n${modeLine}${hallLine}`.trim();

      if (items.length === 0) {
        return {
          kind: "TABLE",
          title: `Hall Status${dateTitle}`,
          summary: `${modeLine}${hallLine}`.trim(),
          columns: ["Hall", "Status", "Event"],
          rows: [],
          plainText: `${header}\n\nNo halls matched this query.`
        };
      }

      const lines = items.map((item) => {
        const isAvailable = String(item.status || "").toUpperCase() === "AVAILABLE";
        const suffix = isAvailable ? "Available" : `Filled (${item.currentEvent || "None"})`;
        return `- ${item.hall}: ${suffix}`;
      });

      return {
        kind: "TABLE",
        title: `Hall Status${dateTitle}`,
        summary: `${modeLine}${hallLine}`.trim(),
        columns: ["Hall", "Status", "Event"],
        rows: items.map((item) => {
          const isAvailable = String(item.status || "").toUpperCase() === "AVAILABLE";
          return [
            item.hall || "",
            isAvailable ? "AVAILABLE" : "FILLED",
            isAvailable ? "-" : (item.currentEvent || "None")
          ];
        }),
        plainText: `${header}\n\n${lines.join("\n")}`
      };
    }

    if (data.kind === "BOOKING_REQUESTS") {
      const items = Array.isArray(data.items) ? data.items : [];
      const summary = data.summary || {};
      const dateTitle = data.date ? ` (${data.date})` : "";
      const filterLine = `Filter: ${data.filter || "ALL"}`;
      const hallLine = data.targetHall ? ` | Hall: ${data.targetHall}` : "";

      let text = `Pending Booking Requests${dateTitle}\n${filterLine}${hallLine}\n`;
      text += `Total: ${summary.total || 0}, Conflicting: ${summary.conflicting || 0}, Non-conflicting: ${summary.nonConflicting || 0}`;

      if (items.length === 0) {
        return {
          kind: "TABLE",
          title: `Pending Booking Requests${dateTitle}`,
          summary: `${filterLine}${hallLine} | Total: ${summary.total || 0}, Conflicting: ${summary.conflicting || 0}, Non-conflicting: ${summary.nonConflicting || 0}`,
          columns: ["Hall", "Date", "Time", "Event", "Requested By", "Conflict"],
          rows: [],
          plainText: `${text}\n\nNo requests matched this query.`
        };
      }

      const lines = items.map((item, idx) => {
        const label = item.conflict === "CONFLICTING" ? "CONFLICTING" : "NON-CONFLICTING";
        return `${idx + 1}. [${label}] ${item.hall} | ${item.date} ${item.start} - ${item.end}\n   Event: ${item.event}\n   By: ${item.requestedBy} (${item.requestedEmail})`;
      });

      return {
        kind: "TABLE",
        title: `Pending Booking Requests${dateTitle}`,
        summary: `${filterLine}${hallLine} | Total: ${summary.total || 0}, Conflicting: ${summary.conflicting || 0}, Non-conflicting: ${summary.nonConflicting || 0}`,
        columns: ["Hall", "Date", "Time", "Event", "Requested By", "Conflict"],
        rows: items.map((item) => [
          item.hall || "",
          item.date || "",
          `${item.start || ""} - ${item.end || ""}`.trim(),
          item.event || "",
          `${item.requestedBy || ""} (${item.requestedEmail || ""})`.trim(),
          item.conflict === "CONFLICTING" ? "CONFLICTING" : "NON-CONFLICTING"
        ]),
        plainText: `${text}\n\n${lines.join("\n")}`
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

    return {
      kind: "TEXT",
      title: "AI Result",
      plainText: JSON.stringify(data, null, 2)
    };
  };

  const streamConversationViaWebSocket = ({ message, history, language, userRole, abortSignal }) =>
    new Promise((resolve) => {
      const wsUrl = resolveAiWebSocketUrl();
      if (!wsUrl || typeof window === "undefined" || typeof window.WebSocket === "undefined") {
        resolve({ status: "unsupported", text: "" });
        return;
      }

      const requestId = createId();
      let completed = false;
      let accumulated = "";
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
              userRole
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

        if (packet?.type === "chat.stream.delta") {
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

    if ((!textToSend && pendingAttachments.length === 0) || !activeThreadId || isLoading) return;

    const replaceFromIndex = Number.isInteger(options.replaceFromIndex)
      ? Math.max(0, options.replaceFromIndex)
      : null;

    const currentMessages = activeThread?.messages || [];
    const historyMessages = replaceFromIndex == null
      ? currentMessages
      : currentMessages.slice(0, replaceFromIndex);

    const requestAttachments = pendingAttachments.map((item) => ({
      name: item.name,
      type: item.type,
      contentBase64: item.contentBase64
    }));

    const userAttachmentMeta = pendingAttachments.map((item) => ({
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

    updateActiveThreadMessages(() => [...historyMessages, userMessage]);
    setInput("");
    setPendingAttachments([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setIsLoading(true);
    const requestController = new AbortController();
    activeChatRequestRef.current = requestController;

    try {
      const roleForStream = String(accountKey || "GUEST").split(":")[0] || "GUEST";
      const shouldTryStream =
        requestAttachments.length === 0
        && !isLikelyActionPrompt(composedUserText)
        && !options.forceHttp;

      if (shouldTryStream) {
        const streamResult = await streamConversationViaWebSocket({
          message: composedUserText,
          history: toServerHistory(historyMessages),
          language: selectedLanguage,
          userRole: roleForStream,
          abortSignal: requestController.signal
        });

        if (requestController.signal.aborted) return;

        if (streamResult.status === "ok" && streamResult.text) {
          updateActiveThreadMessages((existingMessages) => [
            ...existingMessages,
            createMessage("ai", streamResult.text, {
              data: streamResult.meta ? { streamMeta: streamResult.meta } : null
            })
          ]);

          if (isLiveModeRef.current) {
            speak(streamResult.text);
          }
          return;
        }

        if (streamResult.status === "aborted") return;
      }

      const res = await api.post("/ai/chat", {
        message: composedUserText,
        history: toServerHistory(historyMessages),
        language: selectedLanguage,
        attachments: requestAttachments
      }, { signal: requestController.signal });

      if (requestController.signal.aborted) return;

      const replyData = res?.data?.reply;

      let aiText = "";
      let isAction = false;

      if (replyData && typeof replyData === "object") {
        if (replyData.type === "CHAT") {
          aiText = replyData.message || replyData.reply || "I could not understand that fully.";
        } else if (replyData.type === "ACTION") {
          isAction = true;
          aiText = replyData.reply || "Processing your request.";
        } else {
          aiText = replyData.message || JSON.stringify(replyData);
        }
      } else {
        aiText = String(replyData || "Communication error.");
      }

      if (aiText) {
        updateActiveThreadMessages((existingMessages) => [
          ...existingMessages,
          createMessage("ai", aiText)
        ]);

        if (isLiveModeRef.current) {
          speak(aiText);
        }
      }

      if (isAction && replyData.action) {
        const exec = await api.post("/ai/execute", { intent: replyData }, { signal: requestController.signal });
        if (requestController.signal.aborted) return;

        let execResultText = "";
        let execResultData = null;
        let execSpeechText = "";
        if (exec.data.status === "DONE") {
          execResultText = `[SUCCESS] ${exec.data.message}`;
          execSpeechText = execResultText;
        } else if (exec.data.status === "INFO") {
          const infoPayload = formatInfoPayload(exec.data.data);
          execResultText = infoPayload?.plainText || "Here is the generated result.";
          execResultData = infoPayload;
          execSpeechText = [infoPayload?.title, infoPayload?.summary].filter(Boolean).join(". ") || execResultText;
        } else if (exec.data.status === "ERROR") {
          execResultText = `[ERROR] ${exec.data.msg}`;
          execSpeechText = execResultText;
        } else if (exec.data.status === "READY") {
          try {
            await api.post(exec.data.call, exec.data.payload, { signal: requestController.signal });
            if (requestController.signal.aborted) return;
            execResultText = "[SUCCESS] Booking request sent successfully.";
            execSpeechText = execResultText;
          } catch (executionErr) {
            const executionCancelled = executionErr?.code === "ERR_CANCELED"
              || executionErr?.name === "CanceledError";
            if (executionCancelled) return;
            execResultText = `[ERROR] ${executionErr.response?.data?.msg || executionErr.message}`;
            execSpeechText = execResultText;
          }
        }

        if (execResultText) {
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
      setIsLoading(false);
    }
  };

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

  const renderStructuredData = (data) => {
    if (!data || typeof data !== "object") return null;

    const columns = Array.isArray(data.columns) ? data.columns : [];
    const rows = Array.isArray(data.rows) ? data.rows : [];
    const artifacts = Array.isArray(data.artifacts) ? data.artifacts : [];

    if (data.kind === "TABLE" || data.kind === "SCHEDULE_EXPORT") {
      return (
        <div className="ai-structured-block">
          {data.title && <div className="ai-structured-title">{data.title}</div>}
          {data.summary && <div className="ai-structured-summary">{data.summary}</div>}

          {columns.length > 0 && (
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
          )}

          {artifacts.length > 0 && (
            <div className="ai-artifact-list">
              {artifacts.map((artifact, index) => (
                <button
                  key={`${artifact.name || artifact.type || "artifact"}-${index}`}
                  type="button"
                  className="ai-artifact-btn"
                  onClick={() => downloadBase64Artifact(artifact)}
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
                return (
                  <button
                    key={thread.id}
                    type="button"
                    className={`thread-item ${active ? "active" : ""}`}
                    onClick={() => {
                      setActiveThreadId(thread.id);
                      setEditingMessageId(null);
                      setEditingDraft("");
                      if (normalizedSidebarSearch && result.matchedMessageId) {
                        setPendingSearchJump({
                          threadId: thread.id,
                          messageId: result.matchedMessageId,
                          query: sidebarSearchTerm
                        });
                      } else {
                        setPendingSearchJump(null);
                        setSearchHighlight(null);
                      }
                    }}
                    title={thread.title}
                  >
                    <span className="thread-title">{thread.title}</span>
                    {searchSnippet && <span className="thread-snippet">{searchSnippet}</span>}
                    <span className="thread-time">{formatThreadTime(thread.updatedAt)}</span>
                  </button>
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

        <div className="gemini-messages">
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
              <div
                key={message.id}
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
                    <AutoAwesomeIcon sx={{ fontSize: 16 }} />
                  </div>
                )}

                <div className="gemini-message-stack">
                  <div className={`gemini-bubble ${message.role}`}>
                    {isEditing ? (
                      <textarea
                        value={editingDraft}
                        onChange={(event) => setEditingDraft(event.target.value)}
                        className="edit-query-input"
                        rows={3}
                      />
                    ) : (
                      <>
                        {message.text ? (
                          <pre className="msg-text-pre">
                            {isSearchHit ? renderHighlightedText(message.text, searchHighlight?.query) : message.text}
                          </pre>
                        ) : null}

                        {renderStructuredData(message.data)}

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

                  <div className={`msg-actions ${message.role} ${isEditing ? "editing" : ""}`.trim()}>
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
                          <ReplayRoundedIcon fontSize="inherit" /> Regenerate
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
            );
          })}

          {isLoading && (
            <div className="gemini-msg-row ai">
              <div className="ai-avatar">
                <AutoAwesomeIcon sx={{ fontSize: 16 }} />
              </div>
              <div className="gemini-bubble ai loading-bubble">Thinking...</div>
            </div>
          )}

          <div ref={messagesEndRef} />
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
    </div>
  );
}
