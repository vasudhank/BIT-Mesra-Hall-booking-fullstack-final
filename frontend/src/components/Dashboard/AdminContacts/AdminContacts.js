import React, { useEffect, useMemo, useState } from 'react';
import './AdminContacts.css';
import Appbar from '../AppBar/AppBar';
import {
  Alert,
  Backdrop,
  Box,
  Button,
  Card,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputBase,
  MenuItem,
  Select,
  Snackbar,
  Tooltip,
  Typography
} from '@mui/material';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import { adminAddContactApi, adminUpdateContactApi, getContactsApi } from '../../../api/contactApi';

const SORT_OPTIONS = [
  { value: 'name_asc', label: 'Name (A-Z)' },
  { value: 'name_desc', label: 'Name (Z-A)' },
  { value: 'phone_asc', label: 'Phone (Low-High)' },
  { value: 'phone_desc', label: 'Phone (High-Low)' }
];

const applySearchFilter = (sourceContacts, query) => {
  if (!query.trim()) return sourceContacts;
  const lower = query.toLowerCase();
  return sourceContacts.filter((contact) =>
    (contact.name || '').toLowerCase().includes(lower) ||
    (contact.number || '').toLowerCase().includes(lower) ||
    (contact.email || '').toLowerCase().includes(lower)
  );
};

const sortContacts = (sourceContacts, sortBy) => {
  const next = [...sourceContacts];

  if (sortBy === 'name_asc') {
    next.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));
    return next;
  }

  if (sortBy === 'name_desc') {
    next.sort((a, b) => String(b.name || '').localeCompare(String(a.name || ''), undefined, { sensitivity: 'base' }));
    return next;
  }

  if (sortBy === 'phone_asc') {
    next.sort((a, b) => Number(String(a.number || '').replace(/\D/g, '')) - Number(String(b.number || '').replace(/\D/g, '')));
    return next;
  }

  if (sortBy === 'phone_desc') {
    next.sort((a, b) => Number(String(b.number || '').replace(/\D/g, '')) - Number(String(a.number || '').replace(/\D/g, '')));
    return next;
  }

  return next;
};

const applySearchAndSort = (sourceContacts, query, sortBy) => sortContacts(applySearchFilter(sourceContacts, query), sortBy);

