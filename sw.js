const CACHE_NAME = "timetracker-v1.7"; // เปลี่ยนเวอร์ชั่นเมื่อมีการแก้โค้ด
const ASSETS_TO_CACHE = [
  "/",
  "/index.html",
  "/style.css",
  "/manifest.json",
  "/firebase-config.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  // Fonts
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Prompt:wght@400;500;600&display=swap",
  // Libraries (เฉพาะที่จำเป็นต้องโหลดตอนเริ่ม)
  "https://www.gstatic.com/firebasejs/12.3.0/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore-compat.js",
  "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth-compat.js",
  // (อย่าเพิ่ง Cache xlsx หรือ qr code ที่นี่ ถ้าเราจะทำ Lazy Load ในข้อ 2)
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    clients.claim().then(() => {
      // ลบ Cache เก่า
      return caches.keys().then((keys) => {
        return Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME) return caches.delete(key);
          })
        );
      });
    })
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // 1. ถ้าเป็น Firestore/API หรือ Auth ให้โหลดสดเสมอ (Network Only)
  if (
      url.hostname.includes("firestore") || 
      url.hostname.includes("googleapis") || 
      url.hostname.includes("firebaseapp") || // เพิ่ม: ดัก domain หลักของ Firebase
      url.pathname.includes("api") ||
      url.pathname.includes("/__/auth/")      // เพิ่ม: ดัก path ของระบบ Login (สำคัญมาก)
  ) {
    return; // ปล่อยให้ Browser จัดการ (ปกติจะเป็น Network First)
  }

  // 2. ถ้าเป็นไฟล์ Static ให้ใช้ Cache First (ถ้ามีในเครื่องใช้เลย ถ้าไม่มีค่อยโหลด)
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request);
    })
  );
});