import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fuzzyFilterHallLike } from '../../utils/fuzzySearch';

const SORT_OPTIONS = [
  { value: 'NAME_ASC', label: 'Name (A-Z)' },
  { value: 'NAME_DESC', label: 'Name (Z-A)' },
  { value: 'CAPACITY_DESC', label: 'Capacity (High-Low)' },
  { value: 'CAPACITY_ASC', label: 'Capacity (Low-High)' },
  { value: 'FILLED_TODAY_FIRST', label: 'Filled Today First' },
  { value: 'UNFILLED_TODAY_FIRST', label: 'Unfilled Today First' },
  { value: 'FILLED_RANGE_FIRST', label: 'Filled in Timeline First' },
  { value: 'UNFILLED_RANGE_FIRST', label: 'Unfilled in Timeline First' }
];

const uniqueStrings = (list) =>
  Array.from(
    new Set(
      (Array.isArray(list) ? list : [])
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    )
  );

const parseManualInput = (value) =>
  uniqueStrings(
    String(value || '')
      .split(/[,\n;|]/)
      .map((item) => item.trim())
  );

const parseDate = (value) => {
  if (!value) return null;
  const dt = value instanceof Date ? value : new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
};

const clampOverlap = (rangeStart, rangeEnd, itemStart, itemEnd) => {
  if (!rangeStart || !rangeEnd || !itemStart || !itemEnd) return null;
  const start = itemStart > rangeStart ? itemStart : rangeStart;
  const end = itemEnd < rangeEnd ? itemEnd : rangeEnd;
  return end > start ? { start, end } : null;
};

const getOverlapsForRange = (bookings, rangeStart, rangeEnd) => {
  const rows = (Array.isArray(bookings) ? bookings : [])
    .map((booking) => {
      const start = parseDate(booking?.startDateTime);
      const end = parseDate(booking?.endDateTime);
      return clampOverlap(rangeStart, rangeEnd, start, end);
    })
    .filter(Boolean)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  return rows;
};

