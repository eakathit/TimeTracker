// ไฟล์: public/js/services/attendanceService.js
import { db, auth, cloudFunctions } from '../config/firebase-config.js';
import { showNotification, showConfirmDialog } from '../utils/uiHelper.js';
import { FACTORY_LOCATION, ALLOWED_RADIUS_METERS, latestPosition, calculateDistance } from './locationService.js';
import { toLocalDateKey, calculateWorkHours } from '../utils/dateHelper.js';

// --- UI State Helpers (อัปเดตปุ่มหน้าแรก) ---
export function updateUIToCheckIn() {
    const checkinBtn = document.getElementById("checkin-btn");
    const checkoutBtn = document.getElementById("checkout-btn");
    const requestOtBtn = document.getElementById("request-ot-btn");
    if (checkinBtn) checkinBtn.classList.remove("hidden");
    if (checkoutBtn) {
        checkoutBtn.classList.add("hidden");
        checkoutBtn.disabled = false;
        checkoutBtn.classList.add("checkout-btn-anim", "bg-red-500", "hover:bg-red-600");
        checkoutBtn.classList.remove("bg-green-500", "completed-btn-anim");
        checkoutBtn.innerHTML = '<svg class="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg><span class="text-2xl font-semibold mt-2">Check Out</span>';
    }
    if (requestOtBtn) requestOtBtn.classList.add("hidden");
}

export function updateUIToCheckedIn() {
    const checkinBtn = document.getElementById("checkin-btn");
    const checkoutBtn = document.getElementById("checkout-btn");
    if (checkinBtn) checkinBtn.classList.add("hidden");
    if (checkoutBtn) {
        checkoutBtn.classList.remove("hidden");
        checkoutBtn.disabled = false;
        checkoutBtn.classList.add("checkout-btn-anim", "bg-red-500", "hover:bg-red-600");
        checkoutBtn.classList.remove("bg-green-500", "completed-btn-anim");
        checkoutBtn.innerHTML = '<svg class="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg><span class="text-2xl font-semibold mt-2">Check Out</span>';
    }
}

export function updateUIToCompleted() {
    const checkinBtn = document.getElementById("checkin-btn");
    const checkoutBtn = document.getElementById("checkout-btn");
    const requestOtBtn = document.getElementById("request-ot-btn");
    if (checkinBtn) checkinBtn.classList.add("hidden");
    if (checkoutBtn) {
        checkoutBtn.classList.remove("hidden");
        checkoutBtn.disabled = true;
        checkoutBtn.classList.remove("checkout-btn-anim", "bg-red-500", "hover:bg-red-600");
        checkoutBtn.classList.add("bg-green-500", "completed-btn-anim");
        checkoutBtn.innerHTML = '<svg class="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg><span class="text-2xl font-semibold mt-2">Completed</span>';
    }
    if (requestOtBtn) requestOtBtn.classList.remove("hidden");
}

export function switchRole(role) {
    const memberSection = document.getElementById("member-section");
    const leaderSection = document.getElementById("leader-section");
    const roleMemberBtn = document.getElementById("role-member-btn");
    const roleLeaderBtn = document.getElementById("role-leader-btn");
    const activeClass = ["border-sky-500", "text-sky-600", "bg-sky-50"];
    const inactiveClass = ["border-gray-300", "text-gray-500", "bg-white"];

    if (role === "member") {
        if (memberSection) memberSection.classList.remove("hidden");
        if (leaderSection) leaderSection.classList.add("hidden");
        if (roleMemberBtn) { roleMemberBtn.classList.add(...activeClass); roleMemberBtn.classList.remove(...inactiveClass); }
        if (roleLeaderBtn) { roleLeaderBtn.classList.remove(...activeClass); roleLeaderBtn.classList.add(...inactiveClass); }
        document.getElementById("checkin-btn")?.classList.add("hidden");
    } else {
        if (memberSection) memberSection.classList.add("hidden");
        if (leaderSection) leaderSection.classList.remove("hidden");
        if (roleLeaderBtn) { roleLeaderBtn.classList.add(...activeClass); roleLeaderBtn.classList.remove(...inactiveClass); }
        if (roleMemberBtn) { roleMemberBtn.classList.remove(...activeClass); roleMemberBtn.classList.add(...inactiveClass); }
        document.getElementById("checkin-btn")?.classList.add("hidden");
    }
}

