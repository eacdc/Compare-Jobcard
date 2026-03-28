(function () {
  'use strict';

  const isLocalHost = typeof window !== 'undefined' && /localhost|127\.0\.0\.1/i.test(window.location.hostname);
  const API_BASE = isLocalHost ? 'http://localhost:3001/api' : 'https://cdcapi.onrender.com/api';

  const state = {
    clientMode: 'file',
    internalJobCardJson: null,
    selectedJobMeta: null,
    searchTimeout: null
  };

  const els = {
    tabs: Array.from(document.querySelectorAll('.tab')),
    status: document.getElementById('status'),
    compareBtn: document.getElementById('compareBtn'),
    clientFile: document.getElementById('clientFile'),
    clientText: document.getElementById('clientText'),
    clientExtracted: document.getElementById('clientExtracted'),
    internalJsonPreview: document.getElementById('internalJsonPreview'),
    jobNo: document.getElementById('jobNo'),
    jobNoDropdown: document.getElementById('jobNoDropdown'),
    detectedType: document.getElementById('detectedType'),
    detectedDb: document.getElementById('detectedDb'),
    jobStatusDisplay: document.getElementById('jobStatusDisplay'),
    jobStatusReasonDisplay: document.getElementById('jobStatusReasonDisplay'),
    jobSearchResultsSection: document.getElementById('jobSearchResultsSection'),
    jobSearchResultsBody: document.getElementById('jobSearchResultsBody'),
    presentList: document.getElementById('presentList'),
    missingList: document.getElementById('missingList'),
    discrepancyList: document.getElementById('discrepancyList'),
    summaryText: document.getElementById('summaryText')
  };

  function setStatus(text, isError) {
    els.status.textContent = text || '';
    els.status.style.color = isError ? '#ff9292' : '#9ec1ff';
  }

  function setMode(side, mode) {
    state[`${side}Mode`] = mode;
    document.querySelectorAll(`.tab[data-side="${side}"]`).forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    document.querySelectorAll(`#${side}FileMode, #${side}TextMode`).forEach((el) => {
      if (!el) return;
      el.classList.remove('active');
    });
    const active = document.getElementById(`${side}${mode.charAt(0).toUpperCase()}${mode.slice(1)}Mode`);
    if (active) active.classList.add('active');
  }

  async function extractText({ text, file }) {
    const body = new FormData();
    if (text) body.append('text', text);
    if (file) body.append('file', file);
    const res = await fetch(`${API_BASE}/job-card-compare/extract`, {
      method: 'POST',
      body
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Extraction failed');
    }
    return res.json();
  }

  function renderList(container, items, formatter) {
    container.innerHTML = '';
    const list = Array.isArray(items) && items.length > 0 ? items : ['None'];
    list.forEach((item) => {
      const li = document.createElement('li');
      li.textContent = formatter ? formatter(item) : String(item);
      container.appendChild(li);
    });
  }

  async function extractClientText() {
    const mode = state.clientMode;
    setStatus('Extracting client text...');
    try {
      let response;
      if (mode === 'text') {
        const text = els.clientText.value.trim();
        response = await extractText({ text });
      } else {
        const file = els.clientFile.files[0];
        if (!file) throw new Error('Select a client file first');
        response = await extractText({ file });
      }
      els.clientExtracted.value = response.text || '';
      return response.text || '';
    } catch (error) {
      throw error;
    }
  }

  async function fetchInternalJobCard() {
    const jobNumber = els.jobNo.value.trim();
    const type = state.selectedJobMeta?.type;
    const database = state.selectedJobMeta?.database;
    if (!jobNumber) {
      setStatus('Enter a job number to fetch internal job card.', true);
      return;
    }
    if (!type || !database) {
      setStatus('Select a job number from dropdown to auto-detect type/database.', true);
      return;
    }
    setStatus('Fetching internal job card...');
    try {
      const params = new URLSearchParams({ jobNumber, type, database });
      const res = await fetch(`${API_BASE}/job-card?${params.toString()}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to fetch job card');
      }
      const data = await res.json();
      state.internalJobCardJson = data;
      els.internalJsonPreview.value = JSON.stringify(data, null, 2);
      return data;
    } catch (error) {
      throw error;
    }
  }

  function deriveType(row) {
    const jt = String(row?.jobType || '').toLowerCase();
    const seg = String(row?.segmentName || '').toLowerCase();
    if (jt.includes('commercial') || seg.includes('commercial')) return 'commercial';
    return 'packaging';
  }

  function deriveStatusFromRow(row) {
    if (Number(row?.isCancel) === 1) return 'Cancelled';
    if (Number(row?.isClose) === 1) return 'Closed';
    return 'Pending';
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function formatJobDate(v) {
    if (v == null || v === '') return '—';
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function mapApiRowToMeta(row, database) {
    const statusRaw =
      row.status != null && String(row.status).trim() !== ''
        ? String(row.status).trim()
        : row.jcSearchStatus != null && String(row.jcSearchStatus).trim() !== ''
          ? String(row.jcSearchStatus).trim()
          : '';
    const status = statusRaw || deriveStatusFromRow(row);
    const reasonRaw =
      row.statusReason != null && String(row.statusReason).trim() !== ''
        ? String(row.statusReason).trim()
        : row.jcSearchStatusReason != null && String(row.jcSearchStatusReason).trim() !== ''
          ? String(row.jcSearchStatusReason).trim()
          : '';
    const statusReason = reasonRaw;
    return {
      jobBookingNo: String(row.jobBookingNo || ''),
      database,
      type: deriveType(row),
      clientName: row.clientName != null ? String(row.clientName) : '',
      status,
      statusReason,
      printStatus: row.printStatus != null && String(row.printStatus).trim() !== '' ? String(row.printStatus).trim() : '',
      jobBookingDate: row.jobBookingDate
    };
  }

  function hideJobDropdown() {
    els.jobNoDropdown.style.display = 'none';
    els.jobNoDropdown.innerHTML = '';
  }

  async function runJobSearch(keyword) {
    const encoded = encodeURIComponent(keyword);
    const urls = [
      `${API_BASE}/job-card/search?jobBookingNo=${encoded}&database=KOL`,
      `${API_BASE}/job-card/search?jobBookingNo=${encoded}&database=AHM`
    ];
    const results = await Promise.all(urls.map(async (url) => {
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json().catch(() => ({}));
      const rows = Array.isArray(data?.results) ? data.results : [];
      const db = /database=AHM/.test(url) ? 'AHM' : 'KOL';
      return rows.map((row) => mapApiRowToMeta(row, db));
    }));
    const flat = results.flat().filter((r) => r.jobBookingNo);
    const unique = new Map();
    flat.forEach((row) => {
      const key = `${row.jobBookingNo}|${row.database}|${row.type}`;
      if (!unique.has(key)) unique.set(key, row);
    });
    return Array.from(unique.values());
  }

  function renderJobSearchTable(rows) {
    const tbody = els.jobSearchResultsBody;
    const section = els.jobSearchResultsSection;
    if (!tbody || !section) return;
    tbody.innerHTML = '';
    if (!rows.length) {
      section.hidden = true;
      return;
    }
    section.hidden = false;
    rows.forEach((row) => {
      const tr = document.createElement('tr');
      tr.tabIndex = 0;
      tr.innerHTML = [
        escapeHtml(row.jobBookingNo),
        escapeHtml(row.database),
        escapeHtml(row.type),
        escapeHtml(row.clientName || '—'),
        escapeHtml(row.status || '—'),
        escapeHtml(row.statusReason || '—'),
        escapeHtml(row.printStatus || '—'),
        escapeHtml(formatJobDate(row.jobBookingDate))
      ].map((cell) => `<td>${cell}</td>`).join('');
      const activate = () => selectJob(row);
      tr.addEventListener('click', activate);
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate();
        }
      });
      tbody.appendChild(tr);
    });
  }

  async function searchJobNumbers(keyword) {
    const all = await runJobSearch(keyword);
    return all.slice(0, 25);
  }

  function selectJob(row) {
    els.jobNo.value = row.jobBookingNo;
    state.selectedJobMeta = row;
    els.detectedType.value = row.type;
    els.detectedDb.value = row.database;
    if (els.jobStatusDisplay) els.jobStatusDisplay.value = row.status || '';
    if (els.jobStatusReasonDisplay) els.jobStatusReasonDisplay.value = row.statusReason || '';
    hideJobDropdown();
  }

  async function resolveSelectedJobMeta() {
    if (state.selectedJobMeta?.type && state.selectedJobMeta?.database) return state.selectedJobMeta;
    const jobNumber = els.jobNo.value.trim();
    if (!jobNumber) throw new Error('Enter/select a job number first.');
    const rows = await searchJobNumbers(jobNumber);
    const exact = rows.find((r) => r.jobBookingNo === jobNumber) || rows[0];
    if (!exact) throw new Error('No matching job number found.');
    state.selectedJobMeta = exact;
    els.detectedType.value = exact.type;
    els.detectedDb.value = exact.database;
    if (els.jobStatusDisplay) els.jobStatusDisplay.value = exact.status || '';
    if (els.jobStatusReasonDisplay) els.jobStatusReasonDisplay.value = exact.statusReason || '';
    return exact;
  }

  function renderJobDropdown(rows) {
    if (!rows.length) {
      hideJobDropdown();
      return;
    }
    els.jobNoDropdown.innerHTML = '';
    rows.forEach((row) => {
      const item = document.createElement('div');
      item.className = 'job-option';
      const statusPart = row.status ? ` | ${row.status}` : '';
      const reasonPart = row.statusReason ? ` — ${row.statusReason}` : '';
      const line = `${row.jobBookingNo} | ${row.type} | ${row.database}${row.clientName ? ` | ${row.clientName}` : ''}${statusPart}${reasonPart}`;
      item.textContent = line.length > 140 ? `${line.slice(0, 137)}…` : line;
      item.title = line;
      item.addEventListener('click', () => selectJob(row));
      els.jobNoDropdown.appendChild(item);
    });
    els.jobNoDropdown.style.display = 'block';
  }

  async function compare() {
    try {
      setStatus('Extracting client text...');
      const clientText = await extractClientText();
      els.clientExtracted.value = clientText;
      if (!clientText) throw new Error('Could not extract client text.');

      setStatus('Resolving internal job metadata...');
      await resolveSelectedJobMeta();

      setStatus('Fetching internal job card JSON...');
      const internalJobCardJson = await fetchInternalJobCard();
      if (!internalJobCardJson) throw new Error('Failed to fetch internal job card JSON.');
      state.internalJobCardJson = internalJobCardJson;
      els.internalJsonPreview.value = JSON.stringify(internalJobCardJson, null, 2);

      setStatus('Comparing...');
      const res = await fetch(`${API_BASE}/job-card-compare/compare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientText, internalJobCardJson })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Comparison failed');
      }
      const data = await res.json();
      renderList(els.presentList, data.present);
      renderList(els.missingList, data.missing);
      renderList(els.discrepancyList, data.discrepancies, (x) => `Client: ${x.client} | Job Card: ${x.jobCard} | Note: ${x.note}`);
      els.summaryText.textContent = data.summary || '';
      setStatus('Comparison complete.');
      requestAnimationFrame(() => {
        const resultsEl = document.getElementById('comparisonResults');
        if (resultsEl) {
          resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  els.tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      setMode(btn.dataset.side, btn.dataset.mode);
    });
  });
  els.compareBtn.addEventListener('click', compare);

  els.jobNo.addEventListener('input', () => {
    const value = els.jobNo.value.trim();
    state.selectedJobMeta = null;
    els.detectedType.value = '';
    els.detectedDb.value = '';
    if (els.jobStatusDisplay) els.jobStatusDisplay.value = '';
    if (els.jobStatusReasonDisplay) els.jobStatusReasonDisplay.value = '';
    if (state.searchTimeout) clearTimeout(state.searchTimeout);
    if (value.length < 4) {
      hideJobDropdown();
      renderJobSearchTable([]);
      return;
    }
    state.searchTimeout = setTimeout(async () => {
      try {
        const allRows = await runJobSearch(value);
        renderJobDropdown(allRows.slice(0, 25));
        renderJobSearchTable(allRows);
      } catch (error) {
        hideJobDropdown();
        renderJobSearchTable([]);
        setStatus(error.message || 'Failed to search job numbers.', true);
      }
    }, 300);
  });

  document.addEventListener('click', (e) => {
    const wrap = document.querySelector('.job-search-wrap');
    if (wrap && !wrap.contains(e.target)) hideJobDropdown();
  });
})();
