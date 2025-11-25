self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. รายชื่อ Domain ของ Firebase ที่ห้าม Service Worker ไปยุ่งเด็ดขาด
  // (รวม Firestore, Auth, Storage, Cloud Functions)
  if (
    url.hostname.includes('googleapis.com') || 
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('cloudfunctions.net') ||
    url.hostname === '127.0.0.1'
  ) {
    return; // ปล่อยผ่านไปเลย ให้ Browser จัดการเอง (สำคัญมาก!)
  }

  // 2. อนุญาตให้ Cache เฉพาะไฟล์ที่อยู่ใน Origin เดียวกัน (เช่น index.html, style.css)
  if (url.origin === location.origin) {
     event.respondWith(fetch(event.request));
     return;
  }

  // 3. กรณีอื่นๆ ที่เหลือ ให้ปล่อยผ่านเช่นกัน
  return;
});