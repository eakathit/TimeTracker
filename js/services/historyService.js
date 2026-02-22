// ไฟล์: public/js/services/historyService.js
import { db, auth } from '../config/firebase-config.js';
import { calculateWorkHours } from '../utils/dateHelper.js';

const LEAVE_TYPE_MAP = {
    annual: "ลาพักร้อน",
    sick: "ลาป่วย",
    personal: "ลากิจ",
    maternity: "ลาคลอด"
};

// 1. โหลดประวัติการทำงาน (Work History)
export async function loadWorkHistory() {
    const currentUser = auth.currentUser;
    if (!currentUser) return;

    const container = document.getElementById("work-history-container");
    const rangeSelect = document.getElementById("history-range-select");
    const selectedRange = rangeSelect ? rangeSelect.value : "7";

    const summaryHoursEl = document.getElementById("profile-summary-hours");
    const summaryOtEl = document.getElementById("profile-summary-ot");
    const summaryDaysEl = document.getElementById("profile-summary-days");

    if (summaryHoursEl) summaryHoursEl.textContent = "-";
    if (summaryOtEl) summaryOtEl.textContent = "-";
    if (summaryDaysEl) summaryDaysEl.textContent = "-";
    
    if (container) container.innerHTML = `<p class="text-center text-gray-500 text-sm py-4">กำลังโหลดประวัติการทำงาน...</p>`;

    try {
        let startDate, endDate;
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

        if (selectedRange === "7") {
            startDate = new Date(todayStart);
            startDate.setDate(todayStart.getDate() - 6);
            endDate = new Date(now);
        } else if (selectedRange === "this_month") {
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            endDate = new Date(now);
        } else if (selectedRange === "last_month") {
            startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
        }

        const recordsSnapshot = await db.collection("work_records")
            .where("userId", "==", currentUser.uid)
            .where("date", ">=", startDate)
            .where("date", "<=", endDate)
            .orderBy("date", "desc")
            .get();

        if (recordsSnapshot.empty) {
            let emptyMessage = "ไม่พบประวัติการทำงาน";
            if (selectedRange === "7") emptyMessage = "ไม่พบประวัติในช่วง 7 วันที่ผ่านมา";
            else if (selectedRange === "this_month") emptyMessage = "ไม่พบประวัติในเดือนนี้";
            else if (selectedRange === "last_month") emptyMessage = "ไม่พบประวัติในเดือนที่แล้ว";

            if (container) container.innerHTML = `<p class="text-center text-gray-500 text-sm py-4">${emptyMessage}</p>`;
            if (summaryDaysEl) summaryDaysEl.textContent = "0 วัน";
            return;
        }

        let historyHtml = "";
        let accumulatorRegularWorkHours = 0;
        let totalOtHoursSum = 0;
        let totalDays = recordsSnapshot.size;

        recordsSnapshot.forEach((doc) => {
            const record = doc.data();
            const displayDate = record.date.toDate();
            const hasCheckIn = record.checkIn && record.checkIn.timestamp;
            const checkinTime = hasCheckIn ? record.checkIn.timestamp.toDate() : null;
            const reportsArray = record.reports || (record.report ? [record.report] : []);
            const hasReport = reportsArray.length > 0;

            let checkoutTimeStr = "-";
            let regularWorkHours = 0;
            let overtimeHours = 0;
            let checkinTimeStr = hasCheckIn
                ? checkinTime.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) + " น."
                : '<span class="text-orange-400">Report Only</span>';

            if (hasCheckIn && record.status === "completed" && record.checkOut) {
                const checkoutTime = record.checkOut.timestamp.toDate();
                checkoutTimeStr = checkoutTime.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) + " น.";

                if (typeof record.regularHours === "number") {
                    regularWorkHours = record.regularHours;
                } else {
                    const timeCalc = calculateWorkHours(checkinTime, checkoutTime);
                    regularWorkHours = timeCalc.regularWorkHours;
                }

                if (record.overtime && typeof record.overtime.hours === "number") {
                    overtimeHours = record.overtime.hours;
                } else {
                    const timeCalc = calculateWorkHours(checkinTime, checkoutTime);
                    overtimeHours = timeCalc.overtimeHours || 0;
                }
            }

            regularWorkHours = Number(regularWorkHours || 0);
            overtimeHours = Number(overtimeHours || 0);

            accumulatorRegularWorkHours += regularWorkHours;
            totalOtHoursSum += overtimeHours;

            let workTypeHTML = "";
            if (!hasCheckIn) {
                workTypeHTML = `<span class="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">Daily Report</span>`;
            } else if (record.checkIn.workType === "in_factory") {
                workTypeHTML = `<span class="inline-flex items-center rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-800">ในโรงงาน</span>`;
            } else {
                workTypeHTML = `<span class="inline-flex items-center rounded-full bg-teal-100 px-3 py-1 text-xs font-semibold text-teal-800">On-site: ${record.checkIn.onSiteDetails || "N/A"}</span>`;
            }

            historyHtml += `
            <div class="flex space-x-4">
                <div class="flex flex-col items-center">
                    <div class="flex-shrink-0 w-12 h-12 rounded-xl bg-sky-50 flex flex-col items-center justify-center leading-none">
                        <span class="text-xs text-sky-600 font-medium">${displayDate.toLocaleDateString("th-TH", { month: "short" })}</span>
                        <span class="text-xl font-bold text-sky-700">${displayDate.getDate()}</span>
                    </div>
                    <div class="flex-1 w-px bg-gray-200 my-2"></div> 
                </div>
                <div class="flex-1 card !p-4 !shadow-sm mb-4">
                    <div class="flex justify-between items-start">
                        <div>
                            <p class="font-semibold text-gray-800">${displayDate.toLocaleDateString("th-TH", { weekday: "long" })}</p>
                            <p class="text-sm text-gray-500 font-medium">
                                <span class="text-green-600">${checkinTimeStr}</span>
                                <span> → </span>
                                <span class="text-red-500">${checkoutTimeStr}</span>
                            </p>
                        </div>
                    </div>
                    <div class="flex flex-wrap gap-4 mt-3 pt-3 border-t border-gray-100 text-sm">
                        <div class="flex items-center gap-1.5" title="ชั่วโมงทำงานปกติ">
                            <svg class="w-5 h-5 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                            <span class="font-medium text-gray-700">${regularWorkHours.toFixed(2)} ชม.</span>
                        </div>
                        <div class="flex items-center gap-1.5" title="Overtime">
                            <svg class="w-5 h-5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>
                            <span class="font-medium text-gray-700">OT: ${overtimeHours.toFixed(1)} ชม.</span>
                        </div>
                    </div>
                    <div class="mt-3 pt-3 border-t border-gray-100 text-sm">
                        ${workTypeHTML}
                    </div>
                    <div class="mt-1 flex flex-wrap items-center gap-2">
                        ${hasReport
                            ? `<span class="inline-flex items-center rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-800">
                                ส่งรายงานแล้ว (${reportsArray.length} รายการ)
                               </span>`
                            : `<span class="inline-flex items-center rounded-full bg-yellow-100 px-3 py-1 text-xs font-semibold text-yellow-800">
                                ยังไม่ส่งรายงาน
                               </span>`
                        }
                    </div>
                </div>
            </div>`;
        });

        if (container) container.innerHTML = historyHtml;
        if (summaryHoursEl) summaryHoursEl.textContent = `${accumulatorRegularWorkHours.toFixed(2)}`;
        if (summaryOtEl) summaryOtEl.textContent = `${totalOtHoursSum.toFixed(1)}`;
        if (summaryDaysEl) summaryDaysEl.textContent = `${totalDays} วัน`;

    } catch (error) {
        console.error("Error loading work history:", error);
        if (container) container.innerHTML = `<p class="text-center text-red-500 text-sm py-4">เกิดข้อผิดพลาด: ${error.message}</p>`;
    }
}

