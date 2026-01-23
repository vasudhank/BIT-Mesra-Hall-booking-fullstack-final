import React, { useState, useEffect } from "react";
import "./HomeLower.css";
import HomeCard from "../HomeCard/HomeCard";
import HomeFooter from "../HomeFooter/HomeFooter";
import Button from "@mui/material/Button";
import { Link } from "react-router-dom";
import { useSelector } from "react-redux";

// Data for the Magazine Style Typography
const HEADLINES = [
  {
    line1: { text: "SPACE", dot: true },
    line2: { text: "SIMPLIFIED", dot: true },
    subtext: "No more email chains. Zero scheduling conflicts. Just book and go."
  },
  {
    line1: { text: "STOP ASKING", dot: false },
    line2: { text: '"IS IT FREE?"', dot: false }, 
    subtext: "Live schedules. Instant visibility. No more guessing games."
  },
  {
    line1: { text: "YOUR CAMPUS", dot: true },
    line2: { text: "SYNCHRONIZED", dot: true },
    subtext: "Bridging the gap between request and approval."
  },
  {
    line1: { text: "HALLS ON", dot: false },
    line2: { text: "AUTOPILOT", dot: true },
    subtext: "Streamlining administration for a smarter college campus."
  }
];

// Marquee Data - Split for styling
// 'highlight' makes text yellow, 'dot' adds orange period at end
const MARQUEE_WORDS = [
  { text: "The", highlight: false },
  { text: "Institute", highlight: false },
  { text: "Hall", highlight: false },
  { text: "Booking", highlight: false },
  { text: "Digital", highlight: false },
  { text: "Platform", highlight: false },
  { text: "Of", highlight: false },
  { text: "Birla", highlight: false },
  { text: "Institute", highlight: false },
  { text: "Of", highlight: false },
  { text: "Technology", highlight: true }, // Highlight
  { text: "Mesra", dot: true, highlight: false }, // Dot
  { text: "One", highlight: false },
  { text: "Single Stop Web Solution", highlight: true }, // Highlight Phrase
  { text: "Of", highlight: false },
  { text: "Hall", highlight: false },
  { text: "Bookings", highlight: false },
  { text: "For", highlight: false },
  { text: "Activities", highlight: false },
  { text: "&", highlight: false },
  { text: "Project", highlight: false },
  { text: "Beyond", highlight: false },
  { text: "Academics", dot: true, highlight: false } // Dot
];

export default function HomeLower({ lightMode }) {
  const auth = useSelector((state) => state.user);

  // === DYNAMIC TEXT STATE ===
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      // Start exit animation
      setIsTransitioning(true);
      
      // Wait for exit animation to almost finish before switching data
      setTimeout(() => {
        setCurrentIndex((prevIndex) => (prevIndex + 1) % HEADLINES.length);
        setIsTransitioning(false); // Start enter animation
      }, 800); // Matches CSS transition duration

    }, 5000); // Change every 5 seconds

    return () => clearInterval(interval);
  }, []);

  return (
    <div className={`lower-div ${lightMode ? "light" : "dark"}`}>
      
      {/* =========================================================
          MAGAZINE TYPOGRAPHY HERO (DESKTOP ONLY)
          ========================================================= */}
      <div className="magazine-hero-section">
        <div className="mag-headline-wrapper">
          {HEADLINES.map((item, index) => (
            <React.Fragment key={index}>
              {/* Massive Headline */}
              <div 
                className={`mag-big-text ${
                  index === currentIndex && !isTransitioning 
                    ? "active" 
                    : index === currentIndex && isTransitioning 
                      ? "exit" 
                      : ""
                }`}
              >
                <div>
                  {item.line1.text}
                  {item.line1.dot && <span className="mag-dot">.</span>}
                </div>
                <div>
                  {item.line2.text}
                  {item.line2.dot && <span className="mag-dot">.</span>}
                </div>
              </div>

              {/* Subtext Container with Accent Line (LEFT SIDE NOW) */}
              <div 
                className={`mag-subtext-container ${
                  index === currentIndex && !isTransitioning 
                    ? "active" 
                    : ""
                }`}
              >
                <div className="mag-accent-line"></div>
                <div className="mag-subtext">
                  {item.subtext}
                </div>
              </div>
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* =========================================================
          BOOK NOW BUTTON
          ========================================================= */}
      <div className="lower-book-btn">
        <Button className="hero-btn" disableRipple>
          {auth.status === "Authenticated" &&
          auth.user === "Department" ? (
            <Link to="/department/booking">BOOK NOW</Link>
          ) : (
            <Link to="/department_login">BOOK NOW</Link>
          )}
        </Button>
      </div>

      {/* =========================================================
          INFINITE MARQUEE STRIP
          ========================================================= */}
      <div className="marquee-wrapper">
        <div className="marquee-content">
          {/* Loop twice to create seamless infinite scroll */}
          {[0, 1].map((iteration) => (
            <span key={iteration} className="marquee-block">
              {MARQUEE_WORDS.map((wordObj, i) => (
                <span 
                  key={i} 
                  className={`marquee-word ${wordObj.highlight ? 'marquee-highlight' : ''}`}
                >
                  {wordObj.text}
                  {wordObj.dot && <span className="marquee-dot">.</span>}
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>

      {/* =========================================================
          CARDS & FOOTER
          ========================================================= */}
      <HomeCard />
      <HomeFooter />
    </div>
  );
}