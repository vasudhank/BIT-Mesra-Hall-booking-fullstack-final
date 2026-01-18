import React, { useEffect, useState } from "react";
import {
  Container, Grid, Card, CardContent, Typography, FormControl, Input, Button,
  InputAdornment, Snackbar, Alert, Box, Divider, Avatar, Tooltip, IconButton,
  Menu, MenuItem
} from "@mui/material";
import HttpsIcon from '@mui/icons-material/Https';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import BusinessIcon from '@mui/icons-material/Business';
import PersonIcon from '@mui/icons-material/Person';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import api from '../../../api/axiosInstance';
import { Link, useNavigate, useLocation } from "react-router-dom";

// password checks
function checkPasswordStrength(pwd) {
  const checks = {
    length: pwd.length >= 8,
    lower: /[a-z]/.test(pwd),
    upper: /[A-Z]/.test(pwd),
    digit: /[0-9]/.test(pwd),
    special: /[!@#\$%\^&\*\(\)\-_=\+\[\]\{\};:'",.<>\/\\\?`~]/.test(pwd)
  };
  const passed = Object.values(checks).every(Boolean);
  return { checks, passed };
}

export default function DepartmentAccount() {
  const [email, setEmail] = useState("");
  const [deptName, setDeptName] = useState("");
  const [hodName, setHodName] = useState("");

  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [isAuth, setIsAuth] = useState(false);

  // === SETUP MODE STATE (New Feature) ===
  const [setupToken, setSetupToken] = useState(null);
  const [isSetupMode, setIsSetupMode] = useState(false);

  // readOnly flag to reduce browser autofill for current password
  const [curReadOnly, setCurReadOnly] = useState(true);

  // password visibility states (eye icons)
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // user menu (top-right)
  const [anchorElUser, setAnchorElUser] = useState(null);

  const [successOpen, setSuccessOpen] = useState(false);
  const [successMsg, setSuccessMsg] = useState("Password changed successfully");
  const [errMsg, setErrMsg] = useState("");
  const [errorOpen, setErrorOpen] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();

  // password strength state (computed)
  const pwdState = checkPasswordStrength(newPwd);

  // Helper to extract query params
  function useQuery() {
    return new URLSearchParams(location.search);
  }
  const query = useQuery();

  useEffect(() => {
    const tokenFromUrl = query.get("token");

    if (tokenFromUrl) {
      // 1. First, try to verify if this is a "Setup Token" (New Account)
      api.post("/department/verify_setup_token", { token: tokenFromUrl })
        .then((res) => {
          if (res.data && res.data.success) {
            // === It is a valid Setup Token ===
            setSetupToken(tokenFromUrl);
            setIsSetupMode(true);
            
            const d = res.data.department;
            setEmail(d.email);
            setDeptName(d.department);
            setHodName(d.head);
            // Allow them to see the form
            setIsAuth(true); 
          }
        })
        .catch(() => {
          // 2. If Setup verification fails, Fallback to your existing "Auto Login" logic
          api.post("/department/auto_login", { token: tokenFromUrl }, { withCredentials: true })
            .then((r) => {
              if (r.data && r.data.success && r.data.department) {
                // === It is a valid Auto-Login Token ===
                const d = r.data.department;
                setEmail(d.email || "");
                setDeptName(d.department || "");
                setHodName(d.head || "");
                setIsAuth(true);
                
                // Clean URL
                const newUrl = window.location.pathname;
                window.history.replaceState({}, document.title, newUrl);
              } else {
                setErrMsg(r.data?.message || "Token login failed");
                setErrorOpen(true);
                setIsAuth(false);
              }
            })
            .catch((err) => {
              const message = err.response?.data?.message || "Invalid or Expired Link";
              setErrMsg(message);
              setErrorOpen(true);
              setIsAuth(false);
            });
        });

    } else {
      // 3. No token? Check for standard session auth (/me)
      (async () => {
        try {
          const res = await api.get("/department/me", { withCredentials: true });
          if (res.data && res.data.success && res.data.department) {
            const d = res.data.department;
            setEmail(d.email || "");
            setDeptName(d.department || "");
            setHodName(d.head || "");
            setIsAuth(true);
          }
        } catch (err) {
          // Not logged in
          setEmail('');
          setDeptName('');
          setHodName('');
          setIsAuth(false);
        }
      })();
    }
  }, [location.search]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Validation: Current Password is required ONLY if NOT in Setup Mode
    if ((!isSetupMode && !currentPwd) || !newPwd || !confirmPwd) {
      setErrMsg("Please fill all fields");
      setErrorOpen(true);
      return;
    }
    if (newPwd !== confirmPwd) {
      setErrMsg("New password and confirm password do not match");
      setErrorOpen(true);
      return;
    }
    if (!pwdState.passed) {
      setErrMsg("New password does not meet the minimum requirements");
      setErrorOpen(true);
      return;
    }

    try {
      if (isSetupMode) {
        // === CASE 1: NEW ACCOUNT SETUP ===
        const res = await api.post("/department/complete_setup", {
            token: setupToken,
            newPassword: newPwd
        });
        
        if (res.data.success) {
            setSuccessMsg("Account secured! Redirecting to login...");
            setSuccessOpen(true);
            // Redirect after delay
            setTimeout(() => {
                navigate("/department_login");
            }, 2000);
        }
      } else {
        // === CASE 2: STANDARD PASSWORD CHANGE ===
        const payload = { currentPassword: currentPwd, newPassword: newPwd };
        const res = await api.post("/department/change_password", payload, { withCredentials: true });
        
        if (res.data && res.data.success) {
          setSuccessMsg("Password changed successfully");
          setSuccessOpen(true);
          setCurrentPwd("");
          setNewPwd("");
          setConfirmPwd("");
          setCurReadOnly(true);
          // hide all passwords after success
          setShowCurrent(false);
          setShowNew(false);
          setShowConfirm(false);
        } else {
          setErrMsg(res.data.message || "Failed to change password");
          setErrorOpen(true);
        }
      }
    } catch (err) {
      console.error("Change password error:", err);
      const status = err.response?.status;
      
      // Handle auth error (only relevant for standard change, not setup)
      if (status === 401 && !isSetupMode) {
        setErrMsg("Please login before changing password");
        setErrorOpen(true);
        navigate("/department_login");
        return;
      }
      setErrMsg(err.response?.data?.message || err.message || "Operation failed");
      setErrorOpen(true);
    }
  };

  // password rules list for UI (ordered)
  const passwordRules = [
    { key: 'length', text: 'At least 8 characters' },
    { key: 'lower', text: 'Lowercase letter (a–z)' },
    { key: 'upper', text: 'Uppercase letter (A–Z)' },
    { key: 'digit', text: 'Number (0–9)' },
    { key: 'special', text: 'Special character (!@#$%^&*)' },
  ];

  // user menu handlers
  const handleOpenUserMenu = (event) => setAnchorElUser(event.currentTarget);
  const handleCloseUserMenu = () => setAnchorElUser(null);

  const logout = async () => {
    try {
      await api.get("/logout", { withCredentials: true });
    } catch (err) {
      console.warn("Logout request failed:", err);
    } finally {
      handleCloseUserMenu();
      navigate("/department_login");
    }
  };

  return (
    <>
      {/* Top-right avatar/menu (Hidden during Setup Mode to prevent navigation) */}
      {!isSetupMode && (
        <Box sx={{ position: 'fixed', top: 8, right: 12, zIndex: 1400 }}>
          <Tooltip title="Open settings">
            <IconButton onClick={handleOpenUserMenu} sx={{ p: 0 }}>
              <Avatar alt="" src="" sx={{ color: 'black' }} />
            </IconButton>
          </Tooltip>

          <Menu
            sx={{ mt: '45px', color: 'white' }}
            id="menu-appbar"
            anchorEl={anchorElUser}
            anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
            keepMounted
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            open={Boolean(anchorElUser)}
            onClose={handleCloseUserMenu}
          >
            <MenuItem onClick={handleCloseUserMenu} sx={{ color: 'black' }}>
              <Link to="/" style={{ textDecoration: 'none', color: 'inherit' }}>
                <Typography textAlign="center" className="dropdown-text" sx={{ color: 'black' }}>
                  HOME
                </Typography>
              </Link>
            </MenuItem>

            <MenuItem onClick={handleCloseUserMenu} sx={{ color: 'black' }}>
              <Link to="/department/booking" style={{ textDecoration: 'none', color: 'inherit' }}>
                <Typography textAlign="center" className="dropdown-text" sx={{ color: 'black' }}>
                  DEPARTMENT
                </Typography>
              </Link>
            </MenuItem>

            <MenuItem onClick={() => { handleCloseUserMenu(); logout(); }} sx={{ color: 'black' }}>
              <Typography textAlign="center" className="dropdown-text" sx={{ color: 'black' }}>
                LOGOUT
              </Typography>
            </MenuItem>
          </Menu>
        </Box>
      )}

      <Container sx={{ mt: 8 }}> {/* pushed down so menu/avatar doesn't overlap content */}
        <Grid container justifyContent="center">
          <Grid item xs={11} sm={8} md={6} lg={5}>
            <Card>
              <CardContent>
                <Typography variant="h5" sx={{ mb: 2 }}>
                  {isSetupMode ? "Secure Your Account" : "Account"}
                </Typography>

                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                  <AccountCircleIcon sx={{ fontSize: 40, mr: 1, color: isSetupMode ? '#1976d2' : 'inherit' }} />
                  <Box>
                    <Typography variant="subtitle1">{email || "—"}</Typography>
                    <Typography variant="caption" color="text.secondary">Logged-in email</Typography>
                  </Box>
                </Box>

                <Divider sx={{ my: 2 }} />

                <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <BusinessIcon />
                    <Box>
                      <Typography variant="body2">{deptName || '—'}</Typography>
                      <Typography variant="caption" color="text.secondary">Department</Typography>
                    </Box>
                  </Box>

                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <PersonIcon />
                    <Box>
                      <Typography variant="body2">{hodName || '—'}</Typography>
                      <Typography variant="caption" color="text.secondary">Head of Department</Typography>
                    </Box>
                  </Box>
                </Box>

                <Divider sx={{ my: 2 }} />

                <Typography variant="h6" sx={{ mb: 1 }}>
                  {isSetupMode ? "Set New Password" : "Change password"}
                </Typography>

                {!isAuth && !isSetupMode && (
                  <Box sx={{ mb: 2 }}>
                    <Alert severity="info">You must log in to change this account's password. <Link to="/department_login">Login</Link></Alert>
                  </Box>
                )}

                {(isAuth || isSetupMode) && (
                  <form onSubmit={handleSubmit} autoComplete="off" noValidate>
                    <input type="hidden" name="fakeusernameremembered" />

                    {/* Show Current Password Field ONLY if NOT in Setup Mode */}
                    {!isSetupMode && (
                        <FormControl fullWidth sx={{ mb: 2 }}>
                        <Input
                            name="cur_pass_field"
                            disableUnderline
                            placeholder="Current password"
                            type={showCurrent ? "text" : "password"}
                            value={currentPwd}
                            onChange={(e) => setCurrentPwd(e.target.value)}
                            startAdornment={<InputAdornment position="start"><HttpsIcon /></InputAdornment>}
                            endAdornment={
                            <InputAdornment position="end">
                                <IconButton
                                aria-label="toggle current password visibility"
                                onClick={() => setShowCurrent(s => !s)}
                                edge="end"
                                size="small"
                                >
                                {showCurrent ? <VisibilityOff /> : <Visibility />}
                                </IconButton>
                            </InputAdornment>
                            }
                            inputProps={{ autoComplete: "off" }}
                            sx={{ padding: "1rem" }}
                            required
                            readOnly={curReadOnly}
                            onFocus={() => {
                            setCurReadOnly(false);
                            setCurrentPwd('');
                            }}
                        />
                        </FormControl>
                    )}

                    <FormControl fullWidth sx={{ mb: 1 }}>
                      <Input
                        name="new_pass_field"
                        disableUnderline
                        placeholder={isSetupMode ? "Create new password" : "New password"}
                        type={showNew ? "text" : "password"}
                        value={newPwd}
                        onChange={(e) => setNewPwd(e.target.value)}
                        startAdornment={<InputAdornment position="start"><HttpsIcon /></InputAdornment>}
                        endAdornment={
                          <InputAdornment position="end">
                            <IconButton
                              aria-label="toggle new password visibility"
                              onClick={() => setShowNew(s => !s)}
                              edge="end"
                              size="small"
                            >
                              {showNew ? <VisibilityOff /> : <Visibility />}
                            </IconButton>
                          </InputAdornment>
                        }
                        inputProps={{ autoComplete: "new-password" }}
                        sx={{ padding: "1rem" }}
                        required
                      />
                    </FormControl>

                    <Box sx={{ mb: 2 }}>
                      <Typography variant="body2" sx={{ mb: 1 }}>Password requirements:</Typography>
                      <Box component="ul" sx={{ pl: 0, m: 0 }}>
                        {passwordRules.map(rule => {
                          const ok = pwdState.checks[rule.key];
                          return (
                            <Box key={rule.key} component="li" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.6, listStyle: 'none' }}>
                              {ok ? (
                                <CheckCircleIcon sx={{ color: 'green', fontSize: 18 }} />
                              ) : (
                                <RadioButtonUncheckedIcon sx={{ color: 'rgba(0,0,0,0.3)', fontSize: 18 }} />
                              )}
                              <Typography variant="body2" sx={{ color: ok ? 'green' : 'inherit' }}>{rule.text}</Typography>
                            </Box>
                          );
                        })}
                      </Box>
                    </Box>

                    <FormControl fullWidth sx={{ mb: 2 }}>
                      <Input
                        name="conf_new_pass_field"
                        disableUnderline
                        placeholder="Confirm new password"
                        type={showConfirm ? "text" : "password"}
                        value={confirmPwd}
                        onChange={(e) => setConfirmPwd(e.target.value)}
                        startAdornment={<InputAdornment position="start"><HttpsIcon /></InputAdornment>}
                        endAdornment={
                          <InputAdornment position="end">
                            <IconButton
                              aria-label="toggle confirm password visibility"
                              onClick={() => setShowConfirm(s => !s)}
                              edge="end"
                              size="small"
                            >
                              {showConfirm ? <VisibilityOff /> : <Visibility />}
                            </IconButton>
                          </InputAdornment>
                        }
                        inputProps={{ autoComplete: "new-password" }}
                        sx={{ padding: "1rem" }}
                        required
                      />
                    </FormControl>

                    <Button fullWidth type="submit" variant="contained" sx={{ py: 1 }}>
                        {isSetupMode ? "SECURE ACCOUNT & LOGIN" : "Change password"}
                    </Button>
                  </form>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </Container>

      <Snackbar open={successOpen} autoHideDuration={3000} onClose={() => setSuccessOpen(false)}>
        <Alert severity="success" onClose={() => setSuccessOpen(false)}>{successMsg}</Alert>
      </Snackbar>
      <Snackbar open={errorOpen} autoHideDuration={4000} onClose={() => setErrorOpen(false)}>
        <Alert severity="error" onClose={() => setErrorOpen(false)}>{errMsg}</Alert>
      </Snackbar>
    </>
  );
}