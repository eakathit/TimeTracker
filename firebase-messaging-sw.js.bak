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

  // ดึงหัวข้อและเนื้อหา (รองรับทั้งส่งจาก Console และ Cloud Functions)
  const title = payload.notification?.title || payload.data?.title || "TimeTracker Update";
  const body = payload.notification?.body || payload.data?.body || "คุณมีข้อความใหม่";

  const options = {
    body: body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { 
        url: payload.fcmOptions?.link || payload.data?.link || 'https://timetracker-f1e11.web.app' 
    },
    vibrate: [200, 100, 200],
    tag: 'timetracker-notification' 
  };

  // สำคัญ: ต้อง return showNotification เพื่อให้ Service Worker ทำงานจนจบ
  return self.registration.showNotification(title, options);
});

// จัดการการคลิกที่ Notification (คงเดิมไว้เพราะถูกต้องแล้ว)
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const targetUrl = event.notification.data?.url || 'https://timetracker-f1e11.web.app';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (var i = 0; i < windowClients.length; i++) {
        var client = windowClients[i];
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});