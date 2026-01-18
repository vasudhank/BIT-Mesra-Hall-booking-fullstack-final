import React, { useState } from 'react'
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

  const handleClose = (_, reason) => {
    if (reason === 'clickaway') return;
    setOpen(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault()
    const response = await departmentLoginApi({ email, password });
    if (!response.data.error) {
      dispatch(addStatus("Department"))
      navigate("/department/booking")
    } else {
      setOpen(true)
      setPassword('')
    }
  }

  return (
    <>
      <Snackbar open={open} autoHideDuration={3000} onClose={handleClose}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}>
        <Alert onClose={handleClose} severity="warning" sx={{ background: '#d32f2f', color: '#fff' }}>
          Incorrect Username/Password
        </Alert>
      </Snackbar>

      <div className='department-login-body'>
        <Grid container justifyContent="center" alignItems="center" style={{ height: "100%" }}>
          <Grid item xs={11} sm={8} md={6} lg={5} xl={4}>

            <Card className="login-card glass">
              <CardContent>

                <Typography variant="h4" className="login-title">
                  DEPARTMENT
                </Typography>
                <div className="divider" />

                <form onSubmit={handleSubmit}>

                  <div className="input-group">
                    <FormControl fullWidth>
                      <Input
  value={email}
  onChange={(e) => setEmail(e.target.value)}
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
  value={password}
  onChange={(e) => setPassword(e.target.value)}
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
                      <HomeIcon sx={{ mr: 1 }}/>
                      HOME
                    </Link>
                  </Button>

                  <Button fullWidth className="register-btn" disableRipple>
                    <Link to="/department_register" className="register-link">
                      REQUEST YOUR DEPARTMENT HERE
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
