const { getProjectSupportContext } = require('./projectSupportContextService');
const { getKnowledgeContextForPrompt } = require('./supportKnowledgeService');
const { generateText, cleanResponseText } = require('./llmGatewayService');
const { runSupportWorkflow } = require('./supportWorkflowService');
const { isCrmAutoSyncEnabled, safeSyncSupportThreadToCrm } = require('./crmIntegrationService');

const mergeUserText = ({ title, message } = {}) =>
  [String(title || '').trim(), String(message || '').trim()]
    .filter(Boolean)
    .join('\n')
    .trim();

const normalizeForIntent = (value) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const getWordCount = (text) =>
  String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length;

const shouldUseSupportMultiAgent = () =>
  String(process.env.SUPPORT_MULTI_AGENT_ENABLED || 'false').toLowerCase() === 'true';

const detectPlatformIntent = (rawText = '') => {
  const text = normalizeForIntent(rawText);
  if (!text) return { key: '', confidence: 0 };

  if (
    /\b(contact|contacts|wish\s*your\s*day)\b/.test(text) &&
    /\b(download|export|csv|excel|sheet|file|vcf|pdf|print)\b/.test(text)
  ) {
    return { key: 'CONTACT_EXPORT_FLOW', confidence: 0.95 };
  }

  if (
    /\b(menu|hamburger|three\s*line|3\s*line|navbar|quick\s*menu)\b/.test(text) &&
    /\b(contact|contacts|wish\s*your\s*day)\b/.test(text)
  ) {
    return { key: 'CONTACT_EXPORT_FLOW', confidence: 0.94 };
  }

  if (
    /\b(contact|contacts|wish\s*your\s*day)\b/.test(text) &&
    /\b(view|show|list|get|open)\b/.test(text)
  ) {
    return { key: 'CONTACT_VIEW_FLOW', confidence: 0.89 };
  }

  if (
    /\b(faculty|teacher|hod|department)\b/.test(text) &&
    /\b(register|registration|signup|sign\s*up|new\s*account|create\s*account|onboard|onboarding|request)\b/.test(text)
  ) {
    return { key: 'DEPARTMENT_ONBOARDING_FLOW', confidence: 0.96 };
  }

  if (
    /\b(schedule)\b/.test(text) &&
    /\b(view|check|booked|available|free|today|week|month|status)\b/.test(text)
  ) {
    return { key: 'SCHEDULE_VIEW_FLOW', confidence: 0.9 };
  }

  if (/\b(developer|monitoring|ops|health|metrics|ready)\b/.test(text)) {
    return { key: 'DEVELOPER_MONITORING_FLOW', confidence: 0.86 };
  }

  if (/\b(ai\s*mode|immersive|assistant\s*chat|ai\s*chat)\b/.test(text)) {
    return { key: 'AI_MODE_USAGE_FLOW', confidence: 0.86 };
  }

  if (
    /\b(about|faq|faqs|home|public\s*page|navigation|menu)\b/.test(text) &&
    /\b(where|open|find|go|route|page)\b/.test(text)
  ) {
    return { key: 'PUBLIC_NAVIGATION_FLOW', confidence: 0.84 };
  }

  if (
    /\b(calendar|calender)\b/.test(text) &&
    /\b(public\s*task|calendar\s*task|task)\b/.test(text) &&
    /\b(create|add|new|make|schedule|post)\b/.test(text)
  ) {
    return { key: 'CALENDAR_PUBLIC_TASK_CREATE', confidence: 0.95 };
  }

  if (
    /\b(calendar|calender)\b/.test(text) &&
    /\b(public\s*task|calendar\s*task|task)\b/.test(text) &&
    /\b(edit|update|move|drag|delete|remove)\b/.test(text)
  ) {
    return { key: 'CALENDAR_PUBLIC_TASK_MANAGE', confidence: 0.94 };
  }

  if (
    /\b(calendar|calender)\b/.test(text) &&
    /\b(print|export|pdf|hard\s*copy|download)\b/.test(text) &&
    /\b(month|view|range|from|to|between)\b/.test(text)
  ) {
    return { key: 'CALENDAR_PRINT_FLOW', confidence: 0.96 };
  }

  if (
    /\b(calendar|calender)\b/.test(text) &&
    /\b(search|find|lookup|event|festival|holiday|notice)\b/.test(text)
  ) {
    return { key: 'CALENDAR_SEARCH_FLOW', confidence: 0.91 };
  }

  if (
    /\b(calendar|calender)\b/.test(text) &&
    /\b(theme|appearance|light|dark|auto|mode)\b/.test(text)
  ) {
    return { key: 'CALENDAR_APPEARANCE_FLOW', confidence: 0.9 };
  }

  if (
    /\b(notice|notices)\b/.test(text) &&
    /\b(theme|appearance|light|dark|sepia|mode|toggle)\b/.test(text)
  ) {
    return { key: 'NOTICE_APPEARANCE_FLOW', confidence: 0.95 };
  }

  if (/\b(notice|notices|alert|alerts|holiday)\b/.test(text) && /\b(create|post|publish|add|new)\b/.test(text)) {
    return { key: 'NOTICE_CREATE_FLOW', confidence: 0.93 };
  }

  if (/\b(notice|notices|alert|alerts|holiday)\b/.test(text) && /\b(edit|update|change|modify)\b/.test(text)) {
    return { key: 'NOTICE_EDIT_FLOW', confidence: 0.9 };
  }

  if (
    /\b(notice|notices|alert|alerts)\b/.test(text) &&
    /\b(delete|remove|trash|restore|retention|permanent)\b/.test(text)
  ) {
    return { key: 'NOTICE_TRASH_FLOW', confidence: 0.92 };
  }

  if (/\b(feedback|bug|suggestion|praise)\b/.test(text) && /\b(create|submit|post|share|give|raise)\b/.test(text)) {
    return { key: 'FEEDBACK_SUBMIT_FLOW', confidence: 0.9 };
  }

  if (/\b(feedback)\b/.test(text) && /\b(status|review|in\s*review|done|mark|update)\b/.test(text)) {
    return { key: 'FEEDBACK_STATUS_FLOW', confidence: 0.88 };
  }

  if (/\b(contact|contacts|wish\s*your\s*day)\b/.test(text) && /\b(add|update|edit|phone|number|email)\b/.test(text)) {
    return { key: 'CONTACT_MANAGE_FLOW', confidence: 0.9 };
  }

  if (
    /\b(department)\b/.test(text) &&
    /\b(register|request|onboard|approval|approve|setup|token)\b/.test(text)
  ) {
    return { key: 'DEPARTMENT_ONBOARDING_FLOW', confidence: 0.91 };
  }

  if (
    /\b(approve|reject|vacate|leave|token|approval\s*link)\b/.test(text) &&
    /\b(booking|request)\b/.test(text)
  ) {
    return { key: 'BOOKING_APPROVAL_LINK_FLOW', confidence: 0.9 };
  }

  if (
    /\b(hall|halls)\b/.test(text) &&
    /\b(create|add|delete|remove|clear|manage|capacity)\b/.test(text) &&
    /\b(admin|dashboard|portal|panel)\b/.test(text)
  ) {
    return { key: 'HALL_MANAGEMENT_FLOW', confidence: 0.87 };
  }

  const hasHall = /\b(hall|halls|room|rooms|seminar)\b/.test(text);
  const hasBooking = /\b(book|booking|reserve|reservation)\b/.test(text);
  const asksHow = /\b(how|kaise|process|procedure|steps|guide|way)\b/.test(text);

  if (hasHall && hasBooking && asksHow) {
    return { key: 'BOOK_HALL_FLOW', confidence: 0.96 };
  }

  if (hasHall && /\b(conflict|overlap|clash|force\s*book|already\s*booked|closure)\b/.test(text)) {
    return { key: 'BOOKING_CONFLICT_FLOW', confidence: 0.93 };
  }

  if (hasHall && /\b(status|track|history|pending|approved|rejected|vacated|left)\b/.test(text) && /\b(booking|request)\b/.test(text)) {
    return { key: 'BOOKING_STATUS_FLOW', confidence: 0.9 };
  }

  if (hasHall && /\b(available|free|booked|occupied|vacant|which)\b/.test(text) && /\b(today|now|week|schedule|status|list|show)\b/.test(text)) {
    return { key: 'HALL_AVAILABILITY_FLOW', confidence: 0.88 };
  }

  if (/\b(reopen|open\s+again|otp|verify)\b/.test(text) && /\bcomplaint\b/.test(text)) {
    return { key: 'COMPLAINT_REOPEN_FLOW', confidence: 0.89 };
  }

  if (/\b(complaint|issue)\b/.test(text) && /\b(how|where|raise|file|submit|create)\b/.test(text)) {
    return { key: 'COMPLAINT_RAISE_FLOW', confidence: 0.9 };
  }

  if (/\b(query|question)\b/.test(text) && /\b(how|where|raise|ask|submit|create)\b/.test(text)) {
    return { key: 'QUERY_RAISE_FLOW', confidence: 0.9 };
  }

  if (/\b(faq|faqs|frequently\s+asked)\b/.test(text) && /\b(how|where|open|use|find|read)\b/.test(text)) {
    return { key: 'FAQ_USAGE_FLOW', confidence: 0.87 };
  }

  return { key: '', confidence: 0 };
};

