import './App.css';
import React, { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { checkauth } from './store/slices/userSlice';

import Home from './routes/Home';
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
const DepartmentAccount = lazy(() => import('./components/Dashboard/DepartmentAccount/DepartmentAccount'));
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
const DeveloperRoute = lazy(() => import('./routes/DeveloperRoute'));
const AdminOnlyRoute = lazy(() => import('./routes/AdminOnlyRoute'));

function App() {
  const dispatch = useDispatch();
  const [lightMode, setLightMode] = useState(() => localStorage.getItem('theme') !== 'dark');

  useEffect(() => {
    dispatch(checkauth());
  }, [dispatch]);

  useEffect(() => {
    localStorage.setItem('theme', lightMode ? 'light' : 'dark');
    if (lightMode) {
      document.body.classList.remove('dark-mode');
      document.body.classList.add('light-mode');
    } else {
      document.body.classList.remove('light-mode');
      document.body.classList.add('dark-mode');
    }
  }, [lightMode]);

  const toggleTheme = () => setLightMode(!lightMode);

  return (
    <Router>
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<Home lightMode={lightMode} toggleTheme={toggleTheme} />} />
          <Route path="/ai" element={<AIImmersive />} />
          <Route path="/about" element={<About lightMode={lightMode} toggleTheme={toggleTheme} />} />
          <Route path="/faqs" element={<FAQ lightMode={lightMode} toggleTheme={toggleTheme} />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/admin_login" element={<AdminLoginRoute />} />
          <Route path="/department_login" element={<DepartmentLoginRoute />} />
          <Route path="/department_register" element={<DepartmentRegisterRoute />} />
          <Route path="/admin/forgot" element={<AdminForgot />} />
          <Route path="/department/forgot" element={<DepartmentForgot />} />
          <Route path="/department/account" element={<DepartmentAccount />} />
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
            element={
              <AdminOnlyRoute>
                <ComplaintsPage mode="admin" />
              </AdminOnlyRoute>
            }
          />
          <Route
            path="/admin/complaints/:id"
            element={
              <AdminOnlyRoute>
                <ComplaintDetailPage mode="admin" />
              </AdminOnlyRoute>
            }
          />
          <Route
            path="/admin/queries"
            element={
              <AdminOnlyRoute>
                <QueriesPage mode="admin" />
              </AdminOnlyRoute>
            }
          />
          <Route
            path="/admin/queries/:id"
            element={
              <AdminOnlyRoute>
                <QueryDetailPage mode="admin" />
              </AdminOnlyRoute>
            }
          />
          <Route
            path="/admin/feedback"
            element={
              <AdminOnlyRoute>
                <FeedbackPage mode="admin" />
              </AdminOnlyRoute>
            }
          />
          <Route
            path="/admin/account"
            element={
              <AdminOnlyRoute>
                <AdminAccountPage />
              </AdminOnlyRoute>
            }
          />

          <Route
            path="/developer/complaints"
            element={
              <DeveloperRoute>
                <ComplaintsPage mode="developer" />
              </DeveloperRoute>
            }
          />
          <Route
            path="/developer/complaints/:id"
            element={
              <DeveloperRoute>
                <ComplaintDetailPage mode="developer" />
              </DeveloperRoute>
            }
          />
          <Route
            path="/developer/queries"
            element={
              <DeveloperRoute>
                <QueriesPage mode="developer" />
              </DeveloperRoute>
            }
          />
          <Route
            path="/developer/queries/:id"
            element={
              <DeveloperRoute>
                <QueryDetailPage mode="developer" />
              </DeveloperRoute>
            }
          />
          <Route
            path="/developer/feedback"
            element={
              <DeveloperRoute>
                <FeedbackPage mode="developer" />
              </DeveloperRoute>
            }
          />
          <Route
            path="/developer/account"
            element={
              <DeveloperRoute>
                <DeveloperAccountPage />
              </DeveloperRoute>
            }
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
    </Router>
  );
}

export default App;
