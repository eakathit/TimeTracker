const CACHE_NAME = "timetracker-v3.8"; // เปลี่ยนเวอร์ชั่นเมื่อมีการแก้โค้ด
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

  // 1. (เหมือนเดิม) ถ้าเป็น API/Firestore/Auth ให้โหลดสดเสมอ
  if (
      url.hostname.includes("firestore") || 
      url.hostname.includes("googleapis") || 
      url.hostname.includes("firebaseapp") || 
      url.pathname.includes("api") ||
      url.pathname.includes("/__/auth/")
  ) {
    return; 
  }

  // 2. (เพิ่มใหม่) ถ้าเป็นการเปิดหน้าเว็บ (HTML) ให้ใช้ Network First (โหลดสดก่อน ถ้าไม่ได้ค่อยเอา Cache)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          return caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, networkResponse.clone()); // อัปเดต Cache ด้วยของใหม่
            return networkResponse;
          });
        })
        .catch(() => {
          return caches.match(event.request); // ถ้าเน็ตหลุด ค่อยใช้ของเก่า
        })
    );
    return;
  }

  // 3. (เหมือนเดิม) ถ้าเป็นไฟล์ Static (รูป, css, js) ให้ใช้ Cache First
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
          // (Optional) บรรทัดนี้จะช่วย Cache ไฟล์ใหม่ๆ ที่ไม่อยู่ใน ASSETS_TO_CACHE อัตโนมัติ
          return caches.open(CACHE_NAME).then((cache) => {
             cache.put(event.request, networkResponse.clone());
             return networkResponse;
          });
      });
    })
  );
});