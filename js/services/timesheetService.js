// ไฟล์: public/js/services/timesheetService.js
import { db } from '../config/firebase-config.js';
import { calculateWorkHours } from '../utils/dateHelper.js';

const LEAVE_TYPE_MAP = {
    annual: "ลาพักร้อน",
    sick: "ลาป่วย",
    personal: "ลากิจ",
    maternity: "ลาคลอด"
};

// ==========================================
// 1. Timeline Data (ตารางเวลาแบบเส้น)
// ==========================================
export async function loadTimelineData() {
    const timelineContainer = document.getElementById("timeline-list-container");
    const timelineDatePicker = document.getElementById("timeline-date-picker");
    if (!timelineContainer || !timelineDatePicker) return;

    timelineContainer.innerHTML = '<div class="flex justify-center py-8"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-500"></div></div>';

    const selectedDateStr = timelineDatePicker.value;
    const selectedDate = new Date(selectedDateStr);
    selectedDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(selectedDate);
    nextDay.setDate(selectedDate.getDate() + 1);

    try {
        const [usersSnapshot, recordsSnapshot] = await Promise.all([
            db.collection("users").orderBy("fullName").get(),
            db.collection("work_records").where("date", ">=", selectedDate).where("date", "<", nextDay).get()
        ]);

        const recordsMap = {};
        recordsSnapshot.forEach(doc => recordsMap[doc.data().userId] = doc.data());

        let html = "";
        if (usersSnapshot.empty) {
            timelineContainer.innerHTML = '<p class="text-center text-gray-400">ไม่พบข้อมูลพนักงาน</p>';
            return;
        }

        usersSnapshot.forEach(doc => {
            const user = doc.data();
            const record = recordsMap[doc.id];

            let checkInTime = "--:--", checkOutTime = "--:--";
            let statusBadge = '<span class="px-2 py-1 rounded bg-gray-100 text-gray-500 text-xs">Absent</span>';
            let checkInColor = "text-gray-300", checkOutColor = "text-gray-300", locationIcon = "";

            if (record) {
                const cin = record.checkIn.timestamp.toDate();
                checkInTime = cin.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
                checkInColor = "text-blue-500";

                const lateThreshold = new Date(cin);
                lateThreshold.setHours(8, 30, 0, 0);
                statusBadge = cin > lateThreshold 
                    ? '<span class="px-2 py-1 rounded bg-orange-100 text-orange-600 text-xs font-bold">Late</span>'
                    : '<span class="px-2 py-1 rounded bg-green-100 text-green-600 text-xs font-bold">On Time</span>';

                if (record.checkOut) {
                    checkOutTime = record.checkOut.timestamp.toDate().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
                    checkOutColor = "text-pink-500";
                }

                locationIcon = record.checkIn.workType === "in_factory"
                    ? `<div class="tooltip" title="Factory (GPS)"><svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg></div>`
                    : `<div class="tooltip" title="On-Site"><svg class="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg></div>`;
            }

            html += `
            <div class="bg-white p-4 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow flex items-center justify-between">
                <div class="flex flex-col items-center w-16 border-r border-gray-100 pr-4">
                    <svg class="w-5 h-5 ${checkInColor} mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    <span class="text-sm font-bold text-gray-700">${checkInTime}</span>
                    <span class="text-[10px] text-gray-400">IN</span>
                </div>
                <div class="flex-1 flex items-center gap-3 pl-4">
                    <img src="${user.profileImageUrl || "https://placehold.co/100x100/E2E8F0/475569?text=User"}" class="w-10 h-10 rounded-full object-cover border border-gray-200">
                    <div>
                        <p class="font-bold text-gray-800 text-sm">${user.fullName || "Unknown"}</p>
                        <p class="text-xs text-gray-500">${user.department || "Employee"}</p>
                    </div>
                </div>
                <div class="flex items-center gap-4">
                    <div class="hidden sm:block">${statusBadge}</div>
                    ${locationIcon}
                    <div class="flex flex-col items-center w-16 border-l border-gray-100 pl-4">
                        <svg class="w-5 h-5 ${checkOutColor} mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
                        <span class="text-sm font-bold text-gray-700">${checkOutTime}</span>
                        <span class="text-[10px] text-gray-400">OUT</span>
                    </div>
                </div>
            </div>`;
        });
        timelineContainer.innerHTML = html;
    } catch (error) {
        console.error("Error loading timeline:", error);
        timelineContainer.innerHTML = '<p class="text-center text-red-500">เกิดข้อผิดพลาดในการโหลดข้อมูล</p>';
    }
}

