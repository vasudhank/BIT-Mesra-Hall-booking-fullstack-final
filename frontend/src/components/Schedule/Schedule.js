// frontend/src/components/Schedule/Schedule.js
import React, { useEffect, useState, useRef, useMemo, useLayoutEffect } from 'react';
import axios from 'axios';
import "./Schedule.css";
import HomeIcon from '@mui/icons-material/Home';
import {
  Container, Grid, Paper, Typography, TextField, Box, Chip, Button, Stack, IconButton, InputAdornment
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
dayjs.extend(isoWeek);

/**
 * Schedule component with toggle between List and Timetable (grid).
 *
 * Timetable:
 *  - Columns: days of current week (Mon -> Sun)
 *  - Rows: halls (rooms)
 *  - Cells: colored blocks for bookings that overlap the weekday
 */

function formatTime(dt) {
  if (!dt) return '';
  return new Date(dt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function bookingOverlapsDay(booking, dateStr) {
  const dayStart = new Date(dateStr);
  dayStart.setHours(0,0,0,0);
  const dayEnd = new Date(dateStr);
  dayEnd.setHours(23,59,59,999);
  const s = new Date(booking.startDateTime);
  const e = new Date(booking.endDateTime);
  return s <= dayEnd && e >= dayStart;
}

function bookingRangeText(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  if (s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth() && s.getDate() === e.getDate()) {
    return `${formatTime(s)} - ${formatTime(e)}`;
  }
  return `${s.toLocaleDateString()} ${formatTime(s)} — ${e.toLocaleDateString()} ${formatTime(e)}`;
}

function colorFromString(str) {
  if (!str) return '#888';
  let hash = 0;
  for (let i=0;i<str.length;i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
  return `#${'00000'.slice(0, 6 - c.length)}${c}`;
}

export default function Schedule() {
  const [halls, setHalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [viewMode, setViewMode] = useState('list'); // 'list' or 'grid'

  // NEW: search state (for the new rounded search box)
  const [searchTerm, setSearchTerm] = useState('');    // controlled input
  const [searchQuery, setSearchQuery] = useState('');  // committed query on Enter / button

  // refs
  const weekHeaderRef = useRef(null); // week header (days)
  const bodyRef = useRef(null);
  const topStripRef = useRef(null); // top control strip ref

  // measured height of the top strip (used for spacer and to position week header)
  const [topStripHeight, setTopStripHeight] = useState(0);
  const [dateTime, setDateTime] = useState("");


  // small visual offset from top of viewport (gap below browser chrome/address bar)
  // adjust this number (px) if you want a bigger/smaller gap. Increased slightly to avoid peek.
  const topOffsetPx = 20; // tweak if needed

  // If you have an extra global fixed navbar above this page, set its height here (usually 0).
  const navbarHeightPx = 0;

  // measure top strip height synchronously so layout doesn't flicker
  useLayoutEffect(() => {
    const measure = () => {
      const el = topStripRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        setTopStripHeight(Math.ceil(r.height));
      } else {
        setTopStripHeight(0);
      }
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // compute monday..sunday (dayjs objects) for week containing selectedDate
  const weekDates = useMemo(() => {
    const dt = dayjs(selectedDate);
    const monday = dt.isoWeekday() === 1 ? dt.startOf('day') : dt.subtract(dt.isoWeekday() - 1, 'day');
    const days = [];
    for (let i = 0; i < 7; ++i) days.push(monday.add(i, 'day'));
    return days; // Mon..Sun
  }, [selectedDate]);

  useEffect(() => { fetchHalls(); }, []);

  const fetchHalls = async () => {
    setLoading(true);
    try {
      const res = await axios.get('http://localhost:8000/api/hall/view_halls', { withCredentials: true });
      setHalls(res.data.halls || []);
    } catch (err) {
      console.error('fetch halls error', err);
    }
    setLoading(false);
  };

  const bookingsForDate = (hall) => {
    return (hall.bookings || []).filter(b => bookingOverlapsDay(b, selectedDate)).sort((a,b)=> new Date(a.startDateTime)-new Date(b.startDateTime));
  };

  // gridData: columns = weekDates (Mon..Sun), rows = halls
  // apply searchQuery filter here so both list and grid view use filtered halls
  const gridData = useMemo(() => {
    const cols = weekDates.map(d => ({ label: d.format('ddd'), date: d.format('YYYY-MM-DD'), longLabel: d.format('DD MMM') })); // Mon..Sun
    const filteredRows = (halls || []).filter(h => {
      if (!searchQuery) return true;
      return (h.name || '').toLowerCase().includes(searchQuery.toLowerCase());
    }).map(h => ({ id: h._id || h.name, name: h.name, capacity: h.capacity, bookings: h.bookings || [], status: h.status }));
    // map[rowId][colDate] => bookings array
    const map = {};
    filteredRows.forEach(r => {
      map[r.id] = {};
      cols.forEach(c => {
        const b = (r.bookings || []).filter(bb => bookingOverlapsDay(bb, c.date)).sort((x,y)=> new Date(x.startDateTime)-new Date(y.startDateTime));
        map[r.id][c.date] = b;
      });
    });
    return { cols, rows: filteredRows, map };
  }, [halls, weekDates, searchQuery]);

  // sync week-header horizontal scrollLeft to body horizontal scrollLeft
  useEffect(() => {
    const bodyEl = bodyRef.current;
    if (!bodyEl) return;
    const onScroll = () => {
      if (weekHeaderRef.current && bodyRef.current) {
        weekHeaderRef.current.scrollLeft = bodyRef.current.scrollLeft;
      }
    };
    bodyEl.addEventListener('scroll', onScroll, { passive: true });
    return () => bodyEl.removeEventListener('scroll', onScroll);
  }, [bodyRef.current, weekHeaderRef.current]);

  // on window resize keep week header aligned with body
  useEffect(() => {
    const onResize = () => {
      if (weekHeaderRef.current && bodyRef.current) {
        weekHeaderRef.current.scrollLeft = bodyRef.current.scrollLeft;
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // top value for the top strip sticky
  const topStripStickyTop = navbarHeightPx + topOffsetPx;

  // top value for the week header sticky (must be directly below top strip).
  // keep small overlap to avoid hairline reveal
  const weekHeaderStickyTop = navbarHeightPx + topOffsetPx + topStripHeight - 2; // 2px overlap

  // simple handler for search input (updates controlled input)
  const onSearchChange = (e) => {
    setSearchTerm(e.target.value);
  };

  // commit the current searchTerm to searchQuery (triggering filter)
  const onSearchSubmit = () => {
    setSearchQuery(searchTerm.trim());
  };

  // clear search
  

  // allow Enter to submit search
  const onSearchKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onSearchSubmit();
    }
  };

  useEffect(() => {
  const updateTime = () => {
    const now = new Date(
      new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
    );

    const days = [
      "SUNDAY", "MONDAY", "TUESDAY",
      "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"
    ];

    const months = [
      "JANUARY", "FEBRUARY", "MARCH", "APRIL",
      "MAY", "JUNE", "JULY", "AUGUST",
      "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"
    ];

    const formatted = `${days[now.getDay()]}, ${
      months[now.getMonth()]
    } ${String(now.getDate()).padStart(2, "0")}, ${
      now.getFullYear()
    } - ${String(now.getHours()).padStart(2, "0")}:${
      String(now.getMinutes()).padStart(2, "0")
    }:${String(now.getSeconds()).padStart(2, "0")} IST`;

    setDateTime(formatted);
  };

  updateTime();
  const interval = setInterval(updateTime, 1000);
  return () => clearInterval(interval);
}, []);


  return (
    // ensure container uses normal flow (do not position fixed here)
    <Container maxWidth={false} sx={{ paddingLeft: 0, paddingRight: 0, marginTop: 0 }}>
      {/* Opaque cover bar to hide timetable behind the address bar (tiny gap) */}
      <Box
        sx={{
          position: "sticky",
          top: 0,
          height: `${topOffsetPx}px`,
          backgroundColor: "#fff",
          zIndex: 2000
        }}
      />

      {/* TOP CONTROL STRIP (make only this sticky) */}
      <Box
        ref={topStripRef}
        sx={{
          position: 'sticky',
          top: `${topStripStickyTop}px`,   // small gap below browser chrome
          zIndex: 1600,
          backgroundColor: '#fff',         // opaque so nothing shows through
          borderBottom: '1px solid rgba(0,0,0,0.06)',
          boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
          px: 3,
          py: 1
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <Typography variant="h4" sx={{ fontWeight: 600, fontFamily: 'RecklessNeue' }}>Hall Schedule</Typography>

          {/* RIGHT SIDE OF STRIP: search box (NEW) | select date | chip | view buttons */}
          <Box display="flex" gap={2} alignItems="center">
          <Typography
    sx={{
      fontSize: "0.85rem",
      fontWeight: 600,
      whiteSpace: "nowrap",
      color: "rgba(0,0,0,0.75)"
    }}
  >
    {dateTime}
  </Typography>
            {/* SEARCH BOX - rounded corners, placeholder as requested, with search icon */}
            <TextField
  placeholder="Type your room name here"
  value={searchTerm}
  onChange={onSearchChange}
  onKeyDown={onSearchKeyDown}
  size="small"
  variant="outlined"
  sx={{
    '& .MuiOutlinedInput-root': {
      borderRadius: '24px',
      paddingRight: 0,
    },
    minWidth: { xs: 160, sm: 260 },
    '& .MuiOutlinedInput-notchedOutline': {
      borderColor: 'rgba(0,0,0,0.12)',
    },

    // ⭐ CUSTOM PLACEHOLDER FONT SIZE HERE ⭐
    '& input::placeholder': {
      fontSize: '12px',      // <-- set any px value you want
      opacity: 1,            // ensures it's not faded
    }
  }}
  InputProps={{
    endAdornment: (
      <InputAdornment position="end" sx={{ mr: 0 }}>
        
        <IconButton size="small" onClick={onSearchSubmit} aria-label="submit search">
          <SearchIcon />
        </IconButton>
      </InputAdornment>
    ),
    sx: { paddingRight: '6px' }
  }}
/>


            {/* existing select date */}
            <TextField
              label="Select date"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              size="small"
            />

            <Chip label={loading ? "Loading..." : `${(gridData.rows || []).length} halls`} />

            <Stack direction="row" spacing={1}>
              <Button
                variant={viewMode === 'list' ? 'contained' : 'outlined'}
                onClick={() => setViewMode('list')}
                size="small"
              >
                List
              </Button>
              <Button
                variant={viewMode === 'grid' ? 'contained' : 'outlined'}
                onClick={() => setViewMode('grid')}
                size="small"
              >
                Grid
              </Button>
            </Stack>
            <IconButton
  size="small"
  onClick={() => window.location.href = "/"}   // ← sends user to Homepage instantly
  aria-label="go home"
>
  <HomeIcon />
</IconButton>

          </Box>
        </Box>
      </Box>

      {/* Spacer equal to measured top strip height so content starts below it */}
      <Box sx={{ height: `0px` }} />

      {/* List view unchanged but with a little top padding so cards don't butt to the strip */}
      {viewMode === 'list' && (
        <Container sx={{ px: 3, pt: 2 }}>
          <Grid container spacing={3}>
            {loading ? (
              <Grid item xs={12}><Typography>Loading...</Typography></Grid>
            ) : (
              (gridData.rows || []).map((h) => {
                const bookings = bookingsForDate(h);
                return (
                  <Grid item xs={12} sm={6} md={4} key={h.id || h.name}>
                    <Paper elevation={3} sx={{ padding: 2 }}>
                      <Box display="flex" justifyContent="space-between" alignItems="center">
                        <Box>
                          <Typography variant="h6">{h.name}</Typography>
                          <Typography variant="body2" color="text.secondary">{h.capacity} seats </Typography>
                        </Box>
                        <Chip label={h.status} color={h.status === 'Filled' ? 'error' : 'success'} />
                      </Box>

                      <Box mt={2}>
                        {bookings.length === 0 ? (
                          <Typography variant="body2" color="text.secondary">No bookings on this date</Typography>
                        ) : (
                          bookings.map((b) => (
                            <Box key={b._id || `${b.startDateTime}-${b.endDateTime}`} mb={1} sx={{ borderLeft: '3px solid #1976d2', pl: 1 }}>
                              <Typography variant="subtitle2">{b.event || 'Booked'}</Typography>
                              <Typography variant="body2" color="text.secondary">
                                {bookingRangeText(b.startDateTime, b.endDateTime)}
                              </Typography>
                            </Box>
                          ))
                        )}
                      </Box>
                    </Paper>
                  </Grid>
                );
              })
            )}
          </Grid>
        </Container>
      )}

      {/* Grid view: keep week-header sticky logic as before (positioned directly below top strip) */}
      {viewMode === 'grid' && (
        <Box sx={{ width: '100%' }}>
          {/* Week day header (kept as before). This sits below the top strip. */}
          <Box
            ref={weekHeaderRef}
            sx={{
              position: 'sticky',
              top: `${weekHeaderStickyTop}px`, // directly under top strip (with -2px overlap)
              zIndex: 1500,
              backgroundColor: '#fff',
              boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
              overflowX: 'hidden',
              marginTop: '-2px'
            }}
          >
            <Box sx={{
              display: 'grid',
              gridTemplateColumns: `220px repeat(${gridData.cols.length}, minmax(180px, 1fr))`,
              width: 'max-content'
            }}>
              <Box sx={{ borderRight: '1px solid #ddd', borderBottom: '1px solid #ddd', p: 1, bgcolor: '#fafafa' }}>
                <Typography variant="subtitle2">Room / Day</Typography>
              </Box>
              {gridData.cols.map(col => (
                <Box key={col.date} sx={{ borderRight: '1px solid #ddd', borderBottom: '1px solid #ddd', p: 1, bgcolor: '#fafafa', textAlign: 'center' }}>
                  <Typography variant="subtitle2">{col.label}</Typography>
                  <Typography variant="caption" color="text.secondary">{col.longLabel}</Typography>
                </Box>
              ))}
            </Box>
          </Box>

          {/* Body: horizontal scrolling container that controls week-header's scrollLeft */}
          <Box
            ref={bodyRef}
            sx={{
              width: '100%',
              overflowX: 'auto',
              overflowY: 'visible'
            }}
          >
            <Box>
              {gridData.rows.map(row => (
                <Box key={row.id} sx={{
                  display: 'grid',
                  gridTemplateColumns: `220px repeat(${gridData.cols.length}, minmax(180px, 1fr))`,
                  width: 'max-content'
                }}>
                  {/* left room cell */}
                  <Box sx={{ borderRight: '1px solid #ddd', borderBottom: '1px solid #eee', p: 1, bgcolor: '#fff', minWidth: 220 }}>
                    <Typography variant="subtitle2">{row.name}</Typography>
                    <Typography variant="caption" color="text.secondary">{row.capacity} seats&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</Typography>
                    <Chip label={row.status} size="small" sx={{ mt: 0.5 }} color={row.status === 'Filled' ? 'error' : 'success'} />
                  </Box>

                  {/* day cells */}
                  {gridData.cols.map(col => {
                    const bookings = gridData.map[row.id][col.date] || [];
                    return (
                      <Box key={row.id + col.date} sx={{
                        borderRight: '1px solid #eee',
                        borderBottom: '1px solid #eee',
                        p: 1,
                        minHeight: 70,
                        minWidth: 180,
                        bgcolor: bookings.length ? '#fafafa' : '#fff'
                      }}>
                        {bookings.length === 0 ? (
                          <Typography variant="body2" color="text.secondary">—</Typography>
                        ) : (
                          bookings.map(b => {
                            const color = colorFromString(b._id ? b._id.toString() : (b.event || b.startDateTime));
                            return (
                              <Box key={b._id || `${b.startDateTime}-${b.endDateTime}`} sx={{
                                mb: 1,
                                p: 0.5,
                                borderRadius: 1,
                                bgcolor: color,
                                color: '#fff',
                                boxShadow: '0 1px 2px rgba(0,0,0,0.12)',
                                fontSize: 12,
                                overflow: 'hidden',
                                whiteSpace: 'nowrap',
                                textOverflow: 'ellipsis'
                              }}>
                                <strong style={{ fontSize: 12 }}>{b.event || 'Booked'}</strong>
                                <div style={{ fontSize: 11 }}>{formatTime(b.startDateTime)} — {formatTime(b.endDateTime)}</div>
                              </Box>
                            );
                          })
                        )}
                      </Box>
                    );
                  })}
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      )}
    </Container>
  );
}
