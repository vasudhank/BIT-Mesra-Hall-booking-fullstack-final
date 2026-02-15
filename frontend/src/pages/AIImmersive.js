import React from 'react';
import AIChatWidget from '../components/AI/AIChatWidget';

const AIImmersive = () => {
  return (
    <div style={{ width: '100vw', height: '100vh', background: 'var(--gemini-bg, #ffffff)' }}>
      <AIChatWidget immersive={true} />
    </div>
  );
};

export default AIImmersive;
