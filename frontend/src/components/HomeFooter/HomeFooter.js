import React from "react";
import "./HomeFooter.css";
import { Link } from "react-router-dom";

export default function HomeFooter() {
  return (
    <footer className="home-footer">
      <div className="footer-container">
        {/* Top Section: Links */}
        <div className="footer-links">
          <Link to="/about" className="footer-link">About Us</Link>
          <Link to="/faqs" className="footer-link">FAQs</Link>
          <Link to="/queries" className="footer-link">Queries</Link>
          <Link to="/complaints" className="footer-link">Complaints</Link>
          <Link to="/feedback" className="footer-link">Feedback</Link>
          <Link to="/developer/login" className="footer-link">Developer Portal</Link>
          <a 
            href="https://bitmesra.ac.in/" 
            target="_blank" 
            rel="noopener noreferrer" 
            className="footer-link"
          >
            Official BIT Mesra Site
          </a>
        </div>

        {/* Bottom Section: Branding */}
        <div className="footer-branding">
          <span className="footer-copy">
            © {new Date().getFullYear()} SEMINAR HALL BOOKING SYSTEM
          </span>
        </div>
      </div>
    </footer>
  );
}
