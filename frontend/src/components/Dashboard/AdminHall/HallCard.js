import React from 'react'
import "./AdminHall.css"
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardMedia from '@mui/material/CardMedia';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import EventSeatIcon from '@mui/icons-material/EventSeat';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'; 
import IconButton from '@mui/material/IconButton';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import api from '../../../api/axiosInstance';
import { clearHallApi } from '../../../api/clearhallapi'

/**
 * Helper: return current active booking or next upcoming booking (or null)
 */
function getCurrentOrNextBooking(bookings = []) {
  if (!bookings || bookings.length === 0) return null;

  const now = new Date();
  const normalized = bookings.map(b => ({
    ...b,
    start: b.startDateTime ? new Date(b.startDateTime) : null,
    end: b.endDateTime ? new Date(b.endDateTime) : null
  })).filter(b => b.start && b.end);

  const active = normalized.find(b => b.start <= now && b.end > now);
  if (active) return { type: 'active', booking: active };

  const upcoming = normalized
    .filter(b => b.start > now)
    .sort((a, b) => a.start - b.start);

  if (upcoming.length > 0) return { type: 'upcoming', booking: upcoming[0] };

  return null;
}

/** Format helpers **/
function formatTime(dt) {
  if (!dt) return '';
  return new Date(dt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}
function formatShortDate(dt) {
  if (!dt) return '';
  return new Date(dt).toLocaleDateString('en-US', { day: 'numeric', month: 'short' }); 
}
function formatBookingRange(start, end) {
  if (!start || !end) return '';
  const s = new Date(start);
  const e = new Date(end);
  const sameDay = s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth() && s.getDate() === e.getDate();

  if (sameDay) {
    return `${formatTime(s)} - ${formatTime(e)}, ${formatShortDate(s)}`; 
  } else {
    return `${formatShortDate(s)} ${formatTime(s)} — ${formatShortDate(e)} ${formatTime(e)}`; 
  }
}

export default function HallCard(props) {
  const isSelected = Boolean(props.isSelected);

  // 1. Logic to VACATE the hall
  const handleVacate = async () => {
    try {
      if (typeof props.onVacateHall === 'function') {
        await props.onVacateHall(props.data);
        return;
      }
      const data = { name: props.data.name }
      await clearHallApi(data);
      // Refresh the list immediately to update status on this page and schedule
      props.gethall();
    } catch (err) {
      console.log(err);
    }
  }

  // 2. Logic to DELETE the hall
  const handleDelete = async () => {
    if (typeof props.onDeleteHall === 'function') {
      try {
        await props.onDeleteHall(props.data);
      } catch (err) {
        console.error("Failed to delete hall", err);
      }
      return;
    }

    if(!window.confirm(`Are you sure you want to delete ${props.data.name}? This cannot be undone.`)) return;

    try {
      await api.delete(`/hall/delete_hall/${props.data._id}`);
      props.gethall(); 
    } catch (err) {
      console.error("Failed to delete hall", err);
    }
  }

  // Find booking info
  const bookingInfo = getCurrentOrNextBooking(props.data.bookings);
  let bookingLine = null;
  if (bookingInfo) {
    const { type, booking } = bookingInfo;
    const rangeText = formatBookingRange(booking.startDateTime || booking.start, booking.endDateTime || booking.end);
    const prefix = type === 'active' ? 'Booked now:' : 'Next booking:';
    bookingLine = `${prefix} ${rangeText}`;
  }

  const isFilled = props.data.status === 'Filled';

  return (
    <>
      <Card sx={{ width: '100%', position: 'relative' }} className='hall-admin-card' >
        
        <Box className="hall-select-anchor">
          <Checkbox
            size="small"
            checked={isSelected}
            onChange={() => props.onToggleSelect && props.onToggleSelect(props.data._id)}
            className="hall-select-checkbox"
            inputProps={{ 'aria-label': `Select ${props.data.name}` }}
          />
        </Box>
        
        {/* DELETE BUTTON - Top Right */}
        <IconButton 
            className="delete-icon-btn"
            onClick={handleDelete}
            aria-label="delete"
        >
            <DeleteOutlineIcon />
        </IconButton>

        <CardMedia
          sx={{ height: 140 }}
          image="https://images.unsplash.com/photo-1594122230689-45899d9e6f69?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxzZWFyY2h8Mnx8Y29uZmVyZW5jZSUyMGhhbGx8ZW58MHx8MHx8fDA%3D&w=1000&q=80"
          title="seminar hall"
        />
        <CardContent>
          <Typography gutterBottom variant="h5" component="div" className='hall-card-text' fontFamily={'RecklessNeue'}>
            {props.data.name}
          </Typography>
          <Typography variant="body2" color="text.secondary" className='hall-card-text' >
            <EventSeatIcon fontSize="large"  />
            <span className='number-seat'>{props.data.capacity}</span>
          </Typography>

          {bookingLine && (
            <Typography variant="body2" className="hall-card-text" sx={{ marginTop: 1, fontWeight: 500 }}>
              {bookingLine}
            </Typography>
          )}
        </CardContent>

        {/* ACTIONS SECTION - Centered Buttons */}
        <Box 
            sx={{ 
                display: 'flex', 
                justifyContent: 'center', 
                alignItems: 'center', 
                gap: 2, 
                padding: 2 
            }}
        >
            {/* Status Button */}
            <Button 
                size="medium" 
                variant="contained"
                className={`btn-admin-hall-status ${isFilled ? 'status-filled' : 'status-free'}`}
                sx={{ 
                    width: 'auto !important', 
                    margin: '0 !important',
                    minWidth: '100px'
                }} 
            >
                {props.data.status}
            </Button>

            {/* Vacate Button - Only appears if Filled */}
            {isFilled && (
                <Button 
                    size="medium" 
                    variant="contained"
                    className="btn-admin-hall-vacate"
                    onClick={handleVacate}
                    sx={{ 
                        width: 'auto !important', 
                        margin: '0 !important',
                        minWidth: '100px'
                    }} 
                >
                    Vacate
                </Button>
            )}
        </Box>
      </Card>
    </>
  )
}
