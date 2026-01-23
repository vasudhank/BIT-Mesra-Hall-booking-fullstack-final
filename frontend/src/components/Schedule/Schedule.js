import React, { useEffect, useState, useRef, useMemo, useLayoutEffect } from 'react';
import api from '../../api/axiosInstance';
import "./Schedule.css";
import HomeIcon from '@mui/icons-material/Home';
import {
  Container, Grid, Paper, Typography, TextField, Box, Chip, Button, Stack, IconButton, InputAdornment, useTheme, useMediaQuery
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import { useLocation } from 'react-router-dom';

dayjs.extend(isoWeek);

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
  const location = useLocation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const [halls, setHalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [viewMode, setViewMode] = useState(location.state?.mode || 'list'); 
  const [searchTerm, setSearchTerm] = useState('');    
  const [searchQuery, setSearchQuery] = useState('');  
  const weekHeaderRef = useRef(null); 
  const bodyRef = useRef(null);
  const topStripRef = useRef(null); 
  const [topStripHeight, setTopStripHeight] = useState(0);
  const [dateTime, setDateTime] = useState("");
  const topOffsetPx = 20; 
  const navbarHeightPx = 0;

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

  const weekDates = useMemo(() => {
    const dt = dayjs(selectedDate);
    const monday = dt.isoWeekday() === 1 ? dt.startOf('day') : dt.subtract(dt.isoWeekday() - 1, 'day');
    const days = [];
    for (let i = 0; i < 7; ++i) days.push(monday.add(i, 'day'));
    return days; 
  }, [selectedDate]);

  useEffect(() => { fetchHalls(); }, []);

  const fetchHalls = async () => {
    setLoading(true);
    try {
      const res = await api.get('/hall/view_halls', { withCredentials: true });
      setHalls(res.data.halls || []);
    } catch (err) {
      console.error('fetch halls error', err);
    }
    setLoading(false);
  };

  const bookingsForDate = (hall) => {
    return (hall.bookings || []).filter(b => bookingOverlapsDay(b, selectedDate)).sort((a,b)=> new Date(a.startDateTime)-new Date(b.startDateTime));
  };

  const gridData = useMemo(() => {
    const cols = weekDates.map(d => ({ label: d.format('ddd'), date: d.format('YYYY-MM-DD'), longLabel: d.format('DD MMM') })); 
    const filteredRows = (halls || []).filter(h => {
      if (!searchQuery) return true;
      return (h.name || '').toLowerCase().includes(searchQuery.toLowerCase());
    }).map(h => ({ id: h._id || h.name, name: h.name, capacity: h.capacity, bookings: h.bookings || [], status: h.status }));
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

  useEffect(() => {
    const onResize = () => {
      if (weekHeaderRef.current && bodyRef.current) {
        weekHeaderRef.current.scrollLeft = bodyRef.current.scrollLeft;
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const topStripStickyTop = navbarHeightPx + topOffsetPx;
  const weekHeaderStickyTop = navbarHeightPx + topOffsetPx + topStripHeight - 2; 

  const onSearchChange = (e) => {
    setSearchTerm(e.target.value);
  };

  const onSearchSubmit = () => {
    setSearchQuery(searchTerm.trim());
  };

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
    const days = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
    const months = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
    const formatted = `${days[now.getDay()]}, ${months[now.getMonth()]} ${String(now.getDate()).padStart(2, "0")}, ${now.getFullYear()} - ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")} IST`;
    setDateTime(formatted);
  };
  updateTime();
  const interval = setInterval(updateTime, 1000);
  return () => clearInterval(interval);
}, []);

  const rowHeaderWidth = isMobile ? '120px' : '220px';
  const dayColWidth = isMobile ? 'minmax(140px, 1fr)' : 'minmax(180px, 1fr)';

  return (
    <Container maxWidth={false} sx={{ paddingLeft: 0, paddingRight: 0, marginTop: 0 }}>
      <Box
        sx={{
          position: "sticky",
          top: 0,
          height: `${topOffsetPx}px`,
          backgroundColor: "var(--bg-paper)",
          zIndex: 2000
        }}
      />

      {/* TOP CONTROL STRIP (make only this sticky) */}
      <Box
        ref={topStripRef}
        sx={{
          position: 'sticky',
          top: `${topStripStickyTop}px`,   
          zIndex: 1600,
          backgroundColor: 'var(--bg-paper)', 
          color: 'var(--text-primary)',       
          borderBottom: '1px solid var(--border-color)',
          boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
          px: { xs: 2, md: 3 },
          py: 1
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="h4" sx={{ fontWeight: 600, fontFamily: 'RecklessNeue', fontSize: { xs: '1.5rem', md: '2.125rem' } }}>
            Hall Schedule
          </Typography>

          <Box display="flex" gap={isMobile ? 1 : 2} alignItems="center" flexWrap="wrap" sx={{ justifyContent: { xs: 'space-between', md: 'flex-end' }, width: { xs: '100%', md: 'auto' } }}>
          <Typography
            sx={{
              fontSize: "0.85rem",
              fontWeight: 600,
              whiteSpace: "nowrap",
              color: "var(--text-secondary)", 
              display: { xs: 'none', md: 'block' }, 
              mr: 1
            }}
          >
            {dateTime}
          </Typography>
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
                minWidth: { xs: '100%', sm: 260 }, 
                flexGrow: { xs: 1, sm: 0 },
                '& .MuiOutlinedInput-notchedOutline': {
                  borderColor: 'var(--border-color)',
                },
                '& input::placeholder': {
                  fontSize: '12px',       
                  opacity: 1,
                  color: 'var(--text-secondary)'
                }
              }}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end" sx={{ mr: 0 }}>
                    <IconButton size="small" onClick={onSearchSubmit} aria-label="submit search">
                      <SearchIcon sx={{ color: 'var(--text-secondary)' }} />
                    </IconButton>
                  </InputAdornment>
                ),
                sx: { paddingRight: '6px' }
              }}
            />

            <TextField
              label="Select date"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              size="small"
              sx={{ flexGrow: { xs: 1, sm: 0 } }}
            />

            {/* 🔥 UPDATED CHIP: Uses CSS Variables for Dark Mode Support */}
            <Chip 
              label={loading ? "Loading..." : `${(gridData.rows || []).length} halls`} 
              variant="outlined"
              sx={{ 
                display: { xs: 'none', sm: 'flex' },
                color: 'var(--text-primary)',        // Adapts to theme
                borderColor: 'var(--border-color)',  // Adapts to theme
                backgroundColor: 'transparent'
              }} 
            />

            <Stack direction="row" spacing={1}>
              <Button
                variant={viewMode === 'list' ? 'contained' : 'outlined'}
                onClick={() => setViewMode('list')}
                size="small"
                sx={{ minWidth: 'auto' }}
              >
                List
              </Button>
              <Button
                variant={viewMode === 'grid' ? 'contained' : 'outlined'}
                onClick={() => setViewMode('grid')}
                size="small"
                sx={{ minWidth: 'auto' }}
              >
                Grid
              </Button>
            </Stack>
            <IconButton
              size="small"
              onClick={() => window.location.href = "/"}   
              aria-label="go home"
            >
              <HomeIcon sx={{ color: 'var(--text-primary)' }}/>
            </IconButton>

          </Box>
        </Box>
      </Box>

      <Box sx={{ height: `0px` }} />

      {viewMode === 'list' && (
        <Container sx={{ px: { xs: 2, md: 3 }, pt: 2 }}>
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

      {viewMode === 'grid' && (
        <Box sx={{ width: '100%' }}>
          <Box
            ref={weekHeaderRef}
            sx={{
              position: 'sticky',
              top: `${weekHeaderStickyTop}px`,
              zIndex: 1500,
              backgroundColor: 'var(--bg-paper)', 
              boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
              overflowX: 'hidden',
              marginTop: '-2px'
            }}
          >
            <Box sx={{
              display: 'grid',
              gridTemplateColumns: `${rowHeaderWidth} repeat(${gridData.cols.length}, ${dayColWidth})`,
              width: 'max-content'
            }}>
              <Box sx={{ 
                borderRight: '1px solid var(--border-color)', 
                borderBottom: '1px solid var(--border-color)', 
                p: 1, 
                bgcolor: 'var(--bg-default)', 
                color: 'var(--text-primary)', 
                position: 'sticky', 
                left: 0,
                zIndex: 10
              }}>
                <Typography variant="subtitle2">Room / Day</Typography>
              </Box>
              {gridData.cols.map(col => (
                <Box key={col.date} sx={{ borderRight: '1px solid var(--border-color)', borderBottom: '1px solid var(--border-color)', p: 1, bgcolor: 'var(--bg-default)', textAlign: 'center' }}>
                  <Typography variant="subtitle2" color="var(--text-primary)">{col.label}</Typography>
                  <Typography variant="caption" color="text.secondary">{col.longLabel}</Typography>
                </Box>
              ))}
            </Box>
          </Box>

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
                  gridTemplateColumns: `${rowHeaderWidth} repeat(${gridData.cols.length}, ${dayColWidth})`,
                  width: 'max-content'
                }}>
                  {/* left room cell */}
                  <Box sx={{ 
                    borderRight: '1px solid var(--border-color)', 
                    borderBottom: '1px solid var(--border-color)', 
                    p: 1, 
                    bgcolor: 'var(--bg-paper)', 
                    minWidth: isMobile ? 120 : 220,
                    position: 'sticky', 
                    left: 0,
                    zIndex: 10
                  }}>
                    <Typography variant="subtitle2">{row.name}</Typography>
                    <Typography variant="caption" color="text.secondary">{row.capacity} seats&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</Typography>
                    <Chip label={row.status} size="small" sx={{ mt: 0.5 }} color={row.status === 'Filled' ? 'error' : 'success'} />
                  </Box>

                  {/* day cells */}
                  {gridData.cols.map(col => {
                    const bookings = gridData.map[row.id][col.date] || [];
                    return (
                      <Box key={row.id + col.date} sx={{
                        borderRight: '1px solid var(--border-color)',
                        borderBottom: '1px solid var(--border-color)',
                        p: 1,
                        minHeight: 70,
                        minWidth: isMobile ? 140 : 180,
                        bgcolor: bookings.length ? 'var(--bg-default)' : 'var(--bg-paper)' 
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