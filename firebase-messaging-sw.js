// ไฟล์: firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-messaging.js');

// Config ของคุณ (ถูกต้องแล้ว)
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

// ส่วนที่แก้ไข: จัดการแจ้งเตือนเมื่ออยู่ Background (ปิดแอพ/ล็อคจอ)
messaging.onBackgroundMessage((payload) => {
  console.log('[Background] Message received:', payload);

  // ตรวจสอบว่ามีข้อมูล notification หรือไม่
  const notificationTitle = payload.notification?.title || 'แจ้งเตือนใหม่';
  const notificationOptions = {
    body: payload.notification?.body || 'มีข้อความใหม่เข้ามา',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png'
  };

  // บรรทัดนี้สำคัญมาก! ต้องสั่งให้แสดงผล
  return self.registration.showNotification(notificationTitle, notificationOptions);
});