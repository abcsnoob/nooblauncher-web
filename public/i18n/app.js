'use strict';

/**
 * Noob Launcher - Translation Portal App
 * Giao diện dịch trực quan, lưu GitHub qua REST API, tính tiến trình %
 */

const CONFIG = {
  owner: 'abcsnoob',
  repo: 'nooblauncher-web',
  branch: 'main',
  localesPath: 'locales', // đường dẫn thư mục locales trên repo
  baseSourceLang: 'vi'    // ngôn ngữ nguồn để đối chiếu
};

let manifest = null;
let sourceDictionary = null;
let currentLangCode = 'en';
let currentDictionary = null;
let currentFilter = 'all';
let searchQuery = '';
let modifiedKeys = new Set();

// Helper: Phẳng hoá object JSON lồng nhau
function flattenObject(obj, prefix = '') {
  let res = {};
  for (const k in obj) {
    if (k.startsWith('_')) continue;
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (typeof obj[k] === 'object' && obj[k] !== null) {
      Object.assign(res, flattenObject(obj[k], fullKey));
    } else {
      res[fullKey] = String(obj[k]);
    }
  }
  return res;
}

// Helper: Chuyển object phẳng ngược lại về dạng lồng nhau
function unflattenObject(data, meta = null) {
  const result = {};
  if (meta) result._meta = meta;

  for (const key in data) {
    const keys = key.split('.');
    let cur = result;
    for (let i = 0; i < keys.length; i++) {
      const part = keys[i];
      if (i === keys.length - 1) {
        cur[part] = data[key];
      } else {
        cur[part] = cur[part] || {};
        cur = cur[part];
      }
    }
  }
  return result;
}

// Toast
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast-box show ${type}`;
  setTimeout(() => {
    t.className = 'toast-box';
  }, 4000);
}

// Khởi tạo
document.addEventListener('DOMContentLoaded', async () => {
  // Đọc hash URL nếu có (ví dụ #/translate/ja hoặc ?lang=ja)
  const urlParams = new URLSearchParams(window.location.search);
  const langFromUrl = urlParams.get('lang') || window.location.hash.replace('#/translate/', '').replace('#', '');
  if (langFromUrl) {
    currentLangCode = langFromUrl;
  }

  // Nạp ngôn ngữ gốc và manifest
  await loadInitialData();
  setupEventListeners();
});

async function loadInitialData() {
  try {
    // Nạp nguồn tham chiếu (vi.json)
    const srcRes = await fetch(`/locales/${CONFIG.baseSourceLang}.json?t=${Date.now()}`);
    sourceDictionary = await srcRes.json();

    // Nạp manifest danh sách ngôn ngữ
    const manifestRes = await fetch(`/locales/index.json?t=${Date.now()}`);
    manifest = await manifestRes.json();

    renderLanguagesList();
    await selectLanguage(currentLangCode);
  } catch (err) {
    console.error('Lỗi khi nạp dữ liệu locales:', err);
    showToast('Lỗi khi tải từ điển ngôn ngữ. Vui lòng kiểm tra lại!', 'error');
  }
}

function renderLanguagesList() {
  const container = document.getElementById('lang-list');
  if (!manifest || !manifest.languages) return;

  container.innerHTML = manifest.languages.map((item) => {
    const isActive = item.code === currentLangCode;
    return `
      <div class="lang-item ${isActive ? 'active' : ''}" data-code="${item.code}">
        <div class="lang-item-head">
          <span>${item.name}</span>
          <span class="lang-code">${item.code}</span>
        </div>
        <div class="progress-bar-wrap">
          <div class="progress-bar-fill" style="width: ${item.progress}%"></div>
        </div>
        <div style="font-size:0.75rem; color:var(--text-muted); display:flex; justify-content:space-between;">
          <span>Tiến trình</span>
          <span><b>${item.progress}%</b> (${item.translated}/${item.total})</span>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.lang-item').forEach(el => {
    el.addEventListener('click', () => {
      selectLanguage(el.dataset.code);
    });
  });
}

