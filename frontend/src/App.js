import './App.css';
import React, { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { BrowserRouter as Router, Route, Routes, useLocation } from 'react-router-dom';
import { useDispatch } from 'react-redux';

import { checkauth } from './store/slices/userSlice';
import {
  THEME_SYNC_EVENT,
  applyThemeToBody,
  readGlobalThemeMode,
  resolveEffectiveThemeMode,
  setGlobalThemeMode,
  setPageThemeMode
} from './utils/themeModeScope';

const Home = lazy(() => import('./routes/Home'));
const About = lazy(() => import('./routes/About'));
const FAQ = lazy(() => import('./routes/FAQ'));
const AdminLoginRoute = lazy(() => import('./routes/AdminLoginRoute'));
const DepartmentLoginRoute = lazy(() => import('./routes/DepartmentLoginRoute'));
const DepartmentRegisterRoute = lazy(() => import('./routes/DepartmentRegisterRoute'));
const AdminHallRoute = lazy(() => import('./routes/AdminHallRoute'));
const AdminBookingRoute = lazy(() => import('./routes/AdminBookingRoute'));
const AdminDepartmentRoute = lazy(() => import('./routes/AdminDepartmentRoute'));
const AdminDepartmentRequestRoute = lazy(() => import('./routes/AdminDepartmentRequestRoute'));
const AdminContactsRoute = lazy(() => import('./routes/AdminContactsRoute'));
const DepartmentBookingRoute = lazy(() => import('./routes/DepartmentBookingRoute'));
const DepartmentHistoryRoute = lazy(() => import('./routes/DepartmentHistoryRoute'));
const DepartmentAccountPage = lazy(() => import('./pages/DepartmentAccountPage'));
const Schedule = lazy(() => import('./components/Schedule/Schedule'));
const DepartmentForgot = lazy(() => import('./components/DepartmentForgot/DepartmentForgot'));
const AdminForgot = lazy(() => import('./components/AdminForgot/AdminForgot'));
const AIImmersive = lazy(() => import('./pages/AIImmersive'));
const AdminApproveDepartment = lazy(() => import('./components/AdminApproveDepartment/AdminApproveDepartment'));
const DeveloperLogin = lazy(() => import('./components/DeveloperLogin/DeveloperLogin'));
const ComplaintsPage = lazy(() => import('./pages/ComplaintsPage'));
const ComplaintDetailPage = lazy(() => import('./pages/ComplaintDetailPage'));
const QueriesPage = lazy(() => import('./pages/QueriesPage'));
const QueryDetailPage = lazy(() => import('./pages/QueryDetailPage'));
const FeedbackPage = lazy(() => import('./pages/FeedbackPage'));
const AdminAccountPage = lazy(() => import('./pages/AdminAccountPage'));
const DeveloperAccountPage = lazy(() => import('./pages/DeveloperAccountPage'));
const DeveloperMonitoringPage = lazy(() => import('./pages/DeveloperMonitoringPage'));
const NoticesPage = lazy(() => import('./pages/NoticesPage'));
const NoticeDetailPage = lazy(() => import('./pages/NoticeDetailPage'));
const CalendarPage = lazy(() => import('./pages/CalendarPage'));
const DeveloperRoute = lazy(() => import('./routes/DeveloperRoute'));
const AdminOnlyRoute = lazy(() => import('./routes/AdminOnlyRoute'));
const TrashPage = lazy(() => import('./pages/TrashPage'));
const WishYourDayOverlay = lazy(() => import('./components/Contacts/WishYourDayOverlay'));

function RouteFallback() {
  return (
    <div className="app-route-loading" role="status" aria-live="polite">
      Loading...
    </div>
  );
}

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
    <Suspense fallback={<RouteFallback />}>
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
        <Route
          path="/developer/monitoring"
          element={(
            <DeveloperRoute>
              <DeveloperMonitoringPage />
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
    </Suspense>
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
      <Suspense fallback={null}>
        <WishYourDayOverlay />
      </Suspense>
    </Router>
  );
}

export default App;
