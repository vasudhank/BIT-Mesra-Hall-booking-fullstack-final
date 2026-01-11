import React from "react";
import "./FeatureList.css";

export default function FeatureList({ features = [] }) {
  return (
    <div className="feature-list">
      {features.map((f, i) => (
        <div key={i} className="feature-item">
          <div className="tick-circle">✓</div>
          <span className="feature-text">{f.text}</span>
        </div>
      ))}
    </div>
  );
}