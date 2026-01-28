import React, { useEffect, useState } from 'react';
import Appbar from '../AppBar/AppBar';
import "./AdminBooking.css";
import Grid from '@mui/material/Grid';
import AdminBookingCard from './AdminBookingCard';
import Backdrop from '@mui/material/Backdrop';
import CircularProgress from '@mui/material/CircularProgress';
import Button from '@mui/material/Button';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import api from '../../../api/axiosInstance';
import { Container, useMediaQuery, useTheme } from '@mui/material';

export default function AdminBooking() {

  const [bookingRequests, setBookingRequests] = useState([]); 
  const [filteredRequests, setFilteredRequests] = useState([]); 
  const [open, setOpen] = useState(true);
  const [search, setSearch] = useState("");

  // --- VIEW STATE MANAGEMENT ---
  const [viewMode, setViewMode] = useState('ALL'); 
  const [activeCategory, setActiveCategory] = useState('ALL'); 
  const [selectedHallGroup, setSelectedHallGroup] = useState(null);
  
  // Stores organized data
  const [categorizedData, setCategorizedData] = useState({
    timeConflicts: {},
    dateConflicts: {},
    noConflicts: {}
  });

  // Stores counts for badges
  const [counts, setCounts] = useState({
    time: 0,
    date: 0,
    safe: 0
  });

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  // --- 1. DATA FETCHING ---
  const get_booking_requests = async () => {
    setOpen(true);
    try {
      const response = await api.get('/booking/show_booking_requests', {
        withCredentials: true
      });
      const data = response.data.booking_requests || [];
      setBookingRequests(data);
      setFilteredRequests(data); 
      processCategorization(data); 
      setOpen(false);
    } catch (err) {
      console.log(err);
      setOpen(false);
    }
  };

  useEffect(() => {
    get_booking_requests();
  }, []);

  // --- 2. ROBUST CONFLICT LOGIC ---
  const processCategorization = (requests) => {
    // 1. Initialize Buckets
    const buckets = {
      timeConflicts: {}, 
      dateConflicts: {},
      noConflicts: {}
    };

    // Sets to track IDs so we don't duplicate logic 
    // (Priority: Time Conflict > Date Conflict > No Conflict)
    const timeConflictIds = new Set();
    const dateConflictIds = new Set();

    // 2. Group by Hall
    const byHall = requests.reduce((acc, req) => {
      const h = req.hall;
      if (!acc[h]) acc[h] = [];
      acc[h].push(req);
      return acc;
    }, {});

    // 3. Helper: Convert "HH:MM:SS" or "HH:MM" to minutes for comparison
    const getMinutes = (timeStr) => {
        if (!timeStr) return 0;
        const [h, m] = timeStr.split(':').map(Number);
        return h * 60 + m;
    };

    // 4. Analyze overlaps
    Object.keys(byHall).forEach(hall => {
      const hallReqs = byHall[hall];
      
      hallReqs.forEach(reqA => {
        let hasCriticalTimeConflict = false;
        let hasDateOnlyConflict = false;

        const startA = new Date(reqA.startDateTime).getTime();
        const endA = new Date(reqA.endDateTime).getTime();
        
        // Time of day in minutes (for partial overlap check)
        const timeStartA = getMinutes(reqA.startTime24);
        const timeEndA = getMinutes(reqA.endTime24);

        for (let reqB of hallReqs) {
          if (reqA._id === reqB._id) continue; 

          const startB = new Date(reqB.startDateTime).getTime();
          const endB = new Date(reqB.endDateTime).getTime();

          // --- LOGIC A: CRITICAL TIME CONFLICT ---
          // Do the actual physical time ranges overlap?
          // Logic: (StartA < EndB) AND (StartB < EndA)
          // This handles same day overlap, multi-day overlap, wrapping, etc.
          const isFullOverlap = (startA < endB && startB < endA);

          if (isFullOverlap) {
            hasCriticalTimeConflict = true;
            break; // Stop checking, this is already critical
          }

          // --- LOGIC B: DATE OVERLAP BUT DIFFERENT TIME ---
          // Only check if not critical
          if (!hasCriticalTimeConflict) {
             const timeStartB = getMinutes(reqB.startTime24);
             const timeEndB = getMinutes(reqB.endTime24);

             // 1. Do Dates Overlap? (Using String comparison or Date objects at 00:00:00)
             const dateStartA = new Date(reqA.startDate).getTime();
             const dateEndA = new Date(reqA.endDate).getTime();
             const dateStartB = new Date(reqB.startDate).getTime();
             const dateEndB = new Date(reqB.endDate).getTime();
             
             const datesOverlap = (dateStartA <= dateEndB && dateStartB <= dateEndA);

             // 2. Do Times of Day Overlap?
             // e.g. 10:00-11:00 vs 14:00-15:00
             const timesOverlap = (timeStartA < timeEndB && timeStartB < timeEndA);

             if (datesOverlap && !timesOverlap) {
                hasDateOnlyConflict = true;
             }
          }
        }

        // --- BUCKET ASSIGNMENT (Priority Based) ---
        if (hasCriticalTimeConflict) {
          timeConflictIds.add(reqA._id);
          if (!buckets.timeConflicts[hall]) buckets.timeConflicts[hall] = [];
          buckets.timeConflicts[hall].push(reqA);
        } else if (hasDateOnlyConflict) {
          dateConflictIds.add(reqA._id);
          if (!buckets.dateConflicts[hall]) buckets.dateConflicts[hall] = [];
          buckets.dateConflicts[hall].push(reqA);
        } else {
          if (!buckets.noConflicts[hall]) buckets.noConflicts[hall] = [];
          buckets.noConflicts[hall].push(reqA);
        }
      });
    });

    // 5. Update State
    setCategorizedData(buckets);
    
    // 6. Calculate Counts for Badges (Sum of all arrays in the maps)
    setCounts({
        time: Object.values(buckets.timeConflicts).reduce((acc, arr) => acc + arr.length, 0),
        date: Object.values(buckets.dateConflicts).reduce((acc, arr) => acc + arr.length, 0),
        safe: Object.values(buckets.noConflicts).reduce((acc, arr) => acc + arr.length, 0)
    });
  };

  // --- 3. NAVIGATION HANDLERS ---
  const handleFilterClick = (category) => {
    setActiveCategory(category);
    if (category === 'ALL') {
      setViewMode('ALL');
      setFilteredRequests(bookingRequests);
    } else {
      setViewMode('HALL_LIST');
    }
  };

  const handleHallClick = (hallName, requests) => {
    setSelectedHallGroup({ name: hallName, requests: requests });
    setViewMode('REQUEST_LIST');
  };

  const handleBack = () => {
    if (viewMode === 'REQUEST_LIST') {
      setViewMode('HALL_LIST');
      setSelectedHallGroup(null);
    } else if (viewMode === 'HALL_LIST') {
      setViewMode('ALL');
      setActiveCategory('ALL');
    }
  };

  // --- 4. SEARCH LOGIC ---
  const onSearchChange = (e) => {
    const val = e.target.value;
    setSearch(val);
    if (val.trim() === "") setFilteredRequests(bookingRequests);
  };

  const onSearchSubmit = () => {
    if (!search.trim()) {
      setFilteredRequests(bookingRequests);
      return;
    }
    const q = search.toLowerCase();
    const filtered = bookingRequests.filter(req => 
      req.hall.toLowerCase().includes(q) ||
      req.department.department.toLowerCase().includes(q) ||
      req.event.toLowerCase().includes(q)
    );
    setFilteredRequests(filtered);
    setViewMode('ALL'); 
    setActiveCategory('ALL');
  };

  // --- RENDER HELPERS ---
  const renderCategoryButtons = () => (
    <div className='filter-buttons-container'>
      <button 
        className={`filter-btn ${activeCategory === 'ALL' ? 'active' : ''}`}
        onClick={() => handleFilterClick('ALL')}
      >
        All Requests
      </button>

      <button 
        className={`filter-btn conflict-time ${activeCategory === 'TIME' ? 'active' : ''}`}
        onClick={() => handleFilterClick('TIME')}
      >
        Time Conflicts
        {counts.time > 0 && <span className="filter-btn-badge">{counts.time}</span>}
      </button>

      <button 
        className={`filter-btn conflict-date ${activeCategory === 'DATE' ? 'active' : ''}`}
        onClick={() => handleFilterClick('DATE')}
      >
        Date Overlaps
        {counts.date > 0 && <span className="filter-btn-badge">{counts.date}</span>}
      </button>

      <button 
        className={`filter-btn no-conflict ${activeCategory === 'SAFE' ? 'active' : ''}`}
        onClick={() => handleFilterClick('SAFE')}
      >
        No Overlaps
        {counts.safe > 0 && <span className="filter-btn-badge">{counts.safe}</span>}
      </button>
    </div>
  );

  return (
    <>
      <Backdrop sx={{ color: '#fff', zIndex: (theme) => theme.zIndex.drawer + 1 }} open={open}>
        <CircularProgress color="inherit" />
      </Backdrop>

      <div className='admin-booking-body'>
        <Appbar showSearch={viewMode === 'ALL'} searchValue={search} onSearchChange={onSearchChange} onSearchSubmit={onSearchSubmit} />

        <Container maxWidth="xl" sx={{ mt: isMobile ? 12 : 10 }}> 
          
          <Grid container justifyContent={'center'}>
            <Grid item xs={12}>
              <div className='admin-booking-title-div'>
                <h2 className='admin-booking-title'>
                  {viewMode === 'ALL' && "BOOKING REQUESTS"}
                  {viewMode !== 'ALL' && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                      <ArrowBackIcon className="back-btn-icon" onClick={handleBack} />
                      {activeCategory === 'TIME' && "CRITICAL CONFLICTS"}
                      {activeCategory === 'DATE' && "DATE OVERLAPS"}
                      {activeCategory === 'SAFE' && "DISTINCT BOOKINGS"}
                    </div>
                  )}
                </h2>
              </div>
            </Grid>
          </Grid>

          {/* Filter Buttons */}
          {viewMode !== 'REQUEST_LIST' && renderCategoryButtons()}

          {/* --- VIEW 1: MAIN DASHBOARD (ALL) --- */}
          {viewMode === 'ALL' && (
            <Grid container spacing={4} justifyContent={'center'}>
              {filteredRequests.map((data) => (
                <Grid item xs={11} sm={6} md={4} lg={3} key={data._id} display="flex" justifyContent="center">
                  <AdminBookingCard data={data} getrequest={get_booking_requests} />
                </Grid>
              ))}
              {filteredRequests.length === 0 && !open && (
                <h3 className="no-data-text">No requests found.</h3>
              )}
            </Grid>
          )}

          {/* --- VIEW 2: HALL LIST --- */}
          {viewMode === 'HALL_LIST' && (
            <Grid container spacing={4} justifyContent={'center'}>
              {(() => {
                const mapToUse = 
                  activeCategory === 'TIME' ? categorizedData.timeConflicts :
                  activeCategory === 'DATE' ? categorizedData.dateConflicts :
                  categorizedData.noConflicts;

                const hallKeys = Object.keys(mapToUse);

                if (hallKeys.length === 0) return <h3 className="no-data-text">No Halls found in this category.</h3>;

                return hallKeys.map(hall => (
                  <Grid item xs={11} sm={6} md={4} lg={3} key={hall} display="flex" justifyContent="center">
                    <Card className='hall-group-card'>
                      <CardContent sx={{ textAlign: 'center' }}>
                        <Typography variant="h5" className='hall-card-title'>{hall}</Typography>
                        <Typography variant="body1" className='hall-card-count'>
                          {mapToUse[hall].length} Request{mapToUse[hall].length > 1 ? 's' : ''}
                        </Typography>
                        <Button 
                          variant="contained" 
                          className='hall-card-btn'
                          onClick={() => handleHallClick(hall, mapToUse[hall])}
                        >
                          View Requests
                        </Button>
                      </CardContent>
                    </Card>
                  </Grid>
                ));
              })()}
            </Grid>
          )}

          {/* --- VIEW 3: REQUEST LIST --- */}
          {viewMode === 'REQUEST_LIST' && selectedHallGroup && (
            <div className="request-list-container">
               <h3 className="sub-hall-title">Hall: {selectedHallGroup.name}</h3>
               <Grid container spacing={4} justifyContent={'center'}>
                  {selectedHallGroup.requests.map((data) => (
                    <Grid item xs={11} sm={6} md={4} lg={3} key={data._id} display="flex" justifyContent="center">
                      <AdminBookingCard data={data} getrequest={get_booking_requests} />
                    </Grid>
                  ))}
               </Grid>
            </div>
          )}

        </Container>
      </div>
    </>
  );
}