// 1. ตรวจสอบสถานะการทำงานตอนเปิดแอป
export async function checkUserWorkStatus() {
    const user = auth.currentUser;
    if (!user) return;
    
    const summaryCheckinTime = document.getElementById("summary-checkin-time");
    const summaryCheckoutTime = document.getElementById("summary-checkout-time");
    const summaryWorkHours = document.getElementById("summary-work-hours");
    const today = toLocalDateKey(new Date());
    const docId = `${user.uid}_${today}`;

    let workRecordDoc;
    try {
        workRecordDoc = await db.collection('work_records').doc(docId).get();
    } catch (e) {
        try { workRecordDoc = await db.collection('work_records').doc(docId).get({ source: 'cache' }); } 
        catch (cacheError) { return; }
    }

    if (workRecordDoc && workRecordDoc.exists) {
        const data = workRecordDoc.data();
        if (!data.checkIn || !data.checkIn.timestamp) return updateUIToCheckIn();

        const checkinTime = data.checkIn.timestamp.toDate();
        if (summaryCheckinTime) {
            summaryCheckinTime.textContent = checkinTime.toLocaleTimeString('th-TH');
            summaryCheckinTime.classList.remove('text-gray-400');
            summaryCheckinTime.classList.add('text-green-600');
        }

        if (data.status === 'checked_in') {
            updateUIToCheckedIn();
        } else if (data.status === 'completed' && data.checkOut) {
            updateUIToCompleted();
            const checkoutTime = data.checkOut.timestamp.toDate();
            let { regularWorkHours, overtimeHours: calculatedOt } = calculateWorkHours(checkinTime, checkoutTime);
            let finalOt = (data.overtime && typeof data.overtime.hours === 'number') ? data.overtime.hours : calculatedOt;

            if (summaryCheckoutTime) {
                summaryCheckoutTime.textContent = checkoutTime.toLocaleTimeString('th-TH');
                summaryCheckoutTime.classList.remove('text-gray-400');
                summaryCheckoutTime.classList.add('text-red-500');
            }
            if (summaryWorkHours) {
                summaryWorkHours.textContent = `${regularWorkHours.toFixed(2)} hours`;
                if (finalOt > 0) summaryWorkHours.textContent += ` (OT ${finalOt} hrs)`;
            }
        }
    } else {
        updateUIToCheckIn();
    }
}

// 2. บันทึกเวลาเข้างาน (Check-In)
export async function proceedWithCheckin(finalWorkType, reportData = null) {
    const user = auth.currentUser;
    if (!user) return;
    const checkinSpan = document.querySelector('#checkin-btn span');
    const checkinBtnElement = document.getElementById('checkin-btn');
    
    try {
        if (checkinBtnElement) checkinBtnElement.disabled = true;
        if (checkinSpan) checkinSpan.textContent = "กำลังบันทึก...";
        
        const now = new Date();
        const docId = `${user.uid}_${toLocalDateKey(now)}`;

        const workRecord = {
            userId: user.uid,
            date: firebase.firestore.Timestamp.fromDate(now),
            checkIn: {
                timestamp: firebase.firestore.Timestamp.fromDate(now),
                location: new firebase.firestore.GeoPoint(latestPosition.coords.latitude, latestPosition.coords.longitude),
                googleMapLink: `https://www.google.com/maps/search/?api=1&query=$$${latestPosition.coords.latitude},${latestPosition.coords.longitude}`,
                accuracy: latestPosition.coords.accuracy,
                workType: finalWorkType,
                onSiteDetails: null,
                photoUrl: null
            },
            status: "checked_in",
            reports: reportData ? [{ ...reportData, id: Date.now(), submittedAt: firebase.firestore.Timestamp.fromDate(now) }] : [],
            checkOut: null,
            overtime: null
        };

        await db.collection('work_records').doc(docId).set(workRecord);
        showNotification("Check-in สำเร็จแล้ว!", "success");
        updateUIToCheckedIn(); 

        const savedRecord = await db.collection('work_records').doc(docId).get();
        if (savedRecord.exists) {
            const serverCheckinTime = savedRecord.data().checkIn.timestamp.toDate();
            const summaryCheckinTime = document.getElementById("summary-checkin-time");
            const summaryCheckoutTime = document.getElementById("summary-checkout-time");
            const summaryWorkHours = document.getElementById("summary-work-hours");
            if (summaryCheckinTime) {
                summaryCheckinTime.textContent = serverCheckinTime.toLocaleTimeString('th-TH');
                summaryCheckinTime.classList.replace('text-gray-400', 'text-green-600');
            }
            if (summaryCheckoutTime) {
                summaryCheckoutTime.textContent = '-';
                summaryCheckoutTime.classList.replace('text-red-500', 'text-gray-400');
            }
            if (summaryWorkHours) summaryWorkHours.textContent = '-';
        }
    } catch (error) {
        console.error("Check-in Error:", error);
        showNotification("Error: " + error.message, 'error');
        if (checkinBtnElement) checkinBtnElement.disabled = false;
        if (checkinSpan) checkinSpan.textContent = "Check In";
    }
}

