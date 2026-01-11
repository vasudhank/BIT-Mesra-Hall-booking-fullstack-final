import React, { useRef, useState, useEffect } from "react";
import "./HomeUpper.css";
import Grid from "@mui/material/Grid";
import Box from "@mui/material/Box";
import { Link, useLocation } from "react-router-dom";
import { useSelector } from "react-redux";

/* 🔊 SET DEFAULT VIDEO VOLUME HERE (0.0 – 1.0) */
const DEFAULT_VOLUME = 0.5;

export default function HomeUpper() {
  const auth = useSelector((state) => state.user);
  const location = useLocation();

  const videoRef = useRef(null);
  const sectionRef = useRef(null);

  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(true);
  const [showArrow, setShowArrow] = useState(true);
  const [scrolled, setScrolled] = useState(false);
  const [dateTime, setDateTime] = useState("");

  const toggleVideo = () => {
    if (!videoRef.current) return;
    paused ? videoRef.current.play() : videoRef.current.pause();
    setPaused(!paused);
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    videoRef.current.muted = !muted;
    setMuted(!muted);
  };

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = DEFAULT_VOLUME;
    }
  }, []);

  useEffect(() => {
  if (!sectionRef.current) return;

  const observer = new IntersectionObserver(
    ([entry]) => {
      // When HomeUpper is NOT fully visible → scrolled state
      setScrolled(!entry.isIntersecting);
    },
    {
      threshold: 0.99, // almost fully visible
    }
  );

  observer.observe(sectionRef.current);

  return () => observer.disconnect();
}, []);


  /* Arrow visibility (IntersectionObserver) */
  useEffect(() => {
    if (!sectionRef.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setShowArrow(entry.isIntersecting);
      },
      { threshold: 0.9 }
    );

    observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  


  /* Date & time */
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const ist = new Date(
        now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
      );

      const days = [
        "SUNDAY","MONDAY","TUESDAY","WEDNESDAY",
        "THURSDAY","FRIDAY","SATURDAY"
      ];

      const months = [
        "JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE",
        "JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"
      ];

      setDateTime(
        `${days[ist.getDay()]}, ${months[ist.getMonth()]} ${String(
          ist.getDate()
        ).padStart(2, "0")}, ${ist.getFullYear()} - ${String(
          ist.getHours()
        ).padStart(2, "0")}:${String(
          ist.getMinutes()
        ).padStart(2, "0")}:${String(
          ist.getSeconds()
        ).padStart(2, "0")} IST`
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  

  /* Scroll down */
  const handleScrollDown = () => {
    setShowArrow(false);
    const next = document.querySelector(".lower-div");
    if (next) {
      next.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <>
      <section
        ref={sectionRef}
        className="hero-video-wrapper no-horizontal-scroll"
      >
        <video
  ref={videoRef}
  className="hero-video"
  src="https://res.cloudinary.com/dkgbflzrc/video/upload/f_auto,q_auto/v1768165340/hero-video_xatba1.mp4"
  autoPlay
  loop
  playsInline
  muted={muted}
  preload="metadata"
/>

        <div className="hero-overlay" />

        {/* Logos */}
        <div className="logo-container">
          <img
            src={require("../../assets/BIT-Mesra.png")}
            alt="Logo"
            className="logo-img"
          />
        </div>

        <div className="logo-container2">
          <img
            src={require("../../assets/images.png")}
            alt="Logo"
            className="logo-img2"
          />
        </div>

        {/* Date & Time Bar */}
        <div className="datetime-wrapper">
          <div className={`datetime-bar ${scrolled ? "datetime--scrolled" : ""}`}>
            {dateTime}
          </div>
        </div>

        {/* Navbar */}
        <Box className="navbar-wrapper">
  <Grid container justifyContent="center">
    <Grid item display="flex" justifyContent="center">
      <div className={`navbar-shell ${scrolled ? "navbar-shell--scrolled" : ""}`}>
        <div className="navbar">
          <div className="list-item">
            <div className="list-item-children">
              <Link to="/" className={location.pathname === "/" ? "active" : ""}>
                Home
              </Link>
            </div>
            <div className="list-item-children">
              <Link
                to={
                  auth.status === "Authenticated" && auth.user === "Admin"
                    ? "/admin/hall"
                    : "/admin_login"
                }
              >
                Admin
              </Link>
            </div>
            <div className="list-item-children">
              <Link
                to={
                  auth.status === "Authenticated" &&
                  auth.user === "Department"
                    ? "/department/booking"
                    : "/department_login"
                }
              >
                Department
              </Link>
            </div>
            <div className="list-item-children">
              <Link to="/schedule">Schedule</Link>
            </div>
          </div>
        </div>
      </div>
    </Grid>
  </Grid>
</Box>

        {/* Hero text */}
        <div className="hero-content hero-content-lowered">
          <h1>
            Book your hall
            <br />
            <span>before your coffee gets cold</span>
          </h1>
          <p>
            Our <span className="highlight">Hall Booking System</span> is the home
            to all your hall bookings.
            <br />
            Seamless Experience. Centralized Platform. Easy Bookings
          </p>
        </div>

        {/* ✅ VIDEO CONTROLS (Pause + Mute restored) */}
        <button
          className="video-toggle"
          onClick={toggleVideo}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            fontSize: "12px"
          }}
        >
          {paused ? "▶ Resume" : "⏸ Pause"}

          <span
            onClick={(e) => {
              e.stopPropagation();
              toggleMute();
            }}
            style={{ display: "flex", cursor: "pointer" }}
          >
            {muted ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                <path d="M19 5a9 9 0 0 1 0 14" />
              </svg>
            )}
          </span>
        </button>

        {/* Scroll down */}
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
