import React, { useRef, useState, useEffect } from "react";
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
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'; // For AI Icon
import CakeIcon from '@mui/icons-material/Cake'; // Icon for Wish button

// Import the API call
import { getContactsApi } from "../../api/contactApi";

export default function HomeUpper() {
  const auth = useSelector((state) => state.user);
  const location = useLocation();
  const navigate = useNavigate();

  const sectionRef = useRef(null);
  const videoRef = useRef(null);

  // === RESPONSIVE STATE ===
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Scroll & UI States
  const [showArrow, setShowArrow] = useState(true);
  const [scrolled, setScrolled] = useState(false);
  const [dateTime, setDateTime] = useState("");

  // Video Logic States
  const [showConsent, setShowConsent] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  // === MODAL STATES ===
  const [showWishModal, setShowWishModal] = useState(false);
  const [showAIModal, setShowAIModal] = useState(false);
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
      setIsMobile(window.innerWidth <= 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // --- Handlers ---
  const handleWishClick = async (e) => {
    e.stopPropagation();
    setShowWishModal(true);
    if (contacts.length === 0) {
      setLoadingContacts(true);
      const res = await getContactsApi();
      if (res && res.data && res.data.contacts) {
        setContacts(res.data.contacts);
        setFilteredContacts(res.data.contacts);
      }
      setLoadingContacts(false);
    }
  };

  // UPDATED SEARCH HANDLER (Real-time clear, Manual Enter)
  const handleSearchChange = (e) => {
    const val = e.target.value;
    setSearchText(val);

    // If user clears the box, reset list immediately
    if (val === "") {
      setFilteredContacts(contacts);
    }
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
    setShowAIModal(true);
  };

  const handleDateClick = (day) => {
    if (!day) return;
    setClickedDate(`${currentMonthName} ${day}`);
    setShowDateModal(true);
  };

  const closeModals = () => {
    setShowWishModal(false);
    setShowAIModal(false);
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

  /* ================= DATE & TIME ================= */
  useEffect(() => {
    const updateTime = () => {
      const ist = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
      const days = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
      const months = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
      setDateTime(`${days[ist.getDay()]}, ${months[ist.getMonth()]} ${String(ist.getDate()).padStart(2, "0")}, ${ist.getFullYear()} - ${String(ist.getHours()).padStart(2, "0")}:${String(ist.getMinutes()).padStart(2, "0")}:${String(ist.getSeconds()).padStart(2, "0")} IST`);
    };
    updateTime();
    const i = setInterval(updateTime, 1000);
    return () => clearInterval(i);
  }, []);

  /* ================= VIDEO HANDLERS (Desktop Only) ================= */
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
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play();
      setIsPlaying(true);
    }
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
      setTimeout(() => {
        if (videoRef.current) videoRef.current.play();
      }, 50);
    }
  };

  const handleScrollDown = () => {
    setShowArrow(false);
    document.querySelector(".lower-div")?.scrollIntoView({ behavior: "smooth" });
  };

  // Determine Background Image
  // Mobile: Specific image provided. Desktop: Dynamic logic.
  const bgImage = isMobile 
    ? "url('https://res.cloudinary.com/dkgbflzrc/image/upload/v1768803019/WhatsApp_Image_2026-01-19_at_11.35.40_AM_1_awmflo.jpg')"
    : (!showVideo 
        ? "url('https://res.cloudinary.com/dkgbflzrc/image/upload/v1768669856/97f75189-9827-4de8-a5ec-22fc1c1cd814_xszdio.jpg')" 
        : "none");

  /* ================= RENDER ================= */
  return (
    <>
      {/* =========================================================
          FIXED UI LAYERS (MOVED OUTSIDE SECTION TO STAY ON TOP)
          ========================================================= */}

      {/* 1. Date & Time */}
      <div className="datetime-wrapper">
        <div className={`datetime-bar ${scrolled ? "datetime--scrolled" : ""}`}>
          {dateTime}
        </div>
      </div>

      {/* 2. Navbar (DESKTOP) */}
      {!isMobile && (
        <Box className="navbar-wrapper">
          <Grid container justifyContent="center">
            <Grid item display="flex" justifyContent="center">
              <div className={`navbar-shell ${scrolled ? "navbar-shell--scrolled" : ""}`}>
                <div className="navbar">
                  <div className="nav-links-container">
                    <div className="nav-link-item">
                      <Link to="/" className={location.pathname === "/" ? "active" : ""}>Home</Link>
                    </div>
                    <div className="nav-link-item">
                      <Link to={auth.status === "Authenticated" && auth.user === "Admin" ? "/admin/hall" : "/admin_login"}>Admin</Link>
                    </div>
                    <div className="nav-link-item">
                      <Link to={auth.status === "Authenticated" && auth.user === "Department" ? "/department/booking" : "/department_login"}>Department</Link>
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

      {/* 3. Mobile Menu Button (Fixed, Circular, Right) */}
      {isMobile && (
        <button className="mobile-menu-toggle" onClick={toggleMobileMenu}>
          <MenuIcon style={{ fontSize: '1.8rem', color: 'white' }} />
        </button>
      )}

      {/* 4. Mobile AI FAB (Fixed, Bottom Right, Modern AI Look) */}
      {isMobile && (
        <button className="mobile-ai-fab" onClick={handleAIClick}>
          <AutoAwesomeIcon sx={{ fontSize: 26, color: 'white' }} />
        </button>
      )}

      {/* 5. Mobile Menu Overlay */}
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

      {/* 6. SNACKBAR & MODALS */}
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
                <SearchIcon sx={{ color: 'white', fontSize: 20 }} />
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

      {/* AI Modal */}
      {showAIModal && (
        <div className="popup-overlay-backdrop" onClick={closeModals}>
          <div className="popup-card" onClick={(e) => e.stopPropagation()}>
            <div className="popup-close" onClick={closeModals}>&times;</div>
            <div style={{ textAlign: 'center' }}>
              <div className="ai-modal-icon">✨</div>
              <h2 className="ai-header">AI Assistant</h2>
              <p className="ai-body">
                Hello! I can help you navigate the <strong>Hall Booking System</strong>. 
                <br/><br/>
                • Looking for a free hall? Check the <em>Schedule</em>.<br/>
                • Need to book? Go to <em>Department Login</em>.<br/>
                • Any technical issues? Contact Admin.
              </p>
              <div className="ai-typing-box">Typing capability coming soon...</div>
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
          HERO SECTION (STICKY BACKGROUND)
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
        {/* --- DESKTOP: VIDEO ELEMENT (Render only if !isMobile) --- */}
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

        {/* DARK OVERLAY */}
        <div className="hero-overlay" />
         
        {/* --- DESKTOP: STEAM & CALENDAR (Render only if !isMobile & Image mode) --- */}
        {!isMobile && !showVideo && (
          <>
          <div className="steam-layer">
            <span></span><span></span><span></span><span></span>
            <span></span><span></span><span></span><span></span>
          </div>

          {/* 3D CALENDAR */}
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
        {/* Wish Button (Left Inside - Scrolls with content) */}
        {isMobile && (
          <button className="mobile-wish-btn" onClick={handleWishClick}>
            <CakeIcon sx={{ fontSize: 18 }} />
            <span>Wish your day</span>
          </button>
        )}

        {/* ================= UI ELEMENTS (LOGOS & TEXT) ================= */}
        {/* Logos */}
        <div className="logo-container">
          <img src={require("../../assets/BIT-Mesra.png")} alt="Logo" className="logo-img" />
        </div>
        <div className="logo-container2">
          <img src={require("../../assets/images.png")} alt="Logo" className="logo-img2" />
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

        {/* ================= CONSENT MODAL (Desktop Only) ================= */}
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
    </>
  );
}