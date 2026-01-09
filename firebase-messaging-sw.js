// ใช้เวอร์ชั่น 12.3.0 (Compat) ให้ตรงกับหน้าเว็บ
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

// ประกาศ messaging ใน Background
const messaging = firebase.messaging();

// (Optional) จัดการเมือได้รับแจ้งเตือนตอนปิดหน้าเว็บ
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/icons/icon-192.png' // เช็คว่ามีไฟล์ไอคอนนี้จริงไหม
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});