// ==========================================
// 2. Timesheet Table (ตารางสรุปเวลาเข้า-ออก)
// ==========================================
export async function loadTimesheetTable() {
    const tbody = document.getElementById("ts-table-body");
    const recordCount = document.getElementById("ts-record-count");
    const startDateStr = document.getElementById("ts-filter-start")?.value;
    const endDateStr = document.getElementById("ts-filter-end")?.value;
    const searchTerm = document.getElementById("ts-search-input")?.value.toLowerCase();

    if (!tbody || !startDateStr || !endDateStr) return;

    tbody.innerHTML = '<tr><td colspan="8" class="px-6 py-8 text-center text-gray-400">กำลังโหลดข้อมูล...</td></tr>';

    try {
        const startDate = new Date(startDateStr); startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(endDateStr); endDate.setHours(23, 59, 59, 999);

        const [usersSnapshot, recordsSnapshot] = await Promise.all([
            db.collection("users").get(),
            db.collection("work_records").where("date", ">=", startDate).where("date", "<=", endDate).orderBy("date", "desc").get()
        ]);

        const usersMap = {};
        usersSnapshot.forEach(doc => usersMap[doc.id] = doc.data());

        let html = "", count = 0;
        if (recordsSnapshot.empty) {
            tbody.innerHTML = '<tr><td colspan="8" class="px-6 py-8 text-center text-gray-400">ไม่พบข้อมูลในช่วงเวลานี้</td></tr>';
            if (recordCount) recordCount.textContent = `แสดง 0 รายการ`;
            return;
        }

        recordsSnapshot.forEach(doc => {
            const record = doc.data();
            const user = usersMap[record.userId];
            const userName = user ? user.fullName : "Unknown User";

            if (searchTerm && !userName.toLowerCase().includes(searchTerm)) return;
            count++;

            const dateObj = record.date.toDate();
            const dateStr = dateObj.toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "2-digit" });
            const dayName = dateObj.toLocaleDateString("th-TH", { weekday: "short" });

            const checkInTime = record.checkIn.timestamp.toDate().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
            let checkOutTime = "-", workHours = "-", otHours = "-", statusBadge = "", rowClass = "hover:bg-gray-50 border-b border-gray-100";

            const lateThreshold = new Date(record.checkIn.timestamp.toDate());
            lateThreshold.setHours(8, 30, 0, 0);
            const isLate = record.checkIn.timestamp.toDate() > lateThreshold;

            if (record.status === "completed" && record.checkOut) {
                checkOutTime = record.checkOut.timestamp.toDate().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
                const calcs = calculateWorkHours(record.checkIn.timestamp.toDate(), record.checkOut.timestamp.toDate());
                workHours = calcs.regularWorkHours.toFixed(2);
                let otVal = (record.overtime && record.overtime.hours > 0) ? record.overtime.hours : calcs.overtimeHours;
                otHours = otVal > 0 ? `<span class="text-orange-600 font-bold">${otVal.toFixed(1)}</span>` : "-";
                statusBadge = isLate 
                    ? `<span class="px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">สาย</span>` 
                    : `<span class="px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">ปกติ</span>`;
            } else {
                statusBadge = `<span class="px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">กำลังทำงาน</span>`;
                if (new Date().getDate() !== dateObj.getDate() && record.status === "checked_in") {
                    statusBadge = `<span class="px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">Missing Out</span>`;
                    rowClass = "bg-red-50 hover:bg-red-100 border-b border-red-100";
                }
            }

            html += `<tr class="${rowClass}">
                <td class="px-6 py-4 whitespace-nowrap"><div class="flex items-center"><img class="h-8 w-8 rounded-full object-cover" src="${user?.profileImageUrl || "https://placehold.co/100x100"}"><div class="ml-4"><div class="text-sm font-medium text-gray-900">${userName}</div><div class="text-xs text-gray-500">${user?.department || "N/A"}</div></div></div></td>
                <td class="px-6 py-4 whitespace-nowrap"><div class="text-sm text-gray-900">${dateStr}</div><div class="text-xs text-gray-500">${dayName}</div></td>
                <td class="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-500">08:30 - 17:30</td>
                <td class="px-6 py-4 whitespace-nowrap text-center text-sm ${isLate ? "text-red-600 font-semibold" : "text-gray-900"}">${checkInTime}</td>
                <td class="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-900">${checkOutTime}</td>
                <td class="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-900 font-medium">${workHours}</td>
                <td class="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-500">${otHours}</td>
                <td class="px-6 py-4 whitespace-nowrap text-center">${statusBadge}</td>
            </tr>`;
        });
        tbody.innerHTML = html;
        if (recordCount) recordCount.textContent = `แสดง ${count} รายการ`;
    } catch (error) {
        console.error("Error loading timesheet table:", error);
        tbody.innerHTML = '<tr><td colspan="8" class="px-6 py-8 text-center text-red-500">เกิดข้อผิดพลาดในการโหลดข้อมูล</td></tr>';
    }
}

