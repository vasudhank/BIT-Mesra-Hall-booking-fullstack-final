import React, { useEffect, useState } from 'react';
import Appbar from "../AppBar/AppBar";
import "./AdminDepartment.css";
import Grid from '@mui/material/Grid';
import Button from '@mui/material/Button';
import { Container, useMediaQuery, useTheme } from '@mui/material';
import Checkbox from '@mui/material/Checkbox';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import { CardActionArea } from '@mui/material';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Person2Icon from '@mui/icons-material/Person2';
import EmailIcon from '@mui/icons-material/Email';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import Backdrop from '@mui/material/Backdrop';
import CircularProgress from '@mui/material/CircularProgress';
import api from '../../../api/axiosInstance';
import Modal from '@mui/material/Modal';
import Box from '@mui/material/Box';
import FormControl from '@mui/material/FormControl';
import Input from '@mui/material/Input';
import { createDepartmentApi } from "../../../api/createdepartmentapi";
import { deleteDepartmentApi } from "../../../api/deletedepartmentapi";

export default function AdminDepartment() {

  const [open, setOpen] = useState(true);
  const [list, setlist] = useState([]); // Raw data
  const [filteredList, setFilteredList] = useState([]); // Displayed data
  
  // Modal & Form State
  const [modal, setmodal] = useState(false);
  const [email, setemail] = useState("");
  const [password, setpassword] = useState('');
  const [department, setdepartment] = useState("");
  const [head, sethead] = useState('');
  const [deletingIds, setDeletingIds] = useState([]);
  const [selectedDepartmentIds, setSelectedDepartmentIds] = useState([]);
  const [showControlStrip, setShowControlStrip] = useState(true);
  
  // Search State
  const [search, setSearch] = useState("");
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  /* ================= SEARCH LOGIC ================= */
  const onSearchChange = (e) => {
    const val = e.target.value;
    setSearch(val);
    if (val.trim() === "") {
      setFilteredList(list);
    }
  };

  const onSearchSubmit = () => {
    if (!search.trim()) {
      setFilteredList(list);
      return;
    }
    const q = search.toLowerCase();
    const filtered = list.filter(dept => 
      (dept.department && dept.department.toLowerCase().includes(q)) ||
      (dept.head && dept.head.toLowerCase().includes(q)) ||
      (dept.email && dept.email.toLowerCase().includes(q))
    );
    setFilteredList(filtered);
  };

  /* ================= API CALLS ================= */
  const get_departments = async () => {
    setOpen(true);
    try {
      const response = await api.get("/department/show_departments");
      const data = response.data.departments || [];
      setlist(data);
      setFilteredList(data);
    } catch (err) {
      console.log(err);
    }
    setOpen(false);
  };

  useEffect(() => {
    const validIds = new Set(list.map((dept) => dept._id));
    setSelectedDepartmentIds((prev) => prev.filter((id) => validIds.has(id)));
  }, [list]);

  const createDepartment = () => {
    setmodal(true);
  };

  const handleDeleteDepartment = async (id, departmentName) => {
    if (!id) return;
    const confirmed = window.confirm(`Are you sure you want to delete ${departmentName}? This cannot be undone.`);
    if (!confirmed) return;

    setDeletingIds((prev) => [...prev, id]);
    try {
      await deleteDepartmentApi(id);
      setlist((prev) => prev.filter((dept) => dept._id !== id));
      setFilteredList((prev) => prev.filter((dept) => dept._id !== id));
      setSelectedDepartmentIds((prev) => prev.filter((deptId) => deptId !== id));
    } catch (err) {
      console.error("Failed to delete department:", err);
      window.alert("Failed to delete faculty. Please try again.");
    } finally {
      setDeletingIds((prev) => prev.filter((deptId) => deptId !== id));
    }
  };

  const handleClose = () => {
    setmodal(false);
    setemail("");
    setpassword("");
    setdepartment("");
    sethead("");
  };

  const handleCreateDepartmentSubmit = async (e) => {
    e.preventDefault();
    setmodal(false);
    setOpen(true);
    const data = {
      email: email,
      password: password,
      department: department,
      head: head
    };

    try {
      // eslint-disable-next-line no-unused-vars
      const response = await createDepartmentApi(data);
      get_departments();
    } catch (err) {
      console.log(err);
      setOpen(false);
    }
    
    setemail("");
    setpassword("");
    setdepartment("");
    sethead("");
  };

  useEffect(() => {
    get_departments();
  }, []);

  const toggleDepartmentSelection = (id) => {
    setSelectedDepartmentIds((prev) =>
      prev.includes(id) ? prev.filter((deptId) => deptId !== id) : [...prev, id]
    );
  };

  const allDepartmentIds = list.map((dept) => dept._id);
  const allVisibleSelected =
    allDepartmentIds.length > 0 &&
    allDepartmentIds.every((id) => selectedDepartmentIds.includes(id));

  const toggleSelectAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedDepartmentIds([]);
      return;
    }
    setSelectedDepartmentIds(allDepartmentIds);
  };

  const handleDeleteSelectedDepartments = async () => {
    const targets = list.filter((dept) => selectedDepartmentIds.includes(dept._id));
    if (!targets.length) return;

    const confirmDelete = window.confirm(
      `Delete ${targets.length} selected facult${targets.length > 1 ? 'ies' : 'y'}? This cannot be undone.`
    );
    if (!confirmDelete) return;

    const targetIds = targets.map((dept) => dept._id);
    setDeletingIds((prev) => Array.from(new Set([...prev, ...targetIds])));

    try {
      const results = await Promise.allSettled(targetIds.map((id) => deleteDepartmentApi(id)));
      const successIds = targetIds.filter((_, idx) => results[idx].status === 'fulfilled');
      const failedCount = targetIds.length - successIds.length;

      if (successIds.length > 0) {
        setlist((prev) => prev.filter((dept) => !successIds.includes(dept._id)));
        setFilteredList((prev) => prev.filter((dept) => !successIds.includes(dept._id)));
        setSelectedDepartmentIds((prev) => prev.filter((id) => !successIds.includes(id)));
      }

      if (failedCount > 0) {
        window.alert(`${failedCount} delete request(s) failed. Please retry.`);
      }
    } catch (err) {
      console.error('Bulk delete faculty failed:', err);
      window.alert('Bulk delete failed. Please retry.');
    } finally {
      setDeletingIds((prev) => prev.filter((id) => !targetIds.includes(id)));
    }
  };

  return (
    <>
      <Backdrop
        sx={{ color: '#fff', zIndex: (theme) => theme.zIndex.drawer + 1 }}
        open={open}
      >
        <CircularProgress color="inherit" />
      </Backdrop>

      <Modal
        open={modal}
        onClose={handleClose}
        aria-labelledby="modal-modal-title"
        aria-describedby="modal-modal-description"
      >
        <Box className='modal'>
          <Typography className='modal-text' sx={{ marginBottom: '1rem', fontFamily: 'RecklessNeue' }} variant="h6" component="h2">
            CREATE FACULTY
          </Typography>

          <form onSubmit={handleCreateDepartmentSubmit}>
            <FormControl fullWidth>
              <Input
                disableUnderline={true}
                type='email'
                placeholder="Email"
                required={true}
                value={email}
                className='admin-input'
                onChange={(e) => setemail(e.target.value)}
                sx={{ padding: '1rem' }}
              />
            </FormControl>
            <FormControl fullWidth>
              <Input
                disableUnderline={true}
                type='password'
                placeholder="Password"
                required={true}
                value={password}
                className='admin-input'
                onChange={(e) => setpassword(e.target.value)}
                sx={{ padding: '1rem' }}
              />
            </FormControl>
            <FormControl fullWidth>
              <Input
                disableUnderline={true}
                type='text'
                placeholder="Department Name"
                required={true}
                value={department}
                className='admin-input'
                onChange={(e) => setdepartment(e.target.value)}
                sx={{ padding: '1rem' }}
              />
            </FormControl>
            <FormControl fullWidth>
              <Input
                disableUnderline={true}
                type='text'
                placeholder="Faculty Name"
                required={true}
                value={head}
                className='admin-input'
                onChange={(e) => sethead(e.target.value)}
                sx={{ padding: '1rem' }}
              />
            </FormControl>

            <Button size="medium" fullWidth className='btn-admin-hall' type='submit'>CREATE FACULTY</Button>

          </form>
        </Box>
      </Modal>

      <div className='admin-department-body'>
        
        {/* 1. Appbar */}
        <Appbar
          showSearch={true}
          searchValue={search}
          onSearchChange={onSearchChange}
          onSearchSubmit={onSearchSubmit}
          searchPlaceholder="Search departments..."
          mobileStripToggleVisible={!showControlStrip}
          onMobileStripToggle={() => setShowControlStrip(true)}
        />

        <Container maxWidth="xl" sx={{ mt: 0 }}>
          
          {/* 2. FIXED Create Button Container */}
          {showControlStrip ? (
            <Box className="fixed-create-btn-container">
              <Box className="admin-department-bulk-controls">
                
                  <Checkbox
                    size="small"
                    checked={allVisibleSelected}
                    onChange={toggleSelectAllVisible}
                    sx={{ color: 'white', '&.Mui-checked': { color: '#00d4ff' } }}
                  />
                <Tooltip
                  title={selectedDepartmentIds.length
                    ? `Delete Selected (${selectedDepartmentIds.length})`
                    : 'Select faculties to delete'}
                  arrow
                >
                  <span className='admin-department-bulk-delete-wrap'>
                    <IconButton
                      size="small"
                      className="admin-department-bulk-delete-icon"
                      onClick={handleDeleteSelectedDepartments}
                      disabled={!selectedDepartmentIds.length}
                      aria-label={`Delete selected faculties (${selectedDepartmentIds.length})`}
                    >
                      <DeleteOutlineRoundedIcon fontSize='small' />
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>

              <Box className="admin-department-strip-right">
                <Button
                  size="small"
                  className="btn-admin-department-strip-collapse"
                  onClick={() => setShowControlStrip(false)}
                >
                  Collapse Strip
                </Button>

                <Button size="medium" className='btn-admin-department' onClick={createDepartment}>
                  CREATE FACULTY
                </Button>
              </Box>
            </Box>
          ) : (
            !isMobile && (
            <button
              className='admin-department-strip-toggle-btn'
              onClick={() => setShowControlStrip(true)}
              aria-label='Show faculty controls'
              title='Show controls'
            >
              <span className='admin-department-strip-toggle-icon' aria-hidden='true'>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" id="collapse-right">
                  <path d="M11,17a1,1,0,0,1-.71-1.71L13.59,12,10.29,8.71a1,1,0,0,1,1.41-1.41l4,4a1,1,0,0,1,0,1.41l-4,4A1,1,0,0,1,11,17Z"></path>
                  <path d="M15 13H5a1 1 0 0 1 0-2H15a1 1 0 0 1 0 2zM19 20a1 1 0 0 1-1-1V5a1 1 0 0 1 2 0V19A1 1 0 0 1 19 20z"></path>
                </svg>
              </span>
            </button>
            )
          )}

          {/* 3. Title Below Fixed Button */}
          <Grid container justifyContent={'center'} alignItems="center" sx={{ mt: 0.5, mb: 2 }}>
            <Grid item xs={12}>
              <div className='admin-department-title-div'>
                <h2 className='admin-department-title'>FACULTIES</h2>
              </div>
            </Grid>
          </Grid>

          {/* 4. List of Cards */}
          <Container>
            <Grid container spacing={4} justifyContent={'center'}>
              {filteredList.map((data, index) => (
                <Grid item xs={12} sm={10} md={6} lg={4} key={data._id || index}>
                  <Card sx={{ height: '100%', position: 'relative' }} className='admin-department-card'>
                    <span className='admin-department-select-anchor'>
                      <Checkbox
                        size="small"
                        className='admin-department-select-checkbox'
                        checked={selectedDepartmentIds.includes(data._id)}
                        onChange={() => toggleDepartmentSelection(data._id)}
                        inputProps={{ 'aria-label': `Select ${data.department}` }}
                      />
                    </span>

                    <Tooltip title="Delete faculty" placement="left" arrow>
                      <span className='admin-department-delete-anchor'>
                        <IconButton
                          className='admin-department-delete-btn'
                          onClick={() => handleDeleteDepartment(data._id, data.department)}
                          aria-label={`Delete ${data.department}`}
                          disabled={deletingIds.includes(data._id)}
                        >
                          <DeleteOutlineRoundedIcon fontSize='small' />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <CardActionArea>
                      <CardContent sx={{ pt: 4 }}>
                        <Typography gutterBottom variant="h5" className='admin-department-text' component="div" sx={{ mb: 2 }}>
                          {data.department}
                        </Typography>
                        
                        <Box display="flex" alignItems="center" mb={1}>
                          <Person2Icon sx={{ marginRight: "1rem", color: 'white' }} />
                          <Typography variant="body2" className='admin-department-text'>
                            {data.head}
                          </Typography>
                        </Box>

                        <Box display="flex" alignItems="center">
                          <EmailIcon sx={{ marginRight: "1rem", color: 'white' }} />
                          <Typography variant="body2" className='admin-department-text'>
                            {data.email}
                          </Typography>
                        </Box>
                      </CardContent>
                    </CardActionArea>
                  </Card>
                </Grid>
              ))}
              {filteredList.length === 0 && !open && (
                <Typography variant="h6" sx={{ color: 'white', mt: 4, fontFamily: 'Inter' }}>
                  No departments found.
                </Typography>
              )}
            </Grid>
          </Container>
        </Container>

      </div>
    </>
  )
}
