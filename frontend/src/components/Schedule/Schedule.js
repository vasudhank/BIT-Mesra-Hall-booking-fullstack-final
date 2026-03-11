import React, { useEffect, useState, useRef, useMemo, useLayoutEffect } from 'react';
import api from '../../api/axiosInstance';
import { getNoticesApi } from '../../api/noticesApi';
import "./Schedule.css";
import HomeIcon from '@mui/icons-material/Home';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import KeyboardArrowUpRoundedIcon from '@mui/icons-material/KeyboardArrowUpRounded';
import {
  Container, Grid, Paper, Typography, TextField, Box, Chip, Button, Stack, IconButton, InputAdornment, useTheme, useMediaQuery, Modal
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import { useLocation, useNavigate } from 'react-router-dom';
import { fuzzyFilterHallLike } from '../../utils/fuzzySearch';
import QuickPageMenu from '../Navigation/QuickPageMenu';

dayjs.extend(isoWeek);

function formatTime(dt) {
  if (!dt) return '';
  return new Date(dt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function bookingOverlapsDay(booking, dateStr) {
  const dayStart = new Date(dateStr);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dateStr);
  dayEnd.setHours(23, 59, 59, 999);
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
  return `${s.toLocaleDateString()} ${formatTime(s)} - ${e.toLocaleDateString()} ${formatTime(e)}`;
}

function bookingRequesterName(booking) {
  const department = booking?.department;
  if (department && typeof department === 'object') {
    return department.head || department.department || department.email || '';
  }
  return '';
}

function colorFromString(str) {
  if (!str) return '#888';
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
  return `#${'00000'.slice(0, 6 - c.length)}${c}`;
}

const normalizeRoomKey = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const noticeAppliesToHall = (notice, hallName) => {
  if (!notice || !hallName) return false;
  if (notice.closureAllHalls) return true;
  const hallKey = normalizeRoomKey(hallName);
  if (!hallKey) return false;
  const rooms = Array.isArray(notice.rooms) ? notice.rooms : [];
  return rooms.some((room) => {
    const roomKey = normalizeRoomKey(room);
    return roomKey && (hallKey.includes(roomKey) || roomKey.includes(hallKey));
  });
};

const noticeOverlapsDay = (notice, dateStr) => {
  const dayStart = new Date(dateStr);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dateStr);
  dayEnd.setHours(23, 59, 59, 999);
  const start = new Date(notice.startDateTime || notice.createdAt);
  const end = new Date(notice.endDateTime || notice.startDateTime || notice.createdAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
  return start <= dayEnd && end >= dayStart;
};

const isClosureNotice = (notice) => String(notice?.kind || '').toUpperCase() === 'HOLIDAY';

const getNoticeTitle = (notice) =>
  String(notice?.title || notice?.subject || notice?.holidayName || 'Notice').trim();

const getNoticeDateTimeLabel = (notice) => {
  const start = dayjs(notice?.startDateTime || notice?.createdAt);
  const end = dayjs(notice?.endDateTime || notice?.startDateTime || notice?.createdAt);
  if (!start.isValid() || !end.isValid()) return 'Date & time unavailable';
  if (start.isSame(end, 'day')) {
    return `${start.format('DD MMM YYYY')} | ${start.format('hh:mm A')} - ${end.format('hh:mm A')}`;
  }
  return `${start.format('DD MMM YYYY, hh:mm A')} - ${end.format('DD MMM YYYY, hh:mm A')}`;
};

const noticeDetailPath = (notice) =>
  notice?._id ? `/notices/${notice._id}` : '/notices';

const hasSpecificRoomTargets = (notice) => {
  const rooms = Array.isArray(notice?.rooms) ? notice.rooms : [];
  return rooms.length > 0 && !notice?.closureAllHalls;
};

const isAllHallsGeneralNotice = (notice) =>
  !isClosureNotice(notice) && Boolean(notice?.closureAllHalls);

const isUnscopedGeneralNotice = (notice) =>
  !isClosureNotice(notice) && !hasSpecificRoomTargets(notice) && !notice?.closureAllHalls;

const noticeIdentityKey = (notice) =>
  String(notice?._id || `${notice?.title || notice?.subject || 'notice'}-${notice?.startDateTime || notice?.createdAt || ''}`);

const noticeTargetsHall = (notice, hallName) => {
  if (!notice || !hallName) return false;
  if (notice.closureAllHalls) return true;
  const rooms = Array.isArray(notice.rooms) ? notice.rooms : [];
  if (rooms.length > 0) return noticeAppliesToHall(notice, hallName);
  return true;
};

const sortNoticesByPriority = (items) =>
  [...(Array.isArray(items) ? items : [])].sort((a, b) => {
    const kindDiff = Number(isClosureNotice(b)) - Number(isClosureNotice(a));
    if (kindDiff !== 0) return kindDiff;
    return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
  });

// Helper to calculate position and width percentage for the timeline
// Range: 8:00 AM (480 mins) to 10:00 PM (1320 mins) -> Total 840 mins
const START_HOUR = 8;
const END_HOUR = 22;
const TOTAL_MINUTES = (END_HOUR - START_HOUR) * 60; // 14 hours * 60 = 840

function getRangePosition(startDateTime, endDateTime, selectedDateStr) {
  const start = new Date(startDateTime);
  const end = new Date(endDateTime);
  
  // Normalize dates to the selected day for calculation if they span multiple days
  // (Assuming simple day view logic, clamping to 8am-10pm of selected day)
  const viewStart = new Date(selectedDateStr);
  viewStart.setHours(START_HOUR, 0, 0, 0);
  
  const viewEnd = new Date(selectedDateStr);
  viewEnd.setHours(END_HOUR, 0, 0, 0);

  // If completely outside range
  if (end < viewStart || start > viewEnd) return null;

  // Clamp times
  const actualStart = start < viewStart ? viewStart : start;
  const actualEnd = end > viewEnd ? viewEnd : end;

  const startMinutes = (actualStart.getHours() * 60 + actualStart.getMinutes()) - (START_HOUR * 60);
  const durationMinutes = (actualEnd - actualStart) / 1000 / 60;

  const left = (startMinutes / TOTAL_MINUTES) * 100;
  const width = (durationMinutes / TOTAL_MINUTES) * 100;

  return { left: `${left}%`, width: `${width}%` };
}

function getBookingPosition(booking, selectedDateStr) {
  return getRangePosition(booking.startDateTime, booking.endDateTime, selectedDateStr);
}

function noticeOverlapsHourSlot(notice, dateStr, hourStart, hourEnd) {
  const slotStart = new Date(dateStr);
  slotStart.setHours(hourStart, 0, 0, 0);
  const slotEnd = new Date(dateStr);
  slotEnd.setHours(hourEnd, 0, 0, 0);
  const start = new Date(notice.startDateTime || notice.createdAt);
  const end = new Date(notice.endDateTime || notice.startDateTime || notice.createdAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
  return start < slotEnd && end > slotStart;
}

export default function Schedule() {
  const location = useLocation();
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const [halls, setHalls] = useState([]);
  const [allNotices, setAllNotices] = useState([]);
  const [noticeDialog, setNoticeDialog] = useState({ open: false, date: '', notices: [] });
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(dayjs().format('YYYY-MM-DD'));
  // Set Default View to 'today'
  const [viewMode, setViewMode] = useState(location.state?.mode || 'today'); 
  const [searchTerm, setSearchTerm] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [listNoticeListExpanded, setListNoticeListExpanded] = useState(false);
  const [todayNoticeListExpanded, setTodayNoticeListExpanded] = useState(false);
  const [closureHallDropdownByKey, setClosureHallDropdownByKey] = useState({});
  
  // Refs for scrolling synchronization
  const weekHeaderRef = useRef(null);
  const bodyRef = useRef(null);
  const todayAlertContentRef = useRef(null);
  
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

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const noticesRes = await getNoticesApi({
          sort: 'LATEST',
          limit: 500
        });
        if (!active) return;
        setAllNotices(Array.isArray(noticesRes?.notices) ? noticesRes.notices : []);
      } catch (_) {
        if (active) {
          setAllNotices([]);
        }
      }
    };
    run();
    return () => {
      active = false;
    };
  }, [weekDates]);

  const noticesForDate = (dateStr) =>
    sortNoticesByPriority(
      allNotices.filter((notice) => noticeOverlapsDay(notice, dateStr))
    );

  const noticesForHallDate = (hallName, dateStr) =>
    noticesForDate(dateStr).filter((notice) => noticeTargetsHall(notice, hallName));

  const closuresForHallDate = (hallName, dateStr) =>
    noticesForHallDate(hallName, dateStr).filter((notice) => isClosureNotice(notice));

  const generalNoticesForHallDate = (hallName, dateStr) =>
    noticesForHallDate(hallName, dateStr).filter((notice) => !isClosureNotice(notice));

  const hallSpecificGeneralNoticesForHallDate = (hallName, dateStr) =>
    generalNoticesForHallDate(hallName, dateStr).filter((notice) => hasSpecificRoomTargets(notice));

  const bookingsForDate = (hall) => {
    return (hall.bookings || []).filter(b => bookingOverlapsDay(b, selectedDate)).sort((a, b) => new Date(a.startDateTime) - new Date(b.startDateTime));
  };

  const hallHasBookingOnDate = (hall, dateStr) =>
    (hall?.bookings || []).some((booking) => bookingOverlapsDay(booking, dateStr));

  const hallClosedOnDate = (hall, dateStr) =>
    closuresForHallDate(hall?.name, dateStr).length > 0 && !hallHasBookingOnDate(hall, dateStr);

  const hallHasSpecificGeneralNoticeOnDate = (hall, dateStr) =>
    hallSpecificGeneralNoticesForHallDate(hall?.name, dateStr).length > 0 && !hallClosedOnDate(hall, dateStr) && !hallHasBookingOnDate(hall, dateStr);

  const selectedDateNotices = useMemo(
    () => sortNoticesByPriority(allNotices.filter((notice) => noticeOverlapsDay(notice, selectedDate))),
    [allNotices, selectedDate]
  );
  const selectedDateTopNotice = selectedDateNotices[0] || null;
  const selectedDateAllHallsGeneralNotices = selectedDateNotices.filter((notice) => isAllHallsGeneralNotice(notice));
  const selectedDateHallSpecificNotices = selectedDateNotices.filter((notice) => hasSpecificRoomTargets(notice));
  const selectedDateHasAnyClosure = selectedDateNotices.some((notice) => isClosureNotice(notice));
  const selectedDateCommonGeneralNotice = selectedDateNotices.find(
    (notice) => isUnscopedGeneralNotice(notice) || isAllHallsGeneralNotice(notice)
  ) || null;
  const selectedDateCommonStripNotice =
    selectedDateCommonGeneralNotice || selectedDateHallSpecificNotices[0] || selectedDateTopNotice || null;
  const selectedDateCommonStripIsClosure = selectedDateCommonStripNotice ? isClosureNotice(selectedDateCommonStripNotice) : selectedDateHasAnyClosure;
  const selectedDateStripLabel = selectedDateCommonStripIsClosure ? 'ALERT' : 'NOTICE';
  const selectedDateCommonStripText = selectedDateCommonStripNotice
    ? `${getNoticeTitle(selectedDateCommonStripNotice)} | ${getNoticeDateTimeLabel(selectedDateCommonStripNotice)}`
    : '';
  const selectedDateCommonStripMarquee = selectedDateCommonStripText.length > 70;
  const getClosedHallsForNotice = (notice) => {
    const matchedHallNames = (halls || [])
      .map((hall) => String(hall?.name || '').trim())
      .filter(Boolean)
      .filter((hallName) => noticeTargetsHall(notice, hallName));
    const explicitRooms = Array.isArray(notice?.rooms)
      ? notice.rooms.map((room) => String(room || '').trim()).filter(Boolean)
      : [];
    const source = matchedHallNames.length > 0 ? matchedHallNames : explicitRooms;
    const seen = new Set();
    return source.filter((name) => {
      const key = normalizeRoomKey(name);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const getClosureBadgeMeta = (notice) => {
    if (!notice) return null;
    const tone = isClosureNotice(notice) ? 'closure' : 'applies';
    const explicitRooms = Array.isArray(notice?.rooms)
      ? notice.rooms.map((room) => String(room || '').trim()).filter(Boolean)
      : [];
    const appliesAll = Boolean(notice?.closureAllHalls) || explicitRooms.length === 0;
    if (appliesAll) {
      return { type: 'all', halls: [], tone };
    }
    const hallsClosed = getClosedHallsForNotice(notice);
    if (hallsClosed.length === 0) {
      return { type: 'all', halls: [], tone };
    }
    return { type: 'some', halls: hallsClosed, tone };
  };

  const toggleClosureHallDropdown = (key) => {
    setClosureHallDropdownByKey((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const renderClosureIndicator = (meta, key) => {
    if (!meta) return null;
    const isClosureTone = meta.tone === 'closure';
    if (meta.type === 'all') {
      return (
        <Typography className={`schedule-closure-indicator-text ${isClosureTone ? 'scope-closure' : 'scope-applies'}`}>
          {isClosureTone ? 'All halls Closed' : 'Applies on all halls'}
        </Typography>
      );
    }
    const open = Boolean(closureHallDropdownByKey[key]);
    return (
      <Box className="schedule-closure-indicator-box">
        <button
          type="button"
          className={`schedule-closure-toggle ${isClosureTone ? 'scope-closure' : 'scope-applies'}`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleClosureHallDropdown(key);
          }}
          aria-expanded={open}
          aria-label="Toggle hall list"
        >
          <span>{isClosureTone ? 'Hall closed:' : 'Applies on halls:'}</span>
          {open ? <KeyboardArrowUpRoundedIcon fontSize="small" /> : <KeyboardArrowDownRoundedIcon fontSize="small" />}
        </button>
        {open && (
          <Box className={`schedule-closure-dropdown ${isClosureTone ? 'scope-closure' : 'scope-applies'}`}>
            {meta.halls.map((hallName) => (
              <Typography
                key={`${key}-${normalizeRoomKey(hallName)}`}
                className={`schedule-closure-dropdown-item ${isClosureTone ? 'scope-closure' : 'scope-applies'}`}
              >
                {hallName}
              </Typography>
            ))}
          </Box>
        )}
      </Box>
    );
  };

  const selectedDateCommonStripClosureMeta = selectedDateCommonStripNotice
    ? getClosureBadgeMeta(selectedDateCommonStripNotice)
    : null;
  const selectedDateHasMultipleNotices = selectedDateNotices.length > 1;
  const selectedDateExpandedNoticeItems = selectedDateNotices.map((notice, index) => {
    return {
      key: `${noticeIdentityKey(notice)}-${index}`,
      notice,
      isAlert: isClosureNotice(notice),
      title: getNoticeTitle(notice),
      dateTimeLabel: getNoticeDateTimeLabel(notice),
      closureMeta: getClosureBadgeMeta(notice)
    };
  });

  const filteredScheduleHalls = useMemo(() => {
    const source = Array.isArray(halls) ? halls : [];
    if (!searchQuery) return source;
    return fuzzyFilterHallLike(
      source,
      searchQuery,
      (hall) => hall?.name,
      (hall) => [hall?.capacity, hall?.status],
      { threshold: 0.48, nameThreshold: 0.4 }
    );
  }, [halls, searchQuery]);

  // Process data for Grid/List views
  const gridData = useMemo(() => {
    const cols = weekDates.map(d => ({ label: d.format('ddd'), date: d.format('YYYY-MM-DD'), longLabel: d.format('DD MMM') }));
    const filteredRows = filteredScheduleHalls.map(h => ({ id: h._id || h.name, name: h.name, capacity: h.capacity, bookings: h.bookings || [], status: h.status }));
    
    const map = {};
    filteredRows.forEach(r => {
      map[r.id] = {};
      cols.forEach(c => {
        const b = (r.bookings || []).filter(bb => bookingOverlapsDay(bb, c.date)).sort((x, y) => new Date(x.startDateTime) - new Date(y.startDateTime));
        map[r.id][c.date] = b;
      });
    });
    return { cols, rows: filteredRows, map };
  }, [filteredScheduleHalls, weekDates]);

  const syncWeekHeaderScroll = (scrollLeft) => {
    if (weekHeaderRef.current) {
      weekHeaderRef.current.scrollLeft = scrollLeft;
    }
  };

  const onBodyHorizontalScroll = (event) => {
    const scrollLeft = event.currentTarget.scrollLeft;
    syncWeekHeaderScroll(scrollLeft);
    if (viewMode === 'today' && todayAlertContentRef.current) {
      todayAlertContentRef.current.style.transform = `translateX(${scrollLeft}px)`;
    }
  };

  useEffect(() => {
    if (weekHeaderRef.current) {
      weekHeaderRef.current.scrollLeft = bodyRef.current?.scrollLeft || 0;
    }
    if (viewMode === 'today' && todayAlertContentRef.current) {
      todayAlertContentRef.current.style.transform = 'translateX(0px)';
    }
  }, [viewMode]);

  useEffect(() => {
    const onResize = () => {
      if (weekHeaderRef.current) {
        weekHeaderRef.current.scrollLeft = bodyRef.current?.scrollLeft || 0;
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const topStripStickyTop = navbarHeightPx + topOffsetPx;
  const weekHeaderStickyTop = navbarHeightPx + topOffsetPx + topStripHeight - 2;

  const onSearchChange = (e) => {
    const next = String(e.target.value || '');
    setSearchTerm(next);
    setSearchQuery(next.trim());
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

  useEffect(() => {
    setListNoticeListExpanded(false);
    setTodayNoticeListExpanded(false);
    setClosureHallDropdownByKey({});
  }, [selectedDate, viewMode]);

  const rowHeaderWidth = isMobile ? '120px' : '220px';
  const dayColWidth = isMobile ? 'minmax(140px, 1fr)' : 'minmax(180px, 1fr)';

  // ----- TODAY VIEW HELPERS -----
  // Generate time slots: 8:00 AM to 10:00 PM
  const timeSlots = useMemo(() => {
    const slots = [];
    for (let i = START_HOUR; i < END_HOUR; i++) {
      const hour = i % 12 === 0 ? 12 : i > 12 ? i - 12 : i;
      const ampm = i < 12 ? 'AM' : 'PM';
      // Next hour for label
      const nextI = i + 1;
      const nextHour = nextI % 12 === 0 ? 12 : nextI > 12 ? nextI - 12 : nextI;
      const nextAmpm = nextI < 12 ? 'AM' : 'PM';
      
      slots.push({
        label: `${hour}:00 ${ampm} - ${nextHour}:00 ${nextAmpm}`,
        shortLabel: `${hour} ${ampm}`
      });
    }
    return slots;
  }, []);

  // Filter rows for Today view (reuses searchQuery)
  const todayRows = useMemo(() => {
    return filteredScheduleHalls.map((hall) => ({
      id: hall._id || hall.name,
      name: hall.name,
      capacity: hall.capacity,
      bookings: hall.bookings || [],
      status: hall.status
    }));
  }, [filteredScheduleHalls]);

  // Width for one hour column in Today View
  const hourColumnWidth = 140; 

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

      {/* TOP CONTROL STRIP */}
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

            <Chip
              label={loading ? "Loading..." : `${(gridData.rows || []).length} halls`}
              variant="outlined"
              sx={{
                display: { xs: 'none', sm: 'flex' },
                color: 'var(--text-primary)',
                borderColor: 'var(--border-color)',
                backgroundColor: 'transparent'
              }}
            />

            <Stack direction="row" spacing={1}>
              <Button
                variant={viewMode === 'today' ? 'contained' : 'outlined'}
                onClick={() => setViewMode('today')}
                size="small"
                sx={{ minWidth: 'auto' }}
              >
                Today
              </Button>
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
            <QuickPageMenu
              iconOnly
              buttonClassName="schedule-top-icon-btn"
              panelClassName="schedule-menu-panel"
              itemClassName="schedule-menu-item"
              align="right"
            />
            <IconButton
              size="small"
              className="schedule-top-icon-btn"
              onClick={() => navigate('/')}
              aria-label="go home"
            >
              <HomeIcon sx={{ color: 'var(--text-primary)' }} />
            </IconButton>

          </Box>
        </Box>
      </Box>

      <Box sx={{ height: `0px` }} />

      {/* --- LIST VIEW --- */}
      {viewMode === 'list' && (
        <Container sx={{ px: { xs: 2, md: 3 }, pt: 2 }}>
          {!loading && selectedDateCommonStripNotice && (
            <Box
              sx={{
                mb: 2.2,
                border: selectedDateCommonStripIsClosure ? '1px solid rgba(185, 28, 28, 0.32)' : '1px solid rgba(30, 64, 175, 0.32)',
                borderRadius: '10px',
                overflow: 'visible',
                background: selectedDateCommonStripIsClosure ? 'var(--schedule-strip-closure-soft)' : 'var(--schedule-strip-applies-soft)'
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'stretch' }}>
                <Box
                  sx={{
                    width: rowHeaderWidth,
                    minWidth: rowHeaderWidth,
                    px: 1,
                    py: 0.9,
                    borderRight: selectedDateCommonStripIsClosure ? '1px solid rgba(185, 28, 28, 0.24)' : '1px solid rgba(30, 64, 175, 0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 0.7
                  }}
                >
                  {selectedDateHasMultipleNotices && (
                    <IconButton
                      size="small"
                      className="schedule-strip-toggle-btn"
                      onClick={() => setListNoticeListExpanded((prev) => !prev)}
                      aria-label={listNoticeListExpanded ? 'Collapse notice list' : 'Expand notice list'}
                    >
                      {listNoticeListExpanded ? (
                        <KeyboardArrowUpRoundedIcon fontSize="small" />
                      ) : (
                        <KeyboardArrowDownRoundedIcon fontSize="small" />
                      )}
                    </IconButton>
                  )}
                  <Button
                    size="small"
                    variant="contained"
                    onClick={() => navigate(noticeDetailPath(selectedDateCommonStripNotice))}
                    sx={{
                      minWidth: 'auto',
                      px: 1,
                      fontSize: '0.68rem',
                      lineHeight: 1.2,
                      whiteSpace: 'nowrap',
                      background: selectedDateCommonStripIsClosure
                        ? 'linear-gradient(90deg, #991b1b 0%, #b91c1c 100%)'
                        : 'linear-gradient(90deg, #1d4ed8 0%, #1e40af 100%)'
                    }}
                  >
                    OPEN
                  </Button>
                  <Typography
                    sx={{
                      fontSize: '0.76rem',
                      fontWeight: 800,
                      letterSpacing: '0.08em',
                      color: selectedDateCommonStripIsClosure ? '#991b1b' : '#1e3a8a'
                    }}
                  >
                    {selectedDateStripLabel}
                  </Typography>
                </Box>
                <Box sx={{ flex: 1, minWidth: 0, px: 1.5, py: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
                  <Box sx={{ flex: 1, minWidth: 0, alignSelf: 'center' }}>
                    <Box className="schedule-alert-marquee">
                      {selectedDateCommonStripMarquee ? (
                        <span className="schedule-alert-marquee-track">
                          {selectedDateCommonStripText} | {selectedDateCommonStripText}
                        </span>
                      ) : (
                        <Typography
                          sx={{
                            fontSize: '0.9rem',
                            fontWeight: 700,
                            color: selectedDateCommonStripIsClosure ? '#991b1b' : '#1e3a8a'
                          }}
                        >
                          {selectedDateCommonStripText}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                  {selectedDateCommonStripClosureMeta ? (
                    <Box sx={{ flexShrink: 0 }}>
                      {renderClosureIndicator(
                        selectedDateCommonStripClosureMeta,
                        `list-top-${noticeIdentityKey(selectedDateCommonStripNotice)}`
                      )}
                    </Box>
                  ) : null}
                </Box>
              </Box>

              {listNoticeListExpanded && selectedDateHasMultipleNotices && (
                <Box sx={{ borderTop: selectedDateCommonStripIsClosure ? '1px solid rgba(185, 28, 28, 0.24)' : '1px solid rgba(30, 64, 175, 0.25)' }}>
                  <Box className="schedule-expanded-strip-list">
                    {selectedDateExpandedNoticeItems.map((item) => (
                      <Box key={`list-expanded-${item.key}`} className="schedule-expanded-strip-row">
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Typography sx={{ fontSize: '0.74rem', fontWeight: 800, letterSpacing: '0.08em', color: item.isAlert ? '#991b1b' : '#1e3a8a' }}>
                            {item.isAlert ? 'ALERT' : 'NOTICE'}
                          </Typography>
                          <Typography sx={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                            {item.title}
                          </Typography>
                          <Typography sx={{ fontSize: '0.74rem', color: 'var(--text-secondary)', wordBreak: 'break-word' }}>
                            {item.dateTimeLabel}
                          </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.6, flexShrink: 0 }}>
                          {item.closureMeta ? renderClosureIndicator(item.closureMeta, `list-expanded-closure-${item.key}`) : null}
                          <Button
                            size="small"
                            onClick={() => navigate(noticeDetailPath(item.notice))}
                            sx={{ minWidth: 'auto', px: 0.8, fontSize: '0.68rem', fontWeight: 800 }}
                          >
                            OPEN
                          </Button>
                        </Box>
                      </Box>
                    ))}
                  </Box>
                </Box>
              )}
            </Box>
          )}
          <Grid container spacing={3}>
            {loading ? (
              <Grid item xs={12}><Typography>Loading...</Typography></Grid>
            ) : (
              (gridData.rows || []).map((h) => {
                const bookings = bookingsForDate(h);
                const hallClosed = hallClosedOnDate(h, selectedDate);
                const hallGlobalNotice = selectedDateAllHallsGeneralNotices.length > 0 && !hallClosed;
                const hallSpecificNotice = hallHasSpecificGeneralNoticeOnDate(h, selectedDate);
                return (
                  <Grid item xs={12} sm={6} md={4} key={h.id || h.name}>
                    <Paper
                      elevation={3}
                      sx={{
                        padding: 2,
                        border: hallClosed ? '1px solid rgba(185, 28, 28, 0.44)' : (hallSpecificNotice || hallGlobalNotice) ? '1px solid rgba(30, 64, 175, 0.34)' : '1px solid transparent',
                        background: hallClosed
                          ? 'linear-gradient(180deg, rgba(185,28,28,0.11), rgba(185,28,28,0.04))'
                          : (hallSpecificNotice || hallGlobalNotice)
                            ? 'linear-gradient(180deg, rgba(30,64,175,0.1), rgba(30,64,175,0.04))'
                            : undefined
                      }}
                    >
                      <Box display="flex" justifyContent="space-between" alignItems="center">
                        <Box>
                          <Typography variant="h6">{h.name}</Typography>
                          <Typography variant="body2" color="text.secondary">{h.capacity} seats </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', gap: 0.8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          <Chip label={h.status} color={h.status === 'Filled' ? 'error' : 'success'} />
                          {hallClosed && <Chip label="CLOSED" color="error" variant="outlined" />}
                        </Box>
                      </Box>

                      <Box mt={2}>
                        {bookings.length === 0 && !hallClosed && !hallSpecificNotice && !hallGlobalNotice ? (
                          <Typography variant="body2" color="text.secondary">No bookings on this date</Typography>
                        ) : (
                          <>
                            {bookings.length > 0 && bookings.map((b) => (
                              <Box key={b._id || `${b.startDateTime}-${b.endDateTime}`} mb={1} sx={{ borderLeft: '3px solid #1976d2', pl: 1 }}>
                                <Typography variant="subtitle2">{b.event || 'Booked'}</Typography>
                                <Typography variant="body2" color="text.secondary">
                                  {bookingRangeText(b.startDateTime, b.endDateTime)}
                                </Typography>
                                <Typography variant="caption" sx={{ color: '#1d4ed8', fontWeight: 800, letterSpacing: '0.05em' }}>
                                  ADMIN APPROVED
                                </Typography>
                                {bookingRequesterName(b) && (
                                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                    Requested by: {bookingRequesterName(b)}
                                  </Typography>
                                )}
                              </Box>
                            ))}

                          </>
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

      {/* --- GRID VIEW (WEEKLY) --- */}
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
              {gridData.cols.map(col => {
                const dayNotices = noticesForDate(col.date);
                const dayHasClosure = dayNotices.some((notice) => isClosureNotice(notice));
                const dayHasGeneral = dayNotices.some((notice) => !isClosureNotice(notice));
                const dayHasGlobalGeneral = dayNotices.some((notice) => isAllHallsGeneralNotice(notice));
                return (
                  <Box
                    key={col.date}
                    sx={{
                      borderRight: '1px solid var(--border-color)',
                      borderBottom: '1px solid var(--border-color)',
                      p: 1,
                      bgcolor: dayHasClosure
                        ? 'rgba(185, 28, 28, 0.22)'
                        : (dayHasGeneral || dayHasGlobalGeneral)
                          ? 'rgba(30, 64, 175, 0.2)'
                          : 'var(--bg-default)',
                      textAlign: 'center'
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.6 }}>
                      {dayNotices.length > 0 && (
                        <Button
                          size="small"
                          variant="outlined"
                          color={dayHasClosure ? 'error' : 'primary'}
                          onClick={() => setNoticeDialog({ open: true, date: col.date, notices: dayNotices })}
                          aria-label={`Open notices for ${col.longLabel}`}
                          sx={{ minWidth: 'auto', px: 0.8, py: 0.2, fontWeight: 800, fontSize: '0.66rem', lineHeight: 1.1 }}
                        >
                          {dayHasClosure ? 'ALERT' : 'NOTICE'}
                        </Button>
                      )}
                      <Box sx={{ textAlign: 'center' }}>
                        <Typography variant="subtitle2" color="var(--text-primary)">{col.label}</Typography>
                        <Typography variant="caption" color="text.secondary">{col.longLabel}</Typography>
                      </Box>
                    </Box>
                  </Box>
                );
              })}
            </Box>
          </Box>

          <Box
            ref={bodyRef}
            onScroll={onBodyHorizontalScroll}
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
                    const dayNotices = noticesForDate(col.date);
                    const dayHasGlobalGeneral = dayNotices.some((notice) => isAllHallsGeneralNotice(notice));
                    const closures = closuresForHallDate(row.name, col.date);
                    const generalNotices = hallSpecificGeneralNoticesForHallDate(row.name, col.date);
                    const cellClosed = closures.length > 0 && bookings.length === 0;
                    const cellNotice = !cellClosed && generalNotices.length > 0 && bookings.length === 0;
                    return (
                      <Box key={row.id + col.date} sx={{
                        borderRight: '1px solid var(--border-color)',
                        borderBottom: '1px solid var(--border-color)',
                        p: 0,
                        minHeight: 70,
                        minWidth: isMobile ? 140 : 180,
                        bgcolor: cellClosed
                          ? 'rgba(185, 28, 28, 0.2)'
                          : (cellNotice || dayHasGlobalGeneral)
                            ? 'rgba(30, 64, 175, 0.18)'
                            : (bookings.length ? 'var(--bg-default)' : 'var(--bg-paper)'),
                        position: 'relative',
                        display: 'flex',
                        flexDirection: 'column'
                      }}>
                        {bookings.length === 0 && !cellClosed && !cellNotice ? (
                          <Typography variant="body2" color="text.secondary">-</Typography>
                        ) : (
                          <>
                            {bookings.map((b, idx) => {
                              const color = colorFromString(b._id ? b._id.toString() : (b.event || b.startDateTime));
                              return (
                                <Box key={b._id || `${b.startDateTime}-${b.endDateTime}`} sx={{
                                  flex: 1,
                                  minHeight: 70 / Math.max(bookings.length, 1),
                                  p: '6px 8px',
                                  borderRadius: 0,
                                  bgcolor: `${color}33`,
                                  borderLeft: `4px solid ${color}`,
                                  color: 'var(--text-primary)',
                                  boxShadow: 'none',
                                  fontSize: 12,
                                  overflow: 'hidden',
                                  whiteSpace: 'nowrap',
                                  textOverflow: 'ellipsis',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  justifyContent: 'center',
                                  borderBottom: idx < bookings.length - 1 ? '1px solid var(--border-color)' : 'none'
                                }}>
                                  <strong style={{ fontSize: 12 }}>{b.event || 'Booked'}</strong>
                                  {bookingRequesterName(b) && (
                                    <div style={{ fontSize: 10, opacity: 0.95, fontWeight: 'bold' }}>{bookingRequesterName(b)}</div>
                                  )}
                                  <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.05em', color: '#1d4ed8' }}>ADMIN APPROVED</div>
                                  <div style={{ fontSize: 11 }}>{formatTime(b.startDateTime)} - {formatTime(b.endDateTime)}</div>
                                </Box>
                              );
                            })}
                            {bookings.length === 0 && cellClosed && (
                              <Box
                                sx={{
                                  flex: 1,
                                  minHeight: 70,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  color: '#991b1b',
                                  fontWeight: 800,
                                  letterSpacing: '0.04em'
                                }}
                              >
                                CLOSED
                              </Box>
                            )}
                            {bookings.length === 0 && !cellClosed && cellNotice && (
                              <Box sx={{ flex: 1, minHeight: 70 }} />
                            )}
                          </>
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

      {/* --- TODAY VIEW (NEW) --- */}
      {viewMode === 'today' && (
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
              display: 'flex',
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
                zIndex: 10,
                width: rowHeaderWidth,
                minWidth: rowHeaderWidth,
                display: 'flex',
                alignItems: 'center'
              }}>
                <Typography variant="subtitle2">Room / Time</Typography>
              </Box>

              {timeSlots.map((slot, index) => (
                <Box key={index} sx={{
                  borderRight: '1px solid var(--border-color)',
                  borderBottom: '1px solid var(--border-color)',
                  p: 1,
                  bgcolor: 'var(--bg-default)',
                  textAlign: 'center',
                  width: hourColumnWidth,
                  minWidth: hourColumnWidth
                }}>
                  <Typography variant="subtitle2" color="var(--text-primary)">{slot.label}</Typography>
                </Box>
              ))}
            </Box>

            {selectedDateCommonStripNotice && (
              <Box
                sx={{ display: 'flex', width: '100%' }}
              >
                <Box
                  sx={{
                    borderRight: '1px solid var(--border-color)',
                    borderBottom: '1px solid var(--border-color)',
                    bgcolor: selectedDateCommonStripIsClosure ? 'var(--schedule-row-header-closure-bg)' : 'var(--schedule-row-header-applies-bg)',
                    width: rowHeaderWidth,
                    minWidth: rowHeaderWidth,
                    p: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'sticky',
                    left: 0,
                    zIndex: 10
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.8 }}>
                    {selectedDateHasMultipleNotices && (
                      <IconButton
                        size="small"
                        className="schedule-strip-toggle-btn"
                        onClick={() => setTodayNoticeListExpanded((prev) => !prev)}
                        aria-label={todayNoticeListExpanded ? 'Collapse notice list' : 'Expand notice list'}
                      >
                        {todayNoticeListExpanded ? (
                          <KeyboardArrowUpRoundedIcon fontSize="small" />
                        ) : (
                          <KeyboardArrowDownRoundedIcon fontSize="small" />
                        )}
                      </IconButton>
                    )}
                    <Button
                      size="small"
                      variant="contained"
                      onClick={() => navigate(noticeDetailPath(selectedDateCommonStripNotice))}
                      sx={{
                        minWidth: 'auto',
                        px: 1,
                        fontSize: '0.68rem',
                        lineHeight: 1.2,
                        whiteSpace: 'nowrap',
                        background: selectedDateCommonStripIsClosure
                          ? 'linear-gradient(90deg, #991b1b 0%, #b91c1c 100%)'
                          : 'linear-gradient(90deg, #1d4ed8 0%, #1e40af 100%)'
                      }}
                    >
                      OPEN
                    </Button>
                    <Typography
                      sx={{
                        fontSize: '0.76rem',
                        fontWeight: 800,
                        letterSpacing: '0.08em',
                        color: selectedDateCommonStripIsClosure ? '#991b1b' : '#1e3a8a'
                      }}
                    >
                      {selectedDateStripLabel}
                    </Typography>
                  </Box>
                </Box>
                <Box
                  ref={todayAlertContentRef}
                  sx={{
                    borderRight: '1px solid var(--border-color)',
                    borderBottom: '1px solid var(--border-color)',
                    flex: 1,
                    minWidth: 0,
                    px: 1.5,
                    py: 0.8,
                    bgcolor: selectedDateCommonStripIsClosure ? 'rgba(185, 28, 28, 0.14)' : 'rgba(30, 64, 175, 0.12)',
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 1.2
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 0, alignSelf: 'center' }}>
                    <Box className="schedule-alert-marquee">
                      {selectedDateCommonStripMarquee ? (
                        <span className="schedule-alert-marquee-track">
                          {selectedDateCommonStripText} | {selectedDateCommonStripText}
                        </span>
                      ) : (
                        <Typography
                          sx={{
                            fontSize: '0.9rem',
                            fontWeight: 700,
                            color: selectedDateCommonStripIsClosure ? '#991b1b' : '#1e3a8a'
                          }}
                        >
                          {selectedDateCommonStripText}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                  {selectedDateCommonStripClosureMeta ? (
                    <Box sx={{ flexShrink: 0 }}>
                      {renderClosureIndicator(
                        selectedDateCommonStripClosureMeta,
                        `today-top-${noticeIdentityKey(selectedDateCommonStripNotice)}`
                      )}
                    </Box>
                  ) : null}
                </Box>
              </Box>
            )}

            {todayNoticeListExpanded && selectedDateHasMultipleNotices && (
              <Box sx={{ display: 'flex', width: '100%', background: 'var(--bg-paper)' }}>
                <Box
                  sx={{
                    borderRight: '1px solid var(--border-color)',
                    borderBottom: '1px solid var(--border-color)',
                    bgcolor: selectedDateCommonStripIsClosure ? 'var(--schedule-row-header-closure-bg-soft)' : 'var(--schedule-row-header-applies-bg-soft)',
                    width: rowHeaderWidth,
                    minWidth: rowHeaderWidth,
                    position: 'sticky',
                    left: 0,
                    zIndex: 10
                  }}
                />
                <Box
                  sx={{
                    borderRight: '1px solid var(--border-color)',
                    borderBottom: '1px solid var(--border-color)',
                    flex: 1,
                    minWidth: 0,
                    px: 1,
                    py: 0.7
                  }}
                >
                  <Box className="schedule-expanded-strip-list">
                    {selectedDateExpandedNoticeItems.map((item) => (
                      <Box key={`today-expanded-${item.key}`} className="schedule-expanded-strip-row">
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Typography sx={{ fontSize: '0.74rem', fontWeight: 800, letterSpacing: '0.08em', color: item.isAlert ? '#991b1b' : '#1e3a8a' }}>
                            {item.isAlert ? 'ALERT' : 'NOTICE'}
                          </Typography>
                          <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                            {item.title}
                          </Typography>
                          <Typography sx={{ fontSize: '0.74rem', color: 'var(--text-secondary)', wordBreak: 'break-word' }}>
                            {item.dateTimeLabel}
                          </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.55, flexShrink: 0 }}>
                          {item.closureMeta ? renderClosureIndicator(item.closureMeta, `today-expanded-closure-${item.key}`) : null}
                          <Button
                            size="small"
                            onClick={() => navigate(noticeDetailPath(item.notice))}
                            sx={{ minWidth: 'auto', px: 0.8, fontSize: '0.66rem', fontWeight: 800 }}
                          >
                            OPEN
                          </Button>
                        </Box>
                      </Box>
                    ))}
                  </Box>
                </Box>
              </Box>
            )}
          </Box>
          <Box
            ref={bodyRef}
            onScroll={onBodyHorizontalScroll}
            sx={{
              width: '100%',
              overflowX: 'auto',
              overflowY: 'visible'
            }}
          >
            <Box>
              {todayRows.map(row => (
                <Box key={row.id || row.name} sx={{
                  display: 'flex',
                  width: 'max-content',
                  position: 'relative'
                }}>
                  {(() => {
                    const rowBookings = bookingsForDate(row);
                    const rowClosures = closuresForHallDate(row.name, selectedDate);
                    const rowGeneralNotices = hallSpecificGeneralNoticesForHallDate(row.name, selectedDate);
                    const rowGlobalSlotNoticeAt = (slotIndex) => {
                      const slotStartHour = START_HOUR + slotIndex;
                      const slotEndHour = slotStartHour + 1;
                      return selectedDateAllHallsGeneralNotices.some((notice) =>
                        noticeOverlapsHourSlot(notice, selectedDate, slotStartHour, slotEndHour)
                      );
                    };
                    const rowClosed = rowClosures.length > 0 && rowBookings.length === 0;
                    const rowAllHallsNotice = selectedDateAllHallsGeneralNotices.length > 0 && !rowClosed;
                    const rowNotice = !rowClosed && rowGeneralNotices.length > 0 && rowBookings.length === 0;

                    return (
                      <>
                        <Box sx={{
                          borderRight: '1px solid var(--border-color)',
                          borderBottom: '1px solid var(--border-color)',
                          p: 1,
                          bgcolor: rowClosed
                            ? 'var(--schedule-row-header-closure-bg)'
                            : (rowAllHallsNotice || rowNotice)
                              ? 'var(--schedule-row-header-applies-bg)'
                              : 'var(--bg-paper)',
                          width: rowHeaderWidth,
                          minWidth: rowHeaderWidth,
                          position: 'sticky',
                          left: 0,
                          zIndex: 10,
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'center',
                          boxShadow: '2px 0 0 0 var(--border-color)'
                        }}>
                          <Typography variant="subtitle2">{row.name}</Typography>
                          <Typography variant="caption" color="text.secondary">{row.capacity} seats</Typography>
                          <Box sx={{ mt: 0.5, display: 'flex', gap: 0.6, flexWrap: 'wrap' }}>
                            <Chip
                              label={row.status}
                              size="small"
                              color={row.status === 'Filled' ? 'error' : 'success'}
                            />
                            {rowClosed && <Chip label="CLOSED" size="small" color="error" variant="outlined" />}
                          </Box>
                        </Box>

                        <Box sx={{ position: 'relative', display: 'flex' }}>
                          {timeSlots.map((slot, index) => (
                            <Box key={index} sx={{
                              borderRight: '1px solid var(--border-color)',
                              borderBottom: '1px solid var(--border-color)',
                              width: hourColumnWidth,
                              minWidth: hourColumnWidth,
                              minHeight: 80,
                              bgcolor: rowClosed
                                ? 'var(--schedule-grid-cell-closure-bg)'
                                : rowGlobalSlotNoticeAt(index)
                                  ? 'var(--schedule-grid-cell-applies-bg)'
                                : rowNotice
                                  ? 'var(--schedule-grid-cell-applies-bg)'
                                  : 'var(--bg-paper)'
                            }} />
                          ))}

                          {rowBookings.map((booking) => {
                            const pos = getBookingPosition(booking, selectedDate);
                            if (!pos) return null;
                            const baseColor = colorFromString(booking._id ? booking._id.toString() : (booking.event || booking.startDateTime));
                            return (
                              <Box
                                key={booking._id || `${booking.startDateTime}`}
                                sx={{
                                  position: 'absolute',
                                  top: 0,
                                  bottom: 0,
                                  left: pos.left,
                                  width: pos.width,
                                  backgroundColor: `${baseColor}44`,
                                  borderLeft: `4px solid ${baseColor}`,
                                  borderRadius: 0,
                                  padding: '2px 6px',
                                  overflow: 'visible',
                                  whiteSpace: 'nowrap',
                                  zIndex: 6,
                                  display: 'flex',
                                  flexDirection: 'column',
                                  justifyContent: 'center'
                                }}
                              >
                                <Typography variant="caption" sx={{ fontWeight: 'bold', color: 'var(--text-primary)', lineHeight: 1.2 }}>
                                  {formatTime(booking.startDateTime)} - {formatTime(booking.endDateTime)}
                                </Typography>
                                <Typography variant="caption" sx={{ fontWeight: 'bold', color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                                  {booking.event || 'Booked'}
                                </Typography>
                                {bookingRequesterName(booking) && (
                                  <Typography variant="caption" sx={{ color: 'var(--text-primary)', fontSize: '0.72rem', opacity: 0.95, fontWeight: 'bold' }}>
                                    {bookingRequesterName(booking)}
                                  </Typography>
                                )}
                                <Typography variant="caption" sx={{ color: '#1d4ed8', fontSize: '0.66rem', fontWeight: 900, letterSpacing: '0.06em' }}>
                                  ADMIN APPROVED
                                </Typography>
                              </Box>
                            );
                          })}

                          {rowBookings.length === 0 && rowClosed && (
                            <Box
                              sx={{
                                position: 'absolute',
                                inset: 0,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                zIndex: 5
                              }}
                            >
                              <Typography sx={{ color: '#991b1b', fontWeight: 800, letterSpacing: '0.08em' }}>
                                CLOSED
                              </Typography>
                            </Box>
                          )}

                          {rowBookings.length === 0 && !rowClosed && rowNotice && (
                            <Box sx={{ position: 'absolute', inset: 0, zIndex: 5 }} />
                          )}
                        </Box>
                      </>
                    );
                  })()}
                </Box>
              ))}
              
              {todayRows.length === 0 && (
                <Box sx={{ p: 3, textAlign: 'center' }}>
                  <Typography color="text.secondary">No halls found matching your search.</Typography>
                </Box>
              )}

            </Box>
          </Box>
        </Box>
      )}
      <Modal
        open={Boolean(noticeDialog.open)}
        onClose={() => setNoticeDialog({ open: false, date: '', notices: [] })}
        aria-labelledby="schedule-day-notice-modal-title"
        sx={{ zIndex: 2600, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}
      >
        <Box className="schedule-notice-modal-shell">
          <Box className="schedule-notice-modal-card">
            <Typography id="schedule-day-notice-modal-title" variant="h6" sx={{ fontWeight: 700 }}>
              Notices for {noticeDialog.date ? dayjs(noticeDialog.date).format('DD MMM YYYY') : 'selected day'}
            </Typography>
            <Box className="schedule-notice-modal-list">
              {noticeDialog.notices.length === 0 && (
                <Typography variant="body2" color="text.secondary">No notices found.</Typography>
              )}
              {noticeDialog.notices.map((notice) => {
                const closure = isClosureNotice(notice);
                const closureMeta = getClosureBadgeMeta(notice);
                return (
                  <Box
                    key={notice._id || `${notice.title}-${notice.createdAt}`}
                    sx={{
                      border: closure ? '1px solid rgba(185, 28, 28, 0.34)' : '1px solid rgba(30, 64, 175, 0.3)',
                      background: closure
                        ? 'linear-gradient(180deg, rgba(185, 28, 28, 0.11), rgba(185, 28, 28, 0.04))'
                        : 'linear-gradient(180deg, rgba(30, 64, 175, 0.1), rgba(30, 64, 175, 0.04))',
                      borderRadius: 2,
                      p: 1.25
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
                      <Typography sx={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                        {getNoticeTitle(notice)}
                      </Typography>
                      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.45 }}>
                        <Chip
                          label={closure ? 'CLOSURE' : 'UPDATE'}
                          size="small"
                          color={closure ? 'error' : 'primary'}
                          variant="outlined"
                        />
                        {closureMeta ? renderClosureIndicator(closureMeta, `modal-closure-${noticeIdentityKey(notice)}`) : null}
                      </Box>
                    </Box>
                    <Typography sx={{ mt: 0.45, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                      {getNoticeDateTimeLabel(notice)}
                    </Typography>
                    <Box sx={{ mt: 1, display: 'flex', justifyContent: 'flex-end' }}>
                      <Button
                        size="small"
                        onClick={() => {
                          setNoticeDialog({ open: false, date: '', notices: [] });
                          navigate(noticeDetailPath(notice));
                        }}
                        endIcon={<OpenInNewIcon sx={{ fontSize: 15 }} />}
                      >
                        View Notice
                      </Button>
                    </Box>
                  </Box>
                );
              })}
            </Box>
          </Box>
        </Box>
      </Modal>

    </Container>
  );
}





