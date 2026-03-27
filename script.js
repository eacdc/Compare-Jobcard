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

  function hideJobDropdown() {
    els.jobNoDropdown.style.display = 'none';
    els.jobNoDropdown.innerHTML = '';
  }

  async function searchJobNumbers(keyword) {
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
      return rows.map((row) => ({
        jobBookingNo: String(row.jobBookingNo || ''),
        database: /database=AHM/.test(url) ? 'AHM' : 'KOL',
        type: deriveType(row),
        clientName: row.clientName || ''
      }));
    }));
    const flat = results.flat().filter((r) => r.jobBookingNo);
    const unique = new Map();
    flat.forEach((row) => {
      const key = `${row.jobBookingNo}|${row.database}|${row.type}`;
      if (!unique.has(key)) unique.set(key, row);
    });
    return Array.from(unique.values()).slice(0, 25);
  }

  function selectJob(row) {
    els.jobNo.value = row.jobBookingNo;
    state.selectedJobMeta = row;
    els.detectedType.value = row.type;
    els.detectedDb.value = row.database;
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
      item.textContent = `${row.jobBookingNo} | ${row.type} | ${row.database}${row.clientName ? ` | ${row.clientName}` : ''}`;
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
    if (state.searchTimeout) clearTimeout(state.searchTimeout);
    if (value.length < 4) {
      hideJobDropdown();
      return;
    }
    state.searchTimeout = setTimeout(async () => {
      try {
        const rows = await searchJobNumbers(value);
        renderJobDropdown(rows);
      } catch (error) {
        hideJobDropdown();
        setStatus(error.message || 'Failed to search job numbers.', true);
      }
    }, 300);
  });

  document.addEventListener('click', (e) => {
    const wrap = document.querySelector('.job-search-wrap');
    if (wrap && !wrap.contains(e.target)) hideJobDropdown();
  });
})();
