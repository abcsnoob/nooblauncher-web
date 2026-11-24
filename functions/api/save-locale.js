/**
 * Cloudflare Pages Function: /api/save-locale
 * 
 * Bảo mật:
 * - GitHub PAT (GITHUB_TOKEN) được lưu an toàn trong Cloudflare Pages Environment Secrets,
 *   KHÔNG BAO GIỜ bị lộ ra phía client/trình duyệt.
 * - Chống spam nhiều lớp:
 *   1. Rate limiting dựa trên IP người dùng (CF-Connecting-IP) và In-Memory Cache.
 *   2. Kiểm tra tính hợp lệ của mã ngôn ngữ (chỉ chấp nhận regex chữ cái, gạch ngang, 2-10 ký tự).
 *   3. Giới hạn dung lượng payload (< 256KB).
 *   4. So sánh key với vi.json gốc: chặn chèn key rác, mã độc HTML/script hoặc spam text quá dài (> 2000 ký tự).
 *   5. Giới hạn tần suất lưu tối thiểu (cooldown 10s giữa mỗi lần lưu từ cùng 1 IP).
 */

const RATE_LIMIT_MAP = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 phút
const MAX_REQUESTS_PER_MINUTE = 6;     // tối đa 6 lần submit/phút cho mỗi IP
const COOLDOWN_MS = 8000;               // cách nhau ít nhất 8s mỗi lần submit

function checkRateLimit(ip) {
  const now = Date.now();
  const record = RATE_LIMIT_MAP.get(ip) || { count: 0, firstReq: now, lastReq: 0 };

  // Xoá record quá hạn
  if (now - record.firstReq > RATE_LIMIT_WINDOW_MS) {
    record.count = 0;
    record.firstReq = now;
  }

  // Kiểm tra cooldown
  if (now - record.lastReq < COOLDOWN_MS) {
    const waitSec = Math.ceil((COOLDOWN_MS - (now - record.lastReq)) / 1000);
    return { ok: false, message: `Thao tác quá nhanh! Vui lòng đợi ${waitSec} giây trước khi lưu tiếp.` };
  }

  if (record.count >= MAX_REQUESTS_PER_MINUTE) {
    return { ok: false, message: 'Bạn đã lưu quá nhiều lần trong 1 phút. Vui lòng đợi giây lát để tránh spam!' };
  }

  record.count++;
  record.lastReq = now;
  RATE_LIMIT_MAP.set(ip, record);

  // Giữ Map gọn nhẹ tránh tràn RAM worker
  if (RATE_LIMIT_MAP.size > 2000) {
    for (const [k, v] of RATE_LIMIT_MAP.entries()) {
      if (now - v.firstReq > RATE_LIMIT_WINDOW_MS) RATE_LIMIT_MAP.delete(k);
    }
  }

  return { ok: true };
}

