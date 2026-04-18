import './App.css';
import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { BrowserRouter as Router, Route, Routes, useLocation } from 'react-router-dom';
import { useDispatch } from 'react-redux';

import Home from './routes/Home';
import About from './routes/About';
import FAQ from './routes/FAQ';
import AdminLoginRoute from './routes/AdminLoginRoute';
import DepartmentLoginRoute from './routes/DepartmentLoginRoute';
import DepartmentRegisterRoute from './routes/DepartmentRegisterRoute';
import AdminHallRoute from './routes/AdminHallRoute';
import AdminBookingRoute from './routes/AdminBookingRoute';
import AdminDepartmentRoute from './routes/AdminDepartmentRoute';
import AdminDepartmentRequestRoute from './routes/AdminDepartmentRequestRoute';
import AdminContactsRoute from './routes/AdminContactsRoute';
import DepartmentBookingRoute from './routes/DepartmentBookingRoute';
import DepartmentHistoryRoute from './routes/DepartmentHistoryRoute';
import DepartmentAccountPage from './pages/DepartmentAccountPage';
import Schedule from './components/Schedule/Schedule';
import DepartmentForgot from './components/DepartmentForgot/DepartmentForgot';
import AdminForgot from './components/AdminForgot/AdminForgot';
import AIImmersive from './pages/AIImmersive';
import AdminApproveDepartment from './components/AdminApproveDepartment/AdminApproveDepartment';
import DeveloperLogin from './components/DeveloperLogin/DeveloperLogin';
import ComplaintsPage from './pages/ComplaintsPage';
import ComplaintDetailPage from './pages/ComplaintDetailPage';
import QueriesPage from './pages/QueriesPage';
import QueryDetailPage from './pages/QueryDetailPage';
import FeedbackPage from './pages/FeedbackPage';
import AdminAccountPage from './pages/AdminAccountPage';
import DeveloperAccountPage from './pages/DeveloperAccountPage';
import NoticesPage from './pages/NoticesPage';
import NoticeDetailPage from './pages/NoticeDetailPage';
import CalendarPage from './pages/CalendarPage';
import DeveloperRoute from './routes/DeveloperRoute';
import AdminOnlyRoute from './routes/AdminOnlyRoute';
import TrashPage from './pages/TrashPage';
import WishYourDayOverlay from './components/Contacts/WishYourDayOverlay';

import { checkauth } from './store/slices/userSlice';
import {
  THEME_SYNC_EVENT,
  applyThemeToBody,
  readGlobalThemeMode,
  resolveEffectiveThemeMode,
  setGlobalThemeMode,
  setPageThemeMode
} from './utils/themeModeScope';

