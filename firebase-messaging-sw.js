// firebase-messaging-sw.js

// 1. นำเข้าสคริปต์
importScripts('https://www.gstatic.com/firebasejs/12.3.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.3.0/firebase-messaging-compat.js');

// 2. ใช้ Config ชุดเดียวกับหน้าเว็บ
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

// 3. จัดการ Notification เมื่อแอปอยู่ Background
messaging.onBackgroundMessage((payload) => {
  console.log('Received background message ', payload);
  
  // ตรวจสอบว่า payload มีข้อมูล notification มาไหม
  const title = payload.notification?.title || "TimeTracker Update";
  const options = {
    body: payload.notification?.body || "คุณมีข้อความใหม่",
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png', // ไอคอนเล็กๆ บนแถบสถานะ (Android)
    data: { 
        url: payload.data?.link || 'https://timetracker-f1e11.web.app' 
    },
    vibrate: [200, 100, 200] // สั่นเครื่องสำหรับมือถือ
  };

  return self.registration.showNotification(title, options);
});

// 4. จัดการการคลิกที่ Notification
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  
  // ตรวจสอบว่าหน้าเว็บเปิดอยู่แล้วหรือไม่ ถ้าเปิดอยู่ให้ Focus ถ้าไม่ให้เปิดใหม่
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (var i = 0; i < windowClients.length; i++) {
        var client = windowClients[i];
        if (client.url === event.notification.data.url && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(event.notification.data.url);
      }
    })
  );
});