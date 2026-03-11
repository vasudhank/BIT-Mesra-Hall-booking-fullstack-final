import React, { useEffect, useMemo, useRef, useState } from 'react';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import PrintOutlinedIcon from '@mui/icons-material/PrintOutlined';
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined';
import { createPortal } from 'react-dom';
import { getContactsApi } from '../../api/contactApi';
import { QUICK_MENU_OPEN_CONTACTS_EVENT } from '../Navigation/quickMenuEvents';
import { printHtmlDocument } from '../../utils/printDocument';
import { exportPdfFromPrintHtml } from '../../utils/exportPdfFromPrintHtml';
import './WishYourDayOverlay.css';

const normalizeForSearch = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .trim();

const escapeHtml = (value) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const getContactKey = (contact) =>
  String(
    contact?._id ||
      `${String(contact?.name || '').trim()}__${String(contact?.number || '').trim()}__${String(contact?.email || '').trim()}`
  );

const isLikelyMobile = () => {
  if (typeof window === 'undefined') return false;
  const byWidth = window.matchMedia('(max-width: 960px)').matches;
  const byPointer = window.matchMedia('(pointer: coarse)').matches;
  const ua = typeof navigator !== 'undefined' ? String(navigator.userAgent || '').toLowerCase() : '';
  const byUa = /android|iphone|ipad|ipod|mobile/i.test(ua);
  return byWidth || byPointer || byUa;
};

