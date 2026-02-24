import React, { Suspense, lazy, useRef, useState, useEffect } from "react";
import "./HomeUpper.css";
import Grid from "@mui/material/Grid";
import Box from "@mui/material/Box";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';

// Icons
import SearchIcon from '@mui/icons-material/Search';
import MenuIcon from '@mui/icons-material/Menu';
import CloseIcon from '@mui/icons-material/Close';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'; 
import CakeIcon from '@mui/icons-material/Cake'; 
import OpenInFullIcon from '@mui/icons-material/OpenInFull'; // New icon for immersive

// Import the API call
import { getContactsApi } from "../../api/contactApi";
import { playElevenLabsSpeech, stopElevenLabsPlayback } from "../../utils/elevenLabsTts";
const AIChatWidget = lazy(() => import("../AI/AIChatWidget"));

// --- SUB-COMPONENT: FLIP UNIT (2-DIGIT) ---
const FOLD_PHASE_MS = 250;
const UNFOLD_PHASE_MS = 340;
const DESKTOP_BREAKPOINT = 1364;

const FlipDigit = ({ value }) => {
  const normalized = String(value ?? "00").padStart(2, "0");
  const [currentDigit, setCurrentDigit] = useState(normalized);
  const [previousDigit, setPreviousDigit] = useState(normalized);
  const [phase, setPhase] = useState("idle"); // idle | fold | unfold
  const [animTick, setAnimTick] = useState(0);
  const timersRef = useRef([]);

  const clearTimers = () => {
    timersRef.current.forEach((id) => clearTimeout(id));
    timersRef.current = [];
  };

  useEffect(() => {
    if (normalized !== currentDigit) {
      clearTimers();
      setPreviousDigit(currentDigit);
      setCurrentDigit(normalized);
      setAnimTick((t) => t + 1);
      setPhase("fold");

      const toUnfold = setTimeout(() => {
        setPhase("unfold");
      }, FOLD_PHASE_MS);

      const toIdle = setTimeout(() => {
        setPhase("idle");
      }, FOLD_PHASE_MS + UNFOLD_PHASE_MS);

      timersRef.current = [toUnfold, toIdle];
    }
  }, [normalized, currentDigit]);

  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, []);

  const upperStaticDigit = phase === "fold" ? "" : currentDigit;
  const lowerStaticDigit = phase === "idle" ? currentDigit : phase === "fold" ? previousDigit : "";
  const isAnimating = phase !== "idle";

  return (
    <div className={`flip-digit ${isAnimating ? "animating" : ""}`}>
      <div className="fd-upperCard">
        <span>{upperStaticDigit}</span>
      </div>
      <div className="fd-lowerCard">
        <span>{lowerStaticDigit}</span>
      </div>

      {phase === "fold" && (
        <div className="fd-flipCard fold" key={`fold-${animTick}`}>
          <span>{previousDigit}</span>
        </div>
      )}

      {phase === "unfold" && (
        <div className="fd-flipCard unfold" key={`unfold-${animTick}`}>
          <span>{currentDigit}</span>
        </div>
      )}
    </div>
  );
};


// --- SUB-COMPONENT: CLOCK CARD CONTAINER ---
const ClockCard = ({ value, label, children, extraClass = "" }) => {
  const strVal = String(value ?? "00").padStart(2, "0");

  return (
    <div className={`flip-card-container ${extraClass}`}>
      {children}
      <div className="flip-card-inner">
        <FlipDigit value={strVal} />
      </div>
    </div>
  );
};

