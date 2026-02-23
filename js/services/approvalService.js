// ไฟล์: public/js/services/approvalService.js
import { db, auth } from '../config/firebase-config.js';
import { showNotification } from '../utils/uiHelper.js';

const LEAVE_TYPE_MAP = {
    annual: "ลาพักร้อน",
    sick: "ลาป่วย",
    personal: "ลากิจ",
    maternity: "ลาคลอด"
};

// 1. โหลดรายการใบลาที่รออนุมัติ
export async function loadPendingLeaveRequests(currentUserData) {
    const listContainer = document.getElementById("leave-approval-list");
    let loadingMsg = document.getElementById("leave-loading-msg");
    if (!listContainer || !currentUserData) return;

    if (!loadingMsg) {
        loadingMsg = document.createElement("p");
        loadingMsg.id = "leave-loading-msg";
        loadingMsg.className = "text-center text-gray-400 text-sm py-4";
        listContainer.appendChild(loadingMsg);
    }

    loadingMsg.textContent = "กำลังโหลดรายการ...";
    listContainer.innerHTML = "";
    listContainer.appendChild(loadingMsg);

    try {
        const userMap = new Map();
        const usersSnapshot = await db.collection("users").get();
        usersSnapshot.forEach((doc) => userMap.set(doc.id, doc.data()));

        const querySnapshot = await db.collection("leave_requests").where("status", "==", "pending").get();

        if (querySnapshot.empty) {
            loadingMsg.textContent = "ไม่มีรายการรออนุมัติ";
            return;
        }

        listContainer.innerHTML = "";
        let hasItems = false;

        querySnapshot.forEach((doc) => {
            const leave = doc.data();
            const docId = doc.id;
            const user = userMap.get(leave.userId);
            const userDept = user ? user.department || "Unassigned" : "Unknown";
            const adminDept = currentUserData.department || "Unassigned";

            const isSuperAdmin = ["HR", "Management", "Admin"].includes(adminDept);
            if (!isSuperAdmin && adminDept !== userDept) return;

            hasItems = true;
            const displayName = user ? user.fullName : leave.userName;
            const displayPhoto = user ? user.profileImageUrl : leave.userPhoto;

            const startDate = leave.startDate.toDate().toLocaleDateString("th-TH");
            const endDate = leave.endDate.toDate().toLocaleDateString("th-TH");
            let dateInfoText = leave.durationType === "hourly" && leave.startTime
                ? `${startDate} (${leave.startTime} - ${leave.endTime})`
                : `${startDate} ถึง ${endDate}`;

            const cardHTML = `
            <div class="bg-white shadow-sm rounded-xl p-4 border border-gray-200 mb-4 relative leave-request-card">
                <span class="absolute top-4 right-4 px-2 py-1 bg-gray-100 text-gray-500 text-[10px] font-bold uppercase rounded-lg border border-gray-200">${userDept}</span>
                <div class="flex items-start gap-3">
                    <img src="${displayPhoto || "https://placehold.co/100x100/E2E8F0/475569?text=User"}" class="w-12 h-12 rounded-full object-cover border border-gray-100">
                    <div>
                        <p class="font-bold text-gray-800">${displayName}</p>
                        <p class="text-sm font-medium text-sky-600 mb-1">${LEAVE_TYPE_MAP[leave.leaveType] || leave.leaveType}</p>
                        <div class="flex items-center gap-1 text-xs text-gray-500 bg-gray-50 px-2 py-1 rounded w-fit">
                            <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                            ${dateInfoText}
                        </div>
                    </div>
                </div>
                <div class="mt-3 text-sm text-gray-600 bg-gray-50 p-2.5 rounded-lg border border-gray-100 italic">"${leave.reason}"</div>
                <div class="flex justify-end gap-2 mt-3 pt-3 border-t border-gray-100">
                    <button data-id="${docId}" class="reject-leave-btn flex-1 text-sm font-medium text-red-600 px-3 py-2 rounded-lg bg-red-50 hover:bg-red-100 transition">ไม่อนุมัติ</button>
                    <button data-id="${docId}" class="approve-leave-btn flex-[2] text-sm font-medium text-white px-3 py-2 rounded-lg bg-sky-500 hover:bg-sky-600 shadow-sm transition">อนุมัติ (Approve)</button>
                </div>
            </div>`;
            listContainer.innerHTML += cardHTML;
        });

        if (!hasItems) {
            loadingMsg.textContent = `ไม่มีรายการรออนุมัติของแผนก ${currentUserData.department || "-"}`;
            listContainer.appendChild(loadingMsg);
        }
    } catch (error) {
        console.error("Error loading leave requests:", error);
        loadingMsg.textContent = "เกิดข้อผิดพลาดในการโหลดข้อมูล";
    }
}

