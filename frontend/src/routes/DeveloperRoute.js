import React from 'react';
import { useSelector } from 'react-redux';
import { Navigate } from 'react-router-dom';
import Loading from '../components/Loading/Loading';

export default function DeveloperRoute({ children }) {
  const user = useSelector((s) => s.user);

  if (user.status === 'Checking') return <Loading />;
  if (user.status !== 'Authenticated' || String(user.user || '') !== 'Developer') {
    return <Navigate to="/developer/login" replace />;
  }
  return children;
}

