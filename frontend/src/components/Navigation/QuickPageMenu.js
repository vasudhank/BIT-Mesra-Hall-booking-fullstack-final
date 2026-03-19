import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  THEME_SYNC_EVENT,
  applyThemeToBody,
  readGlobalThemeMode,
  resolveEffectiveThemeMode,
  setPageThemeMode
} from '../../utils/themeModeScope';
import { QUICK_MENU_OPEN_CONTACTS_EVENT } from './quickMenuEvents';
import './QuickPageMenu.css';

const MENU_KEYS = {
  ADMIN: 'admin',
  FACULTY: 'faculty',
  SCHEDULE: 'schedule',
  NOTICES: 'notices',
  CALENDAR: 'calendar',
  AI: 'ai',
  CONTACTS: 'contacts',
  QUERIES: 'queries',
  COMPLAINTS: 'complaints',
  FEEDBACK: 'feedback'
};

const MENU_ITEMS = [
  { key: MENU_KEYS.ADMIN, label: 'Admin' },
  { key: MENU_KEYS.FACULTY, label: 'Faculty' },
  { key: MENU_KEYS.SCHEDULE, label: 'Schedule' },
  { key: MENU_KEYS.NOTICES, label: 'Notices' },
  { key: MENU_KEYS.CALENDAR, label: 'Calendar' },
  { key: MENU_KEYS.AI, label: 'AI Mode' },
  { key: MENU_KEYS.CONTACTS, label: 'Contacts' },
  { key: MENU_KEYS.QUERIES, label: 'Queries' },
  { key: MENU_KEYS.COMPLAINTS, label: 'Complaints' },
  { key: MENU_KEYS.FEEDBACK, label: 'Feedback' }
];

const toLowerTrim = (value) => String(value || '').trim().toLowerCase();

const normalizePath = (pathname) => {
  const raw = String(pathname || '').trim();
  if (!raw) return '/';
  const slashFixed = raw.startsWith('/') ? raw : `/${raw}`;
  return slashFixed.toLowerCase();
};

const detectContext = (pathname) => {
  const p = normalizePath(pathname);
  const isAdminAuthSurface = p === '/admin_login' || p.startsWith('/admin/forgot');
  const isDepartmentAuthSurface = p === '/department_login' || p === '/department_register' || p.startsWith('/department/forgot');
  const isDeveloperAuthSurface = p === '/developer/login';

  if (p.startsWith('/admin/') && !isAdminAuthSurface) return 'admin';
  if (p.startsWith('/department/') && !isDepartmentAuthSurface) return 'department';
  if (p.startsWith('/developer/') && !isDeveloperAuthSurface) return 'developer';
  return 'public';
};

const itemPathForContext = (key, context) => {
  switch (key) {
    case MENU_KEYS.ADMIN:
      return context === 'admin' ? '/admin/hall' : '/admin_login';
    case MENU_KEYS.FACULTY:
      return context === 'department' ? '/department/booking' : '/department_login';
    case MENU_KEYS.SCHEDULE:
      return '/schedule';
    case MENU_KEYS.NOTICES:
      return context === 'admin' ? '/admin/notices' : '/notices';
    case MENU_KEYS.CALENDAR:
      return '/calendar';
    case MENU_KEYS.AI:
      return '/ai';
    case MENU_KEYS.CONTACTS:
      return '/admin/contacts';
    case MENU_KEYS.QUERIES:
      if (context === 'admin') return '/admin/queries';
      if (context === 'department') return '/department/queries';
      if (context === 'developer') return '/developer/queries';
      return '/queries';
    case MENU_KEYS.COMPLAINTS:
      if (context === 'admin') return '/admin/complaints';
      if (context === 'department') return '/department/complaints';
      if (context === 'developer') return '/developer/complaints';
      return '/complaints';
    case MENU_KEYS.FEEDBACK:
      if (context === 'admin') return '/admin/feedback';
      if (context === 'department') return '/department/feedback';
      if (context === 'developer') return '/developer/feedback';
      return '/feedback';
    default:
      return '/';
  }
};