// 3. บันทึกเวลาเลิกงาน (Check-Out)
export async function handleCheckoutAction() {
    const user = auth.currentUser;
    if (!user) return showNotification("ไม่พบข้อมูลผู้ใช้", "error");
    if (!latestPosition) return showNotification("กำลังรอสัญญาณ GPS...", "warning");

    const checkoutBtn = document.getElementById('checkout-btn');
    const checkoutSpan = checkoutBtn?.querySelector('span');
    if (checkoutBtn) checkoutBtn.disabled = true;
    if (checkoutSpan) checkoutSpan.textContent = "ตรวจสอบสถานะกลุ่ม...";

    try {
        const now = new Date();
        const docId = `${user.uid}_${toLocalDateKey(now)}`;
        const workRecordRef = db.collection('work_records').doc(docId);
        const workRecordDoc = await workRecordRef.get();

        if (!workRecordDoc.exists) throw new Error("ไม่พบข้อมูลการเข้างาน");

        const recordData = workRecordDoc.data();
        const workType = recordData.checkIn.workType;
        const roomId = recordData.checkIn.roomId;

        const executeSaveCheckout = async (withOT, note, groupUpdateData = null) => {
            if (!latestPosition || !latestPosition.coords) return alert('ไม่พบข้อมูลตำแหน่ง GPS');
            const lat = latestPosition.coords.latitude;
            const lng = latestPosition.coords.longitude;

            try {
                if (checkoutSpan) checkoutSpan.textContent = "กำลังบันทึก...";
                const recordTimestampFn = cloudFunctions.httpsCallable('recordTimestamp');
                const result = await recordTimestampFn({
                    type: 'checkout', calculateOT: withOT, checkoutTime: new Date().toISOString(),
                    isDebug: false, location: { latitude: lat, longitude: lng }, note: note
                });

                if (groupUpdateData && roomId) {
                    await db.collection("onsite_rooms").doc(roomId).update(groupUpdateData);
                }

                if (typeof Swal !== 'undefined') {
                    let msg = "บันทึกเวลาเลิกงานเรียบร้อยแล้ว";
                    if (result.data && result.data.overtimeHours > 0) msg += `\n(บันทึก OT: ${result.data.overtimeHours} ชม.)`;
                    Swal.fire({ title: 'สำเร็จ', text: msg, icon: 'success', timer: 2000, showConfirmButton: false }).then(() => window.location.reload());
                } else {
                    alert("บันทึกเวลาเลิกงานเรียบร้อยแล้ว"); window.location.reload();
                }
            } catch (error) {
                console.error("Checkout Error:", error);
                let errorMsg = error.message;
                if (error.code === 'permission-denied') errorMsg = 'ไม่มีสิทธิ์เข้าถึงข้อมูล';
                if (error.code === 'internal') errorMsg = 'เกิดข้อผิดพลาดที่ Server (Cloud Function)';
                if (typeof Swal !== 'undefined') Swal.fire("เกิดข้อผิดพลาด", errorMsg, "error");
                else alert("Error: " + errorMsg);
                if (checkoutSpan) checkoutSpan.textContent = "Check Out";
                if (checkoutBtn) checkoutBtn.disabled = false;
            }
        };

        function checkTimeAndProceed(note, groupUpdate = null) {
            const h = now.getHours();
            if (h >= 18) {
                setTimeout(() => {
                    showConfirmDialog("เลยเวลาเลิกงาน ต้องการบันทึก OT หรือไม่?",
                        () => executeSaveCheckout(true, note, groupUpdate),
                        () => executeSaveCheckout(false, note, groupUpdate),
                        "บันทึก OT", "ไม่เอา OT"
                    );
                }, 300);
            } else {
                executeSaveCheckout(true, note, groupUpdate);
            }
        }

        if (workType === "onsite_group" && roomId) {
            const roomRef = db.collection("onsite_rooms").doc(roomId);
            const roomDoc = await roomRef.get();
            if (!roomDoc.exists) throw new Error("ไม่พบข้อมูลกลุ่มงาน (Room Not Found)");
            const roomData = roomDoc.data();
            const isLeader = user.uid === roomData.leaderId;

            if (isLeader) {
                showConfirmDialog("Leader: จบงานที่ไหน? (สมาชิกจะยึดตามคุณ)",
                    async () => {
                        const dist = calculateDistance(latestPosition.coords.latitude, latestPosition.coords.longitude, FACTORY_LOCATION.latitude, FACTORY_LOCATION.longitude);
                        if (dist > ALLOWED_RADIUS_METERS) {
                            showNotification(`คุณยังไม่ถึงโรงงาน (ห่าง ${dist.toFixed(0)} ม.)`, "error");
                            if (checkoutBtn) checkoutBtn.disabled = false;
                            if (checkoutSpan) checkoutSpan.textContent = "Check Out";
                            return;
                        }
                        const groupUpdate = { status: "closed", checkoutMode: "factory_return", checkoutTime: firebase.firestore.FieldValue.serverTimestamp() };
                        checkTimeAndProceed("factory_return", groupUpdate);
                    },
                    async () => {
                        const groupUpdate = { status: "closed", checkoutMode: "offsite_hotel", checkoutTime: firebase.firestore.FieldValue.serverTimestamp() };
                        checkTimeAndProceed("offsite_hotel", groupUpdate);
                    }, "กลับโรงงาน", "พักโรงแรม"
                );
            } else {
                if (roomData.status !== "closed" || !roomData.checkoutMode) {
                    showNotification("กรุณารอหัวหน้ากลุ่ม (Leader) กด Check-out ก่อน", "warning");
                    if (checkoutBtn) checkoutBtn.disabled = false;
                    if (checkoutSpan) checkoutSpan.textContent = "Check Out";
                    return;
                }
                if (roomData.checkoutMode === "factory_return") {
                    const dist = calculateDistance(latestPosition.coords.latitude, latestPosition.coords.longitude, FACTORY_LOCATION.latitude, FACTORY_LOCATION.longitude);
                    if (dist > ALLOWED_RADIUS_METERS) {
                        showNotification(`หัวหน้าจบงานที่โรงงาน แต่คุณอยู่นอกพื้นที่ (${dist.toFixed(0)} ม.)`, "error");
                        if (checkoutBtn) checkoutBtn.disabled = false;
                        if (checkoutSpan) checkoutSpan.textContent = "Check Out";
                        return;
                    }
                    checkTimeAndProceed("factory_return_member");
                } else {
                    checkTimeAndProceed("offsite_hotel_member");
                }
            }
        } else {
            const dist = calculateDistance(latestPosition.coords.latitude, latestPosition.coords.longitude, FACTORY_LOCATION.latitude, FACTORY_LOCATION.longitude);
            if (dist <= ALLOWED_RADIUS_METERS) {
                checkTimeAndProceed("factory_normal");
            } else {
                showNotification(`อยู่นอกพื้นที่โรงงาน (${dist.toFixed(0)} ม.)`, "error");
                if (checkoutBtn) checkoutBtn.disabled = false;
                if (checkoutSpan) checkoutSpan.textContent = "Check Out";
            }
        }
    } catch (error) {
        console.error("Checkout Global Error:", error);
        showNotification("Error: " + error.message, "error");
        if (checkoutBtn) checkoutBtn.disabled = false;
        if (checkoutSpan) checkoutSpan.textContent = "Check Out";
    }
}

