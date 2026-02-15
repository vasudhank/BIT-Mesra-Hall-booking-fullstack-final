import React, { useState } from 'react'
import Grid from '@mui/material/Grid';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import Person2Icon from '@mui/icons-material/Person2';
import EmailIcon from '@mui/icons-material/Email';
import LocalPhoneOutlinedIcon from '@mui/icons-material/LocalPhoneOutlined';
import { cancelDepartmentApi } from "../../../api/canceldepartmentapi";
import Modal from '@mui/material/Modal';
import Box from '@mui/material/Box';
import FormControl from '@mui/material/FormControl';
import Input from '@mui/material/Input';
import { createDepartmentApi } from "../../../api/createdepartmentapi";

export default function AdminDepartmentRequestCard(props) {

    const [modal, setmodal] = useState(false);
    const [password, setpassword] = useState('');

    const acceptRequest = () => {
        setmodal(true);
    };

    const handleClose = () => {
        setmodal(false);
        setpassword("");
    };

    const acceptDep = async (e) => {
        e.preventDefault();

        const data = {
            email: props.data.email,
            password: password,
            department: props.data.department,
            head: props.data.head,
            phone: props.data.phone
        };

        try {
            // ✅ 1. Create Department
            await createDepartmentApi(data);

            // ✅ 2. DELETE department request after approval
            await cancelDepartmentApi({ email: props.data.email });

            // ✅ 3. Refresh request list
            props.getdepartment();
        }
        catch (err) {
            console.log(err);
        }

        handleClose();
    };

    const cancelDep = async () => {
        try {
            await cancelDepartmentApi({ email: props.data.email });
            props.getdepartment();
        }
        catch (err) {
            console.log(err);
        }
    };

    return (
        <>
            <Modal
                open={modal}
                onClose={handleClose}
                aria-labelledby="modal-modal-title"
                aria-describedby="modal-modal-description"
            >
                <Box className='modal'>
                    <Typography
                        className='modal-text'
                        sx={{ marginBottom: '1rem' }}
                        variant="h6"
                        component="h2"
                    >
                        PROVIDE PASSWORD FOR DEPARTMENT
                    </Typography>

                    <form onSubmit={acceptDep}>
                        <FormControl fullWidth>
                            <Input
                                disableUnderline={true}
                                type='text'
                                placeholder="PROVIDE PASSWORD HERE"
                                required={true}
                                value={password}
                                className='admin-input'
                                onChange={(e) => setpassword(e.target.value)}
                                sx={{ padding: '1rem' }}
                            />
                        </FormControl>

                        <Button
                            size="medium"
                            fullWidth
                            className='btn-admin-hall'
                            type='submit'
                        >
                            CREATE DEPARTMENT
                        </Button>
                    </form>
                </Box>
            </Modal>

            {/* Card Content */}
            <Card sx={{ width: '100%', height: '100%' }} className='department-request-admin-card'>
                <CardContent>
                    <Typography gutterBottom variant="h5" component="div"
                        className='department-admin-request-text' sx={{ mb: 2, textAlign: 'center' }}>
                        {props.data.department}
                    </Typography>

                    <Typography variant="body2" className='department-admin-request-text' sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                        <Person2Icon sx={{ marginRight: '1rem' }} />
                        {props.data.head}
                    </Typography>

                    <Typography variant="body2" className='department-admin-request-text' sx={{ display: 'flex', alignItems: 'center' }}>
                        <EmailIcon sx={{ marginRight: '1rem' }} />
                        {props.data.email}
                    </Typography>

                    <Typography variant="body2" className='department-admin-request-text' sx={{ display: 'flex', alignItems: 'center', mt: 1 }}>
                        <LocalPhoneOutlinedIcon sx={{ marginRight: '1rem' }} />
                        {props.data.phone || "-"}
                    </Typography>
                </CardContent>

                {/* Buttons - Horizontal Layout */}
                <Box sx={{ p: 2, pt: 0 }}>
                    <Grid container spacing={2}>
                        <Grid item xs={6}>
                            <Button
                                className='btn-admin-booking-request-accept'
                                onClick={acceptRequest}
                                size="medium"
                                fullWidth
                            >
                                ACCEPT
                            </Button>
                        </Grid>
                        <Grid item xs={6}>
                            <Button
                                className='btn-admin-booking-request-reject'
                                onClick={cancelDep}
                                size="medium"
                                fullWidth
                            >
                                REJECT
                            </Button>
                        </Grid>
                    </Grid>
                </Box>
            </Card>
        </>
    );
}