// 2. โหลดรายการ OT ที่รออนุมัติ
export async function loadPendingOtRequests(currentUserData) {
    const listContainer = document.getElementById("ot-approval-list");
    let loadingMsg = document.getElementById("ot-loading-msg");
    if (!listContainer || !currentUserData) return;

    if (!loadingMsg) {
        loadingMsg = document.createElement("p");
        loadingMsg.id = "ot-loading-msg";
        loadingMsg.className = "text-center text-gray-400 text-sm py-4";
        listContainer.appendChild(loadingMsg);
    }

    loadingMsg.textContent = "กำลังโหลดรายการ...";
    listContainer.innerHTML = "";
    listContainer.appendChild(loadingMsg);

    try {
        const userMap = new Map();
        const usersSnapshot = await db.collection("users").get();
        usersSnapshot.forEach((doc) => userMap.set(doc.id, doc.data()));

        const querySnapshot = await db.collection("ot_requests").where("status", "==", "pending").get();

        if (querySnapshot.empty) {
            loadingMsg.textContent = "ไม่มีรายการรออนุมัติ";
            return;
        }

        listContainer.innerHTML = "";
        let hasItems = false;

        querySnapshot.forEach((doc) => {
            const ot = doc.data();
            const docId = doc.id;
            const user = userMap.get(ot.userId);
            const userDept = user ? user.department || "Unassigned" : "Unknown";
            const adminDept = currentUserData.department || "Unassigned";

            const isSuperAdmin = ["HR", "Management", "Admin"].includes(adminDept);
            if (!isSuperAdmin && adminDept !== userDept) return;

            hasItems = true;
            const displayName = user ? user.fullName : ot.userName;
            const displayPhoto = user ? user.profileImageUrl : ot.userPhoto;
            const otDate = ot.date.toDate().toLocaleDateString("th-TH");

            let timeInfoText = "";
            let otDurationBadge = "";
            if (ot.startTime && ot.endTime) {
                timeInfoText = `${ot.startTime} - ${ot.endTime}`;
                const [startH, startM] = ot.startTime.split(":").map(Number);
                const [endH, endM] = ot.endTime.split(":").map(Number);
                const totalMinutes = endH * 60 + endM - (startH * 60 + startM);
                const otDurationHours = Math.floor(totalMinutes / 30) * 0.5;
                otDurationBadge = `<span class="bg-orange-100 text-orange-700 text-xs font-bold px-2 py-0.5 rounded-md ml-1">${otDurationHours.toFixed(1)} ชม.</span>`;
            }

            const cardHTML = `
            <div class="bg-white shadow-sm rounded-xl p-4 border border-gray-200 mb-4 relative ot-request-card">
                <span class="absolute top-4 right-4 px-2 py-1 bg-gray-100 text-gray-500 text-[10px] font-bold uppercase rounded-lg border border-gray-200">${userDept}</span>
                <div class="flex items-start gap-3">
                    <img src="${displayPhoto || "https://placehold.co/100x100/E2E8F0/475569?text=User"}" class="w-12 h-12 rounded-full object-cover border border-gray-100">
                    <div>
                        <p class="font-bold text-gray-800">${displayName}</p> 
                        <div class="flex items-center gap-1 mb-1">
                            <span class="text-sm font-medium text-orange-600">ขอ OT ${otDate}</span>${otDurationBadge}
                        </div>
                        <p class="text-xs text-gray-500 flex items-center gap-1">
                            <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                            เวลา: ${timeInfoText}
                        </p>
                    </div>
                </div>
                <div class="mt-3 text-sm text-gray-600 bg-gray-50 p-2.5 rounded-lg border border-gray-100 italic">"${ot.reason || "-"}"</div>
                <div class="flex justify-end gap-2 mt-3 pt-3 border-t border-gray-100">
                    <button data-id="${docId}" class="reject-ot-btn flex-1 text-sm font-medium text-red-600 px-3 py-2 rounded-lg bg-red-50 hover:bg-red-100 transition">ไม่อนุมัติ</button>
                    <button data-id="${docId}" class="approve-ot-btn flex-[2] text-sm font-medium text-white px-3 py-2 rounded-lg bg-green-500 hover:bg-green-600 shadow-sm transition">อนุมัติ (Approve)</button>
                </div>
            </div>`;
            listContainer.innerHTML += cardHTML;
        });

        if (!hasItems) {
            loadingMsg.textContent = `ไม่มีคำขอ OT ของแผนก ${currentUserData.department || "-"}`;
            listContainer.appendChild(loadingMsg);
        }
    } catch (error) {
        console.error("Error loading OT requests:", error);
        loadingMsg.textContent = "เกิดข้อผิดพลาดในการโหลดข้อมูล";
    }
}