const formatDateTime = (value, showDate) =>
  value.toLocaleString('en-IN', {
    day: showDate ? '2-digit' : undefined,
    month: showDate ? 'short' : undefined,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

const formatIntervals = (intervals, showDate = false) => {
  if (!Array.isArray(intervals) || intervals.length === 0) return '';
  return intervals
    .slice(0, 3)
    .map((slot) => `${formatDateTime(slot.start, showDate)}-${formatDateTime(slot.end, showDate)}`)
    .join(', ');
};

const getTodayBounds = () => {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return { start, end };
};

const byName = (a, b, reverse = false) => {
  const result = String(a?.name || '').localeCompare(String(b?.name || ''), undefined, {
    numeric: true,
    sensitivity: 'base'
  });
  return reverse ? -result : result;
};

const byCapacity = (a, b, reverse = false) => {
  const aCap = Number(a?.capacity || 0);
  const bCap = Number(b?.capacity || 0);
  if (aCap !== bCap) return reverse ? bCap - aCap : aCap - bCap;
  return byName(a, b);
};

const byFilledGroup = (a, b, selector, filledFirst = true) => {
  const aFilled = selector(a) ? 1 : 0;
  const bFilled = selector(b) ? 1 : 0;
  if (aFilled !== bFilled) {
    return filledFirst ? bFilled - aFilled : aFilled - bFilled;
  }
  const aTime = Number(selector(a) ? a.sortTime : Number.MAX_SAFE_INTEGER);
  const bTime = Number(selector(b) ? b.sortTime : Number.MAX_SAFE_INTEGER);
  if (aTime !== bTime) return aTime - bTime;
  return byName(a, b);
};

const getSortModeLabel = (mode) => SORT_OPTIONS.find((x) => x.value === mode)?.label || '';

export default function HallMultiSelectDropdown({
  halls = [],
  selectedHalls = [],
  onChange,
  disabled = false,
  startDateTime = '',
  endDateTime = '',
  placeholder = '',
  searchPlaceholder = 'Search halls',
  searchInputOffsetY = 6,
  fieldHeight = 40,
  fieldPlaceholderOffsetY = 0,
  fieldInputOffsetY = 0,
  hallRowNameOffsetY = 0,
  hallRowCheckboxOffsetY = 0
}) {
  const rootRef = useRef(null);
  const inputFocusedRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [sortMode, setSortMode] = useState('NAME_ASC');
  const [manualValue, setManualValue] = useState((selectedHalls || []).join(', '));

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!rootRef.current) return;
      if (rootRef.current.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (inputFocusedRef.current) return;
    setManualValue((selectedHalls || []).join(', '));
  }, [selectedHalls]);

  const selectedSet = useMemo(() => new Set((selectedHalls || []).map((x) => String(x))), [selectedHalls]);

  const mergedHalls = useMemo(() => {
    const map = new Map();
    (Array.isArray(halls) ? halls : []).forEach((hall) => {
      const name = String(hall?.name || '').trim();
      if (!name) return;
      map.set(name.toLowerCase(), {
        name,
        capacity: Number(hall?.capacity || 0),
        bookings: Array.isArray(hall?.bookings) ? hall.bookings : []
      });
    });

    (selectedHalls || []).forEach((name) => {
      const key = String(name || '').trim().toLowerCase();
      if (!key || map.has(key)) return;
      map.set(key, {
        name: String(name || '').trim(),
        capacity: 0,
        bookings: []
      });
    });

    return Array.from(map.values());
  }, [halls, selectedHalls]);

  const inputPlaceholder = useMemo(() => {
    const incoming = String(placeholder || '').trim();
    if (incoming) return incoming;
    const sample = (Array.isArray(halls) ? halls : [])
      .map((hall) => String(hall?.name || '').trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
      .slice(0, 3)
      .map((name) => `${name.charAt(0).toUpperCase()}${name.slice(1)}`);
    if (sample.length >= 2) return `${sample[0]}, ${sample[1]}, ....`;
    if (sample.length === 1) return `${sample[0]}, ....`;
    return 'Hall20, Hall21, ....';
  }, [placeholder, halls]);

  const todayBounds = useMemo(() => getTodayBounds(), []);
  const enteredRange = useMemo(() => {
    const start = parseDate(startDateTime);
    const end = parseDate(endDateTime);
    if (!start || !end || end <= start) return null;
    return { start, end };
  }, [startDateTime, endDateTime]);

  const hallRows = useMemo(() => {
    const rows = mergedHalls.map((hall) => {
      const todayIntervals = getOverlapsForRange(hall.bookings, todayBounds.start, todayBounds.end);
      const rangeIntervals = enteredRange ? getOverlapsForRange(hall.bookings, enteredRange.start, enteredRange.end) : [];
      const firstTodayStart = todayIntervals[0]?.start?.getTime() || Number.MAX_SAFE_INTEGER;
      const firstRangeStart = rangeIntervals[0]?.start?.getTime() || Number.MAX_SAFE_INTEGER;

      return {
        ...hall,
        nameLower: hall.name.toLowerCase(),
        selected: selectedSet.has(hall.name),
        filledToday: todayIntervals.length > 0,
        filledRange: rangeIntervals.length > 0,
        todayIntervals,
        rangeIntervals,
        todaySortTime: firstTodayStart,
        rangeSortTime: firstRangeStart
      };
    });

    const filterTerm = String(appliedSearch || '').trim();
    const filtered = filterTerm
      ? fuzzyFilterHallLike(
          rows,
          filterTerm,
          (row) => row.name,
          () => [],
          { threshold: 0.5, nameThreshold: 0.4 }
        )
      : rows;

    const sorted = [...filtered].sort((a, b) => {
      if (sortMode === 'NAME_ASC') return byName(a, b);
      if (sortMode === 'NAME_DESC') return byName(a, b, true);
      if (sortMode === 'CAPACITY_ASC') return byCapacity(a, b, false);
      if (sortMode === 'CAPACITY_DESC') return byCapacity(a, b, true);
      if (sortMode === 'FILLED_TODAY_FIRST') {
        return byFilledGroup(
          { ...a, sortTime: a.todaySortTime },
          { ...b, sortTime: b.todaySortTime },
          (row) => row.filledToday,
          true
        );
      }
      if (sortMode === 'UNFILLED_TODAY_FIRST') {
        return byFilledGroup(
          { ...a, sortTime: a.todaySortTime },
          { ...b, sortTime: b.todaySortTime },
          (row) => row.filledToday,
          false
        );
      }
      if (sortMode === 'FILLED_RANGE_FIRST') {
        return byFilledGroup(
          { ...a, sortTime: a.rangeSortTime },
          { ...b, sortTime: b.rangeSortTime },
          (row) => row.filledRange,
          true
        );
      }
      if (sortMode === 'UNFILLED_RANGE_FIRST') {
        return byFilledGroup(
          { ...a, sortTime: a.rangeSortTime },
          { ...b, sortTime: b.rangeSortTime },
          (row) => row.filledRange,
          false
        );
      }
      return byName(a, b);
    });

    return sorted;
  }, [mergedHalls, selectedSet, todayBounds, enteredRange, appliedSearch, sortMode]);

  const showDurationColumn = useMemo(
    () =>
      sortMode === 'FILLED_TODAY_FIRST' ||
      sortMode === 'UNFILLED_TODAY_FIRST' ||
      sortMode === 'FILLED_RANGE_FIRST' ||
      sortMode === 'UNFILLED_RANGE_FIRST',
    [sortMode]
  );

  const durationMeta = useMemo(() => {
    if (sortMode === 'FILLED_TODAY_FIRST' || sortMode === 'UNFILLED_TODAY_FIRST') {
      return { key: 'today', label: 'Today filled duration' };
    }
    if (sortMode === 'FILLED_RANGE_FIRST' || sortMode === 'UNFILLED_RANGE_FIRST') {
      return { key: 'range', label: 'Timeline filled duration' };
    }
    return { key: '', label: '' };
  }, [sortMode]);

  const toggleHall = (hallName) => {
    const value = String(hallName || '').trim();
    if (!value) return;
    const exists = selectedSet.has(value);
    const next = exists
      ? (selectedHalls || []).filter((name) => String(name) !== value)
      : [...(selectedHalls || []), value];
    onChange?.(next);
  };

  const commitManualInput = useCallback(() => {
    const parsed = parseManualInput(manualValue);
    onChange?.(parsed);
    setManualValue(parsed.join(', '));
  }, [manualValue, onChange]);

  const applySearch = (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    setAppliedSearch(String(searchDraft || '').trim());
  };

  const clearSearch = () => {
    setSearchDraft('');
    setAppliedSearch('');
  };

  const resolvedFieldHeight = Math.max(34, Number(fieldHeight) || 40);
  const resolvedPlaceholderOffsetY = Math.max(-8, Math.min(8, Number(fieldPlaceholderOffsetY) || 0));
  const resolvedFieldInputOffsetY = Math.max(-8, Math.min(8, Number(fieldInputOffsetY) || 0));
  const resolvedHallRowNameOffsetY = Math.max(-8, Math.min(8, Number(hallRowNameOffsetY) || 0));
  const resolvedHallRowCheckboxOffsetY = Math.max(-8, Math.min(8, Number(hallRowCheckboxOffsetY) || 0));
  const resolvedFieldInputPaddingTop = Math.max(0, 8 + resolvedPlaceholderOffsetY);
  const resolvedFieldInputPaddingBottom = Math.max(0, 8 - resolvedPlaceholderOffsetY);

  return (
    <div
      className={`notice-hall-picker ${disabled ? 'disabled' : ''}`}
      ref={rootRef}
      style={{
        '--notice-hall-field-height': `${resolvedFieldHeight}px`,
        '--notice-hall-placeholder-offset': `${resolvedPlaceholderOffsetY}px`,
        '--notice-hall-row-name-offset': `${resolvedHallRowNameOffsetY}px`,
        '--notice-hall-row-checkbox-offset': `${resolvedHallRowCheckboxOffsetY}px`
      }}
    >
      <div className={`notice-hall-picker-field premium-input ${open ? 'open' : ''} ${disabled ? 'disabled' : ''}`}>
        <input
          type="text"
          value={manualValue}
          disabled={disabled}
          onFocus={() => {
            inputFocusedRef.current = true;
          }}
          onBlur={() => {
            inputFocusedRef.current = false;
            commitManualInput();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitManualInput();
            }
          }}
          onChange={(e) => setManualValue(e.target.value)}
          placeholder={inputPlaceholder}
          style={{
            paddingTop: `${resolvedFieldInputPaddingTop}px`,
            paddingBottom: `${resolvedFieldInputPaddingBottom}px`,
            transform: `translateY(${resolvedFieldInputOffsetY}px)`
          }}
          aria-label="Affected halls input"
        />

        <button
          type="button"
          className={`notice-hall-picker-arrow-btn ${open ? 'open' : ''}`}
          onClick={() => !disabled && setOpen((prev) => !prev)}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label="Toggle halls dropdown"
          disabled={disabled}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>
      </div>

      {open && !disabled && (
        <div className="notice-hall-picker-panel">
          <div className="notice-hall-picker-panel-top">
            <div className="notice-hall-picker-search" role="search">
              <button
                type="button"
                className="notice-hall-picker-search-icon"
                onClick={applySearch}
                aria-label="Search halls"
                title="Search"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
              </button>
              <input
                type="text"
                value={searchDraft}
                onChange={(e) => {
                  const next = e.target.value;
                  setSearchDraft(next);
                  if (!String(next).trim()) setAppliedSearch('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    applySearch();
                  }
                }}
                placeholder={searchPlaceholder}
                style={{ transform: `translateY(${Number(searchInputOffsetY) || 0}px)` }}
              />
              {searchDraft && (
                <button
                  type="button"
                  className="notice-hall-picker-search-clear"
                  onClick={clearSearch}
                  aria-label="Clear search"
                  title="Clear"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              )}
            </div>

            <select
              className="notice-hall-picker-sort"
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value)}
              aria-label="Sort halls"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {durationMeta.key === 'range' && !enteredRange && (
            <div className="notice-hall-picker-hint">
              Enter a valid start and end timeline to evaluate timeline occupancy.
            </div>
          )}

          <div className="notice-hall-picker-list" role="listbox" aria-multiselectable="true">
            {hallRows.length === 0 && (
              <div className="notice-hall-picker-empty">
                No halls found for current search/sort.
              </div>
            )}

            {hallRows.map((hall) => {
              const durations =
                durationMeta.key === 'today'
                  ? formatIntervals(hall.todayIntervals, false)
                  : formatIntervals(hall.rangeIntervals, true);

              return (
                <label key={hall.name} className={`notice-hall-picker-row ${hall.selected ? 'selected' : ''}`}>
                  <span className="notice-hall-picker-row-main">
                    <input
                      type="checkbox"
                      checked={hall.selected}
                      onChange={() => toggleHall(hall.name)}
                    />
                    <span className="notice-hall-picker-row-name">{hall.name}</span>
                  </span>

                  <span className="notice-hall-picker-row-right">
                    <span className="notice-hall-picker-capacity">Cap {Number(hall.capacity || 0)}</span>
                    {showDurationColumn && (
                      <span className={`notice-hall-picker-duration ${durations ? 'filled' : 'available'}`}>
                        {durations || 'Available'}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>

          <div className="notice-hall-picker-footer">
            <span>{selectedHalls?.length || 0} selected</span>
            <span>{getSortModeLabel(sortMode)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
