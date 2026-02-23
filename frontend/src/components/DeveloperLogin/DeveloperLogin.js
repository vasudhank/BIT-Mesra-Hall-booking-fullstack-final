import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { addStatus } from '../../store/slices/userSlice';
import { developerLogin, developerResetPassword, developerSendOtp } from '../../api/developerAuthApi';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Grid from '@mui/material/Grid';
import FormControl from '@mui/material/FormControl';
import Input from '@mui/material/Input';
import InputAdornment from '@mui/material/InputAdornment';
import EmailIcon from '@mui/icons-material/Email';
import HttpsIcon from '@mui/icons-material/Https';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import HomeIcon from '@mui/icons-material/Home';
import './DeveloperLogin.css';

export default function DeveloperLogin() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const auth = useSelector((state) => state.user);
  const [mode, setMode] = useState('login');
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [resetForm, setResetForm] = useState({ email: '', otp: '', password: '' });

  useEffect(() => {
    if (auth.status === 'Authenticated' && String(auth.user || '').toLowerCase() === 'developer') {
      navigate('/developer/complaints', { replace: true });
    }
  }, [auth.status, auth.user, navigate]);

  const doLogin = async (e) => {
    e.preventDefault();
    try {
      await developerLogin(loginForm);
      dispatch(addStatus('Developer'));
      navigate('/developer/complaints');
    } catch (err) {
      alert(err?.response?.data?.error || 'Login failed');
    }
  };

  const sendOtp = async () => {
    try {
      await developerSendOtp({ email: resetForm.email });
      alert('OTP sent to developer email.');
    } catch (err) {
      alert(err?.response?.data?.msg || err?.response?.data?.error || 'Failed to send OTP');
    }
  };

  const resetPassword = async (e) => {
    e.preventDefault();
    try {
      await developerResetPassword(resetForm);
      alert('Password reset successful. Please login.');
      setMode('login');
      setLoginForm((prev) => ({ ...prev, email: resetForm.email }));
      setResetForm({ email: '', otp: '', password: '' });
    } catch (err) {
      alert(err?.response?.data?.msg || err?.response?.data?.error || 'Reset failed');
    }
  };

  return (
    <div className="developer-login-body">
      <Grid container justifyContent="center" alignItems="center" style={{ height: '100%' }}>
        <Grid item xs={11} sm={8} md={6} lg={5} xl={4}>
          <Card className="login-card glass developer-login-card">
            <CardContent>
              <Typography variant="h4" className="login-title">
                DEVELOPER
              </Typography>
              <div className="divider" />

              <div className="developer-login-tabs">
                <button
                  type="button"
                  className={`developer-tab-btn ${mode === 'login' ? 'active' : ''}`}
                  onClick={() => setMode('login')}
                >
                  Login
                </button>
                <button
                  type="button"
                  className={`developer-tab-btn ${mode === 'reset' ? 'active' : ''}`}
                  onClick={() => setMode('reset')}
                >
                  Forgot Password
                </button>
              </div>

              {mode === 'login' ? (
                <form onSubmit={doLogin} autoComplete="off">
                  <div className="input-group">
                    <FormControl fullWidth>
                      <Input
                        autoComplete="off"
                        value={loginForm.email}
                        onChange={(e) => setLoginForm((prev) => ({ ...prev, email: e.target.value }))}
                        disableUnderline
                        type="email"
                        placeholder="Developer Email"
                        required
                        className="login-input"
                        startAdornment={
                          <InputAdornment position="start">
                            <EmailIcon />
                          </InputAdornment>
                        }
                        inputProps={{
                          style: {
                            padding: 0,
                            height: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            marginTop: '11px'
                          }
                        }}
                      />
                    </FormControl>
                  </div>

                  <div className="input-group">
                    <FormControl fullWidth>
                      <Input
                        autoComplete="new-password"
                        value={loginForm.password}
                        onChange={(e) => setLoginForm((prev) => ({ ...prev, password: e.target.value }))}
                        disableUnderline
                        type="password"
                        placeholder="Password"
                        required
                        className="login-input"
                        startAdornment={
                          <InputAdornment position="start">
                            <HttpsIcon />
                          </InputAdornment>
                        }
                        inputProps={{
                          style: {
                            padding: 0,
                            height: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            marginTop: '11px'
                          }
                        }}
                      />
                    </FormControl>
                  </div>

                  <Button type="submit" fullWidth className="login-btn">
                    Login Here
                  </Button>

                  <Button fullWidth className="home-btn" disableRipple>
                    <Link to="/" className="home-link">
                      <HomeIcon sx={{ mr: 1 }} />
                      HOME
                    </Link>
                  </Button>
                </form>
              ) : (
                <form onSubmit={resetPassword} autoComplete="off">
                  <div className="input-group">
                    <FormControl fullWidth>
                      <Input
                        autoComplete="off"
                        value={resetForm.email}
                        onChange={(e) => setResetForm((prev) => ({ ...prev, email: e.target.value }))}
                        disableUnderline
                        type="email"
                        placeholder="Developer Email"
                        required
                        className="login-input"
                        startAdornment={
                          <InputAdornment position="start">
                            <EmailIcon />
                          </InputAdornment>
                        }
                        inputProps={{
                          style: {
                            padding: 0,
                            height: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            marginTop: '11px'
                          }
                        }}
                      />
                    </FormControl>
                  </div>

                  <div className="developer-otp-row">
                    <div className="input-group developer-otp-input-wrap">
                      <FormControl fullWidth>
                        <Input
                          autoComplete="off"
                          value={resetForm.otp}
                          onChange={(e) => setResetForm((prev) => ({ ...prev, otp: e.target.value }))}
                          disableUnderline
                          type="text"
                          placeholder="OTP"
                          required
                          className="login-input"
                          startAdornment={
                            <InputAdornment position="start">
                              <VpnKeyIcon />
                            </InputAdornment>
                          }
                          inputProps={{
                            style: {
                              padding: 0,
                              height: '100%',
                              display: 'flex',
                              alignItems: 'center',
                              marginTop: '11px'
                            }
                          }}
                        />
                      </FormControl>
                    </div>
                    <Button type="button" className="developer-otp-btn" onClick={sendOtp}>
                      Send OTP
                    </Button>
                  </div>

                  <div className="input-group">
                    <FormControl fullWidth>
                      <Input
                        autoComplete="new-password"
                        value={resetForm.password}
                        onChange={(e) => setResetForm((prev) => ({ ...prev, password: e.target.value }))}
                        disableUnderline
                        type="password"
                        placeholder="New Password"
                        required
                        className="login-input"
                        startAdornment={
                          <InputAdornment position="start">
                            <HttpsIcon />
                          </InputAdornment>
                        }
                        inputProps={{
                          style: {
                            padding: 0,
                            height: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            marginTop: '11px'
                          }
                        }}
                      />
                    </FormControl>
                  </div>

                  <Button type="submit" fullWidth className="login-btn">
                    Reset Password
                  </Button>

                  <Button fullWidth className="home-btn" disableRipple>
                    <Link to="/" className="home-link">
                      <HomeIcon sx={{ mr: 1 }} />
                      HOME
                    </Link>
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </div>
  );
}