function AppRoutes({ lightMode, toggleTheme }) {
  const location = useLocation();
  const globalMode = lightMode ? 'light' : 'dark';
  const normalizedPath = String(location.pathname || '').toLowerCase();
  const isHomeScopedThemeRoute =
    normalizedPath === '/' || normalizedPath === '/about' || normalizedPath === '/faqs';

  useEffect(() => {
    if (typeof window === 'undefined' || !window.history) return undefined;
    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';

    return () => {
      window.history.scrollRestoration = previousScrollRestoration;
    };
  }, []);

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const resetScrollPosition = () => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    };

    resetScrollPosition();
    const frameId = window.requestAnimationFrame(resetScrollPosition);

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [location.pathname]);

  const syncThemeForCurrentRoute = useCallback(() => {
    const effectiveMode = resolveEffectiveThemeMode(location.pathname, globalMode);
    applyThemeToBody(effectiveMode);
  }, [globalMode, location.pathname]);

  useEffect(() => {
    syncThemeForCurrentRoute();
  }, [syncThemeForCurrentRoute]);

  useEffect(() => {
    const handleThemeSync = () => {
      syncThemeForCurrentRoute();
    };

    window.addEventListener(THEME_SYNC_EVENT, handleThemeSync);
    return () => {
      window.removeEventListener(THEME_SYNC_EVENT, handleThemeSync);
    };
  }, [syncThemeForCurrentRoute]);

  useEffect(() => {
    if (isHomeScopedThemeRoute) return undefined;

    const handleKeyDown = (event) => {
      if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      const key = String(event.key || '').toLowerCase();
      if (key !== 'd' && key !== 'l') return;

      event.preventDefault();
      event.stopPropagation();

      const nextMode = key === 'd' ? 'dark' : 'light';
      setPageThemeMode(location.pathname, nextMode);
      applyThemeToBody(nextMode);
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [location.pathname, isHomeScopedThemeRoute]);

  return (
    <Routes>
      <Route path="/" element={<Home lightMode={lightMode} toggleTheme={toggleTheme} />} />
      <Route path="/ai" element={<AIImmersive />} />
      <Route path="/about" element={<About lightMode={lightMode} toggleTheme={toggleTheme} />} />
      <Route path="/faqs" element={<FAQ lightMode={lightMode} toggleTheme={toggleTheme} />} />
      <Route path="/schedule" element={<Schedule />} />
      <Route path="/notices" element={<NoticesPage />} />
      <Route path="/notices/:id" element={<NoticeDetailPage />} />
      <Route path="/calendar" element={<CalendarPage />} />
      <Route path="/calender" element={<CalendarPage />} />
      <Route path="/trash" element={<TrashPage />} />
      <Route path="/admin_login" element={<AdminLoginRoute />} />
      <Route path="/department_login" element={<DepartmentLoginRoute />} />
      <Route path="/department_register" element={<DepartmentRegisterRoute />} />
      <Route path="/admin/forgot" element={<AdminForgot />} />
      <Route path="/department/forgot" element={<DepartmentForgot />} />
      <Route path="/department/account" element={<DepartmentAccountPage />} />
      <Route path="/developer/login" element={<DeveloperLogin />} />

      <Route path="/complaints" element={<ComplaintsPage />} />
      <Route path="/complaints/:id" element={<ComplaintDetailPage />} />
      <Route path="/queries" element={<QueriesPage />} />
      <Route path="/queries/:id" element={<QueryDetailPage />} />
      <Route path="/feedback" element={<FeedbackPage />} />

      <Route path="/department/complaints" element={<ComplaintsPage mode="department" />} />
      <Route path="/department/queries" element={<QueriesPage mode="department" />} />
      <Route path="/department/feedback" element={<FeedbackPage mode="department" />} />

      <Route
        path="/admin/complaints"
        element={(
          <AdminOnlyRoute>
            <ComplaintsPage mode="admin" />
          </AdminOnlyRoute>
        )}
      />
      <Route
        path="/admin/complaints/:id"
        element={(
          <AdminOnlyRoute>
            <ComplaintDetailPage mode="admin" />
          </AdminOnlyRoute>
        )}
      />
      <Route
        path="/admin/queries"
        element={(
          <AdminOnlyRoute>
            <QueriesPage mode="admin" />
          </AdminOnlyRoute>
        )}
      />
      <Route
        path="/admin/queries/:id"
        element={(
          <AdminOnlyRoute>
            <QueryDetailPage mode="admin" />
          </AdminOnlyRoute>
        )}
      />
      <Route
        path="/admin/feedback"
        element={(
          <AdminOnlyRoute>
            <FeedbackPage mode="admin" />
          </AdminOnlyRoute>
        )}
      />
      <Route
        path="/admin/account"
        element={(
          <AdminOnlyRoute>
            <AdminAccountPage />
          </AdminOnlyRoute>
        )}
      />
      <Route
        path="/admin/notices"
        element={(
          <AdminOnlyRoute>
            <NoticesPage mode="admin" />
          </AdminOnlyRoute>
        )}
      />

      <Route
        path="/developer/complaints"
        element={(
          <DeveloperRoute>
            <ComplaintsPage mode="developer" />
          </DeveloperRoute>
        )}
      />
      <Route
        path="/developer/complaints/:id"
        element={(
          <DeveloperRoute>
            <ComplaintDetailPage mode="developer" />
          </DeveloperRoute>
        )}
      />
      <Route
        path="/developer/queries"
        element={(
          <DeveloperRoute>
            <QueriesPage mode="developer" />
          </DeveloperRoute>
        )}
      />
      <Route
        path="/developer/queries/:id"
        element={(
          <DeveloperRoute>
            <QueryDetailPage mode="developer" />
          </DeveloperRoute>
        )}
      />
      <Route
        path="/developer/feedback"
        element={(
          <DeveloperRoute>
            <FeedbackPage mode="developer" />
          </DeveloperRoute>
        )}
      />
      <Route
        path="/developer/account"
        element={(
          <DeveloperRoute>
            <DeveloperAccountPage />
          </DeveloperRoute>
        )}
      />

      <Route path="/admin/department/approve/:token" element={<AdminApproveDepartment />} />
      <Route path="/admin/hall" element={<AdminHallRoute />} />
      <Route path="/admin/booking" element={<AdminBookingRoute />} />
      <Route path="/admin/department" element={<AdminDepartmentRoute />} />
      <Route path="/admin/department/request" element={<AdminDepartmentRequestRoute />} />
      <Route path="/admin/contacts" element={<AdminContactsRoute />} />
      <Route path="/department/booking" element={<DepartmentBookingRoute />} />
      <Route path="/department/booking/history" element={<DepartmentHistoryRoute />} />
    </Routes>
  );
}

function App() {
  const dispatch = useDispatch();
  const [lightMode, setLightMode] = useState(() => readGlobalThemeMode() !== 'dark');

  useEffect(() => {
    dispatch(checkauth());
  }, [dispatch]);

  const toggleTheme = useCallback(() => {
    setLightMode((previousValue) => {
      const nextLightMode = !previousValue;
      setGlobalThemeMode(nextLightMode ? 'light' : 'dark', { updateStamp: true });
      return nextLightMode;
    });
  }, []);

  return (
    <Router>
      <AppRoutes lightMode={lightMode} toggleTheme={toggleTheme} />
      <WishYourDayOverlay />
    </Router>
  );
}

export default App;
