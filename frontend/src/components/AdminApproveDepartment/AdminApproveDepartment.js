import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../api/axiosInstance';
import {
    Container, Grid, Card, CardContent, Typography, FormControl, 
    Input, Button, Backdrop, CircularProgress, Alert
} from '@mui/material';
import Person2Icon from '@mui/icons-material/Person2';
import EmailIcon from '@mui/icons-material/Email';
import SchoolIcon from '@mui/icons-material/School';
import KeyIcon from '@mui/icons-material/Key';
import InputAdornment from '@mui/material/InputAdornment';

import { createDepartmentApi } from "../../api/createdepartmentapi"; // Ensure this uses the modified backend logic

export default function AdminApproveDepartment() {
    const { token } = useParams();
    const navigate = useNavigate();

    const [loading, setLoading] = useState(true);
    const [requestData, setRequestData] = useState(null);
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    useEffect(() => {
        // Verify Token on Load
        api.post('/department/verify_action_token', { token })
            .then(res => {
                if (res.data.success) {
                    setRequestData(res.data.request);
                }
            })
            .catch(err => {
                setError(err.response?.data?.message || 'Invalid or Expired Link');
            })
            .finally(() => setLoading(false));
    }, [token]);

    const handleCreateSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        const data = {
            email: requestData.email,
            password: password,
            department: requestData.department,
            head: requestData.head,
            actionToken: token // Pass token to authorize without login
        };

        try {
            await createDepartmentApi(data);
            setSuccess(true);
            setTimeout(() => {
                navigate('/admin_login'); // Redirect to login or home after success
            }, 3000);
        } catch (err) {
            console.log(err);
            setError('Failed to create department. It might already exist.');
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <Backdrop sx={{ color: '#fff', zIndex: 9999 }} open={true}>
                <CircularProgress color="inherit" />
            </Backdrop>
        );
    }

    if (error) {
        return (
            <Container sx={{ mt: 10, textAlign: 'center' }}>
                <Alert severity="error" sx={{ justifyContent: 'center' }}>{error}</Alert>
            </Container>
        );
    }

    if (success) {
        return (
            <Container sx={{ mt: 10, textAlign: 'center' }}>
                <Alert severity="success" sx={{ justifyContent: 'center' }}>
                    Department Created Successfully! Redirecting...
                </Alert>
            </Container>
        );
    }

    return (
        <div style={{ backgroundColor: '#f4f6f8', minHeight: '100vh', paddingTop: '50px' }}>
            <Container maxWidth="sm">
                <Card sx={{ boxShadow: 3, borderRadius: 2 }}>
                    <CardContent sx={{ p: 4 }}>
                        <Typography variant="h5" sx={{ fontWeight: 'bold', mb: 1, textAlign: 'center', fontFamily: 'RecklessNeue' }}>
                            APPROVE DEPARTMENT
                        </Typography>
                        <Typography variant="body2" sx={{ mb: 4, textAlign: 'center', color: 'text.secondary' }}>
                            Set a password to create the account.
                        </Typography>

                        {/* Details View */}
                        <div style={{ background: '#f9fafb', padding: '15px', borderRadius: '8px', marginBottom: '20px' }}>
                            <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                                <SchoolIcon sx={{ mr: 1, fontSize: 20, color: '#666' }} />
                                <b>{requestData.department}</b>
                            </Typography>
                            <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                                <Person2Icon sx={{ mr: 1, fontSize: 20, color: '#666' }} />
                                {requestData.head}
                            </Typography>
                            <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center' }}>
                                <EmailIcon sx={{ mr: 1, fontSize: 20, color: '#666' }} />
                                {requestData.email}
                            </Typography>
                        </div>

                        <form onSubmit={handleCreateSubmit}>
                            <FormControl fullWidth sx={{ mb: 3 }}>
                                <Input
                                    disableUnderline={true}
                                    type='text'
                                    placeholder="Set Initial Password"
                                    required={true}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    startAdornment={
                                        <InputAdornment position="start">
                                            <KeyIcon />
                                        </InputAdornment>
                                    }
                                    sx={{
                                        border: '1px solid #ddd',
                                        borderRadius: '4px',
                                        padding: '10px'
                                    }}
                                />
                            </FormControl>

                            <Button 
                                size="large" 
                                fullWidth 
                                variant="contained" 
                                type='submit'
                                sx={{ backgroundColor: '#1976d2', fontWeight: 'bold' }}
                            >
                                CREATE DEPARTMENT
                            </Button>
                        </form>
                    </CardContent>
                </Card>
            </Container>
        </div>
    );
}