// 4. On-site Group: สร้างห้อง (Leader)
export async function setupOnsiteLeader(project, locationName, currentUserData) {
    const user = auth.currentUser;
    if (!user) return alert("คุณยังไม่ได้เข้าสู่ระบบ");
    if (!latestPosition) return alert("กรุณารอสัญญาณ GPS สักครู่...");

    try {
        const leaderNow = new Date();
        const roomId = Math.random().toString(36).substring(2, 9).toUpperCase();
        
        const roomData = {
            roomId: roomId, leaderId: user.uid, leaderName: currentUserData.fullName,
            project: project, locationName: locationName,
            gpsLocation: new firebase.firestore.GeoPoint(latestPosition.coords.latitude, latestPosition.coords.longitude),
            leaderTimestamp: firebase.firestore.Timestamp.fromDate(leaderNow),
            createdAt: firebase.firestore.FieldValue.serverTimestamp(), isActive: true, members: []
        };

        await db.collection("onsite_rooms").doc(roomId).set(roomData);
        await performCheckIn(roomId, project, locationName, "leader", user.uid, leaderNow);
        
        db.collection("onsite_rooms").doc(roomId).onSnapshot((doc) => {
            if (doc.exists) {
                const members = doc.data().members || [];
                const roomMembersList = document.getElementById("room-members-list");
                if (roomMembersList) {
                    if (members.length === 0) roomMembersList.innerHTML = '<li class="text-gray-400 italic">รอสมาชิกสแกน...</li>';
                    else roomMembersList.innerHTML = members.map(m => `<li class="text-green-600 font-medium">✓ ${m.name}</li>`).join("");
                }
            }
        });
        return roomId;
    } catch (error) {
        console.error("Error creating room:", error);
        alert("เกิดข้อผิดพลาด: " + error.message);
        return null;
    }
}