// --- SUB-COMPONENT: THEME BUTTON (Moved Outside) ---
const ThemeButton = ({ className, lightMode, toggleTheme }) => (
  <button
    className={`upper-theme-toggle ${lightMode ? "light" : "dark"} ${className || ''}`}
    onClick={toggleTheme}
    aria-label="Toggle theme"
  >
    <span className="upper-toggle-track">
      <span className="upper-toggle-thumb">
        <svg className="upper-toggle-svg sun" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
          <path d="M12 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0M8 0a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 0m0 13a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 13m8-5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2a.5.5 0 0 1 .5.5M3 8a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2A.5.5 0 0 1 3 8m10.657-5.657a.5.5 0 0 1 0 .707l-1.414 1.415a.5.5 0 1 1-.707-.708l1.414-1.414a.5.5 0 0 1 .707 0m-9.193 9.193a.5.5 0 0 1 0 .707L3.05 13.657a.5.5 0 0 1-.707-.707l1.414-1.414a.5.5 0 0 1 .707 0m9.193 2.121a.5.5 0 0 1-.707 0l-1.414-1.414a.5.5 0 0 1 0 .707l1.414 1.414a.5.5 0 0 1 0 .707M4.464 4.465a.5.5 0 0 1-.707 0L2.343 3.05a.5.5 0 1 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .708" />
        </svg>
        <svg className="upper-toggle-svg moon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
          <path d="M6 .278a.77.77 0 0 1 .08.858 7.2 7.2 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277q.792-.001 1.533-.16a.79.79 0 0 1 .81.316.73.73 0 0 1-.031.893A8.35 8.35 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.75.75 0 0 1 6 .278" />
          <path d="M10.794 3.148a.217.217 0 0 1 .412 0l.387 1.162c.173.518.579.924 1.097 1.097l1.162.387a.217.217 0 0 1 0 .412l-1.162.387a1.73 1.73 0 0 0-1.097 1.097l-.387 1.162a.217.217 0 0 1-.412 0l-.387-1.162A1.73 1.73 0 0 0 9.31 6.593l-1.162-.387a.217.217 0 0 1 0-.412l1.162-.387a1.73 1.73 0 0 0 1.097-1.097z" />
        </svg>
      </span>
    </span>
  </button>
);