// 2. โหลดประวัติการลา (Admin View)
export async function loadLeaveHistory() {
    const listContainer = document.getElementById("leave-history-list");
    if (!listContainer) return;

    const statusFilter = document.getElementById("leave-history-status-filter")?.value || "";
    const userFilter = document.getElementById("leave-history-user-filter")?.value || "";
    const typeFilter = document.getElementById("leave-history-type-filter")?.value || "";
    const startFilter = document.getElementById("leave-history-start-filter")?.value || "";
    const endFilter = document.getElementById("leave-history-end-filter")?.value || "";

    listContainer.innerHTML = `
        <div class="flex flex-col items-center py-12 text-gray-400">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-500 mb-2"></div>
            <p class="text-sm">กำลังค้นหาข้อมูล...</p>
        </div>
    `;

    try {
        let query = db.collection("leave_requests");

        if (statusFilter) query = query.where("status", "==", statusFilter);
        if (userFilter) query = query.where("userId", "==", userFilter);
        if (typeFilter) query = query.where("leaveType", "==", typeFilter);

        if (startFilter) {
            const start = new Date(startFilter);
            start.setHours(0, 0, 0, 0);
            query = query.where("startDate", ">=", firebase.firestore.Timestamp.fromDate(start));
        }

        // เรียงวันที่
        query = query.orderBy("startDate", "desc");
        const querySnapshot = await query.get();

        if (querySnapshot.empty) {
            listContainer.innerHTML = `
                <div class="text-center py-12 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
                    <p class="text-gray-400 text-sm">ไม่พบข้อมูลการลาที่ตรงตามเงื่อนไข</p>
                </div>
            `;
            return;
        }

        listContainer.innerHTML = "";
        let hasData = false;

        querySnapshot.forEach((doc) => {
            const leave = doc.data();

            // ตัวกรอง endDate ด้วย JavaScript (แก้บั๊ก Firebase)
            if (endFilter) {
                 const endLimit = new Date(endFilter);
                 endLimit.setHours(23, 59, 59, 999);
                 if (leave.startDate.toDate() > endLimit) return;
            }

            hasData = true;
            const startStr = leave.startDate ? leave.startDate.toDate().toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "numeric" }) : "-";
            const endStr = leave.endDate ? leave.endDate.toDate().toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "numeric" }) : "-";
            const submittedStr = leave.submittedAt ? leave.submittedAt.toDate().toLocaleDateString("th-TH", { day: "2-digit", month: "short" }) : "-";

            let statusConfig = {
                pending: { label: "รออนุมัติ", class: "bg-yellow-100 text-yellow-700" },
                approved: { label: "อนุมัติแล้ว", class: "bg-green-100 text-green-700" },
                rejected: { label: "ไม่อนุมัติ", class: "bg-red-100 text-red-700" },
            };
            const status = statusConfig[leave.status] || { label: leave.status, class: "bg-gray-100 text-gray-700" };

            const cardHTML = `
                <div class="bg-white p-4 rounded-xl border border-gray-200 shadow-sm mb-3">
                    <div class="flex justify-between items-start mb-3">
                        <div class="flex items-center gap-3">
                            <img src="${leave.userPhoto || 'https://placehold.co/100x100/E2E8F0/475569?text=User'}" class="w-10 h-10 rounded-full object-cover">
                            <div>
                                <h4 class="text-sm font-bold text-gray-800">${leave.userName || "ไม่ระบุชื่อ"}</h4>
                                <p class="text-[10px] text-gray-400">ยื่นเมื่อ: ${submittedStr}</p>
                            </div>
                        </div>
                        <span class="text-[10px] px-2.5 py-1 rounded-full font-bold ${status.class}">
                            ${status.label}
                        </span>
                    </div>
                    <div class="bg-gray-50 p-3 rounded-lg border border-gray-100">
                        <p class="text-xs font-bold text-sky-700">${LEAVE_TYPE_MAP[leave.leaveType] || leave.leaveType}</p>
                        <p class="text-xs text-gray-600">
                            📅 ${leave.durationType === "hourly" ? `${startStr} (${leave.startTime}-${leave.endTime})` : `${startStr} ถึง ${endStr}`}
                        </p>
                    </div>
                </div>
            `;
            listContainer.innerHTML += cardHTML;
        });

        if(!hasData) {
            listContainer.innerHTML = `<div class="text-center py-12 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200"><p class="text-gray-400 text-sm">ไม่พบข้อมูลการลาที่ตรงตามเงื่อนไข</p></div>`;
        }
    } catch (error) {
        console.error("Error:", error);
        listContainer.innerHTML = `<p class="text-red-500 text-xs text-center py-10">Error: ${error.message}</p>`;
    }
}

