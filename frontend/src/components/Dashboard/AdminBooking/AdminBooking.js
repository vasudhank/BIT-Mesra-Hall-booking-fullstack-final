import React, { useEffect, useRef, useState } from 'react';
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
import Checkbox from '@mui/material/Checkbox';
import api from '../../../api/axiosInstance';
import { changeBookingRequestApi } from '../../../api/changebookingrequestapi';
import { Container, useMediaQuery, useTheme, FormControl, Select, MenuItem } from '@mui/material';

export default function AdminBooking() {

  const pageRootRef = useRef(null);
  const [bookingRequests, setBookingRequests] = useState([]); 
  const [filteredRequests, setFilteredRequests] = useState([]); 
  const [open, setOpen] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedRequestIds, setSelectedRequestIds] = useState([]);
  const [sortMode, setSortMode] = useState('TIME_ASC');
  const [showAppbar, setShowAppbar] = useState(true);
  const [showBulkStrip, setShowBulkStrip] = useState(true);
  const [showConflictStrip, setShowConflictStrip] = useState(true);
  const [showHeaderTitle, setShowHeaderTitle] = useState(true);
  const [showViewportStrip, setShowViewportStrip] = useState(true);

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
  const viewportToolsRef = useRef(null);
  const bulkStripRef = useRef(null);
  const bulkAnchorRef = useRef(null);
  const [appbarHeight, setAppbarHeight] = useState(64);
  const [viewportStripHeight, setViewportStripHeight] = useState(0);
  const [bulkStripHeight, setBulkStripHeight] = useState(0);
  const [pinBulkStrip, setPinBulkStrip] = useState(false);

  const sortRequests = (requests, mode) => {
    const cloned = [...requests];
    return cloned.sort((a, b) => {
      const hallA = String(a.hall || '');
      const hallB = String(b.hall || '');
      const facultyA = String(a.department?.department || a.department?.head || '');
      const facultyB = String(b.department?.department || b.department?.head || '');
      const timeA = new Date(a.startDateTime).getTime() || 0;
      const timeB = new Date(b.startDateTime).getTime() || 0;

      if (mode === 'HALL_ASC') {
        return hallA.localeCompare(hallB, undefined, { numeric: true, sensitivity: 'base' }) || timeA - timeB;
      }
      if (mode === 'HALL_DESC') {
        return hallB.localeCompare(hallA, undefined, { numeric: true, sensitivity: 'base' }) || timeA - timeB;
      }
      if (mode === 'FACULTY_ASC') {
        return facultyA.localeCompare(facultyB, undefined, { numeric: true, sensitivity: 'base' }) ||
          hallA.localeCompare(hallB, undefined, { numeric: true, sensitivity: 'base' }) ||
          timeA - timeB;
      }
      if (mode === 'TIME_DESC') return timeB - timeA;
      return timeA - timeB;
    });
  };

  const applySearchAndSort = (requests, searchTerm, mode) => {
    const term = String(searchTerm || '').trim().toLowerCase();
    const searched = !term
      ? [...requests]
      : requests.filter(req =>
          (req.hall || "").toLowerCase().includes(term) ||
          (req.department?.department || "").toLowerCase().includes(term) ||
          (req.department?.head || "").toLowerCase().includes(term) ||
          (req.department?.email || "").toLowerCase().includes(term) ||
          (req.event || "").toLowerCase().includes(term)
        );
    return sortRequests(searched, mode);
  };

  // --- 1. DATA FETCHING ---
  const get_booking_requests = async () => {
    setOpen(true);
    try {
      const response = await api.get('/booking/show_booking_requests', {
        withCredentials: true
      });
      const data = response.data.booking_requests || [];
      setBookingRequests(data);
      setFilteredRequests(applySearchAndSort(data, search, sortMode));
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

  useEffect(() => {
    const validIds = new Set(bookingRequests.map((req) => req._id));
    setSelectedRequestIds((prev) => prev.filter((id) => validIds.has(id)));
  }, [bookingRequests]);

  useEffect(() => {
    setFilteredRequests(applySearchAndSort(bookingRequests, search, sortMode));
  }, [bookingRequests, search, sortMode]);

  useEffect(() => {
    if (!showAppbar) return;

    const measureAppbar = () => {
      const appbar = document.querySelector('.appbar');
      if (appbar) {
        setAppbarHeight(Math.round(appbar.getBoundingClientRect().height));
      }
    };

    const rafId = requestAnimationFrame(measureAppbar);
    window.addEventListener('resize', measureAppbar);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', measureAppbar);
    };
  }, [showAppbar, isMobile]);

  useEffect(() => {
    const measureViewportStrip = () => {
      setViewportStripHeight(viewportToolsRef.current?.offsetHeight || 0);
    };

    measureViewportStrip();
    window.addEventListener('resize', measureViewportStrip);
    return () => window.removeEventListener('resize', measureViewportStrip);
  }, [showViewportStrip, showAppbar, isMobile, sortMode]);

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
      setFilteredRequests(applySearchAndSort(bookingRequests, search, sortMode));
    } else {
      setViewMode('HALL_LIST');
    }
  };

  const handleHallClick = (hallName, requests) => {
    setSelectedHallGroup({ name: hallName, requests: sortRequests(requests, sortMode) });
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
    if (val.trim() === "") setFilteredRequests(applySearchAndSort(bookingRequests, "", sortMode));
  };

  const onSearchSubmit = () => {
    setFilteredRequests(applySearchAndSort(bookingRequests, search, sortMode));
    setViewMode('ALL'); 
    setActiveCategory('ALL');
  };

  const getMapForActiveCategory = () => {
    if (activeCategory === 'TIME') return categorizedData.timeConflicts;
    if (activeCategory === 'DATE') return categorizedData.dateConflicts;
    if (activeCategory === 'SAFE') return categorizedData.noConflicts;
    return {};
  };

  const getVisibleRequests = () => {
    if (viewMode === 'ALL') return sortRequests(filteredRequests, sortMode);
    if (viewMode === 'REQUEST_LIST') return sortRequests(selectedHallGroup?.requests || [], sortMode);
    if (viewMode === 'HALL_LIST') return sortRequests(Object.values(getMapForActiveCategory()).flat(), sortMode);
    return [];
  };

  const toggleRequestSelection = (id) => {
    setSelectedRequestIds((prev) =>
      prev.includes(id) ? prev.filter((reqId) => reqId !== id) : [...prev, id]
    );
  };

  const toggleSelectAllVisible = (visibleIds, allSelected) => {
    setSelectedRequestIds((prev) => {
      const merged = new Set(prev);
      if (allSelected) {
        visibleIds.forEach((id) => merged.delete(id));
      } else {
        visibleIds.forEach((id) => merged.add(id));
      }
      return Array.from(merged);
    });
  };

  const mapDecisionForRequest = (request, actionType) => {
    const isAutoBooked = request.status === 'AUTO_BOOKED';
    if (actionType === 'PRIMARY') return isAutoBooked ? 'Vacate' : 'Yes';
    return isAutoBooked ? 'Leave' : 'No';
  };

  const runBulkDecision = async (requests, actionType, label) => {
    if (!requests.length) return;

    const confirmMsg = `Are you sure you want to ${label} (${requests.length} request${requests.length > 1 ? 's' : ''})?`;
    if (!window.confirm(confirmMsg)) return;

    setOpen(true);
    try {
      const operations = requests.map((req) => {
        const decision = mapDecisionForRequest(req, actionType);
        return changeBookingRequestApi({ decision, id: req._id });
      });

      const results = await Promise.allSettled(operations);
      const successCount = results.filter((r) => r.status === 'fulfilled').length;
      const failedCount = results.length - successCount;

      await get_booking_requests();
      setSelectedRequestIds([]);

      if (failedCount > 0) {
        window.alert(`${successCount} request(s) updated, ${failedCount} failed.`);
      }
    } catch (err) {
      console.log(err);
      window.alert('Bulk action failed. Please try again.');
    } finally {
      setOpen(false);
    }
  };

  const visibleRequests = getVisibleRequests();
  const visibleIds = visibleRequests.map((req) => req._id).filter(Boolean);
  const selectedVisibleRequests = visibleRequests.filter((req) => selectedRequestIds.includes(req._id));
  const selectedVisibleCount = selectedVisibleRequests.length;
  const allVisibleSelected = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;
  const viewportStripTop = showAppbar ? appbarHeight + (isMobile ? 8 : 0) : 8;
  const contentTopOffset = viewportStripTop + (showViewportStrip ? viewportStripHeight + 8 : 0);
  const bulkStickyTop = viewportStripTop + (showViewportStrip ? viewportStripHeight : 0);
  const showBulkActionsStrip = showBulkStrip || (showConflictStrip && viewMode !== 'REQUEST_LIST');

  useEffect(() => {
    if (!showBulkActionsStrip) {
      setBulkStripHeight(0);
      return;
    }

    const el = bulkStripRef.current;
    if (!el) return;

    const updateHeight = () => setBulkStripHeight(el.offsetHeight || 0);
    updateHeight();

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateHeight) : null;
    if (observer) observer.observe(el);
    window.addEventListener('resize', updateHeight);

    return () => {
      if (observer) observer.disconnect();
      window.removeEventListener('resize', updateHeight);
    };
  }, [showBulkActionsStrip, showBulkStrip, showConflictStrip, viewMode, selectedVisibleCount, counts.time, counts.date, counts.safe]);

  useEffect(() => {
    if (!showBulkActionsStrip) {
      setPinBulkStrip(false);
      return;
    }

    const updatePinState = () => {
      const anchor = bulkAnchorRef.current;
      if (!anchor) return;
      const anchorTop = anchor.getBoundingClientRect().top;
      setPinBulkStrip(anchorTop <= bulkStickyTop);
    };

    const scrollHost = pageRootRef.current;
    updatePinState();

    // Listen on both window and page host because scroll context can vary across layouts.
    window.addEventListener('scroll', updatePinState, { passive: true });
    window.addEventListener('resize', updatePinState);
    if (scrollHost) {
      scrollHost.addEventListener('scroll', updatePinState, { passive: true });
    }

    let observer;
    if (bulkAnchorRef.current && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          // When sentinel leaves the adjusted root, it has crossed the pin line.
          setPinBulkStrip(!entry.isIntersecting);
        },
        {
          root: null,
          threshold: 0,
          rootMargin: `-${bulkStickyTop}px 0px 0px 0px`
        }
      );
      observer.observe(bulkAnchorRef.current);
    }

    return () => {
      window.removeEventListener('scroll', updatePinState);
      window.removeEventListener('resize', updatePinState);
      if (scrollHost) {
        scrollHost.removeEventListener('scroll', updatePinState);
      }
      if (observer) observer.disconnect();
    };
  }, [showBulkActionsStrip, bulkStickyTop, showHeaderTitle, showViewportStrip, showAppbar, isMobile]);

  const renderBulkActionBar = () => (
    <div
      ref={bulkStripRef}
      className={`bulk-actions-container${pinBulkStrip ? ' bulk-actions-fixed' : ''}`}
      style={pinBulkStrip ? { top: `${bulkStickyTop}px` } : undefined}
    >
      {showBulkStrip && viewMode !== 'HALL_LIST' && (
        <label className='bulk-select-all-inline' title='Select all visible requests'>
          <Checkbox
            size='small'
            checked={allVisibleSelected}
            onChange={() => toggleSelectAllVisible(visibleIds, allVisibleSelected)}
            disabled={!visibleIds.length}
            sx={{ color: 'rgba(255,255,255,0.82)', '&.Mui-checked': { color: '#00d4ff' } }}
          />
        </label>
      )}

      {showBulkStrip && viewMode !== 'HALL_LIST' && (
        <>
          <button
            className='bulk-btn bulk-btn-accept'
            onClick={() => runBulkDecision(selectedVisibleRequests, 'PRIMARY', 'accept/vacate selected')}
            disabled={!selectedVisibleCount}
          >
            Accept
          </button>
          <button
            className='bulk-btn bulk-btn-reject'
            onClick={() => runBulkDecision(selectedVisibleRequests, 'SECONDARY', 'reject/leave selected')}
            disabled={!selectedVisibleCount}
          >
            Reject
          </button>
        </>
      )}

      {showBulkStrip && showConflictStrip && viewMode !== 'REQUEST_LIST' && (
        <div className='bulk-strip-gap' aria-hidden='true' />
      )}

      {showConflictStrip && viewMode !== 'REQUEST_LIST' && (
        <button
          className={`filter-btn ${activeCategory === 'ALL' ? 'active' : ''}`}
          onClick={() => handleFilterClick('ALL')}
        >
          All Requests
        </button>
      )}

      {showConflictStrip && viewMode !== 'REQUEST_LIST' && (
        <button
          className={`filter-btn conflict-time ${activeCategory === 'TIME' ? 'active' : ''}`}
          onClick={() => handleFilterClick('TIME')}
        >
          Time Conflicts
          {counts.time > 0 && <span className="filter-btn-badge">{counts.time}</span>}
        </button>
      )}

      {showConflictStrip && viewMode !== 'REQUEST_LIST' && (
        <button
          className={`filter-btn conflict-date ${activeCategory === 'DATE' ? 'active' : ''}`}
          onClick={() => handleFilterClick('DATE')}
        >
          Date Overlaps
          {counts.date > 0 && <span className="filter-btn-badge">{counts.date}</span>}
        </button>
      )}

      {showConflictStrip && viewMode !== 'REQUEST_LIST' && (
        <button
          className={`filter-btn no-conflict ${activeCategory === 'SAFE' ? 'active' : ''}`}
          onClick={() => handleFilterClick('SAFE')}
        >
          No Overlaps
          {counts.safe > 0 && <span className="filter-btn-badge">{counts.safe}</span>}
        </button>
      )}
    </div>
  );

  return (
    <>
      <Backdrop sx={{ color: '#fff', zIndex: (theme) => theme.zIndex.drawer + 1 }} open={open}>
        <CircularProgress color="inherit" />
      </Backdrop>

      <div ref={pageRootRef} className='admin-booking-body'>
        {showAppbar && (
          <Appbar
            showSearch={viewMode === 'ALL'}
            searchValue={search}
            onSearchChange={onSearchChange}
            onSearchSubmit={onSearchSubmit}
            mobileStripToggleVisible={!showViewportStrip}
            onMobileStripToggle={() => setShowViewportStrip(true)}
          />
        )}

        <Container maxWidth="xl" sx={{ mt: 0, pt: `${contentTopOffset}px` }}> 
          {showViewportStrip ? (
            <div
              ref={viewportToolsRef}
              className='booking-viewport-tools'
              style={{ top: viewportStripTop }}
            >
              <button className='viewport-tool-btn' onClick={() => setShowAppbar((v) => !v)}>
                {showAppbar ? 'Hide Appbar' : 'Show Appbar'}
              </button>
              <button className='viewport-tool-btn' onClick={() => setShowBulkStrip((v) => !v)}>
                {showBulkStrip ? 'Hide Select Strip' : 'Show Select Strip'}
              </button>
              <button className='viewport-tool-btn' onClick={() => setShowConflictStrip((v) => !v)}>
                {showConflictStrip ? 'Hide Conflict Strip' : 'Show Conflict Strip'}
              </button>
              <button className='viewport-tool-btn' onClick={() => setShowHeaderTitle((v) => !v)}>
                {showHeaderTitle ? 'Hide Title' : 'Show Title'}
              </button>
              <button className='viewport-tool-btn viewport-collapse-btn' onClick={() => setShowViewportStrip(false)}>
                Collapse Strip
              </button>

              <div className='booking-sort-wrap'>
                <span className='booking-sort-label'>Sort</span>
                <FormControl size='small' className='booking-sort-control'>
                  <Select value={sortMode} onChange={(e) => setSortMode(e.target.value)}>
                    <MenuItem value='TIME_ASC'>Time (Earlier-Later)</MenuItem>
                    <MenuItem value='TIME_DESC'>Time (Later-Earlier)</MenuItem>
                    <MenuItem value='HALL_ASC'>Hall (A-Z)</MenuItem>
                    <MenuItem value='HALL_DESC'>Hall (Z-A)</MenuItem>
                    <MenuItem value='FACULTY_ASC'>Faculty Grouped</MenuItem>
                  </Select>
                </FormControl>
              </div>
            </div>
          ) : (
            (!isMobile || !showAppbar || viewMode !== 'ALL') && (
            <button
              className='booking-tools-toggle-btn'
              style={{ top: showAppbar ? appbarHeight + 12 : 10 }}
              onClick={() => setShowViewportStrip(true)}
              aria-label='Show booking options'
              title='Show options'
            >
              <span className='booking-tools-toggle-icon' aria-hidden='true'>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" id="collapse-right">
                  <path d="M11,17a1,1,0,0,1-.71-1.71L13.59,12,10.29,8.71a1,1,0,0,1,1.41-1.41l4,4a1,1,0,0,1,0,1.41l-4,4A1,1,0,0,1,11,17Z"></path>
                  <path d="M15 13H5a1 1 0 0 1 0-2H15a1 1 0 0 1 0 2zM19 20a1 1 0 0 1-1-1V5a1 1 0 0 1 2 0V19A1 1 0 0 1 19 20z"></path>
                </svg>
              </span>
            </button>
            )
          )}
          
          {showHeaderTitle && (
            <Grid container justifyContent={'center'} className='admin-booking-header-grid'>
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
          )}

          {showBulkActionsStrip && <div ref={bulkAnchorRef} className='bulk-actions-anchor' />}
          {showBulkActionsStrip && pinBulkStrip && (
            <div className='bulk-actions-placeholder' style={{ height: `${bulkStripHeight}px` }} />
          )}
          {showBulkActionsStrip && renderBulkActionBar()}

          {/* --- VIEW 1: MAIN DASHBOARD (ALL) --- */}
          {viewMode === 'ALL' && (
            <Grid container spacing={2} justifyContent={'center'}>
              {filteredRequests.map((data) => (
                <Grid item xs={12} sm={6} md={4} lg={3} key={data._id} display="flex" justifyContent="center">
                  <AdminBookingCard
                    data={data}
                    getrequest={get_booking_requests}
                    isSelected={selectedRequestIds.includes(data._id)}
                    onToggleSelect={toggleRequestSelection}
                  />
                </Grid>
              ))}
              {filteredRequests.length === 0 && !open && (
                <h3 className="no-data-text">No requests found.</h3>
              )}
            </Grid>
          )}

          {/* --- VIEW 2: HALL LIST --- */}
          {viewMode === 'HALL_LIST' && (
            <Grid container spacing={2} justifyContent={'center'}>
              {(() => {
                const mapToUse = getMapForActiveCategory();
                const hallKeys = Object.keys(mapToUse).sort((a, b) =>
                  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
                );

                if (hallKeys.length === 0) return <h3 className="no-data-text">No Halls found in this category.</h3>;

                return hallKeys.map(hall => (
                  <Grid item xs={12} sm={6} md={4} lg={3} key={hall} display="flex" justifyContent="center">
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
               <Grid container spacing={2} justifyContent={'center'}>
                  {sortRequests(selectedHallGroup.requests, sortMode).map((data) => (
                    <Grid item xs={12} sm={6} md={4} lg={3} key={data._id} display="flex" justifyContent="center">
                      <AdminBookingCard
                        data={data}
                        getrequest={get_booking_requests}
                        isSelected={selectedRequestIds.includes(data._id)}
                        onToggleSelect={toggleRequestSelection}
                      />
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