export default function HomeUpper({
  lightMode = true,
  toggleTheme = () => {}
}) {
  const auth = useSelector((state) => state.user);
  const location = useLocation();
  const navigate = useNavigate();

  const sectionRef = useRef(null);
  const videoRef = useRef(null);

  // === RESPONSIVE STATE ===
  const [isMobile, setIsMobile] = useState(window.innerWidth <= DESKTOP_BREAKPOINT);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showDeepDiveAnim, setShowDeepDiveAnim] = useState(false);
  
  // Scroll & UI States
  const [showArrow, setShowArrow] = useState(true);
  const [scrolled, setScrolled] = useState(false);
   
  // FLIP CLOCK STATE
  const [timeData, setTimeData] = useState({
    hours: "00",
    minutes: "00",
    seconds: "00",
    dateStr: "", 
    navDateStr: "",
    mobileDateTimeStr: "" 
  });

  // Video Logic States
  const [showConsent, setShowConsent] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  // === MODAL STATES ===
  const [showWishModal, setShowWishModal] = useState(false);
  const [showAIModal, setShowAIModal] = useState(false);
  const [aiPopupSidebarHidden, setAiPopupSidebarHidden] = useState(false);
  const [aiPopupRestoreSignal, setAiPopupRestoreSignal] = useState(0);
  const [showDateModal, setShowDateModal] = useState(false);
  const [clickedDate, setClickedDate] = useState(null);
    
  // === CONTACTS LOGIC ===
  const [contacts, setContacts] = useState([]);
  const [filteredContacts, setFilteredContacts] = useState([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [searchText, setSearchText] = useState("");

  // Snackbar
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState("");

  // --- Calendar Generation Logic ---
  const today = new Date();
  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();
  const currentDay = today.getDate();
    
  const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const firstDayIndex = new Date(currentYear, currentMonth, 1).getDay();
  const shortYear = currentYear.toString().slice(-2);
  const currentMonthName = monthNames[currentMonth]; 

  const daysArray = [];
  for (let i = 0; i < firstDayIndex; i++) daysArray.push(null);
  for (let i = 1; i <= daysInMonth; i++) daysArray.push(i);

  // --- Effect: Detect Mobile Resize ---
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= DESKTOP_BREAKPOINT);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => () => {
    stopElevenLabsPlayback();
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

  // --- Handlers ---
  const handleWishClick = async (e) => {
    e.stopPropagation();
    setShowWishModal(true);
    setLoadingContacts(true);
    try {
      const res = await getContactsApi();
      if (res && res.data && res.data.contacts) {
        setContacts(res.data.contacts);
        setFilteredContacts(res.data.contacts);
      }
    } finally {
      setLoadingContacts(false);
    }
  };

  // Search Logic
  const handleSearchChange = (e) => {
    const val = e.target.value;
    setSearchText(val);
    if (val === "") setFilteredContacts(contacts);
  };

  const handleSearchSubmit = () => {
    if (!searchText.trim()) {
      setFilteredContacts(contacts);
      return;
    }
    const lower = searchText.toLowerCase();
    const filtered = contacts.filter(c => 
      c.name.toLowerCase().includes(lower) || 
      c.number.toLowerCase().includes(lower) || 
      (c.email && c.email.toLowerCase().includes(lower))
    );
    setFilteredContacts(filtered);
  };

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Enter') handleSearchSubmit();
  };

  const handleAIClick = (e) => {
    e.stopPropagation();
    setAiPopupSidebarHidden(false);
    setAiPopupRestoreSignal(0);
    setShowAIModal(true);
  };

  const handlePopupSidebarRestore = () => {
    setAiPopupRestoreSignal((prev) => prev + 1);
  };

  const handleDateClick = (day) => {
    if (!day) return;
    setClickedDate(`${currentMonthName} ${day}`);
    setShowDateModal(true);
  };

  const closeModals = () => {
    setShowWishModal(false);
    setShowAIModal(false);
    setAiPopupSidebarHidden(false);
    setAiPopupRestoreSignal(0);
    setShowDateModal(false);
    setSearchText("");
    setFilteredContacts(contacts);
  };

  const toggleMobileMenu = () => {
    setMobileMenuOpen(!mobileMenuOpen);
  };

  const copyToClipboard = (text, type) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setSnackbarMessage(`${type} copied to clipboard!`);
    setSnackbarOpen(true);
  };

  const goToCheckBookings = () => navigate('/schedule', { state: { mode: 'grid' } });
    
  const goToBookNow = () => {
    if (auth.status === "Authenticated" && auth.user === "Department") {
      navigate('/department/booking');
    } else {
      navigate('/department_login');
    }
  };

  /* ================= SCROLL OBSERVERS ================= */
  useEffect(() => {
    if (!sectionRef.current) return;
    const observer = new IntersectionObserver(([entry]) => setScrolled(!entry.isIntersecting), { threshold: 0.99 });
    observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!sectionRef.current) return;
    const observer = new IntersectionObserver(([entry]) => setShowArrow(entry.isIntersecting), { threshold: 0.9 });
    observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  /* ================= DATE & TIME LOGIC ================= */
  useEffect(() => {
    let alignTimeoutId = null;
    let intervalId = null;

    const updateTime = () => {
      const ist = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
      
      // Desktop: 24-hour format (No conversion logic)
      const h = ist.getHours();
      const hStr = String(h).padStart(2, '0');
      const mStr = String(ist.getMinutes()).padStart(2, '0');
      const sStr = String(ist.getSeconds()).padStart(2, '0');
      
      // Date Formats for Desktop Cards
      const dd = String(ist.getDate()).padStart(2, '0');
      const mm = String(ist.getMonth() + 1).padStart(2, '0');
      const yy = String(ist.getFullYear()).slice(-2);
      
      const dateStr = `${dd}/${mm}/${yy}`; // For Card (Zero Scroll)
      const navDateStr = `${dd}-${mm}-${yy}`; // For Navbar (Scrolled)

      // Mobile Date Time Bar Construction
      // Format: Friday, January 23, 2026 - 14:50:14 IST
      const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const monthsFull = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      
      const dayName = days[ist.getDay()];
      const monthName = monthsFull[ist.getMonth()];
      const fullYear = ist.getFullYear();
      
      const mobileStr = `${dayName}, ${monthName} ${dd}, ${fullYear} - ${hStr}:${mStr}:${sStr} IST`;

      setTimeData({
        hours: hStr,
        minutes: mStr,
        seconds: sStr,
        dateStr: dateStr,
        navDateStr: navDateStr,
        mobileDateTimeStr: mobileStr
      });
    };

    updateTime();
    const msToNextSecond = 1000 - (Date.now() % 1000);
    alignTimeoutId = setTimeout(() => {
      updateTime();
      intervalId = setInterval(updateTime, 1000);
    }, msToNextSecond);

    return () => {
      if (alignTimeoutId) clearTimeout(alignTimeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  /* ================= VIDEO HANDLERS ================= */
  const handleInitialClick = () => setShowConsent(true);
  const handleConsentOk = () => {
    setShowConsent(false);
    setVideoEnabled(true);
    setShowVideo(true);
    setIsPlaying(true);
    setIsMuted(false);
    setTimeout(() => {
      if (videoRef.current) {
        videoRef.current.volume = 1.0;
        videoRef.current.play().catch((e) => console.error("Play failed:", e));
      }
    }, 100);
  };
  const handleConsentCancel = () => setShowConsent(false);
  const togglePlayPause = () => {
    if (!videoRef.current) return;
    if (isPlaying) { videoRef.current.pause(); setIsPlaying(false); } 
    else { videoRef.current.play(); setIsPlaying(true); }
  };
  const toggleMute = () => {
    if (!videoRef.current) return;
    const newMuteState = !isMuted;
    setIsMuted(newMuteState);
    videoRef.current.muted = newMuteState;
  };
  const toggleMediaSource = () => {
    if (showVideo) {
      if (videoRef.current) videoRef.current.pause();
      setIsPlaying(false);
      setShowVideo(false);
    } else {
      setShowVideo(true);
      setIsPlaying(true);
      setTimeout(() => { if (videoRef.current) videoRef.current.play(); }, 50);
    }
  };
  const handleScrollDown = () => {
    setShowArrow(false);
    const target =
      document.querySelector(".section-top-anchor") ||
      document.querySelector(".lower-div");
    target?.scrollIntoView({ behavior: "smooth" });
  };

  const bgImage = isMobile 
    ? "url('https://res.cloudinary.com/dkgbflzrc/image/upload/v1768803019/WhatsApp_Image_2026-01-19_at_11.35.40_AM_1_awmflo.jpg')"
    : (!showVideo 
        ? "url('https://res.cloudinary.com/dkgbflzrc/image/upload/v1768669856/97f75189-9827-4de8-a5ec-22fc1c1cd814_xszdio.jpg')" 
        : "none");

  /* ================= RENDER ================= */
  return (
    <>
      {/* =========================================================
          FIXED UI LAYERS 
          ========================================================= */}

      {/* 1. FLIP CLOCK COMPONENT (Desktop Only) */}
      {!isMobile && (
        <div className={`flip-clock-wrapper ${scrolled ? 'clock-scrolled' : ''}`}>
          
          {/* Theme Toggle: Left in Unscrolled (order:-1), Right in Scrolled (order:5) */}
          <div className="clock-toggle-wrapper">
             <ThemeButton lightMode={lightMode} toggleTheme={toggleTheme} />
          </div>

          <div className="clock-group">
            {/* Hour Card */}
            <ClockCard value={timeData.hours} extraClass="hour-card">
               {/* Date inside card (Unscrolled only) */}
               <div className="card-date">{timeData.dateStr}</div>
            </ClockCard>

            {/* Separator Colon (Hidden in Unscrolled, Visible in Scrolled) */}
            <div className="clock-separator">:</div>

            {/* Minute Card */}
            <ClockCard value={timeData.minutes} extraClass="min-card">
               {/* Tiny Seconds inside card (Unscrolled only - Text) */}
               <div className="card-seconds-corner">{timeData.seconds}</div>
            </ClockCard>

             {/* Separator Colon (Hidden in Unscrolled, Visible in Scrolled) */}
             <div className="clock-separator">:</div>

            {/* Second Card (Scrolled Only - Hidden by CSS initially) */}
            <ClockCard value={timeData.seconds} extraClass="ss-card" />
          </div>

        </div>
      )}

      {/* 2. Navbar (DESKTOP) */}
      {!isMobile && (
        <Box className={`navbar-wrapper ${scrolled ? "navbar-wrapper--scrolled" : ""}`}>
          <Grid container justifyContent="center">
            <Grid item display="flex" justifyContent="center">
              <div className={`navbar-shell ${scrolled ? "navbar-shell--scrolled" : ""}`}>
                <div className="navbar">
                  {/* Date on Navbar (Scrolled Only) */}
                  <div className="nav-date">{timeData.navDateStr}</div>

                  <div className="nav-links-container">
                    <div className="nav-link-item">
                      <Link to="/" className={location.pathname === "/" ? "active" : ""}>Home</Link>
                    </div>
                    <div className="nav-link-item">
                      <Link to={auth.status === "Authenticated" && auth.user === "Admin" ? "/admin/hall" : "/admin_login"}>Admin</Link>
                    </div>
                    <div className="nav-link-item">
                      <Link to={auth.status === "Authenticated" && auth.user === "Department" ? "/department/booking" : "/department_login"}>Faculty</Link>
                    </div>
                    <div className="nav-link-item">
                      <Link to="/schedule">Schedule</Link>
                    </div>
                  </div>
                </div>
              </div>
            </Grid>
          </Grid>
        </Box>
      )}

      {/* 3. Mobile Date Time Bar (Fixed Top) */}
      {isMobile && (
        <div className="mobile-datetime-bar mobile-datetime-bar--expanded">
          <ThemeButton
            className="mobile-toggle-in-bar"
            lightMode={lightMode}
            toggleTheme={toggleTheme}
          />
          <span className="mobile-datetime-text">{timeData.mobileDateTimeStr}</span>
        </div>
      )}

      {/* 4. Mobile Menu Button */}
      {isMobile && (
        <button className="mobile-menu-toggle" onClick={toggleMobileMenu}>
          {/* Color set to inherit so CSS can control it */}
          <MenuIcon style={{ fontSize: '1.8rem', color: 'inherit' }} />
        </button>
      )}

      {/* 5. Mobile AI FAB */}
      {isMobile && (
        <button className="mobile-ai-fab" onClick={handleAIClick}>
          <AutoAwesomeIcon sx={{ fontSize: 26, color: 'white' }} />
        </button>
      )}

      {/* 6. Mobile Menu Overlay */}
      {isMobile && (
        <div className={`mobile-menu-overlay ${mobileMenuOpen ? 'open' : ''}`}>
           <div className="mobile-menu-content">
             <div className="mobile-menu-close" onClick={toggleMobileMenu}>
               <CloseIcon sx={{ fontSize: 40, color: 'white' }} />
             </div>
             <nav className="mobile-nav-links">
               <Link to="/" onClick={toggleMobileMenu} className="mobile-nav-item">Home</Link>
               <Link to={auth.status === "Authenticated" && auth.user === "Admin" ? "/admin/hall" : "/admin_login"} onClick={toggleMobileMenu} className="mobile-nav-item">Admin</Link>
               <Link to={auth.status === "Authenticated" && auth.user === "Department" ? "/department/booking" : "/department_login"} onClick={toggleMobileMenu} className="mobile-nav-item">Department</Link>
               <Link to="/schedule" onClick={toggleMobileMenu} className="mobile-nav-item">Schedule</Link>
             </nav>
           </div>
        </div>
      )}

      {/* 8. SNACKBAR & MODALS */}
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={2000}
        onClose={() => setSnackbarOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" sx={{ width: '100%' }}>
          {snackbarMessage}
        </Alert>
      </Snackbar>

      {/* Wish Modal */}
      {showWishModal && (
        <div className="popup-overlay-backdrop" onClick={closeModals}>
          <div className="popup-card popup-card-wide" onClick={(e) => e.stopPropagation()}>
            <div className="popup-close" onClick={closeModals}>&times;</div>
            <h2 className="modal-title">Wish Your Day!</h2>
            
            <div className="contact-search-wrapper">
              <input 
                type="text" 
                className="contact-search-input"
                placeholder="Search name, number or email..." 
                value={searchText}
                onChange={handleSearchChange} 
                onKeyDown={handleSearchKeyDown}
              />
              <div className="search-btn-box" onClick={handleSearchSubmit}>
                <SearchIcon className="search-icon-svg" sx={{ fontSize: 20, color: lightMode ? 'white' : 'inherit' }} />
              </div>
            </div>

            <div className="contact-header-row">
              <span>NAME</span>
              <span>PHONE NUMBER</span>
              <span>EMAIL ADDRESS</span>
            </div>

            <div className="contact-list-scrollable">
              {loadingContacts ? (
                <Box display="flex" justifyContent="center" my={4}>
                  <CircularProgress size={30} />
                </Box>
              ) : filteredContacts.length > 0 ? (
                filteredContacts.map((contact) => (
                  <div className="contact-item-row" key={contact._id}>
                    <span className="c-name" title={contact.name}>{contact.name}</span>
                    <span 
                      className="c-num clickable" 
                      onClick={() => copyToClipboard(contact.number, "Number")}
                      title="Copy Number"
                    >
                      {contact.number}
                    </span>
                    <span 
                      className="c-email clickable" 
                      onClick={() => copyToClipboard(contact.email, "Email")}
                      title={contact.email ? "Copy Email" : ""}
                    >
                      {contact.email || "-"}
                    </span>
                  </div>
                ))
              ) : (
                <div className="no-contacts-msg">
                  {contacts.length === 0 ? "Loading contacts..." : "No contacts found matching criteria."}
                </div>
              )}
            </div>
            
            {!loadingContacts && (
              <p className="modal-footer-hint">Click on phone or email to copy</p>
            )}
          </div>
        </div>
      )}

      {/* AI MODAL (GEMINI STYLE) */}
      {showAIModal && (
        <div className="popup-overlay-backdrop" onClick={closeModals}>
          
          {/* Main Card Container with Running Gradient Border */}
          <div className="gemini-modal-card" onClick={(e) => e.stopPropagation()}>
            
            {/* Header: Title + Immersive + Close */}
            <div className="gemini-card-header">
              <div className="header-left">
                {aiPopupSidebarHidden && (
                  <button
                    type="button"
                    className="gemini-header-sidebar-restore-btn"
                    onClick={handlePopupSidebarRestore}
                    aria-label="Show collapsed sidebar"
                    title="Show collapsed sidebar"
                  >
                    <span className="ai-sidebar-collapse-icon right" aria-hidden="true">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" id="collapse-right">
                        <path d="M11,17a1,1,0,0,1-.71-1.71L13.59,12,10.29,8.71a1,1,0,0,1,1.41-1.41l4,4a1,1,0,0,1,0,1.41l-4,4A1,1,0,0,1,11,17Z"></path>
                        <path d="M15 13H5a1 1 0 0 1 0-2H15a1 1 0 0 1 0 2zM19 20a1 1 0 0 1-1-1V5a1 1 0 0 1 2 0V19A1 1 0 0 1 19 20z"></path>
                      </svg>
                    </span>
                  </button>
                )}
                <AutoAwesomeIcon className="header-sparkle" />
                <span className="header-title">AI Assistant</span>
              </div>
              
              <div className="header-right">
                <button 
                  className="immersive-btn-icon" 
                  onClick={async () => {
                    const played = await playElevenLabsSpeech({
                      text: "Deep diving in immersive mode",
                      mode: "immersive_intro"
                    });

                    if (!played && 'speechSynthesis' in window) {
                      const utterance = new SpeechSynthesisUtterance("Deep diving in immersive mode");
                      window.speechSynthesis.cancel();
                      window.speechSynthesis.speak(utterance);
                    }

                    setShowDeepDiveAnim(true);
                    setTimeout(() => {
                      navigate("/ai");
                      setShowDeepDiveAnim(false);
                    }, 2500); 
                  }}
                  title="Immersive Mode"
                >
                  <OpenInFullIcon fontSize="small" />
                </button>

                <div className="close-btn-icon" onClick={closeModals}>
                  <CloseIcon fontSize="small" />
                </div>
              </div>
            </div>

            {/* Content: The Chat Widget */}
             <div className="gemini-card-body">
               <Suspense fallback={null}>
                 <AIChatWidget
                   showHeaderBrand={false}
                   onSidebarHiddenChange={setAiPopupSidebarHidden}
                   externalRestoreSignal={aiPopupRestoreSignal}
                 />
               </Suspense>
             </div>

          </div>
        </div>
      )}

      {/* Date Click Modal */}
      {showDateModal && (
        <div className="popup-overlay-backdrop" onClick={closeModals}>
          <div className="popup-card" onClick={(e) => e.stopPropagation()}>
            <div className="popup-close" onClick={closeModals}>&times;</div>
            <h3 className="date-modal-subtitle">Selected Date</h3>
            <h1 className="date-modal-title">{clickedDate}</h1>
            <div className="booking-options">
              <button className="btn-option btn-check" onClick={goToCheckBookings}>
                Check today's bookings
              </button>
              <button className="btn-option btn-book-now" onClick={goToBookNow}>
                BOOK NOW
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================
          HERO SECTION
          ========================================================= */}
      <section
        ref={sectionRef}
        className="hero-video-wrapper no-horizontal-scroll"
        style={{
          backgroundImage: bgImage,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        {/* --- DESKTOP: VIDEO ELEMENT --- */}
        {!isMobile && videoEnabled && showVideo && (
          <video
            ref={videoRef}
            className="hero-video"
            src="https://res.cloudinary.com/dkgbflzrc/video/upload/f_auto,q_auto/v1768165340/hero-video_xatba1.mp4"
            loop
            playsInline
            muted={isMuted}
            preload="metadata"
          />
        )}

        <div className="hero-overlay" />
          
        {/* --- DESKTOP: STEAM & CALENDAR --- */}
        {!isMobile && !showVideo && (
          <>
          <div className="steam-layer">
            <span></span><span></span><span></span><span></span>
            <span></span><span></span><span></span><span></span>
          </div>

          <div className="calendar-3d-wrapper">
            <div className="calendar-page">
              <div className="cal-body-row">
                <div className="cal-grid">
                  {["S","M","T","W","T","F","S"].map((d, i) => (
                    <div key={`head-${i}`} className="cal-header-day">{d}</div>
                  ))}
                  {daysArray.map((d, i) => (
                    <div 
                      key={i} 
                      className={`cal-date ${d === currentDay ? 'today' : ''} ${d === null ? 'empty' : ''}`}
                      onClick={() => handleDateClick(d)}
                    >
                      {d}
                    </div>
                  ))}
                </div>
                <div className="cal-side-header">
                  <span className="cal-side-month">{currentMonthName}</span>
                  <span className="cal-side-year">{shortYear}</span>
                </div>
              </div>
              <div className="cal-actions">
                <button className="cal-btn btn-wish" onClick={handleWishClick}>
                  Wish Your Day
                </button>
                <button className="cal-btn btn-ai" onClick={handleAIClick}>
                  AI Mode
                </button>
              </div>
            </div>
          </div>
          </>
        )}

        {/* ================= MOBILE SPECIFIC CONTENT ================= */}
        {/* Wish Button */}
        {isMobile && (
          <button className="mobile-wish-btn" onClick={handleWishClick}>
            <CakeIcon sx={{ fontSize: 18 }} />
            <span>Wish your day</span>
          </button>
        )}

        {/* ================= UI ELEMENTS (LOGOS & TEXT) ================= */}
        <div className="logo-container">
         <img
    src="https://res.cloudinary.com/dkgbflzrc/image/upload/f_auto,q_auto,w_300/v1769371273/BIT-Mesra_dmz9iz.png"
    alt="Logo"
    className="logo-img"
    fetchpriority="high"
    width="70"
    height="70"
  />
        </div>
        <div className="logo-container2">
         <img
    src="https://res.cloudinary.com/dkgbflzrc/image/upload/f_auto,q_auto,w_200/v1769371285/images_uotatw.png"
    alt="Logo"
    className="logo-img2"
    fetchpriority="high"
    width="80"
    height="80"
  />
        </div>

        {/* Hero Text Content */}
        <div className={`hero-content ${!isMobile ? 'hero-content-lowered' : 'hero-content-mobile'}`}>
          <h1>
            Book your hall <br />
            <span>before your coffee gets cold</span>
          </h1>
          <p>
            Our <span className="highlight">Hall Booking System</span> is the home
            to all your hall bookings. <br />
            Seamless Experience. Centralized Platform. Easy Bookings
          </p>
        </div>

        {/* ================= CONTROLS (Desktop Only) ================= */}
        {!isMobile && (
        <div className="controls-container">
          {!videoEnabled && (
            <button className="control-btn-initial" onClick={handleInitialClick}>
              <svg viewBox="0 0 24 24" fill="currentColor" className="icon-svg-sm">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
              <span>Play Video</span>
            </button>
          )}

          {videoEnabled && (
            <div className="control-capsule">
              {showVideo && (
                <>
                  <button className="icon-btn" onClick={togglePlayPause} title={isPlaying ? "Pause" : "Play"}>
                    {isPlaying ? (
                      <svg viewBox="0 0 24 24" fill="currentColor" className="icon-svg">
                        <rect x="6" y="4" width="4" height="16"></rect>
                        <rect x="14" y="4" width="4" height="16"></rect>
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="currentColor" className="icon-svg">
                        <polygon points="5 3 19 12 5 21 5 3"></polygon>
                      </svg>
                    )}
                  </button>

                  <button className="icon-btn" onClick={toggleMute} title={isMuted ? "Unmute" : "Mute"}>
                    {isMuted ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="icon-svg-stroke">
                        <path d="M11 5L6 9H2v6h4l5 4V5z"></path>
                        <line x1="23" y="9" x2="17" y2="15"></line>
                        <line x1="17" y="9" x2="23" y2="15"></line>
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="icon-svg-stroke">
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                      </svg>
                    )}
                  </button>
                    
                  <div className="control-divider"></div>
                </>
              )}

              <button className="icon-btn" onClick={toggleMediaSource} title={showVideo ? "Switch to Image" : "Switch to Video"}>
                  {showVideo ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="icon-svg-stroke">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                      <circle cx="8.5" cy="8.5" r="1.5"></circle>
                      <polyline points="21 15 16 10 5 21"></polyline>
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="icon-svg-stroke">
                        <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect>
                        <line x1="7" y1="2" x2="7" y2="22"></line>
                        <line x1="17" y1="2" x2="17" y2="22"></line>
                        <line x1="2" y1="12" x2="22" y2="12"></line>
                        <line x1="2" y1="7" x2="7" y2="7"></line>
                        <line x1="2" y1="17" x2="7" y2="17"></line>
                        <line x1="17" y1="17" x2="22" y2="17"></line>
                        <line x1="17" y1="7" x2="22" y2="7"></line>
                    </svg>
                  )}
              </button>
            </div>
          )}
        </div>
        )}

        {/* ================= CONSENT MODAL ================= */}
        {!isMobile && showConsent && (
          <div className="hero-consent-backdrop">
            <div className="hero-consent-card">
              <h3>Play Background Video?</h3>
              <p>
                This video will play with sound. It may consume data and affect performance.
              </p>
              <div className="consent-actions">
                <button onClick={handleConsentOk}>OK</button>
                <button onClick={handleConsentCancel}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* ================= SCROLL ARROW ================= */}
        {showArrow && (
          <div className="scroll-down-hero" onClick={handleScrollDown}>
            <span className="scroll-text">Scroll down</span>
            <svg className="double-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <polyline points="7 8 12 13 17 8" />
              <polyline points="7 12 12 17 17 12" />
            </svg>
          </div>
        )}
      </section>
      
      {/* DEEP DIVE ANIMATION OVERLAY */}
      {showDeepDiveAnim && (
        <div style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99999,
            background: 'black',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            animation: 'fadeIn 0.5s ease'
        }}>
            <div style={{
                width: '100%', height: '100%',
                background: 'linear-gradient(45deg, #4285f4, #9b72cb, #d96570, #fbbc05)',
                backgroundSize: '400% 400%',
                animation: 'gradientShift 2s ease infinite',
                opacity: 0.8,
                filter: 'blur(50px)'
            }}></div>
            <h1 style={{
                position: 'absolute',
                color: 'white',
                fontFamily: 'RecklessNeue',
                fontSize: '3rem',
                textShadow: '0 0 20px rgba(255,255,255,0.8)',
                animation: 'popup 1s ease'
            }}>
                Deep Diving...
            </h1>
        </div>
      )}
    </>
  );
}

