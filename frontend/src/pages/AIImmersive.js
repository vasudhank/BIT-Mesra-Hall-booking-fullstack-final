import React, { useEffect } from 'react';
import AIChatWidget from '../components/AI/AIChatWidget';

const AIImmersive = () => {
  useEffect(() => {
    document.body.classList.add('ai-immersive-page');
    return () => {
      document.body.classList.remove('ai-immersive-page');
    };
  }, []);

  return (
    <div className="ai-immersive-page-wrap">
      <AIChatWidget immersive={true} />
    </div>
  );
};

export default AIImmersive;