// 5. On-site Group: เข้าร่วมห้อง (Member)
export async function joinOnsiteRoom(roomId, currentUserData) {
    const user = auth.currentUser;
    if (!user) return;

    try {
        const roomRef = db.collection("onsite_rooms").doc(roomId);
        const roomDoc = await roomRef.get();

        if (!roomDoc.exists || !roomDoc.data().isActive) {
            alert("ห้องนี้ปิดไปแล้ว หรือรหัสไม่ถูกต้อง");
            const statusEl = document.getElementById('scan-status');
            if (statusEl) statusEl.textContent = 'กดปุ่มเพื่อเริ่มสแกนใหม่';
            return;
        }

        const roomData = roomDoc.data();
        await performCheckIn(roomId, roomData.project, roomData.locationName, "member", roomData.leaderId);

        await roomRef.update({
            members: firebase.firestore.FieldValue.arrayUnion({ uid: user.uid, name: currentUserData.fullName })
        });

        alert(`เข้าร่วมกลุ่ม "${roomData.project}" สำเร็จ!`);
        window.location.reload(); 
    } catch (error) {
        console.error("Join room error:", error);
        alert("เกิดข้อผิดพลาดในการเข้าร่วม: " + error.message);
    }
}

// 6. On-site Group: ลงเวลาเข้างานร่วม
export async function performCheckIn(roomId, project, locationName, role, leaderId, customTime = null) {
    const user = auth.currentUser;
    let checkInTime = customTime || new Date();
    let checkInLocation = new firebase.firestore.GeoPoint(latestPosition.coords.latitude, latestPosition.coords.longitude);

    if (role === "member") {
        const roomDoc = await db.collection("onsite_rooms").doc(roomId).get();
        if (roomDoc.exists) {
            const rData = roomDoc.data();
            if (rData.leaderTimestamp) checkInTime = rData.leaderTimestamp.toDate();
            if (rData.gpsLocation) checkInLocation = rData.gpsLocation;
        }
    }

    const docId = `${user.uid}_${toLocalDateKey(checkInTime)}`;
    const workRecord = {
        userId: user.uid, date: firebase.firestore.Timestamp.fromDate(checkInTime),
        checkIn: {
            timestamp: firebase.firestore.Timestamp.fromDate(checkInTime), location: checkInLocation,
            googleMapLink: `https://www.google.com/maps/search/?api=1&query=$${checkInLocation.latitude},${checkInLocation.longitude}`,
            accuracy: role === "leader" ? latestPosition.coords.accuracy : null,
            workType: "onsite_group", roomId: roomId, leaderId: leaderId,
            onSiteDetails: `${locationName} (Group: ${project})`, photoUrl: null
        },
        status: "checked_in", report: null, checkOut: null, overtime: null
    };

    await db.collection("work_records").doc(docId).set(workRecord);
    updateUIToCheckedIn();
    showNotification("บันทึกเวลาเข้างานเรียบร้อย");
}

export function loadScript(src) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
        const script = document.createElement("script");
        script.src = src; script.onload = resolve; script.onerror = reject;
        document.head.appendChild(script);
    });
}