// ==========================================
// 3. Employee Summary (สรุปพนักงาน & Export)
// ==========================================
export async function loadEmployeeSummary(page = 1) {
    const container = document.getElementById("employee-summary-container-admin");
    const paginationControls = document.getElementById("summary-pagination-controls");
    const startDateString = document.getElementById("summary-start-date")?.value;
    const endDateString = document.getElementById("summary-end-date")?.value;
    const userIdFilter = document.getElementById("summary-employee-select")?.value;
    const statusFilter = document.getElementById("summary-status-filter")?.value;

    if (!container || !paginationControls) return;
    if (!startDateString || !endDateString) {
        container.innerHTML = '<p class="text-sm text-center text-red-500 py-4">กรุณาเลือกวันที่เริ่มต้นและสิ้นสุด</p>';
        return;
    }

    container.innerHTML = '<p class="text-sm text-center text-gray-500 py-2">กำลังโหลดข้อมูลพนักงาน...</p>';
    paginationControls.innerHTML = "";

    const startDate = new Date(startDateString); startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(endDateString); endDate.setHours(23, 59, 59, 999);
    const ITEMS_PER_PAGE = 20; let currentPage = page;

    try {
        const usersSnapshot = await db.collection("users").orderBy("fullName").get();
        if (usersSnapshot.empty) { container.innerHTML = '<p class="text-sm text-center text-gray-500 py-2">ไม่พบข้อมูลผู้ใช้ในระบบ</p>'; return; }

        let allUsersData = {};
        usersSnapshot.forEach(doc => {
            if (!userIdFilter || doc.id === userIdFilter) allUsersData[doc.id] = { ...doc.data(), workRecords: [] };
        });

        let workRecordsQuery = db.collection("work_records").where("date", ">=", startDate).where("date", "<=", endDate).orderBy("date", "desc");
        if (statusFilter && statusFilter !== "not_checked_in") workRecordsQuery = workRecordsQuery.where("status", "==", statusFilter);
        
        const recordsSnapshot = await workRecordsQuery.get();
        recordsSnapshot.forEach(doc => {
            const record = doc.data();
            if (allUsersData[record.userId]) allUsersData[record.userId].workRecords.push(record);
        });

        let filteredUserIds = Object.keys(allUsersData);
        if (statusFilter === "not_checked_in") filteredUserIds = filteredUserIds.filter(id => allUsersData[id].workRecords.length === 0);
        else if (statusFilter) filteredUserIds = filteredUserIds.filter(id => allUsersData[id].workRecords.length > 0);

        const totalItems = filteredUserIds.length;
        const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE) || 1;
        if (currentPage > totalPages) currentPage = totalPages;
        if (currentPage < 1) currentPage = 1;

        const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
        const userIdsToShow = filteredUserIds.slice(startIndex, startIndex + ITEMS_PER_PAGE);

        let resultsHTML = "";
        if (userIdsToShow.length === 0) {
            resultsHTML = `<p class="text-sm text-center text-gray-500 py-4">ไม่พบข้อมูลตามเงื่อนไขที่เลือก</p>`;
        } else {
            userIdsToShow.forEach(userId => {
                const user = allUsersData[userId];
                const latestRecord = user.workRecords[0] || null;
                const report = latestRecord?.reports?.[0] || latestRecord?.report;

                let statusText = "ยังไม่เข้างาน", statusColor = "bg-gray-400";
                let checkInTime = "-", checkOutTime = "-", workHours = "-", overtime = "-", workTypeInfo = "-", reportInfo = '<span class="text-gray-400">ยังไม่ส่งรายงาน</span>', recordDate = "ไม่มีข้อมูลในช่วงนี้";

                if (latestRecord) {
                    recordDate = latestRecord.date.toDate().toLocaleDateString("th-TH");
                    checkInTime = latestRecord.checkIn.timestamp.toDate().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
                    workTypeInfo = latestRecord.checkIn.workType === "in_factory" ? "ในโรงงาน" : `On-site: ${latestRecord.checkIn.onSiteDetails || "N/A"}`;
                    if (report) reportInfo = `${report.workType} (${report.project || "N/A"})`;

                    if (latestRecord.status === "checked_in") { statusText = "กำลังทำงาน"; statusColor = "bg-green-500"; } 
                    else if (latestRecord.status === "completed") {
                        statusText = "สิ้นสุดการทำงาน"; statusColor = "bg-red-500";
                        if (latestRecord.checkOut) {
                            checkOutTime = latestRecord.checkOut.timestamp.toDate().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
                            const { regularWorkHours, overtimeHours: calcOt } = calculateWorkHours(latestRecord.checkIn.timestamp.toDate(), latestRecord.checkOut.timestamp.toDate());
                            workHours = regularWorkHours.toFixed(2) + " ชม.";
                            overtime = ((latestRecord.overtime && typeof latestRecord.overtime.hours === "number") ? latestRecord.overtime.hours : calcOt).toFixed(1) + " ชม.";
                        }
                    }
                }

                resultsHTML += `
                <div class="p-4 bg-white rounded-xl border border-gray-200 shadow-sm">
                    <div class="flex items-center gap-3">
                        <img src="${user.profileImageUrl || "https://placehold.co/100x100"}" class="w-12 h-12 rounded-full object-cover">
                        <div>
                            <p class="font-semibold text-gray-800">${user.fullName || "ไม่มีชื่อ"}</p>
                            <div class="flex items-center gap-1.5 mt-1">
                                <div class="w-2.5 h-2.5 rounded-full ${statusColor}"></div><p class="text-xs font-medium text-gray-600">${statusText} (${recordDate})</p>
                            </div>
                        </div>
                    </div>
                    <div class="mt-3 pt-3 border-t border-gray-100 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        <div><span class="text-gray-500">เข้า:</span> <span class="font-semibold text-green-600">${checkInTime}</span></div>
                        <div><span class="text-gray-500">ออก:</span> <span class="font-semibold text-red-500">${checkOutTime}</span></div>
                        <div><span class="text-gray-500">รวม:</span> <span class="font-medium text-gray-700">${workHours}</span></div>
                        <div><span class="text-gray-500">OT:</span> <span class="font-medium text-gray-700">${overtime}</span></div>
                        <div class="col-span-2 mt-1"><span class="text-gray-500">รายงาน:</span> <span class="font-medium text-gray-700">${reportInfo}</span></div>
                    </div>
                </div>`;
            });
        }
        container.innerHTML = resultsHTML;

        // Pagination UI
        if (totalPages > 1) {
            const prevBtn = document.createElement("button");
            prevBtn.textContent = "◀"; prevBtn.className = `px-3 py-1 text-sm rounded ${currentPage === 1 ? "bg-gray-200 text-gray-400" : "bg-sky-500 text-white hover:bg-sky-600"}`;
            prevBtn.disabled = currentPage === 1; prevBtn.onclick = () => loadEmployeeSummary(currentPage - 1);
            paginationControls.appendChild(prevBtn);

            const pageInfo = document.createElement("span"); pageInfo.textContent = `หน้า ${currentPage} / ${totalPages}`; pageInfo.className = "text-sm text-gray-600 mx-2";
            paginationControls.appendChild(pageInfo);

            const nextBtn = document.createElement("button");
            nextBtn.textContent = "▶"; nextBtn.className = `px-3 py-1 text-sm rounded ${currentPage === totalPages ? "bg-gray-200 text-gray-400" : "bg-sky-500 text-white hover:bg-sky-600"}`;
            nextBtn.disabled = currentPage === totalPages; nextBtn.onclick = () => loadEmployeeSummary(currentPage + 1);
            paginationControls.appendChild(nextBtn);
        }
    } catch (error) {
        console.error("Error loading employee summary:", error);
        container.innerHTML = '<p class="text-sm text-center text-red-500 py-2">เกิดข้อผิดพลาดในการโหลดข้อมูล</p>';
    }
}

