
import { db } from '../config/firebase-config.js';
import { toLocalDateKey, calculateWorkHours } from '../utils/dateHelper.js';
import { showNotification } from '../utils/uiHelper.js';

// 1. ฟังก์ชันหลักสำหรับดึงและประมวลผลข้อมูล Payroll
export async function fetchPayrollData(startDate, endDate) {
    const [usersSnapshot, recordsSnapshot, approvedLeaveSnapshot, calendarDoc] =
      await Promise.all([
        db.collection("users").orderBy("fullName").get(),
        db.collection("work_records").where("date", ">=", startDate).where("date", "<=", endDate).get(),
        db.collection("leave_requests").where("status", "==", "approved").where("startDate", "<=", endDate).get(),
        db.collection("system_settings").doc("calendar_rules").get(),
      ]);

    const holidayMap = new Map();
    const workingSaturdayMap = new Map();
    if (calendarDoc.exists) {
      (calendarDoc.data().holidays || []).forEach((d) => holidayMap.set(d, true));
      (calendarDoc.data().workingSaturdays || []).forEach((d) => workingSaturdayMap.set(d, true));
    }

    const approvedLeaveMap = new Map();
    for (const doc of approvedLeaveSnapshot.docs) {
      const leave = doc.data();
      const start = leave.startDate.toDate();
      const end = leave.endDate.toDate();

      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        if (d < startDate || d > endDate) continue;
        const dateKey = toLocalDateKey(new Date(d));
        const key = `${leave.userId}_${dateKey}`;
        approvedLeaveMap.set(key, leave);
      }
    }

    const recordsMap = new Map();
    recordsSnapshot.forEach((doc) => {
      const record = doc.data();
      const dateKey = toLocalDateKey(record.date.toDate());
      if (!recordsMap.has(record.userId)) {
        recordsMap.set(record.userId, new Map());
      }
      recordsMap.get(record.userId).set(dateKey, record);
    });

    const payrollSummary = [];

    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      const user = userDoc.data();

      let summary = {
        userId: userId,
        fullName: user.fullName || "N/A",
        department: user.department || "N/A",
        employeeType: user.employeeType || "N/A",
        totalRegularHours: 0,
        total_OT_1_5x: 0,
        total_Holiday_1x: 0,
        total_Holiday_2x: 0,
        total_OT_3x: 0,
        totalLateDays: 0,
        totalLeaveDays: 0,
        totalWorkDays: 0,
        totalReportDays: 0,
        totalAbsentDays: 0,
      };

      const userRecords = recordsMap.get(userId) || new Map();

      for (let day = new Date(startDate); day <= endDate; day.setDate(day.getDate() + 1)) {
        const dateKey = toLocalDateKey(new Date(day));
        const dayOfWeek = day.getDay();

        const isHoliday = holidayMap.has(dateKey);
        const isWorkingSat = workingSaturdayMap.has(dateKey);
        const isWeekend = dayOfWeek === 0 || (dayOfWeek === 6 && !isWorkingSat);
        const isWorkingDay = !isHoliday && !isWeekend;

        const leave = approvedLeaveMap.get(`${userId}_${dateKey}`);
        const record = userRecords.get(dateKey);

        if (leave) {
          if (leave.durationType !== "hourly") summary.totalLeaveDays++;
        } else if (record) {
          summary.totalWorkDays++;

          const reportsArray = record.reports || (record.report ? [record.report] : []);
          if (reportsArray.length > 0) summary.totalReportDays++;

          if (record.status === "completed" && record.checkOut && record.checkIn && record.checkIn.timestamp) {
            const checkinTime = record.checkIn.timestamp.toDate();
            const checkoutTime = record.checkOut.timestamp.toDate();
            const { regularWorkHours, overtimeHours: calculatedOt } = calculateWorkHours(checkinTime, checkoutTime);

            let otHoursToday = 0;
            if (record.overtime && typeof record.overtime.hours === "number") {
              otHoursToday = record.overtime.hours;
            } else {
              otHoursToday = calculatedOt; 
            }

            if (isWorkingDay) {
              summary.totalRegularHours += regularWorkHours;
              summary.total_OT_1_5x += otHoursToday;
            } else {
              if (user.employeeType === "monthly") {
                summary.total_Holiday_1x += regularWorkHours;
              } else {
                summary.total_Holiday_2x += regularWorkHours;
              }
              summary.total_OT_3x += otHoursToday;
            }
          }

          if (record.checkIn && record.checkIn.timestamp) {
            const checkinTime = record.checkIn.timestamp.toDate();
            const checkInMinutes = checkinTime.getHours() * 60 + checkinTime.getMinutes();
            const LATE_THRESHOLD_MINUTES = 8 * 60 + 30; // 08:30

            if (isWorkingDay && checkInMinutes > LATE_THRESHOLD_MINUTES) {
              summary.totalLateDays++;
            }
          }
        } else if (isWorkingDay) {
          summary.totalAbsentDays++;
        }
      }
      payrollSummary.push(summary);
    }
    return payrollSummary;
}