// 3. โหลดประวัติ OT (Admin View)
export async function loadOtHistory() {
    const listContainer = document.getElementById("ot-history-list");
    if (!listContainer) return;

    listContainer.innerHTML = '<div class="py-10 text-center text-gray-400 text-sm"><span class="inline-block animate-spin rounded-full h-5 w-5 border-b-2 border-gray-400 mr-2"></span>กำลังค้นหาข้อมูล...</div>';

    const statusFilter = document.getElementById("ot-history-status-filter")?.value || "";
    const userFilter = document.getElementById("ot-history-user-filter")?.value || "";

    try {
        let query = db.collection("ot_requests");
        if (statusFilter) query = query.where("status", "==", statusFilter);
        if (userFilter) query = query.where("userId", "==", userFilter);

        const querySnapshot = await query.get();

        if (querySnapshot.empty) {
            listContainer.innerHTML = `
                <div class="text-center py-8 bg-white rounded-xl border border-dashed border-gray-300">
                    <p class="text-gray-400 text-sm">ไม่พบประวัติ OT ตามเงื่อนไข</p>
                </div>`;
            return;
        }

        listContainer.innerHTML = "";
        querySnapshot.forEach((doc) => {
            const ot = doc.data();
            const otDate = ot.date.toDate().toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });

            let durationText = "";
            if (ot.startTime && ot.endTime) {
                const [h1, m1] = ot.startTime.split(":").map(Number);
                const [h2, m2] = ot.endTime.split(":").map(Number);
                const totalMins = h2 * 60 + m2 - (h1 * 60 + m1);
                const hours = Math.floor(totalMins / 30) * 0.5;
                durationText = `${hours.toFixed(1)} ชม.`;
            }

            let statusBadge = "";
            let borderColor = "border-gray-200";

            if (ot.status === "approved") {
                statusBadge = `<span class="px-2 py-0.5 rounded-md bg-green-50 text-green-700 text-[10px] font-bold border border-green-100 flex items-center gap-1">อนุมัติ</span>`;
                borderColor = "border-green-200";
            } else if (ot.status === "rejected") {
                statusBadge = `<span class="px-2 py-0.5 rounded-md bg-red-50 text-red-700 text-[10px] font-bold border border-red-100">ไม่อนุมัติ</span>`;
                borderColor = "border-red-200";
            } else {
                statusBadge = `<span class="px-2 py-0.5 rounded-md bg-yellow-50 text-yellow-700 text-[10px] font-bold border border-yellow-100">รออนุมัติ</span>`;
                borderColor = "border-yellow-200";
            }

            const cardHTML = `
            <div class="bg-white p-3 rounded-xl border ${borderColor} shadow-sm hover:shadow-md transition-all">
                <div class="flex justify-between items-start mb-2">
                    <div class="flex items-center gap-2">
                        <img src="${ot.userPhoto || 'https://placehold.co/100x100/E2E8F0/475569?text=User'}" class="w-8 h-8 rounded-full object-cover border border-gray-100">
                        <div>
                            <p class="text-sm font-bold text-gray-800 leading-tight">${ot.userName}</p>
                            <p class="text-[10px] text-gray-400">วันที่: ${otDate}</p>
                        </div>
                    </div>
                    ${statusBadge}
                </div>
                
                <div class="bg-orange-50/50 rounded-lg p-2 mb-2 border border-orange-100">
                    <div class="flex justify-between text-xs mb-1">
                        <span class="text-gray-500 font-medium">เวลาขอ:</span>
                        <span class="text-gray-700 font-bold">${ot.startTime} - ${ot.endTime}</span>
                    </div>
                    <div class="flex justify-between text-xs">
                        <span class="text-gray-500 font-medium">จำนวน:</span>
                        <span class="text-orange-600 font-bold">${durationText}</span>
                    </div>
                </div>

                <div class="flex justify-between items-end">
                    <p class="text-xs text-gray-500 italic max-w-[70%] truncate">"${ot.reason || "-"}"</p>
                    ${ot.approvedBy ? `<p class="text-[10px] text-gray-400">โดย: ${ot.approvedBy}</p>` : ""}
                </div>
            </div>`;
            listContainer.innerHTML += cardHTML;
        });
    } catch (error) {
        console.error("OT History Error:", error);
        listContainer.innerHTML = '<div class="text-center text-red-400 py-4 text-xs">เกิดข้อผิดพลาดในการโหลด</div>';
    }
}