// 3. ฟังก์ชันอนุมัติ OT
export async function handleOtApproval(docId, newStatus, buttonElement) {
    if (!docId) return;
    const cardElement = buttonElement.closest(".ot-request-card");

    if (cardElement) {
        cardElement.querySelectorAll("button").forEach((btn) => (btn.disabled = true));
        cardElement.style.transition = "opacity 0.3s ease, transform 0.3s ease";
        cardElement.style.opacity = "0.5";
    } else {
        buttonElement.disabled = true;
    }

    try {
        const otRequestRef = db.collection("ot_requests").doc(docId);
        const otDoc = await otRequestRef.get();
        if (!otDoc.exists) throw new Error("ไม่พบคำขอ OT");

        const otData = otDoc.data();
        await otRequestRef.update({
            status: newStatus,
            approvedBy: auth.currentUser ? auth.currentUser.displayName : "Admin"
        });

        if (newStatus === "approved" && otData.workRecordDocId && otData.startTime && otData.endTime) {
            const workRecordRef = db.collection("work_records").doc(otData.workRecordDocId);
            const [startH, startM] = otData.startTime.split(":").map(Number);
            const [endH, endM] = otData.endTime.split(":").map(Number);

            if (!isNaN(startH) && !isNaN(startM) && !isNaN(endH) && !isNaN(endM)) {
                const totalMinutes = endH * 60 + endM - (startH * 60 + startM);
                const otDurationHours = Math.floor(totalMinutes / 30) * 0.5;
                if (otDurationHours > 0) {
                    await workRecordRef.update({
                        "overtime.hours": firebase.firestore.FieldValue.increment(otDurationHours),
                    });
                }
            }
        }

        showNotification(newStatus === "rejected" ? "ปฏิเสธคำขอ OT สำเร็จ" : "อนุมัติ OT สำเร็จ", "success");

        if (cardElement) {
            cardElement.style.opacity = "0";
            cardElement.style.transform = "scale(0.95)";
            setTimeout(() => {
                cardElement.remove();
                const listContainer = document.getElementById("ot-approval-list");
                if (listContainer && listContainer.children.length === 0) {
                    listContainer.innerHTML = '<p id="ot-loading-msg" class="text-center text-gray-400 text-sm py-4">ไม่มีรายการรออนุมัติ</p>';
                }
            }, 300);
        } else {
            // ดึง currentUserData จาก LocalStorage หรือ Cache ได้หากมีการเชื่อมระบบ (ที่นี่รีโหลดใหม่แทน)
            window.location.reload(); 
        }
    } catch (error) {
        console.error("Error updating OT status:", error);
        showNotification("เกิดข้อผิดพลาดในการอัปเดต", "error");
        if (cardElement) {
            cardElement.querySelectorAll("button").forEach((btn) => (btn.disabled = false));
            cardElement.style.opacity = "1";
            cardElement.style.transform = "scale(1)";
        } else {
            buttonElement.disabled = false;
        }
    }
}