// sw.js (Minimal Service Worker)
// ไฟล์นี้มีไว้เพื่อให้เบราว์เซอร์รู้จักแอปนี้ว่าเป็น PWA ที่ "ติดตั้งได้" เท่านั้น
// มันจะไม่ทำอะไรเลย และจะไม่เก็บ Cache ใดๆ ทั้งสิ้น (แอปจะยังออนไลน์ 100%)

self.addEventListener('fetch', (event) => {
  // ไม่ทำอะไรเป็นพิเศษ, แค่ส่ง request ไปยัง network ตามปกติ
  event.respondWith(fetch(event.request));
});