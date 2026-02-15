import React, { useEffect, useState } from 'react';
import './AdminContacts.css';
import Appbar from '../AppBar/AppBar';
import {
  Alert,
  Backdrop,
  Box,
  Card,
  CircularProgress,
  Container,
  IconButton,
  InputBase,
  Snackbar,
  Tooltip,
  Typography
} from '@mui/material';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { adminUpdateContactApi, getContactsApi } from '../../../api/contactApi';

const applySearchFilter = (sourceContacts, query) => {
  if (!query.trim()) return sourceContacts;
  const lower = query.toLowerCase();
  return sourceContacts.filter((contact) =>
    (contact.name || '').toLowerCase().includes(lower) ||
    (contact.number || '').toLowerCase().includes(lower) ||
    (contact.email || '').toLowerCase().includes(lower)
  );
};

export default function AdminContacts() {
  const [loading, setLoading] = useState(true);
  const [contacts, setContacts] = useState([]);
  const [filteredContacts, setFilteredContacts] = useState([]);
  const [search, setSearch] = useState('');

  const [editing, setEditing] = useState({ id: null, field: null });
  const [draftValue, setDraftValue] = useState('');
  const [savingKey, setSavingKey] = useState('');

  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const loadContacts = async () => {
    setLoading(true);
    try {
      const res = await getContactsApi();
      if (res?.error) {
        throw new Error(res.error);
      }
      const incoming = res?.data?.contacts || [];
      setContacts(incoming);
      setFilteredContacts(incoming);
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
      setFilteredContacts(contacts);
    }
  };

  const onSearchSubmit = () => {
    if (!search.trim()) {
      setFilteredContacts(contacts);
      return;
    }
    setFilteredContacts(applySearchFilter(contacts, search));
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
      setFilteredContacts(applySearchFilter(updatedContacts, search));
      setSuccessMsg('Contact updated successfully');
      cancelEdit();
    } catch (err) {
      setErrorMsg(err?.data?.message || 'Failed to update contact');
      setSavingKey('');
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

        <Container maxWidth='xl'>
          <div className='admin-contacts-title-wrap'>
            <h2 className='admin-contacts-title'>CONTACTS</h2>
            <p className='admin-contacts-subtitle'>Manage Wish Your Day contact details</p>
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

