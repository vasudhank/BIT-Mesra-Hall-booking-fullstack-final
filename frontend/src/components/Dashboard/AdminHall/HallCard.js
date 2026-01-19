import React from 'react'
import "./AdminHall.css"
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardMedia from '@mui/material/CardMedia';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import EventSeatIcon from '@mui/icons-material/EventSeat';
import Grid from '@mui/material/Grid';
import { clearHallApi } from '../../../api/clearhallapi'

/**
 * Helper: return current active booking or next upcoming booking (or null)
 * bookings: array of { startDateTime, endDateTime, event, department, ... }
 */
function getCurrentOrNextBooking(bookings = []) {
  if (!bookings || bookings.length === 0) return null;

  // normalize to Date objects
  const now = new Date();

  const normalized = bookings.map(b => ({
    ...b,
    start: b.startDateTime ? new Date(b.startDateTime) : null,
    end: b.endDateTime ? new Date(b.endDateTime) : null
  })).filter(b => b.start && b.end);

  // find active booking (now in [start, end) )
  const active = normalized.find(b => b.start <= now && b.end > now);
  if (active) return { type: 'active', booking: active };

  // otherwise find next upcoming: start > now, with smallest start
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
  return new Date(dt).toLocaleDateString('en-US', { day: 'numeric', month: 'short' }); // e.g. "Nov 25"
}
function formatBookingRange(start, end) {
  if (!start || !end) return '';
  // check if same day
  const s = new Date(start);
  const e = new Date(end);
  const sameDay = s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth() && s.getDate() === e.getDate();

  if (sameDay) {
    return `${formatTime(s)} - ${formatTime(e)}, ${formatShortDate(s)}`; // e.g. "2:00 PM - 4:00 PM, Nov 25"
  } else {
    return `${formatShortDate(s)} ${formatTime(s)} — ${formatShortDate(e)} ${formatTime(e)}`; // "Nov 25 2:00 PM — Nov 26 4:00 PM"
  }
}

export default function HallCard(props) {
  const changeStatus = async () => {
    try {
      const data = { name: props.data.name }
      const res = await clearHallApi(data);
      console.log(res)
      props.gethall()
    } catch (err) {
      console.log(err)
    }
  }

  // find booking to show
  const bookingInfo = getCurrentOrNextBooking(props.data.bookings);

  // friendly label depending on whether it's active or upcoming
  let bookingLine = null;
  if (bookingInfo) {
    const { type, booking } = bookingInfo;
    const rangeText = formatBookingRange(booking.startDateTime || booking.start, booking.endDateTime || booking.end);
    const prefix = type === 'active' ? 'Booked now:' : 'Next booking:';
    bookingLine = `${prefix} ${rangeText}`;
  }

  return (
    <>
      <Card sx={{ width: '100%' }} className='hall-admin-card' >
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

          {/* Booking line (if exists) */}
          {bookingLine && (
            <Typography variant="body2" className="hall-card-text" sx={{ marginTop: 1, fontWeight: 500 }}>
              {bookingLine}
            </Typography>
          )}
        </CardContent>
        <Grid container spacing={2} justifyContent={'center'}>
          <Grid item xs={8} sm={5} md={4} lg={4} xl={4}>
            {/* Added style override to ensure button fits in card on mobile */}
            <Button size="medium" fullWidth className='btn-admin-hall' sx={{ width: '100% !important', marginTop: '1rem !important' }} onClick={changeStatus}>{props.data.status}</Button>
          </Grid>
        </Grid>
      </Card>
    </>
  )
}