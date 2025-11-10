self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // [ ★ แก้ไข ★ ]
  // เราต้องอนุญาตให้ Request ที่ยิงไปหา Firebase (ทั้ง Functions และ Storage)
  // "ทะลุ" Service Worker ไปเลย ห้ามยุ่ง
  if (url.hostname.endsWith('cloudfunctions.net') || url.hostname.endsWith('firebasestorage.googleapis.com')) {
    return; // ปล่อยผ่าน (Bypass)
  }

  // Request อื่นๆ (เช่น โหลดหน้าเว็บ, รูปภาพ) ก็ทำตามปกติ
  event.respondWith(fetch(event.request));
});