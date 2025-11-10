self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // [ ★ แก้ไข ★ ]
  // เราต้องอนุญาตให้ Request ที่ยิงไปหา Firebase (ทั้ง Functions, Storage และ Auth)
  // "ทะลุ" Service Worker ไปเลย ห้ามยุ่ง
  const domain = url.hostname;
  
  if (
    domain.endsWith('cloudfunctions.net') ||
    domain.endsWith('firebasestorage.googleapis.com') ||
    domain.endsWith('timetracker-f1e11.web.app') || // [!!!] เพิ่มบรรทัดนี้
    domain.endsWith('accounts.google.com')          // [!!!] เพิ่มบรรทัดนี้
  ) {
    return; // ปล่อยผ่าน (Bypass)
  }

  // Request อื่นๆ (เช่น โหลดหน้าเว็บ, รูปภาพ) ก็ทำตามปกติ
  event.respondWith(fetch(event.request));
});