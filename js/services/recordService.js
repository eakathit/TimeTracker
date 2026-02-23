// ไฟล์: public/js/services/recordService.js
import { db, auth } from '../config/firebase-config.js';
import { showNotification } from '../utils/uiHelper.js';

// --- ฟังก์ชันช่วยเหลือ (จัดฟอร์แมตวันที่) ---
const toLocalISOString = (date) => {
    if (!date) return "";
    const pad = (n) => (n < 10 ? '0' + n : n);
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes());
};

// 1. โหลดประวัติรายงานของวันนี้ (UI/UX แบบเดิมเป๊ะ!)
export async function loadSentReports() {
    const container = document.getElementById('sent-reports-container');
    const dateInput = document.getElementById('report-date-input');
    const user = auth.currentUser;

    if (!container || !user || !dateInput) return;

    const selectedDateStr = dateInput.value;
    if (!selectedDateStr) return;

    const docId = `${user.uid}_${selectedDateStr}`;

    container.innerHTML = `
        <div class="flex justify-center py-8">
            <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-sky-500"></div>
        </div>
    `;

    try {
        const doc = await db.collection('work_records').doc(docId).get();
        let htmlContent = '';

        if (doc.exists) {
            const data = doc.data();
            const reportsArray = data.reports || (data.report ? [data.report] : []);

            if (reportsArray.length > 0) {
                reportsArray.sort((a, b) => (b.id || 0) - (a.id || 0));

                reportsArray.forEach((item, index) => {
                    const reportId = item.id || index;
                    // --- 🌟 HTML การ์ด Report แบบดั้งเดิม ---
                    htmlContent += `
                        <div class="card !p-4 border-l-4 border-sky-400 mb-3 shadow-sm bg-white relative group">
                            <div class="flex justify-between items-start mb-2">
                                <span class="bg-sky-100 text-sky-700 text-[10px] px-2 py-0.5 rounded-full font-bold">
                                    No.${index + 1}
                                </span>
                                <button class="delete-report-btn text-gray-300 hover:text-red-500 transition-colors" 
                                        onclick="window.deleteReportItem('${docId}', ${reportId})">
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                                    </svg>
                                </button>
                            </div>
                            <h4 class="font-bold text-gray-800 text-base">${item.workType}</h4>
                            <div class="mt-2 grid grid-cols-1 gap-1 text-sm text-gray-600">
                                <div class="flex items-center">
                                    <span class="w-16 text-gray-400">Project:</span>
                                    <span class="font-medium text-gray-700">${item.project}</span>
                                </div>
                                <div class="flex items-center">
                                    <span class="w-16 text-gray-400">Period:</span>
                                    <span class="font-medium text-gray-700">${item.duration}</span>
                                </div>
                            </div>
                        </div>
                    `;
                });
            } else {
                htmlContent = getEmptyStateHTML();
            }
        } else {
            htmlContent = getEmptyStateHTML();
        }
        container.innerHTML = htmlContent;
    } catch (error) {
        console.error("Error loading reports:", error);
        container.innerHTML = `<div class="text-center py-8 text-red-400 text-sm">โหลดข้อมูลไม่สำเร็จ</div>`;
    }
}

// --- 🌟 HTML สถานะไม่มีข้อมูล แบบดั้งเดิม (รูปไอคอนใบขีด) ---
function getEmptyStateHTML() {
    return `
        <div class="flex flex-col items-center justify-center py-12 opacity-40">
            <div class="bg-gray-100 p-4 rounded-full mb-3">
                <svg class="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"></path>
                </svg>
            </div>
            <p class="text-gray-500 text-[11px] font-medium tracking-wide">ยังไม่มีประวัติรายงานสำหรับวันนี้</p>
        </div>
    `;
}