const buildContactsPrintDocument = (contactsToExport) => {
  const rows = contactsToExport
    .map(
      (contact, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${escapeHtml(contact.name || '-')}</td>
            <td>${escapeHtml(contact.number || '-')}</td>
            <td>${escapeHtml(contact.email || '-')}</td>
          </tr>
        `
    )
    .join('');

  const html = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Wish Your Day Contacts</title>
          <style>
            @page { size: A4; margin: 14mm; }
            * { box-sizing: border-box; }
            body { margin: 0; font-family: "Segoe UI", Arial, sans-serif; color: #0f172a; background: #fff; }
            h1 { margin: 0 0 12px; font-size: 20px; text-align: center; }
            table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 12px; }
            th, td { border: 1.35px solid #334155; padding: 8px 7px; text-align: left; vertical-align: top; word-break: break-word; }
            th { background: #e2e8f0; font-weight: 700; }
            th:nth-child(1), td:nth-child(1) { width: 8%; text-align: center; }
            th:nth-child(2), td:nth-child(2) { width: 32%; }
            th:nth-child(3), td:nth-child(3) { width: 24%; }
            th:nth-child(4), td:nth-child(4) { width: 36%; }
            thead { display: table-header-group; }
            tr { page-break-inside: avoid; break-inside: avoid; }
          </style>
        </head>
        <body>
          <h1>Wish Your Day Contact List</h1>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Phone Number</th>
                <th>Email Address</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </body>
      </html>
    `;

  return { html, title: 'Wish Your Day Contacts', marginMm: 14, orientation: 'portrait' };
};

export default function WishYourDayOverlay() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [selectedKeys, setSelectedKeys] = useState([]);
  const [mobilePrintPdfBusy, setMobilePrintPdfBusy] = useState(false);
  const selectAllRef = useRef(null);
  const mobilePrintFallbackEnabled = isLikelyMobile();

  const closeOverlay = () => {
    setOpen(false);
  };

  const loadContacts = async () => {
    setLoading(true);
    try {
      const res = await getContactsApi();
      const list = Array.isArray(res?.data?.contacts) ? res.data.contacts : [];
      setContacts(list);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const handleOpen = () => {
      setOpen(true);
    };
    window.addEventListener(QUICK_MENU_OPEN_CONTACTS_EVENT, handleOpen);
    return () => {
      window.removeEventListener(QUICK_MENU_OPEN_CONTACTS_EVENT, handleOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    loadContacts();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeOverlay();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open]);

  const filteredContacts = useMemo(() => {
    const query = normalizeForSearch(appliedSearch);
    if (!query) return contacts;
    return contacts.filter((contact) => {
      const name = normalizeForSearch(contact?.name);
      const number = normalizeForSearch(contact?.number);
      const email = normalizeForSearch(contact?.email);
      return name.includes(query) || number.includes(query) || email.includes(query);
    });
  }, [contacts, appliedSearch]);

  const visibleKeys = useMemo(
    () => filteredContacts.map((entry) => getContactKey(entry)),
    [filteredContacts]
  );

  const isAllVisibleSelected =
    visibleKeys.length > 0 && visibleKeys.every((key) => selectedKeys.includes(key));

  const isPartiallyVisibleSelected =
    visibleKeys.length > 0 &&
    visibleKeys.some((key) => selectedKeys.includes(key)) &&
    !isAllVisibleSelected;

  useEffect(() => {
    if (!selectAllRef.current) return;
    selectAllRef.current.indeterminate = isPartiallyVisibleSelected;
  }, [isPartiallyVisibleSelected, isAllVisibleSelected]);

  const toggleSelectAllVisible = () => {
    setSelectedKeys((prev) => {
      if (!visibleKeys.length) return prev;
      if (isAllVisibleSelected) {
        return prev.filter((key) => !visibleKeys.includes(key));
      }
      const next = new Set(prev);
      visibleKeys.forEach((key) => next.add(key));
      return Array.from(next);
    });
  };

  const toggleContact = (key) => {
    setSelectedKeys((prev) => (prev.includes(key) ? prev.filter((entry) => entry !== key) : [...prev, key]));
  };

  const copyValue = async (value) => {
    const text = String(value || '').trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const helper = document.createElement('textarea');
      helper.value = text;
      helper.style.position = 'fixed';
      helper.style.opacity = '0';
      document.body.appendChild(helper);
      helper.select();
      document.execCommand('copy');
      document.body.removeChild(helper);
    }
  };

  const getExportContacts = () => {
    const selected = contacts.filter((entry) => selectedKeys.includes(getContactKey(entry)));
    return selected.length ? selected : contacts;
  };

  const handlePrint = () => {
    const exportContacts = getExportContacts();
    if (!exportContacts.length) return;
    const built = buildContactsPrintDocument(exportContacts);

    printHtmlDocument({
      html: built.html,
      title: built.title,
      validate: (doc) => Boolean(doc.querySelector('table')) && String(doc.body?.textContent || '').trim().length > 0,
      settleDelayMs: 320,
      printFallbackCleanupMs: 180000,
      initFallbackCleanupMs: 240000
    });
  };

  const handleMobilePdfDownload = async () => {
    const exportContacts = getExportContacts();
    if (!exportContacts.length || mobilePrintPdfBusy) return;
    const built = buildContactsPrintDocument(exportContacts);
    setMobilePrintPdfBusy(true);
    try {
      await exportPdfFromPrintHtml({
        html: built.html,
        title: built.title,
        orientation: built.orientation,
        marginMm: built.marginMm
      });
    } finally {
      setMobilePrintPdfBusy(false);
    }
  };

  const handleDownload = () => {
    const exportContacts = getExportContacts();
    if (!exportContacts.length) return;
    const escapeVCardField = (value) =>
      String(value || '')
        .replace(/\\/g, '\\\\')
        .replace(/\n/g, '\\n')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,');
    const content = exportContacts
      .map((contact) => {
        const name = escapeVCardField(contact.name || 'Unknown');
        const number = escapeVCardField(contact.number || '');
        const email = escapeVCardField(contact.email || '');
        return [
          'BEGIN:VCARD',
          'VERSION:3.0',
          `FN:${name}`,
          `N:${name};;;;`,
          number ? `TEL;TYPE=CELL:${number}` : '',
          email ? `EMAIL;TYPE=INTERNET:${email}` : '',
          'END:VCARD'
        ]
          .filter(Boolean)
          .join('\n');
      })
      .join('\n');
    const blob = new Blob([content], { type: 'text/vcard;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    anchor.href = url;
    anchor.download = `wish-your-day-contacts-${stamp}.vcf`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  if (!open) return null;

  return createPortal(
    <div className="quick-contacts-overlay" onClick={closeOverlay}>
      <div className="quick-contacts-card" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="quick-contacts-close" onClick={closeOverlay} aria-label="Close contacts popup">
          <CloseIcon fontSize="small" />
        </button>
        <h2 className="quick-contacts-title">Wish Your Day!</h2>

        <div className="quick-contacts-search-row">
          <button
            type="button"
            className="quick-contacts-search-btn"
            onClick={() => setAppliedSearch(searchInput.trim())}
            aria-label="Search contacts"
          >
            <SearchIcon fontSize="small" />
          </button>
          <input
            type="text"
            value={searchInput}
            onChange={(event) => {
              const next = event.target.value;
              setSearchInput(next);
              if (!next.trim()) setAppliedSearch('');
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                setAppliedSearch(searchInput.trim());
              }
            }}
            placeholder="Search name, number or email..."
          />
        </div>

        <div className="quick-contacts-head-wrap">
          <label className="quick-contacts-head-check" title="Select all visible contacts">
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={isAllVisibleSelected}
              onChange={toggleSelectAllVisible}
              aria-label="Select all contacts"
            />
          </label>
          <div className="quick-contacts-head-row">
            <span>NAME</span>
            <span>PHONE NUMBER</span>
            <span>EMAIL ADDRESS</span>
          </div>
        </div>

        <div className="quick-contacts-list">
          {loading ? (
            <div className="quick-contacts-empty">Loading contacts...</div>
          ) : filteredContacts.length ? (
            filteredContacts.map((contact) => {
              const key = getContactKey(contact);
              return (
                <div key={key} className="quick-contacts-row-wrap">
                  <label className="quick-contacts-row-check">
                    <input
                      type="checkbox"
                      checked={selectedKeys.includes(key)}
                      onChange={() => toggleContact(key)}
                      aria-label={`Select ${contact?.name || 'contact'}`}
                    />
                  </label>
                  <div className="quick-contacts-row">
                    <span className="name" title={contact?.name || ''}>{contact?.name || '-'}</span>
                    <button type="button" className="linkish" onClick={() => copyValue(contact?.number)}>
                      {contact?.number || '-'}
                    </button>
                    <button type="button" className="linkish" onClick={() => copyValue(contact?.email)}>
                      {contact?.email || '-'}
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="quick-contacts-empty">
              {contacts.length ? 'No contacts found matching criteria.' : 'No contacts available.'}
            </div>
          )}
        </div>

        <div className="quick-contacts-footer">
          <p>Click on phone or email to copy</p>
          <div className="actions">
            <button type="button" onClick={handleDownload} aria-label="Download contacts as VCF" title="Download contacts">
              <DownloadOutlinedIcon fontSize="small" />
            </button>
            <button type="button" onClick={handlePrint} aria-label="Print contacts list" title="Print contacts">
              <PrintOutlinedIcon fontSize="small" />
            </button>
            {mobilePrintFallbackEnabled && (
              <button
                type="button"
                onClick={handleMobilePdfDownload}
                disabled={mobilePrintPdfBusy}
                aria-label="Download contacts PDF"
                title="Download PDF (mobile fallback)"
              >
                <PictureAsPdfOutlinedIcon fontSize="small" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
