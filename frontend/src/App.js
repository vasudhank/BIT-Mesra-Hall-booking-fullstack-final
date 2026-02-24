import './App.css';
import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
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
import DepartmentAccount from './components/Dashboard/DepartmentAccount/DepartmentAccount';
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
import DeveloperRoute from './routes/DeveloperRoute';
import AdminOnlyRoute from './routes/AdminOnlyRoute';

import { checkauth } from './store/slices/userSlice';

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
    </Router>
  );
}

export default App;
