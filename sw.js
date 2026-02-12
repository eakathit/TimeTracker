importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// Config เดียวกับใน firebase-config.js (ต้องใส่ตรงนี้ด้วยเพราะ SW เข้าถึงตัวแปรข้างนอกไม่ได้)
const firebaseConfig = {
    apiKey: "AIzaSyA1fdFsyaFlEEJKCpSU50bm78SeTrj9Ngc",
    authDomain: "timetracker-f1e11.web.app",
    projectId: "timetracker-f1e11",
    storageBucket: "timetracker-f1e11.firebasestorage.app",
    messagingSenderId: "470557940763",
    appId: "1:470557940763:web:6de43b02b5ba42fe46acbe",
    measurementId: "G-C83H28RLSY"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// จัดการ Background Message
messaging.onBackgroundMessage((payload) => {
  console.log('Received background message ', payload);
  
  if (payload.notification) {
    return; 
  }

  const title = payload.data?.title || "TimeTracker Update";
  const options = {
    body: payload.data?.body || "คุณมีข้อความใหม่",
    icon: '/icons/icon-192.png',
    data: { url: payload.data?.link || '/' } // รองรับการคลิกแล้วเปิดลิงก์
  };

  self.registration.showNotification(title, options);
});

// รองรับการคลิก Notification (สำคัญมากสำหรับ iOS/Android)
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const urlToOpen = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // ถ้าเปิดหน้าเว็บค้างไว้แล้ว ให้ Focus ที่หน้านั้น
      for (let client of windowClients) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      // ถ้ายังไม่เปิด ให้เปิดหน้าใหม่
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

const CACHE_NAME = "timetracker-v26.0-fix-ot"; // เปลี่ยนเวอร์ชั่นเมื่อมีการแก้โค้ด
const ASSETS_TO_CACHE = [
  "/",
  "/index.html",
  "/style.css",
  "/manifest.json",
  "/firebase-config.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Prompt:wght@400;500;600&display=swap",
  "https://www.gstatic.com/firebasejs/12.3.0/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore-compat.js",
  "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth-compat.js",
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
  // แก้ไขจุดนี้: ป้องกัน Error สำหรับ request ที่ไม่ใช่ GET (เช่น POST สำหรับ Login หรือส่งข้อมูล)
  if (event.request.method !== 'GET') {
    return; // ปล่อยให้เบราว์เซอร์ส่งข้อมูลผ่านเน็ตปกติ ไม่ต้องยุ่งกับ Cache
  }

  const url = new URL(event.request.url);

  // 1. ถ้าเป็น API/Firestore/Auth ให้โหลดสดเสมอ
  if (
      url.hostname.includes("firestore") || 
      url.hostname.includes("googleapis") || 
      url.hostname.includes("firebaseapp") || 
      url.pathname.includes("api") ||
      url.pathname.includes("/__/auth/")
  ) {
    return; 
  }

  // 2. ถ้าเป็นการเปิดหน้าเว็บ (HTML) ให้ใช้ Network First
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          return caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
        })
        .catch(() => {
          return caches.match(event.request);
        })
    );
    return;
  }

  // 3. ถ้าเป็นไฟล์ Static (รูป, css, js) ให้ใช้ Cache First
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
          // ตรวจสอบความถูกต้องของ response ก่อนใส่ลงใน Cache
          if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
            return networkResponse;
          }
          return caches.open(CACHE_NAME).then((cache) => {
             cache.put(event.request, networkResponse.clone());
             return networkResponse;
          });
      });
    })
  );
});