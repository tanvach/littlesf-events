(async () => {
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
    if (ev.rrule && typeof window.RRule !== 'undefined') {
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
    return obj;
  }

  function renderList(events) {
    const ul = document.getElementById('list');
    const empty = document.getElementById('empty');
    ul.innerHTML = '';
    if (!events.length) { empty.style.display = 'block'; return; }
    empty.style.display = 'none';
    const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    for (const ev of events.slice(0, 50)) {
      const li = document.createElement('li');
      const when = ev.start ? fmt.format(new Date(ev.start)) : '';
      const where = ev.location ? ' — ' + ev.location : '';
      li.innerHTML = '<time>' + when + '</time><strong>' + (ev.title || '(no title)') + '</strong>' + where;
      ul.appendChild(li);
    }
  }

  function renderCalendar(events) {
    const el = document.getElementById('calendar');
    const cal = new FullCalendar.Calendar(el, {
      initialView: 'timeGridWeek', height: 700,
      headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek' },
      events: events.map(toFC),
    });
    cal.render();
  }

  const events = await fetchEvents();
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
    if (!ev.rrule || typeof window.RRule === 'undefined') return null;
    try {
      const opts = window.RRule.parseString(ev.rrule);
      if (ev.start) opts.dtstart = new Date(ev.start);
      const rule = new window.RRule(opts);
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

  renderCalendar(events);
  renderList(upcomingCombined);
})();
