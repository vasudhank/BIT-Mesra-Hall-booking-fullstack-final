import React from 'react';
import AIChatWidget from '../components/AI/AIChatWidget';
import { useNavigate } from 'react-router-dom';
import IconButton from '@mui/material/IconButton';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

const AIImmersive = () => {
  const navigate = useNavigate();

  return (
    <div style={{ 
        width: '100vw', 
        height: '100vh', 
        background: '#ffffff', // Or dynamic dark mode var
        position: 'relative' 
    }}>
      {/* Back Button */}
      <div style={{ position: 'absolute', top: 15, left: 15, zIndex: 100 }}>
        <IconButton onClick={() => navigate('/')}>
            <ArrowBackIcon />
        </IconButton>
      </div>

      <AIChatWidget immersive={true} />
    </div>
  );
};

export default AIImmersive;