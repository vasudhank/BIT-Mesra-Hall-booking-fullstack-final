const axios = require('axios');
const { logger } = require('./loggerService');

const HUBSPOT_BASE_URL = (process.env.HUBSPOT_BASE_URL || 'https://api.hubapi.com').replace(/\/+$/, '');

const toBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const sanitizeText = (text, limit = 20000) =>
  String(text || '')
    .replace(/\u0000/g, ' ')
    .trim()
    .slice(0, limit);

const getCrmConfig = () => ({
  provider: String(process.env.CRM_PROVIDER || 'hubspot').trim().toLowerCase(),
  hubspotToken: String(process.env.HUBSPOT_PRIVATE_APP_TOKEN || '').trim(),
  autoSyncSupportThreads: toBool(process.env.CRM_AUTO_SYNC_SUPPORT_THREADS, false)
});

const isCrmEnabled = () => {
  const config = getCrmConfig();
  return config.provider === 'hubspot' && Boolean(config.hubspotToken);
};

const isCrmAutoSyncEnabled = () => getCrmConfig().autoSyncSupportThreads;

const hubspotRequest = async ({ method = 'GET', path, data, params }) => {
  const config = getCrmConfig();
  if (!isCrmEnabled()) {
    throw new Error('HubSpot CRM is not configured.');
  }

  const response = await axios({
    method,
    url: `${HUBSPOT_BASE_URL}${path}`,
    data,
    params,
    headers: {
      Authorization: `Bearer ${config.hubspotToken}`,
      'Content-Type': 'application/json'
    },
    timeout: 20000
  });

  return response.data || {};
};