// 2. ฟังก์ชันสำหรับแสดงผลบนหน้าเว็บ
export async function loadPayrollSummary() {
    const container = document.getElementById("payroll-summary-results-container");
    const startInput = document.getElementById("payroll-start-date");
    const endInput = document.getElementById("payroll-end-date");
    const spinner = document.getElementById("loading-spinner");

    const searchNameSelect = document.getElementById("payroll-search-name");
    const filterDeptSelect = document.getElementById("payroll-filter-dept");

    const selectedName = searchNameSelect ? searchNameSelect.value.toLowerCase() : "";
    const selectedDept = filterDeptSelect ? filterDeptSelect.value : "";

    if (!startInput.value || !endInput.value) {
      return showNotification("กรุณาเลือกวันที่เริ่มต้นและสิ้นสุด", "warning");
    }

    if (spinner) spinner.style.display = "flex";
    container.innerHTML = '<p class="text-sm text-center text-gray-500 py-6 italic">กำลังรวบรวมข้อมูลและคำนวณรายรับ...</p>';

    try {
      const startDate = new Date(startInput.value);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(endInput.value);
      endDate.setHours(23, 59, 59, 999);

      if (endDate < startDate) throw new Error("วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่มต้น");

      const summaryData = await fetchPayrollData(startDate, endDate);

      const filteredData = summaryData.filter((user) => {
        const matchesName = selectedName === "" || user.fullName.toLowerCase() === selectedName;
        const matchesDept = selectedDept === "" || user.department === selectedDept;
        return matchesName && matchesDept;
      });

      if (filteredData.length === 0) {
        container.innerHTML = `<div class="py-12 text-center"><p class="text-gray-400 text-sm">❌ ไม่พบข้อมูลพนักงานที่ตรงกับเงื่อนไขในช่วงเวลานี้</p></div>`;
        return;
      }

      let tableHTML = `
            <div class="mb-2 flex justify-between items-end">
                <p class="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Payroll Report</p>
                <p class="text-[10px] font-bold text-orange-500 uppercase">พบพนักงาน ${filteredData.length} ท่าน</p>
            </div>
            <div class="overflow-x-auto rounded-xl border border-gray-100 shadow-sm">
                <table class="w-full text-left text-sm">
                    <thead class="text-[11px] text-gray-500 uppercase bg-gray-50/80 sticky top-0">
                        <tr>
                            <th scope="col" class="px-4 py-4">พนักงาน / แผนก</th>
                            <th scope="col" class="px-2 py-4 text-center text-blue-600">วันทำงาน</th>
                            <th scope="col" class="px-2 py-4 text-center">ชม.ปกติ</th>
                            <th scope="col" class="px-2 py-4 text-center text-orange-600">OT (1.5x)</th>
                            <th scope="col" class="px-2 py-4 text-center">วันหยุด (2x)</th>
                            <th scope="col" class="px-2 py-4 text-center text-orange-600">OT หยุด (3x)</th>
                            <th scope="col" class="px-2 py-4 text-center">สาย/ลา/ขาด</th>
                            <th scope="col" class="px-4 py-4 text-center">จัดการ</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-50">
        `;

      filteredData.forEach((user) => {
        const reportColor = user.totalReportDays === user.totalWorkDays ? "text-green-600" : "text-red-500";
        tableHTML += `
            <tr class="bg-white hover:bg-orange-50/30 transition-colors">
                <td class="px-4 py-4">
                    <div class="font-bold text-gray-800 text-sm leading-tight">${user.fullName}</div>
                    <div class="flex items-center mt-1.5 h-3">
                        <span class="mt-2 bg-gray-50/50 text-[10px] pl-1 pr-1.5 py-0.5 rounded border border-gray-100 ${reportColor} font-bold whitespace-nowrap inline-block origin-left scale-[0.87] ml-[-1px] leading-none tracking-tighter antialiased">
                            Daily Report: ${user.totalReportDays}/${user.totalWorkDays} วัน
                        </span>
                    </div>
                        <div class="text-[10px] text-gray-400 mt-1">${user.department || "ไม่ระบุแผนก"}</div>
                    </td>
                    <td class="px-2 py-4 text-center font-semibold text-sky-600">${user.totalWorkDays}</td>
                    <td class="px-2 py-4 text-center text-gray-600">${user.totalRegularHours.toFixed(2)}</td>
                    <td class="px-2 py-4 text-center text-orange-600 font-bold">${user.total_OT_1_5x.toFixed(1)}</td>
                    <td class="px-2 py-4 text-center text-gray-600">${user.total_Holiday_2x.toFixed(1)}</td>
                    <td class="px-2 py-4 text-center text-orange-600 font-bold">${user.total_OT_3x.toFixed(1)}</td>
                    <td class="px-2 py-4 text-center font-mono">
                        <span class="${user.totalLateDays > 0 ? "text-orange-500 font-bold" : "text-gray-300"}">${user.totalLateDays}</span>
                        <span class="text-gray-200"> / </span>
                        <span class="${user.totalLeaveDays > 0 ? "text-blue-500 font-bold" : "text-gray-300"}">${user.totalLeaveDays}</span>
                        <span class="text-gray-200"> / </span>
                        <span class="${user.totalAbsentDays > 0 ? "text-red-500 font-bold" : "text-gray-300"}">${user.totalAbsentDays}</span>
                    </td>
                    <td class="px-4 py-4 text-center">
                        <button onclick="viewEmployeeDetail('${user.userId}', '${startInput.value}', '${endInput.value}')" 
                                class="inline-flex p-2 text-sky-500 hover:bg-sky-50 rounded-full transition-all" 
                                title="ดูรายละเอียดรายวัน">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                        </button>
                    </td>
                </tr>
            `;
      });

      tableHTML += `</tbody></table></div>`;
      container.innerHTML = tableHTML;
    } catch (error) {
      console.error("Payroll Error:", error);
      showNotification(error.message, "error");
      container.innerHTML = `<div class="p-6 text-center text-red-500 bg-red-50 rounded-xl text-sm">⚠️ เกิดข้อผิดพลาด: ${error.message}</div>`;
    } finally {
      if (spinner) spinner.style.display = "none";
    }
}

