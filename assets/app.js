(async () => {
  function getRRuleClass() {
    // Support either global exposure: window.RRule or window.rrule.RRule
    if (typeof window !== 'undefined') {
      if (typeof window.RRule !== 'undefined') return window.RRule;
      if (window.rrule && typeof window.rrule.RRule !== 'undefined') return window.rrule.RRule;
    }
    return null;
  }

  function expandRecurringForCalendar(events) {
    const RRuleCls = getRRuleClass();
    if (!RRuleCls) return [];
    const out = [];
    const now = new Date();
    const startRange = new Date(now.getFullYear(), now.getMonth(), 1);
    const endRange = new Date(now.getFullYear(), now.getMonth() + 3, 0);
    for (const ev of events) {
      try {
        const opts = RRuleCls.parseString(ev.rrule);
        if (ev.start) opts.dtstart = new Date(ev.start);
        const rule = new RRuleCls(opts);
        const occs = rule.between(startRange, endRange, true);
        for (const dt of occs) {
          const inst = { ...ev, start: dt.toISOString(), rrule: null };
          out.push(inst);
        }
      } catch {}
    }
    return out;
  }

  const api = { json: '/data/events-all.json' };

  async function fetchEvents() {
    try {
      const res = await fetch(api.json, { cache: 'no-store' });
      if (!res.ok) return [];
      const data = await res.json();
      if (!Array.isArray(data)) return [];
      return data;
    } catch { return []; }
  }

  function toFC(ev) {
    const obj = { title: ev.title || '(no title)' };
    if (ev.rrule && getRRuleClass()) {
      obj.rrule = ev.rrule;
      if (ev.start) obj.dtstart = ev.start;
      obj.allDay = !!ev.allDay;
    } else {
      obj.allDay = !!ev.allDay;
      if (obj.allDay && ev.start) {
        const s = ev.start.substring(0, 10);
        let e = ev.end ? ev.end.substring(0, 10) : null;
        if (e) {
          const d = new Date(e + 'T00:00:00');
          d.setDate(d.getDate() + 1);
          const ePlus = d.toISOString().substring(0, 10);
          obj.start = s; obj.end = ePlus;
        } else { obj.start = s; }
      } else {
        obj.start = ev.start; obj.end = ev.end;
      }
    }
    // Carry id and original for mapping back on click
    if (typeof ev.id !== 'undefined' && ev.id !== null) obj.id = String(ev.id);
    obj.extendedProps = { original: ev };
    return obj;
  }

  function renderList(events) {
    const ul = document.getElementById('list');
    const empty = document.getElementById('empty');
    ul.innerHTML = '';
    if (!events.length) { empty.style.display = 'block'; return; }
    empty.style.display = 'none';
    const fmtDate = new Intl.DateTimeFormat(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
    const fmtDateTime = new Intl.DateTimeFormat(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    for (const ev of events.slice(0, 50)) {
      const li = document.createElement('li');
      const d = ev.start ? new Date(ev.start) : null;
      const when = d ? (ev.allDay ? fmtDate.format(d) : fmtDateTime.format(d)) : '';
      const where = ev.location ? ' — ' + ev.location : '';
      li.innerHTML = '<time>' + when + '</time><strong>' + (ev.title || '(no title)') + '</strong>' + where;
      if (typeof ev.id !== 'undefined') li.dataset.id = String(ev.id);
      li.style.cursor = 'pointer';
      li.addEventListener('click', () => showDetails(ev));
      ul.appendChild(li);
    }
  }

  function renderCalendar(events) {
    const el = document.getElementById('calendar');
    const cal = new FullCalendar.Calendar(el, {
      initialView: (window.matchMedia && window.matchMedia('(max-width: 640px)').matches) ? 'dayGridMonth' : 'timeGridWeek',
      height: (window.matchMedia && window.matchMedia('(max-width: 640px)').matches) ? 'auto' : 700,
      headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek' },
      buttonText: { today: 'today', month: 'month', week: 'week' },
      events: events.map(toFC),
      eventClick(info) {
        if (info && info.jsEvent) info.jsEvent.preventDefault();
        const original = info.event.extendedProps && info.event.extendedProps.original ? info.event.extendedProps.original : null;
        const ev = original ? { ...original } : { title: info.event.title };
        if (info.event.start) ev.start = info.event.start.toISOString();
        if (info.event.end) ev.end = info.event.end.toISOString();
        ev.allDay = !!info.event.allDay;
        showDetails(ev);
      }
    });
    cal.render();
  }

  const events = await fetchEvents();
  const eventsForCalendar = (() => { const non = events.filter(ev => !ev.rrule); const rec = events.filter(ev => !!ev.rrule); const expanded = expandRecurringForCalendar(rec); return [...non, ...expanded]; })();
  events.sort((a,b) => ((a.start||'').localeCompare(b.start||'') || (a.id||0) - (b.id||0)));

  // Build upcoming list (today forward), including next occurrence for recurring events
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  function isNonRecurringUpcoming(ev) {
    if (!ev.start && !ev.end) return false;
    const start = ev.start ? new Date(ev.start) : null;
    const end = ev.end ? new Date(ev.end) : null;
    if (ev.allDay) {
      if (end) {
        const endInclusive = new Date(end);
        if (/^\d{4}-\d{2}-\d{2}$/.test(ev.end)) {
          endInclusive.setHours(23,59,59,999);
        }
        return endInclusive >= startOfToday;
      }
      return start ? start >= startOfToday : false;
    }
    if (start && start >= startOfToday) return true;
    if (start && end && start < now && end >= now) return true;
    return false;
  }

  function nextOccurrenceFromRRule(ev) {
    const RRuleCls = getRRuleClass();
    if (!ev.rrule || !RRuleCls) return null;
    try {
      const opts = RRuleCls.parseString(ev.rrule);
      if (ev.start) opts.dtstart = new Date(ev.start);
      const rule = new RRuleCls(opts);
      const next = rule.after(startOfToday, true);
      if (!next) return null;
      return { ...ev, start: next.toISOString() };
    } catch {
      return null;
    }
  }

  const nonRecurringUpcoming = events.filter(ev => !ev.rrule).filter(isNonRecurringUpcoming);
  const recurringNexts = events
    .filter(ev => !!ev.rrule)
    .map(nextOccurrenceFromRRule)
    .filter(Boolean);

  const upcomingCombined = [...nonRecurringUpcoming, ...recurringNexts]
    .sort((a,b) => ((a.start||'').localeCompare(b.start||'') || (a.id||0) - (b.id||0)));

  renderCalendar(eventsForCalendar);
  renderList(upcomingCombined);

  // Modal show/hide and formatter
  function showDetails(ev) {
    const overlay = document.getElementById('overlay');
    const modal = document.getElementById('modal');
    if (!overlay || !modal) return;
    const fmtDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: ev.allDay ? undefined : 'short' });
    const startText = ev.start ? fmtDate.format(new Date(ev.start)) : '';
    let endText = '';
    if (ev.end) {
      try { endText = fmtDate.format(new Date(ev.end)); } catch {}
    }
    const where = ev.location ? buildLocationBlock(ev.location) : '';
    const desc = ev.description ? '<div style="margin-top:10px; white-space:pre-wrap">' + linkify(escapeHtml(ev.description)) + '</div>' : '';
    const when = '<div><strong>When:</strong> ' + startText + (endText && endText !== startText ? ' – ' + endText : '') + '</div>';
    const header = '<h3 style="margin:0 0 8px">' + (ev.title ? escapeHtml(ev.title) : '(no title)') + '</h3>';
    const content = header + when + where + desc;
    // Rebuild modal content but keep Close button at top-right
    modal.innerHTML = '<button id="close" style="position:absolute;right:8px;top:8px;background:#e2e8f0;border:none;border-radius:6px;padding:6px 10px;cursor:pointer">Close</button>' + content;
    overlay.style.display = 'block';
    const closeBtn = document.getElementById('close');
    if (closeBtn) closeBtn.onclick = hideDetails;
    overlay.onclick = (e) => { if (e.target === overlay) hideDetails(); };
    document.addEventListener('keydown', onEscOnce, { once: true });
    function onEscOnce(e) { if (e.key === 'Escape') hideDetails(); }
  }

  function hideDetails() {
    const overlay = document.getElementById('overlay');
    if (overlay) overlay.style.display = 'none';
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function linkify(text) {
    const urlRegex = /(https?:\/\/[^\s)]+)|(www\.[^\s)]+)/g;
    return text.replace(urlRegex, (url) => {
      const href = url.startsWith('http') ? url : ('https://' + url);
      return '<a href="' + href + '" target="_blank" rel="noopener noreferrer">' + url + '</a>';
    });
  }

  function buildLocationBlock(locationText) {
    const addressHtml = escapeHtml(locationText);
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isMac = /Macintosh|Mac OS X/.test(ua);
    const isApple = isIOS || isMac;
    const isAndroid = /Android/.test(ua);
    const appleUrl = 'https://maps.apple.com/?q=' + encodeURIComponent(locationText);
    const googleUrl = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(locationText);

    let linksHtml = '';
    if (isApple) {
      linksHtml = '<a href="' + appleUrl + '" target="_blank" rel="noopener noreferrer">Open in Apple Maps</a> · '
        + '<a href="' + googleUrl + '" target="_blank" rel="noopener noreferrer">Open in Google Maps</a>';
    } else if (isAndroid) {
      linksHtml = '<a href="' + googleUrl + '" target="_blank" rel="noopener noreferrer">Open in Google Maps</a>';
    } else {
      linksHtml = '<a href="' + googleUrl + '" target="_blank" rel="noopener noreferrer">Open in Google Maps</a> · '
        + '<a href="' + appleUrl + '" target="_blank" rel="noopener noreferrer">Open in Apple Maps</a>';
    }

    return '<div style="margin-top:6px"><strong>Location:</strong> ' + addressHtml
      + '<div style="margin-top:4px;color:#475569;font-size:14px">' + linksHtml + '</div></div>';
  }
})();
