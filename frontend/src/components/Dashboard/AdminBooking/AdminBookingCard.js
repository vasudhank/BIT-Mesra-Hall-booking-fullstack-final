import React, { useState } from 'react';
import Grid from '@mui/material/Grid';
import Button from '@mui/material/Button';
import Modal from '@mui/material/Modal';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import "./AdminBooking.css";
import { changeBookingRequestApi } from "../../../api/changebookingrequestapi";

export default function AdminBookingCard(props) {
  const [descModal, setDescModal] = useState(false);
  const id = props.data._id;

  const formatDate = (d) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  const acceptRequest = async () => {
    try {
      await changeBookingRequestApi({
        decision: "Yes", id, name: props.data.hall,
        department: props.data.department.department, event: props.data.event
      });
      props.getrequest();
    } catch (err) { console.log(err); }
  };

  const cancelRequest = async () => {
    try {
      await changeBookingRequestApi({ decision: "No", id });
      props.getrequest();
    } catch (err) { console.log(err); }
  };

  return (
    <div className='request-div-admin'>
      <h2 className='admin-booking-request-title'>{props.data.hall}</h2>

      <div className='admin-booking-request-desc-div'>
        <span className='admin-booking-dept-name'>{props.data.department.department}</span>
        <span className='admin-booking-event-name'>"{props.data.event}"</span>
        
        {/* Date and Time Range Display */}
        <div className='admin-booking-datetime-range'>
            <p>{formatDate(props.data.startDate)} — {formatDate(props.data.endDate)}</p>
            <p className='time-range'>{props.data.startTime12} to {props.data.endTime12}</p>
        </div>

        <Button 
            startIcon={<InfoOutlinedIcon />}
            onClick={() => setDescModal(true)}
            sx={{ color: '#00d4ff', fontSize: '0.75rem', mt: 1, textTransform: 'none' }}
        >
            View Description
        </Button>
      </div>

      <Grid container spacing={1} justifyContent={'center'} sx={{ px: 2, pb: 2 }}>
        <Grid item xs={6}>
          <Button size="small" className='btn-admin-booking-request-accept' onClick={acceptRequest} fullWidth>
            ACCEPT
          </Button>
        </Grid>
        <Grid item xs={6}>
          <Button size="small" className='btn-admin-booking-request-reject' onClick={cancelRequest} fullWidth>
            REJECT
          </Button>
        </Grid>
      </Grid>

      {/* Description Modal */}
      <Modal open={descModal} onClose={() => setDescModal(false)}>
        <Box sx={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          width: { xs: '85%', sm: '400px' }, bgcolor: '#1B2033', border: '1px solid #303C5C',
          boxShadow: 24, p: 3, borderRadius: '15px', color: 'white', outline: 'none'
        }}>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
            <Typography variant="h6" sx={{ fontFamily: 'RecklessNeue', color: '#ff7b00' }}>Event Description</Typography>
            <IconButton onClick={() => setDescModal(false)} sx={{ color: 'white' }}>
              <CloseIcon />
            </IconButton>
          </Box>
          <Typography sx={{ 
            fontFamily: 'Inter', fontSize: '0.95rem', lineHeight: 1.6, 
            maxHeight: '300px', overflowY: 'auto', pr: 1,
            '&::-webkit-scrollbar': { width: '5px' },
            '&::-webkit-scrollbar-thumb': { backgroundColor: '#303C5C', borderRadius: '10px' }
          }}>
            {props.data.description || "No description provided for this event."}
          </Typography>
        </Box>
      </Modal>
    </div>
  );
}