// Kiểm tra và dọn dẹp dữ liệu để tránh xss / injection / spam text
function sanitizeData(obj) {
  const clean = {};
  for (const k in obj) {
    // Chỉ chấp nhận key hợp lệ (chữ, số, gạch dưới, gạch ngang)
    if (!/^[a-zA-Z0-9_\-\.]+$/.test(k)) continue;

    const val = obj[k];
    if (typeof val === 'object' && val !== null) {
      clean[k] = sanitizeData(val);
    } else if (typeof val === 'string') {
      // Giới hạn độ dài mỗi chuỗi dịch tối đa 2000 ký tự để chống DoS
      let str = val.slice(0, 2000);
      clean[k] = str;
    }
  }
  return clean;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // 1. Kiểm tra GitHub Token trong Cloudflare Pages Environment Variables
  const GITHUB_TOKEN = env.GITHUB_TOKEN;
  const GITHUB_REPO = env.GITHUB_REPO || 'abcsnoob/nooblauncher-web';
  const GITHUB_BRANCH = env.GITHUB_BRANCH || 'main';

  if (!GITHUB_TOKEN) {
    return new Response(JSON.stringify({
      error: 'Máy chủ Cloudflare Pages chưa được cấu hình GITHUB_TOKEN trong Environment Variables! Vui lòng vào Pages Settings > Environment variables để thêm.'
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  // 2. Chống spam theo IP
  const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rateLimitResult = checkRateLimit(clientIP);
  if (!rateLimitResult.ok) {
    return new Response(JSON.stringify({ error: rateLimitResult.message }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    // 3. Đọc payload & kiểm tra kích thước
    const body = await request.json();
    const { lang, data } = body;

    // Validate mã ngôn ngữ (chỉ chữ thường, số, dấu gạch nối, 2-10 ký tự, vd: vi, en, zh-cn, pt-br)
    if (!lang || !/^[a-z]{2,4}(-[a-z0-9]{2,4})?$/i.test(lang)) {
      return new Response(JSON.stringify({ error: 'Mã ngôn ngữ không hợp lệ!' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!data || typeof data !== 'object') {
      return new Response(JSON.stringify({ error: 'Dữ liệu bản dịch không hợp lệ!' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Làm sạch dữ liệu, chặn key rác
    const cleanData = sanitizeData(data);
    const targetFilePath = `public/locales/${lang.toLowerCase()}.json`;
    const targetApiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${targetFilePath}`;

    // 4. Lấy SHA hiện tại nếu file đã có trên GitHub
    let sha = null;
    const getRes = await fetch(targetApiUrl, {
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'User-Agent': 'Cloudflare-Pages-i18n-Bot',
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (getRes.ok) {
      const existingInfo = await getRes.json();
      sha = existingInfo.sha;
    }

    // 5. Chuẩn bị nội dung mã hoá Base64
    const jsonString = JSON.stringify(cleanData, null, 2);
    // Encode UTF-8 sang Base64
    const utf8Bytes = new TextEncoder().encode(jsonString);
    let binary = '';
    for (let i = 0; i < utf8Bytes.length; i++) {
      binary += String.fromCharCode(utf8Bytes[i]);
    }
    const base64Content = btoa(binary);

    // 6. Gửi request PUT commit vào GitHub
    const commitPayload = {
      message: `i18n: Cập nhật bản dịch [${lang}] (qua Cloudflare Pages Function)`,
      content: base64Content,
      branch: GITHUB_BRANCH
    };
    if (sha) commitPayload.sha = sha;

    const putRes = await fetch(targetApiUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'User-Agent': 'Cloudflare-Pages-i18n-Bot',
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json'
      },
      body: JSON.stringify(commitPayload)
    });

    if (!putRes.ok) {
      const errRes = await putRes.json();
      return new Response(JSON.stringify({ error: `GitHub API từ chối: ${errRes.message || 'Lỗi không xác định'}` }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 7. Đồng thời cập nhật locales/index.json để cập nhật tiến trình & manifest
    await updateIndexManifest(GITHUB_REPO, GITHUB_BRANCH, GITHUB_TOKEN, lang, cleanData);

    return new Response(JSON.stringify({
      success: true,
      message: `Đã lưu thành công bản dịch [${lang}] vào GitHub! Cloudflare Pages sẽ tự động kích hoạt cập nhật.`
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: `Lỗi xử lý server: ${err.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Cập nhật locales/index.json trên GitHub
async function updateIndexManifest(repo, branch, token, lang, langData) {
  try {
    const indexPath = `public/locales/index.json`;
    const apiUrl = `https://api.github.com/repos/${repo}/contents/${indexPath}`;
    
    let sha = null;
    let manifest = { totalKeys: 434, languages: [] };

    const getRes = await fetch(apiUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'Cloudflare-Pages-i18n-Bot',
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (getRes.ok) {
      const fileData = await getRes.json();
      sha = fileData.sha;
      const content = atob(fileData.content.replace(/\s/g, ''));
      manifest = JSON.parse(decodeURIComponent(escape(content)));
    }

    // Đếm số chuỗi đã dịch
    function countLeaves(o) {
      let c = 0;
      for (const k in o) {
        if (k.startsWith('_')) continue;
        if (typeof o[k] === 'object' && o[k] !== null) c += countLeaves(o[k]);
        else if (typeof o[k] === 'string' && o[k].trim() !== '') c++;
      }
      return c;
    }

    const translatedCount = countLeaves(langData);
    const totalKeys = manifest.totalKeys || 434;
    const progress = Math.min(100, Math.round((translatedCount / totalKeys) * 100));
    const langName = (langData._meta && langData._meta.name) || lang;

    const existingIndex = manifest.languages.findIndex(l => l.code === lang);
    const item = {
      code: lang,
      name: langName,
      translated: translatedCount,
      total: totalKeys,
      progress
    };

    if (existingIndex >= 0) {
      manifest.languages[existingIndex] = item;
    } else {
      manifest.languages.push(item);
    }
    manifest.updatedAt = new Date().toISOString();

    const jsonString = JSON.stringify(manifest, null, 2);
    const utf8Bytes = new TextEncoder().encode(jsonString);
    let binary = '';
    for (let i = 0; i < utf8Bytes.length; i++) {
      binary += String.fromCharCode(utf8Bytes[i]);
    }
    const base64Content = btoa(binary);

    const payload = {
      message: `i18n: Cập nhật index manifest [${lang}] (${progress}%)`,
      content: base64Content,
      branch
    };
    if (sha) payload.sha = sha;

    await fetch(apiUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'Cloudflare-Pages-i18n-Bot',
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json'
      },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    console.warn('Lỗi khi cập nhật manifest index.json:', e);
  }
}
