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
    const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    for (const ev of events.slice(0, 50)) {
      const li = document.createElement('li');
      const when = ev.start ? fmt.format(new Date(ev.start)) : '';
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
      initialView: 'timeGridWeek', height: 700,
      headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek' },
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
    const where = ev.location ? '<div style="margin-top:6px"><strong>Location:</strong> ' + escapeHtml(ev.location) + '</div>' : '';
    const desc = ev.description ? '<div style="margin-top:10px; white-space:pre-wrap">' + linkify(escapeHtml(ev.description)) + '</div>' : '';
    const when = '<div><strong>When:</strong> ' + startText + (endText && endText !== startText ? ' – ' + endText : '') + '</div>';
    const header = '<h3 style="margin:0 0 8px">' + (ev.title ? escapeHtml(ev.title) : '(no title)') + '</h3>';
    const mapSlot = ev.location ? '<div id="map-slot" style="margin-top:12px"></div>' : '';
    const content = header + when + where + desc + mapSlot;
    // Rebuild modal content but keep Close button at top-right
    modal.innerHTML = '<button id="close" style="position:absolute;right:8px;top:8px;background:#e2e8f0;border:none;border-radius:6px;padding:6px 10px;cursor:pointer">Close</button>' + content;
    overlay.style.display = 'block';
    const closeBtn = document.getElementById('close');
    if (closeBtn) closeBtn.onclick = hideDetails;
    overlay.onclick = (e) => { if (e.target === overlay) hideDetails(); };
    document.addEventListener('keydown', onEscOnce, { once: true });
    function onEscOnce(e) { if (e.key === 'Escape') hideDetails(); }

    // Lazy-render a small map if we have a location
    if (ev.location) {
      const slot = modal.querySelector('#map-slot');
      if (slot) {
        slot.innerHTML = '<div class="muted">Loading map…</div>';
        renderLocationMap(ev.location, slot);
      }
    }
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

  // Geocode and embed a lightweight OpenStreetMap iframe (no heavy JS deps)
  async function renderLocationMap(locationText, slotEl) {
    const trimmed = String(locationText || '').trim();
    if (!trimmed) { slotEl.innerHTML = ''; return; }
    const cached = getGeocodeFromCache(trimmed);
    if (cached) {
      slotEl.innerHTML = buildMapEmbedHtml(cached.lat, cached.lon, trimmed);
      return;
    }
    try {
      const params = new URLSearchParams({ format: 'jsonv2', q: trimmed, limit: '1', addressdetails: '0' });
      const res = await fetch('https://nominatim.openstreetmap.org/search?' + params.toString(), {
        headers: { 'Accept': 'application/json' },
      });
      if (!res.ok) throw new Error('geocode failed');
      const data = await res.json();
      if (Array.isArray(data) && data.length && data[0].lat && data[0].lon) {
        const lat = parseFloat(data[0].lat);
        const lon = parseFloat(data[0].lon);
        saveGeocodeToCache(trimmed, lat, lon);
        slotEl.innerHTML = buildMapEmbedHtml(lat, lon, trimmed);
      } else {
        slotEl.innerHTML = buildMapFallbackHtml(trimmed);
      }
    } catch {
      slotEl.innerHTML = buildMapFallbackHtml(trimmed);
    }
  }

  function buildMapEmbedHtml(lat, lon, queryLabel) {
    const delta = 0.01; // ~1.1km latitude delta
    const minLon = (lon - delta).toFixed(5);
    const minLat = (lat - delta).toFixed(5);
    const maxLon = (lon + delta).toFixed(5);
    const maxLat = (lat + delta).toFixed(5);
    const bbox = encodeURIComponent(minLon + ',' + minLat + ',' + maxLon + ',' + maxLat);
    const embedUrl = 'https://www.openstreetmap.org/export/embed.html?bbox=' + bbox + '&layer=mapnik&marker=' + encodeURIComponent(lat + ',' + lon);
    const viewUrl = 'https://www.openstreetmap.org/?mlat=' + encodeURIComponent(lat) + '&mlon=' + encodeURIComponent(lon) + '#map=15/' + encodeURIComponent(lat) + '/' + encodeURIComponent(lon);
    const osmLink = '<div style="margin-top:6px"><a href="' + viewUrl + '" target="_blank" rel="noopener noreferrer">Open in OpenStreetMap</a></div>';
    return '<div style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">\
<iframe title="Map for ' + escapeHtml(queryLabel) + '" width="100%" height="260" frameborder="0" scrolling="no" marginheight="0" marginwidth="0" src="' + embedUrl + '"></iframe></div>' + osmLink;
  }

  function buildMapFallbackHtml(query) {
    const searchUrl = 'https://www.openstreetmap.org/search?query=' + encodeURIComponent(query);
    return '<div class="muted">Could not load map.</div><div style="margin-top:6px"><a href="' + searchUrl + '" target="_blank" rel="noopener noreferrer">Search this location on OpenStreetMap</a></div>';
  }

  function getGeocodeFromCache(query) {
    try {
      const raw = localStorage.getItem('geo:' + query);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || typeof obj.lat !== 'number' || typeof obj.lon !== 'number') return null;
      const maxAgeMs = 1000 * 60 * 60 * 24 * 30; // 30 days
      if (obj.ts && (Date.now() - obj.ts) > maxAgeMs) return null;
      return obj;
    } catch { return null; }
  }

  function saveGeocodeToCache(query, lat, lon) {
    try {
      const obj = { lat: Number(lat), lon: Number(lon), ts: Date.now() };
      localStorage.setItem('geo:' + query, JSON.stringify(obj));
    } catch {}
  }
})();
