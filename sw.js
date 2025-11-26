// 1. [เพิ่มใหม่] สั่งให้ข้ามการรอ (Skip Waiting) ติดตั้งปุ๊บ ใช้ปั๊บ
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// 2. [เพิ่มใหม่] สั่งให้ยึดครองหน้าเว็บทันที (Clients Claim) ไม่ต้องรอรีเฟรช
self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// --- ส่วนเดิมของคุณ (คงไว้เหมือนเดิม) ---
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // กฎการกรอง Cloud Functions (หรืออื่นๆ) ของคุณ
  if (url.hostname === '127.0.0.1' || url.hostname.endsWith('cloudfunctions.net')) {
    return;
  }

  // สั่งโหลดสดจากเน็ต
  event.respondWith(fetch(event.request));
});