const buildPlatformPlaybookAnswer = (intentKey, { kind = '' } = {}) => {
  const normalizedKind = String(kind || '').toUpperCase();

  if (intentKey === 'CALENDAR_PUBLIC_TASK_CREATE') {
    return [
      'To create a public calendar task in this platform:',
      '1) Open /calendar and log in as Admin or Department (faculty).',
      '2) Click the Create Public Task (+) button, or click a date slot in the calendar.',
      '3) Fill Task title, start/end date-time (or mark All day), and optional description.',
      '4) Tick the public visibility acknowledgement checkbox.',
      '5) Click Save; the task appears in the Public Tasks layer for shared visibility.'
    ].join('\n');
  }

  if (intentKey === 'CALENDAR_PUBLIC_TASK_MANAGE') {
    return [
      'Public task management flow:',
      '1) Open /calendar and click the public task event.',
      '2) Use Edit to change title/description/date-time, then save.',
      '3) Use Delete to remove the task permanently from shared calendar view.',
      '4) Drag/drop move is supported for editable tasks.',
      '5) Admin can manage all tasks; faculty can manage tasks they created.'
    ].join('\n');
  }

  if (intentKey === 'CALENDAR_SEARCH_FLOW') {
    return [
      'Calendar search flow:',
      '1) Open /calendar and use the search box (Enter/click search).',
      '2) Results include Notice/Alert events, Public Tasks, and Festivals.',
      '3) Click a result to jump to the event date and open details.',
      '4) For external calendar apps, use the shared ICS feed link from calendar data.'
    ].join('\n');
  }

  if (intentKey === 'CALENDAR_APPEARANCE_FLOW') {
    return [
      'Calendar appearance settings:',
      '1) Open /calendar.',
      '2) Open Appearance and choose Light, Dark, or Auto mode.',
      '3) The choice is saved per logged-in account via calendar appearance preferences.'
    ].join('\n');
  }

  if (intentKey === 'CALENDAR_PRINT_FLOW') {
    return [
      'To print calendar in Month view from one month to another:',
      '1) Open /calendar.',
      '2) Click Settings (gear) -> Print, or press Ctrl+P (Cmd+P on Mac).',
      '3) In Print view, select Month.',
      '4) Set From month and To month (mm-yyyy format, or use the month picker icon).',
      '5) Optionally tune Orientation, Font size, Grid size, and Show events/weekends toggles.',
      '6) Click Print Month to generate/export the calendar PDF for that month range.'
    ].join('\n');
  }

  if (intentKey === 'NOTICE_CREATE_FLOW') {
    return [
      'Notice/alert creation workflow:',
      '1) Log in as Admin and open /notices (or /admin/notices).',
      '2) Create a notice with title/subject and content/summary.',
      '3) Set kind as GENERAL or HOLIDAY and date-time range.',
      '4) Optionally set closure (all halls or selected rooms).',
      '5) Publish; the notice appears in Notices and Calendar views.'
    ].join('\n');
  }

  if (intentKey === 'NOTICE_EDIT_FLOW') {
    return [
      'Notice editing workflow:',
      '1) Open the notice from /notices and edit as Admin.',
      '2) You can update title, content, kind, dates, closure, and rooms.',
      '3) Save changes; updated values reflect in notice detail and calendar overlays.'
    ].join('\n');
  }

  if (intentKey === 'NOTICE_TRASH_FLOW') {
    return [
      'Notice trash/restore workflow:',
      '1) Deleting a notice moves it to Trash (soft delete).',
      '2) Open /trash to review deleted notices.',
      '3) Admin can restore a notice or permanently delete it.',
      '4) Trash retention days can be configured by admin in notice trash settings.'
    ].join('\n');
  }

  if (intentKey === 'NOTICE_APPEARANCE_FLOW') {
    return [
      'To change dark/light mode on the Notices page:',
      '1) Open /notices.',
      '2) In the readability theme row, use the visible buttons: Light, Sepia, and Dark.',
      '3) Click Light for bright mode or Dark for night mode (Sepia is the paper tone option).',
      '4) On mobile, the same Light/Sepia/Dark buttons are shown in the compact controls row.',
      '5) The 3-line menu is for navigation shortcuts; theme switching is done from these theme buttons.'
    ].join('\n');
  }

  if (intentKey === 'FEEDBACK_SUBMIT_FLOW') {
    return [
      'Feedback submission workflow:',
      '1) Open /feedback.',
      '2) Select type: BUG, SUGGESTION, or PRAISE.',
      '3) Enter message, optional email, and optional rating (1 to 5).',
      '4) Submit to create a feedback entry.'
    ].join('\n');
  }

  if (intentKey === 'FEEDBACK_STATUS_FLOW') {
    return [
      'Feedback status workflow:',
      '1) Admin/Developer can update feedback status.',
      '2) Supported statuses are NEW, IN_REVIEW, and DONE.',
      '3) Non-trusted users can view public feedback; trusted roles can manage internal flow.'
    ].join('\n');
  }

  if (intentKey === 'CONTACT_MANAGE_FLOW') {
    return [
      'Contact management workflow:',
      '1) Open /admin/contacts as Admin.',
      '2) Add contact with name, phone (10-15 digits), optional email, and order.',
      '3) Inline admin updates support phone/email edits for existing contacts.'
    ].join('\n');
  }

  if (intentKey === 'CONTACT_EXPORT_FLOW') {
    return [
      'Contacts download/export workflow:',
      'Path A (Quick Menu overlay, easiest):',
      '1) Click the 3-line quick menu and choose Contacts.',
      '2) In the Wish Your Day contacts popup, select rows by checkbox; use Select All or leave all unchecked to export all.',
      '3) Click the footer Download icon to save contacts (VCF format).',
      'Path B (Admin contacts page):',
      '4) Open /admin/contacts for full contact management (add/edit/search/sort).',
      '5) Direct CSV button is not present there by default; CSV/Excel export can be added as a feature.'
    ].join('\n');
  }

  if (intentKey === 'CONTACT_VIEW_FLOW') {
    return [
      'To view contacts on this platform:',
      '1) Open /admin/contacts for full contact management (admin side).',
      '2) Use search and sort to find contacts by name, number, or email.',
      '3) Wish Your Day contact list is maintained from this same contacts data.'
    ].join('\n');
  }

  if (intentKey === 'DEPARTMENT_ONBOARDING_FLOW') {
    return [
      'Faculty/department registration workflow:',
      '1) Open /department_register and submit official email, department name, faculty/HOD name, and phone.',
      '2) Admin reviews the request and approves/rejects it.',
      '3) After approval, account setup link/token is issued for that faculty/department.',
      '4) Complete setup from the token flow, then login via /department_login.'
    ].join('\n');
  }

  if (intentKey === 'SCHEDULE_VIEW_FLOW') {
    return [
      'Schedule viewing workflow:',
      '1) Open /schedule for a date-wise view of hall occupancy.',
      '2) Use /department/booking hall cards for current Filled/Not Filled status.',
      '3) For request-level tracking, use /department/booking/history and /admin/booking.'
    ].join('\n');
  }

  if (intentKey === 'DEVELOPER_MONITORING_FLOW') {
    return [
      'Developer/monitoring workflow:',
      '1) Login as Developer and open /developer/monitoring.',
      '2) Monitoring/ops APIs are available under /ops (health, ready, metrics, monitoring).',
      '3) Developer pages also include /developer/account and support thread routes for troubleshooting.'
    ].join('\n');
  }

  if (intentKey === 'AI_MODE_USAGE_FLOW') {
    return [
      'AI mode usage workflow:',
      '1) Open /ai for immersive AI assistant mode.',
      '2) AI can answer project workflows and trigger supported in-platform actions.',
      '3) For support-thread AI replies, use Queries/Complaints/FAQ pages where AI-generated responses are posted.'
    ].join('\n');
  }

  if (intentKey === 'PUBLIC_NAVIGATION_FLOW') {
    return [
      'Public navigation map:',
      '1) Home route: /',
      '2) About route: /about',
      '3) FAQ route: /faqs',
      '4) Public quick menu includes routes to Schedule, Notices, Calendar, AI Mode, Contacts overlay, Queries, Complaints, and Feedback.'
    ].join('\n');
  }

  if (intentKey === 'BOOKING_APPROVAL_LINK_FLOW') {
    return [
      'Booking approval-link workflow:',
      '1) Pending booking requests use approve/reject links.',
      '2) Auto-booked requests use vacate/leave links.',
      '3) These map to /api/approval/approve/:token, /reject/:token, /vacate/:token, and /leave/:token.',
      '4) Token action updates booking status and triggers department notification.'
    ].join('\n');
  }

  if (intentKey === 'HALL_MANAGEMENT_FLOW') {
    return [
      'Hall management workflow (admin):',
      '1) Open /admin/hall.',
      '2) Create hall with name and capacity.',
      '3) View live hall occupancy via /hall/view_halls.',
      '4) Use clear/vacate for active booking cleanup or delete hall when needed.'
    ].join('\n');
  }

  if (intentKey === 'BOOK_HALL_FLOW') {
    return [
      'To book a hall in this platform:',
      '1) Log in as Department and open /department/booking.',
      '2) In the HALLS list, click BOOK HALL on the required hall card.',
      '3) Fill Event Name, Start/End Date, and Start/End Time (AM/PM). Description is optional.',
      '4) Submit the form.',
      '5) If there is no overlap, it becomes AUTO_BOOKED immediately.',
      '6) If overlap/closure is detected, review conflict details and use FORCE BOOK to send for admin decision.',
      '7) Track outcomes in /department/booking/history and view current availability in /schedule.'
    ].join('\n');
  }

  if (intentKey === 'BOOKING_CONFLICT_FLOW') {
    return [
      'If a booking conflict appears in /department/booking:',
      '1) The app has detected overlap with an existing booking or a closure notice.',
      '2) Review the conflict modal details (existing bookings and closure notices).',
      '3) Cancel to change date/time, or use FORCE BOOK to raise a pending request.',
      '4) Admin will review it in /admin/booking and choose ACCEPT/REJECT.',
      '5) After decision, verify final status in /department/booking/history.'
    ].join('\n');
  }

  if (intentKey === 'BOOKING_STATUS_FLOW') {
    return [
      'Booking status tracking in this platform:',
      '1) Department side: open /department/booking/history.',
      '2) Admin side: open /admin/booking for pending and auto-booked decisions.',
      '3) Status values are PENDING, APPROVED, REJECTED, AUTO_BOOKED, LEFT, and VACATED.',
      '4) For live occupancy, use /schedule or hall cards in /department/booking (Filled / Not Filled).'
    ].join('\n');
  }

  if (intentKey === 'HALL_AVAILABILITY_FLOW') {
    return [
      'To check booked vs available halls:',
      '1) Open /schedule for date-wise booking visibility.',
      '2) Open /department/booking to see each hall card as Filled or Not Filled right now.',
      '3) Admin can inspect pending/auto-booked request flow in /admin/booking.',
      'If you want, share a date range and I will format an exact hall-status checklist for that range.'
    ].join('\n');
  }

  if (intentKey === 'COMPLAINT_RAISE_FLOW') {
    return [
      'To raise a complaint:',
      '1) Open /complaints.',
      '2) Fill Your Email, Issue Title, and Describe the issue.',
      '3) Submit the complaint to create a thread.',
      '4) The thread gets AI + community/trusted responses, and status updates happen in the same thread.',
      '5) Admin/Developer trusted solutions are clearly tagged in the complaint detail view.'
    ].join('\n');
  }

  if (intentKey === 'QUERY_RAISE_FLOW') {
    return [
      'To raise a query:',
      '1) Open /queries.',
      '2) Fill Your Email, Query Title, and Describe your question.',
      '3) Submit to create a query thread.',
      '4) Follow replies in the thread and mark accepted answers when admin approves.',
      '5) Trusted answers from Admin/Developer are shown with trusted tags.'
    ].join('\n');
  }

  if (intentKey === 'COMPLAINT_REOPEN_FLOW') {
    return [
      'Complaint reopen flow:',
      '1) Open the complaint detail thread.',
      '2) Request reopen OTP using the same reporter email used when creating the complaint.',
      '3) Verify OTP in the complaint thread.',
      '4) On successful verification, status moves to REOPENED and discussion continues in the same thread.'
    ].join('\n');
  }

  if (intentKey === 'FAQ_USAGE_FLOW') {
    return [
      'FAQ usage in this platform:',
      '1) Open /faqs to read published questions and answers.',
      '2) FAQ answers are focused on BIT Booking workflows (booking, support threads, and statuses).',
      '3) If your case is specific, use /queries or /complaints for thread-based help with follow-up.'
    ].join('\n');
  }

  if (normalizedKind === 'FAQ') {
    return [
      'This app is the BIT Seminar Hall Booking System.',
      'Core routes are /department/booking (create requests), /admin/booking (review/decide), /department/booking/history (track outcomes), and /schedule (availability).',
      'Support routes are /queries and /complaints, and FAQ route is /faqs.',
      'Share your exact workflow question and I will answer it step by step for this platform.'
    ].join('\n');
  }

  if (normalizedKind === 'QUERY') {
    return [
      'I can help with this based on BIT Booking workflows.',
      'Please mention your module clearly: booking, calendar public tasks, notices, complaints, queries, feedback, halls, departments, or contacts.',
      'Include your role (Department/Admin/Developer) and exact details so I can give precise step-by-step guidance.'
    ].join('\n');
  }

  return [
    'I can help using the exact BIT Booking workflow.',
    'For booking requests use /department/booking, admin decisions use /admin/booking, and availability checks use /schedule.',
    'For thread-based support use /queries and /complaints.'
  ].join('\n');
};