export async function exportEmployeeSummaryToExcel() {
    const startDateString = document.getElementById("summary-start-date")?.value;
    const endDateString = document.getElementById("summary-end-date")?.value;
    const userIdFilter = document.getElementById("summary-employee-select")?.value;

    if (!startDateString || !endDateString) return alert("กรุณาเลือกช่วงวันที่ก่อน Export");

    try {
        const startDate = new Date(startDateString); startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(endDateString); endDate.setHours(23, 59, 59, 999);

        // ดึงวันหยุดและใบลา
        const holidayMap = new Map(), workingSaturdayMap = new Map(), approvedLeaveMap = new Map();
        try {
            const calendarDoc = await db.collection("system_settings").doc("calendar_rules").get();
            if (calendarDoc.exists) {
                (calendarDoc.data().holidays || []).forEach(d => holidayMap.set(d, true));
                (calendarDoc.data().workingSaturdays || []).forEach(d => workingSaturdayMap.set(d, true));
            }
            const leaveSnap = await db.collection("leave_requests").where("status", "==", "approved").where("startDate", "<=", endDate).get();
            leaveSnap.forEach(doc => {
                const leave = doc.data();
                if (leave.endDate.toDate() < startDate) return;
                const typeDisplay = LEAVE_TYPE_MAP[leave.leaveType] || leave.leaveType;
                
                if (leave.durationType === "hourly") {
                    const key = `${leave.userId}_${leave.startDate.toDate().toISOString().split("T")[0]}`;
                    approvedLeaveMap.set(key, { type: typeDisplay, durationType: "hourly", startTime: leave.startTime, endTime: leave.endTime });
                } else {
                    let cur = new Date(leave.startDate.toDate().setHours(0,0,0,0));
                    const final = new Date(leave.endDate.toDate().setHours(0,0,0,0));
                    while (cur <= final) {
                        const dateKey = cur.toISOString().split("T")[0];
                        approvedLeaveMap.set(`${leave.userId}_${dateKey}`, { type: typeDisplay, durationType: "full_day" });
                        cur.setDate(cur.getDate() + 1);
                    }
                }
            });
        } catch (e) { console.warn("Could not load rules/leaves:", e); }

        const usersSnap = await db.collection("users").orderBy("fullName").get();
        let filteredUsers = [];
        usersSnap.forEach(doc => { if (!userIdFilter || doc.id === userIdFilter) filteredUsers.push({ id: doc.id, fullName: doc.data().fullName || doc.id, department: doc.data().department || "-" }); });

        if (filteredUsers.length === 0) return alert("ไม่พบข้อมูลพนักงาน");

        const recordsSnap = await db.collection("work_records").where("date", ">=", startDate).where("date", "<=", endDate).get();
        const recordsMap = new Map();
        recordsSnap.forEach(doc => {
            const record = doc.data(), dateStr = doc.id.split("_")[1], userId = record.userId;
            if (!recordsMap.has(userId)) recordsMap.set(userId, new Map());
            recordsMap.get(userId).set(dateStr, record);
        });

        const dataForExcel = [["ชื่อพนักงาน", "แผนก", "วันที่", "ประเภทวัน", "สถานะ", "เวลาเข้า", "เวลาออก", "ชั่วโมงปกติ", "ชั่วโมง OT", "รายละเอียด On-site", "Google Map Link", "รายงาน: ประเภท", "รายงาน: โครงการ", "รายงาน: ระยะเวลา"]];

        for (let day = new Date(startDate); day <= endDate; day.setDate(day.getDate() + 1)) {
            const dateKey = day.toISOString().split("T")[0];
            const dayOfWeek = day.getDay();
            
            let dayType = "วันทำงาน";
            if (holidayMap.has(dateKey)) dayType = "วันหยุดนักขัตฤกษ์";
            else if (dayOfWeek === 0) dayType = "วันอาทิตย์";
            else if (dayOfWeek === 6 && !workingSaturdayMap.has(dateKey)) dayType = "วันเสาร์ (หยุด)";
            else if (dayOfWeek === 6 && workingSaturdayMap.has(dateKey)) dayType = "วันเสาร์ (ทำงาน)";

            for (const user of filteredUsers) {
                const record = recordsMap.get(user.id)?.get(dateKey) || null;
                const approvedLeave = approvedLeaveMap.get(`${user.id}_${dateKey}`);
                
                let statusText = "", checkInTime = "-", checkOutTime = "-", regularWorkHours = 0, overtimeHours = 0;
                let workTypeInfo = "-", onSiteDetails = "-", googleMapLink = "-", reportType = "-", reportProject = "-", reportDuration = "-";

                if (record) {
                    const report = record.reports?.[0] || record.report || {};
                    const checkinDate = record.checkIn.timestamp.toDate();
                    checkInTime = checkinDate.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
                    workTypeInfo = record.checkIn.workType === "in_factory" ? "ในโรงงาน" : "On-site";
                    onSiteDetails = record.checkIn.onSiteDetails || "-";
                    googleMapLink = record.checkIn.googleMapLink || "-";
                    reportType = report.workType || "-"; reportProject = report.project || "-"; reportDuration = report.duration || "-";

                    if (record.status === "checked_in") statusText = "กำลังทำงาน";
                    else if (record.status === "completed" && record.checkOut) {
                        statusText = "สิ้นสุดการทำงาน";
                        const checkoutDate = record.checkOut.timestamp.toDate();
                        checkOutTime = checkoutDate.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
                        const hours = calculateWorkHours(checkinDate, checkoutDate);
                        regularWorkHours = hours.regularWorkHours;
                        overtimeHours = (record.overtime && typeof record.overtime.hours === "number" && record.overtime.hours > 0) ? record.overtime.hours : hours.overtimeHours;
                    }

                    const checkInMinutes = checkinDate.getHours() * 60 + checkinDate.getMinutes();
                    if (dayType === "วันทำงาน" && checkInMinutes > (8 * 60 + 30)) {
                        statusText = "มาสาย";
                        if (approvedLeave && approvedLeave.durationType === "hourly") {
                            const [eh, em] = approvedLeave.endTime.split(":").map(Number);
                            if (checkInMinutes >= eh * 60 + em) statusText = `ลา: ${approvedLeave.type} (ชม.)`;
                        }
                    }
                } else {
                    if (approvedLeave) {
                        let leaveText = approvedLeave.type.replace(/\s*\(.*\)\s*/g, "");
                        if (approvedLeave.durationType === "hourly") leaveText += ` (${approvedLeave.startTime} - ${approvedLeave.endTime})`;
                        statusText = `ลา: ${leaveText}`;
                    } else if (dayType === "วันทำงาน" || dayType === "วันเสาร์ (ทำงาน)") statusText = "ไม่ได้ลงเวลา";
                    else statusText = "วันหยุด";
                }

                dataForExcel.push([user.fullName, user.department, day.toLocaleDateString("th-TH", { day: "2-digit", month: "2-digit", year: "numeric" }), dayType, statusText, checkInTime, checkOutTime, regularWorkHours.toFixed(2), overtimeHours.toFixed(1), workTypeInfo, onSiteDetails, googleMapLink, reportType, reportProject, reportDuration]);
            }
        }

        if (dataForExcel.length <= 1) return alert("ไม่พบข้อมูลที่จะ Export ตามเงื่อนไขที่เลือก");
        const ws = XLSX.utils.aoa_to_sheet(dataForExcel);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "สรุปเวลาทำงาน");
        XLSX.writeFile(wb, `สรุปเวลาทำงาน_${startDateString}_ถึง_${endDateString}.xlsx`);
    } catch (error) {
        console.error("Error exporting excel:", error);
        alert("เกิดข้อผิดพลาด: " + error.message);
    }
}

