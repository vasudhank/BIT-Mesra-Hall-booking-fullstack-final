import React from "react";
import "./HomeFooter.css";

export default function HomeFooter() {
  return (
    <>
      <footer
        className="text-gray-600 body-font"
        style={{
          position: "absolute",
          bottom: "0px",
          right: "16px",
        }}
      >
        <div className="container px-5 py-2 mx-auto">
          <span
            className="feature"
            style={{
              fontSize: "0.75rem", // 👈 CHANGE THIS VALUE TO REDUCE / INCREASE SIZE
            }}
          >
            © SEMINAR HALL BOOKING SYSTEM
          </span>
        </div>
      </footer>
    </>
  );
}