const isCurrentMenuKey = (key, pathname) => {
  const p = normalizePath(pathname);
  switch (key) {
    case MENU_KEYS.QUERIES:
      return p.startsWith('/queries') || p.startsWith('/admin/queries') || p.startsWith('/department/queries') || p.startsWith('/developer/queries');
    case MENU_KEYS.COMPLAINTS:
      return p.startsWith('/complaints') || p.startsWith('/admin/complaints') || p.startsWith('/department/complaints') || p.startsWith('/developer/complaints');
    case MENU_KEYS.FEEDBACK:
      return p.startsWith('/feedback') || p.startsWith('/admin/feedback') || p.startsWith('/department/feedback') || p.startsWith('/developer/feedback');
    case MENU_KEYS.CONTACTS:
      return p.startsWith('/admin/contacts');
    case MENU_KEYS.NOTICES:
      return p.startsWith('/notices') || p.startsWith('/admin/notices');
    case MENU_KEYS.CALENDAR:
      return p === '/calendar' || p === '/calender';
    case MENU_KEYS.SCHEDULE:
      return p.startsWith('/schedule');
    case MENU_KEYS.AI:
      return p.startsWith('/ai');
    case MENU_KEYS.ADMIN:
      return p === '/admin_login' || p.startsWith('/admin/hall') || p.startsWith('/admin/booking') || p.startsWith('/admin/department') || p.startsWith('/admin/account');
    case MENU_KEYS.FACULTY:
      return p === '/department_login' || p === '/department_register' || p.startsWith('/department/booking') || p.startsWith('/department/account');
    default:
      return false;
  }
};

const HamburgerGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 7h16v2H4zM4 11h16v2H4zM4 15h16v2H4z" />
  </svg>
);

