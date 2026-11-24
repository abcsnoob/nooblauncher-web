# Hướng dẫn Triển khai Cloudflare Pages cho Website Noob Launcher

Hệ thống website tĩnh hoàn chỉnh gồm:
1. **Landing Page**: `https://nooblauncher.pages.dev/`
2. **Trang Tải xuống**: `https://nooblauncher.pages.dev/download`
3. **Cổng Dịch thuật & Bản địa hoá**: `https://nooblauncher.pages.dev/i18n`
4. **Phục vụ tệp JSON**: `https://nooblauncher.pages.dev/locales/index.json` và `/locales/<lang>.json`

Toàn bộ mã nguồn website đã được tạo sẵn tại thư mục: [web](file:///d:/noob-launcher/web).

---

## 1. Cấu trúc thư mục `web/`

```
web/
├── functions/              # Cloudflare Pages Functions (Serverless Backend)
│   └── api/
│       └── save-locale.js  # API commit GitHub an toàn, chống spam & bảo mật PAT
├── public/                 # Thư mục gốc chứa toàn bộ Static Assets
│   ├── index.html          # Trang chủ Landing Page
│   ├── style.css           # Giao diện tổng thể
│   ├── download/
│   │   └── index.html      # Trang tải xuống Windows, macOS, Linux
│   ├── i18n/
│   │   ├── index.html      # Trang ứng dụng dịch thuật
│   │   ├── i18n.css        # Style giao diện dịch
│   │   └── app.js          # Engine dịch
│   └── locales/
│       ├── index.json      # Danh mục ngôn ngữ, tiến trình %
│       ├── vi.json         # Bản dịch Tiếng Việt gốc
│       └── en.json         # Bản dịch Tiếng Anh
└── DEPLOY_GUIDE.md
```

---

## 2. Các bước triển khai lên GitHub & Cloudflare Pages

### Bước 1: Đẩy thư mục `web` lên repo `abcsnoob/nooblauncher-web`

Bạn đưa toàn bộ nội dung trong thư mục `web/` lên repo GitHub `abcsnoob/nooblauncher-web`:

```bash
cd d:\noob-launcher\web
git init
git branch -M main
git remote add origin https://github.com/abcsnoob/nooblauncher-web.git
git add .
git commit -m "feat: website Noob Launcher & Cổng dịch i18n tự động với Cloudflare Pages Function"
git push -u origin main
```

---

### Bước 2: Cài đặt Build Settings trên Cloudflare Pages

1. Đăng nhập vào [Cloudflare Dashboard](https://dash.cloudflare.com/) > **Workers & Pages**.
2. Chọn **Create application** > Tab **Pages** > **Connect to Git** (Chọn repo `abcsnoob/nooblauncher-web`).
3. Trong phần **Build configuration**:
   - **Framework preset**: `None`
   - **Build command**: *(XOÁ TRẮNG HOÀN TOÀN, KHÔNG ĐỂ `npx wrangler deploy`)*
   - **Build output directory**: `public`
4. Bấm **Save and Deploy**.

---

### Bước 3: Cấu hình Secret Token an toàn (KHÔNG LỘ TOKEN RA CLIENT)

Để người dùng có thể bấm lưu và Serverless Function thay mặt đẩy code lên GitHub an toàn mà không để lộ PAT:

1. Trong dự án Cloudflare Pages vừa tạo, vào **Settings** > **Environment variables**.
2. Thêm biến bí mật (Secret):
   - **Variable name**: `GITHUB_TOKEN`
   - **Value**: Mã GitHub Personal Access Token (PAT) của bạn (chỉ cần quyền `contents:write` đối với repo `abcsnoob/nooblauncher-web`).
   - Chọn kiểu: **Secret / Encrypt**.
   - *(Tuỳ chọn)* `GITHUB_REPO`: `abcsnoob/nooblauncher-web` (mặc định đã cấu hình sẵn).
   - *(Tuỳ chọn)* `GITHUB_BRANCH`: `main`.
3. Bấm **Save**.

---

## 3. Cơ chế Bảo vệ Chống Spam & Độc hại (Anti-Spam & Security)

File `web/functions/api/save-locale.js` tự động chạy trên Cloudflare Edge với các lớp phòng thủ:
- 🛡️ **Bảo vệ Secret:** `GITHUB_TOKEN` được bảo mật 100% trong Cloudflare Pages Environment, người dùng truy cập web không thể thấy token.
- ⏱️ **Rate Limiting & Cooldown:** Giới hạn mỗi IP tối đa 6 lần submit/phút và phải cách nhau tối thiểu 8 giây giữa mỗi lần lưu.
- 🔍 **Lọc & Làm sạch dữ liệu (Sanitize):** Chỉ cho phép các ký tự key hợp lệ, tự động cắt ngắn chuỗi nếu cố tình nhồi nhét quá 2000 ký tự để chống tràn bộ nhớ / DoS.
- 🚫 **Regex Validation:** Chỉ nhận mã ngôn ngữ chuẩn (2-10 ký tự: `vi`, `en`, `zh-CN`, `ja`, `pt-BR`...), từ chối các mã bất thường hoặc path traversal.


---

## 3. Cách cộng đồng dịch & đồng bộ về Launcher

1. **Người dùng / Dịch giả:**
   - Truy cập `https://nooblauncher.pages.dev/i18n`.
   - Chọn ngôn ngữ có sẵn hoặc bấm **+ Thêm** ngôn ngữ mới (bất kỳ ngôn ngữ nào).
   - Nhập bản dịch vào ô tương ứng. Hệ thống sẽ cảnh báo nếu thiếu các biến dạng `{name}`, `{m}`.
   - Nhập **GitHub Personal Access Token (PAT)** (chỉ cần quyền `contents:write` hoặc `repo`) ở cột bên trái.
   - Bấm **🚀 Lưu lên GitHub**: Website sẽ trực tiếp gọi REST API commit file `locales/<lang>.json` và cập nhật `locales/index.json`.
   - Cloudflare Pages sẽ tự động nhận commit và deploy bản mới nhất sau vài giây.

2. **Noob Launcher (Phía người chơi):**
   - Mở mục **Cài đặt** trong Launcher.
   - Dropdown ngôn ngữ hiển thị: **Tên ngôn ngữ | Tiến trình (%) | URL Path [Dịch trên Web ↗]**.
   - Bấm link **Dịch ↗** sẽ mở thẳng URL `https://nooblauncher.pages.dev/i18n?lang=<code>` trên trình duyệt.
   - Khi người chơi chọn một ngôn ngữ mới chưa có sẵn trong app, Launcher sẽ tự động fetch file từ `https://nooblauncher.pages.dev/locales/<lang>.json`, lưu vào thư mục `userData/locales/` và kích hoạt ngay mà không cần cài lại app!
