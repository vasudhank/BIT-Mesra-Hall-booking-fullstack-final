import React from 'react';
import { useSelector } from 'react-redux';
import { Navigate } from 'react-router-dom';
import Loading from '../components/Loading/Loading';

export default function AdminOnlyRoute({ children }) {
  const user = useSelector((s) => s.user);
  if (user.status === 'Checking') return <Loading />;
  if (user.status !== 'Authenticated' || String(user.user || '') !== 'Admin') {
    return <Navigate to="/admin_login" replace />;
  }
  return children;
}

