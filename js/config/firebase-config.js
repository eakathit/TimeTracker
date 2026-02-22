const firebaseConfig = {
    apiKey: "AIzaSyA1fdFsyaFlEEJKCpSU50bm78SeTrj9Ngc",
    authDomain: "timetracker-f1e11.web.app",
    projectId: "timetracker-f1e11",
    storageBucket: "timetracker-f1e11.firebasestorage.app",
    messagingSenderId: "470557940763",
    appId: "1:470557940763:web:6de43b02b5ba42fe46acbe",
    measurementId: "G-C83H28RLSY"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

export const auth = firebase.auth();
export const db = firebase.firestore();
export const cloudFunctions = firebase.app().functions('asia-southeast1');
export const storage = firebase.storage();

// เช็คว่าถ้าเปิดเว็บผ่าน localhost (กำลังเทสใน Emulator) ให้สลับไปชี้ที่พอร์ตจำลอง
if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    console.log("🛠️ เชื่อมต่อเข้ากับ Firebase Emulator...");
    
    // ตั้งค่าพอร์ตมาตรฐานของ Emulator (ถ้าคุณไม่ได้เปลี่ยนพอร์ตใน firebase.json)
    auth.useEmulator("http://localhost:9099");
    db.useEmulator("localhost", 8080);
    cloudFunctions.useEmulator("localhost", 5001);
    // storage.useEmulator("localhost", 9199); // เอาคอมเมนต์ออกถ้ามีการใช้ Storage Emulator
}

export let messaging = null;
try {
    messaging = firebase.messaging();
} catch (e) {
    console.log("Messaging failed (อาจไม่ใช่ HTTPS หรือ Browser ไม่รองรับ)");
}