export default function AdminContacts() {
  const [loading, setLoading] = useState(true);
  const [contacts, setContacts] = useState([]);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [sortBy, setSortBy] = useState('name_asc');

  const [editing, setEditing] = useState({ id: null, field: null });
  const [draftValue, setDraftValue] = useState('');
  const [savingKey, setSavingKey] = useState('');

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addSaving, setAddSaving] = useState(false);
  const [newContact, setNewContact] = useState({ name: '', number: '', email: '' });

  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const filteredContacts = useMemo(
    () => applySearchAndSort(contacts, appliedSearch, sortBy),
    [contacts, appliedSearch, sortBy]
  );

  const loadContacts = async () => {
    setLoading(true);
    try {
      const res = await getContactsApi();
      if (res?.error) {
        throw new Error(res.error);
      }
      const incoming = res?.data?.contacts || [];
      setContacts(incoming);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to load contacts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadContacts();
  }, []);

  const onSearchChange = (e) => {
    const val = e.target.value;
    setSearch(val);
    if (val === '') {
      setAppliedSearch('');
    }
  };

  const onSearchSubmit = () => {
    setAppliedSearch(search);
  };

  const getEditKey = (id, field) => `${id}:${field}`;

  const isEditingCell = (id, field) =>
    editing.id === id && editing.field === field;

  const startEdit = (contact, field) => {
    setEditing({ id: contact._id, field });
    setDraftValue(contact[field] || '');
  };

  const cancelEdit = () => {
    setEditing({ id: null, field: null });
    setDraftValue('');
    setSavingKey('');
  };

  const saveEdit = async () => {
    if (!editing.id || !editing.field) return;

    const nextValue = editing.field === 'number'
      ? draftValue.replace(/\D/g, '').slice(0, 15)
      : draftValue.trim();

    if (editing.field === 'number' && !/^\d{10,15}$/.test(nextValue)) {
      setErrorMsg('Phone number must contain 10 to 15 digits');
      return;
    }

    if (editing.field === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextValue)) {
      setErrorMsg('Please provide a valid email address');
      return;
    }

    const key = getEditKey(editing.id, editing.field);
    setSavingKey(key);

    try {
      await adminUpdateContactApi(editing.id, {
        field: editing.field,
        value: nextValue
      });

      const updatedContacts = contacts.map((item) =>
        item._id === editing.id ? { ...item, [editing.field]: nextValue } : item
      );

      setContacts(updatedContacts);
      setSuccessMsg('Contact updated successfully');
      cancelEdit();
    } catch (err) {
      setErrorMsg(err?.data?.message || 'Failed to update contact');
      setSavingKey('');
    }
  };

  const openAddDialog = () => {
    setNewContact({ name: '', number: '', email: '' });
    setAddDialogOpen(true);
  };

  const closeAddDialog = () => {
    if (addSaving) return;
    setAddDialogOpen(false);
  };

  const saveNewContact = async () => {
    const payload = {
      name: String(newContact.name || '').trim(),
      number: String(newContact.number || '').replace(/\D/g, '').slice(0, 15),
      email: String(newContact.email || '').trim()
    };

    if (!payload.name) {
      setErrorMsg('Name is required');
      return;
    }

    if (!/^\d{10,15}$/.test(payload.number)) {
      setErrorMsg('Phone number must contain 10 to 15 digits');
      return;
    }

    if (payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
      setErrorMsg('Please provide a valid email address');
      return;
    }

    setAddSaving(true);
    try {
      const res = await adminAddContactApi(payload);
      const created = res?.data?.contact;
      if (!created) {
        throw new Error('Contact could not be created');
      }
      setContacts((prev) => [...prev, created]);
      setSuccessMsg('Contact added successfully');
      setAddDialogOpen(false);
    } catch (err) {
      setErrorMsg(err?.data?.message || 'Failed to add contact');
    } finally {
      setAddSaving(false);
    }
  };

  const renderEditableCell = (contact, field, placeholder) => {
    const key = getEditKey(contact._id, field);
    const inEdit = isEditingCell(contact._id, field);
    const saving = savingKey === key;
    const value = contact[field] || '-';

    if (inEdit) {
      return (
        <Box className='admin-contacts-edit-wrap'>
          <InputBase
            value={draftValue}
            onChange={(e) => {
              if (field === 'number') {
                setDraftValue(e.target.value.replace(/\D/g, '').slice(0, 15));
              } else {
                setDraftValue(e.target.value);
              }
            }}
            placeholder={placeholder}
            className='admin-contacts-edit-input'
            autoFocus
          />
          <Box className='admin-contacts-edit-actions'>
            <Tooltip title='Save' arrow>
              <span>
                <IconButton
                  size='small'
                  onClick={saveEdit}
                  disabled={saving}
                  className='admin-contacts-action-btn save'
                >
                  {saving ? <CircularProgress size={14} color='inherit' /> : <CheckRoundedIcon fontSize='small' />}
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title='Cancel' arrow>
              <IconButton
                size='small'
                onClick={cancelEdit}
                disabled={saving}
                className='admin-contacts-action-btn cancel'
              >
                <CloseRoundedIcon fontSize='small' />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      );
    }

    return (
      <Box className='admin-contacts-value-wrap'>
        <Typography className='admin-contacts-value-text' title={value}>
          {value}
        </Typography>
        <Tooltip title={`Edit ${field === 'number' ? 'phone number' : 'email'}`} arrow>
          <IconButton
            size='small'
            className='admin-contacts-action-btn edit'
            onClick={() => startEdit(contact, field)}
          >
            <EditOutlinedIcon fontSize='small' />
          </IconButton>
        </Tooltip>
      </Box>
    );
  };

  return (
    <>
      <Backdrop
        sx={{ color: '#fff', zIndex: (theme) => theme.zIndex.drawer + 1 }}
        open={loading}
      >
        <CircularProgress color='inherit' />
      </Backdrop>

      <div className='admin-contacts-body'>
        <Appbar
          showSearch={true}
          searchValue={search}
          onSearchChange={onSearchChange}
          onSearchSubmit={onSearchSubmit}
          searchPlaceholder='Search name, number or email...'
        />

        <div className='admin-contacts-mobile-controls'>
          <FormControl size='small' className='admin-contacts-sort-control'>
            <Select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              displayEmpty
            >
              {SORT_OPTIONS.map((opt) => (
                <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <Button
            className='admin-contacts-add-btn'
            variant='contained'
            onClick={openAddDialog}
            startIcon={<AddRoundedIcon />}
          >
            Add Contact
          </Button>
        </div>

        <Container maxWidth='xl'>
          <div className='admin-contacts-title-wrap'>
            <div className='admin-contacts-toolbar-left'>
              <Typography className='admin-contacts-toolbar-label'>Sort</Typography>
              <FormControl size='small' className='admin-contacts-sort-control'>
                <Select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                >
                  {SORT_OPTIONS.map((opt) => (
                    <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </div>

            <div className='admin-contacts-toolbar-center'>
              <h2 className='admin-contacts-title'>CONTACTS</h2>
              <p className='admin-contacts-subtitle'>Manage Wish Your Day contact details</p>
            </div>

            <div className='admin-contacts-toolbar-right'>
              <Button
                className='admin-contacts-add-btn'
                variant='contained'
                onClick={openAddDialog}
                startIcon={<AddRoundedIcon />}
              >
                Add Contact
              </Button>
            </div>
          </div>

          <Card className='admin-contacts-card'>
            <div className='admin-contacts-head'>
              <span>NAME</span>
              <span>PHONE NUMBER</span>
              <span>EMAIL ADDRESS</span>
            </div>

            <div className='admin-contacts-list'>
              {!loading && filteredContacts.length === 0 ? (
                <div className='admin-contacts-empty'>
                  {contacts.length === 0 ? 'No contacts found.' : 'No contacts match your search.'}
                </div>
              ) : (
                filteredContacts.map((contact) => (
                  <div className='admin-contacts-row' key={contact._id}>
                    <div className='admin-contacts-cell admin-contacts-name' title={contact.name || '-'}>
                      {contact.name || '-'}
                    </div>
                    <div className='admin-contacts-cell'>
                      {renderEditableCell(contact, 'number', 'Enter phone number')}
                    </div>
                    <div className='admin-contacts-cell'>
                      {renderEditableCell(contact, 'email', 'Enter email address')}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </Container>
      </div>

      <Dialog open={addDialogOpen} onClose={closeAddDialog} fullWidth maxWidth='xs'>
        <DialogTitle>Add Contact</DialogTitle>
        <DialogContent sx={{ pt: '12px !important' }}>
          <FormControl fullWidth sx={{ mb: 1.2 }}>
            <InputBase
              placeholder='Name'
              value={newContact.name}
              onChange={(e) => setNewContact((prev) => ({ ...prev, name: e.target.value }))}
              sx={{
                border: '1px solid rgba(15, 23, 42, 0.2)',
                borderRadius: 2,
                px: 1.2,
                py: 1
              }}
            />
          </FormControl>
          <FormControl fullWidth sx={{ mb: 1.2 }}>
            <InputBase
              placeholder='Phone Number (10-15 digits)'
              value={newContact.number}
              onChange={(e) => setNewContact((prev) => ({ ...prev, number: e.target.value.replace(/\D/g, '').slice(0, 15) }))}
              sx={{
                border: '1px solid rgba(15, 23, 42, 0.2)',
                borderRadius: 2,
                px: 1.2,
                py: 1
              }}
            />
          </FormControl>
          <FormControl fullWidth>
            <InputBase
              placeholder='Email Address (optional)'
              value={newContact.email}
              onChange={(e) => setNewContact((prev) => ({ ...prev, email: e.target.value }))}
              sx={{
                border: '1px solid rgba(15, 23, 42, 0.2)',
                borderRadius: 2,
                px: 1.2,
                py: 1
              }}
            />
          </FormControl>
        </DialogContent>
        <DialogActions sx={{ px: 2, pb: 2 }}>
          <Button onClick={closeAddDialog} disabled={addSaving}>Cancel</Button>
          <Button onClick={saveNewContact} variant='contained' disabled={addSaving}>
            {addSaving ? <CircularProgress size={18} color='inherit' /> : 'Add'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={Boolean(successMsg)}
        autoHideDuration={2600}
        onClose={() => setSuccessMsg('')}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Alert onClose={() => setSuccessMsg('')} severity='success' sx={{ width: '100%' }}>
          {successMsg}
        </Alert>
      </Snackbar>

      <Snackbar
        open={Boolean(errorMsg)}
        autoHideDuration={3200}
        onClose={() => setErrorMsg('')}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Alert onClose={() => setErrorMsg('')} severity='error' sx={{ width: '100%' }}>
          {errorMsg}
        </Alert>
      </Snackbar>
    </>
  );
}
