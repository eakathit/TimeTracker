import { showNotification } from '../utils/uiHelper.js';
// ตำเเหน่งโรงงานค่าคงที่
export const FACTORY_LOCATION = { latitude: 13.625, longitude: 101.025 };
export const ALLOWED_RADIUS_METERS = 150;
export const MAX_ACCEPTABLE_ACCURACY = 180;

// ตัวแปรสถานะ
export let latestPosition = null;
export let watchId = null;

// 🌟 ทริคจาก Senior: ใน ES Modules ตัวแปรที่ export ออกไปจะเป็น Read-only
// เราจึงต้องสร้าง Setter ฟังก์ชันไว้ให้ app.js เรียกใช้เพื่อเปลี่ยนค่าตอนรันเทสครับ
export function setMockPosition(pos) {
    latestPosition = pos;
}
// ฟังก์ชันคำนวณระยะทาง
export function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = (lat1 * Math.PI) / 180, φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// ฟังก์ชันเปิด/ปิด gps
export function startWatchingPosition() {
    const locationStatusDiv = document.getElementById("location-status");
    if (!navigator.geolocation) {
        showNotification("อุปกรณ์ของคุณไม่รองรับ GPS", "error");
        return;
    }

    const runGeoWatcher = () => {
        if (locationStatusDiv) locationStatusDiv.onclick = null;
        if (watchId !== null) navigator.geolocation.clearWatch(watchId);

        watchId = navigator.geolocation.watchPosition(
            (position) => {
                localStorage.setItem("user_granted_gps", "true");
                updateRealtimeLocationStatus(position);
            },
            (error) => {
                if (error.code === 1) localStorage.removeItem("user_granted_gps");
                handleLocationError(error);
            },
            { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
        );
    };

    const showEnableGpsButton = () => {
        if (locationStatusDiv) {
            locationStatusDiv.className = "flex items-center p-3 rounded-xl bg-blue-100 text-blue-700 cursor-pointer hover:bg-blue-200 transition-all shadow-sm border border-blue-200";
            locationStatusDiv.innerHTML = `
                <div class="flex items-center justify-center w-full gap-2">
                    <span class="relative flex h-3 w-3"><span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span><span class="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span></span>
                    <span class="font-bold">แตะเพื่อเปิดใช้งาน GPS</span>
                </div>`;
            locationStatusDiv.onclick = function () {
                this.className = "flex items-center p-3 rounded-xl bg-yellow-100 text-yellow-700";
                this.innerHTML = `<div class="flex items-center gap-3"><div class="animate-spin rounded-full h-5 w-5 border-b-2 border-yellow-700"></div><span class="font-medium text-sm">กำลังขอสัญญาณ GPS...</span></div>`;
                runGeoWatcher();
            };
        }
    };

    if (localStorage.getItem("user_granted_gps") === "true") {
        if (locationStatusDiv) {
            locationStatusDiv.className = "flex items-center p-3 rounded-xl bg-yellow-100 text-yellow-700";
            locationStatusDiv.innerHTML = `<div class="flex items-center gap-3"><div class="animate-spin rounded-full h-5 w-5 border-b-2 border-yellow-700"></div><span class="font-medium text-sm">กำลังค้นหาตำแหน่ง...</span></div>`;
        }
        runGeoWatcher();
    } else {
        if (navigator.permissions && navigator.permissions.query) {
            navigator.permissions.query({ name: "geolocation" }).then(result => {
                if (result.state === "granted") runGeoWatcher();
                else showEnableGpsButton();
            }).catch(() => showEnableGpsButton());
        } else {
            showEnableGpsButton();
        }
    }
}

export function stopWatchingPosition() {
    if (navigator.geolocation && watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
}

function updateRealtimeLocationStatus(position) {
    const locationStatusDiv = document.getElementById("location-status");
    const checkInBtn = document.getElementById("checkin-btn");
    if (!locationStatusDiv) return;

    if (position.coords.accuracy > MAX_ACCEPTABLE_ACCURACY) {
        locationStatusDiv.className = "flex items-center p-3 rounded-xl bg-yellow-100 text-yellow-700 transition-all duration-300";
        locationStatusDiv.innerHTML = `<div class="flex items-center gap-2"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg><span class="text-sm">Adjusting GPS... (${position.coords.accuracy.toFixed(0)} m)</span></div>`;
        latestPosition = null;
        if (checkInBtn) checkInBtn.disabled = true;
        return;
    }

    latestPosition = position;
    const distance = calculateDistance(position.coords.latitude, position.coords.longitude, FACTORY_LOCATION.latitude, FACTORY_LOCATION.longitude);

    if (distance <= ALLOWED_RADIUS_METERS) {
        locationStatusDiv.className = "flex items-center p-3 rounded-xl bg-green-100 text-green-700 border border-green-200 transition-all duration-300";
        locationStatusDiv.innerHTML = `<div class="flex items-center gap-2"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg><div><p class="font-bold text-sm">In Factory Area (Accuracy: ${position.coords.accuracy.toFixed(0)} m)</p></div></div>`;
        if (checkInBtn) checkInBtn.disabled = false;
    } else {
        locationStatusDiv.className = "flex items-center p-3 rounded-xl bg-red-50 text-red-600 border border-red-100 transition-all duration-300";
        locationStatusDiv.innerHTML = `<div class="flex items-center gap-2"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg><div><p class="font-bold text-sm">Out of Area (${distance.toFixed(0)} m away)</p></div></div>`;
        if (checkInBtn) checkInBtn.disabled = false;
    }
}

function handleLocationError(error) {
    const locationStatusDiv = document.getElementById("location-status");
    const locationText = document.getElementById("location-text");
    if (locationStatusDiv) {
        locationStatusDiv.className = "flex items-center p-3 rounded-xl bg-red-50 text-red-700 border border-red-200";
        // แก้ไขปุ่มกดลองใหม่ให้เรียกใช้ฟังชันได้อย่างปลอดภัย
        locationStatusDiv.innerHTML = `<div class="flex flex-col w-full text-center"><span class="font-bold mb-1">ไม่พบตำแหน่ง</span><span id="retry-gps-btn" class="text-xs underline cursor-pointer">แตะเพื่อลองใหม่</span></div>`;
        setTimeout(() => {
            const retryBtn = document.getElementById('retry-gps-btn');
            if (retryBtn) retryBtn.onclick = startWatchingPosition;
        }, 50);
    }
    console.warn(`GPS Error (${error.code}): ${error.message}`);
    if (error.code === 1) {
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        if (isIOS) alert("⚠️ ไม่สามารถเข้าถึง GPS ได้\\n\\nระบบ iOS บล็อกตำแหน่งไว้:\\n1. ไปที่ Settings > Privacy > Location Services\\n2. หาเว็บนี้ (หรือ Safari) แล้วเปิดเป็น 'While Using'\\n3. กลับมาที่นี่แล้วกดรีเฟรช");
        else alert("⚠️ ไม่สามารถเข้าถึง GPS ได้\\n\\nกรุณากดที่รูป 🔒 บนช่อง URL แล้วกด 'Reset permission' เพื่ออนุญาตใหม่");
    } else if (error.code === 2) {
        if (locationText) locationText.textContent = "สัญญาณ GPS ไม่ดี (ลองออกไปที่โล่ง)";
    } else if (error.code === 3) {
        if (locationText) locationText.textContent = "หมดเวลาเชื่อมต่อ (Timeout)";
    }
}