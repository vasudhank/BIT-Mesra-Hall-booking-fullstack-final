import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  changeAccountPassword,
  getAccount,
  sendAccountEmailOtp,
  updateAccountProfile,
  verifyAccountEmailOtp
} from '../api/accountApi';
import './RoleAccountPage.css';

export default function RoleAccountPage({ role = 'admin', backPath = '/', title = 'Account' }) {
  const [loading, setLoading] = useState(false);
  const [account, setAccount] = useState({
    name: '',
    email: '',
    phone: '',
    type: ''
  });
  const [profile, setProfile] = useState({ name: '', phone: '' });
  const [emailChange, setEmailChange] = useState({ newEmail: '', otp: '' });
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  const load = async () => {
    setLoading(true);
    try {
      const res = await getAccount(role);
      const acc = res?.account || {};
      setAccount(acc);
      setProfile({ name: acc.name || '', phone: acc.phone || '' });
    } catch (err) {
      alert(err?.response?.data?.error || 'Failed to load account');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  const saveProfile = async (e) => {
    e.preventDefault();
    try {
      const res = await updateAccountProfile(role, profile);
      setAccount(res.account || account);
      alert('Profile updated.');
    } catch (err) {
      alert(err?.response?.data?.error || 'Profile update failed');
    }
  };

  const sendOtp = async () => {
    try {
      await sendAccountEmailOtp(role, { newEmail: emailChange.newEmail });
      alert('OTP sent to new email.');
    } catch (err) {
      alert(err?.response?.data?.error || 'Failed to send OTP');
    }
  };

  const verifyOtp = async () => {
    try {
      const res = await verifyAccountEmailOtp(role, emailChange);
      setAccount(res.account || account);
      setEmailChange({ newEmail: '', otp: '' });
      alert('Email updated.');
    } catch (err) {
      alert(err?.response?.data?.error || 'OTP verification failed');
    }
  };

  const updatePassword = async (e) => {
    e.preventDefault();
    if (!passwordForm.currentPassword || !passwordForm.newPassword) return;
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      alert('New password and confirm password do not match.');
      return;
    }
    try {
      await changeAccountPassword(role, {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword
      });
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      alert('Password changed successfully.');
    } catch (err) {
      alert(err?.response?.data?.error || 'Password change failed');
    }
  };

  return (
    <div className="role-account-page">
      <div className="role-account-container">
        <Link className="role-account-back" to={backPath}>
          Back
        </Link>
        <h1>{title}</h1>

        {loading ? (
          <div className="role-account-card">Loading account...</div>
        ) : (
          <>
            <section className="role-account-card">
              <h2>Profile</h2>
              <div className="role-account-summary">
                <p>
                  <strong>Role:</strong> {account.type || '-'}
                </p>
                <p>
                  <strong>Email:</strong> {account.email || '-'}
                </p>
              </div>
              <form onSubmit={saveProfile} className="role-account-form">
                <input
                  type="text"
                  value={profile.name}
                  onChange={(e) => setProfile((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Name"
                />
                <input
                  type="text"
                  value={profile.phone}
                  onChange={(e) => setProfile((prev) => ({ ...prev, phone: e.target.value }))}
                  placeholder="Phone"
                />
                <button type="submit">Save Profile</button>
              </form>
            </section>

            <section className="role-account-card">
              <h2>Change Email</h2>
              <div className="role-account-form">
                <input
                  type="email"
                  value={emailChange.newEmail}
                  onChange={(e) => setEmailChange((prev) => ({ ...prev, newEmail: e.target.value }))}
                  placeholder="New Email"
                />
                <button type="button" onClick={sendOtp}>
                  Send OTP
                </button>
                <input
                  type="text"
                  value={emailChange.otp}
                  onChange={(e) => setEmailChange((prev) => ({ ...prev, otp: e.target.value }))}
                  placeholder="Enter OTP"
                />
                <button type="button" onClick={verifyOtp}>
                  Verify & Update Email
                </button>
              </div>
            </section>

            <section className="role-account-card">
              <h2>Change Password</h2>
              <form className="role-account-form" onSubmit={updatePassword}>
                <input
                  type="password"
                  value={passwordForm.currentPassword}
                  onChange={(e) => setPasswordForm((prev) => ({ ...prev, currentPassword: e.target.value }))}
                  placeholder="Current Password"
                />
                <input
                  type="password"
                  value={passwordForm.newPassword}
                  onChange={(e) => setPasswordForm((prev) => ({ ...prev, newPassword: e.target.value }))}
                  placeholder="New Password"
                />
                <input
                  type="password"
                  value={passwordForm.confirmPassword}
                  onChange={(e) => setPasswordForm((prev) => ({ ...prev, confirmPassword: e.target.value }))}
                  placeholder="Confirm New Password"
                />
                <button type="submit">Update Password</button>
              </form>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

