// firebase-messaging-sw.js

importScripts('https://www.gstatic.com/firebasejs/12.3.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.3.0/firebase-messaging-compat.js');

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

// จัดการ Notification เมื่อแอปอยู่ Background
messaging.onBackgroundMessage((payload) => {
  console.log('Received background message ', payload);

  // ถ้าใน payload มี notification มาแล้ว เบราว์เซอร์จะจัดการเอง 
  // เราจะเขียน code ส่วนนี้เผื่อไว้กรณีที่ notification ไม่แสดงอัตโนมัติเท่านั้น
  if (payload.notification) {
      return; 
  }

  const title = payload.data?.title || "TimeTracker Update";
  const options = {
    body: payload.data?.body || "คุณมีข้อความใหม่",
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { 
        // ตรวจสอบทั้ง fcmOptions.link (จาก webpush) และ data.link
        url: payload.fcmOptions?.link || payload.data?.link || 'https://timetracker-f1e11.web.app' 
    },
    vibrate: [200, 100, 200],
    tag: 'checkout-reminder' // ใช้ tag เพื่อให้แจ้งเตือนใหม่ทับอันเก่า ไม่ขึ้นรกเต็มหน้าจอ
  };

  return self.registration.showNotification(title, options);
});

// จัดการการคลิกที่ Notification
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  
  // ดึง URL จาก data ที่เราแนบไว้
  const targetUrl = event.notification.data?.url || 'https://timetracker-f1e11.web.app';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // 1. ถ้าเปิดหน้าเว็บค้างไว้อยู่แล้ว ให้ Focus ไปที่หน้านั้น
      for (var i = 0; i < windowClients.length; i++) {
        var client = windowClients[i];
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      // 2. ถ้ายังไม่ได้เปิดหน้าเว็บ ให้เปิดหน้าใหม่
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});