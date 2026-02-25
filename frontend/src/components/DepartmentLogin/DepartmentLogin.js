 import React, { useState, useEffect, useRef, useCallback } from 'react'

import './DepartmentLogin.css'

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

import { Link, useNavigate } from 'react-router-dom';

import HomeIcon from '@mui/icons-material/Home';

import { departmentLoginApi } from "../../api/departmentloginapi"

import { useDispatch } from 'react-redux';

import { addStatus } from '../../store/slices/userSlice';

import Alert from '@mui/material/Alert';

import Snackbar from '@mui/material/Snackbar';


export default function DepartmentLogin() {


  const [open, setOpen] = useState(false);

  const navigate = useNavigate();

  const dispatch = useDispatch();


  const [email, setEmail] = useState("");

  const [password, setPassword] = useState("");
  const loginInFlightRef = useRef(false);
  const lastAutoFailedKeyRef = useRef('');
  const emailInputRef = useRef(null);
  const passwordInputRef = useRef(null);

  const syncInputsFromDom = useCallback(() => {
    const domEmail = emailInputRef.current?.value ?? '';
    const domPassword = passwordInputRef.current?.value ?? '';
    setEmail((prev) => (prev === domEmail ? prev : domEmail));
    setPassword((prev) => (prev === domPassword ? prev : domPassword));
  }, []);


  const handleClose = (_, reason) => {

    if (reason === 'clickaway') return;

    setOpen(false);

  };


  const performLogin = useCallback(async ({ showError = false, clearPasswordOnFail = false } = {}) => {
    const normalizedEmail = String(emailInputRef.current?.value ?? email).trim().toLowerCase();
    const loginPassword = String(passwordInputRef.current?.value ?? password);
    const attemptKey = `${normalizedEmail}::${loginPassword}`;

    if (!normalizedEmail || !loginPassword) return false;
    if (loginInFlightRef.current) return false;
    if (!showError && lastAutoFailedKeyRef.current === attemptKey) return false;

    loginInFlightRef.current = true;
    try {
      const response = await departmentLoginApi({ email: normalizedEmail, password: loginPassword });

      if (!response?.data?.error) {
        lastAutoFailedKeyRef.current = '';
        dispatch(addStatus("Department"))
        navigate("/department/booking")
        return true;
      } else {
        lastAutoFailedKeyRef.current = attemptKey;
        if (showError) setOpen(true)
        if (clearPasswordOnFail) setPassword('')
        return false;
      }
    } catch (_) {
      lastAutoFailedKeyRef.current = attemptKey;
      if (showError) setOpen(true)
      if (clearPasswordOnFail) setPassword('')
      return false;
    } finally {
      loginInFlightRef.current = false;
    }
  }, [email, password, dispatch, navigate]);

  const handleSubmit = async (e) => {

    e.preventDefault()

    await performLogin({ showError: true, clearPasswordOnFail: true });

  }

  useEffect(() => {
    syncInputsFromDom();
    let ticks = 0;
    const syncInterval = setInterval(() => {
      syncInputsFromDom();
      ticks += 1;
      if (ticks >= 80) clearInterval(syncInterval);
    }, 125);

    const handleWindowFocus = () => syncInputsFromDom();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') syncInputsFromDom();
    };

    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(syncInterval);
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [syncInputsFromDom]);

  useEffect(() => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) return;
    if (!/\S+@\S+\.\S+/.test(normalizedEmail)) return;

    const timeoutId = setTimeout(() => {
      performLogin({ showError: false, clearPasswordOnFail: false });
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [email, password, performLogin]);


  return (

    <>

      <Snackbar open={open} autoHideDuration={3000} onClose={handleClose}

        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}>

        <Alert onClose={handleClose} severity="warning" sx={{ background: '#d32f2f', color: '#fff' }}>
          Incorrect email/password entered

        </Alert>

      </Snackbar>


      <div className='department-login-body'>

        <Grid container justifyContent="center" alignItems="center" style={{ height: "100%" }}>

          <Grid item xs={11} sm={8} md={6} lg={5} xl={4}>


            <Card className="login-card glass">

              <CardContent>


                <Typography variant="h4" className="login-title">

                  FACULTY

                </Typography>

                <div className="divider" />


                <form onSubmit={handleSubmit}>


                  <div className="input-group">

                    <FormControl fullWidth>

                      <Input
                        inputRef={emailInputRef}

                        value={email}

                        onChange={(e) => setEmail(e.target.value)}
                        onInput={(e) => setEmail(e.target.value)}
                        onFocus={syncInputsFromDom}

                        disableUnderline

                        type="email"

                        placeholder="Email address"

                        required

                        className="login-input"

                        startAdornment={

                          <InputAdornment position="start">

                            <EmailIcon />

                          </InputAdornment>

                        }

                        inputProps={{
                          autoComplete: "email",

                          style: {

                            padding: "0",

                            height: "100%",

                            display: "flex",

                            alignItems: "center",

                            marginTop: "11px"

                          },

                        }}

                      />


                    </FormControl>

                  </div>


                  <div className="input-group">

                    <FormControl fullWidth>

                      <Input
                        inputRef={passwordInputRef}

                        value={password}

                        onChange={(e) => setPassword(e.target.value)}
                        onInput={(e) => setPassword(e.target.value)}
                        onFocus={syncInputsFromDom}

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
                          autoComplete: "current-password",

                          style: {

                            padding: "0",

                            height: "100%",

                            display: "flex",

                            alignItems: "center",

                            marginTop: "11px"

                          },

                        }}

                      />


                    </FormControl>

                  </div>


                  <Button type="submit" fullWidth className="login-btn">

                    Login Here

                  </Button>


                  <div className="forgot-wrap">

                    <Link to="/department/forgot" className="forgot-link">

                      Forgot password?

                    </Link>

                  </div>


                  <Button fullWidth className="home-btn" disableRipple>

                    <Link to="/" className="home-link">

                      <HomeIcon sx={{ mr: 1 }} />

                      HOME

                    </Link>

                  </Button>


                  <Button fullWidth className="register-btn" disableRipple>

                    <Link to="/department_register" className="register-link">

                      REQUEST YOUR FACULTY ACCOUNT HERE

                    </Link>

                  </Button>


                </form>


              </CardContent>

            </Card>


          </Grid>

        </Grid>

      </div>

    </>

  )

} 