// 2. ฟังก์ชันค้นหาข้อมูลเพื่อแก้ไข (UI/UX แบบเดิมเป๊ะ!)
export async function searchRecordForEdit() {
    const userSelect = document.getElementById("edit-user-select");
    const dateSelect = document.getElementById("edit-date-select");
    const resultsContainer = document.getElementById("search-results-container");

    if (!userSelect || !dateSelect || !resultsContainer) return;

    const userId = userSelect.value;
    const dateStr = dateSelect.value;

    if (!userId || !dateStr) {
        resultsContainer.innerHTML = '<p class="text-sm text-center text-red-500 py-2">กรุณาเลือกพนักงานและวันที่</p>';
        return;
    }

    resultsContainer.innerHTML = '<p class="text-sm text-center text-gray-500 py-2">กำลังค้นหาข้อมูล...</p>';

    try {
        const docId = `${userId}_${dateStr}`;
        const docSnap = await db.collection("work_records").doc(docId).get();

        if (docSnap.exists) {
            const data = docSnap.data();
            const report = data.report || data.reports?.[0] || {};
            
            const checkinTime = data.checkIn?.timestamp ? data.checkIn.timestamp.toDate().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) : "ไม่มีข้อมูล";
            const checkoutTime = data.checkOut?.timestamp ? data.checkOut.timestamp.toDate().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) : "-";
            const reportInfo = report.workType ? `${report.workType} (${report.project || "N/A"})` : "ยังไม่ส่งรายงาน";

            // --- 🌟 HTML การ์ดค้นหา แบบดั้งเดิม ---
            resultsContainer.innerHTML = `
                <div class="p-4 bg-white rounded-xl border border-gray-200 shadow-sm">
                    <div class="flex justify-between items-start">
                        <p class="font-semibold text-gray-800">ข้อมูลที่พบ</p>
                        <button id="btn-edit-${docId}" class="edit-record-btn text-sm bg-sky-100 text-sky-700 font-semibold px-3 py-1 rounded-lg hover:bg-sky-200">
                            แก้ไข
                        </button>
                    </div>
                    <div class="mt-3 pt-3 border-t border-gray-100 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        <div><span class="text-gray-500">เข้า:</span> <span class="font-semibold text-green-600">${checkinTime}</span></div>
                        <div><span class="text-gray-500">ออก:</span> <span class="font-semibold text-red-500">${checkoutTime}</span></div>
                        <div class="col-span-2 mt-1"><span class="text-gray-500">รายงาน:</span> <span class="font-medium text-gray-700">${reportInfo}</span></div>
                    </div>
                </div>
            `;

            // ผูก Event ปุ่มแก้ไข
            document.getElementById(`btn-edit-${docId}`).addEventListener("click", (e) => {
                e.preventDefault();
                openEditModal(docId, null, null, data);
            });

        } else {
            // --- 🌟 HTML สถานะไม่พบข้อมูล + ปุ่มเพิ่ม แบบดั้งเดิม ---
            resultsContainer.innerHTML = `
                <p class="text-sm text-center text-yellow-600 py-2">ไม่พบข้อมูลการลงเวลาสำหรับผู้ใช้และวันที่ที่เลือก</p>
                <button id="btn-add-${docId}" class="add-record-btn mt-2 w-full btn-primary py-2 text-sm">
                    + เพิ่มข้อมูลสำหรับวันนี้
                </button>
            `;

            // ผูก Event ปุ่มเพิ่มใหม่
            document.getElementById(`btn-add-${docId}`).addEventListener("click", (e) => {
                e.preventDefault();
                openEditModal(null, userId, dateStr, null);
            });
        }

    } catch (error) {
        console.error("Error searching record:", error);
        resultsContainer.innerHTML = '<p class="text-sm text-center text-red-500 py-2">เกิดข้อผิดพลาดในการค้นหา</p>';
    }
}

// 3. ฟังก์ชันเตรียมข้อมูลใส่ Modal
export function openEditModal(docId, newUserId, newDateStr, existingData = null) {
    const editModal = document.getElementById("edit-modal");
    if (!editModal) return;

    let report = {};
    let checkinDate = null;
    let checkoutDate = null;
    let finalDocId = docId;

    if (docId && existingData) {
        // อัปเดตของเดิม
        report = existingData.report || existingData.reports?.[0] || {};
        checkinDate = existingData.checkIn?.timestamp?.toDate() || null;
        checkoutDate = existingData.checkOut?.timestamp?.toDate() || null;
    } else {
        // เพิ่มใหม่
        finalDocId = `${newUserId}_${newDateStr}`;
        checkinDate = new Date(`${newDateStr}T08:30:00`);
        checkoutDate = new Date(`${newDateStr}T17:30:00`);
    }

    document.getElementById("edit-doc-id").value = finalDocId;
    document.getElementById("edit-checkin-time").value = toLocalISOString(checkinDate);
    document.getElementById("edit-checkout-time").value = toLocalISOString(checkoutDate);
    document.getElementById("edit-onsite-details").value = existingData?.checkIn?.onSiteDetails || "";

    // เติมข้อมูล Dropdown
    const wtEl = document.getElementById("edit-modal-work-type-selected-text");
    const pjEl = document.getElementById("edit-modal-project-selected-text");
    const drEl = document.getElementById("edit-modal-duration-selected-text");
    const ctInputs = document.getElementById("edit-modal-custom-time-inputs");

    if (wtEl) { wtEl.textContent = report.workType || "--- เลือกประเภทงาน ---"; wtEl.className = report.workType ? "text-gray-800" : "text-gray-500"; }
    if (pjEl) { pjEl.textContent = report.project || "--- เลือกโครงการ ---"; pjEl.className = report.project ? "text-gray-800" : "text-gray-500"; }
    
    if (drEl && ctInputs) {
        const standardDurations = ["ทั้งวัน (08:30 - 17:30)", "ครึ่งวันเช้า (08:30 - 12:00)", "ครึ่งวันบ่าย (13:00 - 17:30)", "ALL (08:30 - 17:30)", "HALF DAY (08:30 - 12:00)", "HALF DAY (13:00 - 17:30)"];
        
        ctInputs.classList.add("hidden");
        if (report.duration) {
            if (standardDurations.includes(report.duration)) {
                drEl.textContent = report.duration;
                drEl.classList.remove("text-gray-500");
            } else {
                drEl.textContent = "กำหนดเวลา";
                drEl.classList.remove("text-gray-500");
                ctInputs.classList.remove("hidden");
                const times = report.duration.split(" - ");
                if (times.length === 2) {
                    document.getElementById("edit-modal-custom-time-start-input").value = times[0];
                    document.getElementById("edit-modal-custom-time-end-input").value = times[1];
                }
            }
        } else {
            drEl.textContent = !docId ? "ทั้งวัน (08:30 - 17:30)" : "--- เลือกระยะเวลา ---";
            drEl.className = !docId ? "text-gray-800" : "text-gray-500";
        }
    }
    editModal.classList.remove("hidden");
}

