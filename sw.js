self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // [เพิ่ม] ถ้า Request นี้กำลังยิงไปที่ Cloud Functions (มี cloudfunctions.net)
  // ให้ "return" (ปล่อยผ่านไปเลย) ห้าม Service Worker ยุ่ง
  if (url.hostname === '127.0.0.1' || url.hostname.endsWith('cloudfunctions.net')) {
    return;
  }

  // Request อื่นๆ (เช่น โหลดหน้าเว็บ, รูปภาพ) ก็ทำตามปกติ
  event.respondWith(fetch(event.request));
});