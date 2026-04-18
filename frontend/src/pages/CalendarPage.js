import React, { useCallback, useMemo, useRef, useState, useEffect, useLayoutEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import FullCalendar from '@fullcalendar/react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import multiMonthPlugin from '@fullcalendar/multimonth';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import {
  createCalendarTaskApi,
  deleteCalendarTaskApi,
  getCalendarAppearanceApi,
  getCalendarEventsApi,
  saveCalendarAppearanceApi,
  searchCalendarEventsApi,
  updateCalendarTaskApi
} from '../api/calendarApi';
import { createNoticeApi, deleteNoticeApi, getNoticeByIdApi, updateNoticeApi } from '../api/noticesApi';
import api from '../api/axiosInstance';
import { removeStatus } from '../store/slices/userSlice';
import { fuzzyFilterAndRank } from '../utils/fuzzySearch';
import QuickPageMenu from '../components/Navigation/QuickPageMenu';
import './CalendarPage.css';

const WEEK_DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const WEEK_COLLAPSED_VISIBLE_EVENT_COUNT = 2;
const WEEK_COLLAPSED_DAY_MAX_EVENT_ROWS = WEEK_COLLAPSED_VISIBLE_EVENT_COUNT + 1;
const DAY_COLLAPSED_VISIBLE_EVENT_COUNT = 2;
const DAY_COLLAPSED_DAY_MAX_EVENT_ROWS = DAY_COLLAPSED_VISIBLE_EVENT_COUNT + 1;
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
const THEME_COOKIE_KEY = 'bb_calendar_theme';
const VALID_THEME_MODES = ['Light', 'Dark', 'Auto'];
const DAY_ALL_DAY_DEBUG_HOOK = true;
const PX_TO_PT = 72 / 96;
const MAX_PDF_PAGE_SIDE_PT = 14000;
const MOBILE_SWIPE_ENABLED_VIEWS = new Set(['dayGridMonth', 'timeGridWeek', 'timeGridDay']);
const MOBILE_SWIPE_MIN_DISTANCE_PX = 56;
const MOBILE_SWIPE_AXIS_RATIO = 1.2;
const MOBILE_HEADER_COLLAPSE_CONFIG = Object.freeze({
  longPressMs: 560,
  dragStartDistancePx: 8,
  viewportEdgePaddingPx: 2,
  floatingButtonSizePx: 30,
  floatingButtonZIndex: 220,
  miniCircleSize: 18,
  miniCircleIconSize: 10,
  hideXSize: 16,
  hideXFontSize: 11
});

const defaultTaskForm = {
  title: '',
  description: '',
  startDate: '',
  endDate: '',
  startHour: '',
  startMinute: '',
  startPeriod: 'AM',
  endHour: '',
  endMinute: '',
  endPeriod: 'AM',
  allDay: false,
  acknowledgePublic: false
};

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const toIso = (value) => {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toISOString();
};

const toInputDateValue = (value) => {
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const toAllDayRange = (startValue, endValue) => {
  const start = new Date(`${startValue}T00:00:00`);
  const end = new Date(`${(endValue || startValue)}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  end.setDate(end.getDate() + 1);
  return { startDateTime: start.toISOString(), endDateTime: end.toISOString() };
};

const normalizeTimePart = (value) => String(value || '').replace(/\D/g, '').slice(0, 2);

const to12HourParts = (value) => {
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  const hour24 = dt.getHours();
  const minute = String(dt.getMinutes()).padStart(2, '0');
  const period = hour24 >= 12 ? 'PM' : 'AM';
  let hour12 = hour24 % 12;
  if (hour12 === 0) hour12 = 12;
  return {
    hour: String(hour12),
    minute,
    period
  };
};

const to24HourFrom12 = (hourRaw, minuteRaw, periodRaw, label) => {
  const hourNum = parseInt(hourRaw, 10);
  const minuteNum = parseInt(minuteRaw, 10);
  const period = String(periodRaw || '').toUpperCase();

  if (!Number.isInteger(hourNum) || hourNum < 1 || hourNum > 12) {
    return { ok: false, message: `${label} hour must be between 1 and 12.` };
  }

  if (!Number.isInteger(minuteNum) || minuteNum < 0 || minuteNum > 59) {
    return { ok: false, message: `${label} minute must be between 00 and 59.` };
  }

  if (period !== 'AM' && period !== 'PM') {
    return { ok: false, message: `${label} must include AM or PM.` };
  }

  let hour24 = hourNum;
  if (hourNum === 12) {
    hour24 = period === 'AM' ? 0 : 12;
  } else if (period === 'PM') {
    hour24 += 12;
  }

  const hh = String(hour24).padStart(2, '0');
  const mm = String(minuteNum).padStart(2, '0');
  return { ok: true, value: `${hh}:${mm}:00` };
};

const buildMiniMonthDays = (anchorDate) => {
  const first = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  const days = [];
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }
  return days;
};

const isAlertNotice = (eventLike) => {
  const title = String(eventLike?.title || '').toUpperCase();
  if (title.startsWith('ALERT:')) return true;
  const color = String(eventLike?.color || '');
  return color.includes('185, 28, 28') || color.includes('#b91c1c') || color.includes('#d93025');
};

const toDateOrNull = (value) => {
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
};

const eventSourceOf = (eventLike) => {
  const directSource = eventLike?.source;
  if (typeof directSource === 'string' && directSource.trim()) {
    return directSource.trim();
  }
  const extendedSource = eventLike?.extendedProps?.source;
  if (typeof extendedSource === 'string' && extendedSource.trim()) {
    return extendedSource.trim();
  }
  return '';
};

const eventDescriptionOf = (eventLike) =>
  String(eventLike?.description || eventLike?.extendedProps?.description || eventLike?.extendedProps?.summary || '');

const extractRawEventId = (value) => {
  const id = String(value || '').trim();
  if (!id) return '';
  const sep = id.indexOf('::');
  if (sep <= 0) return id;
  return id.slice(sep + 2);
};

const eventNoticeIdOf = (eventLike) =>
  String(eventLike?.noticeId || eventLike?.extendedProps?.noticeId || extractRawEventId(eventLike?.id) || '');
const eventTaskIdOf = (eventLike) =>
  String(eventLike?.taskId || eventLike?.extendedProps?.taskId || extractRawEventId(eventLike?.id) || '');

const normalizeEntityRouteId = (value) => {
  let next = String(value || '').trim();
  if (!next) return '';

  // Peel repeated namespace prefixes like NOTICE::NOTICE::id
  for (let i = 0; i < 6 && next.includes('::'); i += 1) {
    const pos = next.indexOf('::');
    if (pos < 0) break;
    next = next.slice(pos + 2).trim();
  }

  // Remove plain source prefixes if present.
  next = next.replace(/^(NOTICE_BG|NOTICE|TASK|FESTIVAL)\s*[:|]\s*/i, '').trim();

  // Prefer a canonical Mongo/ObjectId token when embedded.
  const objectIdMatch = next.match(/\b[a-fA-F0-9]{24}\b/);
  if (objectIdMatch) return objectIdMatch[0];

  return next;
};

const eventIdentityKeyOf = (eventLike) => {
  const source = eventSourceOf(eventLike);
  const taskId = eventTaskIdOf(eventLike);
  const noticeId = eventNoticeIdOf(eventLike);
  const rawId = extractRawEventId(eventLike?.id);

  if (source === 'TASK') {
    return taskId ? `TASK:${taskId}` : (rawId ? `TASK:${rawId}` : '');
  }
  if (source === 'NOTICE') {
    return noticeId ? `NOTICE:${noticeId}` : (rawId ? `NOTICE:${rawId}` : '');
  }
  // During fast drag interactions FullCalendar can briefly provide event objects
  // where source is missing. Prefer stable domain ids before generic fallback.
  if (taskId) return `TASK:${taskId}`;
  if (noticeId) return `NOTICE:${noticeId}`;

  if (!rawId) return '';
  return `${source || 'EVENT'}:${rawId}`;
};

const eventPriorityRank = (eventLike) => {
  const source = eventSourceOf(eventLike);
  if (source === 'FESTIVAL') return 0;
  if ((source === 'NOTICE' || source === 'NOTICE_BG') && isAlertNotice(eventLike)) return 1;
  if (source === 'NOTICE' || source === 'NOTICE_BG') return 2;
  if (source === 'TASK') return 3;
  return 4;
};

const eventStartMs = (eventLike) => {
  const dt = toDateOrNull(eventLike?.start || eventLike?.startStr);
  return dt ? dt.getTime() : Number.MAX_SAFE_INTEGER;
};

const compareCalendarEventPriority = (aLike, bLike) => {
  const a = aLike?.event || aLike;
  const b = bLike?.event || bLike;

  const rankA = eventPriorityRank(a);
  const rankB = eventPriorityRank(b);
  if (rankA !== rankB) return rankA - rankB;

  const allDayA = Boolean(a?.allDay);
  const allDayB = Boolean(b?.allDay);
  if (allDayA !== allDayB) return allDayA ? -1 : 1;

  const startA = eventStartMs(a);
  const startB = eventStartMs(b);
  if (startA !== startB) return startA - startB;

  return String(a?.title || '').localeCompare(String(b?.title || ''));
};

const eventPassesFilters = (eventLike, filters) => {
  const source = eventSourceOf(eventLike);
  if (source === 'FESTIVAL') return filters.festival;
  if (source === 'TASK') return filters.task;
  if (source === 'NOTICE' || source === 'NOTICE_BG') {
    return isAlertNotice(eventLike) ? filters.alert : filters.notice;
  }
  return true;
};

const toSearchBadge = (eventLike) => {
  const source = eventSourceOf(eventLike);
  if (source === 'TASK') return { label: 'TASK', className: 'task' };
  if (source === 'FESTIVAL') return { label: 'FESTIVAL', className: 'festival' };
  if (isAlertNotice(eventLike)) return { label: 'ALERT', className: 'alert' };
  return { label: 'NOTICE', className: 'notice' };
};

const formatResultDate = (eventLike) => {
  const start = toDateOrNull(eventLike?.start);
  if (!start) return { day: 'Unknown', full: 'Date unavailable' };
  return {
    day: start.toLocaleDateString('en-US', { day: '2-digit', month: 'short' }),
    full: start.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })
  };
};

const formatResultTime = (eventLike) => {
  if (eventLike?.allDay) return 'All day';
  const start = toDateOrNull(eventLike?.start);
  const end = toDateOrNull(eventLike?.end);
  if (!start || !end) return 'Time unavailable';
  return `${start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} - ${end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
};

const toDateKeyLocal = (value) => {
  const dt = toDateOrNull(value);
  if (!dt) return '';
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const waitMs = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

const formatScheduleDateString = (dateString) => {
  const dateObj = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(dateObj.getTime())) return { dayNum: '', label: '' };
  const dayNum = dateObj.getDate();
  const month = dateObj.toLocaleString('en-US', { month: 'short' }).toUpperCase();
  const weekday = dateObj.toLocaleString('en-US', { weekday: 'short' }).toUpperCase();
  return { dayNum, label: `${month}, ${weekday}` };
};

const stripYearFromHeaderTitle = (title) => {
  const raw = String(title || '').trim();
  if (!raw) return '';

  return raw
    .replace(/,\s*\d{4}\b/g, '')
    .replace(/\s+\d{4}\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*([\u2013\u2014-])\s*/g, ' $1 ')
    .replace(/\s{2,}/g, ' ')
    .replace(/[,\s]+$/g, '')
    .trim();
};

const computeAllDaySpanDays = (startValue, endValue) => {
  const start = toDateOrNull(startValue);
  if (!start) return 1;
  const end = toDateOrNull(endValue);
  if (!end) return 1;
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const diffMs = endDay.getTime() - startDay.getTime();
  const rawDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
  return Math.max(1, rawDays);
};

const getStableAllDaySpanDays = (eventLike, fallbackStart = null, fallbackEnd = null) => {
  const direct = Number(eventLike?.extendedProps?.gcalAllDaySpanDays);
  if (Number.isFinite(direct) && direct >= 1) return Math.round(direct);
  return computeAllDaySpanDays(
    fallbackStart || eventLike?.start,
    fallbackEnd || eventLike?.end
  );
};

const formatScheduleCompactTime = (value) => {
  const dt = toDateOrNull(value);
  if (!dt) return '';
  const useMinute = dt.getMinutes() !== 0;
  return dt
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: useMinute ? '2-digit' : undefined, hour12: true })
    .toLowerCase()
    .replace(/\s/g, '');
};

const createSchedulePopoverEvent = (eventLike, start, end, color) => {
  const source = eventSourceOf(eventLike);
  const description = eventDescriptionOf(eventLike);
  const noticeId = eventNoticeIdOf(eventLike);
  const taskId = eventTaskIdOf(eventLike);
  const extended = eventLike?.extendedProps || {};
  const taskCanEdit = Boolean(eventLike?.canEdit || eventLike?.canEditTask || extended?.canEdit || extended?.canEditTask);
  const taskCanDelete = Boolean(eventLike?.canDelete || eventLike?.canDeleteTask || extended?.canDelete || extended?.canDeleteTask);

  return {
    id: String(eventLike?.id || taskId || ''),
    taskId,
    title: String(eventLike?.title || '').trim(),
    start,
    end,
    allDay: Boolean(eventLike?.allDay),
    color,
    backgroundColor: color,
    source,
    noticeId,
    display: eventLike?.display,
    extendedProps: {
      ...extended,
      source: source || String(extended?.source || ''),
      description: description || String(extended?.description || ''),
      summary: String(extended?.summary || description || ''),
      noticeId: noticeId || String(extended?.noticeId || ''),
      taskId: taskId || String(extended?.taskId || ''),
      canEdit: taskCanEdit,
      canDelete: taskCanDelete,
      canEditTask: taskCanEdit,
      canDeleteTask: taskCanDelete
    }
  };
};

const minutesToDurationString = (totalMinutes) => {
  const safe = Math.max(0, Number(totalMinutes) || 0);
  const hh = String(Math.floor(safe / 60)).padStart(2, '0');
  const mm = String(safe % 60).padStart(2, '0');
  return `${hh}:${mm}:00`;
};

// Notice routes treat ranges as inclusive day bounds and calendar serialization
// converts them back to exclusive all-day bounds. Convert from FC-style exclusive
// all-day end into notice-friendly inclusive end before persisting.
const toNoticeApiRange = (startValue, endValue, allDay = true) => {
  const start = toDateOrNull(startValue);
  const end = toDateOrNull(endValue);
  if (!start || !end) return null;

  if (!allDay) {
    return {
      startDateTime: start.toISOString(),
      endDateTime: end.toISOString()
    };
  }

  const inclusiveEnd = new Date(end.getTime() - 1);
  if (inclusiveEnd.getTime() <= start.getTime()) {
    inclusiveEnd.setTime(start.getTime() + (24 * 60 * 60 * 1000) - 1);
  }

  return {
    startDateTime: start.toISOString(),
    endDateTime: inclusiveEnd.toISOString()
  };
};

const stripNoticePrefix = (title) =>
  String(title || '').replace(/^\s*(ALERT|NOTICE)\s*:\s*/i, '').trim();

const stripFestivalPrefix = (title) =>
  String(title || '').replace(/^\s*FESTIVAL\s*:\s*/i, '').trim();

const sanitizeCalendarEvent = (eventLike) => {
  const source = eventSourceOf(eventLike);
  let nextEvent = { ...eventLike };

  // Keep all-day boundaries in local date-only form to avoid UTC spillover.
  if (nextEvent?.allDay) {
    const startDt = toDateOrNull(nextEvent.start);
    if (startDt) nextEvent.start = toInputDateValue(startDt);
    const endDt = toDateOrNull(nextEvent.end);
    if (endDt) nextEvent.end = toInputDateValue(endDt);
  }

  const allDaySpanDays = Boolean(nextEvent?.allDay)
    ? getStableAllDaySpanDays(nextEvent)
    : null;

  // Namespace ids by source to prevent collisions between NOTICE/TASK/FESTIVAL
  // records that can otherwise destabilize week all-day stacking/layout.
  if (source) {
    const currentId = String(nextEvent?.id || '').trim();
    if (currentId) {
      const rawId = extractRawEventId(currentId);
      const namespacedId = `${source}::${rawId}`;
      nextEvent = {
        ...nextEvent,
        id: namespacedId,
        source,
        extendedProps: {
          ...(nextEvent?.extendedProps || {}),
          source,
          originalId: rawId
        }
      };
    } else {
      nextEvent = {
        ...nextEvent,
        source,
        extendedProps: {
          ...(nextEvent?.extendedProps || {}),
          source
        }
      };
    }
  }

  // Ensure NOTICE_BG is always treated as a real background event so it cannot
  // occupy/cover all-day foreground strips in week/day views.
  if (source === 'NOTICE_BG') {
    const rawId = extractRawEventId(nextEvent?.id || eventLike?.id);
    const normalizedBgId = rawId ? `NOTICE_BG::${rawId}` : String(nextEvent?.id || eventLike?.id || '');
    nextEvent = {
      ...nextEvent,
      id: normalizedBgId || eventLike?.id,
      source: 'NOTICE_BG',
      display: 'background',
      extendedProps: {
        ...(nextEvent?.extendedProps || {}),
        originalId: rawId || String(eventLike?.extendedProps?.originalId || ''),
        source: 'NOTICE_BG',
        display: 'background'
      }
    };
  }

  if (Boolean(nextEvent?.allDay)) {
    nextEvent = {
      ...nextEvent,
      extendedProps: {
        ...(nextEvent?.extendedProps || {}),
        gcalAllDaySpanDays: Math.max(1, Number(allDaySpanDays) || 1)
      }
    };
  }

  if (source !== 'FESTIVAL') return nextEvent;
  const nextTitle = stripFestivalPrefix(nextEvent?.title);
  if (!nextTitle || nextTitle === nextEvent?.title) return nextEvent;
  return { ...nextEvent, title: nextTitle };
};

const sanitizeCalendarEvents = (events) =>
  (Array.isArray(events) ? events : []).map((event) => sanitizeCalendarEvent(event));

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const parseSlotMinutes = (value) => {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return (hh * 60) + mm;
};

const isEditableDomTarget = (target) => {
  if (!(target instanceof Element)) return false;
  if (target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return true;
  return Boolean(target.closest('.gcal-modal, .gcal-print-modal, .gcal-appearance-modal'));
};

const isMobileSwipeBlockedTarget = (target) => {
  if (!(target instanceof Element)) return false;
  if (isEditableDomTarget(target)) return true;
  return Boolean(
    target.closest(
      [
        'button',
        'a',
        'label',
        '[role="button"]',
        '[role="menu"]',
        '[role="menuitem"]',
        '.fc-event',
        '.gcal-event',
        '.event-click-zone',
        '.gcal-month-more-popup',
        '.gcal-event-popover',
        '.gcal-dropdown-menu',
        '.gcal-user-menu',
        '.quick-page-menu-panel'
      ].join(', ')
    )
  );
};

const resolveCalendarPasteTarget = (target, point = null) => {
  const candidates = [];
  if (target instanceof Element) candidates.push(target);
  const x = Number(point?.x);
  const y = Number(point?.y);
  if (Number.isFinite(x) && Number.isFinite(y)) {
    const pointEl = document.elementFromPoint(x, y);
    if (pointEl instanceof Element) candidates.push(pointEl);
  }
  if (!candidates.length) return null;

  for (const candidate of candidates) {
    if (!(candidate instanceof Element)) continue;

    const scheduleRow = candidate.closest('.day-group[data-date-key]');
    if (scheduleRow) {
      const dateKey = String(scheduleRow.getAttribute('data-date-key') || '').trim();
      if (dateKey) {
        return { dateKey, slotMinutes: null, source: 'listYear' };
      }
    }

    const dayGridCell = candidate.closest('.fc-daygrid-day[data-date]');
    if (dayGridCell) {
      const dateKey = String(dayGridCell.getAttribute('data-date') || '').trim();
      if (dateKey) {
        return { dateKey, slotMinutes: null, source: 'dayGrid' };
      }
    }

    const timeGridCol = candidate.closest('.fc-timegrid-col[data-date]');
    if (timeGridCol) {
      const dateKey = String(timeGridCol.getAttribute('data-date') || '').trim();
      if (!dateKey) continue;

      let slotCarrier = candidate.closest('[data-time]');
      if (!(slotCarrier instanceof Element) && Number.isFinite(x) && Number.isFinite(y)) {
        const pointEl = document.elementFromPoint(x, y);
        if (pointEl instanceof Element) {
          slotCarrier = pointEl.closest('[data-time]');
        }
      }
      const slotMinutes = parseSlotMinutes(slotCarrier?.getAttribute?.('data-time'));
      return { dateKey, slotMinutes, source: 'timeGrid' };
    }
  }

  return null;
};

const PRINT_VIEW_BY_CAL_VIEW = {
  timeGridDay: 'day',
  timeGridWeek: 'week',
  dayGridMonth: 'month',
  multiMonthYear: 'year',
  listYear: 'schedule'
};

const PRINT_VIEW_LABELS = {
  day: 'Day',
  week: 'Week',
  month: 'Month',
  year: 'Year',
  schedule: 'Schedule'
};

const PRINT_ORIENTATION_OPTIONS = {
  auto: 'Auto',
  portrait: 'Portrait',
  landscape: 'Landscape'
};

const DEFAULT_PRINT_OPTIONS = {
  fontSize: 12,
  orientation: 'auto',
  showEvents: true,
  showWeekends: true,
  showDeclined: true,
  gridScale: 100,
  gridScaleX: 100,
  gridScaleY: 100
};

const addDays = (dateValue, days) => {
  const dt = new Date(dateValue);
  dt.setDate(dt.getDate() + days);
  return dt;
};

const addMonths = (dateValue, months) => {
  const dt = new Date(dateValue);
  dt.setMonth(dt.getMonth() + months);
  return dt;
};

const toMonthInputValue = (value) => {
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  return `${String(dt.getMonth() + 1).padStart(2, '0')}-${dt.getFullYear()}`;
};

const fromMonthInputValue = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) return null;

  let year = NaN;
  let monthIndex = NaN;

  const mmYyyyMatch = normalized.match(/^(\d{1,2})[-/](\d{4})$/);
  if (mmYyyyMatch) {
    year = Number(mmYyyyMatch[2]);
    monthIndex = Number(mmYyyyMatch[1]) - 1;
  } else {
    const yyyyMmMatch = normalized.match(/^(\d{4})[-/](\d{1,2})$/);
    if (!yyyyMmMatch) return null;
    year = Number(yyyyMmMatch[1]);
    monthIndex = Number(yyyyMmMatch[2]) - 1;
  }

  if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) return null;
  return new Date(year, monthIndex, 1);
};

const normalizeMonthInputValue = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const mmYyyyMatch = raw.match(/^(\d{1,2})[-/](\d{4})$/);
  if (mmYyyyMatch) {
    const month = Number(mmYyyyMatch[1]);
    if (Number.isInteger(month) && month >= 1 && month <= 12) {
      return `${String(month).padStart(2, '0')}-${mmYyyyMatch[2]}`;
    }
  }

  const yyyyMmMatch = raw.match(/^(\d{4})[-/](\d{1,2})$/);
  if (yyyyMmMatch) {
    const month = Number(yyyyMmMatch[2]);
    if (Number.isInteger(month) && month >= 1 && month <= 12) {
      return `${String(month).padStart(2, '0')}-${yyyyMmMatch[1]}`;
    }
  }

  return raw;
};

const toIsoWeekInputValue = (value) => {
  const source = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(source.getTime())) return '';
  const dt = new Date(Date.UTC(source.getFullYear(), source.getMonth(), source.getDate()));
  dt.setUTCDate(dt.getUTCDate() + 4 - (dt.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((dt - yearStart) / 86400000) + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
};

const fromIsoWeekInputValue = (value) => {
  const match = String(value || '').match(/^(\d{4})-W(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(week) || week < 1 || week > 53) return null;
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1) + ((week - 1) * 7));
  return new Date(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate());
};

const toYearInputValue = (value) => {
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  return String(dt.getFullYear());
};

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const createDefaultPrintForm = (anchorDate, preferredView) => {
  const anchor = anchorDate instanceof Date && !Number.isNaN(anchorDate.getTime()) ? anchorDate : new Date();
  const dayValue = toInputDateValue(anchor);
  const monthValue = toMonthInputValue(anchor);
  const weekValue = toIsoWeekInputValue(anchor);
  const yearValue = toYearInputValue(anchor);
  const resolvedView = PRINT_VIEW_LABELS[preferredView] ? preferredView : 'month';
  return {
    view: resolvedView,
    dayFrom: dayValue,
    dayTo: dayValue,
    weekFrom: weekValue,
    weekTo: weekValue,
    weekFromDate: dayValue,
    weekToDate: dayValue,
    monthFrom: monthValue,
    monthTo: monthValue,
    yearFrom: yearValue,
    yearTo: yearValue,
    scheduleFrom: dayValue,
    scheduleTo: dayValue
  };
};

const defaultPrintPageDimensionsMm = (orientation) => {
  const mode = String(orientation || 'auto').toLowerCase();
  if (mode === 'landscape') return { widthMm: 297, heightMm: 210 };
  return { widthMm: 210, heightMm: 297 };
};

const PRINT_PAGE_MM_MIN = 80;
const PRINT_PAGE_MM_MAX = 3000;
const PRINT_PAGE_SIZE_ERROR_MESSAGE = `Please enter valid W between ${PRINT_PAGE_MM_MIN} to ${PRINT_PAGE_MM_MAX} mm and H between ${PRINT_PAGE_MM_MIN} to ${PRINT_PAGE_MM_MAX} mm.`;

const pxToMm = (px) => (Number(px) * 25.4) / 96;
const mmToPt = (mm) => Number(mm) * 72 / 25.4;

const isDeclinedPrintableEvent = (eventLike) => {
  const evt = eventLike || {};
  const ext = evt.extendedProps || {};
  const normalizedCandidates = [
    evt?.declined,
    ext?.declined,
    ext?.isDeclined,
    ext?.attendance,
    ext?.responseStatus,
    ext?.rsvpStatus,
    ext?.status
  ];

  return normalizedCandidates.some((candidate) => {
    if (typeof candidate === 'boolean') return candidate;
    const value = String(candidate || '').trim().toLowerCase();
    return value === 'declined' || value === 'no';
  });
};

const ensureOptionValue = (value, options, fallbackValue = '') => {
  const normalized = String(value || '').trim();
  if (normalized && options.some((opt) => String(opt?.value || '') === normalized)) return normalized;
  const fallback = String(fallbackValue || '').trim();
  if (fallback && options.some((opt) => String(opt?.value || '') === fallback)) return fallback;
  return String(options?.[0]?.value || '');
};

const reorderOptionsWithSelectedFirst = (options, selectedValue) => {
  const list = Array.isArray(options) ? options : [];
  if (!list.length) return list;
  const selected = String(selectedValue || '').trim();
  if (!selected) return list;
  const selectedIndex = list.findIndex((opt) => String(opt?.value || '') === selected);
  if (selectedIndex < 0) return list;
  const selectedItem = list[selectedIndex];
  const rest = list.filter((_, idx) => idx !== selectedIndex);
  return [selectedItem, ...rest];
};

const buildMonthPrintOptions = (anchorYear, pastYears = 6, futureYears = 6) => {
  const yearBase = Number.isInteger(anchorYear) ? anchorYear : new Date().getFullYear();
  const options = [];
  for (let year = yearBase - pastYears; year <= yearBase + futureYears; year += 1) {
    for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
      const value = `${String(monthIndex + 1).padStart(2, '0')}-${year}`;
      const label = `${MONTHS[monthIndex]} ${year}`;
      options.push({ value, label });
    }
  }
  return options;
};

const buildWeekPrintOptions = (anchorYear, pastYears = 6, futureYears = 6) => {
  const yearBase = Number.isInteger(anchorYear) ? anchorYear : new Date().getFullYear();
  const options = [];

  for (let year = yearBase - pastYears; year <= yearBase + futureYears; year += 1) {
    for (let week = 1; week <= 53; week += 1) {
      const value = `${year}-W${String(week).padStart(2, '0')}`;
      const weekStart = fromIsoWeekInputValue(value);
      if (!(weekStart instanceof Date) || Number.isNaN(weekStart.getTime())) continue;
      if (toIsoWeekInputValue(weekStart) !== value) continue;

      const weekEnd = addDays(weekStart, 6);
      const startPart = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const endPart = weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      options.push({
        value,
        startMs: weekStart.getTime(),
        label: `${year} | Week ${String(week).padStart(2, '0')} | ${startPart} - ${endPart}`
      });
    }
  }

  options.sort((a, b) => a.startMs - b.startMs);
  return options.map(({ startMs, ...rest }) => rest);
};

const buildSchedulePrintOptions = (events) => {
  const dateKeys = new Set();
  const list = Array.isArray(events) ? events : [];

  list.forEach((evt) => {
    const start = toDateOrNull(evt?.start);
    const end = toDateOrNull(evt?.end);
    if (!start || !end) return;

    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const endExclusive = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    if (!evt?.allDay) {
      endExclusive.setDate(endExclusive.getDate() + 1);
    }
    if (endExclusive.getTime() <= startDay.getTime()) {
      endExclusive.setDate(startDay.getDate() + 1);
    }

    for (let day = new Date(startDay); day.getTime() < endExclusive.getTime(); day = addDays(day, 1)) {
      dateKeys.add(toInputDateValue(day));
    }
  });

  return Array.from(dateKeys)
    .sort()
    .map((dateKey) => {
      const dt = new Date(`${dateKey}T00:00:00`);
      const label = Number.isNaN(dt.getTime())
        ? dateKey
        : dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
      return { value: dateKey, label };
    });
};

const parseColorToRgb = (inputColor) => {
  const color = String(inputColor || '').trim();
  if (!color) return null;
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      if ([r, g, b].every((v) => Number.isFinite(v))) return { r, g, b };
    }
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      if ([r, g, b].every((v) => Number.isFinite(v))) return { r, g, b };
    }
    return null;
  }
  const rgbMatch = color.match(/rgba?\(([^)]+)\)/i);
  if (!rgbMatch) return null;
  const nums = rgbMatch[1].split(',').map((part) => Number(part.trim()));
  if (nums.length < 3 || nums.some((v, idx) => idx < 3 && !Number.isFinite(v))) return null;
  return { r: nums[0], g: nums[1], b: nums[2] };
};

const readableTextColorForBg = (bgColor) => {
  const rgb = parseColorToRgb(bgColor);
  if (!rgb) return '#ffffff';
  const luminance = (0.299 * rgb.r) + (0.587 * rgb.g) + (0.114 * rgb.b);
  return luminance > 164 ? '#000000' : '#ffffff';
};

const CONNECTOR_ICON_PATHS = [
  'M 80.224 73.891 c -0.049 0.007 -0.095 0.029 -0.145 0.029 c -0.029 0 -0.055 -0.014 -0.084 -0.017 c -0.038 -0.001 -0.073 0.012 -0.111 0.006 c -0.064 -0.009 -0.117 -0.042 -0.176 -0.063 c -0.007 -0.003 -0.013 -0.004 -0.019 -0.007 c -0.21 -0.078 -0.383 -0.211 -0.498 -0.393 l -8.733 -8.734 c -0.391 -0.391 -0.391 -1.023 0 -1.414 s 1.023 -0.391 1.414 0 l 7.41 7.411 c 1.64 -15.449 -4.181 -28.442 -16.193 -35.847 c -0.471 -0.29 -0.617 -0.906 -0.327 -1.376 s 0.906 -0.616 1.376 -0.326 C 75.44 40.125 81.578 51.72 81.578 65.636 c 0 1.505 -0.08 3.04 -0.225 4.596 l 6.934 -6.934 c 0.391 -0.391 1.023 -0.391 1.414 0 c 0.195 0.195 0.293 0.451 0.293 0.707 c 0 0.256 -0.098 0.512 -0.293 0.707 l -8.914 8.914 c -0.131 0.131 -0.298 0.204 -0.475 0.247 C 80.283 73.882 80.254 73.885 80.224 73.891 z',
  'M 32.153 16.912 c 10.517 2.136 19.862 8.403 23.81 15.969 c 0.929 1.793 1.383 3.915 1.383 6.185 c 0 3.564 -1.12 7.493 -3.284 11.086 c -2.334 3.879 -5.582 6.906 -9.145 8.525 c -3.689 1.676 -7.284 1.658 -10.124 -0.052 c -5.733 -3.451 -6.419 -12.871 -1.529 -20.994 c 0.003 -0.006 0.01 -0.009 0.013 -0.014 c 2.095 -3.475 4.99 -6.324 8.152 -8.022 c 0.486 -0.261 1.093 -0.079 1.354 0.408 c 0.081 0.15 0.119 0.313 0.119 0.472 c 0 0.356 -0.191 0.702 -0.527 0.882 c -2.855 1.534 -5.481 4.129 -7.395 7.308 c -0.003 0.004 -0.007 0.006 -0.01 0.01 c -4.314 7.178 -3.933 15.354 0.853 18.238 c 2.258 1.359 5.193 1.339 8.265 -0.057 c 3.197 -1.453 6.131 -4.2 8.259 -7.735 c 3.191 -5.299 3.913 -11.312 1.84 -15.317 c -3.679 -7.05 -12.484 -12.911 -22.434 -14.931 C 20.714 16.63 10.016 19.2 1.629 26.11 c -0.426 0.351 -1.056 0.29 -1.408 -0.136 c -0.351 -0.426 -0.291 -1.056 0.136 -1.408 C 9.218 17.266 20.51 14.547 32.153 16.912 z'
];
const CONNECTOR_ICON_TAIL = { x: 1.6, y: 25.3 };
const CONNECTOR_ICON_HEAD = { x: 89.2, y: 64.2 };
const SCHEDULE_POPOVER_RIGHT_GAP = 76; // Manual control: distance from viewport right
const SCHEDULE_POPOVER_Y_OFFSET = 118; // Manual control: card vertical anchor offset from click
const SCHEDULE_CONNECTOR_FIXED_SCALE = 0.62;
const SCHEDULE_CONNECTOR_HEAD_INSET_X = 18;
const MONTH_MORE_CONNECTOR_HEAD_INSET = 8;
const MONTH_MORE_CONNECTOR_HEAD_TOP_OFFSET = 54; // Keep arrow head below close (X) icon with a clear vertical gap

const computePopoverLayout = (anchorRect, popupWidth, popupHeight) => {
  const margin = 12;
  const gap = 10;
  const width = Math.max(280, popupWidth || 520);
  const height = Math.max(240, popupHeight || 420);
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  const rightSpace = viewportWidth - anchorRect.right - margin;
  const leftSpace = anchorRect.left - margin;

  let placement = rightSpace >= leftSpace ? 'right' : 'left';
  if (placement === 'right' && rightSpace < width + gap && leftSpace >= width + gap) placement = 'left';
  if (placement === 'left' && leftSpace < width + gap && rightSpace >= width + gap) placement = 'right';

  let x = placement === 'right'
    ? anchorRect.right + gap
    : anchorRect.left - width - gap;
  x = clamp(x, margin, viewportWidth - width - margin);

  let y = anchorRect.top - 20;
  y = clamp(y, margin, viewportHeight - height - margin);

  const arrowTop = clamp(anchorRect.top + (anchorRect.height / 2) - y, 26, height - 26);
  return { x, y, placement, arrowTop };
};

const computeSchedulePopoverLayout = (stripRect, anchorPoint, popupWidth, popupHeight) => {
  const margin = 12;
  const width = Math.max(280, popupWidth || 520);
  const height = Math.max(240, popupHeight || 420);
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  const stripTop = Number.isFinite(stripRect?.top) ? stripRect.top : 0;
  const stripBottom = Number.isFinite(stripRect?.bottom) ? stripRect.bottom : viewportHeight;

  const pointYRaw = Number(anchorPoint?.y);
  const pointY = Number.isFinite(pointYRaw)
    ? clamp(pointYRaw, stripTop + 2, stripBottom - 2)
    : clamp(stripTop + ((stripBottom - stripTop) / 2), margin + 2, viewportHeight - margin - 2);

  // Schedule-only fixed horizontal placement: always near right viewport side.
  let x = viewportWidth - width - SCHEDULE_POPOVER_RIGHT_GAP;
  x = clamp(x, margin, viewportWidth - width - margin);

  // Vertical follows click area while preventing cutoff.
  let y = pointY - SCHEDULE_POPOVER_Y_OFFSET;
  y = clamp(y, margin, viewportHeight - height - margin);

  const arrowTop = clamp(pointY - y, 26, height - 26);
  return { x, y, placement: 'right', arrowTop, verticalPlacement: 'fixed' };
};

const pad2 = (value) => String(value).padStart(2, '0');

const toDateTimeLocalInput = (value) => {
  const dt = toDateOrNull(value);
  if (!dt) return '';
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}T${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
};

const emptyPopoverEditForm = () => ({
  title: '',
  subject: '',
  description: '',
  startDateTime: '',
  endDateTime: ''
});

const emptyDeleteConfirmState = () => ({
  open: false,
  kind: '',
  id: '',
  title: '',
  message: ''
});

const normalizeThemeMode = (value) => {
  if (VALID_THEME_MODES.includes(String(value || ''))) return String(value);
  return 'Light';
};

const readCookieValue = (key) => {
  if (typeof document === 'undefined') return '';
  const parts = String(document.cookie || '').split(';');
  const item = parts.find((entry) => entry.trim().startsWith(`${key}=`));
  if (!item) return '';
  return decodeURIComponent(item.trim().slice(key.length + 1));
};

const writeCookieValue = (key, value, days = 365) => {
  if (typeof document === 'undefined') return;
  const maxAge = Math.max(1, Number(days) || 365) * 24 * 60 * 60;
  document.cookie = `${key}=${encodeURIComponent(String(value || ''))}; max-age=${maxAge}; path=/; SameSite=Lax`;
};

const readGuestTheme = () => {
  const rawCookieTheme = readCookieValue(THEME_COOKIE_KEY);
  if (rawCookieTheme) return normalizeThemeMode(rawCookieTheme);
  return 'Light';
};

const persistThemeLocally = (mode) => {
  const normalized = normalizeThemeMode(mode);
  writeCookieValue(THEME_COOKIE_KEY, normalized);
};

const Svgs = {
  Menu: () => <svg focusable="false" viewBox="0 0 24 24"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"></path></svg>,
  Search: () => <svg focusable="false" viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"></path></svg>,
  Settings: () => <svg focusable="false" viewBox="0 0 24 24"><path d="M13.85 22.25h-3.7c-.74 0-1.36-.54-1.45-1.27l-.27-1.89c-.27-.14-.53-.29-.79-.46l-1.8.72c-.7.26-1.47-.03-1.81-.65L2.2 15.53c-.35-.66-.2-1.44.36-1.88l1.53-1.19c-.01-.15-.02-.3-.02-.46 0-.15.01-.31.02-.46l-1.52-1.19c-.59-.45-.74-1.26-.37-1.88l1.85-3.19c.34-.62 1.11-.9 1.79-.63l1.81.73c.26-.17.52-.32.78-.46l.27-1.91c.09-.7.71-1.25 1.44-1.25h3.7c.74 0 1.36.54 1.45 1.27l.27 1.89c.27.14.53.29.79.46l1.8-.72c.71-.26 1.48.03 1.82.65l1.84 3.18c.36.66.2 1.44-.36 1.88l-1.52 1.19c.01.15.02.3.02.46s-.01.31-.02.46l1.52 1.19c.56.45.72 1.23.37 1.86l-1.86 3.22c-.34.62-1.11.9-1.8.63l-1.8-.72c-.26.17-.52.32-.78.46l-.27 1.91c-.1.68-.72 1.22-1.46 1.22zm-3.23-2h2.76l.37-2.55.53-.22c.44-.18.88-.44 1.34-.78l.45-.34 2.38.96 1.38-2.4-2.03-1.58.07-.56c.03-.26.06-.51.06-.78s-.03-.53-.06-.78l-.07-.56 2.03-1.58-1.39-2.4-2.39.96-.45-.35c-.46-.32-.9-.59-1.34-.77l-.53-.22-.38-2.55h-2.76l-.37 2.55-.53.21c-.44.19-.88.44-1.34.79l-.45.33-2.38-.95-1.39 2.39 2.03 1.58-.07.56a7.17 7.17 0 0 0-.06.79c0 .26.02.53.06.78l.07.56-2.03 1.58 1.38 2.4 2.39-.96.45.35c.43.33.86.58 1.31.77l.53.22.38 2.55zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"></path></svg>,
  CaretDown: () => <svg focusable="false" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5H7z"></path></svg>,
  Plus: () => (
    <svg width="36" height="36" viewBox="0 0 36 36">
      <path fill="#34A853" d="M16 16v14h4V20z"></path>
      <path fill="#4285F4" d="M30 16H20l-4 4h14z"></path>
      <path fill="#FBBC05" d="M6 16v4h10l4-4z"></path>
      <path fill="#EA4335" d="M20 16V6h-4v14z"></path>
      <path fill="none" d="M0 0h36v36H0z"></path>
    </svg>
  ),
  AI: () => <svg focusable="false" viewBox="0 0 24 24"><path d="M12 2l1.95 4.45L18.5 8.4l-3.55 3.18.99 4.82L12 13.94 8.06 16.4l.99-4.82L5.5 8.4l4.55-1.95L12 2zm7.2 12.2l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1zM4.8 14.2l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1z"></path></svg>,
  Check: () => <svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"></path></svg>,
  Trash: () => <svg viewBox="0 0 24 24"><path d="M15 4V3H9v1H4v2h1v13c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V6h1V4h-5zm2 15H7V6h10v13z"></path><path d="M9 8h2v9H9zm4 0h2v9h-2z"></path></svg>,
  Edit: () => <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75l10.99-10.99-3.75-3.75L3 17.25zm14.71-9.04a.996.996 0 0 0 0-1.41l-2.51-2.51a.996.996 0 1 0-1.41 1.41l2.51 2.51c.39.39 1.02.39 1.41 0z"></path></svg>,
  Copy: () => <svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 18H8V7h11v16z"></path></svg>,
  Info: () => <svg viewBox="0 0 24 24"><path d="M11 17h2v-6h-2v6zm1-14C6.48 3 2 7.48 2 13s4.48 10 10 10 10-4.48 10-10S17.52 3 12 3zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-12h2V7h-2v2z"></path></svg>,
  Close: () => <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"></path></svg>,
  Desc: () => <svg viewBox="0 0 24 24"><path d="M14 17H4v2h10v-2zm6-8H4v2h16V9zM4 15h16v-2H4v2zM4 5v2h16V5H4z"></path></svg>,
  CalendarIcon: () => <svg viewBox="0 0 24 24"><path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zm0-12H5V6h14v2z"></path></svg>,
  ExpandDiagonal: () => <svg viewBox="0 0 24 24"><path d="M15 3h6v6h-2V6.41l-4.29 4.3-1.42-1.42L17.59 5H15V3zm-6 18H3v-6h2v2.59l4.29-4.3 1.42 1.42L6.41 19H9v2z"></path></svg>,
  CollapseDiagonal: () => <svg viewBox="0 0 24 24"><path d="M3 9V3h6v2H6.41l4.3 4.29-1.42 1.42L5 6.41V9H3zm12 12v-2h2.59l-4.3-4.29 1.42-1.42L19 17.59V15h2v6h-6z"></path></svg>,
  Lock: () => <svg viewBox="0 0 24 24"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"></path></svg>,
  Back: () => <svg viewBox="0 0 24 24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"></path></svg>,
  User: () => <svg viewBox="0 0 24 24"><path d="M12 12c2.76 0 5-2.24 5-5S14.76 2 12 2 7 4.24 7 7s2.24 5 5 5zm0 2c-3.33 0-10 1.67-10 5v1h20v-1c0-3.33-6.67-5-10-5z"></path></svg>
};

export default function CalendarPage() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const auth = useSelector((state) => state.user);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 900px)').matches : false
  );

  const calendarRef = useRef(null);
  const calendarCardRef = useRef(null);
  const popoverRef = useRef(null);
  const activeRangeRef = useRef(null);
  const schedulePanelRef = useRef(null);
  const scheduleWrapperRef = useRef(null);
  const scheduleDragRef = useRef({
    active: false,
    scheduleEvent: null,
    sourceDateKey: '',
    justDragged: false
  });
  const monthMoreDragRef = useRef({
    active: false,
    eventData: null,
    sourceDateKey: '',
    justDragged: false
  });
  const scheduleAutoScrollTimerRef = useRef(null);
  const scheduleAutoScrollDirRef = useRef(0);
  const loadEventsRequestRef = useRef(0);
  const moveQueueRef = useRef(Promise.resolve());
  const moveVersionByIdentityRef = useRef(new Map());
  const allDaySpanByIdentityRef = useRef(new Map());
  const movePersistFailureRef = useRef(false);
  const pendingMoveCountRef = useRef(0);
  const postMoveSyncTimerRef = useRef(null);
  const copiedEventRef = useRef(null);
  const lastPointerRef = useRef({ x: NaN, y: NaN });
  const startDatePickerRef = useRef(null);
  const endDatePickerRef = useRef(null);
  const dayAllDayDebugRef = useRef({ signature: '' });
  const printGridResizeRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    startScale: 100
  });
  const printPageResizeRef = useRef({
    active: false,
    pageIndex: -1,
    axis: 'both',
    startX: 0,
    startY: 0,
    startWidthMm: 210,
    startHeightMm: 297
  });

  const [allEvents, setAllEvents] = useState([]);
  const [error, setError] = useState('');
  const [canManageTasks, setCanManageTasks] = useState(false);
  const [taskForm, setTaskForm] = useState(defaultTaskForm);
  const [postingTask, setPostingTask] = useState(false);
  const [taskMessage, setTaskMessage] = useState('');
  const [viewType, setViewType] = useState('dayGridMonth');
  const [viewTitle, setViewTitle] = useState('');
  const [viewRange, setViewRange] = useState({ start: null, end: null });
  const [weekAllDayExpanded, setWeekAllDayExpanded] = useState(false);
  const [dayAllDayExpanded, setDayAllDayExpanded] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== 'undefined' ? !window.matchMedia('(max-width: 900px)').matches : true
  );
  const [miniAnchorDate, setMiniAnchorDate] = useState(new Date());
  
  // Search state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchMessage, setSearchMessage] = useState('');
  const [searchExecutedQuery, setSearchExecutedQuery] = useState('');
  const [pendingGotoIso, setPendingGotoIso] = useState('');
  const searchReturnRef = useRef({ view: 'dayGridMonth', dateIso: '' });

  // Dropdowns & Modals
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [viewDropdownOpen, setViewDropdownOpen] = useState(false);
  const [settingsDropdownOpen, setSettingsDropdownOpen] = useState(false);
  const [appearanceModalOpen, setAppearanceModalOpen] = useState(false);
  const [popover, setPopover] = useState({
    open: false,
    x: -10000,
    y: -10000,
    eventData: null,
    anchorRect: null,
    layoutAnchorRect: null,
    anchorPoint: null,
    connectorNameRect: null,
    sourceView: '',
    verticalPlacement: 'below',
    placement: 'right',
    arrowTop: 48,
    positionReady: false,
    cardWidth: 0,
    cardHeight: 0
  });
  const [popoverEditMode, setPopoverEditMode] = useState(false);
  const [popoverEditLoading, setPopoverEditLoading] = useState(false);
  const [popoverEditSaving, setPopoverEditSaving] = useState(false);
  const [popoverDeleting, setPopoverDeleting] = useState(false);
  const [popoverEditError, setPopoverEditError] = useState('');
  const [popoverEditForm, setPopoverEditForm] = useState(emptyPopoverEditForm);
  const [copyHelpOpen, setCopyHelpOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(emptyDeleteConfirmState);

  // Accordions
  const [myCalsOpen, setMyCalsOpen] = useState(true);
  const [otherCalsOpen, setOtherCalsOpen] = useState(true);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');
  const [snackbarSeverity, setSnackbarSeverity] = useState('success');

  const [filters, setFilters] = useState({ notice: true, alert: true, festival: true, task: true });
  const [viewOptions, setViewOptions] = useState({ weekends: true, declined: true, completed: true });
  const [themeMode, setThemeMode] = useState('Light');
  const [logoDay, setLogoDay] = useState(() => new Date().getDate());
  const [scheduleNowTick, setScheduleNowTick] = useState(Date.now());
  const [headerClockTick, setHeaderClockTick] = useState(Date.now());
  const [mobileHeaderButtonPositions, setMobileHeaderButtonPositions] = useState({ menu: null, ai: null });
  const [mobileHeaderDraggingKey, setMobileHeaderDraggingKey] = useState('');
  const [mobileHeaderHidden, setMobileHeaderHidden] = useState({ menu: false, ai: false });
  const [mobileHeaderHideTarget, setMobileHeaderHideTarget] = useState('');
  const mobileHeaderButtonNodeRef = useRef({ menu: null, ai: null });
  const mobileHeaderLongPressTimerRef = useRef(null);
  const mobileHeaderSuppressClickRef = useRef('');
  const mobileHeaderDragRef = useRef({
    key: '',
    pointerId: null,
    active: false,
    armed: false,
    dragging: false,
    startX: 0,
    startY: 0,
    offsetX: 0,
    offsetY: 0,
    width: MOBILE_HEADER_COLLAPSE_CONFIG.floatingButtonSizePx,
    height: MOBILE_HEADER_COLLAPSE_CONFIG.floatingButtonSizePx
  });
  const [scheduleDragTargetDateKey, setScheduleDragTargetDateKey] = useState('');
  const [monthMorePopup, setMonthMorePopup] = useState({
    open: false,
    x: 0,
    y: 0,
    dayText: '',
    dateNumber: '',
    events: []
  });
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [printSubmitting, setPrintSubmitting] = useState(false);
  const [printError, setPrintError] = useState('');
  const [printForm, setPrintForm] = useState(() => createDefaultPrintForm(new Date(), 'month'));
  const [printMonthPickerField, setPrintMonthPickerField] = useState('');
  const [printOptions, setPrintOptions] = useState(DEFAULT_PRINT_OPTIONS);
  const [printPagePrefs, setPrintPagePrefs] = useState({});
  const [printPageInputDrafts, setPrintPageInputDrafts] = useState({});
  const [printPreviewFullscreen, setPrintPreviewFullscreen] = useState(false);
  const printPreviewPageRefs = useRef({});
  const printPreviewFrameRefs = useRef({});
  const [printGridBoundsByPage, setPrintGridBoundsByPage] = useState({});
  const printPageDragCleanupRef = useRef(null);
  const printGridDragCleanupRef = useRef(null);

  const isAuthenticated = auth?.status === 'Authenticated';
  const isAdmin = String(auth?.user || '') === 'Admin';
  const isFaculty = String(auth?.user || '') === 'Department';
  const pushMoveSpanDebug = useCallback((payload) => {
    if (typeof window === 'undefined') return;
    const nextItem = { ts: new Date().toISOString(), ...payload };
    const list = Array.isArray(window.__gcalMoveDebug) ? window.__gcalMoveDebug : [];
    list.push(nextItem);
    if (list.length > 240) list.splice(0, list.length - 240);
    window.__gcalMoveDebug = list;
    window.__gcalMoveDebugLast = nextItem;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const guestTheme = readGuestTheme();

    if (!isAuthenticated) {
      setThemeMode(guestTheme);
      return () => {
        cancelled = true;
      };
    }

    const loadAccountTheme = async () => {
      try {
        const data = await getCalendarAppearanceApi();
        if (cancelled) return;
        const resolved = normalizeThemeMode(data?.themeMode || guestTheme);
        setThemeMode(resolved);
        persistThemeLocally(resolved);
      } catch (_) {
        if (cancelled) return;
        setThemeMode(guestTheme);
      }
    };

    loadAccountTheme();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, auth?.user]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const today = new Date().getDate();
      setLogoDay((prev) => (prev === today ? prev : today));
    }, 60 * 1000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setScheduleNowTick(Date.now());
    }, 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setHeaderClockTick(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mediaQuery = window.matchMedia('(max-width: 900px)');
    const applyViewportMode = (matches) => {
      setIsMobile(matches);
      setSidebarOpen((prev) => (matches ? false : true));
      if (matches) {
        setViewDropdownOpen(false);
        setSettingsDropdownOpen(false);
      }
    };

    applyViewportMode(mediaQuery.matches);

    const handleChange = (event) => applyViewportMode(event.matches);
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  useEffect(() => {
    if (isMobile && searchOpen) {
      setSidebarOpen(false);
    }
  }, [isMobile, searchOpen]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!Array.isArray(window.__gcalMoveDebug)) window.__gcalMoveDebug = [];
    if (!window.__gcalMoveDebug.length) {
      const initEntry = { ts: new Date().toISOString(), stage: 'init' };
      window.__gcalMoveDebug.push(initEntry);
      window.__gcalMoveDebugLast = initEntry;
    } else if (typeof window.__gcalMoveDebugLast === 'undefined') {
      window.__gcalMoveDebugLast = window.__gcalMoveDebug[window.__gcalMoveDebug.length - 1] || null;
    }
  }, []);

  useEffect(() => {
    const summarizeTarget = (target) => {
      if (!(target instanceof Element)) return { className: '', text: '' };
      const className = String(target.className || '').slice(0, 220);
      const text = String(target.textContent || '').trim().slice(0, 120);
      return { className, text };
    };

    const onDomDragStart = (ev) => {
      const node = ev.target instanceof Element
        ? (ev.target.closest('.fc-event, .gcal-month-more-event-row, .event-click-zone, .fc-daygrid-event-harness') || ev.target)
        : ev.target;
      const summary = summarizeTarget(node);
      pushMoveSpanDebug({ stage: 'dom-dragstart', ...summary });
    };

    const onDomDragEnd = (ev) => {
      const node = ev.target instanceof Element
        ? (ev.target.closest('.fc-event, .gcal-month-more-event-row, .event-click-zone, .fc-daygrid-event-harness') || ev.target)
        : ev.target;
      const summary = summarizeTarget(node);
      pushMoveSpanDebug({ stage: 'dom-dragend', ...summary });
    };

    const onDomDrop = (ev) => {
      const node = ev.target instanceof Element
        ? (ev.target.closest('.fc-daygrid-day, .fc-timegrid-col, .day-group, .fc-event, .gcal-month-more-popup') || ev.target)
        : ev.target;
      const summary = summarizeTarget(node);
      pushMoveSpanDebug({
        stage: 'dom-drop',
        ...summary,
        x: Number(ev?.clientX),
        y: Number(ev?.clientY)
      });
    };

    document.addEventListener('dragstart', onDomDragStart, true);
    document.addEventListener('dragend', onDomDragEnd, true);
    document.addEventListener('drop', onDomDrop, true);
    return () => {
      document.removeEventListener('dragstart', onDomDragStart, true);
      document.removeEventListener('dragend', onDomDragEnd, true);
      document.removeEventListener('drop', onDomDrop, true);
    };
  }, [pushMoveSpanDebug]);

  const applyThemeMode = async (nextMode) => {
    const normalized = normalizeThemeMode(nextMode);
    setThemeMode(normalized);
    persistThemeLocally(normalized);

    if (!isAuthenticated) return;
    try {
      await saveCalendarAppearanceApi(normalized);
    } catch (_) {
      setSnackbarSeverity('warning');
      setSnackbarMessage('Theme saved on this browser, but account sync failed.');
      setSnackbarOpen(true);
    }
  };

  const miniDays = useMemo(() => buildMiniMonthDays(miniAnchorDate), [miniAnchorDate]);

  const activeYearForCustomView = useMemo(() => {
    const titleMatch = String(viewTitle || '').match(/\d{4}/);
    if (titleMatch) return Number(titleMatch[0]);
    if (viewRange?.start && viewRange?.end) {
      const mid = new Date((viewRange.start.valueOf() + viewRange.end.valueOf()) / 2);
      if (!Number.isNaN(mid.getTime())) return mid.getFullYear();
    }
    return new Date().getFullYear();
  }, [viewTitle, viewRange]);

  const yearViewMonths = useMemo(() => {
    const year = Number(activeYearForCustomView) || new Date().getFullYear();
    const today = new Date();
    const isCurrentYear = today.getFullYear() === year;

    return MONTHS.map((monthName, monthIndex) => {
      const startDate = new Date(year, monthIndex, 1);
      const startDayOfWeek = startDate.getDay();
      const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
      const prevMonthDays = new Date(year, monthIndex, 0).getDate();
      const cells = [];

      for (let i = 0; i < 42; i += 1) {
        if (i < startDayOfWeek) {
          cells.push({
            key: `${monthIndex}-${i}-prev`,
            value: prevMonthDays - startDayOfWeek + 1 + i,
            className: 'other-month'
          });
          continue;
        }

        if (i >= startDayOfWeek + daysInMonth) {
          cells.push({
            key: `${monthIndex}-${i}-next`,
            value: i - (startDayOfWeek + daysInMonth) + 1,
            className: 'other-month'
          });
          continue;
        }

        const dayNumber = i - startDayOfWeek + 1;
        const isToday = isCurrentYear && monthIndex === today.getMonth() && dayNumber === today.getDate();
        cells.push({
          key: `${monthIndex}-${dayNumber}-current`,
          value: dayNumber,
          className: `current-month${isToday ? ' today' : ''}`
        });
      }

      return { monthName, monthIndex, cells };
    });
  }, [activeYearForCustomView]);

  const filteredEvents = useMemo(() => {
    return allEvents
      .filter((event) => eventPassesFilters(event, filters))
      .sort(compareCalendarEventPriority);
  }, [allEvents, filters]);

  const scheduleGroups = useMemo(() => {
    if (viewType !== 'listYear') return [];
    const today = new Date();
    const todayKey = toDateKeyLocal(today);
    const normalized = filteredEvents
      .filter((evt) => {
        const source = eventSourceOf(evt);
        if (source === 'NOTICE_BG') return false;
        const displayMode = String(evt?.display || evt?.extendedProps?.display || '').toLowerCase();
        if (displayMode === 'background') return false;
        return Boolean(toDateOrNull(evt?.start));
      })
      .map((evt) => {
        const start = toDateOrNull(evt?.start);
        const end = toDateOrNull(evt?.end);
        const source = eventSourceOf(evt);
        const isAlert = isAlertNotice(evt);
        const color = String(
          evt?.backgroundColor ||
          evt?.color ||
          evt?.extendedProps?.color ||
          (source === 'FESTIVAL' ? '#33b679' : source === 'TASK' ? '#039be5' : isAlert ? '#ea4335' : '#4285f4')
        );
        const timeText = evt?.allDay
          ? 'All day'
          : (start
              ? `${formatScheduleCompactTime(start)}${end ? ` \u2013 ${formatScheduleCompactTime(end)}` : ''}`
              : '');
        const icon = String(evt?.extendedProps?.icon || '');
        const location = String(evt?.extendedProps?.location || evt?.extendedProps?.venue || '');
        const popoverEventData = createSchedulePopoverEvent(evt, start, end, color);
        return {
          dateKey: toDateKeyLocal(start),
          isToday: sameDay(start, today),
          categoryRank: eventPriorityRank(evt),
          sortStart: start ? start.getTime() : 0,
          sortRank: evt?.allDay ? 0 : 1,
          title: String(evt?.title || '').trim(),
          time: timeText,
          color,
          icon,
          location,
          allDay: Boolean(evt?.allDay),
          startMs: start ? start.getTime() : null,
          endMs: end ? end.getTime() : null,
          popoverEventData
        };
      })
      .filter((evt) => Boolean(evt.dateKey))
      .sort((a, b) => {
        if (a.dateKey !== b.dateKey) return a.dateKey.localeCompare(b.dateKey);
        if (a.categoryRank !== b.categoryRank) return a.categoryRank - b.categoryRank;
        if (a.sortRank !== b.sortRank) return a.sortRank - b.sortRank;
        if (a.sortStart !== b.sortStart) return a.sortStart - b.sortStart;
        return a.title.localeCompare(b.title);
      });

    const groupedMap = new Map();
    normalized.forEach((evt) => {
      if (!groupedMap.has(evt.dateKey)) {
        const { dayNum, label } = formatScheduleDateString(evt.dateKey);
        groupedMap.set(evt.dateKey, {
          dateKey: evt.dateKey,
          dayNum,
          label,
          isToday: false,
          events: []
        });
      }
      const group = groupedMap.get(evt.dateKey);
      group.events.push(evt);
      if (evt.isToday) group.isToday = true;
    });

    // Always show today's row in schedule view, even when no events exist for today.
    if (!groupedMap.has(todayKey)) {
      const { dayNum, label } = formatScheduleDateString(todayKey);
      groupedMap.set(todayKey, {
        dateKey: todayKey,
        dayNum,
        label,
        isToday: true,
        events: []
      });
    }

    return Array.from(groupedMap.values()).sort((a, b) => String(a.dateKey).localeCompare(String(b.dateKey)));
  }, [filteredEvents, viewType]);

  const getScheduleIndicatorTop = useCallback((group) => {
    const events = Array.isArray(group?.events) ? group.events : [];
    const rowHeight = 40;
    const rowCount = Math.max(1, events.length);
    const groupHeight = rowCount * rowHeight;
    const now = new Date(scheduleNowTick);
    const minutes = (now.getHours() * 60) + now.getMinutes() + (now.getSeconds() / 60);
    const dayProgress = clamp(minutes / 1440, 0, 0.9999);
    const top = dayProgress * groupHeight;
    return clamp(top, 0, Math.max(0, groupHeight - 2));
  }, [scheduleNowTick]);

  const canDragCalendarEvent = useCallback((eventLike) => {
    const source = eventSourceOf(eventLike);
    if (source === 'TASK') {
      const extended = eventLike?.extendedProps || {};
      const canEdit = Boolean(
        eventLike?.canEdit ||
        eventLike?.canEditTask ||
        extended?.canEdit ||
        extended?.canEditTask
      );
      return Boolean(isAdmin || canEdit);
    }
    if (source === 'NOTICE') return Boolean(isAdmin);
    return false;
  }, [isAdmin]);

  const getLockedAllDaySpanDays = useCallback((eventLike, fallbackStart = null, fallbackEnd = null) => {
    const key = eventIdentityKeyOf(eventLike);
    if (key) {
      const locked = Number(allDaySpanByIdentityRef.current.get(key));
      if (Number.isFinite(locked) && locked >= 1) return Math.max(1, Math.round(locked));
    }

    const stable = Math.max(1, Math.round(getStableAllDaySpanDays(eventLike, fallbackStart, fallbackEnd)));
    if (key && Boolean(eventLike?.allDay)) {
      allDaySpanByIdentityRef.current.set(key, stable);
    }
    return stable;
  }, []);

  const computeMovedRangeForDateKey = useCallback((eventLike, targetDateKey) => {
    const start = toDateOrNull(eventLike?.start);
    if (!start) return null;
    const targetDate = toDateOrNull(`${String(targetDateKey || '')}T00:00:00`);
    if (!targetDate) return null;

    const allDay = Boolean(eventLike?.allDay);
    const endRaw = toDateOrNull(eventLike?.end);

    if (allDay) {
      const spanDays = getLockedAllDaySpanDays(eventLike, start, endRaw);
      const nextStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 0, 0, 0, 0);
      const nextEnd = new Date(nextStart);
      nextEnd.setDate(nextStart.getDate() + spanDays);
      return { start: nextStart, end: nextEnd, allDay };
    }

    const defaultDurationMs = 60 * 60 * 1000;
    const durationMs = Math.max(
      1,
      endRaw ? (endRaw.getTime() - start.getTime()) : defaultDurationMs
    );
    const nextStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), start.getHours(), start.getMinutes(), start.getSeconds(), start.getMilliseconds());
    const nextEnd = new Date(nextStart.getTime() + durationMs);
    return { start: nextStart, end: nextEnd, allDay };
  }, [getLockedAllDaySpanDays]);

  const persistMovedEvent = useCallback(async (eventLike, nextRange) => {
    if (!eventLike || !nextRange?.start || !nextRange?.end) {
      throw new Error('Invalid drop target.');
    }
    const source = eventSourceOf(eventLike);
    const startIso = nextRange.start.toISOString();
    const endIso = nextRange.end.toISOString();

    if (source === 'TASK') {
      if (!canDragCalendarEvent(eventLike)) throw new Error('You are not allowed to move this public task.');
      const taskId = eventTaskIdOf(eventLike);
      if (!taskId) throw new Error('Task id missing.');
      await updateCalendarTaskApi(taskId, {
        startDateTime: startIso,
        endDateTime: endIso,
        allDay: Boolean(nextRange.allDay)
      });
      return 'Public task moved.';
    }

    if (source === 'NOTICE') {
      if (!isAdmin) throw new Error('Only admin can move notice/alert events.');
      const noticeId = eventNoticeIdOf(eventLike);
      if (!noticeId) throw new Error('Notice id missing.');
      const noticeRange = toNoticeApiRange(nextRange.start, nextRange.end, Boolean(nextRange.allDay));
      if (!noticeRange?.startDateTime || !noticeRange?.endDateTime) {
        throw new Error('Invalid notice range.');
      }
      await updateNoticeApi(noticeId, noticeRange);
      return 'Notice moved.';
    }

    throw new Error('This event cannot be moved.');
  }, [canDragCalendarEvent, isAdmin]);

  const getMoveIdentity = useCallback((eventLike) => {
    const source = eventSourceOf(eventLike);
    if (source === 'TASK') {
      const taskId = eventTaskIdOf(eventLike);
      return taskId ? { source, id: String(taskId) } : null;
    }
    if (source === 'NOTICE') {
      const noticeId = eventNoticeIdOf(eventLike);
      return noticeId ? { source, id: String(noticeId) } : null;
    }
    const fallbackId = String(eventLike?.id || '');
    return fallbackId ? { source, id: fallbackId } : null;
  }, []);

  const registerMoveVersion = useCallback((eventLike) => {
    const identity = getMoveIdentity(eventLike);
    if (!identity?.id) return null;
    const key = `${String(identity.source || '')}:${String(identity.id || '')}`;
    const versions = moveVersionByIdentityRef.current;
    const nextVersion = (Number(versions.get(key)) || 0) + 1;
    versions.set(key, nextVersion);
    return { key, version: nextVersion };
  }, [getMoveIdentity]);

  const isMoveStillLatest = useCallback((moveMeta) => {
    if (!moveMeta?.key) return true;
    return Number(moveVersionByIdentityRef.current.get(moveMeta.key)) === Number(moveMeta.version);
  }, []);

  const persistLatestMove = useCallback(async (eventLike, nextRange, moveMeta) => {
    if (moveMeta?.key && !isMoveStillLatest(moveMeta)) {
      return { skipped: true };
    }

    let attempt = 0;
    let retryDelayMs = 240;
    while (attempt < 5) {
      try {
        const message = await persistMovedEvent(eventLike, nextRange);
        if (moveMeta?.key && !isMoveStillLatest(moveMeta)) {
          return { skipped: true, message };
        }
        movePersistFailureRef.current = false;
        return { skipped: false, message };
      } catch (err) {
        attempt += 1;
        if (!isMoveStillLatest(moveMeta) || attempt >= 5) {
          throw err;
        }
        // Fast repeated drags can briefly outpace backend writes; retry latest move only.
        const currentDelay = retryDelayMs;
        await waitMs(currentDelay);
        retryDelayMs = Math.min(Math.round(retryDelayMs * 1.8), 1800);
      }
    }

    return { skipped: false };
  }, [isMoveStillLatest, persistMovedEvent]);

  const applyOptimisticMove = useCallback((eventLike, nextRange) => {
    if (!eventLike || !nextRange?.start || !nextRange?.end) return;
    const identity = getMoveIdentity(eventLike);
    if (!identity?.id) return;

    const nextAllDay = Boolean(nextRange.allDay);
    const stableSpanDays = nextAllDay
      ? getLockedAllDaySpanDays(eventLike, nextRange.start, nextRange.end)
      : null;
    if (nextAllDay) {
      const key = eventIdentityKeyOf(eventLike);
      if (key) {
        allDaySpanByIdentityRef.current.set(key, Math.max(1, Number(stableSpanDays) || 1));
      }
    }
    const patchEvent = (evt) => {
      if (nextAllDay) {
        const spanDays = Math.max(1, Number(stableSpanDays) || 1);
        const allDayStart = new Date(
          nextRange.start.getFullYear(),
          nextRange.start.getMonth(),
          nextRange.start.getDate(),
          0, 0, 0, 0
        );
        const allDayEnd = new Date(allDayStart);
        allDayEnd.setDate(allDayStart.getDate() + spanDays);
        return {
          ...evt,
          start: toInputDateValue(allDayStart),
          end: toInputDateValue(allDayEnd),
          allDay: true,
          extendedProps: {
            ...(evt?.extendedProps || {}),
            gcalAllDaySpanDays: spanDays
          }
        };
      }

      return {
        ...evt,
        start: nextRange.start.toISOString(),
        end: nextRange.end.toISOString(),
        allDay: false
      };
    };

    const matches = (evt) => {
      const source = eventSourceOf(evt);
      if (source !== identity.source) return false;
      if (identity.source === 'TASK') return String(eventTaskIdOf(evt)) === identity.id;
      if (identity.source === 'NOTICE') return String(eventNoticeIdOf(evt)) === identity.id;
      return String(evt?.id || '') === identity.id;
    };

    setAllEvents((prev) => (Array.isArray(prev) ? prev.map((evt) => (matches(evt) ? patchEvent(evt) : evt)) : prev));
    setSearchResults((prev) => (Array.isArray(prev) ? prev.map((evt) => (matches(evt) ? patchEvent(evt) : evt)) : prev));
  }, [getMoveIdentity, getLockedAllDaySpanDays]);

  const openPopoverFromAnchor = useCallback((eventData, anchorRect, opts = {}) => {
    if (!eventData || !anchorRect) return;
    setPopoverEditMode(false);
    setPopoverEditLoading(false);
    setPopoverEditSaving(false);
    setPopoverDeleting(false);
    setPopoverEditError('');
    setPopoverEditForm(emptyPopoverEditForm());
    const approxWidth = Math.min(560, window.innerWidth - 24);
    const approxHeight = Math.min(640, window.innerHeight - 24);
    const sourceView = String(opts?.sourceView || '');
    const sourceAnchorRect = opts?.anchorRect || anchorRect;
    const layoutAnchorRect = opts?.layoutAnchorRect || sourceAnchorRect;
    const layout = sourceView === 'listYear'
      ? computeSchedulePopoverLayout(sourceAnchorRect, opts?.anchorPoint, approxWidth, approxHeight)
      : computePopoverLayout(layoutAnchorRect, approxWidth, approxHeight);
    setPopover({
      open: true,
      x: layout.x,
      y: layout.y,
      eventData,
      anchorRect: sourceAnchorRect,
      layoutAnchorRect,
      anchorPoint: opts?.anchorPoint || null,
      connectorNameRect: opts?.connectorNameRect || null,
      sourceView,
      verticalPlacement: layout.verticalPlacement || 'below',
      placement: layout.placement,
      arrowTop: layout.arrowTop,
      positionReady: false,
      cardWidth: approxWidth,
      cardHeight: approxHeight
    });
  }, []);

  const handleScheduleEventClick = useCallback((scheduleEvent, jsEvent) => {
    if (scheduleDragRef.current.justDragged) {
      scheduleDragRef.current.justDragged = false;
      return;
    }
    const eventData = scheduleEvent?.popoverEventData;
    if (!eventData) return;
    jsEvent?.preventDefault?.();
    jsEvent?.stopPropagation?.();

    const targetEl = jsEvent?.currentTarget;
    if (!(targetEl instanceof Element)) return;
    const rect = targetEl.getBoundingClientRect();
    const dotEl = targetEl.querySelector('.event-dot');
    const dotRect = dotEl instanceof Element ? dotEl.getBoundingClientRect() : null;
    const nameEl =
      targetEl.querySelector('.event-title > span:first-child') ||
      targetEl.querySelector('.event-title');
    const nameRectRaw = nameEl instanceof Element ? nameEl.getBoundingClientRect() : null;

    const rawX = Number(jsEvent?.clientX);
    const rawY = Number(jsEvent?.clientY);
    const fallbackX = rect.left + (rect.width / 2);
    const fallbackY = rect.top + (rect.height / 2);
    const pointerX = Number.isFinite(rawX) ? rawX : fallbackX;
    const pointerY = Number.isFinite(rawY) ? rawY : fallbackY;

    const anchorPoint = {
      x: clamp(pointerX, rect.left + 2, rect.right - 2),
      y: clamp(pointerY, rect.top + 2, rect.bottom - 2)
    };

    const fallbackPoint = dotRect
      ? {
          x: clamp(dotRect.left + (dotRect.width / 2), rect.left + 2, rect.right - 2),
          y: clamp(dotRect.top + (dotRect.height / 2), rect.top + 2, rect.bottom - 2)
        }
      : anchorPoint;

    const layoutAnchorRect = {
      left: (Number.isFinite(anchorPoint.x) ? anchorPoint.x : fallbackPoint.x) - 1,
      right: (Number.isFinite(anchorPoint.x) ? anchorPoint.x : fallbackPoint.x) + 1,
      top: (Number.isFinite(anchorPoint.y) ? anchorPoint.y : fallbackPoint.y) - 1,
      bottom: (Number.isFinite(anchorPoint.y) ? anchorPoint.y : fallbackPoint.y) + 1,
      width: 2,
      height: 2
    };

    const anchorRect = {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height
    };
    const connectorNameRect = nameRectRaw
      ? {
          left: nameRectRaw.left,
          right: nameRectRaw.right,
          top: nameRectRaw.top,
          bottom: nameRectRaw.bottom,
          width: nameRectRaw.width,
          height: nameRectRaw.height
        }
      : null;
    openPopoverFromAnchor(eventData, anchorRect, {
      sourceView: 'listYear',
      anchorPoint,
      anchorRect,
      layoutAnchorRect,
      connectorNameRect
    });
  }, [openPopoverFromAnchor]);

  const weekAllDayOverflow = useMemo(() => {
    if (viewType !== 'timeGridWeek') {
      return { hasOverflow: false, maxOverflow: 0, overflowByDay: new Array(7).fill(0) };
    }

    const rangeStartRaw = viewRange?.start;
    const rangeEndRaw = viewRange?.end;
    if (!rangeStartRaw || !rangeEndRaw) {
      return { hasOverflow: false, maxOverflow: 0, overflowByDay: new Array(7).fill(0) };
    }

    const weekStart = new Date(
      rangeStartRaw.getFullYear(),
      rangeStartRaw.getMonth(),
      rangeStartRaw.getDate()
    );
    const weekEnd = new Date(
      rangeEndRaw.getFullYear(),
      rangeEndRaw.getMonth(),
      rangeEndRaw.getDate()
    );
    const dayCounts = new Array(7).fill(0);
    const msPerDay = 24 * 60 * 60 * 1000;

    filteredEvents.forEach((eventLike) => {
      const source = eventSourceOf(eventLike);
      if (source === 'NOTICE_BG') return;
      const displayMode = String(eventLike?.display || eventLike?.extendedProps?.display || '').toLowerCase();
      if (displayMode === 'background') return;
      if (!eventLike?.allDay) return;

      const start = toDateOrNull(eventLike?.start);
      if (!start) return;

      let end = toDateOrNull(eventLike?.end);
      if (!end) {
        end = new Date(start);
        end.setDate(end.getDate() + 1);
      }

      const spanStart = new Date(Math.max(start.getTime(), weekStart.getTime()));
      const spanEnd = new Date(Math.min(end.getTime(), weekEnd.getTime()));
      if (spanEnd <= spanStart) return;

      const cursor = new Date(spanStart.getFullYear(), spanStart.getMonth(), spanStart.getDate());
      while (cursor < spanEnd) {
        const dayIndex = Math.floor((cursor.getTime() - weekStart.getTime()) / msPerDay);
        if (dayIndex >= 0 && dayIndex < dayCounts.length) {
          dayCounts[dayIndex] += 1;
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    });

    const overflowByDay = dayCounts.map((count) => Math.max(0, count - WEEK_COLLAPSED_VISIBLE_EVENT_COUNT));
    const hasOverflow = overflowByDay.some((count) => count > 0);
    return {
      hasOverflow,
      maxOverflow: hasOverflow ? Math.max(...overflowByDay) : 0,
      overflowByDay
    };
  }, [filteredEvents, viewRange, viewType]);

  const dayAllDayOverflow = useMemo(() => {
    if (viewType !== 'timeGridDay') {
      return { hasOverflow: false, overflowCount: 0 };
    }

    const rangeStartRaw = viewRange?.start;
    const rangeEndRaw = viewRange?.end;
    if (!rangeStartRaw || !rangeEndRaw) {
      return { hasOverflow: false, overflowCount: 0 };
    }

    const dayStart = new Date(
      rangeStartRaw.getFullYear(),
      rangeStartRaw.getMonth(),
      rangeStartRaw.getDate()
    );
    const dayEnd = new Date(
      rangeEndRaw.getFullYear(),
      rangeEndRaw.getMonth(),
      rangeEndRaw.getDate()
    );

    let allDayCount = 0;
    filteredEvents.forEach((eventLike) => {
      const source = eventSourceOf(eventLike);
      if (source === 'NOTICE_BG') return;
      const displayMode = String(eventLike?.display || eventLike?.extendedProps?.display || '').toLowerCase();
      if (displayMode === 'background') return;
      if (!eventLike?.allDay) return;

      const start = toDateOrNull(eventLike?.start);
      if (!start) return;
      const endRaw = toDateOrNull(eventLike?.end);
      const end = endRaw || new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
      if (start < dayEnd && end > dayStart) {
        allDayCount += 1;
      }
    });

    const overflowCount = Math.max(0, allDayCount - DAY_COLLAPSED_VISIBLE_EVENT_COUNT);
    return {
      hasOverflow: overflowCount > 0,
      overflowCount
    };
  }, [filteredEvents, viewRange, viewType]);

  const visibleSearchResults = useMemo(() => {
    return searchResults.filter((event) => eventPassesFilters(event, filters));
  }, [searchResults, filters]);

  const groupedSearchResults = useMemo(() => {
    const groups = new Map();
    visibleSearchResults.forEach((event) => {
      const start = toDateOrNull(event?.start);
      const keyDate = start || new Date(0);
      const key = `${keyDate.getFullYear()}-${String(keyDate.getMonth() + 1).padStart(2, '0')}`;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          label: start
            ? start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
            : 'Unknown date',
          date: keyDate,
          items: []
        });
      }
      groups.get(key).items.push(event);
    });

    return Array.from(groups.values())
      .sort((a, b) => a.date - b.date)
      .map((group) => ({
        ...group,
        items: group.items.sort((a, b) => {
          const aDate = toDateOrNull(a?.start);
          const bDate = toDateOrNull(b?.start);
          if (!aDate && !bDate) return 0;
          if (!aDate) return 1;
          if (!bDate) return -1;
          return aDate - bDate;
        })
      }));
  }, [visibleSearchResults]);

  const shouldShowSearchPanel = searchOpen;

  const searchCalendarEventsWithFuzzy = useCallback(async (query, options = {}) => {
    const trimmedQuery = String(query || '').trim();
    if (!trimmedQuery) {
      setSearchResults([]);
      if (options.updateMessage) {
        setSearchMessage('Type a keyword and press Enter to search across months and years.');
      }
      return { results: [], remoteError: null };
    }

    let remoteEvents = [];
    let remoteError = null;
    try {
      const data = await searchCalendarEventsApi({ q: trimmedQuery, limit: 320 });
      remoteEvents = sanitizeCalendarEvents(data?.events);
    } catch (err) {
      remoteError = err;
    }

    const pickSearchFields = (eventLike) => [
      eventLike?.title,
      eventDescriptionOf(eventLike),
      eventLike?.extendedProps?.summary,
      eventLike?.extendedProps?.holidayName,
      eventSourceOf(eventLike),
      toSearchBadge(eventLike)?.label,
      formatResultDate(eventLike)?.full,
      formatResultTime(eventLike)
    ];

    const fuzzyOptions = { threshold: 0.44 };
    const remoteMatches = fuzzyFilterAndRank(remoteEvents, trimmedQuery, pickSearchFields, fuzzyOptions);
    const localMatches = fuzzyFilterAndRank(allEvents, trimmedQuery, pickSearchFields, fuzzyOptions);

    const unique = new Map();
    const pushUnique = (items) => {
      (Array.isArray(items) ? items : []).forEach((eventLike, index) => {
        const key =
          eventIdentityKeyOf(eventLike) ||
          `${String(eventLike?.id || '')}::${String(eventLike?.start || '')}::${index}`;
        if (!unique.has(key)) unique.set(key, eventLike);
      });
    };

    pushUnique(remoteMatches);
    pushUnique(localMatches);

    let merged = Array.from(unique.values()).sort((a, b) => {
      const aTime = toDateOrNull(a?.start)?.getTime() || Number.MAX_SAFE_INTEGER;
      const bTime = toDateOrNull(b?.start)?.getTime() || Number.MAX_SAFE_INTEGER;
      if (aTime !== bTime) return aTime - bTime;
      return String(a?.title || '').localeCompare(String(b?.title || ''), undefined, {
        numeric: true,
        sensitivity: 'base'
      });
    });

    if (merged.length === 0) {
      try {
        const now = new Date();
        const start = new Date(now.getFullYear() - 2, 0, 1).toISOString();
        const end = new Date(now.getFullYear() + 3, 0, 1).toISOString();
        const wideData = await getCalendarEventsApi({ start, end });
        const wideEvents = sanitizeCalendarEvents(wideData?.events);
        merged = fuzzyFilterAndRank(wideEvents, trimmedQuery, pickSearchFields, fuzzyOptions);
      } catch (_) {
        // Ignore fallback errors and keep prior merged result.
      }
    }

    setSearchResults(merged);

    if (options.updateMessage) {
      if (merged.length > 0) {
        setSearchMessage('');
      } else if (remoteError) {
        setSearchMessage(
          remoteError?.response?.data?.error || 'Unable to search beyond current month right now.'
        );
      } else {
        setSearchMessage(`No matching items found for "${trimmedQuery}".`);
      }
    }

    return { results: merged, remoteError };
  }, [allEvents]);

  const loadEvents = useCallback(async (range) => {
    if (!range?.start || !range?.end) return;
    activeRangeRef.current = range;
    const requestId = loadEventsRequestRef.current + 1;
    loadEventsRequestRef.current = requestId;
    setError('');
    try {
      const data = await getCalendarEventsApi({ start: range.start, end: range.end });
      if (requestId !== loadEventsRequestRef.current) return;
      const sanitizedEvents = sanitizeCalendarEvents(data?.events);
      const spanMap = allDaySpanByIdentityRef.current;
      const normalizedEvents = sanitizedEvents.map((evt) => {
        if (!evt?.allDay) return evt;
        const key = eventIdentityKeyOf(evt);
        if (!key) return evt;

        const serverSpan = Math.max(1, Math.round(getStableAllDaySpanDays(evt, evt?.start, evt?.end)));
        const lockedRaw = Number(spanMap.get(key));
        const hasLocked = Number.isFinite(lockedRaw) && lockedRaw >= 1;

        // Keep the shortest known stable span for this identity in-session.
        // This prevents fast drag+sync cycles from re-inflating one-day events
        // into multi-day strips due to backend timing/normalization jitter.
        if (!hasLocked) {
          spanMap.set(key, serverSpan);
        } else if (serverSpan < lockedRaw) {
          spanMap.set(key, serverSpan);
        }

        const effectiveSpan = Math.max(
          1,
          Number(spanMap.get(key)) || serverSpan
        );

        if (effectiveSpan === serverSpan) {
          return {
            ...evt,
            extendedProps: {
              ...(evt?.extendedProps || {}),
              gcalAllDaySpanDays: effectiveSpan
            }
          };
        }

        const startDt = toDateOrNull(evt?.start);
        if (!startDt) {
          return {
            ...evt,
            extendedProps: {
              ...(evt?.extendedProps || {}),
              gcalAllDaySpanDays: effectiveSpan
            }
          };
        }

        const endDt = new Date(
          startDt.getFullYear(),
          startDt.getMonth(),
          startDt.getDate(),
          0, 0, 0, 0
        );
        endDt.setDate(endDt.getDate() + effectiveSpan);

        return {
          ...evt,
          start: toInputDateValue(startDt),
          end: toInputDateValue(endDt),
          allDay: true,
          extendedProps: {
            ...(evt?.extendedProps || {}),
            gcalAllDaySpanDays: effectiveSpan
          }
        };
      });
      setAllEvents(normalizedEvents);
      setCanManageTasks(Boolean(data?.canManageTasks));
    } catch (err) {
      if (requestId !== loadEventsRequestRef.current) return;
      setError(err?.response?.data?.error || 'Unable to load calendar events.');
      setAllEvents([]);
    }
  }, []);

  const handleDatesSet = useCallback((arg) => {
    setViewType(arg.view.type);
    setViewTitle(arg.view.title);
    setViewRange({
      start: new Date(arg.start),
      end: new Date(arg.end)
    });
    if (arg.view.type !== 'timeGridWeek') {
      setWeekAllDayExpanded(false);
    }
    if (arg.view.type !== 'timeGridDay') {
      setDayAllDayExpanded(false);
    }
    const currentMidDate = new Date((arg.start.valueOf() + arg.end.valueOf()) / 2);
    setMiniAnchorDate(new Date(currentMidDate.getFullYear(), currentMidDate.getMonth(), 1));
    loadEvents({ start: arg.startStr, end: arg.endStr });

    // Ensure day/week dimensions are recalculated and scrolled to current time from any source view.
    if (arg.view.type === 'timeGridDay' || arg.view.type === 'timeGridWeek') {
      window.requestAnimationFrame(() => {
        const api = calendarRef.current?.getApi();
        if (!api) return;
        const now = new Date();
        const targetMinutes = Math.max(0, (now.getHours() * 60 + now.getMinutes()) - 45);
        const targetScroll = minutesToDurationString(targetMinutes);
        api.updateSize();
        api.scrollToTime(targetScroll);
        window.setTimeout(() => {
          if (api.view?.type === arg.view.type) {
            api.updateSize();
            api.scrollToTime(targetScroll);
          }
        }, 90);
      });
    }
  }, [loadEvents]);

  useEffect(() => {
    if (!weekAllDayOverflow.hasOverflow && weekAllDayExpanded) {
      setWeekAllDayExpanded(false);
    }
  }, [weekAllDayExpanded, weekAllDayOverflow.hasOverflow]);

  useEffect(() => {
    if (!dayAllDayOverflow.hasOverflow && dayAllDayExpanded) {
      setDayAllDayExpanded(false);
    }
  }, [dayAllDayExpanded, dayAllDayOverflow.hasOverflow]);

  // FullCalendar can re-apply inline sizing on day all-day wrappers.
  // Enforce internal scroll on the all-day frame whenever day view is expanded.
  useEffect(() => {
    const api = calendarRef.current?.getApi();
    if (!api) return undefined;

    const setDayDebug = (payload) => {
      if (!DAY_ALL_DAY_DEBUG_HOOK) return;
      window.__gcalDayAllDayDebug = {
        ts: new Date().toISOString(),
        ...payload
      };
    };

    const getCssValue = (el, prop) => {
      if (!(el instanceof HTMLElement)) return '';
      return window.getComputedStyle(el).getPropertyValue(prop);
    };

    const clearSizingStyles = (el) => {
      if (!(el instanceof HTMLElement)) return;
      el.style.removeProperty('display');
      el.style.removeProperty('min-height');
      el.style.removeProperty('height');
      el.style.removeProperty('max-height');
      el.style.removeProperty('overflow');
      el.style.removeProperty('overflow-y');
      el.style.removeProperty('overflow-x');
      el.style.removeProperty('scrollbar-gutter');
      el.style.removeProperty('overscroll-behavior');
      el.style.removeProperty('position');
      el.style.removeProperty('top');
      el.style.removeProperty('left');
      el.style.removeProperty('right');
      el.style.removeProperty('bottom');
      el.style.removeProperty('inset');
      el.style.removeProperty('transform');
      el.style.removeProperty('width');
      el.style.removeProperty('margin');
      el.style.removeProperty('z-index');
    };

    const uniqueElements = (elements) => {
      const out = [];
      const seen = new Set();
      elements.forEach((el) => {
        if (!(el instanceof HTMLElement)) return;
        if (seen.has(el)) return;
        seen.add(el);
        out.push(el);
      });
      return out;
    };

    const applyDayAllDayScroll = () => {
      const root = api.el;
      if (!(root instanceof Element)) {
        setDayDebug({ status: 'no-root-element' });
        return;
      }
      const isDayView = viewType === 'timeGridDay';
      const isWeekView = viewType === 'timeGridWeek';
      const isAllDayScrollableView = isDayView || isWeekView;

      if (!isAllDayScrollableView) {
        setDayDebug({
          status: 'not-target-view',
          viewType,
          expandedState: dayAllDayExpanded,
          overflowState: dayAllDayOverflow.hasOverflow,
          weekExpandedState: weekAllDayExpanded,
          weekOverflowState: weekAllDayOverflow.hasOverflow
        });
        return;
      }

      const selectFirstElement = (scope, selectors) => {
        const scanScope = scope instanceof Element ? scope : root;
        for (let i = 0; i < selectors.length; i += 1) {
          const el = scanScope.querySelector(selectors[i]);
          if (el instanceof HTMLElement) return el;
        }
        return null;
      };

      const scopeSelectors = isWeekView
        ? [
            '.fc-timeGridWeek-view',
            '.fc-timegrid-week-view',
            '.fc-view.fc-timeGridWeek-view',
            '[class*="timeGridWeek"]',
            '[class*="timegrid-week"]'
          ]
        : [
            '.fc-timeGridDay-view',
            '.fc-timegrid-day-view',
            '.fc-view.fc-timeGridDay-view',
            '[class*="timeGridDay"]',
            '[class*="timegrid-day"]'
          ];

      const scopeRegex = isWeekView ? /timegridweek|timegrid-week/i : /timegridday|timegrid-day/i;
      const dayViewScope = selectFirstElement(root, scopeSelectors)
        || Array.from(root.querySelectorAll('[class]')).find((el) => (
          scopeRegex.test(String(el.className || ''))
        ));

      if (!(dayViewScope instanceof HTMLElement)) {
        setDayDebug({
          status: 'day-view-scope-missing',
          viewType,
          expandedState: dayAllDayExpanded,
          overflowState: dayAllDayOverflow.hasOverflow,
          weekExpandedState: weekAllDayExpanded,
          weekOverflowState: weekAllDayOverflow.hasOverflow
        });
        return;
      }

      const q = (selectors) => selectFirstElement(dayViewScope, selectors);

      const allDayChunk = q(['.fc-timegrid-allday-chunk', '.fc-timegrid-all-day-chunk']);
      const allDayCell = q(['.fc-timegrid-allday', '.fc-timegrid-all-day', '[class*="allday"]', '[class*="all-day"]']);
      const daygridBody = q(['.fc-timegrid-allday .fc-daygrid-body', '.fc-timegrid-all-day .fc-daygrid-body', '.fc-daygrid-body']);
      const daygridTable = q(['.fc-timegrid-allday .fc-daygrid-body > table', '.fc-timegrid-all-day .fc-daygrid-body > table', '.fc-daygrid-body > table']);
      const dayFrame = q(['.fc-timegrid-allday .fc-daygrid-day-frame', '.fc-timegrid-all-day .fc-daygrid-day-frame', '.fc-daygrid-day-frame']);
      const syncInner = q(['.fc-timegrid-allday .fc-scrollgrid-sync-inner', '.fc-timegrid-all-day .fc-scrollgrid-sync-inner', '.fc-scrollgrid-sync-inner']);
      const weekSearchScope = isWeekView
        ? dayViewScope
        : (allDayCell instanceof HTMLElement ? allDayCell : dayViewScope);
      const isWeekColumnClass = (className) => /day-events|col-events|day-frame|col-frame/i.test(className || '');
      const isWeekSharedClass = (className) => /allday|all-day|chunk|daygrid-body|sync-table|scrollgrid-sync-table|timegrid-axis|divider/i.test(className || '');
      const weekEventHarnesses = isWeekView
        ? Array.from(
            weekSearchScope.querySelectorAll(
              [
                '.fc-timegrid-allday .fc-daygrid-event-harness',
                '.fc-timegrid-allday .fc-timegrid-event-harness',
                '.fc-timegrid-allday .fc-event-harness',
                '.fc-timegrid-all-day .fc-daygrid-event-harness',
                '.fc-timegrid-all-day .fc-timegrid-event-harness',
                '.fc-timegrid-all-day .fc-event-harness',
                '[class*="allday"] .fc-daygrid-event-harness',
                '[class*="allday"] .fc-timegrid-event-harness',
                '[class*="allday"] .fc-event-harness',
                '[class*="all-day"] .fc-daygrid-event-harness',
                '[class*="all-day"] .fc-timegrid-event-harness',
                '[class*="all-day"] .fc-event-harness'
              ].join(', ')
            )
          ).filter((el) => el instanceof HTMLElement)
        : [];
      const weekTargetFromHarness = (harness) => {
        if (!(harness instanceof HTMLElement)) return null;
        let cursor = harness;
        let depth = 0;
        while (cursor instanceof HTMLElement && depth < 30) {
          const cn = String(cursor.className || '');
          if (isWeekColumnClass(cn) && !isWeekSharedClass(cn)) {
            return cursor;
          }
          if (cursor === weekSearchScope) break;
          cursor = cursor.parentElement;
          depth += 1;
        }
        return null;
      };
      const weekTargetsFromHarnesses = isWeekView
        ? uniqueElements(weekEventHarnesses.map(weekTargetFromHarness))
        : [];
      const weekTargetsFromQuery = isWeekView
        ? uniqueElements(
            Array.from(
              weekSearchScope.querySelectorAll(
                [
                  '.fc-timegrid-allday .fc-timegrid-col-events',
                  '.fc-timegrid-all-day .fc-timegrid-col-events',
                  '.fc-timegrid-allday .fc-daygrid-day-events',
                  '.fc-timegrid-all-day .fc-daygrid-day-events',
                  '.fc-timegrid-allday .fc-timegrid-day-events',
                  '.fc-timegrid-all-day .fc-timegrid-day-events',
                  '.fc-timegrid-allday .fc-event-harness-container',
                  '.fc-timegrid-all-day .fc-event-harness-container',
                  '[class*="allday"] .fc-timegrid-col-events',
                  '[class*="all-day"] .fc-timegrid-col-events',
                  '[class*="allday"] .fc-daygrid-day-events',
                  '[class*="all-day"] .fc-daygrid-day-events',
                  '[class*="allday"] .fc-timegrid-day-events',
                  '[class*="all-day"] .fc-timegrid-day-events',
                  '[class*="allday"] .fc-timegrid-col-frame',
                  '[class*="all-day"] .fc-timegrid-col-frame',
                  '[class*="allday"] .fc-daygrid-day-frame',
                  '[class*="all-day"] .fc-daygrid-day-frame',
                  '[class*="allday"] .fc-timegrid-day-frame',
                  '[class*="all-day"] .fc-timegrid-day-frame'
                ].join(', ')
              )
            )
          ).filter((el) => (
            el instanceof HTMLElement
            && isWeekColumnClass(String(el.className || ''))
            && !isWeekSharedClass(String(el.className || ''))
          ))
        : [];
      const weekCellsFromBody = isWeekView && daygridBody instanceof HTMLElement
        ? uniqueElements(
            Array.from(daygridBody.querySelectorAll('tr > td, tr > th')).filter((el) => (
              el instanceof HTMLElement
              && !/axis|divider|chunk/i.test(String(el.className || ''))
            ))
          )
        : [];
      const weekTargetsFromBodyCells = isWeekView
        ? uniqueElements(
            weekCellsFromBody.map((cell) => {
              if (!(cell instanceof HTMLElement)) return null;
              return selectFirstElement(cell, [
                '.fc-timegrid-col-events',
                '.fc-daygrid-day-events',
                '.fc-timegrid-day-events',
                '.fc-event-harness-container',
                '.fc-timegrid-col-frame',
                '.fc-daygrid-day-frame',
                '.fc-timegrid-day-frame',
                '.fc-scrollgrid-sync-inner'
              ]) || cell;
            })
          ).filter((el) => (
            el instanceof HTMLElement
            && !/axis|divider|chunk/i.test(String(el.className || ''))
          ))
        : [];
      const weekDayEventContainers = isWeekView
        ? (
          weekTargetsFromHarnesses.length
            ? weekTargetsFromHarnesses
            : (weekTargetsFromQuery.length ? weekTargetsFromQuery : weekTargetsFromBodyCells)
        )
        : [];
      const weekDayFrames = isWeekView
        ? uniqueElements(
            weekDayEventContainers.map((container) => {
              if (!(container instanceof HTMLElement)) return null;
              if (/col-frame|day-frame/i.test(String(container.className || ''))) return container;
              return container.closest(
                '.fc-timegrid-col-frame, .fc-daygrid-day-frame, .fc-timegrid-day-frame'
              );
            })
          )
        : [];
      const primaryEventContainerSelectors = isWeekView
        ? [
            '.fc-timegrid-allday .fc-daygrid-body',
            '.fc-timegrid-all-day .fc-daygrid-body',
            '.fc-timegrid-allday-chunk > .fc-scrollgrid-sync-inner',
            '.fc-timegrid-all-day-chunk > .fc-scrollgrid-sync-inner',
            '.fc-timegrid-allday .fc-scrollgrid-sync-inner',
            '.fc-timegrid-all-day .fc-scrollgrid-sync-inner',
            '.fc-timegrid-allday .fc-daygrid-day-events',
            '.fc-timegrid-all-day .fc-daygrid-day-events',
            '.fc-timegrid-allday .fc-timegrid-day-events',
            '.fc-timegrid-all-day .fc-timegrid-day-events',
            '.fc-timegrid-allday .fc-timegrid-col-events',
            '.fc-timegrid-all-day .fc-timegrid-col-events'
          ]
        : [
            '.fc-timegrid-allday .fc-daygrid-day-events',
            '.fc-timegrid-allday .fc-timegrid-day-events',
            '.fc-timegrid-allday .fc-timegrid-col-events',
            '.fc-timegrid-all-day .fc-daygrid-day-events',
            '.fc-timegrid-all-day .fc-timegrid-day-events',
            '.fc-timegrid-all-day .fc-timegrid-col-events',
            '.fc-timegrid-allday .fc-daygrid-body',
            '.fc-timegrid-all-day .fc-daygrid-body',
            '.fc-timegrid-allday .fc-scrollgrid-sync-inner',
            '.fc-timegrid-all-day .fc-scrollgrid-sync-inner'
          ];
      let eventsContainer = q(primaryEventContainerSelectors);
      if (!(eventsContainer instanceof HTMLElement)) {
        eventsContainer = q([
          '.fc-timegrid-allday .fc-daygrid-day-frame',
          '.fc-timegrid-all-day .fc-daygrid-day-frame',
          '[class*="allday"] .fc-scrollgrid-sync-inner',
          '[class*="all-day"] .fc-scrollgrid-sync-inner',
          '.fc-scrollgrid-sync-inner'
        ]);
      }
      const eventHarnesses = Array.from(
        ((allDayCell instanceof HTMLElement) ? allDayCell : dayViewScope).querySelectorAll(
          [
            '.fc-timegrid-allday .fc-daygrid-event-harness',
            '.fc-timegrid-allday .fc-timegrid-event-harness',
            '.fc-timegrid-allday .fc-event-harness',
            '.fc-timegrid-all-day .fc-daygrid-event-harness',
            '.fc-timegrid-all-day .fc-timegrid-event-harness',
            '.fc-timegrid-all-day .fc-event-harness',
            '.fc-daygrid-event-harness',
            '.fc-timegrid-event-harness',
            '.fc-event-harness'
          ].join(', ')
        )
      );
      if (!(eventsContainer instanceof HTMLElement)) {
        const sampleBase = allDayCell instanceof HTMLElement ? allDayCell : dayViewScope;
        const sampleNodes = sampleBase instanceof HTMLElement
          ? Array.from(sampleBase.querySelectorAll('*'))
              .slice(0, 40)
              .map((n) => ({
                tag: n.tagName.toLowerCase(),
                className: n.className || '',
                clientHeight: n.clientHeight || 0,
                scrollHeight: n.scrollHeight || 0,
                overflowY: n instanceof HTMLElement ? getCssValue(n, 'overflow-y') : ''
              }))
          : [];
        setDayDebug({
          status: 'events-container-missing',
          viewType,
          expandedState: dayAllDayExpanded,
          overflowState: dayAllDayOverflow.hasOverflow,
          dayViewScopeClass: dayViewScope instanceof HTMLElement ? dayViewScope.className : '',
          availableNodeSample: sampleNodes
        });
        return;
      }

      const cssVarName = isWeekView
        ? '--gcal-week-all-day-expanded-max-height'
        : '--gcal-day-all-day-expanded-max-height';
      const cssVar = window
        .getComputedStyle(document.documentElement)
        .getPropertyValue(cssVarName)
        .trim();
      const targetMaxHeight = cssVar || '176px';
      const targetMaxHeightPx = parseFloat(targetMaxHeight) || 176;
      const weekCollapsedCssVar = window
        .getComputedStyle(document.documentElement)
        .getPropertyValue('--gcal-week-all-day-collapsed-max-height')
        .trim();
      const weekCollapsedMaxHeightPx = parseFloat(weekCollapsedCssVar) || 76;

      const resetWeekCollapsedAllDayLinkStyles = () => {
        if (!isWeekView) return;
        Array.from(dayViewScope.querySelectorAll('.gcal-week-custom-more-link'))
          .forEach((node) => node.remove());

        const resetNodes = Array.from(
          dayViewScope.querySelectorAll(
            [
              '.fc-timegrid-allday .fc-daygrid-day-bottom',
              '.fc-timegrid-all-day .fc-daygrid-day-bottom',
              '.fc-timegrid-allday .fc-daygrid-more-link',
              '.fc-timegrid-all-day .fc-daygrid-more-link',
              '.fc-timegrid-allday .fc-timegrid-more-link',
              '.fc-timegrid-all-day .fc-timegrid-more-link',
              '[class*="allday"] .fc-daygrid-day-bottom',
              '[class*="all-day"] .fc-daygrid-day-bottom',
              '[class*="allday"] .fc-daygrid-more-link',
              '[class*="all-day"] .fc-daygrid-more-link',
              '[class*="allday"] .fc-timegrid-more-link',
              '[class*="all-day"] .fc-timegrid-more-link'
            ].join(', ')
          )
        ).filter((el) => el instanceof HTMLElement);

        resetNodes.forEach((node) => {
          node.style.removeProperty('display');
          node.style.removeProperty('position');
          node.style.removeProperty('top');
          node.style.removeProperty('left');
          node.style.removeProperty('right');
          node.style.removeProperty('bottom');
          node.style.removeProperty('inset');
          node.style.removeProperty('z-index');
          node.style.removeProperty('white-space');
        });

        const harnesses = Array.from(
          dayViewScope.querySelectorAll(
            [
              '.fc-timegrid-allday [class*="harness"]',
              '.fc-timegrid-all-day [class*="harness"]',
              '[class*="allday"] [class*="harness"]',
              '[class*="all-day"] [class*="harness"]'
            ].join(', ')
          )
        ).filter((el) => el instanceof HTMLElement);

        harnesses.forEach(clearSizingStyles);
      };

      const applyWeekCollapsedAllDayLinkPlacement = () => (
        { mode: 'native', frameCount: 0, linkCount: 0, hiddenCount: 0, placedCount: 0 }
      );

      const expanded = (isDayView && dayAllDayExpanded && dayAllDayOverflow.hasOverflow)
        || (isWeekView && weekAllDayExpanded && weekAllDayOverflow.hasOverflow);
      const allowedLockClassPattern = /(fc-timegrid-allday|fc-timegrid-all-day|fc-timegrid-allday-chunk|fc-daygrid-day-frame|fc-daygrid-day-events|fc-timegrid-day-events|fc-timegrid-col-events|fc-daygrid-body|fc-scrollgrid-sync-inner|fc-daygrid-body-unbalanced|fc-timegrid-col-frame|fc-daygrid-event-harness|fc-timegrid-event-harness|fc-event-harness)/;
      const isAllowedLockNode = (el) => (
        el instanceof HTMLElement
        && dayViewScope.contains(el)
        && allowedLockClassPattern.test(String(el.className || ''))
      );
      const chain = [];
      const boundaryStop = (allDayCell instanceof HTMLElement && dayViewScope.contains(allDayCell))
        ? allDayCell
        : ((allDayChunk instanceof HTMLElement && dayViewScope.contains(allDayChunk)) ? allDayChunk : dayViewScope);
      let cursor = eventsContainer;
      let depthGuard = 0;
      while (cursor instanceof HTMLElement && depthGuard < 60) {
        chain.push(cursor);
        if (cursor === boundaryStop) break;
        cursor = cursor.parentElement;
        depthGuard += 1;
      }
      const candidates = uniqueElements([
        chain.find((el) => el.classList.contains('fc-scrollgrid-sync-inner')),
        chain.find((el) => el.classList.contains('fc-daygrid-day-frame')),
        chain.find((el) => el.classList.contains('fc-daygrid-body')),
        chain.find((el) => el.classList.contains('fc-daygrid-day-events')),
        chain.find((el) => el.classList.contains('fc-timegrid-day-events')),
        chain.find((el) => el.classList.contains('fc-timegrid-col-events')),
        eventsContainer,
        dayFrame,
        syncInner,
        daygridBody,
        allDayChunk,
        allDayCell,
        ...chain
      ]).filter(isAllowedLockNode);

      if (!candidates.length) {
        setDayDebug({
          status: 'no-allowed-candidates',
          viewType,
          expandedState: dayAllDayExpanded,
          overflowState: dayAllDayOverflow.hasOverflow,
          dayViewScopeClass: dayViewScope.className,
          chain: chain.map((el) => el.className)
        });
        return;
      }

      // Always reset collapsed-week inline overrides first; they are re-applied only
      // in collapsed week mode below.
      resetWeekCollapsedAllDayLinkStyles();

      if (expanded) {
        // Reset all wrappers first so we measure the live structure cleanly.
        [allDayChunk, allDayCell, daygridBody, daygridTable, dayFrame, syncInner, eventsContainer, ...weekDayFrames, ...weekDayEventContainers, ...chain]
          .forEach(clearSizingStyles);

        // Keep parent containers unconstrained; we'll lock only one node.
        [allDayChunk, allDayCell, daygridBody, daygridTable, dayFrame, syncInner, eventsContainer].forEach((el) => {
          if (!(el instanceof HTMLElement)) return;
          el.style.maxHeight = 'none';
          el.style.height = 'auto';
          el.style.overflow = 'visible';
          el.style.overflowY = 'visible';
          el.style.overflowX = 'visible';
        });

        // Week view: lock each day column frame independently so only overflowing
        // columns scroll, and the expand/collapse chevron row stays fixed.
        if (isWeekView) {
          const weekColumnTargets = weekDayEventContainers.length ? weekDayEventContainers : weekDayFrames;
          weekColumnTargets.forEach((target) => {
            if (!(target instanceof HTMLElement)) return;
            target.style.minHeight = '0';
            target.style.height = `${targetMaxHeightPx}px`;
            target.style.maxHeight = `${targetMaxHeightPx}px`;
            target.style.overflowY = 'auto';
            target.style.overflowX = 'hidden';
            target.style.scrollbarGutter = 'stable';
            target.style.overscrollBehavior = 'contain';
          });

          // Normalize all-day event harness placement in expanded week mode.
          // This prevents inline absolute stacking from hiding one strip behind another.
          const harnesses = uniqueElements([
            ...weekEventHarnesses,
            ...Array.from(
              dayViewScope.querySelectorAll(
                [
                  '.fc-timegrid-allday [class*="harness"]',
                  '.fc-timegrid-all-day [class*="harness"]',
                  '[class*="allday"] [class*="harness"]',
                  '[class*="all-day"] [class*="harness"]'
                ].join(', ')
              )
            )
          ]).filter((el) => el instanceof HTMLElement);

          harnesses.forEach((harness) => {
            harness.style.position = 'static';
            harness.style.inset = 'auto';
            harness.style.top = 'auto';
            harness.style.left = 'auto';
            harness.style.right = 'auto';
            harness.style.bottom = 'auto';
            harness.style.transform = 'none';
            harness.style.width = '100%';
            harness.style.margin = '2px 0';
            harness.style.zIndex = 'auto';
          });

          // Keep row-level wrappers non-scrollable so the chevron/other columns stay fixed.
          [allDayChunk, allDayCell, daygridBody, daygridTable, dayFrame, syncInner].forEach((el) => {
            if (!(el instanceof HTMLElement)) return;
            el.style.maxHeight = 'none';
            el.style.height = 'auto';
            el.style.overflow = 'visible';
            el.style.overflowY = 'visible';
            el.style.overflowX = 'visible';
          });

          setDayDebug({
            status: 'week-expanded-column-locked',
            viewType,
            targetMaxHeight: `${targetMaxHeightPx}px`,
            cellCount: weekCellsFromBody.length,
            targetCount: weekColumnTargets.length,
            harnessCount: harnesses.length,
            targets: weekColumnTargets.map((target) => ({
              className: target.className,
              clientHeight: target.clientHeight,
              scrollHeight: target.scrollHeight,
              overflowY: getCssValue(target, 'overflow-y')
            }))
          });
          return;
        }

        const measured = candidates.map((candidate) => {
          candidate.style.minHeight = '0';
          candidate.style.height = `${targetMaxHeightPx}px`;
          candidate.style.maxHeight = `${targetMaxHeightPx}px`;
          candidate.style.overflowY = 'auto';
          candidate.style.overflowX = 'hidden';
          candidate.style.scrollbarGutter = 'stable';

          const scrollDelta = Math.max(0, candidate.scrollHeight - candidate.clientHeight);
          const rect = candidate.getBoundingClientRect();
          const localHarnesses = eventHarnesses.filter((harness) => (
            harness instanceof HTMLElement && candidate.contains(harness)
          ));
          let visualBottom = 0;
          localHarnesses.forEach((harness) => {
            if (!(harness instanceof HTMLElement)) return;
            const hRect = harness.getBoundingClientRect();
            visualBottom = Math.max(visualBottom, hRect.bottom - rect.top);
          });
          const visualDelta = Math.max(0, visualBottom - candidate.clientHeight);
          const score = Math.max(scrollDelta, visualDelta);

          clearSizingStyles(candidate);
          return {
            candidate,
            score,
            scrollDelta,
            visualDelta,
            clientHeight: candidate.clientHeight,
            scrollHeight: candidate.scrollHeight,
            className: candidate.className
          };
        });

        const byScrollDelta = measured
          .slice()
          .filter((m) => m.scrollDelta > 0)
          .sort((a, b) => b.scrollDelta - a.scrollDelta);
        const preferredByScroll = byScrollDelta.find((m) => /fc-daygrid-day-frame/.test(m.className))
          || byScrollDelta.find((m) => /fc-daygrid-body/.test(m.className))
          || byScrollDelta.find((m) => /fc-daygrid-day-events|fc-timegrid-day-events|fc-timegrid-col-events/.test(m.className))
          || byScrollDelta[0];

        // Only if no real scroll container exists, fallback to visual score.
        const bestVisual = measured
          .slice()
          .sort((a, b) => b.score - a.score)[0];

        const directPreferred = isWeekView
          ? (
            candidates.find((el) => el.classList.contains('fc-daygrid-body'))
            || candidates.find((el) => el.classList.contains('fc-scrollgrid-sync-inner'))
            || candidates.find((el) => el.classList.contains('fc-daygrid-day-events'))
            || candidates.find((el) => el.classList.contains('fc-timegrid-day-events'))
            || candidates.find((el) => el.classList.contains('fc-timegrid-col-events'))
            || candidates.find((el) => el.classList.contains('fc-daygrid-day-frame') && el.classList.contains('fc-scrollgrid-sync-inner'))
          )
          : (
            candidates.find((el) => el.classList.contains('fc-daygrid-day-frame') && el.classList.contains('fc-scrollgrid-sync-inner'))
            || candidates.find((el) => el.classList.contains('fc-daygrid-body'))
            || candidates.find((el) => el.classList.contains('fc-daygrid-day-events'))
            || candidates.find((el) => el.classList.contains('fc-timegrid-day-events'))
            || candidates.find((el) => el.classList.contains('fc-timegrid-col-events'))
          );

        const lockNode = directPreferred
          || (preferredByScroll?.candidate)
          || (bestVisual?.score > 0 ? bestVisual.candidate : null)
          || candidates.find((el) => el.classList.contains('fc-daygrid-day-frame'))
          || candidates.find((el) => el.classList.contains('fc-daygrid-body'))
          || candidates.find((el) => el.classList.contains('fc-daygrid-day-events'))
          || candidates.find((el) => el.classList.contains('fc-timegrid-day-events'))
          || candidates.find((el) => el.classList.contains('fc-timegrid-col-events'))
          || candidates.find((el) => el.classList.contains('fc-scrollgrid-sync-inner'))
          || eventsContainer;

        if (isAllowedLockNode(lockNode)) {
          lockNode.style.minHeight = '0';
          lockNode.style.height = `${targetMaxHeightPx}px`;
          lockNode.style.maxHeight = `${targetMaxHeightPx}px`;
          lockNode.style.overflowY = 'auto';
          lockNode.style.overflowX = 'hidden';
          lockNode.style.scrollbarGutter = 'stable';
          lockNode.style.overscrollBehavior = 'contain';
        }

        if (DAY_ALL_DAY_DEBUG_HOOK) {
          const chainDebug = chain.map((el) => ({
            tag: el.tagName.toLowerCase(),
            className: el.className,
            clientHeight: el.clientHeight,
            scrollHeight: el.scrollHeight,
            overflowY: getCssValue(el, 'overflow-y'),
            overflowX: getCssValue(el, 'overflow-x'),
            display: getCssValue(el, 'display'),
            maxHeight: getCssValue(el, 'max-height')
          }));
          const payload = {
            expanded,
            viewType,
            targetMaxHeight: `${targetMaxHeightPx}px`,
            lockNode: lockNode instanceof HTMLElement ? lockNode.className : '',
            lockReason: preferredByScroll ? 'scrollDelta' : (bestVisual?.score > 0 ? 'visualFallback' : 'finalFallback'),
            lockNodeClientHeight: lockNode instanceof HTMLElement ? lockNode.clientHeight : 0,
            lockNodeScrollHeight: lockNode instanceof HTMLElement ? lockNode.scrollHeight : 0,
            measured: measured.map((item) => ({
              className: item.className,
              score: item.score,
              scrollDelta: item.scrollDelta,
              visualDelta: item.visualDelta,
              clientHeight: item.clientHeight,
              scrollHeight: item.scrollHeight
            })),
            chain: chainDebug
          };
          setDayDebug({ status: 'expanded-locked', ...payload });
          const signature = JSON.stringify({
            lockNode: payload.lockNode,
            lockNodeClientHeight: payload.lockNodeClientHeight,
            lockNodeScrollHeight: payload.lockNodeScrollHeight,
            measured: payload.measured.map((m) => [m.className, m.score, m.clientHeight, m.scrollHeight]),
            chain: payload.chain.map((c) => [c.className, c.clientHeight, c.scrollHeight, c.overflowY, c.maxHeight])
          });
          if (dayAllDayDebugRef.current.signature !== signature) {
            dayAllDayDebugRef.current.signature = signature;
            console.groupCollapsed('[Calendar Debug] Day all-day live chain');
            console.table(payload.measured);
            console.table(payload.chain);
            console.log('Locked node:', payload.lockNode);
            console.groupEnd();
          }
        }
      } else {
        [allDayChunk, allDayCell, daygridBody, daygridTable, dayFrame, syncInner, eventsContainer, ...weekDayFrames, ...weekDayEventContainers, ...chain]
          .forEach(clearSizingStyles);
        let collapsedWeekPlacement = null;
        if (isWeekView) {
          collapsedWeekPlacement = applyWeekCollapsedAllDayLinkPlacement();
        }
        setDayDebug({
          status: 'not-expanded',
          viewType,
          expandedState: dayAllDayExpanded,
          overflowState: dayAllDayOverflow.hasOverflow,
          collapsedWeekPlacement,
          chain: chain.map((el) => ({
            className: el.className,
            clientHeight: el.clientHeight,
            scrollHeight: el.scrollHeight,
            overflowY: getCssValue(el, 'overflow-y')
          }))
        });
      }
    };

    applyDayAllDayScroll();
    const rafId = window.requestAnimationFrame(applyDayAllDayScroll);
    const t1 = window.setTimeout(applyDayAllDayScroll, 40);
    const t2 = window.setTimeout(applyDayAllDayScroll, 140);
    window.addEventListener('resize', applyDayAllDayScroll);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.removeEventListener('resize', applyDayAllDayScroll);
    };
  }, [
    viewType,
    dayAllDayExpanded,
    dayAllDayOverflow.hasOverflow,
    weekAllDayExpanded,
    weekAllDayOverflow.hasOverflow,
    (weekAllDayOverflow.overflowByDay || []).join(','),
    filteredEvents.length,
    sidebarOpen
  ]);

  useEffect(() => {
    if (viewType !== 'dayGridMonth') {
      setMonthMorePopup((prev) => (prev.open
        ? {
            open: false,
            x: 0,
            y: 0,
            dayText: '',
            dateNumber: '',
            events: []
          }
        : prev));
    }
  }, [viewType]);

  useEffect(() => {
    if (searchOpen) {
      setMonthMorePopup((prev) => (prev.open
        ? {
            open: false,
            x: 0,
            y: 0,
            dayText: '',
            dateNumber: '',
            events: []
          }
        : prev));
    }
  }, [searchOpen]);

  useLayoutEffect(() => {
    const api = calendarRef.current?.getApi();
    const cardEl = calendarCardRef.current;
    if (!api || !(cardEl instanceof HTMLElement)) return undefined;

    let rafId = 0;
    let lastWidth = -1;
    let lastHeight = -1;

    const updateFromCardSize = () => {
      rafId = 0;
      const rect = cardEl.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      if (width <= 0 || height <= 0) return;
      if (width === lastWidth && height === lastHeight) return;
      lastWidth = width;
      lastHeight = height;
      api.updateSize();
    };

    const scheduleUpdate = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(updateFromCardSize);
    };

    const ro = new ResizeObserver(() => {
      scheduleUpdate();
    });
    ro.observe(cardEl);
    window.addEventListener('resize', scheduleUpdate);

    // Initial sync for current layout.
    scheduleUpdate();

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', scheduleUpdate);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [viewType, searchOpen]);

  useEffect(() => {
    const handleAfterPrint = () => setSettingsDropdownOpen(false);
    window.addEventListener('afterprint', handleAfterPrint);
    return () => window.removeEventListener('afterprint', handleAfterPrint);
  }, []);

  useLayoutEffect(() => {
    if (!popover.open || !popover.anchorRect) return undefined;

    const repositionPopover = () => {
      const card = popoverRef.current;
      if (!card) return;
      const cardWidth = card.offsetWidth || 520;
      const cardHeight = card.offsetHeight || 420;

      const anchorForLayout = popover.layoutAnchorRect || popover.anchorRect;
      const layout = popover.sourceView === 'listYear'
        ? computeSchedulePopoverLayout(popover.anchorRect, popover.anchorPoint, cardWidth, cardHeight)
        : computePopoverLayout(anchorForLayout, cardWidth, cardHeight);

      setPopover((prev) => {
        if (!prev.open) return prev;
        const sameX = Math.abs(prev.x - layout.x) < 1;
        const sameY = Math.abs(prev.y - layout.y) < 1;
        if (
          sameX &&
          sameY &&
          prev.verticalPlacement === (layout.verticalPlacement || prev.verticalPlacement) &&
          prev.placement === layout.placement &&
          Math.abs(prev.arrowTop - layout.arrowTop) < 1 &&
          Math.abs((prev.cardWidth || 0) - cardWidth) < 1 &&
          Math.abs((prev.cardHeight || 0) - cardHeight) < 1 &&
          prev.positionReady
        ) {
          return prev;
        }
        return {
          ...prev,
          ...layout,
          cardWidth,
          cardHeight,
          positionReady: true
        };
      });
    };

    repositionPopover();
    window.addEventListener('resize', repositionPopover);
    window.addEventListener('scroll', repositionPopover, true);
    return () => {
      window.removeEventListener('resize', repositionPopover);
      window.removeEventListener('scroll', repositionPopover, true);
    };
  }, [
    popover.open,
    popover.anchorRect,
    popover.layoutAnchorRect,
    popover.anchorPoint,
    popover.sourceView,
    popoverEditMode,
    popoverEditLoading,
    popoverEditSaving,
    popoverEditError
  ]);

  useEffect(() => {
    if (searchOpen || !pendingGotoIso) return undefined;

    let cancelled = false;
    let attempts = 0;
    let retryTimer = null;
    const targetDate = new Date(pendingGotoIso);
    if (Number.isNaN(targetDate.getTime())) {
      setPendingGotoIso('');
      return undefined;
    }

    const applyGoto = () => {
      if (cancelled) return;
      const api = calendarRef.current?.getApi();
      if (api) {
        api.gotoDate(targetDate);
        setPendingGotoIso('');
        return;
      }
      if (attempts >= 12) {
        setPendingGotoIso('');
        return;
      }
      attempts += 1;
      retryTimer = setTimeout(applyGoto, 40);
    };

    applyGoto();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [searchOpen, pendingGotoIso]);

  const closeMonthMorePopup = useCallback(() => {
    setMonthMorePopup((prev) => (prev.open
      ? {
          open: false,
          x: 0,
          y: 0,
          dayText: '',
          dateNumber: '',
          events: []
        }
      : prev));
  }, []);

  const refreshCalendarAfterMove = useCallback(async () => {
    if (activeRangeRef.current) {
      await loadEvents(activeRangeRef.current);
    }
    if (searchExecutedQuery) {
      await searchCalendarEventsWithFuzzy(searchExecutedQuery);
    }
  }, [loadEvents, searchExecutedQuery, searchCalendarEventsWithFuzzy]);

  const runQueuedMove = useCallback((work) => {
    const runner = async () => work();
    const next = moveQueueRef.current.then(runner, runner);
    moveQueueRef.current = next.catch(() => {});
    return next;
  }, []);

  const schedulePostMoveSync = useCallback(() => {
    if (postMoveSyncTimerRef.current) {
      window.clearTimeout(postMoveSyncTimerRef.current);
      postMoveSyncTimerRef.current = null;
    }

    postMoveSyncTimerRef.current = window.setTimeout(async () => {
      if (pendingMoveCountRef.current > 0) return;
      if (movePersistFailureRef.current) return;
      try {
        await refreshCalendarAfterMove();
      } catch (_) {
        // Keep optimistic state; next natural reload will reconcile.
      }
    }, 1000);
  }, [refreshCalendarAfterMove]);

  const openMonthMorePopup = useCallback((arg) => {
    const clickedDate = toDateOrNull(arg?.date);
    const jsEvt = arg?.jsEvent;
    if (!clickedDate || !jsEvt) return;

    const dayStart = new Date(clickedDate.getFullYear(), clickedDate.getMonth(), clickedDate.getDate());
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const dayStartMs = dayStart.getTime();
    const dayEndMs = dayEnd.getTime();

    const popupEvents = filteredEvents
      .filter((evt) => {
        const source = eventSourceOf(evt);
        if (source === 'NOTICE_BG') return false;
        const displayMode = String(evt?.display || evt?.extendedProps?.display || '').toLowerCase();
        if (displayMode === 'background') return false;
        const start = toDateOrNull(evt?.start);
        if (!start) return false;
        const endRaw = toDateOrNull(evt?.end);
        const fallbackEnd = evt?.allDay
          ? new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1)
          : new Date(start.getTime() + (60 * 60 * 1000));
        const end = endRaw || fallbackEnd;
        return start.getTime() < dayEndMs && end.getTime() > dayStartMs;
      })
      .sort(compareCalendarEventPriority)
      .map((evt) => {
        const source = eventSourceOf(evt);
        const eventColor = String(
          evt?.backgroundColor ||
          evt?.color ||
          evt?.extendedProps?.color ||
          (source === 'FESTIVAL' ? '#33b679' : source === 'TASK' ? '#039be5' : isAlertNotice(evt) ? '#ea4335' : '#4285f4')
        );
        const start = toDateOrNull(evt?.start);
        const endRaw = toDateOrNull(evt?.end);
        const fallbackEnd = start
          ? (evt?.allDay
              ? new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1)
              : new Date(start.getTime() + (60 * 60 * 1000)))
          : null;
        const end = endRaw || fallbackEnd;
        const popoverEventData = createSchedulePopoverEvent(evt, start, end, eventColor);
        const isAllDay = Boolean(evt?.allDay);
        const title = source === 'FESTIVAL'
          ? (stripFestivalPrefix(evt?.title) || String(evt?.title || 'Untitled'))
          : String(evt?.title || 'Untitled');

        if (isAllDay) {
          return {
            isAllDay: true,
            title,
            bgColor: eventColor,
            textColor: readableTextColorForBg(eventColor),
            hasCircleIcon: Boolean(evt?.extendedProps?.icon === 'empty-circle'),
            eventData: popoverEventData,
            popoverEventData
          };
        }

        return {
          isAllDay: false,
          title,
          time: start ? formatScheduleCompactTime(start) : '',
          dotColor: eventColor,
          eventData: popoverEventData,
          popoverEventData
        };
      });

    const popupWidth = 200;
    const maxListHeight = 360;
    const rowHeight = 24;
    const estimatedHeight = Math.min(
      window.innerHeight - 20,
      112 + Math.min(maxListHeight, popupEvents.length * rowHeight)
    );
    const margin = 8;

    const evtTarget = jsEvt?.target instanceof Element ? jsEvt.target : null;
    const dayCellEl = evtTarget?.closest('.fc-daygrid-day');
    const dayCellRect = dayCellEl instanceof Element ? dayCellEl.getBoundingClientRect() : null;

    const fallbackX = Number(jsEvt.clientX) || 0;
    const fallbackY = Number(jsEvt.clientY) || 0;
    const anchorRect = dayCellRect || {
      left: fallbackX,
      right: fallbackX,
      top: fallbackY,
      bottom: fallbackY,
      width: 0,
      height: 0
    };

    // Keep popup over the same date cell; if near bottom, bias upward to avoid cutoff.
    const desiredX = anchorRect.left + ((anchorRect.width - popupWidth) / 2);
    let desiredY = anchorRect.top + ((anchorRect.height - estimatedHeight) / 2);
    if (desiredY + estimatedHeight > window.innerHeight - margin) {
      desiredY = anchorRect.bottom - estimatedHeight - 6;
    }
    const x = clamp(desiredX, margin, window.innerWidth - popupWidth - margin);
    const y = clamp(desiredY, margin, window.innerHeight - estimatedHeight - margin);

    setMonthMorePopup({
      open: true,
      x,
      y,
      dayText: clickedDate.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase(),
      dateNumber: String(clickedDate.getDate()),
      events: popupEvents
    });
  }, [filteredEvents]);

  const closePopover = useCallback(() => {
    setPopover(prev => ({ ...prev, open: false }));
    setPopoverEditMode(false);
    setPopoverEditLoading(false);
    setPopoverEditSaving(false);
    setPopoverDeleting(false);
    setPopoverEditError('');
    setPopoverEditForm(emptyPopoverEditForm());
    setCopyHelpOpen(false);
    setDeleteConfirm(emptyDeleteConfirmState());
  }, []);

  const closeDeleteConfirm = useCallback(() => {
    if (popoverDeleting) return;
    setDeleteConfirm(emptyDeleteConfirmState());
  }, [popoverDeleting]);

  const buildClipboardFromEvent = useCallback((eventLike) => {
    if (!eventLike) return null;
    const source = eventSourceOf(eventLike);
    if (source !== 'NOTICE' && source !== 'TASK') return null;

    const start = toDateOrNull(eventLike?.start);
    const endRaw = toDateOrNull(eventLike?.end);
    if (!start) return null;
    const isAllDay = Boolean(eventLike?.allDay);
    const allDaySpanDays = isAllDay
      ? Math.max(1, Math.round(getStableAllDaySpanDays(eventLike, start, endRaw)))
      : 0;
    const durationMs = Math.max(
      1,
      isAllDay
        ? (allDaySpanDays * 24 * 60 * 60 * 1000)
        : (endRaw ? (endRaw.getTime() - start.getTime()) : (60 * 60 * 1000))
    );

    return {
      source,
      title: String(eventLike?.title || '').trim(),
      description: eventDescriptionOf(eventLike),
      allDay: isAllDay,
      allDaySpanDays,
      startHour: start.getHours(),
      startMinute: start.getMinutes(),
      startSecond: start.getSeconds(),
      durationMs,
      isAlert: isAlertNotice(eventLike)
    };
  }, []);

  const buildPastedRange = useCallback((clipboardItem, pasteTarget) => {
    if (!clipboardItem || !pasteTarget?.dateKey) return null;
    const targetDate = toDateOrNull(`${String(pasteTarget.dateKey)}T00:00:00`);
    if (!targetDate) return null;

    if (clipboardItem.allDay) {
      const start = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 0, 0, 0, 0);
      const spanDays = Math.max(1, Math.round(Number(clipboardItem.allDaySpanDays) || 1));
      const end = new Date(start);
      end.setDate(end.getDate() + spanDays);
      return { start, end, allDay: true };
    }

    const hasSlot = Number.isFinite(Number(pasteTarget.slotMinutes));
    const slotMinutes = hasSlot ? Number(pasteTarget.slotMinutes) : null;
    const hour = hasSlot ? Math.floor(slotMinutes / 60) : Number(clipboardItem.startHour) || 0;
    const minute = hasSlot ? (slotMinutes % 60) : Number(clipboardItem.startMinute) || 0;
    const second = Number(clipboardItem.startSecond) || 0;
    const start = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), hour, minute, second, 0);
    const spanMs = Math.max(60 * 1000, Number(clipboardItem.durationMs) || (60 * 60 * 1000));
    const end = new Date(start.getTime() + spanMs);
    return { start, end, allDay: false };
  }, []);

  const pasteCopiedEventToTarget = useCallback(async (pasteTarget) => {
    const clipboardItem = copiedEventRef.current;
    if (!clipboardItem) {
      setSnackbarSeverity('info');
      setSnackbarMessage('No copied events are there to paste.');
      setSnackbarOpen(true);
      return false;
    }

    if (!pasteTarget?.dateKey) {
      setSnackbarSeverity('warning');
      setSnackbarMessage('Put pointer on a valid date cell/row, then paste.');
      setSnackbarOpen(true);
      return false;
    }

    const nextRange = buildPastedRange(clipboardItem, pasteTarget);
    pushMoveSpanDebug({
      stage: 'paste-range',
      source: clipboardItem?.source || '',
      title: String(clipboardItem?.title || ''),
      allDay: Boolean(clipboardItem?.allDay),
      allDaySpanDays: Number(clipboardItem?.allDaySpanDays) || 0,
      targetDateKey: String(pasteTarget?.dateKey || ''),
      payloadStart: toDateOrNull(nextRange?.start)?.toISOString?.() || null,
      payloadEnd: toDateOrNull(nextRange?.end)?.toISOString?.() || null
    });
    if (!nextRange?.start || !nextRange?.end) {
      setSnackbarSeverity('error');
      setSnackbarMessage('Unable to paste this copied event on the selected date.');
      setSnackbarOpen(true);
      return false;
    }

    try {
      if (clipboardItem.source === 'TASK') {
        if (!canManageTasks) {
          setSnackbarSeverity('warning');
          setSnackbarMessage('Login as admin/faculty to paste copied public tasks.');
          setSnackbarOpen(true);
          return false;
        }

        await createCalendarTaskApi({
          title: String(clipboardItem.title || 'Copied task').trim(),
          description: String(clipboardItem.description || ''),
          allDay: Boolean(nextRange.allDay),
          startDateTime: nextRange.start.toISOString(),
          endDateTime: nextRange.end.toISOString()
        });
      } else if (clipboardItem.source === 'NOTICE') {
        if (!isAdmin) {
          setSnackbarSeverity('warning');
          setSnackbarMessage('Only admin can paste copied notices/alerts.');
          setSnackbarOpen(true);
          return false;
        }

        const baseTitle = stripNoticePrefix(clipboardItem.title) || String(clipboardItem.title || 'Copied notice').trim();
        const description = String(clipboardItem.description || '').trim();
        const content = description || baseTitle;
        const noticeRange = toNoticeApiRange(nextRange.start, nextRange.end, Boolean(nextRange.allDay));
        if (!noticeRange?.startDateTime || !noticeRange?.endDateTime) {
          setSnackbarSeverity('error');
          setSnackbarMessage('Unable to prepare notice date range for paste.');
          setSnackbarOpen(true);
          return false;
        }
        pushMoveSpanDebug({
          stage: 'paste-notice-range',
          source: 'NOTICE',
          title: String(baseTitle || ''),
          allDay: Boolean(nextRange?.allDay),
          targetDateKey: String(pasteTarget?.dateKey || ''),
          payloadStart: String(noticeRange.startDateTime || ''),
          payloadEnd: String(noticeRange.endDateTime || '')
        });

        await createNoticeApi({
          title: baseTitle,
          subject: baseTitle,
          content,
          body: content,
          description: content,
          startDateTime: noticeRange.startDateTime,
          endDateTime: noticeRange.endDateTime,
          kind: clipboardItem.isAlert ? 'HOLIDAY' : 'GENERAL'
        });
      } else {
        setSnackbarSeverity('error');
        setSnackbarMessage('This copied event type cannot be pasted.');
        setSnackbarOpen(true);
        return false;
      }

      await refreshCalendarAfterMove();
      setSnackbarSeverity('success');
      setSnackbarMessage('Copied event pasted successfully.');
      setSnackbarOpen(true);
      return true;
    } catch (err) {
      setSnackbarSeverity('error');
      setSnackbarMessage(err?.response?.data?.error || 'Unable to paste copied event right now.');
      setSnackbarOpen(true);
      return false;
    }
  }, [buildPastedRange, canManageTasks, isAdmin, pushMoveSpanDebug, refreshCalendarAfterMove]);

  const copyPopoverEvent = useCallback(() => {
    const eventLike = popover?.eventData;
    const source = eventSourceOf(eventLike);
    if (!eventLike || source === 'FESTIVAL') return;
    const clipboardItem = buildClipboardFromEvent(eventLike);
    if (!clipboardItem) {
      setSnackbarSeverity('warning');
      setSnackbarMessage('This event cannot be copied.');
      setSnackbarOpen(true);
      return;
    }
    copiedEventRef.current = clipboardItem;
    pushMoveSpanDebug({
      stage: 'copy-event',
      source: clipboardItem?.source || '',
      title: String(clipboardItem?.title || ''),
      allDay: Boolean(clipboardItem?.allDay),
      allDaySpanDays: Number(clipboardItem?.allDaySpanDays) || 0,
      durationMs: Number(clipboardItem?.durationMs) || 0
    });
    setSnackbarSeverity('success');
    setSnackbarMessage('Copied. To know how to paste it anywhere, click on the i button just left of Copy.');
    setSnackbarOpen(true);
  }, [buildClipboardFromEvent, popover?.eventData, pushMoveSpanDebug]);

  const handleMonthMoreEventClick = useCallback((monthPopupEvent, jsEvent) => {
    if (monthMoreDragRef.current.justDragged) {
      monthMoreDragRef.current.justDragged = false;
      return;
    }

    const eventData = monthPopupEvent?.eventData;
    if (!eventData) return;

    jsEvent?.preventDefault?.();
    jsEvent?.stopPropagation?.();

    // If an event popover is already open, first click should only dismiss it.
    if (popover.open) {
      closePopover();
      return;
    }

    const targetEl = jsEvent?.currentTarget;
    if (!(targetEl instanceof Element)) return;
    const rect = targetEl.getBoundingClientRect();

    const rawX = Number(jsEvent?.clientX);
    const rawY = Number(jsEvent?.clientY);
    const fallbackX = rect.left + (rect.width / 2);
    const fallbackY = rect.top + (rect.height / 2);

    const anchorPoint = {
      x: clamp(Number.isFinite(rawX) ? rawX : fallbackX, rect.left + 2, rect.right - 2),
      y: clamp(Number.isFinite(rawY) ? rawY : fallbackY, rect.top + 2, rect.bottom - 2)
    };

    const anchorRect = {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height
    };

    openPopoverFromAnchor(eventData, anchorRect, {
      sourceView: 'monthMore',
      anchorPoint,
      anchorRect,
      layoutAnchorRect: anchorRect
    });
  }, [closePopover, openPopoverFromAnchor, popover.open]);

  const handleMonthMoreEventDragStart = useCallback((monthPopupEvent, ev) => {
    if (viewType !== 'dayGridMonth') {
      ev.preventDefault();
      return;
    }

    const eventData = monthPopupEvent?.eventData;
    if (!canDragCalendarEvent(eventData)) {
      ev.preventDefault();
      return;
    }

    closePopover();
    monthMoreDragRef.current.active = true;
    monthMoreDragRef.current.eventData = eventData;
    monthMoreDragRef.current.sourceDateKey = toDateKeyLocal(eventData?.start);
    monthMoreDragRef.current.justDragged = true;
    document.body.classList.add('gcal-dragging');

    if (ev?.dataTransfer) {
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', String(monthMoreDragRef.current.sourceDateKey || ''));
    }
  }, [canDragCalendarEvent, closePopover, viewType]);

  const handleMonthMoreEventDragEnd = useCallback(() => {
    monthMoreDragRef.current.active = false;
    monthMoreDragRef.current.eventData = null;
    monthMoreDragRef.current.sourceDateKey = '';
    document.body.classList.remove('gcal-dragging');
    window.setTimeout(() => {
      monthMoreDragRef.current.justDragged = false;
    }, 0);
  }, []);

  useEffect(() => {
    const handleDragOver = (ev) => {
      if (!monthMoreDragRef.current.active) return;
      const rawTarget = ev.target;
      const target = rawTarget instanceof Element ? rawTarget.closest('.fc-daygrid-day[data-date]') : null;
      if (!target) return;
      ev.preventDefault();
      if (ev?.dataTransfer) ev.dataTransfer.dropEffect = 'move';
    };

    const runDrop = async (ev) => {
      if (!monthMoreDragRef.current.active) return;
      if (viewType !== 'dayGridMonth') {
        handleMonthMoreEventDragEnd();
        return;
      }

      const rawTarget = ev.target;
      const target = rawTarget instanceof Element ? rawTarget.closest('.fc-daygrid-day[data-date]') : null;
      if (!(target instanceof Element)) {
        handleMonthMoreEventDragEnd();
        return;
      }

      ev.preventDefault();
      ev.stopPropagation();

      const targetDateKey = String(target.getAttribute('data-date') || '');
      const dragState = monthMoreDragRef.current;
      const eventData = dragState?.eventData;
      const sourceDateKey = String(dragState?.sourceDateKey || '');

      if (!eventData || !targetDateKey || targetDateKey === sourceDateKey) {
        handleMonthMoreEventDragEnd();
        return;
      }

      const nextRange = computeMovedRangeForDateKey(eventData, targetDateKey);
      if (!nextRange) {
        handleMonthMoreEventDragEnd();
        setSnackbarSeverity('error');
        setSnackbarMessage('Unable to move this event.');
        setSnackbarOpen(true);
        return;
      }

      if (eventData?.allDay) {
        const sourceStart = toDateOrNull(eventData?.start);
        const sourceEnd = toDateOrNull(eventData?.end);
        const rawSpanDays = computeAllDaySpanDays(sourceStart, sourceEnd);
        const lockedSpanDays = getLockedAllDaySpanDays(eventData, sourceStart, sourceEnd);
        pushMoveSpanDebug({
          stage: 'month-more-drop-all-day',
          key: eventIdentityKeyOf(eventData),
          source: eventSourceOf(eventData),
          title: String(eventData?.title || ''),
          rawSpanDays,
          lockedSpanDays,
          sourceDateKey,
          targetDateKey,
          payloadStart: toDateOrNull(nextRange?.start)?.toISOString?.() || null,
          payloadEnd: toDateOrNull(nextRange?.end)?.toISOString?.() || null
        });
      }

      const moveMeta = registerMoveVersion(eventData);

      applyOptimisticMove(eventData, nextRange);
      closePopover();
      closeMonthMorePopup();
      pendingMoveCountRef.current += 1;
      handleMonthMoreEventDragEnd();

      void runQueuedMove(async () => persistLatestMove(eventData, nextRange, moveMeta))
        .catch((err) => {
          if (!isMoveStillLatest(moveMeta)) return;
          movePersistFailureRef.current = true;
          setSnackbarSeverity('error');
          setSnackbarMessage(err?.response?.data?.error || err?.message || 'Unable to save the latest move right now. Try again in a moment.');
          setSnackbarOpen(true);
        })
        .finally(() => {
          pendingMoveCountRef.current = Math.max(0, pendingMoveCountRef.current - 1);
          if (pendingMoveCountRef.current === 0) {
            schedulePostMoveSync();
          }
        });
    };

    const handleDrop = (ev) => {
      if (!monthMoreDragRef.current.active) return;
      void runDrop(ev);
    };

    document.addEventListener('dragover', handleDragOver, true);
    document.addEventListener('drop', handleDrop, true);
    return () => {
      document.removeEventListener('dragover', handleDragOver, true);
      document.removeEventListener('drop', handleDrop, true);
    };
  }, [
    closeMonthMorePopup,
    closePopover,
    computeMovedRangeForDateKey,
    getLockedAllDaySpanDays,
    handleMonthMoreEventDragEnd,
    applyOptimisticMove,
    pushMoveSpanDebug,
    persistLatestMove,
    registerMoveVersion,
    isMoveStillLatest,
    runQueuedMove,
    schedulePostMoveSync,
    viewType
  ]);

  // Pointer-down outside listener to close dropdowns and search instantly.
  useEffect(() => {
    const handlePointerDownOutside = (e) => {
      const rawTarget = e.target;
      const target = rawTarget instanceof Element ? rawTarget : rawTarget?.parentElement;
      if (!(target instanceof Element)) return;
      if (deleteConfirm.open) {
        // Let the custom delete dialog handle its own click flow.
        return;
      }
      const insidePopover = Boolean(target.closest('.gcal-event-popover'));
      const insideCopyHelp = Boolean(target.closest('.gcal-copy-help-card'));
      const insideMonthMore = Boolean(target.closest('.gcal-month-more-popup'));
      const onMoreLink = Boolean(target.closest('.fc-more-link'));

      if (!target.closest('.gcal-view-selector-container')) setViewDropdownOpen(false);
      if (!target.closest('.gcal-settings-container')) setSettingsDropdownOpen(false);
      if (!target.closest('.gcal-user-container')) setUserMenuOpen(false);

      // When both are visible: first outside/month-more click closes only event popover.
      if (popover.open) {
        if (!insidePopover && !insideCopyHelp) {
          closePopover();
        }
        return;
      }

      if (monthMorePopup.open && !insideMonthMore && !onMoreLink) {
        closeMonthMorePopup();
      }
      const insideSearchUi = Boolean(
        target.closest('.gcal-search-header') ||
        target.closest('.gcal-search-results-shell') ||
        target.closest('.gcal-search-result-item') ||
        target.closest('.gcal-search-open-btn')
      );
      if (searchOpen && !insideSearchUi) {
        const restoreView = String(searchReturnRef.current?.view || viewType || 'dayGridMonth');
        const restoreIso = String(searchReturnRef.current?.dateIso || '');
        setViewType(restoreView);
        if (restoreIso) setPendingGotoIso(restoreIso);
        setSearchOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDownOutside, true);
    return () => document.removeEventListener('pointerdown', handlePointerDownOutside, true);
  }, [searchOpen, viewType, monthMorePopup.open, closeMonthMorePopup, closePopover, popover.open, deleteConfirm.open]);

  useEffect(() => {
    const updateLastPointer = (ev) => {
      const x = Number(ev?.clientX);
      const y = Number(ev?.clientY);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      lastPointerRef.current = { x, y };
    };

    const handleKeyboardPaste = (ev) => {
      if (searchOpen) return;
      if (!(ev.ctrlKey || ev.metaKey)) return;
      if (ev.altKey) return;
      if (String(ev.key || '').toLowerCase() !== 'v') return;

      const target = ev.target;
      if (target instanceof Element && isEditableDomTarget(target)) return;

      const pasteTarget = resolveCalendarPasteTarget(
        target instanceof Element ? target : null,
        lastPointerRef.current
      );
      if (!pasteTarget) return;

      ev.preventDefault();
      ev.stopPropagation();
      void pasteCopiedEventToTarget(pasteTarget);
    };

    const handleContextMenuPaste = (ev) => {
      if (searchOpen) return;
      const target = ev.target;
      if (!(target instanceof Element)) return;
      if (isEditableDomTarget(target)) return;

      const pasteTarget = resolveCalendarPasteTarget(target, {
        x: Number(ev?.clientX),
        y: Number(ev?.clientY)
      });
      if (!pasteTarget) return;

      ev.preventDefault();
      ev.stopPropagation();
      void pasteCopiedEventToTarget(pasteTarget);
    };

    window.addEventListener('pointermove', updateLastPointer, true);
    window.addEventListener('pointerdown', updateLastPointer, true);
    window.addEventListener('keydown', handleKeyboardPaste, true);
    window.addEventListener('contextmenu', handleContextMenuPaste, true);
    return () => {
      window.removeEventListener('pointermove', updateLastPointer, true);
      window.removeEventListener('pointerdown', updateLastPointer, true);
      window.removeEventListener('keydown', handleKeyboardPaste, true);
      window.removeEventListener('contextmenu', handleContextMenuPaste, true);
    };
  }, [pasteCopiedEventToTarget, searchOpen]);

  const handleEventClick = useCallback((clickInfo) => {
    const eventSource = String(clickInfo?.event?.extendedProps?.source || '');
    if (eventSource === 'NOTICE_BG' || String(clickInfo?.event?.display || '').toLowerCase() === 'background') {
      return;
    }

    clickInfo.jsEvent.preventDefault();
    const rect = clickInfo.el.getBoundingClientRect();
    const rawX = Number(clickInfo?.jsEvent?.clientX);
    const rawY = Number(clickInfo?.jsEvent?.clientY);
    const fallbackX = rect.left + (rect.width / 2);
    const fallbackY = rect.top + (rect.height / 2);
    const pointerX = Number.isFinite(rawX) ? rawX : fallbackX;
    const pointerY = Number.isFinite(rawY) ? rawY : fallbackY;

    const anchorRect = {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height
    };

    const anchorPoint = {
      x: clamp(pointerX, rect.left + 2, rect.right - 2),
      y: clamp(pointerY, rect.top + 2, rect.bottom - 2)
    };

    const layoutAnchorRect = (String(clickInfo?.view?.type || '') === 'timeGridDay')
      ? {
          left: anchorPoint.x - 1,
          right: anchorPoint.x + 1,
          top: anchorPoint.y - 1,
          bottom: anchorPoint.y + 1,
          width: 2,
          height: 2
        }
      : anchorRect;

    openPopoverFromAnchor(clickInfo.event, anchorRect, {
      sourceView: String(clickInfo?.view?.type || ''),
      anchorPoint,
      anchorRect,
      layoutAnchorRect
    });
  }, [openPopoverFromAnchor]);

  const handleEventDragStart = useCallback((arg) => {
    document.body.classList.add('gcal-dragging');
    pushMoveSpanDebug({
      stage: 'drag-start',
      key: eventIdentityKeyOf(arg?.event),
      source: eventSourceOf(arg?.event),
      title: String(arg?.event?.title || ''),
      allDay: Boolean(arg?.event?.allDay),
      start: toDateOrNull(arg?.event?.start)?.toISOString?.() || null,
      end: toDateOrNull(arg?.event?.end)?.toISOString?.() || null
    });
  }, [pushMoveSpanDebug]);

  const handleEventDragStop = useCallback((arg) => {
    document.body.classList.remove('gcal-dragging');
    pushMoveSpanDebug({
      stage: 'drag-stop',
      key: eventIdentityKeyOf(arg?.event),
      source: eventSourceOf(arg?.event),
      title: String(arg?.event?.title || ''),
      allDay: Boolean(arg?.event?.allDay),
      start: toDateOrNull(arg?.event?.start)?.toISOString?.() || null,
      end: toDateOrNull(arg?.event?.end)?.toISOString?.() || null
    });
  }, [pushMoveSpanDebug]);

  const handleEventChange = useCallback((changeInfo) => {
    const evt = changeInfo?.event;
    pushMoveSpanDebug({
      stage: 'event-change',
      key: eventIdentityKeyOf(evt),
      source: eventSourceOf(evt),
      title: String(evt?.title || ''),
      allDay: Boolean(evt?.allDay),
      start: toDateOrNull(evt?.start)?.toISOString?.() || null,
      end: toDateOrNull(evt?.end)?.toISOString?.() || null
    });
  }, [pushMoveSpanDebug]);

  const handleEventDrop = useCallback((dropInfo) => {
    const eventLike = dropInfo?.event;
    const activeViewType = String(dropInfo?.view?.type || viewType || '');
    pushMoveSpanDebug({
      stage: 'drop-attempt',
      viewType: activeViewType,
      key: eventIdentityKeyOf(eventLike),
      source: eventSourceOf(eventLike),
      title: String(eventLike?.title || ''),
      allDay: Boolean(eventLike?.allDay)
    });
    if (!eventLike) {
      pushMoveSpanDebug({ stage: 'drop-revert', reason: 'missing-event' });
      dropInfo?.revert?.();
      return;
    }

    if (!(activeViewType === 'dayGridMonth' || activeViewType === 'timeGridWeek')) {
      pushMoveSpanDebug({ stage: 'drop-revert', reason: 'unsupported-view', viewType: activeViewType });
      dropInfo?.revert?.();
      return;
    }

    if (!canDragCalendarEvent(eventLike)) {
      pushMoveSpanDebug({ stage: 'drop-revert', reason: 'not-allowed', key: eventIdentityKeyOf(eventLike) });
      dropInfo?.revert?.();
      setSnackbarSeverity('warning');
      setSnackbarMessage('You are not allowed to move this event.');
      setSnackbarOpen(true);
      return;
    }

    const nextStart = toDateOrNull(eventLike.start);
    const nextEndRaw = toDateOrNull(eventLike.end);
    const oldStart = toDateOrNull(dropInfo?.oldEvent?.start);
    const oldEnd = toDateOrNull(dropInfo?.oldEvent?.end);
    if (!nextStart) {
      pushMoveSpanDebug({ stage: 'drop-revert', reason: 'invalid-next-start', key: eventIdentityKeyOf(eventLike) });
      dropInfo?.revert?.();
      return;
    }

    const isAllDay = Boolean(eventLike.allDay);
    let nextRange;
    if (isAllDay) {
      const anchorStart = oldStart || nextStart;
      const anchorEnd = oldEnd || nextEndRaw || toDateOrNull(eventLike?.end);
      const rawSpanDays = computeAllDaySpanDays(anchorStart, anchorEnd);
      const spanDays = getLockedAllDaySpanDays(eventLike, anchorStart, anchorEnd);
      const normalizedStart = new Date(
        nextStart.getFullYear(),
        nextStart.getMonth(),
        nextStart.getDate(),
        0, 0, 0, 0
      );
      const normalizedEnd = new Date(normalizedStart);
      normalizedEnd.setDate(normalizedStart.getDate() + spanDays);
      nextRange = {
        start: normalizedStart,
        end: normalizedEnd,
        allDay: true
      };
      pushMoveSpanDebug({
        stage: 'drop-all-day',
        key: eventIdentityKeyOf(eventLike),
        source: eventSourceOf(eventLike),
        title: String(eventLike?.title || ''),
        rawSpanDays,
        lockedSpanDays: spanDays,
        oldStart: oldStart ? oldStart.toISOString() : null,
        oldEnd: oldEnd ? oldEnd.toISOString() : null,
        nextStartRaw: nextStart ? nextStart.toISOString() : null,
        nextEndRaw: nextEndRaw ? nextEndRaw.toISOString() : null,
        payloadStart: normalizedStart.toISOString(),
        payloadEnd: normalizedEnd.toISOString()
      });
    } else {
      const fallbackDurationMs = Math.max(
        1,
        (oldStart && oldEnd) ? (oldEnd.getTime() - oldStart.getTime()) : (60 * 60 * 1000)
      );
      const nextEnd = nextEndRaw || new Date(nextStart.getTime() + fallbackDurationMs);
      nextRange = {
        start: nextStart,
        end: nextEnd,
        allDay: false
      };
    }
    const moveMeta = registerMoveVersion(eventLike);

    applyOptimisticMove(eventLike, nextRange);
    closePopover();
    pendingMoveCountRef.current += 1;
    document.body.classList.remove('gcal-dragging');

    void runQueuedMove(async () => persistLatestMove(eventLike, nextRange, moveMeta))
      .catch((err) => {
        if (!isMoveStillLatest(moveMeta)) return;
        movePersistFailureRef.current = true;
        setSnackbarSeverity('error');
        setSnackbarMessage(err?.response?.data?.error || err?.message || 'Unable to save the latest move right now. Try again in a moment.');
        setSnackbarOpen(true);
      })
      .finally(() => {
        pendingMoveCountRef.current = Math.max(0, pendingMoveCountRef.current - 1);
        if (pendingMoveCountRef.current === 0) {
          schedulePostMoveSync();
        }
      });
  }, [
    applyOptimisticMove,
    canDragCalendarEvent,
    closePopover,
    getLockedAllDaySpanDays,
    pushMoveSpanDebug,
    persistLatestMove,
    registerMoveVersion,
    isMoveStillLatest,
    runQueuedMove,
    schedulePostMoveSync,
    viewType
  ]);

  const eventClassNames = useCallback((arg) => {
    const source = String(arg.event.extendedProps?.source || '');
    const classes = [];
    if (source === 'FESTIVAL') classes.push('gcal-event-festival');
    else if (source === 'TASK') classes.push('gcal-event-task');
    else if (source === 'NOTICE_BG') classes.push(isAlertNotice(arg.event) ? 'gcal-bg-alert' : 'gcal-bg-notice');
    else if (source === 'NOTICE') classes.push(isAlertNotice(arg.event) ? 'gcal-event-alert' : 'gcal-event-notice');
    else classes.push('gcal-event-generic');

    const currentView = String(arg?.view?.type || '');
    if ((currentView === 'dayGridMonth' || currentView === 'timeGridWeek') && canDragCalendarEvent(arg.event)) {
      classes.push('gcal-draggable-event');
    }
    return classes;
  }, [canDragCalendarEvent]);

  const handleEventDidMount = useCallback((arg) => {
    const currentView = String(arg?.view?.type || '');
    if (currentView !== 'timeGridWeek') return;
    if (!arg?.event?.allDay) return;
    // Intentionally do not mutate week all-day inline placement styles.
    // FullCalendar relies on inline top/left/inset to stack strips per day.
  }, []);

  const stopScheduleAutoScroll = useCallback(() => {
    if (scheduleAutoScrollTimerRef.current) {
      window.clearInterval(scheduleAutoScrollTimerRef.current);
      scheduleAutoScrollTimerRef.current = null;
    }
    scheduleAutoScrollDirRef.current = 0;
  }, []);

  const startScheduleAutoScroll = useCallback((direction) => {
    const dir = Number(direction) || 0;
    if (dir === 0) {
      stopScheduleAutoScroll();
      return;
    }
    if (scheduleAutoScrollTimerRef.current && scheduleAutoScrollDirRef.current === dir) return;
    stopScheduleAutoScroll();
    scheduleAutoScrollDirRef.current = dir;
    scheduleAutoScrollTimerRef.current = window.setInterval(() => {
      window.scrollBy(0, dir * 18);
    }, 16);
  }, [stopScheduleAutoScroll]);

  const handleSchedulePanelDragOver = useCallback((ev) => {
    if (viewType !== 'listYear' || !scheduleDragRef.current.active) return;
    ev.preventDefault();
    const threshold = 92;
    const y = Number(ev.clientY) || 0;
    if (y <= threshold) {
      startScheduleAutoScroll(-1);
    } else if (y >= window.innerHeight - threshold) {
      startScheduleAutoScroll(1);
    } else {
      startScheduleAutoScroll(0);
    }
  }, [startScheduleAutoScroll, viewType]);

  const handleScheduleDragStart = useCallback((scheduleEvent, ev) => {
    const eventData = scheduleEvent?.popoverEventData;
    if (!canDragCalendarEvent(eventData)) {
      ev.preventDefault();
      return;
    }
    closePopover();
    scheduleDragRef.current.active = true;
    scheduleDragRef.current.scheduleEvent = scheduleEvent;
    scheduleDragRef.current.sourceDateKey = String(scheduleEvent?.dateKey || '');
    scheduleDragRef.current.justDragged = true;
    setScheduleDragTargetDateKey(String(scheduleEvent?.dateKey || ''));
    document.body.classList.add('gcal-dragging');
    if (ev?.dataTransfer) {
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', String(scheduleEvent?.dateKey || ''));
    }
  }, [canDragCalendarEvent, closePopover]);

  const handleScheduleDragEnd = useCallback(() => {
    scheduleDragRef.current.active = false;
    scheduleDragRef.current.scheduleEvent = null;
    scheduleDragRef.current.sourceDateKey = '';
    stopScheduleAutoScroll();
    setScheduleDragTargetDateKey('');
    document.body.classList.remove('gcal-dragging');
    window.setTimeout(() => {
      scheduleDragRef.current.justDragged = false;
    }, 0);
  }, [stopScheduleAutoScroll]);

  const handleScheduleRowDragOver = useCallback((dateKey, ev) => {
    if (viewType !== 'listYear' || !scheduleDragRef.current.active) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (ev?.dataTransfer) ev.dataTransfer.dropEffect = 'move';
    setScheduleDragTargetDateKey(String(dateKey || ''));
    handleSchedulePanelDragOver(ev);
  }, [handleSchedulePanelDragOver, viewType]);

  const handleScheduleRowDrop = useCallback((dateKey, ev) => {
    if (viewType !== 'listYear' || !scheduleDragRef.current.active) return;
    ev.preventDefault();
    ev.stopPropagation();
    stopScheduleAutoScroll();

    const dragState = scheduleDragRef.current;
    const dragEvent = dragState?.scheduleEvent;
    const sourceDateKey = String(dragState?.sourceDateKey || '');
    const targetDateKey = String(dateKey || '');

    if (!dragEvent?.popoverEventData || !targetDateKey || targetDateKey === sourceDateKey) {
      handleScheduleDragEnd();
      return;
    }

    const nextRange = computeMovedRangeForDateKey(dragEvent.popoverEventData, targetDateKey);
    if (!nextRange) {
      handleScheduleDragEnd();
      setSnackbarSeverity('error');
      setSnackbarMessage('Unable to move this event.');
      setSnackbarOpen(true);
      return;
    }

    const eventData = dragEvent.popoverEventData;
    if (eventData?.allDay) {
      const sourceStart = toDateOrNull(eventData?.start);
      const sourceEnd = toDateOrNull(eventData?.end);
      const rawSpanDays = computeAllDaySpanDays(sourceStart, sourceEnd);
      const lockedSpanDays = getLockedAllDaySpanDays(eventData, sourceStart, sourceEnd);
      pushMoveSpanDebug({
        stage: 'schedule-drop-all-day',
        key: eventIdentityKeyOf(eventData),
        source: eventSourceOf(eventData),
        title: String(eventData?.title || ''),
        rawSpanDays,
        lockedSpanDays,
        sourceDateKey,
        targetDateKey,
        payloadStart: toDateOrNull(nextRange?.start)?.toISOString?.() || null,
        payloadEnd: toDateOrNull(nextRange?.end)?.toISOString?.() || null
      });
    }
    const moveMeta = registerMoveVersion(eventData);

    applyOptimisticMove(eventData, nextRange);
    handleScheduleDragEnd();
    pendingMoveCountRef.current += 1;

    void runQueuedMove(async () => persistLatestMove(eventData, nextRange, moveMeta))
      .catch((err) => {
        if (!isMoveStillLatest(moveMeta)) return;
        movePersistFailureRef.current = true;
        setSnackbarSeverity('error');
        setSnackbarMessage(err?.response?.data?.error || err?.message || 'Unable to save the latest move right now. Try again in a moment.');
        setSnackbarOpen(true);
      })
      .finally(() => {
        pendingMoveCountRef.current = Math.max(0, pendingMoveCountRef.current - 1);
        if (pendingMoveCountRef.current === 0) {
          schedulePostMoveSync();
        }
      });
  }, [
    applyOptimisticMove,
    computeMovedRangeForDateKey,
    getLockedAllDaySpanDays,
    handleScheduleDragEnd,
    persistLatestMove,
    pushMoveSpanDebug,
    registerMoveVersion,
    isMoveStillLatest,
    runQueuedMove,
    schedulePostMoveSync,
    stopScheduleAutoScroll,
    viewType
  ]);

  useEffect(() => {
    return () => {
      stopScheduleAutoScroll();
      if (postMoveSyncTimerRef.current) {
        window.clearTimeout(postMoveSyncTimerRef.current);
        postMoveSyncTimerRef.current = null;
      }
      document.body.classList.remove('gcal-dragging');
    };
  }, [stopScheduleAutoScroll]);

  const executeCalendarCommand = useCallback((command) => {
    const api = calendarRef.current?.getApi();
    if (!api) return;
    const commandFn = api?.[command];
    if (typeof commandFn === 'function') {
      commandFn.call(api);
    }
  }, []);

  useEffect(() => {
    if (!isMobile || searchOpen) return undefined;
    if (!MOBILE_SWIPE_ENABLED_VIEWS.has(viewType)) return undefined;
    const calendarCardEl = calendarCardRef.current;
    if (!calendarCardEl) return undefined;

    const swipeState = {
      active: false,
      blocked: false,
      startX: 0,
      startY: 0,
      lastX: 0,
      lastY: 0
    };

    const resetSwipeState = () => {
      swipeState.active = false;
      swipeState.blocked = false;
      swipeState.startX = 0;
      swipeState.startY = 0;
      swipeState.lastX = 0;
      swipeState.lastY = 0;
    };

    const handleTouchStart = (ev) => {
      const touch = ev.touches?.[0];
      if (!touch || ev.touches.length !== 1) {
        resetSwipeState();
        return;
      }
      swipeState.active = true;
      swipeState.blocked = isMobileSwipeBlockedTarget(ev.target);
      swipeState.startX = touch.clientX;
      swipeState.startY = touch.clientY;
      swipeState.lastX = touch.clientX;
      swipeState.lastY = touch.clientY;
    };

    const handleTouchMove = (ev) => {
      if (!swipeState.active) return;
      const touch = ev.touches?.[0];
      if (!touch) return;
      swipeState.lastX = touch.clientX;
      swipeState.lastY = touch.clientY;
    };

    const handleTouchEnd = (ev) => {
      if (!swipeState.active) return;

      const blocked = swipeState.blocked;
      const touch = ev.changedTouches?.[0];
      const endX = Number.isFinite(touch?.clientX) ? touch.clientX : swipeState.lastX;
      const endY = Number.isFinite(touch?.clientY) ? touch.clientY : swipeState.lastY;
      const deltaX = endX - swipeState.startX;
      const deltaY = endY - swipeState.startY;
      resetSwipeState();

      if (blocked) return;

      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);
      if (absX < MOBILE_SWIPE_MIN_DISTANCE_PX) return;
      if (absX < (absY * MOBILE_SWIPE_AXIS_RATIO)) return;

      executeCalendarCommand(deltaX < 0 ? 'next' : 'prev');
    };

    const handleTouchCancel = () => {
      resetSwipeState();
    };

    const listenerOptions = { passive: true };
    calendarCardEl.addEventListener('touchstart', handleTouchStart, listenerOptions);
    calendarCardEl.addEventListener('touchmove', handleTouchMove, listenerOptions);
    calendarCardEl.addEventListener('touchend', handleTouchEnd, listenerOptions);
    calendarCardEl.addEventListener('touchcancel', handleTouchCancel, listenerOptions);

    return () => {
      calendarCardEl.removeEventListener('touchstart', handleTouchStart, listenerOptions);
      calendarCardEl.removeEventListener('touchmove', handleTouchMove, listenerOptions);
      calendarCardEl.removeEventListener('touchend', handleTouchEnd, listenerOptions);
      calendarCardEl.removeEventListener('touchcancel', handleTouchCancel, listenerOptions);
    };
  }, [executeCalendarCommand, isMobile, searchOpen, viewType]);

  const closeAppearanceModal = () => {
    setAppearanceModalOpen(false);
    setSettingsDropdownOpen(false);
  };

  const openAppearanceModal = () => {
    setSettingsDropdownOpen(false);
    setAppearanceModalOpen(true);
  };

  const printableEvents = useMemo(() => {
    return filteredEvents
      .map((evt) => {
        const source = eventSourceOf(evt);
        const displayMode = String(evt?.display || evt?.extendedProps?.display || '').toLowerCase();
        if (source === 'NOTICE_BG' || displayMode === 'background') return null;

        const startRaw = toDateOrNull(evt?.start);
        if (!startRaw) return null;

        let start = startRaw;
        let end = null;
        const endRaw = toDateOrNull(evt?.end);
        if (evt?.allDay) {
          // Normalize all-day ranges to strict local day boundaries for print.
          // This avoids timezone spillover where one-day events appear in next day cell.
          const startDay = new Date(startRaw.getFullYear(), startRaw.getMonth(), startRaw.getDate());
          const endDay = endRaw
            ? new Date(endRaw.getFullYear(), endRaw.getMonth(), endRaw.getDate())
            : addDays(startDay, 1);
          start = startDay;
          end = endDay.getTime() > startDay.getTime() ? endDay : addDays(startDay, 1);
        } else {
          end = (endRaw && endRaw.getTime() > startRaw.getTime())
            ? endRaw
            : new Date(startRaw.getTime() + (60 * 60 * 1000));
        }

        const type = source === 'TASK'
          ? 'task'
          : (source === 'FESTIVAL' ? 'festival' : (isAlertNotice(evt) ? 'alert' : 'notice'));
        const color = String(
          evt?.backgroundColor ||
          evt?.color ||
          evt?.extendedProps?.color ||
          (type === 'festival' ? '#188038' : type === 'task' ? '#7b1fa2' : type === 'alert' ? '#d93025' : '#1a73e8')
        );
        const title = source === 'FESTIVAL'
          ? (stripFestivalPrefix(evt?.title) || String(evt?.title || 'Untitled'))
          : String(evt?.title || 'Untitled');
        return {
          id: String(evt?.id || ''),
          title,
          description: eventDescriptionOf(evt),
          type,
          color,
          allDay: Boolean(evt?.allDay),
          start,
          end,
          startMs: start.getTime(),
          endMs: end.getTime()
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a.startMs !== b.startMs) return a.startMs - b.startMs;
        if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
        return String(a.title || '').localeCompare(String(b.title || ''));
      });
  }, [filteredEvents]);

  const printPickerAnchorYear = useMemo(() => new Date().getFullYear(), []);
  const monthPrintOptions = useMemo(
    () => buildMonthPrintOptions(printPickerAnchorYear, 8, 8),
    [printPickerAnchorYear]
  );
  const weekPrintOptions = useMemo(
    () => buildWeekPrintOptions(printPickerAnchorYear, 8, 8),
    [printPickerAnchorYear]
  );
  const schedulePrintOptions = useMemo(
    () => buildSchedulePrintOptions(printableEvents),
    [printableEvents]
  );
  const monthFromPickerOptions = useMemo(
    () => reorderOptionsWithSelectedFirst(monthPrintOptions, printForm.monthFrom),
    [monthPrintOptions, printForm.monthFrom]
  );
  const monthToPickerOptions = useMemo(
    () => reorderOptionsWithSelectedFirst(monthPrintOptions, printForm.monthTo),
    [monthPrintOptions, printForm.monthTo]
  );
  const weekFromPickerOptions = useMemo(
    () => reorderOptionsWithSelectedFirst(weekPrintOptions, printForm.weekFrom),
    [weekPrintOptions, printForm.weekFrom]
  );
  const weekToPickerOptions = useMemo(
    () => reorderOptionsWithSelectedFirst(weekPrintOptions, printForm.weekTo),
    [weekPrintOptions, printForm.weekTo]
  );
  const buildPrintDocument = useCallback((formState, options = DEFAULT_PRINT_OPTIONS) => {
    const formatDayTitle = (dateObj) =>
      dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const formatCompactTime = (dateObj) => {
      const useMinute = dateObj.getMinutes() !== 0;
      return dateObj
        .toLocaleTimeString('en-US', { hour: 'numeric', minute: useMinute ? '2-digit' : undefined, hour12: true })
        .toLowerCase()
        .replace(/\s/g, '');
    };
    const formatEventTime = (evt) => (
      evt.allDay
        ? 'All day'
        : `${formatCompactTime(evt.start)} - ${formatCompactTime(evt.end)}`
    );
    const labelByType = {
      notice: 'NOTICE',
      alert: 'ALERT',
      festival: 'FESTIVAL',
      task: 'TASK'
    };
    const typeClassByType = {
      notice: 'notice',
      alert: 'alert',
      festival: 'festival',
      task: 'task'
    };
    const requestedFontSize = Number(options?.fontSize);
    const baseFontSizePx = clamp(Number.isFinite(requestedFontSize) ? requestedFontSize : DEFAULT_PRINT_OPTIONS.fontSize, 8, 24);
    const requestedGridScale = Number(options?.gridScale);
    const requestedGridScaleX = Number(options?.gridScaleX);
    const requestedGridScaleY = Number(options?.gridScaleY);
    const gridScaleRaw = clamp(Number.isFinite(requestedGridScale) ? requestedGridScale : DEFAULT_PRINT_OPTIONS.gridScale, 60, 200);
    const gridScaleXRaw = clamp(
      Number.isFinite(requestedGridScaleX) ? requestedGridScaleX : gridScaleRaw,
      60,
      200
    );
    const gridScaleYRaw = clamp(
      Number.isFinite(requestedGridScaleY) ? requestedGridScaleY : gridScaleRaw,
      60,
      200
    );
    const gridScale = gridScaleRaw / 100;
    const gridScaleX = gridScaleXRaw / 100;
    const gridScaleY = gridScaleYRaw / 100;
    const orientationMode = String(options?.orientation || 'auto').toLowerCase();
    const showEvents = Boolean(options?.showEvents);
    const showWeekends = Boolean(options?.showWeekends);
    const showDeclined = Boolean(options?.showDeclined);
    const visibleEvents = printableEvents.filter((evt) => {
      if (showDeclined) return true;
      return !isDeclinedPrintableEvent(evt);
    });

    const getDayStart = (value) => {
      const parsed = toDateOrNull(`${String(value || '')}T00:00:00`);
      if (!parsed) return null;
      return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
    };
    const getEventsForRange = (startMs, endMs) =>
      visibleEvents.filter((evt) => evt.startMs < endMs && evt.endMs > startMs);
    const getEventsForDay = (dayDate) => {
      const start = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate());
      const end = addDays(start, 1);
      return getEventsForRange(start.getTime(), end.getTime());
    };
    const renderEventListRows = (events) => {
      if (!showEvents) {
        return '<div class="print-empty">Event details hidden (Show events is turned off).</div>';
      }
      if (!events.length) {
        return '<div class="print-empty">No events for this range.</div>';
      }
      return `<table class="print-table"><thead><tr><th>Time</th><th>Event</th><th>Type</th></tr></thead><tbody>${
        events.map((evt) => {
          const typeLabel = labelByType[evt.type] || 'EVENT';
          const typeClass = typeClassByType[evt.type] || 'notice';
          return `<tr>
            <td>${escapeHtml(formatEventTime(evt))}</td>
            <td>
              <div class="print-event-title-wrap">
                <span class="print-dot" style="background:${escapeHtml(evt.color)}"></span>
                <span>${escapeHtml(evt.title)}</span>
              </div>
            </td>
            <td><span class="print-chip ${typeClass}">${escapeHtml(typeLabel)}</span></td>
          </tr>`;
        }).join('')
      }</tbody></table>`;
    };

    const pages = [];
    const view = String(formState?.view || 'month');

    if (view === 'day') {
      const from = getDayStart(formState.dayFrom);
      const to = getDayStart(formState.dayTo);
      if (!from || !to) return { ok: false, error: 'Please select valid day range for printing.' };
      if (to.getTime() < from.getTime()) return { ok: false, error: '"To day" must be on or after "From day".' };

      for (let day = new Date(from); day.getTime() <= to.getTime(); day = addDays(day, 1)) {
        const dayEvents = getEventsForDay(day);
        pages.push(`<section class="print-page">
          <header class="print-header">
            <h1>${escapeHtml(formatDayTitle(day))}</h1>
          </header>
          <div class="print-grid-area">
            ${renderEventListRows(dayEvents)}
          </div>
        </section>`);
      }
    } else if (view === 'week') {
      const fromWeek = getDayStart(formState.weekFromDate) || fromIsoWeekInputValue(formState.weekFrom);
      const toWeek = getDayStart(formState.weekToDate) || fromIsoWeekInputValue(formState.weekTo);
      if (!fromWeek || !toWeek) return { ok: false, error: 'Please select valid week range for printing.' };
      if (toWeek.getTime() < fromWeek.getTime()) return { ok: false, error: '"To week" must be on or after "From week".' };

      for (let weekStart = new Date(fromWeek); weekStart.getTime() <= toWeek.getTime(); weekStart = addDays(weekStart, 7)) {
        const allWeekDays = Array.from({ length: 7 }, (_, idx) => addDays(weekStart, idx));
        const weekDays = showWeekends
          ? allWeekDays
          : allWeekDays.filter((day) => day.getDay() !== 0 && day.getDay() !== 6);
        const labelFrom = weekDays[0] || allWeekDays[0];
        const labelTo = weekDays[weekDays.length - 1] || allWeekDays[allWeekDays.length - 1];
        const weekLabel = `${labelFrom.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} - ${labelTo.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
        pages.push(`<section class="print-page">
          <header class="print-header">
            <h1>${escapeHtml(weekLabel)}</h1>
          </header>
          <div class="print-grid-area">
            <div class="print-week-grid">${
              weekDays.map((day) => {
                const dayEvents = getEventsForDay(day);
                return `<article class="print-week-cell">
                  <h3>${escapeHtml(day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }))}</h3>
                  ${
                    showEvents && dayEvents.length
                      ? `<ul>${dayEvents.map((evt) => `<li><span class="print-dot" style="background:${escapeHtml(evt.color)}"></span><span>${escapeHtml(evt.allDay ? evt.title : `${formatCompactTime(evt.start)} ${evt.title}`)}</span></li>`).join('')}</ul>`
                      : '<div class="print-empty-inline">No events</div>'
                  }
                </article>`;
              }).join('')
            }</div>
          </div>
        </section>`);
      }
    } else if (view === 'month') {
      const fromMonth = fromMonthInputValue(formState.monthFrom);
      const toMonth = fromMonthInputValue(formState.monthTo);
      if (!fromMonth || !toMonth) return { ok: false, error: 'Please use month format mm-yyyy.' };
      if (toMonth.getTime() < fromMonth.getTime()) return { ok: false, error: '"To month" must be on or after "From month".' };

      for (let monthStart = new Date(fromMonth); monthStart.getTime() <= toMonth.getTime(); monthStart = addMonths(monthStart, 1)) {
        const firstOfMonth = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1);
        const gridStart = addDays(firstOfMonth, -firstOfMonth.getDay());
        const monthName = monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        const cells = Array.from({ length: 42 }, (_, idx) => addDays(gridStart, idx));
        const weeks = Array.from({ length: 6 }, (_, rowIdx) => cells.slice(rowIdx * 7, rowIdx * 7 + 7));
        const monthHeaders = showWeekends
          ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
          : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
        pages.push(`<section class="print-page">
          <header class="print-header print-header-month">
            <h1>${escapeHtml(monthName)}</h1>
          </header>
          <div class="print-grid-area">
            <table class="print-month-table">
              <thead>
                <tr>
                  ${monthHeaders.map((name) => `<th class="print-month-head">${escapeHtml(name)}</th>`).join('')}
                </tr>
              </thead>
              <tbody>
                ${weeks.map((week) => `<tr>
                  ${(showWeekends ? week : week.filter((day) => day.getDay() !== 0 && day.getDay() !== 6)).map((cellDate) => {
                    const inMonth = cellDate.getMonth() === monthStart.getMonth();
                    const dayEvents = getEventsForDay(cellDate);
                    return `<td class="print-month-cell ${inMonth ? '' : 'is-outside'}">
                      <div class="print-month-date">${cellDate.getDate()}</div>
                      ${showEvents && dayEvents.length
                        ? dayEvents.map((evt) => `<div class="print-month-event"><span class="print-dot" style="background:${escapeHtml(evt.color)}"></span><span>${escapeHtml(evt.allDay ? evt.title : `${formatCompactTime(evt.start)} ${evt.title}`)}</span></div>`).join('')
                        : ''
                      }
                    </td>`;
                  }).join('')}
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </section>`);
      }
    } else if (view === 'year') {
      const yearFrom = parseInt(String(formState.yearFrom || '').trim(), 10);
      const yearTo = parseInt(String(formState.yearTo || '').trim(), 10);
      if (!Number.isInteger(yearFrom) || !Number.isInteger(yearTo)) return { ok: false, error: 'Please select valid year range for printing.' };
      if (yearTo < yearFrom) return { ok: false, error: '"To year" must be on or after "From year".' };

      for (let year = yearFrom; year <= yearTo; year += 1) {
        const monthCards = MONTHS.map((monthName, monthIndex) => {
          const first = new Date(year, monthIndex, 1);
          const gridStart = addDays(first, -first.getDay());
          const cells = Array.from({ length: 42 }, (_, idx) => addDays(gridStart, idx));
          const rows = Array.from({ length: 6 }, (_, rowIdx) => cells.slice(rowIdx * 7, rowIdx * 7 + 7));
          const filteredCells = rows.flatMap((row) => (
            showWeekends ? row : row.filter((cellDate) => cellDate.getDay() !== 0 && cellDate.getDay() !== 6)
          ));
          const yearWeekDays = showWeekends ? ['S', 'M', 'T', 'W', 'T', 'F', 'S'] : ['M', 'T', 'W', 'T', 'F'];
          return `<article class="print-year-month">
            <h3>${escapeHtml(monthName)}</h3>
            <div class="print-year-weekdays">${yearWeekDays.map((name) => `<span>${name}</span>`).join('')}</div>
            <div class="print-year-days">
              ${filteredCells.map((cellDate) => {
                const inMonth = cellDate.getMonth() === monthIndex;
                const eventCount = (showEvents && inMonth) ? getEventsForDay(cellDate).length : 0;
                return `<span class="print-year-day ${inMonth ? '' : 'is-outside'} ${eventCount > 0 ? 'has-events' : ''}">${cellDate.getDate()}</span>`;
              }).join('')}
            </div>
          </article>`;
        }).join('');

        pages.push(`<section class="print-page">
          <header class="print-header">
            <h1>${escapeHtml(String(year))}</h1>
          </header>
          <div class="print-grid-area">
            <div class="print-year-grid">${monthCards}</div>
          </div>
        </section>`);
      }
    } else {
      if (!schedulePrintOptions.length) {
        return { ok: false, error: 'No scheduled dates are available to print.' };
      }
      const scheduleFromRaw = String(formState.scheduleFrom || '').trim();
      const scheduleToRaw = String(formState.scheduleTo || '').trim();
      let from = getDayStart(scheduleFromRaw);
      let to = getDayStart(scheduleToRaw);

      // Be resilient to stale form values if option list changes while modal is open.
      if ((!from || !to) && schedulePrintOptions.length) {
        const fallbackFromValue = String(schedulePrintOptions[0]?.value || '');
        const fallbackToValue = String(schedulePrintOptions[Math.max(0, schedulePrintOptions.length - 1)]?.value || fallbackFromValue);
        if (!from) from = getDayStart(fallbackFromValue);
        if (!to) to = getDayStart(fallbackToValue);
      }

      if (!from || !to) return { ok: false, error: 'Please select valid schedule date range for printing.' };
      if (to.getTime() < from.getTime()) return { ok: false, error: '"To day" must be on or after "From day".' };

      let daySections = [];
      for (let day = new Date(from); day.getTime() <= to.getTime(); day = addDays(day, 1)) {
        if (!showWeekends && (day.getDay() === 0 || day.getDay() === 6)) continue;
        const dayEvents = getEventsForDay(day);
        if (!dayEvents.length) continue;
        daySections.push({
          dayDate: new Date(day),
          events: dayEvents,
          eventsCount: dayEvents.length,
          contentHtml: showEvents
            ? renderEventListRows(dayEvents)
            : '<div class="print-empty">Event details hidden (Show events is turned off).</div>'
        });
      }

      // Fallback: if daily overlap pass produced nothing but range has events,
      // group by event start day so scheduled rows still render.
      if (!daySections.length) {
        const rangeStartMs = from.getTime();
        const rangeEndMs = addDays(to, 1).getTime();
        const rangeEvents = getEventsForRange(rangeStartMs, rangeEndMs)
          .sort((a, b) => (a.startMs - b.startMs) || String(a.title || '').localeCompare(String(b.title || '')));

        if (rangeEvents.length) {
          const groupedByDay = new Map();
          rangeEvents.forEach((evt) => {
            const evtDay = new Date(evt.start.getFullYear(), evt.start.getMonth(), evt.start.getDate());
            if (evtDay.getTime() < rangeStartMs || evtDay.getTime() >= rangeEndMs) return;
            if (!showWeekends && (evtDay.getDay() === 0 || evtDay.getDay() === 6)) return;
            const key = toInputDateValue(evtDay);
            const list = groupedByDay.get(key) || [];
            list.push(evt);
            groupedByDay.set(key, list);
          });

          daySections = Array.from(groupedByDay.entries())
            .sort(([a], [b]) => String(a).localeCompare(String(b)))
            .map(([dateKey, events]) => {
              const dayDate = getDayStart(dateKey);
              if (!dayDate) return null;
              return {
                dayDate,
                events,
                eventsCount: events.length,
                contentHtml: showEvents
                  ? renderEventListRows(events)
                  : '<div class="print-empty">Event details hidden (Show events is turned off).</div>'
              };
            })
            .filter((entry) => Boolean(entry?.dayDate));
        }
      }

      if (!daySections.length) {
        pages.push(`<section class="print-page">
          <header class="print-header">
            <h1>${escapeHtml(`${formatDayTitle(from)} - ${formatDayTitle(to)}`)}</h1>
          </header>
          <div class="print-grid-area">
            <div class="print-empty">No events in the selected schedule range.</div>
          </div>
        </section>`);
      } else {
        // Keep schedule rows sequential across pages, but never split a date row between pages.
        const fontScale = Math.max(0.75, baseFontSizePx / 12);
        const scaleY = Math.max(0.5, gridScaleY);
        // Keep this intentionally conservative so rows at page bottom are moved to next page
        // instead of being clipped in final print/PDF output.
        const pageBudgetPx = Math.max(320, Math.floor(780 / scaleY));
        const estimateSectionHeight = (section) => {
          if (!showEvents) return Math.round(112 * fontScale);
          const events = Array.isArray(section?.events) ? section.events : [];
          if (!events.length) return Math.round(118 * fontScale);

          const headingBlock = 86 * fontScale; // day title + spacing
          const tableHead = 44 * fontScale; // "Time / Event / Type" header row
          const rowBase = 34 * fontScale;
          const wrappedLineExtra = 14 * fontScale;
          const bottomPadding = 24 * fontScale;

          const rowsHeight = events.reduce((sum, evt) => {
            const titleLen = String(evt?.title || '').trim().length;
            const timeLen = String(formatEventTime(evt) || '').trim().length;
            const typeLen = String(labelByType[evt?.type] || 'EVENT').length;
            const estimatedLines = Math.max(
              1,
              Math.ceil((titleLen + Math.min(16, timeLen) + typeLen) / 30)
            );
            return sum + rowBase + Math.max(0, estimatedLines - 1) * wrappedLineExtra;
          }, 0);

          return Math.round(headingBlock + tableHead + rowsHeight + bottomPadding);
        };

        const groups = [];
        let currentGroup = [];
        let currentHeight = 0;
        daySections.forEach((section) => {
          const nextHeight = estimateSectionHeight(section);
          if (currentGroup.length && (currentHeight + nextHeight) > pageBudgetPx) {
            groups.push(currentGroup);
            currentGroup = [section];
            currentHeight = nextHeight;
            return;
          }
          currentGroup.push(section);
          currentHeight += nextHeight;
        });
        if (currentGroup.length) groups.push(currentGroup);

        groups.forEach((group) => {
          const groupStart = group[0]?.dayDate;
          const groupEnd = group[group.length - 1]?.dayDate || groupStart;
          const pageRangeTitle = (groupStart && groupEnd)
            ? (groupStart.getTime() === groupEnd.getTime()
              ? formatDayTitle(groupStart)
              : `${formatDayTitle(groupStart)} - ${formatDayTitle(groupEnd)}`)
            : `${formatDayTitle(from)} - ${formatDayTitle(to)}`;
          const pageBody = group.map((section) => {
            const dayTitle = formatDayTitle(section.dayDate);
            return `<section class="print-schedule-day">
              <h3>${escapeHtml(dayTitle)}</h3>
              ${section.contentHtml}
            </section>`;
          }).join('');

          pages.push(`<section class="print-page">
            <header class="print-header">
              <h1>${escapeHtml(pageRangeTitle)}</h1>
            </header>
            <div class="print-grid-area">
              ${pageBody}
            </div>
          </section>`);
        });
      }
    }

    if (!pages.length) {
      return { ok: false, error: 'No printable pages generated for the selected range.' };
    }

    const weekColumnCount = showWeekends ? 7 : 5;

    const style = `
      @page { size: auto; margin: 11mm; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; background: #ffffff; color: #202124; font-family: "Google Sans", Roboto, Arial, sans-serif; }
      .print-root { 
        padding: 0;
        --print-base-font-size: ${baseFontSizePx}px;
        --print-grid-scale: ${gridScale};
        --print-grid-scale-x: ${gridScaleX};
        --print-grid-scale-y: ${gridScaleY};
        --print-week-cols: ${weekColumnCount};
      }
      .print-page { page-break-after: always; break-after: page; padding: 4mm 1mm; display: flex; flex-direction: column; min-height: 100%; }
      .print-page:last-child { page-break-after: auto; break-after: auto; }
      .print-header { display: flex; align-items: flex-end; justify-content: space-between; border-bottom: 1px solid #dadce0; margin-bottom: 10px; padding-bottom: 6px; }
      .print-header h1 { margin: 0; font-size: calc(var(--print-base-font-size) * 2); font-weight: 700; color: #202124; line-height: 1.15; }
      .print-header.print-header-month h1 { color: #d93025; }
      .print-grid-area {
        flex: 1 1 auto;
        min-height: 0;
        display: flex;
        flex-direction: column;
        width: calc(100% / var(--print-grid-scale-x));
        transform-origin: top left;
        transform: scale(var(--print-grid-scale-x), var(--print-grid-scale-y));
      }
      .print-empty { border: 1px solid #dadce0; border-radius: 8px; padding: 14px; font-size: calc(var(--print-base-font-size) * 1.08); color: #5f6368; }
      .print-table { width: 100%; border-collapse: collapse; table-layout: fixed; flex: 1 1 auto; }
      .print-table th, .print-table td { border: 1px solid #dadce0; padding: 8px 10px; vertical-align: top; font-size: calc(var(--print-base-font-size) * 1); }
      .print-table th { background: #f8f9fa; text-align: left; font-weight: 600; font-size: calc(var(--print-base-font-size) * 1); color: #3c4043; }
      .print-table td:first-child, .print-table th:first-child { width: 132px; }
      .print-table td:last-child, .print-table th:last-child { width: 98px; }
      .print-event-title-wrap { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
      .print-dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; flex: 0 0 auto; }
      .print-chip { display: inline-flex; align-items: center; justify-content: center; padding: 2px 8px; border-radius: 999px; font-size: calc(var(--print-base-font-size) * 0.85); font-weight: 700; letter-spacing: 0.02em; }
      .print-chip.notice { background: #e8f0fe; color: #174ea6; }
      .print-chip.alert { background: #fce8e6; color: #a50e0e; }
      .print-chip.festival { background: #e6f4ea; color: #137333; }
      .print-chip.task { background: #f3e8fd; color: #6a1b9a; }
      .print-week-grid { display: grid; grid-template-columns: repeat(var(--print-week-cols), minmax(0, 1fr)); border: 1px solid #dadce0; border-right: none; border-bottom: none; flex: 1 1 auto; }
      .print-week-cell { min-height: 148px; border-right: 1px solid #dadce0; border-bottom: 1px solid #dadce0; padding: 6px; height: auto; overflow: visible; break-inside: avoid; }
      .print-week-cell h3 { margin: 0 0 6px; font-size: calc(var(--print-base-font-size) * 0.92); color: #3c4043; font-weight: 700; }
      .print-week-cell ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
      .print-week-cell li { display: flex; align-items: center; gap: 6px; font-size: calc(var(--print-base-font-size) * 0.9); line-height: 1.25; }
      .print-empty-inline { font-size: calc(var(--print-base-font-size) * 0.82); color: #8a9098; }
      .print-month-table { width: 100%; border-collapse: collapse; table-layout: fixed; flex: 1 1 auto; height: 100%; }
      .print-month-head { border: 1px solid #dadce0; background: #f8f9fa; font-size: calc(var(--print-base-font-size) * 0.9); font-weight: 700; color: #3c4043; text-align: center; padding: 6px 2px; }
      .print-month-cell { border: 1px solid #dadce0; min-height: 90px; padding: 4px; height: auto; vertical-align: top; break-inside: avoid; }
      .print-month-cell.is-outside { background: #fafafa; color: #9aa0a6; }
      .print-month-date { font-size: calc(var(--print-base-font-size) * 0.9); font-weight: 700; margin-bottom: 4px; }
      .print-month-event { display: flex; align-items: flex-start; gap: 5px; font-size: calc(var(--print-base-font-size) * 0.8); line-height: 1.25; margin-bottom: 3px; }
      .print-month-event span:last-child { white-space: normal; word-break: break-word; }
      .print-more-line { font-size: calc(var(--print-base-font-size) * 0.75); color: #5f6368; font-weight: 600; margin-top: 2px; }
      .print-year-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px 16px; }
      .print-year-month { border: 1px solid #dadce0; border-radius: 8px; padding: 8px; }
      .print-year-month h3 { margin: 0 0 8px; font-size: calc(var(--print-base-font-size) * 1.05); font-weight: 700; }
      .print-year-weekdays, .print-year-days { display: grid; grid-template-columns: repeat(var(--print-week-cols), minmax(0, 1fr)); gap: 4px; }
      .print-year-weekdays span { font-size: calc(var(--print-base-font-size) * 0.75); color: #70757a; text-align: center; font-weight: 600; }
      .print-year-day { font-size: calc(var(--print-base-font-size) * 0.75); text-align: center; min-height: 16px; line-height: 16px; border-radius: 999px; color: #202124; }
      .print-year-day.is-outside { color: #b0b5bb; }
      .print-year-day.has-events { background: #e8f0fe; color: #174ea6; font-weight: 700; }
      .print-schedule-day { margin-bottom: 14px; break-inside: avoid-page; page-break-inside: avoid; }
      .print-schedule-day h3 { margin: 0 0 8px; font-size: calc(var(--print-base-font-size) * 1.08); font-weight: 700; color: #202124; }
      @media print {
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      }
    `;

    const documentTitle = `Calendar Print - ${PRINT_VIEW_LABELS[view] || 'View'}`;
    const html = `<!doctype html>
      <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${escapeHtml(documentTitle)}</title>
        <style>${style}</style>
      </head>
      <body>
        <div class="print-root">${pages.join('')}</div>
      </body>
      </html>`;
    return { ok: true, html, title: documentTitle, orientationMode };
  }, [printableEvents, schedulePrintOptions]);

  const exportPrintDocumentAsPdf = useCallback(async (builtDocument, exportSettings = {}) => {
    const html = String(builtDocument?.html || '').trim();
    if (!html) throw new Error('print-html-missing');

    const parser = new DOMParser();
    const parsedDoc = parser.parseFromString(html, 'text/html');
    const rootNode = parsedDoc.querySelector('.print-root');
    if (!rootNode) throw new Error('print-root-missing');

    const styleText = Array.from(parsedDoc.querySelectorAll('style'))
      .map((node) => String(node.textContent || ''))
      .join('\n');

    const renderHost = document.createElement('div');
    renderHost.className = 'gcal-pdf-export-host';
    renderHost.style.position = 'fixed';
    renderHost.style.left = '-200000px';
    renderHost.style.top = '0';
    renderHost.style.pointerEvents = 'none';
    renderHost.style.opacity = '0';
    renderHost.style.zIndex = '-1';
    renderHost.style.background = '#ffffff';
    renderHost.style.width = `${Math.max(1080, Math.min(2200, window.innerWidth || 1440))}px`;
    renderHost.innerHTML = `<style>${styleText}
      .print-page { page-break-after: auto !important; break-after: auto !important; }
    </style>${rootNode.outerHTML}`;
    document.body.appendChild(renderHost);

    try {
      await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));

      const pageNodes = Array.from(renderHost.querySelectorAll('.print-page'))
        .filter((node) => node instanceof HTMLElement);
      if (!pageNodes.length) throw new Error('print-pages-missing');

      let pdfDoc = null;

      const orientationSetting = String(exportSettings?.orientation || builtDocument?.orientationMode || 'auto').toLowerCase();
      const pagePrefs = exportSettings?.pagePrefs || {};

      for (let idx = 0; idx < pageNodes.length; idx += 1) {
        const pageEl = pageNodes[idx];
        const pref = pagePrefs?.[idx] || pagePrefs?.[String(idx)] || {};
        const prefWidthMm = Number(pref?.widthMm);
        const prefHeightMm = Number(pref?.heightMm);
        const bounds = pageEl.getBoundingClientRect();
        const naturalWidthPx = Math.max(1, Math.ceil(Math.max(bounds.width, pageEl.scrollWidth, pageEl.offsetWidth)));
        const naturalHeightPx = Math.max(1, Math.ceil(Math.max(bounds.height, pageEl.scrollHeight, pageEl.offsetHeight)));

        let pageWidthPt = Number.isFinite(prefWidthMm) && prefWidthMm > 0
          ? mmToPt(prefWidthMm)
          : (naturalWidthPx * PX_TO_PT);
        let pageHeightPt = Number.isFinite(prefHeightMm) && prefHeightMm > 0
          ? mmToPt(prefHeightMm)
          : (naturalHeightPx * PX_TO_PT);

        pageWidthPt = Math.max(72, Math.min(MAX_PDF_PAGE_SIDE_PT, pageWidthPt));
        pageHeightPt = Math.max(72, Math.min(MAX_PDF_PAGE_SIDE_PT, pageHeightPt));

        const targetWidthPx = Math.max(1, Math.round(pageWidthPt / PX_TO_PT));
        const targetHeightPx = Math.max(1, Math.round(pageHeightPt / PX_TO_PT));
        const prevInlineWidth = pageEl.style.width;
        const prevInlineHeight = pageEl.style.height;
        const prevInlineOverflow = pageEl.style.overflow;
        pageEl.style.width = `${targetWidthPx}px`;
        pageEl.style.height = `${targetHeightPx}px`;
        pageEl.style.overflow = 'hidden';

        let canvas;
        try {
          await new Promise((resolve) => window.requestAnimationFrame(resolve));
          canvas = await html2canvas(pageEl, {
            backgroundColor: '#ffffff',
            scale: 2,
            useCORS: true,
            logging: false,
            width: targetWidthPx,
            height: targetHeightPx,
            scrollX: 0,
            scrollY: 0,
            windowWidth: Math.max(renderHost.scrollWidth, targetWidthPx),
            windowHeight: Math.max(renderHost.scrollHeight, targetHeightPx)
          });
        } finally {
          pageEl.style.width = prevInlineWidth;
          pageEl.style.height = prevInlineHeight;
          pageEl.style.overflow = prevInlineOverflow;
        }

        const orientation = orientationSetting === 'auto'
          ? (pageWidthPt >= pageHeightPt ? 'landscape' : 'portrait')
          : (orientationSetting === 'landscape' ? 'landscape' : 'portrait');
        const imageData = canvas.toDataURL('image/png');

        if (!pdfDoc) {
          pdfDoc = new jsPDF({
            orientation,
            unit: 'pt',
            format: [pageWidthPt, pageHeightPt],
            compress: true
          });
        } else {
          pdfDoc.addPage([pageWidthPt, pageHeightPt], orientation);
        }

        pdfDoc.addImage(imageData, 'PNG', 0, 0, pageWidthPt, pageHeightPt, undefined, 'FAST');
      }

      if (!pdfDoc) throw new Error('pdf-generation-failed');

      const rawTitle = String(builtDocument?.title || 'Calendar Print').trim();
      const safeTitle = rawTitle
        .replace(/[\\/:*?"<>|]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() || 'Calendar Print';

      pdfDoc.save(`${safeTitle}.pdf`);
    } finally {
      if (renderHost.parentNode) {
        renderHost.parentNode.removeChild(renderHost);
      }
    }
  }, []);

  const closePrintModal = useCallback(() => {
    if (printSubmitting) return;
    setPrintModalOpen(false);
    setPrintMonthPickerField('');
    setPrintError('');
    setPrintPreviewFullscreen(false);
    setPrintPageInputDrafts({});
    setSettingsDropdownOpen(false);
  }, [printSubmitting]);

  const openPrintDialog = () => {
    const api = calendarRef.current?.getApi();
    const activeView = String(api?.view?.type || viewType || 'dayGridMonth');
    const preferredView = PRINT_VIEW_BY_CAL_VIEW[activeView] || 'month';
    const apiDate = api?.getDate?.();
    const anchorDate = (apiDate instanceof Date && !Number.isNaN(apiDate.getTime()))
      ? apiDate
      : (viewRange?.start instanceof Date && !Number.isNaN(viewRange.start.getTime()) ? viewRange.start : new Date());
    const nextForm = createDefaultPrintForm(anchorDate, preferredView);

    if (viewRange?.start instanceof Date && !Number.isNaN(viewRange.start.getTime())) {
      const startVal = toInputDateValue(viewRange.start);
      if (startVal) nextForm.scheduleFrom = startVal;
    }
    if (viewRange?.end instanceof Date && !Number.isNaN(viewRange.end.getTime())) {
      const inclusiveEnd = new Date(viewRange.end);
      inclusiveEnd.setDate(inclusiveEnd.getDate() - 1);
      const endVal = toInputDateValue(inclusiveEnd);
      if (endVal) nextForm.scheduleTo = endVal;
    }

    nextForm.monthFrom = ensureOptionValue(nextForm.monthFrom, monthPrintOptions, monthPrintOptions[0]?.value || '');
    nextForm.monthTo = ensureOptionValue(nextForm.monthTo, monthPrintOptions, nextForm.monthFrom);
    nextForm.weekFrom = ensureOptionValue(nextForm.weekFrom, weekPrintOptions, weekPrintOptions[0]?.value || '');
    nextForm.weekTo = ensureOptionValue(nextForm.weekTo, weekPrintOptions, nextForm.weekFrom);
    nextForm.weekFromDate = nextForm.weekFromDate || weekFieldToDateInputValue(nextForm.weekFrom);
    nextForm.weekToDate = nextForm.weekToDate || weekFieldToDateInputValue(nextForm.weekTo);
    if (nextForm.weekToDate && nextForm.weekFromDate && nextForm.weekToDate < nextForm.weekFromDate) {
      nextForm.weekToDate = nextForm.weekFromDate;
    }

    if (schedulePrintOptions.length) {
      nextForm.scheduleFrom = ensureOptionValue(nextForm.scheduleFrom, schedulePrintOptions, schedulePrintOptions[0]?.value || '');
      nextForm.scheduleTo = ensureOptionValue(
        nextForm.scheduleTo,
        schedulePrintOptions,
        schedulePrintOptions[Math.max(0, schedulePrintOptions.length - 1)]?.value || nextForm.scheduleFrom
      );
      if (nextForm.scheduleTo < nextForm.scheduleFrom) {
        nextForm.scheduleTo = nextForm.scheduleFrom;
      }
    } else {
      nextForm.scheduleFrom = '';
      nextForm.scheduleTo = '';
    }

    setSettingsDropdownOpen(false);
    setPrintError('');
    setPrintMonthPickerField('');
    setPrintPagePrefs({});
    setPrintPageInputDrafts({});
    setPrintPreviewFullscreen(false);
    setPrintForm(nextForm);
    setPrintModalOpen(true);
  };

  const handlePrintFormChange = (field, value) => {
    setPrintForm((prev) => {
      const next = { ...prev, [field]: value };

      if (field === 'weekFrom' && next.weekTo && next.weekTo < next.weekFrom) {
        next.weekTo = next.weekFrom;
      }
      if (field === 'weekTo' && next.weekFrom && next.weekTo < next.weekFrom) {
        next.weekFrom = next.weekTo;
      }
      if (field === 'weekFrom') {
        const nextWeekDate = weekFieldToDateInputValue(next.weekFrom);
        if (nextWeekDate) next.weekFromDate = nextWeekDate;
      }
      if (field === 'weekTo') {
        const nextWeekDate = weekFieldToDateInputValue(next.weekTo);
        if (nextWeekDate) next.weekToDate = nextWeekDate;
      }
      if (field === 'weekFromDate') {
        const normalized = toInputDateValue(`${String(value || '').trim()}T00:00:00`);
        next.weekFromDate = normalized || '';
        if (normalized) {
          const syncedWeek = toIsoWeekInputValue(`${normalized}T00:00:00`);
          if (syncedWeek) next.weekFrom = syncedWeek;
        }
      }
      if (field === 'weekToDate') {
        const normalized = toInputDateValue(`${String(value || '').trim()}T00:00:00`);
        next.weekToDate = normalized || '';
        if (normalized) {
          const syncedWeek = toIsoWeekInputValue(`${normalized}T00:00:00`);
          if (syncedWeek) next.weekTo = syncedWeek;
        }
      }
      if (next.weekFromDate && next.weekToDate && next.weekToDate < next.weekFromDate) {
        if (field === 'weekFrom' || field === 'weekFromDate') {
          next.weekToDate = next.weekFromDate;
          next.weekTo = next.weekFrom;
        } else if (field === 'weekTo' || field === 'weekToDate') {
          next.weekFromDate = next.weekToDate;
          next.weekFrom = next.weekTo;
        }
      }
      if (field === 'scheduleFrom' && next.scheduleTo && next.scheduleTo < next.scheduleFrom) {
        next.scheduleTo = next.scheduleFrom;
      }
      if (field === 'scheduleTo' && next.scheduleFrom && next.scheduleTo < next.scheduleFrom) {
        next.scheduleFrom = next.scheduleTo;
      }
      return next;
    });
    if (printError) setPrintError('');
  };

  const weekFieldToDateInputValue = (weekValue) => {
    const weekStart = fromIsoWeekInputValue(weekValue);
    if (!(weekStart instanceof Date) || Number.isNaN(weekStart.getTime())) return '';
    return toInputDateValue(weekStart);
  };

  const handlePrintWeekDateChange = (field, rawValue) => {
    const normalizedDate = String(rawValue || '').trim();
    if (!normalizedDate) {
      handlePrintFormChange(field, '');
      return;
    }
    const parsed = toDateOrNull(`${normalizedDate}T00:00:00`);
    if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) return;
    const normalized = toInputDateValue(parsed);
    if (!normalized) return;
    handlePrintFormChange(field, normalized);
  };

  const handlePrintMonthBlur = (field, rawValue) => {
    const normalized = normalizeMonthInputValue(rawValue);
    if (normalized !== rawValue) {
      handlePrintFormChange(field, normalized);
    }
  };

  const togglePrintMonthPickerField = (field) => {
    setPrintMonthPickerField((prev) => (prev === field ? '' : field));
  };

  const selectPrintMonthOption = (field, value) => {
    handlePrintFormChange(field, value);
    setPrintMonthPickerField('');
  };

  useEffect(() => {
    if (!printModalOpen) return;
    if (!schedulePrintOptions.length) {
      setPrintForm((prev) => {
        if (!prev.scheduleFrom && !prev.scheduleTo) return prev;
        return { ...prev, scheduleFrom: '', scheduleTo: '' };
      });
      return;
    }

    setPrintForm((prev) => {
      const nextFrom = ensureOptionValue(prev.scheduleFrom, schedulePrintOptions, schedulePrintOptions[0]?.value || '');
      let nextTo = ensureOptionValue(
        prev.scheduleTo,
        schedulePrintOptions,
        schedulePrintOptions[Math.max(0, schedulePrintOptions.length - 1)]?.value || nextFrom
      );
      if (nextTo < nextFrom) nextTo = nextFrom;
      if (nextFrom === prev.scheduleFrom && nextTo === prev.scheduleTo) return prev;
      return { ...prev, scheduleFrom: nextFrom, scheduleTo: nextTo };
    });
  }, [printModalOpen, schedulePrintOptions]);

  useEffect(() => {
    if (!printModalOpen || !printMonthPickerField) return;
    const handlePointerDown = (event) => {
      const target = event?.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.gcal-print-month-picker-host')) return;
      setPrintMonthPickerField('');
    };
    const handleEsc = (event) => {
      if (event?.key === 'Escape') setPrintMonthPickerField('');
    };
    document.addEventListener('mousedown', handlePointerDown, true);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown, true);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [printModalOpen, printMonthPickerField]);

  const printPreviewData = useMemo(() => {
    if (!printModalOpen) {
      return { ok: false, pages: [], styleText: '', built: null, error: '' };
    }
    const built = buildPrintDocument(printForm, printOptions);
    if (!built?.ok) {
      return {
        ok: false,
        pages: [],
        styleText: '',
        built: null,
        error: String(built?.error || 'Unable to generate print preview.')
      };
    }
    const parser = new DOMParser();
    const parsed = parser.parseFromString(String(built.html || ''), 'text/html');
    const styleText = Array.from(parsed.querySelectorAll('style'))
      .map((node) => String(node.textContent || ''))
      .join('\n');
    const pages = Array.from(parsed.querySelectorAll('.print-page'))
      .map((node) => node.outerHTML)
      .filter(Boolean);

    return {
      ok: true,
      pages,
      styleText,
      built,
      error: ''
    };
  }, [buildPrintDocument, printForm, printModalOpen, printOptions]);

  useEffect(() => {
    if (!printModalOpen || !printPreviewData.ok) return;
    const defaultDims = defaultPrintPageDimensionsMm(printOptions.orientation);
    setPrintPagePrefs((prev) => {
      const next = {};
      let changed = false;

      for (let idx = 0; idx < printPreviewData.pages.length; idx += 1) {
        const existing = prev?.[idx] || prev?.[String(idx)] || {};
        const widthMm = clamp(Number(existing?.widthMm) || defaultDims.widthMm, PRINT_PAGE_MM_MIN, PRINT_PAGE_MM_MAX);
        const heightMm = clamp(Number(existing?.heightMm) || defaultDims.heightMm, PRINT_PAGE_MM_MIN, PRINT_PAGE_MM_MAX);
        next[idx] = { widthMm, heightMm };
      }

      const prevKeys = Object.keys(prev || {});
      const nextKeys = Object.keys(next);
      if (prevKeys.length !== nextKeys.length) changed = true;
      if (!changed) {
        for (const key of nextKeys) {
          const prevWidth = Number(prev?.[key]?.widthMm);
          const prevHeight = Number(prev?.[key]?.heightMm);
          if (Math.abs(prevWidth - next[key].widthMm) > 0.01 || Math.abs(prevHeight - next[key].heightMm) > 0.01) {
            changed = true;
            break;
          }
        }
      }

      return changed ? next : prev;
    });
  }, [printModalOpen, printPreviewData, printOptions.orientation]);

  useEffect(() => {
    if (!printModalOpen) {
      setPrintPageInputDrafts({});
      return;
    }
    setPrintPageInputDrafts((prev) => {
      const validIndexes = new Set(
        Array.from({ length: printPreviewData.pages.length }, (_, idx) => String(idx))
      );
      const next = {};
      let changed = false;
      Object.entries(prev || {}).forEach(([idxKey, fields]) => {
        if (!validIndexes.has(String(idxKey))) {
          changed = true;
          return;
        }
        next[idxKey] = { ...(fields || {}) };
      });
      if (!changed && Object.keys(next).length === Object.keys(prev || {}).length) return prev;
      return next;
    });
  }, [printModalOpen, printPreviewData.pages.length]);

  const handlePrintOptionChange = useCallback((field, value) => {
    setPrintOptions((prev) => {
      const next = { ...prev, [field]: value };
      if (field === 'fontSize') {
        const n = Number(value);
        next.fontSize = clamp(Number.isFinite(n) ? n : prev.fontSize, 8, 24);
      }
      if (field === 'gridScale') {
        const n = Number(value);
        const safe = clamp(Number.isFinite(n) ? n : prev.gridScale, 60, 200);
        next.gridScale = safe;
        next.gridScaleX = safe;
        next.gridScaleY = safe;
      }
      if (field === 'orientation') {
        const orientation = String(value || 'auto').toLowerCase();
        next.orientation = PRINT_ORIENTATION_OPTIONS[orientation] ? orientation : 'auto';
      }
      return next;
    });
    if (printError) setPrintError('');
  }, [printError]);

  const handlePrintOptionToggle = useCallback((field) => {
    setPrintOptions((prev) => ({ ...prev, [field]: !Boolean(prev?.[field]) }));
    if (printError) setPrintError('');
  }, [printError]);

  const applyPrintPagePrefValue = useCallback((index, field, value) => {
    const parsedValue = Number(value);
    if (!Number.isFinite(parsedValue)) return;
    const safeValue = clamp(parsedValue, PRINT_PAGE_MM_MIN, PRINT_PAGE_MM_MAX);
    setPrintPagePrefs((prev) => {
      const current = prev?.[index] || defaultPrintPageDimensionsMm(printOptions.orientation);
      const prevValue = Number(current?.[field]);
      if (Math.abs(prevValue - safeValue) < 0.01) return prev;
      return {
        ...prev,
        [index]: {
          ...current,
          [field]: safeValue
        }
      };
    });
  }, [printOptions.orientation]);

  const handlePrintPageSizeInput = useCallback((index, field, rawValue) => {
    const nextRaw = String(rawValue ?? '');
    setPrintPageInputDrafts((prev) => ({
      ...prev,
      [index]: {
        ...(prev?.[index] || {}),
        [field]: nextRaw
      }
    }));

    const parsedValue = Number(nextRaw);
    if (!Number.isFinite(parsedValue)) return;
    if (parsedValue < PRINT_PAGE_MM_MIN || parsedValue > PRINT_PAGE_MM_MAX) return;
    applyPrintPagePrefValue(index, field, parsedValue);
    if (printError === PRINT_PAGE_SIZE_ERROR_MESSAGE) {
      setPrintError('');
    }
  }, [applyPrintPagePrefValue, printError]);

  const commitPrintPageSizeInput = useCallback((index, field) => {
    const raw = String(printPageInputDrafts?.[index]?.[field] ?? '').trim();
    if (!raw) return;
    const parsedValue = Number(raw);
    if (!Number.isFinite(parsedValue) || parsedValue < PRINT_PAGE_MM_MIN || parsedValue > PRINT_PAGE_MM_MAX) {
      setPrintPageInputDrafts((prev) => ({
        ...prev,
        [index]: {
          ...(prev?.[index] || {}),
          [field]: ''
        }
      }));
      setPrintError(PRINT_PAGE_SIZE_ERROR_MESSAGE);
      return;
    }
    const rounded = Math.round(parsedValue);
    applyPrintPagePrefValue(index, field, rounded);
    setPrintPageInputDrafts((prev) => ({
      ...prev,
      [index]: {
        ...(prev?.[index] || {}),
        [field]: String(rounded)
      }
    }));
    if (printError === PRINT_PAGE_SIZE_ERROR_MESSAGE) {
      setPrintError('');
    }
  }, [applyPrintPagePrefValue, printError, printPageInputDrafts]);

  const getPrintPageInputValue = useCallback((index, field, fallback) => {
    const draft = printPageInputDrafts?.[index]?.[field];
    if (typeof draft === 'string') return draft;
    return String(Math.round(Number(fallback) || 0));
  }, [printPageInputDrafts]);

  const syncPrintPreviewSizeFromDom = useCallback((index) => {
    const target = printPreviewPageRefs.current?.[index];
    if (!(target instanceof HTMLElement)) return;
    const widthMm = clamp(pxToMm(target.offsetWidth), PRINT_PAGE_MM_MIN, PRINT_PAGE_MM_MAX);
    const heightMm = clamp(pxToMm(target.offsetHeight), PRINT_PAGE_MM_MIN, PRINT_PAGE_MM_MAX);
    setPrintPagePrefs((prev) => {
      const current = prev?.[index] || {};
      const currentWidth = Number(current?.widthMm);
      const currentHeight = Number(current?.heightMm);
      if (Math.abs(currentWidth - widthMm) < 0.2 && Math.abs(currentHeight - heightMm) < 0.2) {
        return prev;
      }
      return {
        ...prev,
        [index]: { ...current, widthMm, heightMm }
      };
    });
    setPrintPageInputDrafts((prev) => ({
      ...prev,
      [index]: {
        ...(prev?.[index] || {}),
        widthMm: String(Math.round(widthMm)),
        heightMm: String(Math.round(heightMm))
      }
    }));
    if (printError === PRINT_PAGE_SIZE_ERROR_MESSAGE) {
      setPrintError('');
    }
  }, [printError]);

  const measurePrintGridBoundsForPage = useCallback((index) => {
    const frame = printPreviewFrameRefs.current?.[index];
    const shell = printPreviewPageRefs.current?.[index];
    if (!(frame instanceof HTMLIFrameElement) || !(shell instanceof HTMLElement)) return;
    const frameDoc = frame.contentDocument;
    if (!frameDoc) return;
    const frameBody = frameDoc.body;
    const gridNode = frameDoc.querySelector('.print-grid-area');
    if (!(frameBody instanceof HTMLElement) || !(gridNode instanceof HTMLElement)) return;

    const bodyRect = frameBody.getBoundingClientRect();
    const gridRect = gridNode.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    if (bodyRect.width <= 0 || bodyRect.height <= 0 || frameRect.width <= 0 || frameRect.height <= 0) return;

    const scaleX = frameRect.width / bodyRect.width;
    const scaleY = frameRect.height / bodyRect.height;
    const left = Math.max(0, (gridRect.left - bodyRect.left) * scaleX);
    const top = Math.max(0, (gridRect.top - bodyRect.top) * scaleY);
    const width = Math.max(0, gridRect.width * scaleX);
    const height = Math.max(0, gridRect.height * scaleY);
    if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(width) || !Number.isFinite(height)) return;

    setPrintGridBoundsByPage((prev) => {
      const current = prev?.[index];
      if (
        current &&
        Math.abs((current.left || 0) - left) < 0.5 &&
        Math.abs((current.top || 0) - top) < 0.5 &&
        Math.abs((current.width || 0) - width) < 0.5 &&
        Math.abs((current.height || 0) - height) < 0.5
      ) {
        return prev;
      }
      return {
        ...(prev || {}),
        [index]: { left, top, width, height }
      };
    });
  }, []);

  useEffect(() => {
    if (!printModalOpen || !printPreviewData.ok) return undefined;
    const raf = window.requestAnimationFrame(() => {
      for (let idx = 0; idx < printPreviewData.pages.length; idx += 1) {
        measurePrintGridBoundsForPage(idx);
      }
    });
    return () => window.cancelAnimationFrame(raf);
  }, [
    measurePrintGridBoundsForPage,
    printModalOpen,
    printPreviewData.ok,
    printPreviewData.pages.length,
    printPreviewFullscreen,
    printPagePrefs,
    printOptions.gridScale,
    printOptions.gridScaleX,
    printOptions.gridScaleY
  ]);

  useEffect(() => {
    if (printModalOpen) return;
    if (typeof printPageDragCleanupRef.current === 'function') {
      printPageDragCleanupRef.current();
      printPageDragCleanupRef.current = null;
    }
    if (typeof printGridDragCleanupRef.current === 'function') {
      printGridDragCleanupRef.current();
      printGridDragCleanupRef.current = null;
    }
  }, [printModalOpen]);

  const togglePrintPreviewFullscreen = useCallback(() => {
    setPrintPreviewFullscreen((prev) => {
      const next = !prev;
      if (next) {
        const viewportWidthMm = clamp(pxToMm((window.innerWidth || 1280) - 24), PRINT_PAGE_MM_MIN, PRINT_PAGE_MM_MAX);
        const viewportHeightMm = clamp(pxToMm((window.innerHeight || 720) - 24), PRINT_PAGE_MM_MIN, PRINT_PAGE_MM_MAX);
        setPrintPagePrefs((current) => {
          const updated = { ...(current || {}) };
          for (let idx = 0; idx < printPreviewData.pages.length; idx += 1) {
            updated[idx] = {
              ...(updated[idx] || defaultPrintPageDimensionsMm(printOptions.orientation)),
              widthMm: viewportWidthMm,
              heightMm: viewportHeightMm
            };
          }
          return updated;
        });
        setPrintPageInputDrafts((current) => {
          const updated = { ...(current || {}) };
          for (let idx = 0; idx < printPreviewData.pages.length; idx += 1) {
            updated[idx] = {
              ...(updated[idx] || {}),
              widthMm: String(Math.round(viewportWidthMm)),
              heightMm: String(Math.round(viewportHeightMm))
            };
          }
          return updated;
        });
      }
      return next;
    });
  }, [printOptions.orientation, printPreviewData.pages.length]);

  const applyPrintPreviewAutoFit = useCallback(() => {
    const viewportWidthMm = clamp(pxToMm((window.innerWidth || 1280) - 24), PRINT_PAGE_MM_MIN, PRINT_PAGE_MM_MAX);
    const viewportHeightMm = clamp(pxToMm((window.innerHeight || 720) - 24), PRINT_PAGE_MM_MIN, PRINT_PAGE_MM_MAX);
    const targetScale = 100;
    const targetFont = 12;

    if (!printPreviewFullscreen) {
      setPrintPreviewFullscreen(true);
    }

    setPrintOptions((prev) => ({
      ...prev,
      fontSize: targetFont,
      gridScale: targetScale,
      gridScaleX: targetScale,
      gridScaleY: targetScale
    }));

    setPrintPagePrefs((current) => {
      const updated = { ...(current || {}) };
      for (let idx = 0; idx < printPreviewData.pages.length; idx += 1) {
        updated[idx] = {
          ...(updated[idx] || defaultPrintPageDimensionsMm(printOptions.orientation)),
          widthMm: viewportWidthMm,
          heightMm: viewportHeightMm
        };
      }
      return updated;
    });

    setPrintPageInputDrafts((current) => {
      const updated = { ...(current || {}) };
      for (let idx = 0; idx < printPreviewData.pages.length; idx += 1) {
        updated[idx] = {
          ...(updated[idx] || {}),
          widthMm: String(Math.round(viewportWidthMm)),
          heightMm: String(Math.round(viewportHeightMm))
        };
      }
      return updated;
    });

    if (printError === PRINT_PAGE_SIZE_ERROR_MESSAGE) {
      setPrintError('');
    }
  }, [printError, printOptions.orientation, printPreviewData.pages.length, printPreviewFullscreen]);

  const startPrintPageSizeDrag = useCallback((pageIndex, axisOrEvent, maybeEvent) => {
    if (printPageResizeRef.current.active && typeof printPageDragCleanupRef.current === 'function') {
      printPageDragCleanupRef.current();
      printPageDragCleanupRef.current = null;
      printPageResizeRef.current.active = false;
    }
    if (printPageResizeRef.current.active) return;
    const axis = typeof axisOrEvent === 'string' ? axisOrEvent : 'both';
    const ev = typeof axisOrEvent === 'string' ? maybeEvent : axisOrEvent;
    if (!ev) return;
    const pageNode = printPreviewPageRefs.current?.[pageIndex];
    if (!(pageNode instanceof HTMLElement)) return;

    const isTouch = 'touches' in ev;
    if (!isTouch && typeof ev.button === 'number' && ev.button !== 0) return;
    const point = isTouch ? ev.touches?.[0] : ev;
    const startX = Number(point?.clientX);
    const startY = Number(point?.clientY);
    if (!Number.isFinite(startX) || !Number.isFinite(startY)) return;
    ev.preventDefault();
    ev.stopPropagation();

    const measuredWidthMm = clamp(pxToMm(pageNode.offsetWidth), PRINT_PAGE_MM_MIN, PRINT_PAGE_MM_MAX);
    const measuredHeightMm = clamp(pxToMm(pageNode.offsetHeight), PRINT_PAGE_MM_MIN, PRINT_PAGE_MM_MAX);

    printPageResizeRef.current = {
      active: true,
      pageIndex,
      axis,
      startX,
      startY,
      startWidthMm: measuredWidthMm,
      startHeightMm: measuredHeightMm
    };

    if (typeof printPageDragCleanupRef.current === 'function') {
      printPageDragCleanupRef.current();
      printPageDragCleanupRef.current = null;
    }
    const pageDragCursor = axis === 'left' || axis === 'right'
      ? 'ew-resize'
      : axis === 'top' || axis === 'bottom'
        ? 'ns-resize'
        : 'nwse-resize';
    document.body.style.cursor = pageDragCursor;
    document.body.style.userSelect = 'none';

    const onUp = () => {
      printPageResizeRef.current.active = false;
      if (typeof printPageDragCleanupRef.current === 'function') {
        printPageDragCleanupRef.current();
        printPageDragCleanupRef.current = null;
      }
      syncPrintPreviewSizeFromDom(pageIndex);
      window.requestAnimationFrame(() => measurePrintGridBoundsForPage(pageIndex));
    };

    const onMove = (moveEv) => {
      if (!printPageResizeRef.current.active) return;
      const movePoint = 'touches' in moveEv ? moveEv.touches?.[0] : moveEv;
      const currentX = Number(movePoint?.clientX);
      const currentY = Number(movePoint?.clientY);
      if (!Number.isFinite(currentX) || !Number.isFinite(currentY)) return;

      const deltaMmX = pxToMm(currentX - printPageResizeRef.current.startX);
      const deltaMmY = pxToMm(currentY - printPageResizeRef.current.startY);
      const dragAxis = String(printPageResizeRef.current.axis || 'both');
      let nextWidthMm = printPageResizeRef.current.startWidthMm;
      let nextHeightMm = printPageResizeRef.current.startHeightMm;

      if (dragAxis === 'both') {
        nextWidthMm = printPageResizeRef.current.startWidthMm + deltaMmX;
        nextHeightMm = printPageResizeRef.current.startHeightMm + deltaMmY;
      } else if (dragAxis === 'right') {
        nextWidthMm = printPageResizeRef.current.startWidthMm + deltaMmX;
      } else if (dragAxis === 'left') {
        nextWidthMm = printPageResizeRef.current.startWidthMm - deltaMmX;
      } else if (dragAxis === 'bottom') {
        nextHeightMm = printPageResizeRef.current.startHeightMm + deltaMmY;
      } else if (dragAxis === 'top') {
        nextHeightMm = printPageResizeRef.current.startHeightMm - deltaMmY;
      }

      const safeWidthMm = clamp(nextWidthMm, PRINT_PAGE_MM_MIN, PRINT_PAGE_MM_MAX);
      const safeHeightMm = clamp(nextHeightMm, PRINT_PAGE_MM_MIN, PRINT_PAGE_MM_MAX);
      const idx = printPageResizeRef.current.pageIndex;
      setPrintPagePrefs((prev) => ({
        ...(prev || {}),
        [idx]: {
          ...(prev?.[idx] || defaultPrintPageDimensionsMm(printOptions.orientation)),
          widthMm: safeWidthMm,
          heightMm: safeHeightMm
        }
      }));
      setPrintPageInputDrafts((prev) => ({
        ...(prev || {}),
        [idx]: {
          ...(prev?.[idx] || {}),
          widthMm: String(Math.round(safeWidthMm)),
          heightMm: String(Math.round(safeHeightMm))
        }
      }));
      if (moveEv?.cancelable) moveEv.preventDefault();
    };

    const onWindowBlur = () => onUp();
    const onDragStart = () => onUp();
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') onUp();
    };

    const cleanupListeners = () => {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', onUp, true);
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onUp, true);
      window.removeEventListener('touchmove', onMove, true);
      window.removeEventListener('touchend', onUp, true);
      window.removeEventListener('touchcancel', onUp, true);
      window.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      window.removeEventListener('blur', onWindowBlur, true);
      window.removeEventListener('dragstart', onDragStart, true);
      document.removeEventListener('visibilitychange', onVisibilityChange, true);
      window.removeEventListener('contextmenu', onUp, true);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    printPageDragCleanupRef.current = cleanupListeners;
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', onUp, true);
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseup', onUp, true);
    window.addEventListener('touchmove', onMove, { capture: true, passive: false });
    window.addEventListener('touchend', onUp, true);
    window.addEventListener('touchcancel', onUp, true);
    window.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    window.addEventListener('blur', onWindowBlur, true);
    window.addEventListener('dragstart', onDragStart, true);
    document.addEventListener('visibilitychange', onVisibilityChange, true);
    window.addEventListener('contextmenu', onUp, true);
  }, [measurePrintGridBoundsForPage, printOptions.orientation, syncPrintPreviewSizeFromDom]);

  const startPrintGridScaleDrag = useCallback((axisOrEvent, maybeEvent) => {
    if (printGridResizeRef.current.active && typeof printGridDragCleanupRef.current === 'function') {
      printGridDragCleanupRef.current();
      printGridDragCleanupRef.current = null;
      printGridResizeRef.current.active = false;
    }
    if (printGridResizeRef.current.active) return;
    const axis = typeof axisOrEvent === 'string' ? axisOrEvent : 'both';
    const ev = typeof axisOrEvent === 'string' ? maybeEvent : axisOrEvent;
    if (!ev) return;
    const isTouch = 'touches' in ev;
    if (!isTouch && typeof ev.button === 'number' && ev.button !== 0) return;
    const point = isTouch ? ev.touches?.[0] : ev;
    const startX = Number(point?.clientX);
    const startY = Number(point?.clientY);
    if (!Number.isFinite(startX) || !Number.isFinite(startY)) return;
    ev.preventDefault();
    ev.stopPropagation();

    printGridResizeRef.current = {
      active: true,
      axis,
      startX,
      startY,
      startScaleX: clamp(Number(printOptions.gridScaleX ?? printOptions.gridScale) || 100, 60, 200),
      startScaleY: clamp(Number(printOptions.gridScaleY ?? printOptions.gridScale) || 100, 60, 200)
    };

    if (typeof printGridDragCleanupRef.current === 'function') {
      printGridDragCleanupRef.current();
      printGridDragCleanupRef.current = null;
    }
    const gridDragCursor = axis === 'left' || axis === 'right'
      ? 'ew-resize'
      : axis === 'top' || axis === 'bottom'
        ? 'ns-resize'
        : 'nwse-resize';
    document.body.style.cursor = gridDragCursor;
    document.body.style.userSelect = 'none';

    const onUp = () => {
      printGridResizeRef.current.active = false;
      if (typeof printGridDragCleanupRef.current === 'function') {
        printGridDragCleanupRef.current();
        printGridDragCleanupRef.current = null;
      }
    };

    const onMove = (moveEv) => {
      if (!printGridResizeRef.current.active) return;
      const movePoint = 'touches' in moveEv ? moveEv.touches?.[0] : moveEv;
      const currentX = Number(movePoint?.clientX);
      const currentY = Number(movePoint?.clientY);
      if (!Number.isFinite(currentX) || !Number.isFinite(currentY)) return;
      const deltaX = currentX - printGridResizeRef.current.startX;
      const deltaY = currentY - printGridResizeRef.current.startY;
      const dragAxis = String(printGridResizeRef.current.axis || 'both');
      const speed = 0.35;
      const deltaCombined = (deltaX + deltaY) / 2;
      let nextScaleX = printGridResizeRef.current.startScaleX;
      let nextScaleY = printGridResizeRef.current.startScaleY;

      if (dragAxis === 'both') {
        nextScaleX = clamp(Math.round(printGridResizeRef.current.startScaleX + (deltaCombined * speed)), 60, 200);
        nextScaleY = clamp(Math.round(printGridResizeRef.current.startScaleY + (deltaCombined * speed)), 60, 200);
      } else if (dragAxis === 'right') {
        nextScaleX = clamp(Math.round(printGridResizeRef.current.startScaleX + (deltaX * speed)), 60, 200);
      } else if (dragAxis === 'left') {
        nextScaleX = clamp(Math.round(printGridResizeRef.current.startScaleX - (deltaX * speed)), 60, 200);
      } else if (dragAxis === 'bottom') {
        nextScaleY = clamp(Math.round(printGridResizeRef.current.startScaleY + (deltaY * speed)), 60, 200);
      } else if (dragAxis === 'top') {
        nextScaleY = clamp(Math.round(printGridResizeRef.current.startScaleY - (deltaY * speed)), 60, 200);
      }

      const nextScale = clamp(Math.round((nextScaleX + nextScaleY) / 2), 60, 200);
      setPrintOptions((prev) => {
        const prevX = clamp(Number(prev.gridScaleX ?? prev.gridScale) || 100, 60, 200);
        const prevY = clamp(Number(prev.gridScaleY ?? prev.gridScale) || 100, 60, 200);
        if (prev.gridScale === nextScale && prevX === nextScaleX && prevY === nextScaleY) return prev;
        return {
          ...prev,
          gridScale: nextScale,
          gridScaleX: nextScaleX,
          gridScaleY: nextScaleY
        };
      });
      if (moveEv?.cancelable) moveEv.preventDefault();
    };

    const onWindowBlur = () => onUp();
    const onDragStart = () => onUp();
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') onUp();
    };
    const cleanupListeners = () => {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', onUp, true);
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onUp, true);
      window.removeEventListener('touchmove', onMove, true);
      window.removeEventListener('touchend', onUp, true);
      window.removeEventListener('touchcancel', onUp, true);
      window.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      window.removeEventListener('blur', onWindowBlur, true);
      window.removeEventListener('dragstart', onDragStart, true);
      document.removeEventListener('visibilitychange', onVisibilityChange, true);
      window.removeEventListener('contextmenu', onUp, true);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    printGridDragCleanupRef.current = cleanupListeners;
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', onUp, true);
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseup', onUp, true);
    window.addEventListener('touchmove', onMove, { capture: true, passive: false });
    window.addEventListener('touchend', onUp, true);
    window.addEventListener('touchcancel', onUp, true);
    window.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    window.addEventListener('blur', onWindowBlur, true);
    window.addEventListener('dragstart', onDragStart, true);
    document.addEventListener('visibilitychange', onVisibilityChange, true);
    window.addEventListener('contextmenu', onUp, true);
  }, [printOptions.gridScale, printOptions.gridScaleX, printOptions.gridScaleY]);

  const submitPrintDialog = async (ev) => {
    ev.preventDefault();
    if (printSubmitting) return;
    setPrintError('');

    let hasInvalidPageSize = false;
    const sanitizedDrafts = {};
    Object.entries(printPageInputDrafts || {}).forEach(([idxKey, fields]) => {
      if (!fields || typeof fields !== 'object') return;
      const nextFields = { ...fields };
      ['widthMm', 'heightMm'].forEach((field) => {
        const raw = String(fields?.[field] ?? '').trim();
        if (!raw) return;
        const value = Number(raw);
        if (!Number.isFinite(value) || value < PRINT_PAGE_MM_MIN || value > PRINT_PAGE_MM_MAX) {
          hasInvalidPageSize = true;
          nextFields[field] = '';
        }
      });
      sanitizedDrafts[idxKey] = nextFields;
    });
    if (hasInvalidPageSize) {
      setPrintPageInputDrafts((prev) => ({ ...prev, ...sanitizedDrafts }));
      setPrintError(PRINT_PAGE_SIZE_ERROR_MESSAGE);
      return;
    }

    const built = printPreviewData?.ok
      ? printPreviewData.built
      : buildPrintDocument(printForm, printOptions);
    if (!built?.ok) {
      setPrintError(built?.error || 'Unable to generate print document.');
      return;
    }

    setPrintSubmitting(true);
    setPrintModalOpen(false);
    setSettingsDropdownOpen(false);
    try {
      await exportPrintDocumentAsPdf(built, {
        orientation: printOptions.orientation,
        pagePrefs: printPagePrefs
      });
      setPrintSubmitting(false);
    } catch (_) {
      setPrintSubmitting(false);
      setPrintError('Unable to export PDF. Please try again.');
      setPrintModalOpen(true);
    }
  };

  const handleViewChange = useCallback((newView) => {
    const api = calendarRef.current?.getApi();
    setViewType(newView);

    if (api) {
      api.changeView(newView);

      // Moving into day-view from non-timegrid/year(list-hidden) can need a forced relayout.
      if (newView === 'timeGridDay' || newView === 'timeGridWeek') {
        window.requestAnimationFrame(() => {
          const now = new Date();
          const targetMinutes = Math.max(0, (now.getHours() * 60 + now.getMinutes()) - 45);
          const targetScroll = minutesToDurationString(targetMinutes);
          api.updateSize();
          api.scrollToTime(targetScroll);
          window.setTimeout(() => {
            if (api.view?.type === newView) {
              api.updateSize();
              api.scrollToTime(targetScroll);
            }
          }, 90);
        });
      }
    }
    setViewDropdownOpen(false);
  }, []);

  const isMacKeyboard = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    const platform = String(navigator.platform || '').toLowerCase();
    const userAgent = String(navigator.userAgent || '').toLowerCase();
    return platform.includes('mac') || userAgent.includes('macintosh') || userAgent.includes('mac os');
  }, []);

  const shortcutModifierLabel = useMemo(() => (isMacKeyboard ? 'Cmd' : 'Ctrl'), [isMacKeyboard]);

  const appearanceShortcutHint = useMemo(() => {
    const key = themeMode === 'Dark' ? 'L' : 'D';
    return `${shortcutModifierLabel}+${key}`;
  }, [shortcutModifierLabel, themeMode]);

  const printShortcutHint = useMemo(() => `${shortcutModifierLabel}+P`, [shortcutModifierLabel]);
  const trashShortcutHint = useMemo(() => (isMacKeyboard ? 'Option+T' : 'Alt+T'), [isMacKeyboard]);

  useEffect(() => {
    const handleAppearanceHotkeys = (ev) => {
      if (ev.defaultPrevented) return;
      if (searchOpen) return;

      const target = ev.target;
      if (target instanceof Element) {
        const tag = String(target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable) return;
      }

      const modifierPressed = isMacKeyboard
        ? (ev.metaKey && !ev.ctrlKey)
        : (ev.ctrlKey && !ev.metaKey);
      if (!modifierPressed || ev.altKey || ev.shiftKey) return;

      const key = String(ev.key || '').toLowerCase();
      if (key !== 'd' && key !== 'l') return;

      const nextMode = key === 'd' ? 'Dark' : 'Light';
      if (normalizeThemeMode(themeMode) === nextMode) return;

      ev.preventDefault();
      ev.stopPropagation();
      void applyThemeMode(nextMode);
    };

    window.addEventListener('keydown', handleAppearanceHotkeys, true);
    return () => window.removeEventListener('keydown', handleAppearanceHotkeys, true);
  }, [applyThemeMode, isMacKeyboard, searchOpen, themeMode]);

  useEffect(() => {
    const handleCalendarCommandHotkeys = (ev) => {
      if (ev.defaultPrevented) return;
      if (searchOpen) return;

      const target = ev.target;
      if (target instanceof Element) {
        const tag = String(target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable) return;
      }

      const key = String(ev.key || '').toLowerCase();
      const isPrintModifier = isMacKeyboard
        ? (ev.metaKey && !ev.ctrlKey && !ev.altKey && !ev.shiftKey)
        : (ev.ctrlKey && !ev.metaKey && !ev.altKey && !ev.shiftKey);
      if (key === 'p' && isPrintModifier) {
        ev.preventDefault();
        ev.stopPropagation();
        openPrintDialog();
        return;
      }
      const isTrashModifier = ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey;
      if (key === 't' && isTrashModifier) {
        ev.preventDefault();
        ev.stopPropagation();
        setSettingsDropdownOpen(false);
        navigate('/trash');
      }
    };

    window.addEventListener('keydown', handleCalendarCommandHotkeys, true);
    return () => window.removeEventListener('keydown', handleCalendarCommandHotkeys, true);
  }, [isMacKeyboard, navigate, openPrintDialog, searchOpen]);

  useEffect(() => {
    const handleViewHotkeys = (ev) => {
      if (ev.defaultPrevented) return;
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (searchOpen) return;

      const target = ev.target;
      if (target instanceof Element) {
        const tag = String(target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable) return;
      }

      const key = String(ev.key || '').toLowerCase();
      const viewMap = {
        d: 'timeGridDay',
        w: 'timeGridWeek',
        m: 'dayGridMonth',
        y: 'multiMonthYear',
        s: 'listYear'
      };

      const nextView = viewMap[key];
      if (!nextView) return;

      ev.preventDefault();
      ev.stopPropagation();
      handleViewChange(nextView);
    };

    window.addEventListener('keydown', handleViewHotkeys, true);
    return () => window.removeEventListener('keydown', handleViewHotkeys, true);
  }, [handleViewChange, searchOpen]);

  useEffect(() => {
    if (viewType !== 'listYear') return;
    const panel = schedulePanelRef.current;
    if (!panel) return;

    const scrollToRelevantDate = () => {
      const groupEls = Array.from(panel.querySelectorAll('.day-group[data-date-key]'));
      if (!groupEls.length) {
        panel.scrollTo({ top: 0, behavior: 'auto' });
        return;
      }

      const todayKey = toDateKeyLocal(new Date());
      const todayMidnight = new Date(`${todayKey}T00:00:00`).getTime();

      let targetEl = groupEls.find((el) => el.getAttribute('data-date-key') === todayKey) || null;

      if (!targetEl) {
        let bestDiff = Number.POSITIVE_INFINITY;
        groupEls.forEach((el) => {
          const key = String(el.getAttribute('data-date-key') || '');
          const ts = new Date(`${key}T00:00:00`).getTime();
          if (!Number.isFinite(ts)) return;
          const diff = Math.abs(ts - todayMidnight);
          if (diff < bestDiff) {
            bestDiff = diff;
            targetEl = el;
          }
        });
      }

      if (!targetEl) {
        panel.scrollTo({ top: 0, behavior: 'auto' });
        return;
      }

      const panelRect = panel.getBoundingClientRect();
      const targetRect = targetEl.getBoundingClientRect();
      const targetTop = panel.scrollTop + (targetRect.top - panelRect.top) - 8;
      panel.scrollTo({ top: Math.max(0, targetTop), behavior: 'auto' });
    };

    const t1 = window.setTimeout(scrollToRelevantDate, 0);
    const t2 = window.setTimeout(scrollToRelevantDate, 110);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [viewType, scheduleGroups]);

  useLayoutEffect(() => {
    if (viewType !== 'listYear') return undefined;

    const applyRightLineBleed = () => {
      const panel = schedulePanelRef.current;
      const wrapper = scheduleWrapperRef.current;
      if (!panel || !wrapper) return;

      const panelRect = panel.getBoundingClientRect();
      const wrapperRect = wrapper.getBoundingClientRect();
      const rightBleed = Math.max(0, panelRect.right - wrapperRect.right);
      wrapper.style.setProperty('--schedule-line-extend-right', `${Math.round(rightBleed)}px`);
    };

    applyRightLineBleed();
    const t1 = window.setTimeout(applyRightLineBleed, 0);
    const t2 = window.setTimeout(applyRightLineBleed, 120);
    window.addEventListener('resize', applyRightLineBleed);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.removeEventListener('resize', applyRightLineBleed);
    };
  }, [viewType, sidebarOpen, scheduleGroups.length, searchOpen]);

  const toggleWeekAllDayExpanded = useCallback((ev) => {
    ev?.preventDefault?.();
    ev?.stopPropagation?.();
    if (!weekAllDayOverflow.hasOverflow) return;
    setWeekAllDayExpanded((prev) => !prev);
  }, [weekAllDayOverflow.hasOverflow]);

  const toggleDayAllDayExpanded = useCallback((ev) => {
    ev?.preventDefault?.();
    ev?.stopPropagation?.();
    if (!dayAllDayOverflow.hasOverflow) return;
    setDayAllDayExpanded((prev) => !prev);
  }, [dayAllDayOverflow.hasOverflow]);

  const handleMoreLinkClick = useCallback((arg) => {
    const activeViewType = String(
      calendarRef.current?.getApi()?.view?.type ||
      viewType ||
      arg?.view?.type ||
      ''
    );

    if (activeViewType === 'dayGridMonth') {
      arg?.jsEvent?.preventDefault?.();
      arg?.jsEvent?.stopPropagation?.();
      openMonthMorePopup(arg);
      // Truthy non-string prevents FullCalendar default popover/zoom.
      return true;
    }

    if (activeViewType === 'timeGridWeek') {
      arg?.jsEvent?.preventDefault?.();
      arg?.jsEvent?.stopPropagation?.();
      if (!weekAllDayExpanded) {
        setWeekAllDayExpanded(true);
      }
      // Truthy non-string prevents popover and avoids zooming to another view.
      return true;
    }

    if (activeViewType === 'timeGridDay') {
      arg?.jsEvent?.preventDefault?.();
      arg?.jsEvent?.stopPropagation?.();
      if (!dayAllDayExpanded) {
        setDayAllDayExpanded(true);
      }
      // Keep day view in-place and expand inline instead of opening popup.
      return true;
    }
    return 'popover';
  }, [viewType, weekAllDayExpanded, dayAllDayExpanded, openMonthMorePopup]);

  const renderWeekAllDayContent = useCallback(() => {
    if (!weekAllDayOverflow.hasOverflow) {
      return <div className="gcal-week-all-day-toggle-wrap" />;
    }

    const chevronPath = weekAllDayExpanded
      ? 'M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z'
      : 'M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z';

    return (
      <div className="gcal-week-all-day-toggle-wrap">
        <button
          type="button"
          className="gcal-week-all-day-toggle-btn"
          onClick={toggleWeekAllDayExpanded}
          aria-label={weekAllDayExpanded ? 'Collapse all-day events row' : 'Expand all-day events row'}
          title={weekAllDayExpanded ? 'Collapse all-day events row' : `Show ${weekAllDayOverflow.maxOverflow}+ more events`}
        >
          <svg
            className="gcal-week-all-day-toggle-icon"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d={chevronPath}></path>
          </svg>
        </button>
      </div>
    );
  }, [toggleWeekAllDayExpanded, weekAllDayExpanded, weekAllDayOverflow.hasOverflow, weekAllDayOverflow.maxOverflow]);

  const renderDayAllDayContent = useCallback(() => {
    if (!dayAllDayOverflow.hasOverflow) {
      return <div className="gcal-week-all-day-toggle-wrap" />;
    }

    const chevronPath = dayAllDayExpanded
      ? 'M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z'
      : 'M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z';

    return (
      <div className="gcal-week-all-day-toggle-wrap">
        <button
          type="button"
          className="gcal-week-all-day-toggle-btn"
          onClick={toggleDayAllDayExpanded}
          aria-label={dayAllDayExpanded ? 'Collapse all-day events row' : 'Expand all-day events row'}
          title={dayAllDayExpanded ? 'Collapse all-day events row' : `Show ${dayAllDayOverflow.overflowCount}+ more events`}
        >
          <svg
            className="gcal-week-all-day-toggle-icon"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d={chevronPath}></path>
          </svg>
        </button>
      </div>
    );
  }, [toggleDayAllDayExpanded, dayAllDayExpanded, dayAllDayOverflow.hasOverflow, dayAllDayOverflow.overflowCount]);

  const moveMiniMonth = (step) => {
    setMiniAnchorDate((prev) => {
      const d = new Date(prev);
      d.setMonth(d.getMonth() + step);
      return d;
    });
  };

  const goToMiniDate = (dateObj) => {
    const api = calendarRef.current?.getApi();
    if (api) {
      api.gotoDate(dateObj);
    }
  };

  const toggleFilter = (filterKey) => {
    setFilters((prev) => ({ ...prev, [filterKey]: !prev[filterKey] }));
  };

  const formatDateDisplay = (isoDate) => {
    const raw = String(isoDate || '').trim();
    const parts = raw.split('-');
    if (parts.length !== 3) return '';
    const [year, month, day] = parts;
    if (!year || !month || !day) return '';
    return `${day}/${month}/${year}`;
  };

  const openNativeDatePicker = (inputRef, ev) => {
    if (ev) {
      ev.preventDefault();
      ev.stopPropagation();
    }
    const node = inputRef?.current;
    if (!node) return;
    try {
      if (typeof node.showPicker === 'function') {
        node.showPicker();
        return;
      }
    } catch (_) {
      // Some browsers throw if showPicker() is invoked without trusted activation.
    }
    try {
      node.focus();
      node.click();
    } catch (_) {
      // Fallback no-op.
    }
  };

  const openTaskModalFromCreate = useCallback(() => {
    if (!canManageTasks) {
      setTaskMessage('Login as admin/faculty to create public tasks.');
      return;
    }

    setTaskMessage('');
    setPopover((prev) => ({ ...prev, open: false }));
    setPopoverEditMode(false);
    setPopoverEditLoading(false);
    setPopoverEditSaving(false);
    setPopoverDeleting(false);
    setPopoverEditError('');
    setPopoverEditForm(emptyPopoverEditForm());
    setTaskForm({ ...defaultTaskForm });
    setShowTaskModal(true);
  }, [canManageTasks]);

  const handleDateClick = useCallback((clickInfo) => {
    clickInfo?.jsEvent?.preventDefault?.();

    const clickedDate =
      /^\d{4}-\d{2}-\d{2}$/.test(String(clickInfo?.dateStr || ''))
        ? String(clickInfo.dateStr)
        : toInputDateValue(clickInfo?.date);
    if (!clickedDate) return;

    if (!canManageTasks) {
      setTaskMessage('Login as admin/faculty to create public tasks.');
      return;
    }

    setTaskMessage('');
    setPopover((prev) => ({ ...prev, open: false }));
    setPopoverEditMode(false);
    setPopoverEditLoading(false);
    setPopoverEditSaving(false);
    setPopoverDeleting(false);
    setPopoverEditError('');
    setPopoverEditForm(emptyPopoverEditForm());

    const isWeekTimedClick = String(clickInfo?.view?.type || '') === 'timeGridWeek' && !clickInfo?.allDay;
    if (isWeekTimedClick) {
      const clickedStart = new Date(clickInfo?.date);
      if (!Number.isNaN(clickedStart.getTime())) {
        const clickedEnd = new Date(clickedStart.getTime() + (60 * 60 * 1000));
        const startParts = to12HourParts(clickedStart);
        const endParts = to12HourParts(clickedEnd);
        if (startParts && endParts) {
          setTaskForm({
            ...defaultTaskForm,
            allDay: false,
            startDate: toInputDateValue(clickedStart),
            endDate: toInputDateValue(clickedEnd),
            startHour: startParts.hour,
            startMinute: startParts.minute,
            startPeriod: startParts.period,
            endHour: endParts.hour,
            endMinute: endParts.minute,
            endPeriod: endParts.period
          });
          setShowTaskModal(true);
          return;
        }
      }
    }

    setTaskForm({
      ...defaultTaskForm,
      startDate: clickedDate,
      endDate: clickedDate
    });
    setShowTaskModal(true);
  }, [canManageTasks]);

  const submitTask = async (e) => {
    e.preventDefault();
    if (!canManageTasks) return;
    const title = String(taskForm.title || '').trim();
    if (!title) { setTaskMessage('Task title is required.'); return; }
    if (!taskForm.acknowledgePublic) { setTaskMessage('Please acknowledge the public visibility warning first.'); return; }

    let payload;
    if (taskForm.allDay) {
      if (!taskForm.startDate) { setTaskMessage('Select at least the start date.'); return; }
      const allDayRange = toAllDayRange(taskForm.startDate, taskForm.endDate);
      if (!allDayRange) { setTaskMessage('Please provide valid dates.'); return; }
      payload = { title, description: String(taskForm.description || '').trim(), allDay: true, ...allDayRange };
    } else {
      if (!taskForm.startDate || !taskForm.endDate || !taskForm.startHour || !taskForm.startMinute || !taskForm.endHour || !taskForm.endMinute) {
        setTaskMessage('Please fill start/end date and time fields.');
        return;
      }

      const parsedStart = to24HourFrom12(taskForm.startHour, taskForm.startMinute, taskForm.startPeriod, 'Start time');
      if (!parsedStart.ok) {
        setTaskMessage(parsedStart.message);
        return;
      }

      const parsedEnd = to24HourFrom12(taskForm.endHour, taskForm.endMinute, taskForm.endPeriod, 'End time');
      if (!parsedEnd.ok) {
        setTaskMessage(parsedEnd.message);
        return;
      }

      const startIso = toIso(`${taskForm.startDate}T${parsedStart.value}`);
      const endIso = toIso(`${taskForm.endDate}T${parsedEnd.value}`);
      if (!startIso || !endIso) {
        setTaskMessage('Start and end date-time are required.');
        return;
      }
      if (new Date(endIso) <= new Date(startIso)) {
        setTaskMessage('End date/time must be after start date/time.');
        return;
      }
      payload = { title, description: String(taskForm.description || '').trim(), allDay: false, startDateTime: startIso, endDateTime: endIso };
    }

    setPostingTask(true);
    try {
      await createCalendarTaskApi(payload);
      setTaskForm(defaultTaskForm);
      setShowTaskModal(false);
      if (activeRangeRef.current) await loadEvents(activeRangeRef.current);
    } catch (err) {
      setTaskMessage(err?.response?.data?.error || 'Unable to create task.');
    } finally {
      setPostingTask(false);
    }
  };

  const clearSearchState = () => {
    setSearchQuery('');
    setSearchResults([]);
    setSearchMessage('');
    setSearchExecutedQuery('');
    setSearchLoading(false);
  };

  const executeSearch = async (e) => {
    if (e.key !== 'Enter' && e.type !== 'click') return;

    const query = String(searchQuery || '').trim();
    setSearchExecutedQuery(query);
    if (!query) {
      setSearchResults([]);
      setSearchMessage('Type a keyword and press Enter to search across months and years.');
      return;
    }

    setSearchLoading(true);
    setSearchMessage('');
    try {
      await searchCalendarEventsWithFuzzy(query, { updateMessage: true });
    } catch (_) {
      setSearchResults([]);
      setSearchMessage('Unable to process search right now.');
    } finally {
      setSearchLoading(false);
    }
  };

  const openSearchResult = (eventLike, options = {}) => {
    const source = eventSourceOf(eventLike);
    const isNoticeLike = source === 'NOTICE' || source === 'NOTICE_BG';
    const forceNoticeOpen = Boolean(options?.forceNoticeOpen);
    const noticeIdCandidates = [
      eventNoticeIdOf(eventLike),
      eventLike?.extendedProps?.noticeId,
      eventLike?.noticeId,
      eventLike?.extendedProps?.originalId,
      eventLike?.id
    ];
    const noticeId = noticeIdCandidates
      .map((value) => normalizeEntityRouteId(value))
      .find((value) => Boolean(value));

    // Important: if the caller is the explicit OPEN NOTICE/ALERT button and we
    // have a valid notice id, always route to notice details (never date-jump).
    if ((forceNoticeOpen || isNoticeLike) && noticeId) {
      setSearchOpen(false);
      navigate(`/notices/${encodeURIComponent(noticeId)}`);
      return;
    }

    const start = toDateOrNull(eventLike?.start);
    if (!start) return;
    setPendingGotoIso(start.toISOString());
    setSearchOpen(false);
  };

  const pDetails = () => {
    if (!popover.eventData) return {};
    const ev = popover.eventData;
    const source = ev.extendedProps?.source;
    let badgeColor = String(ev?.backgroundColor || ev?.color || '#1a73e8');
    let calendarName = 'Notices';
    if (source === 'FESTIVAL') { calendarName = 'Holidays in India'; }
    else if (source === 'TASK') { calendarName = 'Public Tasks'; }
    else if (isAlertNotice(ev)) { calendarName = 'Alerts / Closures'; }
    const displayTitle = source === 'FESTIVAL' ? (stripFestivalPrefix(ev.title) || ev.title) : ev.title;
    const taskId = eventTaskIdOf(ev);
    const taskCanEdit = Boolean(ev?.extendedProps?.canEditTask || ev?.extendedProps?.canEdit || ev?.canEditTask || ev?.canEdit);
    const taskCanDelete = Boolean(ev?.extendedProps?.canDeleteTask || ev?.extendedProps?.canDelete || ev?.canDeleteTask || ev?.canDelete);
    return {
      title: displayTitle, 
      dateStr: ev.start ? ev.start.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : '',
      desc: ev.extendedProps?.description || ev.extendedProps?.summary || '',
      badgeColor,
      calendarName,
      source,
      isNotice: source === 'NOTICE' || source === 'NOTICE_BG',
      noticeId: ev.extendedProps?.noticeId,
      isTask: source === 'TASK',
      taskId,
      taskCanEdit,
      taskCanDelete
    };
  };

  const editNoticeFromPopover = async () => {
    if (!popover.eventData) return;
    const source = eventSourceOf(popover.eventData);
    const isTaskSource = source === 'TASK';
    const isNoticeSource = source === 'NOTICE' || source === 'NOTICE_BG';
    if (!isTaskSource && !isNoticeSource) return;

    const fallbackTitle = stripNoticePrefix(popover.eventData.title);
    const fallbackDesc = eventDescriptionOf(popover.eventData);

    setPopoverEditMode(true);
    setPopoverEditLoading(true);
    setPopoverEditError('');
    setPopoverEditForm({
      title: fallbackTitle,
      subject: fallbackTitle,
      description: fallbackDesc,
      startDateTime: toDateTimeLocalInput(popover.eventData.start),
      endDateTime: toDateTimeLocalInput(popover.eventData.end)
    });

    if (isTaskSource) {
      if (!(isAdmin || popoverDetails?.taskCanEdit)) {
        setPopoverEditMode(false);
        return;
      }
      setPopoverEditLoading(false);
      return;
    }

    if (!isAdmin) {
      setPopoverEditMode(false);
      return;
    }

    const noticeId = eventNoticeIdOf(popover.eventData);
    if (!noticeId) {
      setPopoverEditMode(false);
      return;
    }

    try {
      const data = await getNoticeByIdApi(noticeId);
      const notice = data?.notice || {};
      setPopoverEditForm({
        title: String(notice?.title || notice?.subject || fallbackTitle || ''),
        subject: String(notice?.subject || notice?.title || fallbackTitle || ''),
        description: String(notice?.content || notice?.body || notice?.summary || fallbackDesc || ''),
        startDateTime: toDateTimeLocalInput(notice?.startDateTime || popover.eventData.start),
        endDateTime: toDateTimeLocalInput(notice?.endDateTime || popover.eventData.end)
      });
      setPopoverEditError('');
    } catch (err) {
      setPopoverEditError(err?.response?.data?.error || 'Failed to load notice for editing.');
    } finally {
      setPopoverEditLoading(false);
    }
  };

  const handlePopoverEditChange = (field, value) => {
    setPopoverEditForm((prev) => ({ ...prev, [field]: value }));
  };

  const cancelPopoverEdit = () => {
    setPopoverEditMode(false);
    setPopoverEditLoading(false);
    setPopoverEditSaving(false);
    setPopoverEditError('');
    setPopoverEditForm(emptyPopoverEditForm());
  };

  const savePopoverEdit = async () => {
    if (!popover.eventData) return;
    const source = eventSourceOf(popover.eventData);
    const isTaskSource = source === 'TASK';
    const isNoticeSource = source === 'NOTICE' || source === 'NOTICE_BG';
    if (!isTaskSource && !isNoticeSource) return;

    const title = String(popoverEditForm.title || '').trim();
    const subject = String(popoverEditForm.subject || '').trim();
    const description = String(popoverEditForm.description || '').trim();
    const startIso = toIso(popoverEditForm.startDateTime);
    const endIso = toIso(popoverEditForm.endDateTime);

    if (!title && !subject) {
      setPopoverEditError('Title or subject is required.');
      return;
    }
    if (isTaskSource && !title) {
      setPopoverEditError('Task title is required.');
      return;
    }

    if ((popoverEditForm.startDateTime && !startIso) || (popoverEditForm.endDateTime && !endIso)) {
      setPopoverEditError('Please provide valid start/end date-time values.');
      return;
    }

    if (startIso && endIso && new Date(endIso) <= new Date(startIso)) {
      setPopoverEditError('End time must be after start time.');
      return;
    }

    setPopoverEditSaving(true);
    setPopoverEditError('');
    try {
      if (isTaskSource) {
        if (!(isAdmin || popoverDetails?.taskCanEdit)) {
          setPopoverEditError('You are not allowed to edit this task.');
          setPopoverEditSaving(false);
          return;
        }

        const taskId = eventTaskIdOf(popover.eventData);
        if (!taskId) {
          setPopoverEditError('Task id missing.');
          setPopoverEditSaving(false);
          return;
        }

        const taskPayload = {
          title: title || subject,
          description,
          allDay: Boolean(popover.eventData?.allDay),
          startDateTime: startIso || null,
          endDateTime: endIso || null
        };

        const response = await updateCalendarTaskApi(taskId, taskPayload);
        const updatedTask = response?.task || {};
        const uiTitle = String(updatedTask?.title || taskPayload.title || '').trim();

        if (typeof popover.eventData.setProp === 'function') {
          popover.eventData.setProp('title', uiTitle);
        }
        if (typeof popover.eventData.setExtendedProp === 'function') {
          popover.eventData.setExtendedProp(
            'description',
            String(updatedTask?.description || description || '')
          );
        }
        if (typeof popover.eventData.setStart === 'function' && startIso) {
          popover.eventData.setStart(startIso, { maintainDuration: false });
        }
        if (typeof popover.eventData.setEnd === 'function' && endIso) {
          popover.eventData.setEnd(endIso);
        }

        if (activeRangeRef.current) {
          await loadEvents(activeRangeRef.current);
        }
        if (searchExecutedQuery) {
          await searchCalendarEventsWithFuzzy(searchExecutedQuery);
        }

        setPopoverEditMode(false);
        setPopoverEditForm(emptyPopoverEditForm());
        setSnackbarSeverity('success');
        setSnackbarMessage('Public task updated.');
        setSnackbarOpen(true);
        return;
      }

      if (!isAdmin) {
        setPopoverEditError('Only admin can edit this notice.');
        setPopoverEditSaving(false);
        return;
      }

      const noticeId = eventNoticeIdOf(popover.eventData);
      if (!noticeId) {
        setPopoverEditError('Notice id missing.');
        setPopoverEditSaving(false);
        return;
      }

      const noticePayload = {
        title: title || subject,
        subject: subject || title,
        description,
        content: description,
        body: description,
        summary: description,
        startDateTime: startIso || null,
        endDateTime: endIso || null
      };

      const response = await updateNoticeApi(noticeId, noticePayload);
      const updatedNotice = response?.notice || {};
      const isAlert = isAlertNotice(popover.eventData);
      const refreshedTitle = String(updatedNotice?.title || noticePayload.title || '').trim();
      const uiTitle = `${isAlert ? 'ALERT' : 'NOTICE'}: ${refreshedTitle}`;

      if (typeof popover.eventData.setProp === 'function') {
        popover.eventData.setProp('title', uiTitle);
      }
      if (typeof popover.eventData.setExtendedProp === 'function') {
        popover.eventData.setExtendedProp(
          'description',
          String(updatedNotice?.content || updatedNotice?.body || updatedNotice?.summary || description || '')
        );
      }
      if (typeof popover.eventData.setStart === 'function' && startIso) {
        popover.eventData.setStart(startIso, { maintainDuration: false });
      }
      if (typeof popover.eventData.setEnd === 'function' && endIso) {
        popover.eventData.setEnd(endIso);
      }

      if (activeRangeRef.current) {
        await loadEvents(activeRangeRef.current);
      }
      if (searchExecutedQuery) {
        await searchCalendarEventsWithFuzzy(searchExecutedQuery);
      }

      setPopoverEditMode(false);
      setPopoverEditForm(emptyPopoverEditForm());
      setSnackbarSeverity('success');
      setSnackbarMessage('Notice updated.');
      setSnackbarOpen(true);
    } catch (err) {
      setPopoverEditError(
        err?.response?.data?.error || (isTaskSource ? 'Unable to save task changes.' : 'Unable to save notice changes.')
      );
    } finally {
      setPopoverEditSaving(false);
    }
  };

  const deleteNoticeFromPopover = async () => {
    if (!popover.eventData) return;
    const source = eventSourceOf(popover.eventData);
    const isTaskSource = source === 'TASK';
    const isNoticeSource = source === 'NOTICE' || source === 'NOTICE_BG';
    if (!isTaskSource && !isNoticeSource) return;

    if (isTaskSource) {
      if (!(isAdmin || popoverDetails?.taskCanDelete)) return;
      const taskId = eventTaskIdOf(popover.eventData);
      if (!taskId) return;

      const confirmTitle = String(popover.eventData.title || popoverDetails.title || 'this public task').trim();
      setDeleteConfirm({
        open: true,
        kind: 'TASK',
        id: String(taskId),
        title: confirmTitle,
        message: 'This will permanently delete this public task from all shared calendars.'
      });
      return;
    }

    if (!isAdmin) return;
    const noticeId = eventNoticeIdOf(popover.eventData);
    if (!noticeId) return;

    const confirmTitle = stripNoticePrefix(popover.eventData.title || popoverDetails.title || 'this notice');
    setDeleteConfirm({
      open: true,
      kind: 'NOTICE',
      id: String(noticeId),
      title: confirmTitle,
      message: 'This will remove it from calendar, notices, and schedule, and move it to Trash.'
    });
  };

  const confirmDeleteFromDialog = async () => {
    if (!deleteConfirm.open || !deleteConfirm.kind || !deleteConfirm.id) return;
    const deletingKind = deleteConfirm.kind;
    const deletingId = deleteConfirm.id;
    setPopoverDeleting(true);
    try {
      if (deletingKind === 'TASK') {
        await deleteCalendarTaskApi(deletingId);
      } else {
        await deleteNoticeApi(deletingId);
      }

      setDeleteConfirm(emptyDeleteConfirmState());
      closePopover();
      if (activeRangeRef.current) {
        await loadEvents(activeRangeRef.current);
      }
      if (searchExecutedQuery) {
        await searchCalendarEventsWithFuzzy(searchExecutedQuery);
      }

      setSnackbarSeverity('success');
      setSnackbarMessage(deletingKind === 'TASK' ? 'Public task deleted.' : 'Notice moved to trash.');
      setSnackbarOpen(true);
    } catch (err) {
      setSnackbarSeverity('error');
      setSnackbarMessage(
        err?.response?.data?.error ||
        (deletingKind === 'TASK' ? 'Unable to delete this public task.' : 'Unable to delete this notice.')
      );
      setSnackbarOpen(true);
    } finally {
      setPopoverDeleting(false);
    }
  };

  const viewLabels = { timeGridDay: 'Day', timeGridWeek: 'Week', dayGridMonth: 'Month', multiMonthYear: 'Year', listYear: 'Schedule' };
  const mobileTodayLabel = String(new Date(headerClockTick).getDate());
  const displayViewTitle = useMemo(() => {
    if (!isMobile) return viewTitle;
    const withoutYear = stripYearFromHeaderTitle(viewTitle);
    return withoutYear || viewLabels[viewType] || viewTitle;
  }, [isMobile, viewTitle, viewType]);
  const clampMobileHeaderPosition = useCallback((rawX, rawY, width, height) => {
    if (typeof window === 'undefined') return { x: rawX, y: rawY };
    const safeWidth = Math.max(1, Number(width) || MOBILE_HEADER_COLLAPSE_CONFIG.floatingButtonSizePx);
    const safeHeight = Math.max(1, Number(height) || MOBILE_HEADER_COLLAPSE_CONFIG.floatingButtonSizePx);
    const edge = Math.max(0, Number(MOBILE_HEADER_COLLAPSE_CONFIG.viewportEdgePaddingPx) || 0);
    const maxX = Math.max(edge, window.innerWidth - safeWidth - edge);
    const maxY = Math.max(edge, window.innerHeight - safeHeight - edge);
    return {
      x: clamp(Number(rawX) || 0, edge, maxX),
      y: clamp(Number(rawY) || 0, edge, maxY)
    };
  }, []);

  const getMobileHeaderButtonSize = useCallback((targetKey) => {
    const node = mobileHeaderButtonNodeRef.current?.[targetKey];
    if (!(node instanceof Element)) {
      const fallback = MOBILE_HEADER_COLLAPSE_CONFIG.floatingButtonSizePx;
      return { width: fallback, height: fallback };
    }
    const rect = node.getBoundingClientRect();
    const fallback = MOBILE_HEADER_COLLAPSE_CONFIG.floatingButtonSizePx;
    return {
      width: Math.max(1, Math.round(rect.width || fallback)),
      height: Math.max(1, Math.round(rect.height || fallback))
    };
  }, []);

  const clearMobileHeaderLongPressTimer = useCallback(() => {
    if (!mobileHeaderLongPressTimerRef.current) return;
    window.clearTimeout(mobileHeaderLongPressTimerRef.current);
    mobileHeaderLongPressTimerRef.current = null;
  }, []);

  const resetMobileHeaderDrag = useCallback(() => {
    mobileHeaderDragRef.current = {
      key: '',
      pointerId: null,
      active: false,
      armed: false,
      dragging: false,
      startX: 0,
      startY: 0,
      offsetX: 0,
      offsetY: 0,
      width: MOBILE_HEADER_COLLAPSE_CONFIG.floatingButtonSizePx,
      height: MOBILE_HEADER_COLLAPSE_CONFIG.floatingButtonSizePx
    };
    setMobileHeaderDraggingKey('');
  }, []);

  useEffect(() => () => {
    clearMobileHeaderLongPressTimer();
    resetMobileHeaderDrag();
  }, [clearMobileHeaderLongPressTimer, resetMobileHeaderDrag]);

  useEffect(() => {
    if (isMobile) return;
    setMobileHeaderHidden({ menu: false, ai: false });
    setMobileHeaderHideTarget('');
    mobileHeaderSuppressClickRef.current = '';
    clearMobileHeaderLongPressTimer();
    resetMobileHeaderDrag();
  }, [clearMobileHeaderLongPressTimer, isMobile, resetMobileHeaderDrag]);

  useEffect(() => {
    if (!mobileHeaderHideTarget) return undefined;
    const handlePointerDown = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.gcal-mobile-strip-action')) return;
      setMobileHeaderHideTarget('');
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [mobileHeaderHideTarget]);

  useEffect(() => {
    const handlePointerMove = (event) => {
      const drag = mobileHeaderDragRef.current;
      if (!drag.active || event.pointerId !== drag.pointerId) return;
      if (!drag.armed) return;

      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      const distance = Math.hypot(dx, dy);
      const threshold = Math.max(3, Number(MOBILE_HEADER_COLLAPSE_CONFIG.dragStartDistancePx) || 8);

      if (!drag.dragging) {
        if (distance < threshold) return;
        drag.dragging = true;
        mobileHeaderSuppressClickRef.current = drag.key;
        setMobileHeaderDraggingKey(drag.key);
        setMobileHeaderHideTarget('');
      }

      const next = clampMobileHeaderPosition(
        event.clientX - drag.offsetX,
        event.clientY - drag.offsetY,
        drag.width,
        drag.height
      );
      setMobileHeaderButtonPositions((prev) => {
        const existing = prev?.[drag.key];
        if (existing && Math.abs(existing.x - next.x) < 0.5 && Math.abs(existing.y - next.y) < 0.5) return prev;
        return { ...prev, [drag.key]: next };
      });
      event.preventDefault();
      event.stopPropagation();
    };

    const finalizeDragPointer = (event) => {
      const drag = mobileHeaderDragRef.current;
      if (!drag.active || event.pointerId !== drag.pointerId) return;
      const wasDragging = drag.dragging;
      clearMobileHeaderLongPressTimer();
      mobileHeaderDragRef.current = {
        key: '',
        pointerId: null,
        active: false,
        armed: false,
        dragging: false,
        startX: 0,
        startY: 0,
        offsetX: 0,
        offsetY: 0,
        width: MOBILE_HEADER_COLLAPSE_CONFIG.floatingButtonSizePx,
        height: MOBILE_HEADER_COLLAPSE_CONFIG.floatingButtonSizePx
      };
      if (wasDragging) setMobileHeaderDraggingKey('');
    };

    window.addEventListener('pointermove', handlePointerMove, true);
    window.addEventListener('pointerup', finalizeDragPointer, true);
    window.addEventListener('pointercancel', finalizeDragPointer, true);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('pointerup', finalizeDragPointer, true);
      window.removeEventListener('pointercancel', finalizeDragPointer, true);
    };
  }, [clampMobileHeaderPosition, clearMobileHeaderLongPressTimer]);

  useEffect(() => {
    if (!isMobile) return undefined;
    const keepFloatingButtonsInViewport = () => {
      setMobileHeaderButtonPositions((prev) => {
        let changed = false;
        const next = { ...prev };
        ['menu', 'ai'].forEach((key) => {
          const pos = prev?.[key];
          if (!pos) return;
          const size = getMobileHeaderButtonSize(key);
          const clamped = clampMobileHeaderPosition(pos.x, pos.y, size.width, size.height);
          if (Math.abs(clamped.x - pos.x) > 0.5 || Math.abs(clamped.y - pos.y) > 0.5) {
            next[key] = clamped;
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    };
    window.addEventListener('resize', keepFloatingButtonsInViewport);
    window.addEventListener('orientationchange', keepFloatingButtonsInViewport);
    return () => {
      window.removeEventListener('resize', keepFloatingButtonsInViewport);
      window.removeEventListener('orientationchange', keepFloatingButtonsInViewport);
    };
  }, [clampMobileHeaderPosition, getMobileHeaderButtonSize, isMobile]);

  const startMobileHeaderLongPress = useCallback((targetKey, event) => {
    if (!isMobile) return;
    const pointerEvent = event;
    if (!pointerEvent || typeof pointerEvent.pointerId === 'undefined') return;
    const buttonEl = pointerEvent.currentTarget;
    const rect = buttonEl instanceof Element ? buttonEl.getBoundingClientRect() : null;
    const width = Math.max(1, Math.round(rect?.width || MOBILE_HEADER_COLLAPSE_CONFIG.floatingButtonSizePx));
    const height = Math.max(1, Math.round(rect?.height || MOBILE_HEADER_COLLAPSE_CONFIG.floatingButtonSizePx));
    const offsetX = Number(pointerEvent.clientX) - Number(rect?.left || 0);
    const offsetY = Number(pointerEvent.clientY) - Number(rect?.top || 0);

    mobileHeaderDragRef.current = {
      key: targetKey,
      pointerId: pointerEvent.pointerId,
      active: true,
      armed: false,
      dragging: false,
      startX: Number(pointerEvent.clientX) || 0,
      startY: Number(pointerEvent.clientY) || 0,
      offsetX: Number.isFinite(offsetX) ? offsetX : Math.round(width / 2),
      offsetY: Number.isFinite(offsetY) ? offsetY : Math.round(height / 2),
      width,
      height
    };

    try {
      buttonEl?.setPointerCapture?.(pointerEvent.pointerId);
    } catch (_) {
      // Pointer capture is optional on some devices.
    }

    clearMobileHeaderLongPressTimer();
    mobileHeaderLongPressTimerRef.current = window.setTimeout(() => {
      const drag = mobileHeaderDragRef.current;
      if (!drag.active || drag.key !== targetKey) return;
      drag.armed = true;
      mobileHeaderSuppressClickRef.current = targetKey;
      setMobileHeaderHideTarget(targetKey);
    }, Math.max(320, Number(MOBILE_HEADER_COLLAPSE_CONFIG.longPressMs) || 560));
  }, [clearMobileHeaderLongPressTimer, isMobile]);

  const endMobileHeaderLongPress = useCallback(() => {
    clearMobileHeaderLongPressTimer();
  }, [clearMobileHeaderLongPressTimer]);

  const collapseMobileHeaderButton = useCallback((targetKey, event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    clearMobileHeaderLongPressTimer();
    mobileHeaderSuppressClickRef.current = '';
    setMobileHeaderHidden((prev) => ({ ...prev, [targetKey]: true }));
    setMobileHeaderHideTarget('');
    if (targetKey === 'menu') setSidebarOpen(false);
  }, [clearMobileHeaderLongPressTimer]);

  const restoreMobileHeaderButton = useCallback((targetKey, event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    setMobileHeaderHidden((prev) => ({ ...prev, [targetKey]: false }));
    setMobileHeaderHideTarget('');
  }, []);

  const setMobileHeaderButtonNode = useCallback((targetKey, node) => {
    mobileHeaderButtonNodeRef.current = { ...mobileHeaderButtonNodeRef.current, [targetKey]: node };
  }, []);

  const getMobileStripActionStyle = useCallback((targetKey) => {
    const pos = mobileHeaderButtonPositions?.[targetKey];
    if (!pos || !Number.isFinite(pos?.x) || !Number.isFinite(pos?.y)) return undefined;
    return {
      position: 'fixed',
      left: `${pos.x}px`,
      top: `${pos.y}px`,
      zIndex: MOBILE_HEADER_COLLAPSE_CONFIG.floatingButtonZIndex,
      touchAction: 'none'
    };
  }, [mobileHeaderButtonPositions]);

  const handleMobileHeaderButtonTap = useCallback((targetKey, event, onTap) => {
    if (mobileHeaderSuppressClickRef.current === targetKey) {
      mobileHeaderSuppressClickRef.current = '';
      event?.preventDefault?.();
      event?.stopPropagation?.();
      return;
    }
    setMobileHeaderHideTarget('');
    onTap?.(event);
  }, []);

  const toggleSidebar = () => {
    setSidebarOpen((prev) => !prev);
    if (isMobile) {
      setViewDropdownOpen(false);
      setSettingsDropdownOpen(false);
    }
  };

  const openMobileAiPage = useCallback((event) => {
    event?.preventDefault?.();
    navigate('/ai');
  }, [navigate]);

  const openSearchFromHeader = (e) => {
    e.stopPropagation();
    const api = calendarRef.current?.getApi();
    const capturedView = String(api?.view?.type || viewType || 'dayGridMonth');
    const apiDate = api?.getDate?.();
    let capturedIso = '';
    if (apiDate instanceof Date && !Number.isNaN(apiDate.getTime())) {
      capturedIso = apiDate.toISOString();
    } else if (viewRange?.start instanceof Date && !Number.isNaN(viewRange.start.getTime())) {
      capturedIso = viewRange.start.toISOString();
    }
    searchReturnRef.current = { view: capturedView, dateIso: capturedIso };
    setSearchOpen(true);
  };

  const closeUserMenu = () => setUserMenuOpen(false);

  const goProfileDashboard = () => {
    closeUserMenu();
    if (isAdmin) {
      navigate('/admin/hall');
      return;
    }
    if (isFaculty) {
      navigate('/department/booking');
      return;
    }
    navigate('/department_login');
  };

  const logoutCurrentUser = async () => {
    closeUserMenu();
    try {
      await api.get('/logout', { withCredentials: true });
      dispatch(removeStatus());
      setSnackbarSeverity('success');
      setSnackbarMessage('Logged out successfully.');
      setSnackbarOpen(true);
    } catch (_) {
      setSnackbarSeverity('error');
      setSnackbarMessage('Logout failed. Please try again.');
      setSnackbarOpen(true);
    }
  };

  const renderUserMenu = () => (
    <div className="gcal-user-container">
      <button
        type="button"
        className={`gcal-avatar ${isAuthenticated ? 'logged-in' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          setUserMenuOpen((v) => !v);
        }}
        aria-label="Open user menu"
      >
        {isAuthenticated ? (isAdmin ? 'A' : 'F') : <Svgs.User />}
      </button>

      {userMenuOpen && (
        <div className="gcal-user-menu">
          {isAuthenticated ? (
            <>
              <button type="button" className="gcal-user-menu-item" onClick={() => { closeUserMenu(); navigate('/'); }}>HOME</button>
              <button type="button" className="gcal-user-menu-item" onClick={goProfileDashboard}>PROFILE</button>
              <button type="button" className="gcal-user-menu-item logout" onClick={logoutCurrentUser}>LOGOUT</button>
              <QuickPageMenu
                buttonLabel="MENU"
                buttonClassName="gcal-user-menu-item gcal-user-menu-quick-btn"
                panelClassName="gcal-user-menu-quick-panel"
                itemClassName="gcal-user-menu-quick-item"
                hideThemeToggle
                inlinePanel
                align="left"
                closeParentMenu={closeUserMenu}
              />
              {isMobile && (
                <>
                  <div className="gcal-dropdown-divider gcal-user-menu-divider"></div>
                  <div className="gcal-user-menu-section-label">SETTINGS</div>
                  <button type="button" className="gcal-user-menu-item" onClick={() => { closeUserMenu(); openPrintDialog(); }}>PRINT</button>
                  <button type="button" className="gcal-user-menu-item" onClick={() => { closeUserMenu(); navigate('/trash'); }}>TRASH</button>
                  <button type="button" className="gcal-user-menu-item" onClick={() => { closeUserMenu(); openAppearanceModal(); }}>APPEARANCE</button>
                </>
              )}
            </>
          ) : (
            <>
              <button type="button" className="gcal-user-menu-item" onClick={() => { closeUserMenu(); navigate('/department_login'); }}>FACULTY LOGIN</button>
              <button type="button" className="gcal-user-menu-item" onClick={() => { closeUserMenu(); navigate('/admin_login'); }}>ADMIN LOGIN</button>
              <button type="button" className="gcal-user-menu-item" onClick={() => { closeUserMenu(); navigate('/'); }}>HOME</button>
              <QuickPageMenu
                buttonLabel="MENU"
                buttonClassName="gcal-user-menu-item gcal-user-menu-quick-btn"
                panelClassName="gcal-user-menu-quick-panel"
                itemClassName="gcal-user-menu-quick-item"
                hideThemeToggle
                inlinePanel
                align="left"
                excludeKeys={['admin', 'faculty']}
                closeParentMenu={closeUserMenu}
              />
              {isMobile && (
                <>
                  <div className="gcal-dropdown-divider gcal-user-menu-divider"></div>
                  <div className="gcal-user-menu-section-label">SETTINGS</div>
                  <button type="button" className="gcal-user-menu-item" onClick={() => { closeUserMenu(); openPrintDialog(); }}>PRINT</button>
                  <button type="button" className="gcal-user-menu-item" onClick={() => { closeUserMenu(); navigate('/trash'); }}>TRASH</button>
                  <button type="button" className="gcal-user-menu-item" onClick={() => { closeUserMenu(); openAppearanceModal(); }}>APPEARANCE</button>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );

  const popoverDetails = pDetails();
  const canEditPopoverNotice = Boolean(isAdmin && popoverDetails?.isNotice && popoverDetails?.noticeId);
  const canDeletePopoverNotice = Boolean(isAdmin && popoverDetails?.isNotice && popoverDetails?.noticeId);
  const canEditPopoverTask = Boolean(popoverDetails?.isTask && (isAdmin || popoverDetails?.taskCanEdit));
  const canDeletePopoverTask = Boolean(popoverDetails?.isTask && (isAdmin || popoverDetails?.taskCanDelete));
  const canEditPopoverEvent = Boolean(canEditPopoverNotice || canEditPopoverTask);
  const canDeletePopoverEvent = Boolean(canDeletePopoverNotice || canDeletePopoverTask);
  const canCopyPopoverEvent = Boolean(popover?.eventData && ['NOTICE', 'NOTICE_BG', 'TASK'].includes(eventSourceOf(popover.eventData)));
  const popoverEditTarget = popoverDetails?.isTask ? 'TASK' : (popoverDetails?.isNotice ? 'NOTICE' : '');
  
  const popoverConnector = useMemo(() => {
    if (!popover.open || !popover.positionReady || !popover.anchorRect) return null;

    const cardWidth = popover.cardWidth || 520;
    const cardHeight = popover.cardHeight || 420;
    const isDayOrSchedule =
      popover.sourceView === 'timeGridDay' ||
      popover.sourceView === 'listYear' ||
      popover.sourceView === 'monthMore';
    const preciseX = Number(popover?.anchorPoint?.x);
    const preciseY = Number(popover?.anchorPoint?.y);
    const hasPrecisePoint = isDayOrSchedule && Number.isFinite(preciseX) && Number.isFinite(preciseY);
    const nameRect = popover?.connectorNameRect;
    const hasNameRect = popover.sourceView === 'listYear' &&
      Number.isFinite(Number(nameRect?.left)) &&
      Number.isFinite(Number(nameRect?.right)) &&
      Number.isFinite(Number(nameRect?.top)) &&
      Number.isFinite(Number(nameRect?.bottom));
    const strokeColor = popoverDetails?.badgeColor || '#1a73e8';
    const iconDx = CONNECTOR_ICON_HEAD.x - CONNECTOR_ICON_TAIL.x;
    const iconDy = CONNECTOR_ICON_HEAD.y - CONNECTOR_ICON_TAIL.y;
    const iconLength = Math.hypot(iconDx, iconDy) || 1;
    const iconAngle = Math.atan2(iconDy, iconDx);

    if (popover.sourceView === 'monthMore') {
      const rowRect = popover.anchorRect;
      const rowCenterX = rowRect.left + (rowRect.width / 2);
      const cardCenterX = popover.x + (cardWidth / 2);
      const cardOnLeft = cardCenterX <= rowCenterX;
      const tailY = clamp(
        rowRect.top + (rowRect.height / 2),
        8,
        window.innerHeight - 8
      );
      const tailX = cardOnLeft
        ? rowRect.left
        : rowRect.right;
      const headX = cardOnLeft
        ? (popover.x + cardWidth - MONTH_MORE_CONNECTOR_HEAD_INSET)
        : (popover.x + MONTH_MORE_CONNECTOR_HEAD_INSET);
      // Keep arrow head just inside card border while avoiding close icon area.
      // Let head Y follow tail Y (within safe card bounds) to avoid oversized arrows.
      const headY = clamp(
        tailY,
        popover.y + MONTH_MORE_CONNECTOR_HEAD_TOP_OFFSET,
        popover.y + cardHeight - 24
      );

      const desiredDx = headX - tailX;
      const desiredDy = headY - tailY;
      const desiredLength = Math.hypot(desiredDx, desiredDy) || 1;
      const desiredAngle = Math.atan2(desiredDy, desiredDx);
      const uniformScale = clamp(desiredLength / iconLength, 0.5, 1.25);
      // Symmetrical flip logic: ensures concave part always faces aesthetically inward
      // (e.g., bottom-right when on left, bottom-left when on right).
      const flipX = (cardOnLeft === (tailY < headY)) ? -1 : 1;
      const effectiveIconAngle = Math.atan2(iconDy, iconDx * flipX);
      const rotateDeg = ((desiredAngle - effectiveIconAngle) * 180) / Math.PI;

      return {
        transform: `translate(${tailX} ${tailY}) rotate(${rotateDeg}) scale(${flipX * uniformScale} ${uniformScale}) translate(${-CONNECTOR_ICON_TAIL.x} ${-CONNECTOR_ICON_TAIL.y})`,
        strokeColor
      };
    }

    if (popover.sourceView === 'listYear') {
      const nameTailX = hasNameRect
        ? Number(nameRect.right)+4
        : (hasPrecisePoint ? preciseX : popover.anchorRect.right - 2);
      const nameTailY = clamp(
        hasNameRect
          ? ((Number(nameRect.top) + Number(nameRect.bottom)) / 2)
          : (hasPrecisePoint ? preciseY : (popover.anchorRect.top + (popover.anchorRect.height / 2))),
        8,
        window.innerHeight - 8
      );

      const headX = clamp(
        popover.x + SCHEDULE_CONNECTOR_HEAD_INSET_X,
        popover.x + 10,
        popover.x + Math.max(10, cardWidth - 10)
      );
      // Keep schedule connector perfectly horizontal: arrow head and tail share same Y.
      const headY = clamp(
        nameTailY,
        popover.y + 18,
        popover.y + cardHeight - 18
      );

      const arrowLength = iconLength * SCHEDULE_CONNECTOR_FIXED_SCALE;
      const directionDx = headX - nameTailX;
      const directionDy = headY - nameTailY;
      const directionLength = Math.hypot(directionDx, directionDy) || 1;
      const nx = directionDx / directionLength;
      const ny = directionDy / directionLength;

      const arrowTailX = headX - (nx * arrowLength);
      const arrowTailY = headY - (ny * arrowLength);

      const rotateDeg = ((Math.atan2(headY - arrowTailY, headX - arrowTailX) - iconAngle) * 180) / Math.PI;

      return {
        transform: `translate(${arrowTailX} ${arrowTailY}) rotate(${rotateDeg}) scale(${SCHEDULE_CONNECTOR_FIXED_SCALE}) translate(${-CONNECTOR_ICON_TAIL.x} ${-CONNECTOR_ICON_TAIL.y})`,
        strokeColor,
        leadLine: {
          x1: nameTailX,
          y1: nameTailY,
          x2: arrowTailX,
          y2: arrowTailY
        }
      };
    }

    const tailX = hasNameRect
      ? (popover.placement === 'right' ? Number(nameRect.right)+4 : Number(nameRect.left))
      : (
        hasPrecisePoint
          ? preciseX
          : (
            popover.placement === 'right'
              ? popover.anchorRect.right + 1
              : popover.anchorRect.left - 1
          )
      );
    const tailY = clamp(
      hasNameRect
        ? ((Number(nameRect.top) + Number(nameRect.bottom)) / 2)
        : (hasPrecisePoint ? preciseY : (popover.anchorRect.top + (popover.anchorRect.height / 2))),
      8,
      window.innerHeight - 8
    );
    let headX = popover.placement === 'right'
      ? popover.x + 24
      : popover.x + cardWidth - 24;
    let headY = clamp(
      tailY + 18,
      popover.y + 72,
      popover.y + cardHeight - 24
    );

    const desiredDx = headX - tailX;
    const desiredDy = headY - tailY;
    const desiredLength = Math.hypot(desiredDx, desiredDy) || 1;
    const desiredAngle = Math.atan2(desiredDy, desiredDx);

    const minScale = 0.5;
    const maxScale = 1.25;
    const uniformScale = clamp(desiredLength / iconLength, minScale, maxScale);
    // Standard connector (direct cell click): apply symmetrical flip logic
    const isLeft = popover.placement === 'left';
    const flipX = (isLeft === (tailY < headY)) ? -1 : 1;
    const effectiveIconAngle = Math.atan2(iconDy, iconDx * flipX);
    const rotateDeg = ((desiredAngle - effectiveIconAngle) * 180) / Math.PI;

    return {
      transform: `translate(${tailX} ${tailY}) rotate(${rotateDeg}) scale(${flipX * uniformScale} ${uniformScale}) translate(${-CONNECTOR_ICON_TAIL.x} ${-CONNECTOR_ICON_TAIL.y})`,
      strokeColor
    };
  }, [popover, popoverDetails?.badgeColor]);

  const calendarLogoSrc = `https://ssl.gstatic.com/calendar/images/dynamiclogo_2020q4/calendar_${logoDay}_2x.png`;
  const clockTimeText = new Intl.DateTimeFormat('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata'
  }).format(new Date(headerClockTick));
  const headerClockText = `${clockTimeText} IST`;
  const mobileHeaderStripStyle = isMobile ? {
    '--gcal-mobile-mini-circle-size': `${MOBILE_HEADER_COLLAPSE_CONFIG.miniCircleSize}px`,
    '--gcal-mobile-mini-circle-icon-size': `${MOBILE_HEADER_COLLAPSE_CONFIG.miniCircleIconSize}px`,
    '--gcal-mobile-hide-x-size': `${MOBILE_HEADER_COLLAPSE_CONFIG.hideXSize}px`,
    '--gcal-mobile-hide-x-font-size': `${MOBILE_HEADER_COLLAPSE_CONFIG.hideXFontSize}px`
  } : undefined;

  return (
    <div
      className={`gcal-page theme-${themeMode.toLowerCase()}${isMobile ? ' gcal-mobile' : ''}${searchOpen ? ' search-open' : ''}${viewType === 'timeGridWeek' ? (weekAllDayExpanded ? ' week-all-day-expanded' : ' week-all-day-collapsed') : ''}${viewType === 'timeGridDay' ? (dayAllDayExpanded ? ' day-all-day-expanded' : ' day-all-day-collapsed') : ''}`}
    >
      {isMobile && (
        <div className="gcal-mobile-time-strip" aria-label="Current time in IST" style={mobileHeaderStripStyle}>
          {!searchOpen && (
            <div className="gcal-mobile-time-strip-left">
              {!mobileHeaderHidden.menu && (
                <div
                  className={`gcal-mobile-strip-action${getMobileStripActionStyle('menu') ? ' is-floating' : ''}`}
                  style={getMobileStripActionStyle('menu')}
                >
                  <button
                    type="button"
                    ref={(node) => setMobileHeaderButtonNode('menu', node)}
                    className={`gcal-icon-btn${mobileHeaderDraggingKey === 'menu' ? ' is-dragging' : ''}`.trim()}
                    aria-label="Main menu"
                    onClick={(event) => handleMobileHeaderButtonTap('menu', event, toggleSidebar)}
                    onPointerDown={(event) => startMobileHeaderLongPress('menu', event)}
                    onPointerUp={endMobileHeaderLongPress}
                    onPointerCancel={endMobileHeaderLongPress}
                    onPointerLeave={endMobileHeaderLongPress}
                  >
                    <Svgs.Menu />
                  </button>
                  {mobileHeaderHideTarget === 'menu' && (
                    <button
                      type="button"
                      className="gcal-mobile-strip-hide-btn"
                      aria-label="Collapse menu button"
                      onClick={(event) => collapseMobileHeaderButton('menu', event)}
                    >
                      x
                    </button>
                  )}
                </div>
              )}
              {!mobileHeaderHidden.ai && (
                <div
                  className={`gcal-mobile-strip-action${getMobileStripActionStyle('ai') ? ' is-floating' : ''}`}
                  style={getMobileStripActionStyle('ai')}
                >
                  <button
                    type="button"
                    ref={(node) => setMobileHeaderButtonNode('ai', node)}
                    className={`gcal-icon-btn gcal-mobile-ai-btn${mobileHeaderDraggingKey === 'ai' ? ' is-dragging' : ''}`.trim()}
                    aria-label="Open AI assistant"
                    onClick={(event) => handleMobileHeaderButtonTap('ai', event, openMobileAiPage)}
                    onPointerDown={(event) => startMobileHeaderLongPress('ai', event)}
                    onPointerUp={endMobileHeaderLongPress}
                    onPointerCancel={endMobileHeaderLongPress}
                    onPointerLeave={endMobileHeaderLongPress}
                  >
                    <Svgs.AI />
                  </button>
                  {mobileHeaderHideTarget === 'ai' && (
                    <button
                      type="button"
                      className="gcal-mobile-strip-hide-btn"
                      aria-label="Collapse AI button"
                      onClick={(event) => collapseMobileHeaderButton('ai', event)}
                    >
                      x
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          <span className="gcal-mobile-time-value">{clockTimeText}</span>
          {!searchOpen && (mobileHeaderHidden.menu || mobileHeaderHidden.ai) && (
            <div className="gcal-mobile-time-strip-right">
              {mobileHeaderHidden.menu && (
                <button
                  type="button"
                  className="gcal-mobile-collapse-dot menu-dot"
                  aria-label="Restore menu button"
                  onClick={(event) => restoreMobileHeaderButton('menu', event)}
                >
                  <Svgs.Menu />
                </button>
              )}
              {mobileHeaderHidden.ai && (
                <button
                  type="button"
                  className="gcal-mobile-collapse-dot ai-dot"
                  aria-label="Restore AI button"
                  onClick={(event) => restoreMobileHeaderButton('ai', event)}
                >
                  <Svgs.AI />
                </button>
              )}
            </div>
          )}
        </div>
      )}
      
      {/* Top Navigation Bar - Switches Mode when Searching */}
      <header className="gcal-topbar">
        {!searchOpen ? (
          isMobile ? (
            <div className="gcal-mobile-nav-row">
              <div className="gcal-mobile-nav-left">
                <button
                  type="button"
                  className="gcal-icon-btn gcal-create-mini-btn"
                  onClick={openTaskModalFromCreate}
                  aria-label="Create public task"
                >
                  <Svgs.Plus />
                </button>
              </div>
              <div className="gcal-mobile-nav-center">
                <button type="button" className="gcal-icon-btn nav" onClick={() => executeCalendarCommand('prev')} aria-label="Previous">
                  <svg width="20" height="20" viewBox="0 0 24 24"><path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41z"></path></svg>
                </button>
                <h2 className="gcal-view-title">{displayViewTitle}</h2>
                <button type="button" className="gcal-icon-btn nav" onClick={() => executeCalendarCommand('next')} aria-label="Next">
                  <svg width="20" height="20" viewBox="0 0 24 24"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"></path></svg>
                </button>
              </div>
              <div className="gcal-mobile-nav-right">
                <button
                  className="gcal-icon-btn gcal-search-icon-btn"
                  onClick={openSearchFromHeader}
                  aria-label="Open search"
                >
                  <Svgs.Search />
                </button>
                <button
                  type="button"
                  className="gcal-btn-today gcal-btn-today-mobile"
                  onClick={() => executeCalendarCommand('today')}
                  aria-label="Go to today"
                >
                  {mobileTodayLabel}
                </button>
                {renderUserMenu()}
              </div>
            </div>
          ) : (
            <>
              <div className="gcal-top-left">
                <button type="button" className="gcal-icon-btn" onClick={toggleSidebar} aria-label="Main menu"><Svgs.Menu /></button>
                <div className="gcal-brand">
                  <img src={calendarLogoSrc} alt="Calendar" className="gcal-logo-img" />
                  <span>Calendar</span>
                </div>
              </div>

              <div className="gcal-top-center">
                <button type="button" className="gcal-btn-today" onClick={() => executeCalendarCommand('today')}>Today</button>
                <div className="gcal-nav-arrows">
                  <button type="button" className="gcal-icon-btn nav" onClick={() => executeCalendarCommand('prev')} aria-label="Previous">
                    <svg width="20" height="20" viewBox="0 0 24 24"><path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41z"></path></svg>
                  </button>
                  <button type="button" className="gcal-icon-btn nav" onClick={() => executeCalendarCommand('next')} aria-label="Next">
                    <svg width="20" height="20" viewBox="0 0 24 24"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"></path></svg>
                  </button>
                </div>
                <h2 className="gcal-view-title">{displayViewTitle}</h2>
              </div>

              <div className="gcal-top-right">
                <div className="gcal-header-clock" aria-label="Current time in IST">
                  {headerClockText}
                </div>
                <button
                  className="gcal-icon-btn gcal-search-icon-btn"
                  onClick={openSearchFromHeader}
                >
                  <Svgs.Search />
                </button>
              
                {/* Settings Dropdown */}
                <div className="gcal-settings-container">
                  <button className="gcal-icon-btn" onClick={() => setSettingsDropdownOpen(!settingsDropdownOpen)}><Svgs.Settings /></button>
                  {settingsDropdownOpen && (
                    <div className="gcal-dropdown-menu settings-menu">
                      <div className="gcal-dropdown-item" onClick={openPrintDialog}>
                        Print
                        <span className="hotkey">{printShortcutHint}</span>
                      </div>
                      <div className="gcal-dropdown-item" onClick={() => {
                        setSettingsDropdownOpen(false);
                        navigate('/trash');
                      }}>
                        Trash
                        <span className="hotkey">{trashShortcutHint}</span>
                      </div>
                      <div className="gcal-dropdown-divider"></div>
                      <div className="gcal-dropdown-item" onClick={openAppearanceModal}>
                        Appearance
                        <span className="hotkey">{appearanceShortcutHint}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* View Selector Dropdown */}
                <div className="gcal-view-selector-container">
                  <button className="gcal-view-selector-btn" onClick={() => setViewDropdownOpen(!viewDropdownOpen)}>
                    {viewLabels[viewType]} <Svgs.CaretDown />
                  </button>
                  {viewDropdownOpen && (
                    <div className="gcal-dropdown-menu view-menu">
                      <div className="gcal-dropdown-item" onClick={() => handleViewChange('timeGridDay')}>Day <span className="hotkey">D</span></div>
                      <div className="gcal-dropdown-item" onClick={() => handleViewChange('timeGridWeek')}>Week <span className="hotkey">W</span></div>
                      <div className="gcal-dropdown-item" onClick={() => handleViewChange('dayGridMonth')}>Month <span className="hotkey">M</span></div>
                      <div className="gcal-dropdown-item" onClick={() => handleViewChange('multiMonthYear')}>Year <span className="hotkey">Y</span></div>
                      <div className="gcal-dropdown-item" onClick={() => handleViewChange('listYear')}>Schedule <span className="hotkey">S</span></div>
                      <div className="gcal-dropdown-divider"></div>
                      <div className="gcal-dropdown-item checkbox-item" onClick={(e) => { e.stopPropagation(); setViewOptions({...viewOptions, weekends: !viewOptions.weekends}); }}>
                        <span className="check-area">{viewOptions.weekends && <Svgs.Check />}</span> Show weekends
                      </div>
                      <div className="gcal-dropdown-item checkbox-item" onClick={(e) => { e.stopPropagation(); setViewOptions({...viewOptions, declined: !viewOptions.declined}); }}>
                        <span className="check-area">{viewOptions.declined && <Svgs.Check />}</span> Show declined events
                      </div>
                    </div>
                  )}
                </div>
                {renderUserMenu()}
              </div>
            </>
          )
        ) : (
          <div className="gcal-search-header">
            <div className="gcal-search-back">
              <button
                className="gcal-icon-btn"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const restoreView = String(searchReturnRef.current?.view || viewType || 'dayGridMonth');
                  const restoreIso = String(searchReturnRef.current?.dateIso || '');
                  setViewType(restoreView);
                  if (restoreIso) setPendingGotoIso(restoreIso);
                  setSearchOpen(false);
                  clearSearchState();
                }}
                onClick={(e) => e.preventDefault()}
              >
                <Svgs.Back />
              </button>
              <span className="search-title">Search</span>
            </div>
            <div className="gcal-search-input-box">
              <button className="gcal-icon-btn inside-search" onClick={executeSearch}><Svgs.Search /></button>
              <input 
                type="text" 
                placeholder="Search" 
                value={searchQuery}
                onChange={(e) => {
                  const nextValue = e.target.value;
                  setSearchQuery(nextValue);
                  if (!String(nextValue || '').trim()) {
                    setSearchResults([]);
                    setSearchMessage('');
                    setSearchExecutedQuery('');
                  }
                }}
                onKeyDown={executeSearch}
                autoFocus
              />
            {searchQuery && (
                <button className="gcal-icon-btn inside-search-close" onClick={clearSearchState}><Svgs.Close /></button>
              )}
            </div>
          </div>
        )}
      </header>

      <div className={`gcal-layout ${!sidebarOpen ? 'sidebar-closed' : ''}`}>
        {isMobile && sidebarOpen && !searchOpen && (
          <button
            type="button"
            className="gcal-sidebar-scrim"
            aria-label="Close sidebar"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        
        {/* Sidebar */}
        <aside className="gcal-sidebar">
          {!searchOpen && !isMobile && (
            <div className="gcal-create-wrapper">
              <button type="button" className="gcal-fab" onClick={openTaskModalFromCreate}>
                <Svgs.Plus /> <span>Create</span>
              </button>
            </div>
          )}

          {isMobile && !searchOpen && (
            <div className="gcal-mobile-sidebar-section">
              <div className="gcal-mobile-sidebar-title">Views</div>
              <div className="gcal-mobile-view-grid">
                {Object.entries(viewLabels).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`gcal-mobile-view-btn ${viewType === value ? 'is-active' : ''}`}
                    onClick={() => {
                      handleViewChange(value);
                      setSidebarOpen(false);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="gcal-mobile-view-toggles">
                <label className="gcal-checkbox-label gcal-mobile-view-toggle">
                  <input
                    type="checkbox"
                    checked={viewOptions.weekends}
                    onChange={() => setViewOptions({ ...viewOptions, weekends: !viewOptions.weekends })}
                  />
                  <div className="gcal-checkbox-custom cb-blue">{viewOptions.weekends && <Svgs.Check />}</div>
                  <span className="gcal-checkbox-text">Show weekends</span>
                </label>
                <label className="gcal-checkbox-label gcal-mobile-view-toggle">
                  <input
                    type="checkbox"
                    checked={viewOptions.declined}
                    onChange={() => setViewOptions({ ...viewOptions, declined: !viewOptions.declined })}
                  />
                  <div className="gcal-checkbox-custom cb-purple">{viewOptions.declined && <Svgs.Check />}</div>
                  <span className="gcal-checkbox-text">Show declined events</span>
                </label>
              </div>
            </div>
          )}

          <div className="gcal-mini-month">
            <div className="gcal-mini-head">
              <strong>{MONTHS[miniAnchorDate.getMonth()]} {miniAnchorDate.getFullYear()}</strong>
              <div>
                <button type="button" onClick={() => moveMiniMonth(-1)}><svg viewBox="0 0 24 24" width="20" height="20"><path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41z"></path></svg></button>
                <button type="button" onClick={() => moveMiniMonth(1)}><svg viewBox="0 0 24 24" width="20" height="20"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"></path></svg></button>
              </div>
            </div>
            <div className="gcal-mini-grid">
              {WEEK_DAYS.map((day, idx) => <div key={`label-${idx}`} className="label">{day}</div>)}
              {miniDays.map((dateObj) => {
                const isTdy = sameDay(dateObj, new Date());
                const outside = dateObj.getMonth() !== miniAnchorDate.getMonth();
                return (
                  <button key={dateObj.toISOString()} type="button" className={`date-cell ${outside ? 'outside' : ''} ${isTdy ? 'today' : ''}`} onClick={() => goToMiniDate(dateObj)}>
                    <span>{dateObj.getDate()}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="gcal-accordion">
            <button className="gcal-accordion-header" onClick={() => setMyCalsOpen(!myCalsOpen)}>
              <span className="caret" style={{ transform: myCalsOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}><Svgs.CaretDown /></span>
              <span>My calendars</span>
            </button>
            {myCalsOpen && (
              <div className="gcal-accordion-content">
                <label className="gcal-checkbox-label">
                  <input type="checkbox" checked={filters.notice} onChange={() => toggleFilter('notice')} />
                  <div className="gcal-checkbox-custom cb-blue">{filters.notice && <Svgs.Check />}</div>
                  <span className="gcal-checkbox-text">Notices</span>
                </label>
                <label className="gcal-checkbox-label">
                  <input type="checkbox" checked={filters.alert} onChange={() => toggleFilter('alert')} />
                  <div className="gcal-checkbox-custom cb-red">{filters.alert && <Svgs.Check />}</div>
                  <span className="gcal-checkbox-text">Alerts / Closures</span>
                </label>
              </div>
            )}
          </div>

          <div className="gcal-accordion">
            <button className="gcal-accordion-header" onClick={() => setOtherCalsOpen(!otherCalsOpen)}>
              <span className="caret" style={{ transform: otherCalsOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}><Svgs.CaretDown /></span>
              <span>Other calendars</span>
            </button>
            {otherCalsOpen && (
              <div className="gcal-accordion-content">
                <label className="gcal-checkbox-label">
                  <input type="checkbox" checked={filters.festival} onChange={() => toggleFilter('festival')} />
                  <div className="gcal-checkbox-custom cb-green">{filters.festival && <Svgs.Check />}</div>
                  <span className="gcal-checkbox-text">Holidays in India</span>
                </label>
                <label className="gcal-checkbox-label">
                  <input type="checkbox" checked={filters.task} onChange={() => toggleFilter('task')} />
                  <div className="gcal-checkbox-custom cb-purple">{filters.task && <Svgs.Check />}</div>
                  <span className="gcal-checkbox-text">Public Tasks</span>
                </label>
              </div>
            )}
          </div>

          <div className="gcal-sidebar-footer">
            <button
              type="button"
              className="gcal-sidebar-footer-link"
              onClick={() => navigate('/schedule')}
            >
              Schedule
            </button>
            <span className="gcal-sidebar-footer-divider">&middot;</span>
            <button
              type="button"
              className="gcal-sidebar-footer-link"
              onClick={() => navigate('/notices')}
            >
              Notices
            </button>
          </div>
        </aside>

        {/* Main Calendar View */}
        <main className="gcal-main">
          {/* Floating Create FAB when sidebar is collapsed */}
          {!sidebarOpen && !searchOpen && !isMobile && (
            <button
              type="button"
              className="gcal-collapsed-fab"
              onClick={openTaskModalFromCreate}
              aria-label="Create Task"
            >
              <Svgs.Plus />
            </button>
          )}

          {error && <div className="gcal-banner error">{error}</div>}
          {taskMessage && <div className="gcal-banner info">{taskMessage}</div>}

          {shouldShowSearchPanel ? (
            <section className="gcal-search-results-shell">
              <div className="gcal-search-results-head">
                <h3>Search Results</h3>
                <p>
                  {searchLoading
                    ? 'Searching events across months and years...'
                    : searchExecutedQuery
                      ? `${visibleSearchResults.length} result${visibleSearchResults.length === 1 ? '' : 's'} found for "${searchExecutedQuery}".`
                      : 'Search works across current, previous, and upcoming years.'}
                </p>
              </div>

              {searchMessage && <div className="gcal-banner info">{searchMessage}</div>}

              {!searchLoading && !searchMessage && searchExecutedQuery && groupedSearchResults.length === 0 && (
                <div className="gcal-search-results-empty">No matching events found in the expanded calendar range.</div>
              )}

              {!searchLoading && groupedSearchResults.length > 0 && (
                <div className="gcal-search-results-list">
                  {groupedSearchResults.map((group) => (
                    <section key={group.key} className="gcal-search-month-group">
                      <h4 className="gcal-search-month-label">{group.label}</h4>
                      {group.items.map((event, idx) => {
                        const badge = toSearchBadge(event);
                        const dateLabel = formatResultDate(event);
                        const timeLabel = formatResultTime(event);
                        const description = eventDescriptionOf(event);
                        const noticeId = eventNoticeIdOf(event);
                        const source = eventSourceOf(event);
                        const showNoticeButton = (source === 'NOTICE' || source === 'NOTICE_BG') && Boolean(noticeId);
                        const openLabel = isAlertNotice(event) ? 'Open Alert' : 'Open Notice';
                        return (
                          <article
                            key={`${group.key}-${String(event?.id || event?.title || 'event')}-${idx}`}
                            className="gcal-search-result-item"
                            onClick={() => openSearchResult(event)}
                          >
                            <div className="gcal-search-result-date">
                              <strong>{dateLabel.day}</strong>
                              <span>{dateLabel.full}</span>
                            </div>
                            <div className="gcal-search-result-content">
                              <div className="gcal-search-result-meta">
                                <span className={`gcal-search-badge ${badge.className}`}>{badge.label}</span>
                                <span className="gcal-search-time">{timeLabel}</span>
                              </div>
                              <h5>{event?.title || 'Untitled event'}</h5>
                              {description && <p>{description.length > 240 ? `${description.slice(0, 240)}...` : description}</p>}
                            </div>
                            {showNoticeButton ? (
                              <button
                                type="button"
                                className="gcal-search-open-btn"
                              onClick={(ev) => {
                                ev.stopPropagation();
                                openSearchResult(event, { forceNoticeOpen: true });
                              }}
                            >
                                {openLabel}
                              </button>
                            ) : null}
                          </article>
                        );
                      })}
                    </section>
                  ))}
                </div>
              )}
            </section>
          ) : (
            <div
              ref={calendarCardRef}
              className={`gcal-calendar-card ${viewType === 'multiMonthYear' ? 'year-view-mode' : ''}${viewType === 'listYear' ? ' schedule-view-mode' : ''}${isMobile && MOBILE_SWIPE_ENABLED_VIEWS.has(viewType) ? ' mobile-swipe-enabled' : ''}`}
            >
              {viewType === 'multiMonthYear' && (
                <section className="gcal-custom-year-wrapper" aria-label={`Year view ${activeYearForCustomView}`}>
                  <div className="calendar-year">
                    {yearViewMonths.map((month) => (
                      <article className="month-container" key={month.monthIndex}>
                        <div className="month-title">{month.monthName}</div>
                        <div className="days-header">
                          {WEEK_DAYS.map((d, idx) => (
                            <div className="day-name" key={`${month.monthIndex}-head-${idx}`}>{d}</div>
                          ))}
                        </div>
                        <div className="days-grid">
                          {month.cells.map((cell) => (
                            <div className={`day ${cell.className}`} key={cell.key}>
                              {cell.value}
                            </div>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              )}
              {viewType === 'listYear' && (
                <section
                  className="gcal-schedule-panel"
                  ref={schedulePanelRef}
                  onDragOver={handleSchedulePanelDragOver}
                >
                  <div className="schedule-wrapper" id="schedule-container" ref={scheduleWrapperRef}>
                    {scheduleGroups.map((group) => (
                      <div
                        key={group.dateKey}
                        className={`day-group ${group.isToday ? 'is-today' : ''}${scheduleDragTargetDateKey === group.dateKey ? ' schedule-drop-target' : ''}`}
                        data-date-key={group.dateKey}
                        onDragOver={(ev) => handleScheduleRowDragOver(group.dateKey, ev)}
                        onDrop={(ev) => handleScheduleRowDrop(group.dateKey, ev)}
                      >
                        <div className="date-col">
                          <div className="date-number">{group.dayNum}</div>
                          <div className="date-label">{group.label}</div>
                        </div>
                        <div className="events-col">
                          {group.isToday && (
                            <div
                              className="current-time-indicator"
                              style={{ top: `${getScheduleIndicatorTop(group)}px` }}
                            ></div>
                          )}
                          {group.events.length === 0 ? (
                            <div className="event-item event-item-empty" aria-hidden="true"></div>
                          ) : (
                            group.events.map((evt, idx) => (
                              <div key={`${group.dateKey}-${idx}`} className="event-item">
                                <div
                                  className={`event-click-zone ${canDragCalendarEvent(evt.popoverEventData) ? 'is-draggable' : ''}`}
                                  role="button"
                                  tabIndex={0}
                                  draggable={canDragCalendarEvent(evt.popoverEventData)}
                                  onDragStart={(ev) => handleScheduleDragStart(evt, ev)}
                                  onDragEnd={handleScheduleDragEnd}
                                  onClick={(ev) => handleScheduleEventClick(evt, ev)}
                                  onKeyDown={(ev) => {
                                    if (ev.key === 'Enter' || ev.key === ' ') {
                                      handleScheduleEventClick(evt, ev);
                                    }
                                  }}
                                >
                                  <div className="event-dot" style={{ backgroundColor: evt.color }}></div>
                                  <div className="event-time">{evt.time || 'All day'}</div>
                                  <div className="event-title">
                                    {evt.icon === 'empty-circle' && <span className="icon-circle-empty"></span>}
                                    <span>{evt.title}</span>
                                    {evt.location && <span className="event-location">{evt.location}</span>}
                                  </div>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              <FullCalendar
                ref={calendarRef}
                plugins={[dayGridPlugin, timeGridPlugin, multiMonthPlugin, interactionPlugin, listPlugin]}
                initialView={viewType || 'dayGridMonth'}
                headerToolbar={false}
                weekends={viewOptions.weekends}
                events={filteredEvents}
                eventClassNames={eventClassNames}
                eventDidMount={handleEventDidMount}
                eventClick={handleEventClick}
                dateClick={handleDateClick}
                datesSet={handleDatesSet}
                moreLinkClick={handleMoreLinkClick}
                moreLinkContent={(arg) => (
                  isMobile && viewType === 'dayGridMonth'
                    ? `+${arg.num} more`
                    : `+${arg.num}`
                )}
                dayMaxEvents={true} 
                eventOrder={compareCalendarEventPriority}
                eventOrderStrict={true}
                fixedWeekCount={false}
                showNonCurrentDates={true}
                nowIndicator={true}
                editable={viewType === 'dayGridMonth' || viewType === 'timeGridWeek'}
                eventStartEditable={viewType === 'dayGridMonth' || viewType === 'timeGridWeek'}
                eventDurationEditable={false}
                eventResizableFromStart={false}
                eventAllow={(dropInfo, draggedEvent) => {
                  const vType = String(calendarRef.current?.getApi()?.view?.type || viewType || '');
                  if (vType !== 'dayGridMonth' && vType !== 'timeGridWeek') return false;
                  return canDragCalendarEvent(draggedEvent);
                }}
                eventDrop={handleEventDrop}
                eventDragStart={handleEventDragStart}
                eventDragStop={handleEventDragStop}
                eventChange={handleEventChange}
                height="100%"
                displayEventTime={true}
                eventTimeFormat={{ hour: 'numeric', minute: '2-digit', meridiem: 'lowercase' }}
                slotLabelFormat={{ hour: 'numeric', meridiem: 'short' }}
                views={{
                  timeGridDay: {
                    allDayText: '',
                    allDayContent: renderDayAllDayContent,
                    dayMaxEvents: false,
                    dayMaxEventRows: dayAllDayExpanded ? false : DAY_COLLAPSED_DAY_MAX_EVENT_ROWS,
                    slotDuration: '01:00:00',
                    slotLabelInterval: '01:00:00',
                    slotLabelContent: (arg) => {
                      const raw = String(arg?.text || '');
                      return raw.replace(/(\d+)(am|pm)\b/i, '$1 $2');
                    },
                    dayHeaderContent: (arg) => (
                      <div className="gcal-day-header-custom">
                        <span className="gcal-day-name">{arg.date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()}</span>
                        <span className={`gcal-day-number ${arg.isToday ? 'is-today' : ''}`}>{arg.date.getDate()}</span>
                      </div>
                    )
                  },
                  timeGridWeek: {
                    allDayText: '',
                    allDayContent: renderWeekAllDayContent,
                    dayMaxEvents: false,
                    dayMaxEventRows: weekAllDayExpanded ? false : WEEK_COLLAPSED_DAY_MAX_EVENT_ROWS,
                    slotDuration: '01:00:00',
                    slotLabelInterval: '01:00:00',
                    slotLabelContent: (arg) => {
                      const raw = String(arg?.text || '');
                      return raw.replace(/(\d+)(am|pm)\b/i, '$1 $2');
                    },
                    dayHeaderContent: (arg) => (
                      <div className="gcal-day-header-custom">
                        <span className="gcal-day-name">{arg.date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()}</span>
                        <span className={`gcal-day-number ${arg.isToday ? 'is-today' : ''}`}>{arg.date.getDate()}</span>
                      </div>
                    )
                  },
                  dayGridMonth: {
                    dayHeaderFormat: { weekday: 'short' },
                    dayMaxEvents: isMobile ? 2 : true
                  },
                  multiMonthYear: {
                    multiMonthMaxColumns: 4,
                    multiMonthMinWidth: 160,
                    showNonCurrentDates: true,
                    dayHeaderFormat: { weekday: 'narrow' }
                  },
                  listYear: {
                    dayHeaderContent: (arg) => {
                      const d = arg.date.getDate();
                      const m = arg.date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
                      const w = arg.date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
                      return (
                        <div className="gcal-list-header-custom">
                          <span className="list-date-num">{d}</span>
                          <span className="list-date-text">{m}, {w}</span>
                        </div>
                      );
                    }
                  }
                }}
              />
            </div>
          )}
        </main>
      </div>

      {monthMorePopup.open && (
        <>
          <div
            className="gcal-month-more-backdrop"
            onClick={() => {
              if (popover.open) return;
              closeMonthMorePopup();
            }}
          ></div>
          <div className="gcal-month-more-layer">
            <div className="gcal-popup gcal-month-more-popup" style={{ top: monthMorePopup.y, left: monthMorePopup.x }}>
              <div className="gcal-popup-header">
                <button type="button" className="gcal-close-btn" onClick={closeMonthMorePopup} aria-label="Close">
                  <svg viewBox="0 0 24 24">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"></path>
                  </svg>
                </button>
                <div className="gcal-day">{monthMorePopup.dayText}</div>
                <div className="gcal-date">{monthMorePopup.dateNumber}</div>
              </div>
              <div className="gcal-events-list">
                {monthMorePopup.events.map((ev, idx) => (
                  ev.isAllDay ? (
                    <div
                      key={`more-solid-${idx}`}
                      className={`gcal-event solid ${canDragCalendarEvent(ev.eventData) ? 'is-draggable' : ''}`}
                      style={{ backgroundColor: ev.bgColor, color: ev.textColor || '#ffffff' }}
                      role="button"
                      tabIndex={0}
                      draggable={canDragCalendarEvent(ev.eventData)}
                      onDragStart={(e) => handleMonthMoreEventDragStart(ev, e)}
                      onDragEnd={handleMonthMoreEventDragEnd}
                      onClick={(e) => handleMonthMoreEventClick(ev, e)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          handleMonthMoreEventClick(ev, e);
                        }
                      }}
                    >
                      {ev.hasCircleIcon && <div className="gcal-event-icon"></div>}
                      <span className="gcal-title">{ev.title}</span>
                    </div>
                  ) : (
                    <div
                      key={`more-timed-${idx}`}
                      className={`gcal-event timed ${canDragCalendarEvent(ev.eventData) ? 'is-draggable' : ''}`}
                      role="button"
                      tabIndex={0}
                      draggable={canDragCalendarEvent(ev.eventData)}
                      onDragStart={(e) => handleMonthMoreEventDragStart(ev, e)}
                      onDragEnd={handleMonthMoreEventDragEnd}
                      onClick={(e) => handleMonthMoreEventClick(ev, e)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          handleMonthMoreEventClick(ev, e);
                        }
                      }}
                    >
                      <div className="gcal-dot" style={{ backgroundColor: ev.dotColor }}></div>
                      {ev.time && <span className="gcal-time">{ev.time}</span>}
                      <span className="gcal-title">{ev.title}</span>
                    </div>
                  )
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Floating Popover for Event Clicks */}
      {popover.open && (
        <>
          <div className="gcal-popover-backdrop" onClick={closePopover}></div>
          {!isMobile && popoverConnector && (
            <svg className="gcal-popover-connector" aria-hidden="true" viewBox={`0 0 ${window.innerWidth} ${window.innerHeight}`}>
              {popoverConnector.leadLine && (
                <line
                  x1={popoverConnector.leadLine.x1}
                  y1={popoverConnector.leadLine.y1}
                  x2={popoverConnector.leadLine.x2}
                  y2={popoverConnector.leadLine.y2}
                  stroke={popoverConnector.strokeColor}
                  strokeWidth="1"
                  strokeLinecap="round"
                />
              )}
              <g transform={popoverConnector.transform} style={{ fill: popoverConnector.strokeColor }}>
                <path d={CONNECTOR_ICON_PATHS[0]} />
                <path d={CONNECTOR_ICON_PATHS[1]} />
              </g>
            </svg>
          )}
          <div
            ref={popoverRef}
            className={`gcal-event-popover popover-${popover.placement || 'right'} ${popover.positionReady ? 'is-ready' : 'is-measuring'}`}
            style={{
              top: popover.positionReady ? popover.y : -10000,
              left: popover.positionReady ? popover.x : -10000
            }}
          >
            <div className="gcal-event-popover-shell">
              <div className="popover-header">
                <div className="popover-actions">
                  {canDeletePopoverEvent && (
                    <button
                      type="button"
                      className="gcal-icon-btn gcal-popover-action-btn strong-ink"
                      onClick={deleteNoticeFromPopover}
                      aria-label={popoverDetails?.isTask ? 'Delete public task' : 'Delete notice'}
                      disabled={popoverDeleting || popoverEditLoading || popoverEditSaving}
                    >
                      <Svgs.Trash />
                    </button>
                  )}
                  {canEditPopoverEvent && (
                    <button
                      type="button"
                      className="gcal-icon-btn gcal-popover-action-btn"
                      onClick={editNoticeFromPopover}
                      aria-label={popoverDetails?.isTask ? 'Edit public task' : 'Edit notice'}
                      disabled={popoverDeleting || popoverEditLoading || popoverEditSaving}
                    >
                      <Svgs.Edit />
                    </button>
                  )}
                  {canCopyPopoverEvent && (
                    <div className="gcal-popover-copy-tools" role="group" aria-label="Copy helpers">
                      <button
                        type="button"
                        className="gcal-icon-btn gcal-popover-action-btn"
                        onClick={() => setCopyHelpOpen(true)}
                        aria-label="How to paste copied event"
                      >
                        <Svgs.Info />
                      </button>
                      <span className="gcal-popover-copy-link" aria-hidden="true"></span>
                      <button
                        type="button"
                        className="gcal-icon-btn gcal-popover-action-btn"
                        onClick={copyPopoverEvent}
                        aria-label="Copy event"
                      >
                        <Svgs.Copy />
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    className="gcal-icon-btn gcal-popover-action-btn strong-ink"
                    onClick={closePopover}
                    aria-label="Close popup"
                  >
                    <Svgs.Close />
                  </button>
                </div>
              </div>
              <div className="popover-body">
                {popoverEditMode ? (
                  <div className="gcal-popover-edit">
                    <h4>{popoverEditTarget === 'TASK' ? 'Edit Public Task' : 'Edit Notice / Alert'}</h4>
                    {popoverEditLoading ? (
                      <div className="gcal-popover-edit-hint">
                        {popoverEditTarget === 'TASK' ? 'Loading task details...' : 'Loading notice details...'}
                      </div>
                    ) : (
                      <>
                        <div className="gcal-popover-edit-grid">
                          <label className="full">
                            <span>Title</span>
                            <input
                              type="text"
                              value={popoverEditForm.title}
                              onChange={(e) => handlePopoverEditChange('title', e.target.value)}
                              placeholder="Notice title"
                            />
                          </label>
                          {popoverEditTarget !== 'TASK' && (
                            <label className="full">
                              <span>Subject</span>
                              <textarea
                                className="gcal-popover-subject-input"
                                value={popoverEditForm.subject}
                                onChange={(e) => handlePopoverEditChange('subject', e.target.value)}
                                placeholder="Notice subject"
                                rows={3}
                              />
                            </label>
                          )}
                          <label className="full">
                            <span>Description</span>
                            <textarea
                              value={popoverEditForm.description}
                              onChange={(e) => handlePopoverEditChange('description', e.target.value)}
                              placeholder="Notice description"
                              rows={4}
                            />
                          </label>
                          <label className="full">
                            <span>Start Time</span>
                            <input
                              className="gcal-popover-datetime-input"
                              type="datetime-local"
                              value={popoverEditForm.startDateTime}
                              onChange={(e) => handlePopoverEditChange('startDateTime', e.target.value)}
                            />
                          </label>
                          <label className="full">
                            <span>End Time</span>
                            <input
                              className="gcal-popover-datetime-input"
                              type="datetime-local"
                              value={popoverEditForm.endDateTime}
                              onChange={(e) => handlePopoverEditChange('endDateTime', e.target.value)}
                            />
                          </label>
                        </div>
                        {popoverEditError && <div className="gcal-popover-edit-error">{popoverEditError}</div>}
                        <div className="gcal-popover-edit-actions">
                          <button type="button" className="gcal-popover-edit-cancel" onClick={cancelPopoverEdit} disabled={popoverEditSaving}>
                            Cancel
                          </button>
                          <button type="button" className="gcal-popover-edit-save" onClick={savePopoverEdit} disabled={popoverEditSaving}>
                            {popoverEditSaving ? 'Saving...' : 'Save'}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="popover-row">
                      <div className="popover-icon"><span className="color-square" style={{ backgroundColor: popoverDetails.badgeColor }}></span></div>
                      <div className="popover-text"><h3>{popoverDetails.title}</h3><div className="popover-date">{popoverDetails.dateStr}</div></div>
                    </div>
                    {popoverDetails.desc && (<div className="popover-row"><div className="popover-icon"><Svgs.Desc /></div><div className="popover-text desc-text">{popoverDetails.desc}</div></div>)}
                    <div className="popover-row"><div className="popover-icon"><Svgs.CalendarIcon /></div><div className="popover-text sub-text">{popoverDetails.calendarName}</div></div>
                    <div className="popover-row"><div className="popover-icon"><Svgs.Lock /></div><div className="popover-text sub-text">Public</div></div>
                    {popoverDetails.isNotice && popoverDetails.noticeId && (
                      <div className="popover-footer"><button className="gcal-read-more-btn" onClick={() => navigate(`/notices/${popoverDetails.noticeId}`)}>Read Full Notice</button></div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {copyHelpOpen && popover.open && (
        <div className="gcal-copy-help-backdrop" onClick={() => setCopyHelpOpen(false)}>
          <div className="gcal-copy-help-card" onClick={(e) => e.stopPropagation()}>
            <div className="gcal-copy-help-head">
              <h4>How to paste the copied event?</h4>
              <button
                type="button"
                className="gcal-icon-btn gcal-copy-help-close"
                onClick={() => setCopyHelpOpen(false)}
                aria-label="Close paste help"
              >
                <Svgs.Close />
              </button>
            </div>
            <p>
              Move your pointer to the date or time cell where you want the event.
              Then either right-click (or two-finger click) or press <strong>Ctrl + V</strong>.
              The copied event will be pasted there automatically.
            </p>
            <div className="gcal-copy-help-footer">
              <button
                type="button"
                className="gcal-copy-help-ok"
                onClick={() => setCopyHelpOpen(false)}
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteConfirm.open && (
        <div
          className="gcal-delete-confirm-backdrop"
          onClick={closeDeleteConfirm}
        >
          <div
            className="gcal-delete-confirm-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="gcal-delete-confirm-head">
              <div className="gcal-delete-confirm-icon" aria-hidden="true">
                <Svgs.Trash />
              </div>
              <div className="gcal-delete-confirm-copy">
                <h4>{deleteConfirm.kind === 'TASK' ? 'Delete Public Task?' : 'Delete Notice / Alert?'}</h4>
                <p className="gcal-delete-confirm-title">Delete "{deleteConfirm.title}"?</p>
                <p className="gcal-delete-confirm-desc">{deleteConfirm.message}</p>
              </div>
            </div>
            <div className="gcal-delete-confirm-actions">
              <button
                type="button"
                className="gcal-delete-confirm-cancel"
                onClick={closeDeleteConfirm}
                disabled={popoverDeleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="gcal-delete-confirm-delete"
                onClick={confirmDeleteFromDialog}
                disabled={popoverDeleting}
              >
                {popoverDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Print Modal */}
      {printModalOpen && (
        <div className="gcal-modal-backdrop gcal-print-modal-backdrop" onClick={closePrintModal}>
          <div className={`gcal-print-modal ${printPreviewFullscreen ? 'is-preview-fullscreen' : ''}`} onClick={(e) => e.stopPropagation()}>
            <div className="gcal-print-modal-head">
              <div>
                <h3>Print Calendar</h3>
                <p>Select view and range to print only the calendar area.</p>
              </div>
              <button
                type="button"
                className="gcal-icon-btn gcal-print-close-btn"
                onClick={closePrintModal}
                aria-label="Close print dialog"
              >
                <Svgs.Close />
              </button>
            </div>

            <form className="gcal-print-form" onSubmit={submitPrintDialog}>
              <label className="gcal-print-field full">
                <span>Print view</span>
                <select
                  value={printForm.view}
                  onChange={(e) => handlePrintFormChange('view', e.target.value)}
                >
                  <option value="day">Day</option>
                  <option value="week">Week</option>
                  <option value="month">Month</option>
                  <option value="year">Year</option>
                  <option value="schedule">Schedule</option>
                </select>
              </label>

              <div className="gcal-print-grid gcal-print-grid-options">
                <label className="gcal-print-field">
                  <span>Font size</span>
                  <select
                    value={String(printOptions.fontSize)}
                    onChange={(e) => handlePrintOptionChange('fontSize', Number(e.target.value))}
                  >
                    {[8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 22, 24].map((size) => (
                      <option key={`print-font-${size}`} value={String(size)}>{size}</option>
                    ))}
                  </select>
                </label>
                <label className="gcal-print-field">
                  <span>Orientation</span>
                  <select
                    value={printOptions.orientation}
                    onChange={(e) => handlePrintOptionChange('orientation', e.target.value)}
                  >
                    {Object.entries(PRINT_ORIENTATION_OPTIONS).map(([value, label]) => (
                      <option key={`print-orientation-${value}`} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <label className="gcal-print-field">
                  <span>Grid size (%)</span>
                  <input
                    type="number"
                    min="60"
                    max="200"
                    step="1"
                    value={printOptions.gridScale}
                    onChange={(e) => handlePrintOptionChange('gridScale', e.target.value)}
                  />
                </label>
              </div>

              <div className="gcal-print-checkbox-row">
                <label className="gcal-print-check">
                  <input
                    type="checkbox"
                    checked={printOptions.showEvents}
                    onChange={() => handlePrintOptionToggle('showEvents')}
                  />
                  <span>Show events</span>
                </label>
                <label className="gcal-print-check">
                  <input
                    type="checkbox"
                    checked={printOptions.showWeekends}
                    onChange={() => handlePrintOptionToggle('showWeekends')}
                  />
                  <span>Show weekends</span>
                </label>
                <label className="gcal-print-check">
                  <input
                    type="checkbox"
                    checked={printOptions.showDeclined}
                    onChange={() => handlePrintOptionToggle('showDeclined')}
                  />
                  <span>Show declined events</span>
                </label>
              </div>

              {printForm.view === 'day' && (
                <div className="gcal-print-grid">
                  <label className="gcal-print-field">
                    <span>From day</span>
                    <input
                      type="date"
                      value={printForm.dayFrom}
                      onChange={(e) => handlePrintFormChange('dayFrom', e.target.value)}
                      required
                    />
                  </label>
                  <label className="gcal-print-field">
                    <span>To day</span>
                    <input
                      type="date"
                      value={printForm.dayTo}
                      onChange={(e) => handlePrintFormChange('dayTo', e.target.value)}
                      required
                    />
                  </label>
                </div>
              )}

              {printForm.view === 'week' && (
                <div className="gcal-print-grid gcal-print-grid-week">
                  <label className="gcal-print-field">
                    <span>From week</span>
                    <div className="gcal-print-week-field-stack">
                      <input
                        type="date"
                        value={printForm.weekFromDate || weekFieldToDateInputValue(printForm.weekFrom)}
                        onChange={(e) => handlePrintWeekDateChange('weekFromDate', e.target.value)}
                        title="Pick any date to auto-select the corresponding 7-day week range"
                      />
                      <select
                        value={printForm.weekFrom}
                        onChange={(e) => handlePrintFormChange('weekFrom', e.target.value)}
                        required
                      >
                        {weekFromPickerOptions.map((opt) => (
                          <option key={`print-week-from-${opt.value}`} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                  </label>
                  <label className="gcal-print-field">
                    <span>To week</span>
                    <div className="gcal-print-week-field-stack">
                      <input
                        type="date"
                        value={printForm.weekToDate || weekFieldToDateInputValue(printForm.weekTo)}
                        onChange={(e) => handlePrintWeekDateChange('weekToDate', e.target.value)}
                        title="Pick any date to auto-select the corresponding 7-day week range"
                      />
                      <select
                        value={printForm.weekTo}
                        onChange={(e) => handlePrintFormChange('weekTo', e.target.value)}
                        required
                      >
                        {weekToPickerOptions.map((opt) => (
                          <option key={`print-week-to-${opt.value}`} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                  </label>
                </div>
              )}

              {printForm.view === 'month' && (
                <div className="gcal-print-grid">
                  <label className="gcal-print-field">
                    <span>From month</span>
                    <div className="gcal-print-select-wrap gcal-print-month-picker-host">
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={7}
                        placeholder="mm-yyyy"
                        className="gcal-print-select-with-icon"
                        value={printForm.monthFrom}
                        onChange={(e) => handlePrintFormChange('monthFrom', e.target.value)}
                        onBlur={(e) => handlePrintMonthBlur('monthFrom', e.target.value)}
                        required
                      />
                      <button
                        type="button"
                        className="gcal-print-field-icon-btn"
                        aria-label="Open month list"
                        onClick={() => togglePrintMonthPickerField('monthFrom')}
                      >
                        <Svgs.CalendarIcon />
                      </button>
                      {printMonthPickerField === 'monthFrom' && (
                        <div className="gcal-print-month-menu" role="listbox" aria-label="From month options">
                          {monthFromPickerOptions.map((opt) => (
                            <button
                              type="button"
                              key={`print-month-from-opt-${opt.value}`}
                              className={`gcal-print-month-menu-item ${opt.value === printForm.monthFrom ? 'is-selected' : ''}`}
                              onClick={() => selectPrintMonthOption('monthFrom', opt.value)}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </label>
                  <label className="gcal-print-field">
                    <span>To month</span>
                    <div className="gcal-print-select-wrap gcal-print-month-picker-host">
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={7}
                        placeholder="mm-yyyy"
                        className="gcal-print-select-with-icon"
                        value={printForm.monthTo}
                        onChange={(e) => handlePrintFormChange('monthTo', e.target.value)}
                        onBlur={(e) => handlePrintMonthBlur('monthTo', e.target.value)}
                        required
                      />
                      <button
                        type="button"
                        className="gcal-print-field-icon-btn"
                        aria-label="Open month list"
                        onClick={() => togglePrintMonthPickerField('monthTo')}
                      >
                        <Svgs.CalendarIcon />
                      </button>
                      {printMonthPickerField === 'monthTo' && (
                        <div className="gcal-print-month-menu" role="listbox" aria-label="To month options">
                          {monthToPickerOptions.map((opt) => (
                            <button
                              type="button"
                              key={`print-month-to-opt-${opt.value}`}
                              className={`gcal-print-month-menu-item ${opt.value === printForm.monthTo ? 'is-selected' : ''}`}
                              onClick={() => selectPrintMonthOption('monthTo', opt.value)}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </label>
                </div>
              )}

              {printForm.view === 'year' && (
                <div className="gcal-print-grid">
                  <label className="gcal-print-field">
                    <span>From year</span>
                    <input
                      type="number"
                      min="1970"
                      max="9999"
                      value={printForm.yearFrom}
                      onChange={(e) => handlePrintFormChange('yearFrom', e.target.value)}
                      required
                    />
                  </label>
                  <label className="gcal-print-field">
                    <span>To year</span>
                    <input
                      type="number"
                      min="1970"
                      max="9999"
                      value={printForm.yearTo}
                      onChange={(e) => handlePrintFormChange('yearTo', e.target.value)}
                      required
                    />
                  </label>
                </div>
              )}

              {printForm.view === 'schedule' && (
                <div className="gcal-print-grid">
                  <label className="gcal-print-field">
                    <span>From scheduled day</span>
                    <select
                      value={printForm.scheduleFrom}
                      onChange={(e) => handlePrintFormChange('scheduleFrom', e.target.value)}
                      disabled={!schedulePrintOptions.length}
                      required
                    >
                      {schedulePrintOptions.length ? (
                        schedulePrintOptions.map((opt) => (
                          <option key={`print-schedule-from-${opt.value}`} value={opt.value}>{opt.label}</option>
                        ))
                      ) : (
                        <option value="">No scheduled dates available</option>
                      )}
                    </select>
                  </label>
                  <label className="gcal-print-field">
                    <span>To scheduled day</span>
                    <select
                      value={printForm.scheduleTo}
                      onChange={(e) => handlePrintFormChange('scheduleTo', e.target.value)}
                      disabled={!schedulePrintOptions.length}
                      required
                    >
                      {schedulePrintOptions.length ? (
                        schedulePrintOptions.map((opt) => (
                          <option key={`print-schedule-to-${opt.value}`} value={opt.value}>{opt.label}</option>
                        ))
                      ) : (
                        <option value="">No scheduled dates available</option>
                      )}
                    </select>
                  </label>
                </div>
              )}

              {printPreviewData.ok && (
                <div className={`gcal-print-preview-block ${printPreviewFullscreen ? 'is-fullscreen' : ''}`}>
                  <div className="gcal-print-preview-head">
                    <div className="gcal-print-preview-head-top">
                      {!printPreviewFullscreen && <strong>Preview & Page Size</strong>}
                      <div className="gcal-print-preview-head-actions">
                        {!printPreviewFullscreen && (
                          <button
                            type="button"
                            className="gcal-print-preview-autofit-btn"
                            onClick={applyPrintPreviewAutoFit}
                            title="Auto fit to viewport, set font size 12, and fill page with grid"
                          >
                            Auto Fit
                          </button>
                        )}
                        <button
                          type="button"
                          className="gcal-print-preview-expand-btn"
                          onClick={togglePrintPreviewFullscreen}
                          aria-label={printPreviewFullscreen ? 'Exit fullscreen preview' : 'Enter fullscreen preview'}
                          title={printPreviewFullscreen ? 'Exit fullscreen preview' : 'Use full viewport for preview'}
                        >
                          {printPreviewFullscreen ? <Svgs.CollapseDiagonal /> : <Svgs.ExpandDiagonal />}
                        </button>
                      </div>
                    </div>
                    {!printPreviewFullscreen && (
                      <span>Set per-page size in mm, drag page corners to resize page size, or drag the grid handle on each page.</span>
                    )}
                  </div>
                  <div className="gcal-print-preview-list">
                    {printPreviewData.pages.map((pageHtml, idx) => {
                      const fallbackDims = defaultPrintPageDimensionsMm(printOptions.orientation);
                      const pagePref = printPagePrefs?.[idx] || fallbackDims;
                      const widthMm = clamp(Number(pagePref?.widthMm) || fallbackDims.widthMm, PRINT_PAGE_MM_MIN, PRINT_PAGE_MM_MAX);
                      const heightMm = clamp(Number(pagePref?.heightMm) || fallbackDims.heightMm, PRINT_PAGE_MM_MIN, PRINT_PAGE_MM_MAX);
                      const pageSrcDoc = `<!doctype html><html><head><meta charset="utf-8" /><style>${printPreviewData.styleText}
                        html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #fff; overflow: auto; }
                        .print-root { min-height: 100%; width: 100%; }
                        .print-page { page-break-after: auto !important; break-after: auto !important; min-height: 100%; width: 100%; padding: 2mm 2mm !important; display: flex; flex-direction: column; }
                        .print-grid-area { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
                        .print-month-table, .print-week-grid, .print-table { width: 100% !important; flex: 1 1 auto; }
                        .print-month-table { height: 100%; }
                        .print-month-cell, .print-week-cell { height: auto !important; }
                      </style></head><body><div class="print-root">${pageHtml}</div></body></html>`;
                      const gridBounds = printGridBoundsByPage?.[idx];
                      const pageNode = printPreviewPageRefs.current?.[idx];
                      const pageWidthPx = pageNode instanceof HTMLElement ? pageNode.clientWidth : 0;
                      const pageHeightPx = pageNode instanceof HTMLElement ? pageNode.clientHeight : 0;
                      const fallbackInset = 8;
                      const fallbackGridLeft = fallbackInset;
                      const fallbackGridTop = fallbackInset;
                      const fallbackGridWidth = Math.max(12, pageWidthPx - (fallbackInset * 2));
                      const fallbackGridHeight = Math.max(12, pageHeightPx - (fallbackInset * 2));
                      const hasGridBounds = Number.isFinite(gridBounds?.left)
                        && Number.isFinite(gridBounds?.top)
                        && Number.isFinite(gridBounds?.width)
                        && Number.isFinite(gridBounds?.height)
                        && gridBounds.width > 8
                        && gridBounds.height > 8;
                      const gridLeft = hasGridBounds ? Math.max(0, gridBounds.left) : fallbackGridLeft;
                      const gridTop = hasGridBounds ? Math.max(0, gridBounds.top) : fallbackGridTop;
                      const gridWidth = hasGridBounds ? Math.max(12, gridBounds.width) : fallbackGridWidth;
                      const gridHeight = hasGridBounds ? Math.max(12, gridBounds.height) : fallbackGridHeight;
                      const edgeThickness = 10;
                      const edgeHalf = edgeThickness / 2;
                      const gridLeftStyle = hasGridBounds
                        ? {
                          left: `${Math.max(0, gridLeft - edgeHalf)}px`,
                          top: `${gridTop}px`,
                          width: `${edgeThickness}px`,
                          height: `${gridHeight}px`,
                          right: 'auto',
                          bottom: 'auto'
                        }
                        : undefined;
                      const gridRightStyle = hasGridBounds
                        ? {
                          left: `${Math.max(0, (gridLeft + gridWidth) - edgeHalf)}px`,
                          top: `${gridTop}px`,
                          width: `${edgeThickness}px`,
                          height: `${gridHeight}px`,
                          right: 'auto',
                          bottom: 'auto'
                        }
                        : undefined;
                      const gridTopStyle = hasGridBounds
                        ? {
                          left: `${gridLeft}px`,
                          top: `${Math.max(0, gridTop - edgeHalf)}px`,
                          width: `${gridWidth}px`,
                          height: `${edgeThickness}px`,
                          right: 'auto',
                          bottom: 'auto'
                        }
                        : undefined;
                      const gridBottomStyle = hasGridBounds
                        ? {
                          left: `${gridLeft}px`,
                          top: `${Math.max(0, (gridTop + gridHeight) - edgeHalf)}px`,
                          width: `${gridWidth}px`,
                          height: `${edgeThickness}px`,
                          right: 'auto',
                          bottom: 'auto'
                        }
                        : undefined;
                      const gridCornerStyle = hasGridBounds
                        ? {
                          left: `${Math.max(0, (gridLeft + gridWidth) - 12)}px`,
                          top: `${Math.max(0, (gridTop + gridHeight) - 12)}px`,
                          right: 'auto',
                          bottom: 'auto'
                        }
                        : undefined;

                      return (
                        <div className="gcal-print-preview-item" key={`print-preview-page-${idx}`}>
                          {!printPreviewFullscreen && (
                            <div className="gcal-print-preview-item-meta">
                              <strong>Page {idx + 1}</strong>
                              <div className="gcal-print-preview-dims">
                                <label>
                                  W (mm)
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    placeholder={`${PRINT_PAGE_MM_MIN}-${PRINT_PAGE_MM_MAX}`}
                                    value={getPrintPageInputValue(idx, 'widthMm', widthMm)}
                                    onChange={(e) => handlePrintPageSizeInput(idx, 'widthMm', e.target.value)}
                                    onBlur={() => commitPrintPageSizeInput(idx, 'widthMm')}
                                  />
                                </label>
                                <label>
                                  H (mm)
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    placeholder={`${PRINT_PAGE_MM_MIN}-${PRINT_PAGE_MM_MAX}`}
                                    value={getPrintPageInputValue(idx, 'heightMm', heightMm)}
                                    onChange={(e) => handlePrintPageSizeInput(idx, 'heightMm', e.target.value)}
                                    onBlur={() => commitPrintPageSizeInput(idx, 'heightMm')}
                                  />
                                </label>
                              </div>
                            </div>
                          )}
                          <div
                            className="gcal-print-preview-page-shell"
                            ref={(node) => {
                              if (node) printPreviewPageRefs.current[idx] = node;
                              else delete printPreviewPageRefs.current[idx];
                            }}
                            style={{ width: `${widthMm}mm`, height: `${heightMm}mm` }}
                            onMouseUp={() => syncPrintPreviewSizeFromDom(idx)}
                            onTouchEnd={() => syncPrintPreviewSizeFromDom(idx)}
                          >
                            <button
                              type="button"
                              className="gcal-print-page-edge-handle edge-left"
                              title="Drag to resize page width"
                              aria-label="Drag left border to resize page width"
                              onMouseDown={(e) => startPrintPageSizeDrag(idx, 'left', e)}
                              onTouchStart={(e) => startPrintPageSizeDrag(idx, 'left', e)}
                            />
                            <button
                              type="button"
                              className="gcal-print-page-edge-handle edge-right"
                              title="Drag to resize page width"
                              aria-label="Drag right border to resize page width"
                              onMouseDown={(e) => startPrintPageSizeDrag(idx, 'right', e)}
                              onTouchStart={(e) => startPrintPageSizeDrag(idx, 'right', e)}
                            />
                            <button
                              type="button"
                              className="gcal-print-page-edge-handle edge-top"
                              title="Drag to resize page height"
                              aria-label="Drag top border to resize page height"
                              onMouseDown={(e) => startPrintPageSizeDrag(idx, 'top', e)}
                              onTouchStart={(e) => startPrintPageSizeDrag(idx, 'top', e)}
                            />
                            <button
                              type="button"
                              className="gcal-print-page-edge-handle edge-bottom"
                              title="Drag to resize page height"
                              aria-label="Drag bottom border to resize page height"
                              onMouseDown={(e) => startPrintPageSizeDrag(idx, 'bottom', e)}
                              onTouchStart={(e) => startPrintPageSizeDrag(idx, 'bottom', e)}
                            />
                            <button
                              type="button"
                              className="gcal-print-page-corner-handle"
                              title="Drag to resize page"
                              aria-label="Drag bottom-right corner to resize page"
                              onMouseDown={(e) => startPrintPageSizeDrag(idx, 'both', e)}
                              onTouchStart={(e) => startPrintPageSizeDrag(idx, 'both', e)}
                            />
                            <iframe
                              title={`Print preview page ${idx + 1}`}
                              className="gcal-print-preview-frame"
                              srcDoc={pageSrcDoc}
                              ref={(node) => {
                                if (node) printPreviewFrameRefs.current[idx] = node;
                                else delete printPreviewFrameRefs.current[idx];
                              }}
                              onLoad={() => window.requestAnimationFrame(() => measurePrintGridBoundsForPage(idx))}
                            />
                            <button
                              type="button"
                              className="gcal-print-grid-corner-handle"
                              title="Drag grid corner to resize"
                              aria-label="Drag bottom-right grid corner to resize"
                              onMouseDown={(e) => startPrintGridScaleDrag('both', e)}
                              onTouchStart={(e) => startPrintGridScaleDrag('both', e)}
                              style={gridCornerStyle}
                            />
                            <button
                              type="button"
                              className="gcal-print-grid-edge-handle edge-left"
                              title="Drag to resize grid width"
                              aria-label="Drag left border to resize grid width"
                              onMouseDown={(e) => startPrintGridScaleDrag('left', e)}
                              onTouchStart={(e) => startPrintGridScaleDrag('left', e)}
                              style={gridLeftStyle}
                            />
                            <button
                              type="button"
                              className="gcal-print-grid-edge-handle edge-right"
                              title="Drag to resize grid width"
                              aria-label="Drag right border to resize grid width"
                              onMouseDown={(e) => startPrintGridScaleDrag('right', e)}
                              onTouchStart={(e) => startPrintGridScaleDrag('right', e)}
                              style={gridRightStyle}
                            />
                            <button
                              type="button"
                              className="gcal-print-grid-edge-handle edge-top"
                              title="Drag to resize grid height"
                              aria-label="Drag top border to resize grid height"
                              onMouseDown={(e) => startPrintGridScaleDrag('top', e)}
                              onTouchStart={(e) => startPrintGridScaleDrag('top', e)}
                              style={gridTopStyle}
                            />
                            <button
                              type="button"
                              className="gcal-print-grid-edge-handle edge-bottom"
                              title="Drag to resize grid height"
                              aria-label="Drag bottom border to resize grid height"
                              onMouseDown={(e) => startPrintGridScaleDrag('bottom', e)}
                              onTouchStart={(e) => startPrintGridScaleDrag('bottom', e)}
                              style={gridBottomStyle}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {printError && <div className="gcal-print-error">{printError}</div>}

              <div className="gcal-print-actions">
                <button type="button" className="gcal-cancel-btn" onClick={closePrintModal} disabled={printSubmitting}>
                  Cancel
                </button>
                <button type="submit" className="gcal-save-btn" disabled={printSubmitting}>
                  {printSubmitting ? 'Preparing...' : `Print ${PRINT_VIEW_LABELS[printForm.view] || 'View'}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Appearance Modal */}
      {appearanceModalOpen && (
        <div className="gcal-modal-backdrop" onClick={closeAppearanceModal}>
          <div className="gcal-appearance-modal" onClick={e => e.stopPropagation()}>
            <h2>Appearance</h2>
            <div className="theme-selectors">
              <label className="theme-card">
                <div className={`theme-preview light ${themeMode === 'Light' ? 'selected' : ''}`}>
                  <div className="prev-head"><span className="prev-icon"></span><span className="prev-line short"></span></div>
                  <div className="prev-line"></div>
                  <div className="prev-line"></div>
                </div>
                <input type="radio" name="theme" checked={themeMode === 'Light'} onChange={() => applyThemeMode('Light')} /> Light
              </label>
              <label className="theme-card">
                <div className={`theme-preview dark ${themeMode === 'Dark' ? 'selected' : ''}`}>
                  <div className="prev-head"><span className="prev-icon"></span><span className="prev-line short"></span></div>
                  <div className="prev-line"></div>
                  <div className="prev-line"></div>
                </div>
                <input type="radio" name="theme" checked={themeMode === 'Dark'} onChange={() => applyThemeMode('Dark')} /> Dark
              </label>
              <label className="theme-card">
                <div className={`theme-preview auto ${themeMode === 'Auto' ? 'selected' : ''}`}>
                  <div className="prev-half light"></div><div className="prev-half dark"></div>
                  <div className="prev-head"><span className="prev-icon"></span><span className="prev-line short"></span></div>
                  <div className="prev-line"></div>
                  <div className="prev-line"></div>
                </div>
                <input type="radio" name="theme" checked={themeMode === 'Auto'} onChange={() => applyThemeMode('Auto')} /> Device default
              </label>
            </div>

            <div className="appearance-footer">
              <button className="done-btn" onClick={closeAppearanceModal}>Done</button>
            </div>
          </div>
        </div>
      )}

      {/* Premium Task Creation Modal */}
      {showTaskModal && (
        <div className="gcal-modal-backdrop gcal-task-modal-backdrop" onClick={() => setShowTaskModal(false)}>
          <div className="gcal-modal premium-modal" onClick={e => e.stopPropagation()}>
            <div className="gcal-modal-header premium-header">
              <button type="button" className="gcal-icon-btn close-btn" onClick={() => setShowTaskModal(false)} aria-label="Close">
                <Svgs.Close />
              </button>
            </div>
            <div className="gcal-modal-body premium-body">
              <div className="gcal-task-modal-head">
                <div className="gcal-task-modal-head-icon" aria-hidden="true">
                  <Svgs.Plus />
                </div>
                <div className="gcal-task-modal-head-copy">
                  <h3>Create Public Task</h3>
                  <p>Visible to all logged-in members on the shared calendar.</p>
                </div>
              </div>
              <form onSubmit={submitTask} className="gcal-task-form">
                <input
                  className="gcal-modal-title-input"
                  type="text"
                  placeholder="Task title"
                  value={taskForm.title}
                  onChange={(e) => setTaskForm({...taskForm, title: e.target.value})}
                  autoFocus
                  required
                />

                <div className="gcal-modal-row task-row">
                  <div className="icon-wrapper"><Svgs.CalendarIcon /></div>
                  <div className="gcal-modal-datetime">
                    <span className="gcal-task-field-label">Date and time</span>
                    {taskForm.allDay ? (
                      <div className="gcal-time-grid">
                        <div className="gcal-time-line-block">
                          <span className="gcal-time-line-label">START</span>
                          <div className="gcal-time-line gcal-time-line--date-only">
                            <div className="gcal-date-display-wrap">
                              <input
                                type="text"
                                className="gcal-date-display-input"
                                value={formatDateDisplay(taskForm.startDate)}
                                placeholder="dd/mm/yyyy"
                                readOnly
                                aria-label="Start date"
                                onMouseDown={(ev) => ev.preventDefault()}
                                onClick={(ev) => openNativeDatePicker(startDatePickerRef, ev)}
                              />
                              <button
                                type="button"
                                className="gcal-date-open-btn"
                                onClick={(ev) => openNativeDatePicker(startDatePickerRef, ev)}
                                aria-label="Open start date picker"
                              >
                                <Svgs.CalendarIcon />
                              </button>
                              <input
                                ref={startDatePickerRef}
                                type="date"
                                lang="en-GB"
                                className="gcal-date-native-picker"
                                value={taskForm.startDate}
                                onChange={(e) => setTaskForm({...taskForm, startDate: e.target.value})}
                                required
                                tabIndex={-1}
                              />
                            </div>
                          </div>
                        </div>

                        <div className="gcal-time-line-block">
                          <span className="gcal-time-line-label">END</span>
                          <div className="gcal-time-line gcal-time-line--date-only">
                            <div className="gcal-date-display-wrap">
                              <input
                                type="text"
                                className="gcal-date-display-input"
                                value={formatDateDisplay(taskForm.endDate)}
                                placeholder="dd/mm/yyyy"
                                readOnly
                                aria-label="End date"
                                onMouseDown={(ev) => ev.preventDefault()}
                                onClick={(ev) => openNativeDatePicker(endDatePickerRef, ev)}
                              />
                              <button
                                type="button"
                                className="gcal-date-open-btn"
                                onClick={(ev) => openNativeDatePicker(endDatePickerRef, ev)}
                                aria-label="Open end date picker"
                              >
                                <Svgs.CalendarIcon />
                              </button>
                              <input
                                ref={endDatePickerRef}
                                type="date"
                                lang="en-GB"
                                className="gcal-date-native-picker"
                                value={taskForm.endDate}
                                onChange={(e) => setTaskForm({...taskForm, endDate: e.target.value})}
                                tabIndex={-1}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="gcal-time-grid">
                        <div className="gcal-time-line-block">
                          <span className="gcal-time-line-label">START</span>
                          <div className="gcal-time-line">
                            <div className="gcal-date-display-wrap">
                              <input
                                type="text"
                                className="gcal-date-display-input"
                                value={formatDateDisplay(taskForm.startDate)}
                                placeholder="dd/mm/yyyy"
                                readOnly
                                aria-label="Start date"
                                onMouseDown={(ev) => ev.preventDefault()}
                                onClick={(ev) => openNativeDatePicker(startDatePickerRef, ev)}
                              />
                              <button
                                type="button"
                                className="gcal-date-open-btn"
                                onClick={(ev) => openNativeDatePicker(startDatePickerRef, ev)}
                                aria-label="Open start date picker"
                              >
                                <Svgs.CalendarIcon />
                              </button>
                              <input
                                ref={startDatePickerRef}
                                type="date"
                                lang="en-GB"
                                className="gcal-date-native-picker"
                                value={taskForm.startDate}
                                onChange={(e) => setTaskForm({...taskForm, startDate: e.target.value})}
                                required
                                tabIndex={-1}
                              />
                            </div>
                            <div className="gcal-time-input-wrap">
                              <input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                maxLength={2}
                                className="gcal-time-part"
                                placeholder="hh"
                                value={taskForm.startHour}
                                onChange={(e) => setTaskForm({...taskForm, startHour: normalizeTimePart(e.target.value)})}
                                required
                                aria-label="Start hour"
                              />
                              <span className="gcal-time-colon">:</span>
                              <input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                maxLength={2}
                                className="gcal-time-part"
                                placeholder="mm"
                                value={taskForm.startMinute}
                                onChange={(e) => setTaskForm({...taskForm, startMinute: normalizeTimePart(e.target.value)})}
                                required
                                aria-label="Start minute"
                              />
                            </div>
                            <div className="gcal-ampm-toggle" role="group" aria-label="Start period">
                              <button
                                type="button"
                                className={taskForm.startPeriod === 'AM' ? 'active' : ''}
                                onClick={() => setTaskForm({...taskForm, startPeriod: 'AM'})}
                              >
                                AM
                              </button>
                              <button
                                type="button"
                                className={taskForm.startPeriod === 'PM' ? 'active' : ''}
                                onClick={() => setTaskForm({...taskForm, startPeriod: 'PM'})}
                              >
                                PM
                              </button>
                            </div>
                          </div>
                        </div>

                        <div className="gcal-time-line-block">
                          <span className="gcal-time-line-label">END</span>
                          <div className="gcal-time-line">
                            <div className="gcal-date-display-wrap">
                              <input
                                type="text"
                                className="gcal-date-display-input"
                                value={formatDateDisplay(taskForm.endDate)}
                                placeholder="dd/mm/yyyy"
                                readOnly
                                aria-label="End date"
                                onMouseDown={(ev) => ev.preventDefault()}
                                onClick={(ev) => openNativeDatePicker(endDatePickerRef, ev)}
                              />
                              <button
                                type="button"
                                className="gcal-date-open-btn"
                                onClick={(ev) => openNativeDatePicker(endDatePickerRef, ev)}
                                aria-label="Open end date picker"
                              >
                                <Svgs.CalendarIcon />
                              </button>
                              <input
                                ref={endDatePickerRef}
                                type="date"
                                lang="en-GB"
                                className="gcal-date-native-picker"
                                value={taskForm.endDate}
                                onChange={(e) => setTaskForm({...taskForm, endDate: e.target.value})}
                                required
                                tabIndex={-1}
                              />
                            </div>
                            <div className="gcal-time-input-wrap">
                              <input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                maxLength={2}
                                className="gcal-time-part"
                                placeholder="hh"
                                value={taskForm.endHour}
                                onChange={(e) => setTaskForm({...taskForm, endHour: normalizeTimePart(e.target.value)})}
                                required
                                aria-label="End hour"
                              />
                              <span className="gcal-time-colon">:</span>
                              <input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                maxLength={2}
                                className="gcal-time-part"
                                placeholder="mm"
                                value={taskForm.endMinute}
                                onChange={(e) => setTaskForm({...taskForm, endMinute: normalizeTimePart(e.target.value)})}
                                required
                                aria-label="End minute"
                              />
                            </div>
                            <div className="gcal-ampm-toggle" role="group" aria-label="End period">
                              <button
                                type="button"
                                className={taskForm.endPeriod === 'AM' ? 'active' : ''}
                                onClick={() => setTaskForm({...taskForm, endPeriod: 'AM'})}
                              >
                                AM
                              </button>
                              <button
                                type="button"
                                className={taskForm.endPeriod === 'PM' ? 'active' : ''}
                                onClick={() => setTaskForm({...taskForm, endPeriod: 'PM'})}
                              >
                                PM
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    <label className="all-day-check">
                      <input
                        type="checkbox"
                        checked={taskForm.allDay}
                        onChange={(e) => setTaskForm({...taskForm, allDay: e.target.checked})}
                      />
                      <span>All day</span>
                    </label>
                  </div>
                </div>

                <div className="gcal-modal-row task-row">
                  <div className="icon-wrapper"><Svgs.Desc /></div>
                  <div className="gcal-task-description-wrap">
                    <span className="gcal-task-field-label">Description</span>
                    <textarea
                      placeholder="Add context, agenda, or purpose for this shared task"
                      value={taskForm.description}
                      onChange={(e) => setTaskForm({...taskForm, description: e.target.value})}
                      rows={4}
                    />
                  </div>
                </div>

                <div className="gcal-modal-row checkbox-row">
                  <div className="icon-wrapper"><Svgs.Lock /></div>
                  <label className="public-warn-check">
                    <input
                      type="checkbox"
                      checked={taskForm.acknowledgePublic}
                      onChange={(e) => setTaskForm({...taskForm, acknowledgePublic: e.target.checked})}
                    />
                    <span>I understand this task is public.</span>
                  </label>
                </div>

                <div className="gcal-modal-footer">
                  <button
                    type="button"
                    className="gcal-cancel-btn"
                    onClick={() => setShowTaskModal(false)}
                    disabled={postingTask}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="gcal-save-btn" disabled={postingTask}>
                    {postingTask ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      <Snackbar
        open={snackbarOpen}
        autoHideDuration={2800}
        onClose={() => setSnackbarOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setSnackbarOpen(false)} severity={snackbarSeverity} sx={{ width: '100%' }}>
          {snackbarMessage}
        </Alert>
      </Snackbar>
    </div>
  );
}
