import React from 'react';
import { useSelector } from 'react-redux';
import { Navigate } from 'react-router-dom';

export default function DeveloperRoute({ children }) {
  const user = useSelector((s) => s.user);

  if (user.status === 'Checking') return null;
  if (user.status !== 'Authenticated' || String(user.user || '') !== 'Developer') {
    return <Navigate to="/developer/login" replace />;
  }
  return children;
}
