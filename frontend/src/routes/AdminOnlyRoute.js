import React from 'react';
import { useSelector } from 'react-redux';
import { Navigate } from 'react-router-dom';

export default function AdminOnlyRoute({ children }) {
  const user = useSelector((s) => s.user);
  if (user.status === 'Checking') return null;
  if (user.status !== 'Authenticated' || String(user.user || '') !== 'Admin') {
    return <Navigate to="/admin_login" replace />;
  }
  return children;
}