// 4. สรุปสถิติเวลาทำงาน (Timesheet Summary - หน้า Admin)
export async function loadTimesheetSummary() {
    const userId = document.getElementById("summary-stat-user-select")?.value;
    const year = parseInt(document.getElementById("summary-stat-year-select")?.value);
    const container = document.getElementById("summary-stat-results");

    if (!userId || !year || !container) return;

    container.innerHTML = `<div class="flex justify-center py-20"><div class="animate-spin rounded-full h-10 w-10 border-b-2 border-sky-500"></div></div>`;

    const startOfYear = new Date(year, 0, 1);
    const endOfYear = new Date(year, 11, 31, 23, 59, 59);

    try {
        const recordsSnap = await db.collection("work_records")
            .where("userId", "==", userId)
            .where("date", ">=", startOfYear)
            .where("date", "<=", endOfYear)
            .get();

        const leavesSnap = await db.collection("leave_requests")
            .where("userId", "==", userId)
            .where("status", "==", "approved")
            .where("startDate", ">=", firebase.firestore.Timestamp.fromDate(startOfYear))
            .get();

        let stats = { late: 0, ot: 0, sick: 0, annual: 0, absent: 0 };

        recordsSnap.forEach((doc) => {
            const data = doc.data();
            if (data.checkIn && data.checkIn.timestamp) {
                const cin = data.checkIn.timestamp.toDate();
                if (cin.getHours() > 8 || (cin.getHours() === 8 && cin.getMinutes() > 30)) {
                    stats.late++;
                }
            }
            if (data.overtime && typeof data.overtime.hours === "number") {
                stats.ot += data.overtime.hours;
            }
        });

        leavesSnap.forEach((doc) => {
            const data = doc.data();
            if (data.endDate.toDate() < startOfYear) return; // กรองด้วย JS
            if (data.leaveType === "sick") stats.sick++;
            else stats.annual++;
        });

        container.innerHTML = `
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div class="p-4 bg-orange-50 border border-orange-100 rounded-2xl text-center">
                    <p class="text-[10px] font-bold text-orange-400 uppercase tracking-wider">มาสาย (Late)</p>
                    <p class="text-3xl font-bold text-orange-600 mt-1">${stats.late}</p>
                    <p class="text-[10px] text-orange-400 mt-1">ครั้งในปีนี้</p>
                </div>
                <div class="p-4 bg-blue-50 border border-blue-100 rounded-2xl text-center">
                    <p class="text-[10px] font-bold text-blue-400 uppercase tracking-wider">OT สะสม</p>
                    <p class="text-3xl font-bold text-blue-600 mt-1">${stats.ot.toFixed(1)}</p>
                    <p class="text-[10px] text-blue-400 mt-1">ชั่วโมงรวม</p>
                </div>
                <div class="p-4 bg-red-50 border border-red-100 rounded-2xl text-center">
                    <p class="text-[10px] font-bold text-red-400 uppercase tracking-wider">ลาป่วย (Sick)</p>
                    <p class="text-3xl font-bold text-red-600 mt-1">${stats.sick}</p>
                    <p class="text-[10px] text-red-400 mt-1">วัน/ปี</p>
                </div>
                <div class="p-4 bg-green-50 border border-green-100 rounded-2xl text-center">
                    <p class="text-[10px] font-bold text-green-400 uppercase tracking-wider">ลากิจ/พักร้อน</p>
                    <p class="text-3xl font-bold text-green-600 mt-1">${stats.annual}</p>
                    <p class="text-[10px] text-green-400 mt-1">วัน/ปี</p>
                </div>
            </div>
        `;
    } catch (e) {
        container.innerHTML = `<p class="text-center text-red-500">เกิดข้อผิดพลาด: ${e.message}</p>`;
    }
}