const LOW_SIGNAL_PATTERNS = [
  /i could not complete full analysis/i,
  /unable to complete right now/i,
  /please open the .*thread/i,
  /expected behavior vs actual behavior/i,
  /trusted fix quickly/i,
  /i can help with this based on bit booking workflow/i,
  /please mention your module clearly/i,
  /i can chat and help with booking workflows/i,
  /quickpagemenu/i,
  /^no additional retrieval snippets/i,
  /^no high confidence knowledge snippets/i
];

const isLikelyTruncatedSupportAnswer = (text) => {
  const clean = String(text || '').trim();
  if (!clean) return true;
  if (clean.includes('\n')) return false;
  if (/^\s*[\[{]/.test(clean)) return true;

  const hasTerminalPunctuation = /[.!?][)"'\]]*$/.test(clean);
  if (hasTerminalPunctuation) return false;

  if (/\b(of|in|on|at|to|for|from|with|and|or|the|a|an|this|that|these|those)\s*$/i.test(clean)) {
    return true;
  }

  if (/\b(across all pages of the|from the|in the|on the|for the)\s*$/i.test(clean)) {
    return true;
  }

  return getWordCount(clean) >= 10;
};

const isLowSignalSupportAnswer = (text) => {
  const clean = String(text || '').trim();
  if (!clean) return true;
  if (getWordCount(clean) < 14) return true;
  if (/^\s*[\[{]/.test(clean) && /"(type|action|payload|message)"/i.test(clean)) return true;
  if (isLikelyTruncatedSupportAnswer(clean)) return true;
  return LOW_SIGNAL_PATTERNS.some((pattern) => pattern.test(clean));
};

const buildPrompt = async ({ kind, title, message, email, threadId }) => {
  const [projectContext, retrieval] = await Promise.all([
    getProjectSupportContext(),
    getKnowledgeContextForPrompt({
      query: `${title}\n${message}`,
      maxFaq: 5,
      maxNotices: 3
    })
  ]);

  const knowledgeContext = retrieval?.block || 'No additional retrieval snippets.';
  const normalizedKind = String(kind || '').toUpperCase();
  const styleHint = normalizedKind === 'FAQ'
    ? 'Answer as an FAQ response: concise, precise, and directly reusable.'
    : 'Answer as a practical support response for an active product thread.';

  return `
You are a support AI for the BIT Seminar Hall Booking System.
Give workflow-accurate, platform-specific guidance only.

Thread type: ${kind}
Thread id: ${threadId}
Reporter email: ${email}
Title: ${title}
Message: ${message}

Project context (source-of-truth):
${projectContext}

Retrieved FAQ/notice context:
${knowledgeContext}

Guidance requirements:
- ${styleHint}
- Use exact routes/page names where relevant (example: /department/booking, /admin/booking, /queries, /complaints, /faqs, /schedule).
- Use user-visible UI labels only (example: "3-line menu", "Light/Sepia/Dark buttons"); never mention internal component names.
- Mention real booking statuses where relevant (PENDING, APPROVED, REJECTED, AUTO_BOOKED, LEFT, VACATED).
- Never output generic placeholders like "I could not complete full analysis".
- Never ask the user to open the same thread they already opened.
- If critical details are missing, request only those exact missing fields.

Output rules:
- Plain text only
- 5 to 12 lines
- Actionable, concrete, and platform-correct
`.trim();
};

const buildDeterministicFallback = (input = {}, hintedIntent = '') => {
  const merged = mergeUserText(input);
  const detected = hintedIntent
    ? { key: hintedIntent, confidence: 1 }
    : detectPlatformIntent(merged);
  return buildPlatformPlaybookAnswer(detected.key, input);
};

const postProcessSupportAnswer = (text, input, hintedIntent = '') => {
  const clean = cleanResponseText(text);
  if (isLowSignalSupportAnswer(clean)) {
    return buildDeterministicFallback(input, hintedIntent);
  }
  return clean;
};

const buildSupportDeterministicAnswer = (input = {}) => {
  const normalizedInput = {
    kind: String(input.kind || '').toUpperCase() || 'SUPPORT',
    threadId: String(input.threadId || '').trim(),
    title: String(input.title || '').trim(),
    message: String(input.message || '').trim(),
    email: String(input.email || '').trim().toLowerCase()
  };
  const mergedText = mergeUserText(normalizedInput);
  const intent = detectPlatformIntent(mergedText);
  return buildPlatformPlaybookAnswer(intent.key, normalizedInput);
};

const queueSupportThreadCrmSync = (input, aiAnswer) => {
  if (!isCrmAutoSyncEnabled()) return;

  setImmediate(() => {
    safeSyncSupportThreadToCrm({
      kind: input?.kind || 'SUPPORT',
      title: input?.title || '',
      message: input?.message || '',
      email: input?.email || '',
      threadId: input?.threadId || '',
      aiAnswer: aiAnswer || '',
      source: 'BIT-Booking3:auto-support-ai'
    }).catch(() => {});
  });
};

const generateProjectSpecificSupportAnswer = async (input = {}) => {
  const normalizedInput = {
    kind: String(input.kind || '').toUpperCase() || 'SUPPORT',
    threadId: String(input.threadId || '').trim(),
    title: String(input.title || '').trim(),
    message: String(input.message || '').trim(),
    email: String(input.email || '').trim().toLowerCase()
  };

  const mergedText = mergeUserText(normalizedInput);
  const intent = detectPlatformIntent(mergedText);

  // Any recognized platform workflow intent should stay deterministic and grounded.
  if (intent.key) {
    const answer = buildPlatformPlaybookAnswer(intent.key, normalizedInput);
    queueSupportThreadCrmSync(normalizedInput, answer);
    return answer;
  }

  try {
    const useMultiAgent = shouldUseSupportMultiAgent();
    if (useMultiAgent) {
      const workflow = await runSupportWorkflow({
        message: mergedText,
        userRole: 'SUPPORT_THREAD',
        preferredLanguage: 'en',
        history: [],
        projectContext: await getProjectSupportContext()
      });

      if (workflow?.answer) {
        const answer = postProcessSupportAnswer(workflow.answer, normalizedInput, intent.key);
        queueSupportThreadCrmSync(normalizedInput, answer);
        return answer;
      }
    }

    const prompt = await buildPrompt(normalizedInput);
    const result = await generateText({
      prompt,
      temperature: 0.2,
      maxTokens: 760,
      providers: process.env.SUPPORT_AI_PROVIDER_ORDER
        ? String(process.env.SUPPORT_AI_PROVIDER_ORDER).split(',')
        : undefined
    });

    const answer = postProcessSupportAnswer(result.text, normalizedInput, intent.key);
    queueSupportThreadCrmSync(normalizedInput, answer);
    return answer;
  } catch (err) {
    const answer = buildDeterministicFallback(normalizedInput, intent.key);
    queueSupportThreadCrmSync(normalizedInput, answer);
    return answer;
  }
};

module.exports = { generateProjectSpecificSupportAnswer, buildSupportDeterministicAnswer };