async function selectLanguage(code) {
  currentLangCode = code;
  window.history.replaceState(null, '', `?lang=${code}`);

  // Cập nhật giao diện sidebar active
  document.querySelectorAll('.lang-item').forEach(el => {
    el.classList.toggle('active', el.dataset.code === code);
  });

  document.getElementById('current-lang-name').textContent = `Đang nạp [${code}]...`;

  try {
    const res = await fetch(`/locales/${code}.json?t=${Date.now()}`);
    if (res.ok) {
      currentDictionary = await res.json();
    } else {
      // Ngôn ngữ mới tạo trên client chưa có file trên server
      currentDictionary = { _meta: { code, name: code } };
    }
  } catch (e) {
    currentDictionary = { _meta: { code, name: code } };
  }

  modifiedKeys.clear();
  renderStrings();
}

function calculateProgress(flatSource, flatTarget) {
  const total = Object.keys(flatSource).length;
  let translated = 0;
  for (const k in flatSource) {
    if (flatTarget[k] && flatTarget[k].trim() !== '') {
      translated++;
    }
  }
  const pct = total === 0 ? 0 : Math.min(100, Math.round((translated / total) * 100));
  return { translated, total, pct };
}

function renderStrings() {
  const container = document.getElementById('strings-list');
  const langNameEl = document.getElementById('current-lang-name');
  const langStatsEl = document.getElementById('current-lang-stats');

  const langMetaName = (currentDictionary._meta && currentDictionary._meta.name) || currentLangCode;
  langNameEl.textContent = `${langMetaName} (${currentLangCode})`;

  const flatSource = flattenObject(sourceDictionary);
  const flatTarget = flattenObject(currentDictionary);

  const stats = calculateProgress(flatSource, flatTarget);
  langStatsEl.textContent = `${stats.translated}/${stats.total} chuỗi (${stats.pct}%)`;

  // Cập nhật lại manifest trên UI
  if (manifest && manifest.languages) {
    const found = manifest.languages.find(l => l.code === currentLangCode);
    if (found) {
      found.translated = stats.translated;
      found.progress = stats.pct;
      renderLanguagesList();
    }
  }

  // Lọc theo search và tab
  const keys = Object.keys(flatSource).filter(key => {
    const srcVal = flatSource[key] || '';
    const tarVal = flatTarget[key] || '';
    const isTranslated = !!(tarVal && tarVal.trim() !== '');

    if (currentFilter === 'missing' && isTranslated) return false;
    if (currentFilter === 'done' && !isTranslated) return false;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return key.toLowerCase().includes(q) ||
             srcVal.toLowerCase().includes(q) ||
             tarVal.toLowerCase().includes(q);
    }
    return true;
  });

  if (keys.length === 0) {
    container.innerHTML = `<div class="muted py-5 text-center">Không tìm thấy chuỗi nào phù hợp bộ lọc.</div>`;
    return;
  }

  container.innerHTML = keys.map(key => {
    const srcVal = flatSource[key] || '';
    const tarVal = flatTarget[key] || '';
    const isTranslated = !!(tarVal && tarVal.trim() !== '');

    // Kiểm tra biến nội suy {variable}
    const srcVars = (srcVal.match(/\{(\w+)\}/g) || []).sort().join(',');
    const tarVars = (tarVal.match(/\{(\w+)\}/g) || []).sort().join(',');
    const varMismatch = isTranslated && srcVars !== tarVars;

    return `
      <div class="string-card ${isTranslated ? 'translated' : 'untranslated'}" data-key="${key}">
        <div class="string-key">${key}</div>
        <div class="string-row">
          <div class="source-box">${escapeHtml(srcVal)}</div>
          <div style="display:flex; flex-direction:column; gap:6px;">
            <textarea class="target-input" data-key="${key}" placeholder="Nhập bản dịch tại đây...">${escapeHtml(tarVal)}</textarea>
            <div class="string-hint ${varMismatch ? 'show' : ''}">
              ⚠️ Cảnh báo: Biến tham số không khớp với bản gốc (${srcVars || 'không có'}). Hãy giữ nguyên dạng {tên_biến}.
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Gắn sự kiện thay đổi nội dung
  container.querySelectorAll('.target-input').forEach(textarea => {
    textarea.addEventListener('input', (e) => {
      const k = e.target.dataset.key;
      const v = e.target.value;
      const flatCur = flattenObject(currentDictionary);
      flatCur[k] = v;
      currentDictionary = unflattenObject(flatCur, currentDictionary._meta);
      modifiedKeys.add(k);

      // Cập nhật card trạng thái
      const card = e.target.closest('.string-card');
      if (card) {
        card.classList.toggle('translated', v.trim() !== '');
        card.classList.toggle('untranslated', v.trim() === '');
      }

      // Cập nhật % ngay tức thì
      const newStats = calculateProgress(flatSource, flattenObject(currentDictionary));
      langStatsEl.textContent = `${newStats.translated}/${newStats.total} chuỗi (${newStats.pct}%)`;
    });
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function setupEventListeners() {
  // Tabs lọc
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderStrings();
    });
  });

  // Tìm kiếm
  const searchInput = document.getElementById('search-key');
  let searchTimer;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchQuery = e.target.value.trim();
      renderStrings();
    }, 200);
  });

  // Xuất JSON
  document.getElementById('btn-export-json').addEventListener('click', () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentDictionary, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute("href", dataStr);
    dlAnchor.setAttribute("download", `${currentLangCode}.json`);
    dlAnchor.click();
    showToast(`Đã xuất file ${currentLangCode}.json thành công!`);
  });

  // Lưu lên GitHub
  document.getElementById('btn-save-github').addEventListener('click', handleSaveToGitHub);

  // Modal thêm ngôn ngữ
  const modal = document.getElementById('modal-new-lang');
  document.getElementById('btn-add-lang').addEventListener('click', () => {
    modal.classList.add('open');
  });
  document.getElementById('modal-cancel').addEventListener('click', () => {
    modal.classList.remove('open');
  });
  document.getElementById('modal-confirm').addEventListener('click', () => {
    const code = document.getElementById('new-lang-code').value.trim().toLowerCase();
    const name = document.getElementById('new-lang-name').value.trim();
    if (!code || !name) {
      alert('Vui lòng nhập đầy đủ mã và tên ngôn ngữ!');
      return;
    }

    if (!manifest.languages.some(l => l.code === code)) {
      manifest.languages.push({
        code,
        name,
        translated: 0,
        total: manifest.totalKeys,
        progress: 0
      });
      renderLanguagesList();
    }

    currentDictionary = {
      _meta: { name, code }
    };

    modal.classList.remove('open');
    selectLanguage(code);
    showToast(`Đã tạo ngôn ngữ mới: ${name} (${code})!`);
  });
}

// Gọi Cloudflare Pages Function (/api/save-locale) để commit vào GitHub an toàn, bảo vệ PAT bí mật
async function handleSaveToGitHub() {
  const btn = document.getElementById('btn-save-github');
  btn.disabled = true;
  btn.textContent = 'Đang lưu…';

  try {
    const res = await fetch('/api/save-locale', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        lang: currentLangCode,
        data: currentDictionary
      })
    });

    const result = await res.json();

    if (!res.ok) {
      throw new Error(result.error || 'Lỗi khi gửi yêu cầu lưu bản dịch.');
    }

    showToast(result.message || `Đã lưu thành công [${currentLangCode}]!`, 'success');
  } catch (err) {
    console.error('Lỗi khi lưu:', err);
    showToast(err.message, 'error');
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '🚀 Lưu bản dịch';
  }
}