const deriveNameFromEmail = (email) => {
  const local = String(email || '').split('@')[0] || '';
  const words = local
    .replace(/[^a-zA-Z0-9._-]/g, ' ')
    .replace(/[._-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase());

  if (words.length === 0) return { firstName: 'BIT', lastName: 'User' };
  if (words.length === 1) return { firstName: words[0], lastName: 'User' };
  return {
    firstName: words[0],
    lastName: words.slice(1).join(' ')
  };
};

const findHubSpotContactByEmail = async (email) => {
  const cleanEmail = sanitizeText(email, 240).toLowerCase();
  if (!cleanEmail) return null;

  const data = await hubspotRequest({
    method: 'POST',
    path: '/crm/v3/objects/contacts/search',
    data: {
      filterGroups: [
        {
          filters: [
            {
              propertyName: 'email',
              operator: 'EQ',
              value: cleanEmail
            }
          ]
        }
      ],
      properties: ['email', 'firstname', 'lastname', 'phone', 'company'],
      limit: 1
    }
  });

  const first = Array.isArray(data?.results) ? data.results[0] : null;
  return first || null;
};

const upsertHubSpotContact = async ({ email, firstName = '', lastName = '', phone = '', company = '' } = {}) => {
  const cleanEmail = sanitizeText(email, 240).toLowerCase();
  if (!cleanEmail) {
    throw new Error('CRM contact upsert requires email.');
  }

  const fallbackName = deriveNameFromEmail(cleanEmail);
  const properties = {
    email: cleanEmail,
    firstname: sanitizeText(firstName, 120) || fallbackName.firstName,
    lastname: sanitizeText(lastName, 120) || fallbackName.lastName
  };
  if (sanitizeText(phone, 60)) properties.phone = sanitizeText(phone, 60);
  if (sanitizeText(company, 120)) properties.company = sanitizeText(company, 120);

  const existing = await findHubSpotContactByEmail(cleanEmail);
  if (existing?.id) {
    const updated = await hubspotRequest({
      method: 'PATCH',
      path: `/crm/v3/objects/contacts/${existing.id}`,
      data: { properties }
    });
    return {
      id: String(updated?.id || existing.id),
      properties: updated?.properties || properties,
      operation: 'updated'
    };
  }

  const created = await hubspotRequest({
    method: 'POST',
    path: '/crm/v3/objects/contacts',
    data: { properties }
  });
  return {
    id: String(created?.id || ''),
    properties: created?.properties || properties,
    operation: 'created'
  };
};

const createHubSpotNote = async ({ body }) => {
  const cleanBody = sanitizeText(body, 60000);
  if (!cleanBody) throw new Error('HubSpot note body is required.');

  const note = await hubspotRequest({
    method: 'POST',
    path: '/crm/v3/objects/notes',
    data: {
      properties: {
        hs_note_body: cleanBody,
        hs_timestamp: String(Date.now())
      }
    }
  });

  return {
    id: String(note?.id || ''),
    properties: note?.properties || {}
  };
};

const associateHubSpotNoteWithContact = async ({ noteId, contactId }) => {
  const cleanNoteId = sanitizeText(noteId, 120);
  const cleanContactId = sanitizeText(contactId, 120);
  if (!cleanNoteId || !cleanContactId) return;

  await hubspotRequest({
    method: 'PUT',
    path: `/crm/v4/objects/notes/${cleanNoteId}/associations/default/contacts/${cleanContactId}`
  });
};

const syncSupportThreadToCrm = async ({
  kind = 'SUPPORT',
  title = '',
  message = '',
  email = '',
  threadId = '',
  aiAnswer = '',
  source = 'BIT-Booking3'
} = {}) => {
  if (!isCrmEnabled()) {
    return { skipped: true, reason: 'crm_not_configured' };
  }

  const cleanEmail = sanitizeText(email, 240).toLowerCase();
  if (!cleanEmail) {
    return { skipped: true, reason: 'email_missing' };
  }

  const contact = await upsertHubSpotContact({ email: cleanEmail });
  const noteBody = [
    `Source: ${sanitizeText(source, 120)}`,
    `Thread type: ${sanitizeText(kind, 60).toUpperCase() || 'SUPPORT'}`,
    `Thread id: ${sanitizeText(threadId, 120) || 'n/a'}`,
    `Title: ${sanitizeText(title, 220) || 'n/a'}`,
    '',
    'User message:',
    sanitizeText(message, 12000) || '(empty)',
    '',
    'AI response:',
    sanitizeText(aiAnswer, 12000) || '(empty)'
  ].join('\n');

  const note = await createHubSpotNote({ body: noteBody });
  if (contact?.id && note?.id) {
    await associateHubSpotNoteWithContact({
      noteId: note.id,
      contactId: contact.id
    });
  }

  return {
    skipped: false,
    provider: 'hubspot',
    contactId: contact.id || '',
    contactOperation: contact.operation || '',
    noteId: note.id || ''
  };
};

const syncBookingEventToCrm = async ({
  bookingId = '',
  department = '',
  email = '',
  hall = '',
  event = '',
  startDateTime = '',
  endDateTime = '',
  status = ''
} = {}) => {
  if (!isCrmEnabled()) {
    return { skipped: true, reason: 'crm_not_configured' };
  }

  const cleanEmail = sanitizeText(email, 240).toLowerCase();
  if (!cleanEmail) {
    return { skipped: true, reason: 'email_missing' };
  }

  const contact = await upsertHubSpotContact({
    email: cleanEmail,
    company: sanitizeText(department, 120)
  });

  const noteBody = [
    'Source: BIT-Booking3',
    'Thread type: BOOKING_EVENT',
    `Booking id: ${sanitizeText(bookingId, 120) || 'n/a'}`,
    `Department: ${sanitizeText(department, 200) || 'n/a'}`,
    `Hall: ${sanitizeText(hall, 120) || 'n/a'}`,
    `Event: ${sanitizeText(event, 220) || 'n/a'}`,
    `Start: ${sanitizeText(startDateTime, 120) || 'n/a'}`,
    `End: ${sanitizeText(endDateTime, 120) || 'n/a'}`,
    `Status: ${sanitizeText(status, 80) || 'n/a'}`
  ].join('\n');

  const note = await createHubSpotNote({ body: noteBody });
  if (contact?.id && note?.id) {
    await associateHubSpotNoteWithContact({
      noteId: note.id,
      contactId: contact.id
    });
  }

  return {
    skipped: false,
    provider: 'hubspot',
    contactId: contact.id || '',
    contactOperation: contact.operation || '',
    noteId: note.id || ''
  };
};

const getCrmIntegrationStatus = () => {
  const config = getCrmConfig();
  return {
    provider: config.provider,
    enabled: isCrmEnabled(),
    autoSyncSupportThreads: config.autoSyncSupportThreads
  };
};

const safeSyncSupportThreadToCrm = async (payload) => {
  try {
    const summary = await syncSupportThreadToCrm(payload);
    logger.info('CRM support-thread sync finished', summary);
    return summary;
  } catch (err) {
    logger.error('CRM support-thread sync failed', { error: err.message || err });
    return {
      skipped: true,
      reason: 'sync_failed',
      error: err.message || String(err)
    };
  }
};

module.exports = {
  getCrmIntegrationStatus,
  isCrmEnabled,
  isCrmAutoSyncEnabled,
  syncSupportThreadToCrm,
  syncBookingEventToCrm,
  safeSyncSupportThreadToCrm
};
