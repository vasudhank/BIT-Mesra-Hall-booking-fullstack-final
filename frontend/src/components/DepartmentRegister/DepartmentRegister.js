import React, { useState } from 'react';
import "./DepartmentRegister.css";
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Grid from '@mui/material/Grid';
import FormControl from '@mui/material/FormControl';
import Input from '@mui/material/Input';
import InputAdornment from '@mui/material/InputAdornment';
import EmailIcon from '@mui/icons-material/Email';
import SchoolIcon from '@mui/icons-material/School';
import PersonIcon from '@mui/icons-material/Person';
import LocalPhoneOutlinedIcon from '@mui/icons-material/LocalPhoneOutlined';
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined';
import Chip from '@mui/material/Chip';
import { departmentRegisterApi } from "../../api/departmentregisterapi";
import Alert from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';
import CircularProgress from '@mui/material/CircularProgress';
import HomeRoundedIcon from '@mui/icons-material/HomeRounded';
import { useNavigate } from 'react-router-dom';

export default function DepartmentRegister() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const [email, setEmail] = useState("");
  const [department, setDepartment] = useState("");
  const [head, setHead] = useState("");
  const [phone, setPhone] = useState("");

  const handleClose = (event, reason) => {
    if (reason === 'clickaway') {
      return;
    }
    setOpen(false);
    setErrorMsg("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg("");

    try {
      const response = await departmentRegisterApi({
        email,
        department,
        head,
        phone
      });

      if (!response.data.error) {
        setEmail("");
        setDepartment("");
        setHead("");
        setPhone("");
        setOpen(true);
      }
    } catch (err) {
      console.log(err);
      setErrorMsg(err?.data?.error || err?.data?.msg || "Failed to submit request. Please try again.");
      setOpen(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Snackbar
        vertical='top'
        horizontal='right'
        open={open}
        autoHideDuration={3000}
        onClose={handleClose}
      >
        <Alert
          onClose={handleClose}
          severity={errorMsg ? "error" : "success"}
          sx={{ width: '100%', background: errorMsg ? '#c62828' : '#2e7d32', color: 'white' }}
        >
          {errorMsg || "Department request sent to admin successfully!"}
        </Alert>
      </Snackbar>

      <div className='department-register-body'>
        <div className='department-register-glow department-register-glow-1' />
        <div className='department-register-glow department-register-glow-2' />

        <Grid container spacing={2} style={{ minHeight: '100%' }} alignContent={'center'} justifyContent={'center'}>
          <Grid item xs={11} sm={10} md={8} lg={6} xl={5}>
            <Card className='department-register-card'>
              <CardContent>
                <div className='department-register-chip-row'>
                  <Chip icon={<BadgeOutlinedIcon />} label="Faculty Onboarding" className='department-register-chip' />
                </div>

                <Typography gutterBottom variant="h4" component="div" className='department-card-register-title'>
                  Request Department Access
                </Typography>

                <Typography className='department-card-register-subtitle'>
                  Fill all details to send your registration request to the admin.
                </Typography>

                <form onSubmit={handleSubmit}>
                  <Grid container spacing={2.5} justifyContent={'center'} alignContent={'center'}>
                    <Grid item xs={12}>
                      <FormControl fullWidth>
                        <Input
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          disableUnderline={true}
                          type='email'
                          placeholder="Official Email ID"
                          required={true}
                          className='department-register-input'
                          startAdornment={
                            <InputAdornment position="start" sx={{ marginLeft: '0.5rem' }}>
                              <EmailIcon />
                            </InputAdornment>
                          }
                        />
                      </FormControl>
                    </Grid>

                    <Grid item xs={12}>
                      <FormControl fullWidth>
                        <Input
                          value={department}
                          onChange={(e) => setDepartment(e.target.value)}
                          disableUnderline={true}
                          type='text'
                          placeholder="Department Name"
                          required={true}
                          className='department-register-input'
                          startAdornment={
                            <InputAdornment position="start" sx={{ marginLeft: '0.5rem' }}>
                              <SchoolIcon />
                            </InputAdornment>
                          }
                        />
                      </FormControl>
                    </Grid>

                    <Grid item xs={12}>
                      <FormControl fullWidth>
                        <Input
                          value={head}
                          onChange={(e) => setHead(e.target.value)}
                          type='text'
                          placeholder="Faculty / HOD Name"
                          required={true}
                          disableUnderline={true}
                          className='department-register-input'
                          startAdornment={
                            <InputAdornment position="start" sx={{ marginLeft: '0.5rem' }}>
                              <PersonIcon />
                            </InputAdornment>
                          }
                        />
                      </FormControl>
                    </Grid>

                    <Grid item xs={12}>
                      <FormControl fullWidth>
                        <Input
                          value={phone}
                          onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 15))}
                          type='tel'
                          placeholder="Mobile Number"
                          required={true}
                          disableUnderline={true}
                          className='department-register-input'
                          inputProps={{ pattern: "[0-9]{10,15}", maxLength: 15 }}
                          startAdornment={
                            <InputAdornment position="start" sx={{ marginLeft: '0.5rem' }}>
                              <LocalPhoneOutlinedIcon />
                            </InputAdornment>
                          }
                        />
                      </FormControl>
                    </Grid>

                    <Grid item xs={12}>
                      <Button
                        size="medium"
                        type='submit'
                        className='btn-department-register-card'
                        fullWidth
                        disabled={submitting}
                      >
                        {submitting ? <CircularProgress size={22} color="inherit" /> : "SEND REQUEST"}
                      </Button>
                    </Grid>

                    <Grid item xs={12}>
                      <Typography className='department-register-note'>
                        Your request is reviewed by admin before account activation.
                      </Typography>
                    </Grid>
                  </Grid>
                </form>
              </CardContent>
            </Card>

            <div className='department-register-home-wrap'>
              <Button
                type='button'
                className='department-register-home-btn'
                startIcon={<HomeRoundedIcon />}
                onClick={() => navigate('/')}
              >
                Home
              </Button>
            </div>
          </Grid>
        </Grid>
      </div>
    </>
  );
}