// ==========================================
// 4. Project Summary (สรุปรายโปรเจกต์)
// ==========================================
export async function populateProjectOptions() {
    const projectSelect = document.getElementById("project-summary-select");
    if (!projectSelect) return;
    try {
        const doc = await db.collection("system_settings").doc("projects").get();
        projectSelect.innerHTML = '<option value="">Select Project...</option>';
        if (doc.exists) {
            (doc.data().names || []).forEach(name => {
                const option = document.createElement("option"); option.value = name; option.textContent = name;
                projectSelect.appendChild(option);
            });
        }
    } catch (error) { console.error("Error populating project summary dropdown:", error); }
}

export async function fetchProjectData() {
    const projectSelect = document.getElementById("project-summary-select");
    const monthInput = document.getElementById("project-summary-month");
    const resultsContainer = document.getElementById("project-summary-results");
    
    if (!projectSelect || !monthInput || !resultsContainer) return;
    const selectedProject = projectSelect.value, selectedMonth = monthInput.value;

    if (!selectedProject || !selectedMonth) { resultsContainer.innerHTML = '<p class="text-sm text-center text-gray-400 py-2">กรุณาเลือกเดือนและโครงการ</p>'; return; }
    resultsContainer.innerHTML = '<p class="text-sm text-center text-gray-500 py-2">กำลังค้นหาข้อมูล...</p>';

    const [yearNum, monthNum] = selectedMonth.split("-").map(Number);
    const startDate = new Date(yearNum, monthNum - 1, 1), endDate = new Date(yearNum, monthNum, 0, 23, 59, 59, 999);

    try {
        const querySnapshot = await db.collection("work_records").where("date", ">=", startDate).where("date", "<=", endDate).get();
        if (querySnapshot.empty) { resultsContainer.innerHTML = '<p class="text-sm text-center text-gray-500 py-2">ไม่พบข้อมูลในเดือนนี้</p>'; return; }

        const usersSnapshot = await db.collection("users").get();
        const usersMap = {}; usersSnapshot.forEach(doc => usersMap[doc.id] = doc.data().fullName);

        let resultsHTML = `<div class="flex justify-between items-center mb-3"><h4 class="font-semibold text-gray-800">Showing results for : ${selectedProject}</h4></div><div class="space-y-3">`;
        let matchCount = 0;

        querySnapshot.forEach(doc => {
            const record = doc.data(), reports = record.reports || (record.report ? [record.report] : []);
            const matchingReports = reports.filter(r => r.project === selectedProject);

            if (matchingReports.length > 0) {
                const reportDate = record.date.toDate().toLocaleDateString("th-TH", { day: "2-digit", month: "long", year: "numeric" });
                const userName = usersMap[record.userId] || record.userId;
                matchingReports.forEach(report => {
                    matchCount++;
                    resultsHTML += `<div class="p-4 bg-white rounded-xl border border-gray-200 shadow-sm"><div class="flex justify-between items-center"><p class="font-semibold text-gray-800">${userName}</p><p class="text-[10px] text-gray-400 font-bold uppercase">${reportDate}</p></div><div class="mt-3 flex flex-wrap gap-2"><span class="bg-sky-50 text-sky-700 text-xs px-2.5 py-1 rounded-lg font-bold border border-sky-100">${report.workType}</span><span class="bg-gray-50 text-gray-600 text-xs px-2.5 py-1 rounded-lg font-medium border border-gray-100">เวลา: ${report.duration}</span></div></div>`;
                });
            }
        });

        resultsContainer.innerHTML = matchCount === 0 ? '<p class="text-sm text-center text-gray-500 py-2">ไม่พบข้อมูลโปรเจกต์ที่เลือกในเดือนนี้</p>' : resultsHTML + "</div>";
    } catch (error) { console.error("Error:", error); resultsContainer.innerHTML = '<p class="text-sm text-center text-red-500 py-2">เกิดข้อผิดพลาดในการโหลดข้อมูล</p>'; }
}