// 4. ฟังก์ชันบันทึกข้อมูลที่แก้ไข
export async function saveEditedRecord() {
    const docId = document.getElementById("edit-doc-id").value;
    if (!docId) return showNotification("ไม่พบ ID ของเอกสาร", "error");

    const checkInTimeInput = document.getElementById("edit-checkin-time").value;
    const checkOutTimeInput = document.getElementById("edit-checkout-time").value;
    const onsiteDetails = document.getElementById("edit-onsite-details").value;
    const workType = document.getElementById("edit-modal-work-type-selected-text").textContent;
    const project = document.getElementById("edit-modal-project-selected-text").textContent;
    const duration = document.getElementById("edit-modal-duration-selected-text").textContent;

    let finalDuration = duration;
    let finalHours = 0;
    let finalStartT = "", finalEndT = "";

    if (duration.includes("ทั้งวัน") || duration.includes("ALL")) { finalHours = 8.0; finalDuration = "ALL (08:30 - 17:30)"; finalStartT="08:30"; finalEndT="17:30"; }
    else if (duration.includes("ครึ่งวันเช้า")) { finalHours = 3.5; finalDuration = "HALF DAY (08:30 - 12:00)"; finalStartT="08:30"; finalEndT="12:00"; }
    else if (duration.includes("ครึ่งวันบ่าย")) { finalHours = 4.5; finalDuration = "HALF DAY (13:00 - 17:30)"; finalStartT="13:00"; finalEndT="17:30"; }
    else if (duration.includes("กำหนดเวลา") || duration.includes("SOME TIME")) {
        const st = document.getElementById("edit-modal-custom-time-start-input").value;
        const et = document.getElementById("edit-modal-custom-time-end-input").value;
        if (!st || !et) return showNotification("กรุณาระบุเวลาให้ครบ", "warning");
        const diff = (new Date(`2000-01-01T${et}`) - new Date(`2000-01-01T${st}`)) / 3600000;
        if(diff <= 0) return showNotification("เวลาสิ้นสุดต้องมากกว่าเวลาเริ่มต้น", "warning");
        finalHours = parseFloat(diff.toFixed(2));
        finalDuration = `SOME TIME (${st} - ${et})`;
        finalStartT = st; finalEndT = et;
    }

    const updateData = {};
    if (checkInTimeInput) updateData["checkIn.timestamp"] = firebase.firestore.Timestamp.fromDate(new Date(checkInTimeInput));
    if (onsiteDetails) updateData["checkIn.onSiteDetails"] = onsiteDetails;
    if (checkOutTimeInput) {
        updateData["checkOut"] = { timestamp: firebase.firestore.Timestamp.fromDate(new Date(checkOutTimeInput)) };
        updateData["status"] = "completed";
    }

    if (workType && !workType.includes("เลือก") && project && !project.includes("เลือก")) {
        const reportPayload = { workType, project, duration: finalDuration, hours: finalHours, startTime: finalStartT, endTime: finalEndT, id: Date.now() };
        updateData["reports"] = [reportPayload];
        updateData["report"] = reportPayload;
    }

    const saveBtn = document.getElementById("save-edit-btn");
    try {
        if(saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "กำลังบันทึก..."; }
        
        // ใช้ set({..}, {merge:true}) แทน update เผื่อกรณีสร้างใหม่
        await db.collection("work_records").doc(docId).set(updateData, { merge: true });
        
        showNotification("อัปเดตข้อมูลสำเร็จ!", "success");
        document.getElementById("edit-modal").classList.add("hidden");
        searchRecordForEdit(); // โหลดผลลัพธ์ใหม่
    } catch (error) {
        console.error("Error updating record:", error);
        showNotification("เกิดข้อผิดพลาด: " + error.message, "error");
    } finally {
        if(saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "บันทึกการแก้ไข"; }
    }
}