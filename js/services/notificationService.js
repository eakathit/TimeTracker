// ไฟล์: public/js/services/notificationService.js
import { db, auth, messaging } from '../config/firebase-config.js';
import { showNotification } from '../utils/uiHelper.js';

const VAPID_KEY = "BE54Oa8UjJ0PUlUKsN879Qu27UdEyEMpq91Zd_VZeez403fM2xRAspp3XeUTl2iLSh90ip0uRXONGncKOIgw37s";

// 1. ตั้งค่าการรับแจ้งเตือนขณะเปิดแอป (Foreground)
export function initializeNotifications() {
    if (!messaging) return;

    messaging.onMessage((payload) => {
        console.log("ได้รับข้อความขณะเปิดแอป: ", payload);
        const title = payload.notification.title;
        const body = payload.notification.body;

        // แสดงแจ้งเตือนในเว็บ (Toast)
        showNotification(title + ": " + body, "info");

        // แสดงแจ้งเตือนของระบบ (OS Banner)
        if (Notification.permission === "granted") {
            new Notification(title, {
                body: body,
                icon: "/icons/icon-192.png",
            });
        }
    });
}

// 2. ฟังก์ชันขอ Token และอัปเดตลง Database
export async function saveFCMToken() {
    const user = auth.currentUser;
    if (!messaging || !user) return;

    try {
        if (Notification.permission === "granted") {
            const registration = await navigator.serviceWorker.ready;
            const token = await messaging.getToken({
                vapidKey: VAPID_KEY,
                serviceWorkerRegistration: registration,
            });

            if (token) {
                console.log("FCM Token Updated:", token);
                await db.collection("users").doc(user.uid).update({
                    fcmToken: token,
                    tokenUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                });
            }
        }
    } catch (error) {
        console.error("Error auto-saving token:", error);
    }
}

// 3. ฟังก์ชันผูกปุ่มเปิด-ปิด แจ้งเตือนในหน้า Profile
export function setupNotificationToggle(userData) {
    const notifyToggle = document.getElementById("notify-toggle");
    const notifyLabel = document.getElementById("notify-status-label");
    const user = auth.currentUser;

    if (!notifyToggle || !user) return;

    const isEnabled = userData.receiveNotifications !== false;

    // เช็คสิทธิ์และตั้งค่าปุ่ม
    if (Notification.permission === "denied") {
        notifyToggle.checked = false;
        notifyToggle.disabled = true;
        if (notifyLabel) {
            notifyLabel.textContent = "ถูกปิดกั้นที่เบราว์เซอร์";
            notifyLabel.classList.add("text-red-500");
        }
    } else if (Notification.permission === "default") {
        notifyToggle.checked = false;
        if (notifyLabel) notifyLabel.textContent = "แตะเพื่อเปิด";
    } else {
        notifyToggle.checked = isEnabled;
        if (notifyLabel) {
            notifyLabel.textContent = isEnabled ? "เปิดใช้งาน" : "ปิดชั่วคราว";
            if (isEnabled) notifyLabel.classList.add("text-green-600");
        }
    }

    // เคลียร์ Event เก่าออกก่อน
    const newToggle = notifyToggle.cloneNode(true);
    notifyToggle.parentNode.replaceChild(newToggle, notifyToggle);

    newToggle.addEventListener("change", async (e) => {
        const isChecked = e.target.checked;
        const label = document.getElementById("notify-status-label");

        if (isChecked) {
            if (label) label.textContent = "กำลังเปิด...";
            try {
                const permission = await Notification.requestPermission();
                if (permission === "granted") {
                    await saveFCMToken();
                    await db.collection("users").doc(user.uid).update({ receiveNotifications: true });
                    if (label) {
                        label.textContent = "เปิดใช้งาน";
                        label.classList.add("text-green-600");
                    }
                    showNotification("เปิดการแจ้งเตือนแล้ว", "success");
                } else {
                    e.target.checked = false;
                    if (label) label.textContent = "ถูกปฏิเสธ";
                    alert("กรุณากดอนุญาตการแจ้งเตือนที่ Browser Settings");
                }
            } catch (err) {
                console.error(err);
                e.target.checked = false;
                if (label) label.textContent = "เกิดข้อผิดพลาด";
            }
        } else {
            try {
                await db.collection("users").doc(user.uid).update({ receiveNotifications: false });
                if (label) {
                    label.textContent = "ปิดชั่วคราว";
                    label.classList.remove("text-green-600");
                }
                showNotification("ปิดการแจ้งเตือนแล้ว", "info");
            } catch (err) {
                console.error(err);
                e.target.checked = true;
                showNotification("บันทึกไม่สำเร็จ", "error");
            }
        }
    });
}

// 4. ผูกปุ่มขอแจ้งเตือนแบบแมนนวล (ถ้ามีปุ่ม enable-notify-btn ในหน้าเว็บ)
export function bindManualNotifyButton() {
    const notifyBtn = document.getElementById("enable-notify-btn");
    if (!notifyBtn) return;

    const checkNotificationStatus = () => {
        if (Notification.permission === "granted") {
            notifyBtn.classList.add("hidden");
        } else if (Notification.permission === "denied") {
            notifyBtn.classList.remove("hidden");
            notifyBtn.classList.replace("bg-indigo-500", "bg-gray-400");
            notifyBtn.disabled = true;
            notifyBtn.querySelector("span").textContent = "ถูกปิดกั้นการแจ้งเตือน";
        } else {
            notifyBtn.classList.remove("hidden");
        }
    };

    checkNotificationStatus();

    notifyBtn.addEventListener("click", async () => {
        try {
            const permission = await Notification.requestPermission();
            if (permission === "granted") {
                await saveFCMToken();
                checkNotificationStatus();
            }
        } catch (error) {
            console.error("Notify Error:", error);
            alert("เกิดข้อผิดพลาด: " + error.message);
        }
    });
}