// 3. ฟังก์ชันสำหรับ Export Excel
export async function exportPayrollSummaryToExcel() {
    const startInput = document.getElementById("payroll-start-date");
    const endInput = document.getElementById("payroll-end-date");

    if (!startInput.value || !endInput.value) {
      return showNotification("กรุณาเลือกช่วงวันที่ก่อน Export", "warning");
    }

    showNotification("กำลังเตรียมข้อมูล Excel...", "success");

    try {
      const startDate = new Date(startInput.value);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(endInput.value);
      endDate.setHours(23, 59, 59, 999);

      if (endDate < startDate) return showNotification("วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่มต้น", "warning");

      const summaryData = await fetchPayrollData(startDate, endDate);

      const dataForExcel = [
        [ "Full Name", "Department", "Total Working Days", "Regular Working Hours", "Overtime (OT)", "Holiday Pay (2x)", "Holiday Overtime (3x)", "Late Arrivals", "Leave Days", "Absences" ]
      ];

      summaryData.forEach((user) => {
        dataForExcel.push([
          user.fullName, user.department, user.totalWorkDays, user.totalRegularHours.toFixed(2),
          user.total_OT_1_5x.toFixed(1), user.total_Holiday_2x.toFixed(2), user.total_OT_3x.toFixed(1),
          user.totalLateDays, user.totalLeaveDays, user.totalAbsentDays,
        ]);
      });

      const ws = XLSX.utils.aoa_to_sheet(dataForExcel);
      ws["!cols"] = [
        { wch: 25 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 10 },
        { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Payroll Summary");
      const fileName = `PayrollSummary_${startInput.value}_to_${endInput.value}.xlsx`;
      XLSX.writeFile(wb, fileName);
    } catch (error) {
      console.error("Error exporting payroll summary:", error);
      showNotification("Export Excel ล้มเหลว: " + error.message, "error");
    }
}