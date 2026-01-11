// frontend/src/App.js
import './App.css';
import React, { useEffect } from "react";  
import {
  BrowserRouter as Router,
  Route,
  Routes,
} from "react-router-dom";

import Home from './routes/Home';
import AdminLoginRoute from './routes/AdminLoginRoute';
import DepartmentAccount from './components/Dashboard/DepartmentAccount/DepartmentAccount';
import DepartmentLoginRoute from './routes/DepartmentLoginRoute';
import DepartmentRegisterRoute from './routes/DepartmentRegisterRoute';
import AdminHallRoute from './routes/AdminHallRoute';
import AdminBookingRoute from './routes/AdminBookingRoute';
import AdminDepartmentRoute from './routes/AdminDepartmentRoute';
import AdminDepartmentRequestRoute from './routes/AdminDepartmentRequestRoute';
import DepartmentBookingRoute from './routes/DepartmentBookingRoute';
import DepartmentHistoryRoute from './routes/DepartmentHistoryRoute';
import Schedule from './components/Schedule/Schedule.js';
import DepartmentForgot from './components/DepartmentForgot/DepartmentForgot';

// ✅ NEW: Forgot password page
import AdminForgot from './components/AdminForgot/AdminForgot';

import { checkauth } from './store/slices/userSlice';
import { useSelector, useDispatch } from 'react-redux';

function App() {
  const dispatch = useDispatch();
  const user = useSelector((state)=> state.user);
  
  useEffect(() => {
    dispatch(checkauth());
  }, [user.status, dispatch]);

  return (
    <>
      <Router>
        <Routes>
          {/* Public routes */}
          <Route exact path="/" element={<Home/>} />
          <Route path="/schedule" element={<Schedule />} />
          <Route exact path="/admin/forgot" element={<AdminForgot />} /> {/* ✅ NEW */}
          <Route exact path="/department/account" element={<DepartmentAccount/>} />
          <Route exact path="/department/forgot" element={<DepartmentForgot />} />

          {(user.status === "Authenticated") && (
            <>
              {/* Admin routes */}
              {user.user === 'Admin' && (
                <>
                  <Route exact path="/admin/hall" element={<AdminHallRoute/>} />
                  <Route exact path="/admin/booking" element={<AdminBookingRoute/>} />
                  <Route exact path="/admin/department" element={<AdminDepartmentRoute/>} />
                  <Route exact path="/admin/department/request" element={<AdminDepartmentRequestRoute/>} />
                  <Route exact path="/department_login" element={<DepartmentLoginRoute/>} />
                  <Route exact path="/department_register" element={<DepartmentRegisterRoute/>} />
                </>
              )}

              {/* Department routes */}
              {user.user === 'Department' && (
                <>
                  <Route exact path="/admin_login" element={<AdminLoginRoute/>} />
                  <Route exact path="/department/booking" element={<DepartmentBookingRoute/>} />
                  <Route exact path="/department/booking/history" element={<DepartmentHistoryRoute/>} />
                </>
              )}
            </>
          )}

          {(user.status === "Not Authenticated") && (
            <>
              <Route exact path="/admin_login" element={<AdminLoginRoute/>} />
              <Route exact path="/department_login" element={<DepartmentLoginRoute/>} />
              <Route exact path="/department_register" element={<DepartmentRegisterRoute/>} />
            </>
          )}
        </Routes>
      </Router>
    </>
  );
}

export default App;