export async function exportProjectSummaryToExcelData() {
    const projectSelect = document.getElementById("project-summary-select"), monthInput = document.getElementById("project-summary-month");
    const selectedProject = projectSelect?.value, selectedMonth = monthInput?.value;

    if (!selectedProject || !selectedMonth) return alert("กรุณาเลือกเดือนและโครงการก่อน Export");

    try {
        const [year, month] = selectedMonth.split("-").map(Number);
        const startDate = new Date(year, month - 1, 1), endDate = new Date(year, month, 0, 23, 59, 59, 999);

        const [usersSnap, recordsSnap] = await Promise.all([
            db.collection("users").get(),
            db.collection("work_records").where("date", ">=", startDate).where("date", "<=", endDate).get()
        ]);

        const usersMap = {}; usersSnap.forEach(doc => usersMap[doc.id] = { name: doc.data().fullName || "Unknown", dept: doc.data().department || "-" });

        const dataForExcel = [];
        recordsSnap.forEach(doc => {
            const data = doc.data(), userInfo = usersMap[data.userId] || { name: "Unknown", dept: "-" };
            const reports = data.reports || (data.report ? [data.report] : []);

            reports.forEach(r => {
                if (r.project === selectedProject) {
                    const dateStr = data.date.toDate().toLocaleDateString("th-TH", { day: "2-digit", month: "2-digit", year: "numeric" });
                    dataForExcel.push({ Date: dateStr, Employee: userInfo.name, Department: userInfo.dept, "Work Detail": r.workType, Project: r.project, "Start Time": r.startTime || "-", "End Time": r.endTime || "-", "Total Hours": r.hours || 0, "Time Period": r.duration });
                }
            });
        });

        if (dataForExcel.length === 0) return alert("ไม่พบข้อมูลรายงานสำหรับโครงการนี้ในช่วงเวลาที่เลือก");

        const ws = XLSX.utils.json_to_sheet(dataForExcel);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Project Report");
        XLSX.writeFile(wb, `Report_${selectedProject}_${selectedMonth}.xlsx`);
    } catch (error) { console.error("Export Error:", error); alert("เกิดข้อผิดพลาดในการ Export: " + error.message); }
}