export default function QuickPageMenu({
  includeKeys,
  excludeKeys = [],
  extraItems = [],
  hideThemeToggle = false,
  buttonLabel = 'Menu',
  iconOnly = false,
  className = '',
  buttonClassName = '',
  panelClassName = '',
  itemClassName = '',
  green = false,
  inlinePanel = false,
  align = 'right',
  preferLeftWhenTight = false,
  preferUpWhenTight = true,
  openDirection = 'auto',
  matchParentMenuWidth = false,
  panelOffsetX = 0,
  panelOffsetY = 0,
  onNavigate,
  closeParentMenu,
  ariaLabel
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const menuRootRef = useRef(null);
  const panelRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState({});
  const [effectiveMode, setEffectiveMode] = useState(() =>
    resolveEffectiveThemeMode(location.pathname, readGlobalThemeMode())
  );

  const context = useMemo(() => detectContext(location.pathname), [location.pathname]);

  const normalizedExcludes = useMemo(() => {
    return new Set((Array.isArray(excludeKeys) ? excludeKeys : []).map((key) => toLowerTrim(key)));
  }, [excludeKeys]);

  const normalizedIncludes = useMemo(() => {
    const values = Array.isArray(includeKeys) ? includeKeys : [];
    if (!values.length) return null;
    return new Set(values.map((key) => toLowerTrim(key)));
  }, [includeKeys]);

  const menuItems = useMemo(() => {
    return MENU_ITEMS
      .filter((item) => (normalizedIncludes ? normalizedIncludes.has(item.key) : true))
      .filter((item) => !normalizedExcludes.has(item.key))
      .filter((item) => !isCurrentMenuKey(item.key, location.pathname))
      .map((item) => ({ ...item, path: itemPathForContext(item.key, context) }))
      .filter((item) => normalizePath(item.path) !== normalizePath(location.pathname));
  }, [context, location.pathname, normalizedExcludes, normalizedIncludes]);

  const customItems = useMemo(() => {
    if (!Array.isArray(extraItems)) return [];
    return extraItems
      .map((item, index) => {
        if (!item || typeof item !== 'object') return null;
        const key = toLowerTrim(item.key || item.label || `custom-${index}`) || `custom-${index}`;
        const label = String(item.label || '').trim();
        if (!label) return null;
        return {
          key,
          label,
          path: typeof item.path === 'string' ? item.path : '',
          onClick: typeof item.onClick === 'function' ? item.onClick : null
        };
      })
      .filter(Boolean)
      .filter((item) => !item.path || normalizePath(item.path) !== normalizePath(location.pathname));
  }, [extraItems, location.pathname]);

  const syncEffectiveMode = useCallback(() => {
    setEffectiveMode(resolveEffectiveThemeMode(location.pathname, readGlobalThemeMode()));
  }, [location.pathname]);

  const applyPageThemeMode = useCallback(
    (nextMode) => {
      setPageThemeMode(location.pathname, nextMode);
      applyThemeToBody(nextMode);
      setEffectiveMode(nextMode);
    },
    [location.pathname]
  );

  useEffect(() => {
    syncEffectiveMode();
  }, [syncEffectiveMode]);

  useEffect(() => {
    const handleThemeSync = () => {
      syncEffectiveMode();
    };

    window.addEventListener(THEME_SYNC_EVENT, handleThemeSync);
    return () => {
      window.removeEventListener(THEME_SYNC_EVENT, handleThemeSync);
    };
  }, [syncEffectiveMode]);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      const root = menuRootRef.current;
      const panel = panelRef.current;
      const target = event.target;
      if (!root) return;
      if (root.contains(target)) return;
      if (panel && panel.contains(target)) return;
      if (!root.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown, true);
    document.addEventListener('touchstart', handlePointerDown, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown, true);
      document.removeEventListener('touchstart', handlePointerDown, true);
    };
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!open || hideThemeToggle) return undefined;

    const handleKeyDown = (event) => {
      if (!event.ctrlKey || event.altKey || event.metaKey) return;
      const key = String(event.key || '').toLowerCase();

      if (key === 'd') {
        event.preventDefault();
        event.stopPropagation();
        if (effectiveMode !== 'dark') {
          applyPageThemeMode('dark');
        }
      }

      if (key === 'l') {
        event.preventDefault();
        event.stopPropagation();
        if (effectiveMode !== 'light') {
          applyPageThemeMode('light');
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [open, effectiveMode, applyPageThemeMode, hideThemeToggle]);

  useEffect(() => {
    if (!open || inlinePanel) {
      setPanelStyle({});
      return undefined;
    }

    const computePanelPosition = () => {
      const root = menuRootRef.current;
      const panel = panelRef.current;
      if (!root || !panel) return;

      const rootRect = root.getBoundingClientRect();
      let panelWidth = Math.max(180, panel.offsetWidth || 220);
      if (matchParentMenuWidth) {
        const parentPaper = root.closest('.MuiPaper-root');
        const parentWidth = Number(parentPaper?.getBoundingClientRect?.().width || 0);
        if (parentWidth > 0) {
          panelWidth = Math.round(parentWidth);
        }
      }
      const panelHeight = Math.max(120, panel.offsetHeight || 240);
      const margin = 8;
      const gap = 8;
      const safeOffsetX = Number.isFinite(Number(panelOffsetX)) ? Number(panelOffsetX) : 0;
      const safeOffsetY = Number.isFinite(Number(panelOffsetY)) ? Number(panelOffsetY) : 0;

      let nextLeft;
      if (align === 'left') {
        nextLeft = rootRect.left;
      } else {
        nextLeft = rootRect.right - panelWidth;
      }

      let nextTop = rootRect.bottom + gap;
      const spaceBelow = window.innerHeight - rootRect.bottom - margin;
      const spaceAbove = rootRect.top - margin;

      const normalizedDirection = String(openDirection || 'auto').toLowerCase();
      const forceUp = normalizedDirection === 'up';
      const forceDown = normalizedDirection === 'down';
      const shouldFlipUp = forceUp || (!forceDown && preferUpWhenTight && spaceBelow < panelHeight && spaceAbove > spaceBelow);
      if (shouldFlipUp) {
        nextTop = rootRect.top - panelHeight - gap;
        if (preferLeftWhenTight) {
          const leftSide = rootRect.left - panelWidth - gap;
          if (leftSide >= margin) {
            nextLeft = leftSide;
          }
        }
      }

      nextLeft += safeOffsetX;
      nextTop += safeOffsetY;

      const maxLeft = Math.max(margin, window.innerWidth - panelWidth - margin);
      const maxTop = Math.max(margin, window.innerHeight - panelHeight - margin);
      nextLeft = Math.min(Math.max(margin, nextLeft), maxLeft);
      nextTop = Math.min(Math.max(margin, nextTop), maxTop);

      setPanelStyle({
        position: 'fixed',
        left: `${Math.round(nextLeft)}px`,
        top: `${Math.round(nextTop)}px`,
        width: `${Math.round(panelWidth)}px`,
        zIndex: 4200
      });
    };

    const raf = window.requestAnimationFrame(computePanelPosition);
    window.addEventListener('resize', computePanelPosition);
    window.addEventListener('scroll', computePanelPosition, true);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', computePanelPosition);
      window.removeEventListener('scroll', computePanelPosition, true);
    };
  }, [open, inlinePanel, align, preferLeftWhenTight, preferUpWhenTight, openDirection, matchParentMenuWidth, panelOffsetX, panelOffsetY]);

  const toggleOpen = (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    setOpen((prev) => !prev);
  };

  const handleNavigate = (path) => {
    setOpen(false);
    if (typeof closeParentMenu === 'function') {
      closeParentMenu();
    }
    if (typeof onNavigate === 'function') {
      onNavigate(path);
    }
    navigate(path);
  };

  const handleCustomItem = (item) => {
    setOpen(false);
    if (typeof closeParentMenu === 'function') {
      closeParentMenu();
    }
    if (item?.onClick) {
      item.onClick();
      return;
    }
    if (item?.path) {
      if (typeof onNavigate === 'function') {
        onNavigate(item.path);
      }
      navigate(item.path);
    }
  };

  const handleMenuItem = (item) => {
    if (item?.key === MENU_KEYS.CONTACTS) {
      setOpen(false);
      if (typeof closeParentMenu === 'function') {
        closeParentMenu();
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(QUICK_MENU_OPEN_CONTACTS_EVENT));
      }
      return;
    }
    handleNavigate(item.path);
  };

  const buttonAria = ariaLabel || 'Open quick page menu';
  const themeToggleTarget = effectiveMode === 'dark' ? 'light' : 'dark';
  const themeToggleLabel = themeToggleTarget === 'dark' ? 'Dark' : 'Light';
  const themeToggleShortcut = themeToggleTarget === 'dark' ? 'Ctrl+D' : 'Ctrl+L';

  const handleThemeToggle = (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    applyPageThemeMode(themeToggleTarget);
  };

  const panelNode = open ? (
    <div
      ref={panelRef}
      className={`quick-page-menu-panel align-${align} ${inlinePanel ? 'inline' : ''} ${panelClassName}`.trim()}
      role="menu"
      aria-label="Page menu"
      style={inlinePanel ? undefined : panelStyle}
    >
      {!hideThemeToggle && (
        <>
          <button
            type="button"
            role="menuitem"
            className={`quick-page-menu-item quick-page-menu-theme-toggle ${itemClassName}`.trim()}
            onClick={handleThemeToggle}
          >
            <span className="quick-page-menu-theme-label">{themeToggleLabel}</span>
            <span className="quick-page-menu-shortcut">{themeToggleShortcut}</span>
          </button>

          <div className="quick-page-menu-divider" />
        </>
      )}

      {[...customItems, ...menuItems].length === 0 ? (
        <div className="quick-page-menu-empty">No additional pages</div>
      ) : (
        [...customItems, ...menuItems].map((item) => (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            className={`quick-page-menu-item ${itemClassName}`.trim()}
            onClick={() => {
              if (customItems.some((custom) => custom.key === item.key)) {
                handleCustomItem(item);
                return;
              }
              handleMenuItem(item);
            }}
          >
            {item.label}
          </button>
        ))
      )}
    </div>
  ) : null;

  return (
    <div
      ref={menuRootRef}
      className={`quick-page-menu ${open ? 'is-open' : ''} ${inlinePanel ? 'panel-inline' : ''} ${className}`.trim()}
    >
      <button
        type="button"
        className={`quick-page-menu-btn ${iconOnly ? 'icon-only' : ''} ${green ? 'is-green' : ''} ${buttonClassName}`.trim()}
        onClick={toggleOpen}
        aria-label={buttonAria}
        aria-expanded={open}
      >
        <span className="quick-page-menu-icon">
          <HamburgerGlyph />
        </span>
        {!iconOnly && <span className="quick-page-menu-label">{buttonLabel}</span>}
      </button>

      {inlinePanel ? panelNode : (open ? createPortal(panelNode, document.body) : null)}
    </div>
  );
}
