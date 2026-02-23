import { db, auth } from '../config/firebase-config.js';
import { toLocalDateKey } from '../utils/dateHelper.js';
import { showNotification, showConfirmDialog } from '../utils/uiHelper.js';
import { calculateDistance, FACTORY_LOCATION } from './locationService.js';

// ค่าคงที่สำหรับแปลงชื่อประเภทการลา
const LEAVE_TYPE_MAP = {
    annual: "ลาพักร้อน",
    sick: "ลาป่วย",
    personal: "ลากิจ",
    maternity: "ลาคลอด"
};

const notificationBadge = document.getElementById("mobile-admin-badge"); // เพิ่มตัวนี้ด้วยสำหรับแจ้งเตือนใบลา
const notificationList = document.getElementById("notification-list");

// 2. เพิ่มตัวแปรสำหรับหน้าขอ OT (วางไว้ก่อนถึงฟังก์ชัน openOtModal)
const requestOtBtn = document.getElementById("request-ot-btn");
const otRequestModal = document.getElementById("ot-request-modal");
const otOverlay = document.getElementById("ot-overlay");
const cancelOtBtn = document.getElementById("cancel-ot-btn");
const submitOtBtn = document.getElementById("submit-ot-btn");
const otRequestDate = document.getElementById("ot-request-date");
const otStartTime = document.getElementById("ot-start-time");
const otEndTime = document.getElementById("ot-end-time");
const otReason = document.getElementById("ot-reason");

// ฟังก์ชันโหลดข้อมูล Dashboard (ฉบับแก้ไข: เช็คใบลาชั่วโมง ไม่นับสายถ้ายื่นใบลา)
  export async function loadAdminDashboardOverview(currentUser, currentUserData) {
    // 1. Element References
    const statPresent = document.getElementById("stat-present");
    const statLate = document.getElementById("stat-late");
    const statLeave = document.getElementById("stat-leave");
    const statAbsent = document.getElementById("stat-absent");
    const dateDisplay = document.getElementById("dashboard-date-display");
    const refreshBtn = document.getElementById("refresh-dashboard-btn");

    const absentListContainer = document.getElementById(
      "dashboard-absent-list",
    );
    const leaveListContainer = document.getElementById("dashboard-leave-list");
    const lateListContainer = document.getElementById("dashboard-late-list");

    if (!statPresent) return;

    if (refreshBtn) {
      refreshBtn.disabled = true;
      refreshBtn.querySelector("svg").classList.add("animate-spin");
    }

    try {
      // 2. กำหนดเวลาวันนี้
      const today = new Date();
      const startOfDay = new Date(today);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(today);
      endOfDay.setHours(23, 59, 59, 999);

      if (dateDisplay) {
        dateDisplay.textContent = today.toLocaleDateString("th-TH", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        });
      }

      // 3. ดึงข้อมูล
      const [usersSnap, recordsSnap, leavesSnap] = await Promise.all([
        db.collection("users").get(),
        db
          .collection("work_records")
          .where("date", ">=", startOfDay)
          .where("date", "<=", endOfDay)
          .get(),
        db
          .collection("leave_requests")
          .where("status", "==", "approved")
          .where("startDate", "<=", endOfDay)
          .get(),
      ]);

      const userMap = {};
      usersSnap.forEach(
        (doc) => (userMap[doc.id] = doc.data().fullName || "Unknown"),
      );

      // --- [STEP A] สร้าง Map เก็บข้อมูลลาชั่วโมงก่อน ---
      // เพื่อเอาไว้เช็คว่าใครมี "สิทธิ์มาสายได้" บ้าง
      const userHourlyLeaveMap = {};
      leavesSnap.forEach((doc) => {
        const data = doc.data();
        // ✅ เพิ่มบรรทัดนี้: กรอง endDate ด้วย JavaScript แทน
        if (data.endDate.toDate() < startOfDay) return;

        if (data.status === "approved" && data.durationType === "hourly") {
          // เก็บเวลาเริ่มและจบการลาไว้ (เช่น start: "08:30", end: "11:30")
          userHourlyLeaveMap[data.userId] = {
            start: data.startTime,
            end: data.endTime,
          };
        }
      });

      // ตัวแปรนับยอด
      let countOnTime = 0;
      let countLate = 0;
      let countLeave = 0;
      let countAbsent = 0;

      const checkedInOrLeaveUserIds = new Set();
      const lateEmployeesList = [];
      const leaveEmployeesList = [];
      const absentEmployeesList = [];

      // --- [STEP B] ประมวลผลคนมาทำงาน (เช็คสายแบบฉลาดขึ้น) ---
      recordsSnap.forEach((doc) => {
        const data = doc.data();
        const uid = data.userId;
        const userName = userMap[uid] || "Unknown";

        // เพิ่ม UID ลงใน Set เพื่อบอกว่า "คนนี้ไม่ขาดงานนะ"
        checkedInOrLeaveUserIds.add(uid);

        // Case 1: มีการ Check-in ปกติ
        if (data.checkIn && data.checkIn.timestamp) {
          const checkInTime = data.checkIn.timestamp.toDate();

          // 1. ตั้งเกณฑ์เวลาสายมาตรฐาน (08:30)
          let lateThreshold = new Date(checkInTime);
          lateThreshold.setHours(8, 30, 0, 0);

          // 2. เช็คว่ามีใบลาชั่วโมงไหม? (Override Logic)
          if (userHourlyLeaveMap[uid]) {
            const leave = userHourlyLeaveMap[uid];
            const [sH, sM] = leave.start.split(":").map(Number);
            const leaveStartDate = new Date(checkInTime);
            leaveStartDate.setHours(sH, sM, 0, 0);

            // กฎ: ถ้าลาชั่วโมงช่วงเช้า ให้ขยับเส้นตายการมาสายออกไป
            if (leaveStartDate <= lateThreshold) {
              const [eH, eM] = leave.end.split(":").map(Number);
              lateThreshold.setHours(eH, eM, 0, 0);
            }
          }

          const checkInMinutes =
            checkInTime.getHours() * 60 + checkInTime.getMinutes();
          const thresholdMinutes =
            lateThreshold.getHours() * 60 + lateThreshold.getMinutes();

          if (checkInMinutes > thresholdMinutes) {
            countLate++;
            const lateMin = checkInMinutes - thresholdMinutes; // คำนวณนาทีที่สาย

            // 2. UI เดิม: แสดงผลแบบเรียบง่าย (ใส่ li ครอบ)
            lateEmployeesList.push(`
        <li class="border-b border-gray-100 py-2">
            ${userName} <span class="text-xs text-orange-500 ml-1">(+${lateMin} น.)</span>
            <br><span class="text-[10px] text-gray-400">เวลา: ${checkInTime.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })} น.</span>
        </li>
    `);
          } else {
            countOnTime++;
          }
        }
        // ★★★ Case 2: (เพิ่มใหม่) ไม่ได้ Check-in แต่ส่ง Report (Report Only) ★★★
        else if ((data.reports && data.reports.length > 0) || data.report) {
          // นับว่าเป็น "มาทำงานปกติ" (สีเขียว)
          countOnTime++;
        }
      });

      // --- [STEP C] ประมวลผลคนลา (นับเฉพาะคนที่ไม่ได้มาทำงาน) ---
      leavesSnap.forEach((doc) => {
        const data = doc.data();
        const uid = data.userId;

        if (data.endDate.toDate() < startOfDay) return;

        // ถ้านับว่าเป็นคนมาทำงานแล้ว (เช็คอินแล้ว) จะไม่นับเป็นคนลาในยอดรวม
        // (แต่ยังอาจจะโชว์ในลิสต์ได้ถ้าต้องการ แต่ Dashboard โดยทั่วไปจะนับ Headcount หลักคือ "มาทำงาน")
        if (!checkedInOrLeaveUserIds.has(uid)) {
          countLeave++;
          checkedInOrLeaveUserIds.add(uid);

          const leaveType = LEAVE_TYPE_MAP[data.leaveType] || data.leaveType;
          leaveEmployeesList.push(`
                    ${data.userName} <span class="text-[10px] text-gray-400">(${leaveType})</span>
                `);
        }
      });

      // --- [STEP D] ประมวลผลคนขาด ---
      for (const [uid, name] of Object.entries(userMap)) {
        if (!checkedInOrLeaveUserIds.has(uid)) {
          absentEmployeesList.push(name);
        }
      }
      countAbsent = absentEmployeesList.length;

      // --- 4. อัปเดต UI ---
      if (statPresent) statPresent.textContent = countOnTime; // โชว์เฉพาะมาทันเวลา (จะได้ไม่สับสน)
      if (statLate) statLate.textContent = countLate;
      if (statLeave) statLeave.textContent = countLeave;
      if (statAbsent) statAbsent.textContent = countAbsent;

      // 5. อัปเดตรายชื่อ (Lists)
      const updateList = (el, list, emptyMsg) => {
        if (el) {
          el.innerHTML =
            list.length > 0
              ? list
                  .map(
                    (item) =>
                      `<li class="border-b border-gray-100 dark:border-gray-700 pb-2 last:border-0">${item}</li>`,
                  )
                  .join("")
              : `<li class="text-center text-gray-400 text-xs py-4">${emptyMsg}</li>`;
        }
      };

      updateList(lateListContainer, lateEmployeesList, "- ไม่มีคนสาย -");
      updateList(leaveListContainer, leaveEmployeesList, "- ไม่มีคนลา -");
      updateList(absentListContainer, absentEmployeesList, "- ไม่มีคนขาด -");

      // 6. วาดกราฟ ApexCharts
      if (typeof ApexCharts !== "undefined") {
        const seriesData = [countOnTime, countLate, countLeave, countAbsent];
        const chartOptions = {
          series: seriesData,
          labels: ["มาทันเวลา", "มาสาย", "ลา", "ขาดงาน"],
          colors: ["#34D399", "#FB923C", "#60A5FA", "#F87171"],
          chart: {
            type: "donut",
            height: 280,
            fontFamily: "Prompt, sans-serif",
            background: "transparent",
          },
          plotOptions: {
            pie: {
              donut: {
                size: "65%",
                labels: {
                  show: true,
                  name: { show: true },
                  value: { show: true },
                  total: {
                    show: true,
                    label: "พนักงาน",
                    formatter: function (w) {
                      return (
                        w.globals.seriesTotals.reduce((a, b) => a + b, 0) +
                        " คน"
                      );
                    },
                  },
                },
              },
            },
          },
          dataLabels: { enabled: false },
          legend: {
            position: "bottom",
            labels: { colors: "var(--text-primary)" },
          }, // แก้สี Legend ให้ชัดใน Dark Mode
          stroke: { show: false },
          tooltip: { y: { formatter: (val) => val + " คน" } },
        };

        if (window.attendanceChart) {
          window.attendanceChart.destroy();
        }

        const chartEl = document.querySelector("#attendance-chart");
        if (chartEl) {
          window.attendanceChart = new ApexCharts(chartEl, chartOptions);
          window.attendanceChart.render();
        }
      }
    } catch (error) {
      console.error("Dashboard Load Error:", error);
    } finally {
      if (refreshBtn) {
        refreshBtn.disabled = false;
        refreshBtn.querySelector("svg").classList.remove("animate-spin");
      }
    }
  }

  // 2. ปรับปรุง Event Listener การเปลี่ยนหน้า (Update Navigation Logic)
  // หาโค้ด navItems.forEach(...) เดิม แล้วแก้ Logic ส่วนที่เป็น Admin ดังนี้:

  document.querySelectorAll('.nav-item').forEach(nav => {
    // 🌟 เปลี่ยนจาก item เป็น nav ให้ตรงกับตัวแปรด้านบน
    nav.addEventListener("click", (e) => {
      const pageId = nav.dataset.page; 

      // A. ถ้าเข้าหน้า Dashboard Overview -> โหลดข้อมูลสรุป
      if (pageId === "admin-dashboard-page") {
        loadAdminDashboardOverview();
      }

      // B. ถ้าเข้าหน้า Approvals -> โหลดรายการรออนุมัติ
      if (pageId === "admin-approvals-page") {
        // เช็คก่อนว่ามีฟังก์ชันเหล่านี้ไหม (ถ้าแยกไฟล์แล้วอย่าลืม Import มาด้วยนะครับ)
        if (typeof loadAllUsersForDropdown === 'function') loadAllUsersForDropdown(); 
        if (typeof loadPendingLeaveRequests === 'function') loadPendingLeaveRequests();
        if (typeof loadPendingOtRequests === 'function') loadPendingOtRequests();
      }
    });
});

  // 3. ผูกปุ่ม Refresh Dashboard
  const btnRefreshDash = document.getElementById("refresh-dashboard-btn");
  if (btnRefreshDash) {
    btnRefreshDash.addEventListener("click", loadAdminDashboardOverview);
  }

  window.deleteReportItem = async function (docId, reportId) {
    // ใช้ showConfirmDialog ที่คุณมีอยู่แล้ว
    showConfirmDialog("คุณแน่ใจหรือไม่ว่าต้องการลบรายงานนี้?", async () => {
      try {
        const docRef = db.collection("work_records").doc(docId);
        const doc = await docRef.get();

        if (doc.exists) {
          const data = doc.data();
          // ตรวจสอบว่ามีข้อมูลใน reports (Array) หรือไม่
          let reports = data.reports || (data.report ? [data.report] : []);

          // กรองเอาตัวที่ไม่ต้องการออก
          const updatedReports = reports.filter(
            (r) => (r.id || 0) !== reportId,
          );

          // อัปเดตกลับไปที่ Firebase
          await docRef.update({
            reports: updatedReports,
            // ถ้ายังมีข้อมูลเหลือ ให้เอาตัวแรกไปใส่ใน field report (เพื่อรองรับระบบเก่า)
            report: updatedReports.length > 0 ? updatedReports[0] : null,
          });

          showNotification("Report deleted successfully", "success");

          // เรียกโหลดรายการใหม่มาแสดงผลทันที
          if (typeof loadSentReports === "function") {
            loadSentReports();
          }
        }
      } catch (error) {
        console.error("Error deleting report:", error);
        showNotification("Delete failed: " + error.message, "error");
      }
    });
  };

  export async function loadDailyAuditData(currentUser, currentUserData) {
      const auditTableBody = document.getElementById("audit-table-body");
      const auditDatePicker = document.getElementById("audit-date-picker");
      const typeFilterSelect = document.getElementById("audit-type-filter");
      const lateFilterCheckbox = document.getElementById("audit-late-filter");
      const spinner = document.getElementById("loading-spinner");
  
      // 1. ★ เพิ่มจุดสกัด: ป้องกัน Null value error และเช็คสิทธิ์ Admin
      if (!currentUser || !currentUserData) return;
      if (currentUserData.role !== "admin") {
        console.warn("Unauthorized: loadDailyAuditData is for admin only.");
        return;
      }
      if (!auditTableBody) return;
  
      // 2. ตรวจสอบว่าเลือกวันที่หรือยัง
      const selectedDateStr = auditDatePicker.value;
      if (!selectedDateStr) {
        auditTableBody.innerHTML =
          '<tr><td colspan="6" class="px-6 py-10 text-center text-gray-400">กรุณาเลือกวันที่เพื่อดูข้อมูล</td></tr>';
        return;
      }
  
      if (spinner) spinner.style.display = "flex";
      auditTableBody.innerHTML =
        '<tr><td colspan="6" class="px-6 py-10 text-center text-gray-400">กำลังประมวลผลข้อมูล...</td></tr>';
  
      try {
        const startDate = new Date(selectedDateStr);
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(selectedDateStr);
        endDate.setHours(23, 59, 59, 999);
  
      const filterType = window.currentAuditFilter || (typeFilterSelect ? typeFilterSelect.value : "all");
        const isFilterLate = lateFilterCheckbox
          ? lateFilterCheckbox.checked
          : false;
  
        // ดึงข้อมูลพร้อมกัน (Promise.all)
        const [usersSnapshot, recordsSnapshot, leavesSnapshot] =
          await Promise.all([
            db.collection("users").get(),
            db
              .collection("work_records")
              .where("date", ">=", startDate)
              .where("date", "<=", endDate)
              .get(),
            db
              .collection("leave_requests")
              .where("status", "==", "approved")
              .where("startDate", "<=", endDate)
              .get(),
          ]);
  
        const usersMap = {};
        usersSnapshot.forEach((doc) => (usersMap[doc.id] = doc.data()));
  
        const leaveMap = {};
        leavesSnapshot.forEach((doc) => {
          const l = doc.data();
  
          if (l.endDate.toDate() < startDate) return;
          if (l.durationType === "hourly") {
            leaveMap[l.userId] = l;
          }
        });
  
        let html = "";
        let count = 0;
  
        recordsSnapshot.forEach((doc) => {
          const record = doc.data();
          if (!record.checkIn || !record.checkIn.timestamp) return;
  
          const user = usersMap[record.userId];
          const checkIn = record.checkIn;
          const checkOut = record.checkOut;
  
          // กรองประเภทงาน
          if (filterType !== "all") {
            if (filterType === "in_factory" && checkIn.workType !== "in_factory")
              return;
            if (
              filterType === "onsite" &&
              !checkIn.workType.includes("onsite") &&
              !checkIn.workType.includes("on_site")
            )
              return;
          }
  
          const checkInDate = checkIn.timestamp.toDate();
  
          // --- [แก้ใหม่] เปลี่ยนมาเทียบเป็นนาที เพื่อให้ 8:30:59 ไม่สาย ---
          const checkInMinutes =
            checkInDate.getHours() * 60 + checkInDate.getMinutes();
          const thresholdMinutes = 8 * 60 + 30; // 8:30 = 510 นาที
  
          // ต้องเกิน 510 นาทีจริงๆ ถึงจะนับว่าสาย (เช่น 8:31 คือ 511 นาที)
          let isLate = checkInMinutes > thresholdMinutes;
  
          // เช็คว่าลาครึ่งเช้าหรือไม่ (ถ้าใช่ ไม่นับว่าสาย)
          const userLeave = leaveMap[record.userId];
          if (isLate && userLeave && userLeave.endTime) {
            const [h, m] = userLeave.endTime.split(":").map(Number);
            const leaveEnd = new Date(checkInDate);
            leaveEnd.setHours(h, m, 0, 0);
            if (checkInDate <= leaveEnd) {
              isLate = false;
            }
          }
  
          if (isFilterLate && !isLate) return;
  
          // สถานะรายงาน
          const reportsArray =
            record.reports || (record.report ? [record.report] : []);
          const hasReport = reportsArray.length > 0;
          const reportStatusBadge = hasReport
            ? `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-700 border border-green-200">Submitted</span>`
            : `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-600 border border-red-100">Not Submitted</span>`;
  
          // ส่วนของแผนที่
          let locationStatusHTML = "";
          let mapLinkBtn = "";
  
          if (checkIn.location) {
            // ★ แก้ไขจุดที่ผิด: เปลี่ยนจาก 0{ เป็น ${ และใช้ URL ที่ถูกต้อง
            const mapUrl = `https://www.google.com/maps?q=${checkIn.location.latitude},${checkIn.location.longitude}`;
            mapLinkBtn = `
                  <a href="${mapUrl}" target="_blank" class="mt-1 inline-flex items-center gap-1 px-2 py-1 bg-white border border-gray-300 rounded-md text-[10px] font-medium text-gray-700 hover:bg-sky-50 hover:text-sky-600 hover:border-sky-300 transition-all shadow-sm">
                      <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path>
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path>
                      </svg>
                      View Map
                  </a>`;
  
            if (checkIn.workType === "in_factory") {
              const dist = calculateDistance(
                checkIn.location.latitude,
                checkIn.location.longitude,
                FACTORY_LOCATION.latitude,
                FACTORY_LOCATION.longitude,
              );
              locationStatusHTML =
                dist <= 200
                  ? `<span class="flex items-center gap-1 text-green-600 font-bold text-sm">In Factory</span>`
                  : `<span class="flex items-center gap-1 text-red-600 font-bold text-sm">Out of Area</span>`;
            } else {
              locationStatusHTML = `<span class="flex items-center gap-1 text-purple-800 font-bold text-sm">On-site</span>`;
            }
          } else {
            locationStatusHTML = `<span class="text-gray-400 italic text-sm">No GPS</span>`;
          }
  
          count++;
          const timeIn = checkInDate.toLocaleTimeString("th-TH", {
            hour: "2-digit",
            minute: "2-digit",
          });
          const timeOut = checkOut
            ? checkOut.timestamp
                .toDate()
                .toLocaleTimeString("th-TH", {
                  hour: "2-digit",
                  minute: "2-digit",
                })
            : "-";
  
          let workTypeDisplay =
            checkIn.workType === "in_factory"
              ? `<span class="inline-flex items-center px-3 py-1 rounded-md text-xs font-bold bg-sky-100 text-sky-700 border border-sky-200">Factory</span>`
              : `<span class="inline-flex items-center px-3 py-1 rounded-md text-xs font-bold bg-purple-100 text-purple-800 border border-violet-200">On-site</span>`;
  
          html += `
              <tr class="hover:bg-gray-50 border-b border-gray-100 transition-colors">
                  <td style="padding-left: 20px;" class="pr-6 py-4">
                      <div class="flex items-center gap-4">
                          <img src="${user?.profileImageUrl || "https://placehold.co/100x100/E2E8F0/475569?text=User"}" class="w-10 h-10 rounded-full object-cover border border-gray-100">
                          <div>
                              <p class="font-bold text-gray-800 text-sm">${user?.fullName || "Unknown"}</p>
                              <p class="text-[10px] text-gray-500 uppercase">${user?.department || "-"}</p>
                          </div>
                      </div>
                  </td>
                  <td class="px-4 py-4 text-center">
                      <div class="text-sm font-semibold text-gray-700 bg-gray-50 px-3 py-1 rounded-lg inline-block border border-gray-200">
                          ${timeIn} - ${timeOut}
                      </div>
                      ${isLate ? '<div class="mt-1"><span class="text-[10px] text-red-600 bg-red-50 border border-red-100 px-2 py-0.5 rounded-full font-bold">Late</span></div>' : ""}
                  </td>
                  <td class="px-6 py-4 text-center">${workTypeDisplay}</td>
                  <td class="px-6 py-4 text-center">
                      <div class="flex flex-col items-center">
                          ${locationStatusHTML}
                          ${checkIn.location ? mapLinkBtn : ""}
                      </div>
                  </td>
                  <td class="px-4 py-4 text-center">
                      ${reportStatusBadge}
                  </td>
                  <td class="px-4 py-4 text-center">
                      ${
                        record.status === "completed"
                          ? '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 border border-green-200">Completed</span>'
                          : '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100 animate-pulse">Working</span>'
                      }
                  </td>
              </tr>`;
        });
  
        if (count === 0) {
          html =
            '<tr><td colspan="6" class="px-6 py-10 text-center text-gray-400">ไม่พบข้อมูลพนักงานเข้างานในวันนี้</td></tr>';
        }
  
        auditTableBody.innerHTML = html;
        if (document.getElementById("audit-count-text")) {
          document.getElementById("audit-count-text").textContent =
            `แสดง ${count} รายการ`;
        }
      } catch (error) {
        console.error("Audit Load Error:", error);
        auditTableBody.innerHTML =
          '<tr><td colspan="6" class="px-6 py-10 text-center text-red-500">เกิดข้อผิดพลาด: ' +
          error.message +
          "</td></tr>";
      } finally {
        if (spinner) spinner.style.display = "none";
      }
    }
  
    // --- ส่วน Export Daily Audit (แก้ไข: จัดเรียงคอลัมน์ใหม่ตามสั่ง) ---
    // --- ส่วน Export Daily Audit (แก้ไข: เพิ่มช่อง Regular Hrs กลับมาเพื่อเเยก 8.00 กับ 2.00) ---
    const exportAuditBtn = document.getElementById("export-audit-btn");
  
    // เคลียร์ Event เก่า
    const newExportBtn = exportAuditBtn.cloneNode(true);
    exportAuditBtn.parentNode.replaceChild(newExportBtn, exportAuditBtn);
  
    if (newExportBtn) {
      newExportBtn.addEventListener("click", async () => {
        const dateStr = document.getElementById("audit-date-picker").value;
        const typeFilter = document.getElementById("audit-type-filter").value;
  
        if (!dateStr)
          return showNotification("กรุณาเลือกวันที่ก่อน Export", "warning");
  
        showNotification("กำลังคำนวณและเตรียมไฟล์ Excel...", "info");
  
        if (typeof XLSX === "undefined") {
          try {
            await loadScript(
              "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
            );
          } catch (e) {
            return showNotification("ไม่สามารถโหลด Library Excel ได้", "error");
          }
        }
  
        try {
          const startDate = new Date(dateStr);
          startDate.setHours(0, 0, 0, 0);
          const endDate = new Date(dateStr);
          endDate.setHours(23, 59, 59, 999);
  
          const [usersSnapshot, recordsSnapshot] = await Promise.all([
            db.collection("users").orderBy("fullName").get(),
            db
              .collection("work_records")
              .where("date", ">=", startDate)
              .where("date", "<=", endDate)
              .get(),
          ]);
  
          const usersMap = {};
          usersSnapshot.forEach((doc) => (usersMap[doc.id] = doc.data()));
  
          // ★ 1. เพิ่ม Regular Hrs กลับมาในหัวตาราง ★
          const dataForExcel = [
            [
              "Date",
              "Employee",
              "Department",
              "Check-In",
              "Check-Out",
              "Regular Hrs",
              "OT (Hrs)",
              "Total (Net)",
              "Status",
              "Report Status",
              "Work Type",
              "Onsite Details",
            ],
          ];
  
          recordsSnapshot.forEach((doc) => {
            const record = doc.data();
            const checkIn = record.checkIn;
  
            if (typeFilter !== "all") {
              if (
                typeFilter === "in_factory" &&
                checkIn.workType !== "in_factory"
              )
                return;
              if (typeFilter === "onsite" && !checkIn.workType.includes("onsite"))
                return;
            }
  
            const user = usersMap[record.userId] || {};
  
            const dateDisplay = record.date.toDate().toLocaleDateString("th-TH");
            let timeInStr = "-";
            let timeOutStr = "-";
            let regularText = "0.00"; // เตรียมตัวแปรสำหรับ Regular
            let otText = "0.00";
            let totalNetText = "0.00";
  
            let attendanceStatus = "Absent";
            let reportStatus = "Not Submitted";
  
            // ตรวจสอบเวลาเข้า
            if (checkIn && checkIn.timestamp) {
              const checkInDate = checkIn.timestamp.toDate();
              timeInStr = checkInDate.toLocaleTimeString("th-TH", {
                hour: "2-digit",
                minute: "2-digit",
              });
  
              // เช็คสาย (08:30)
              const lateThreshold = new Date(checkInDate);
              lateThreshold.setHours(8, 30, 0, 0);
              attendanceStatus = checkInDate > lateThreshold ? "Late" : "Normal";
            }
  
            // ตรวจสอบการส่ง Report
            if (record.reports && record.reports.length > 0) {
              reportStatus = "Submitted";
            } else if (record.report) {
              reportStatus = "Submitted";
            }
  
            // คำนวณเวลาทำงาน
            if (
              record.status === "completed" &&
              record.checkOut &&
              record.checkOut.timestamp
            ) {
              const checkInDate = checkIn.timestamp.toDate();
              const checkOutDate = record.checkOut.timestamp.toDate();
              timeOutStr = checkOutDate.toLocaleTimeString("th-TH", {
                hour: "2-digit",
                minute: "2-digit",
              });
  
              const calcs = calculateWorkHours(checkInDate, checkOutDate);
  
              let finalRegular = calcs.regularWorkHours;
              let finalOT = calcs.overtimeHours;
  
              if (record.overtime && typeof record.overtime.hours === "number") {
                finalOT = record.overtime.hours;
              }
  
              // แสดงค่าแยกกัน
              regularText = finalRegular.toFixed(2); // 8.00
              otText = finalOT.toFixed(2); // 2.00
              totalNetText = (finalRegular + finalOT).toFixed(2); // 10.00
            } else if (record.status === "checked_in") {
              attendanceStatus = "Working";
            }
  
            let workTypeDisplay =
              checkIn.workType === "in_factory" ? "In Factory" : "On-site";
            let onsiteDetailsDisplay = checkIn.onSiteDetails || "-";
  
            // ★ 2. ใส่ข้อมูลให้ตรงช่อง (เพิ่ม regularText) ★
            dataForExcel.push([
              dateDisplay,
              user.fullName || "Unknown",
              user.department || "-",
              timeInStr,
              timeOutStr,
              regularText, // Regular Hrs (8.00)
              otText, // OT (Hrs) (2.00)
              totalNetText, // Total (Net) (10.00)
              attendanceStatus,
              reportStatus,
              workTypeDisplay,
              onsiteDetailsDisplay,
            ]);
          });
  
          if (dataForExcel.length === 1) {
            return showNotification("ไม่พบข้อมูลสำหรับวันที่เลือก", "info");
          }
  
          const ws = XLSX.utils.aoa_to_sheet(dataForExcel);
  
          // ปรับความกว้างคอลัมน์ (เพิ่มช่อง Regular)
          ws["!cols"] = [
            { wch: 12 },
            { wch: 20 },
            { wch: 15 },
            { wch: 10 },
            { wch: 10 },
            { wch: 12 }, // Regular
            { wch: 10 }, // OT
            { wch: 12 }, // Total
            { wch: 10 },
            { wch: 15 },
            { wch: 15 },
            { wch: 25 },
          ];
  
          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, ws, "Daily_Audit");
          XLSX.writeFile(wb, `DailyAudit_${dateStr}.xlsx`);
  
          showNotification("ดาวน์โหลดไฟล์สำเร็จ!", "success");
        } catch (error) {
          console.error("Export Error:", error);
          showNotification("เกิดข้อผิดพลาด: " + error.message, "error");
        }
      });
    }
    
    export async function loadDailyLeaveNotifications() {
        if (!auth.currentUser) return;
    
        const today = new Date();
        // ตั้งเวลาเริ่มต้นของวันนี้
        const todayStart = new Date(
          today.getFullYear(),
          today.getMonth(),
          today.getDate(),
          0,
          0,
          0,
        );
        // ตั้งเวลาสิ้นสุดของวันนี้
        const todayEnd = new Date(
          today.getFullYear(),
          today.getMonth(),
          today.getDate(),
          23,
          59,
          59,
          999,
        );
    
        try {
          // Query: Status เป็น 'approved' และช่วงวันลาครอบคลุมวันนี้
          const querySnapshot = await db
            .collection("leave_requests")
            .where("status", "==", "approved")
            .where("startDate", "<=", todayEnd) // วันลาต้องเริ่มก่อนหรือตรงกับสิ้นวัน
            .get();
    
          let notifications = [];
    
          querySnapshot.forEach((doc) => {
            const leave = doc.data();
            const startDate = leave.startDate.toDate();
            const endDate = leave.endDate.toDate();
    
            if (startDate <= todayEnd && endDate >= todayStart) {
              notifications.push(leave);
            }
          });
    
          // --- Render UI ---
          let listHTML = "";
    
          if (notifications.length > 0) {
            notificationBadge.textContent = notifications.length;
            notificationBadge.classList.remove("hidden");
    
            // --- เริ่มส่วนที่แก้ไข (เวอร์ชันคงดีไซน์เดิม + รูปโปรไฟล์) ---
            notifications.forEach((leave) => {
              const leaveTypeText =
                LEAVE_TYPE_MAP[leave.leaveType] || leave.leaveType;
    
              // กำหนดสีพื้นหลังและขอบตามประเภทการลา (คง Theme เดิมไว้)
              let colorClass = "bg-red-50 border-red-200"; // Default: Annual (พักร้อน)
              let badgeClass = "bg-red-100 text-red-700";
    
              if (leave.leaveType === "sick") {
                colorClass = "bg-yellow-50 border-yellow-200";
                badgeClass = "bg-yellow-100 text-yellow-800";
              } else if (leave.leaveType === "personal") {
                colorClass = "bg-blue-50 border-blue-200";
                badgeClass = "bg-blue-100 text-blue-800";
              } else if (leave.leaveType === "maternity") {
                colorClass = "bg-pink-50 border-pink-200";
                badgeClass = "bg-pink-100 text-pink-800";
              }
    
              // จัดการวันที่ให้แสดงผลสวยงาม
              const isSameDay =
                leave.startDate.toDate().toLocaleDateString("th-TH") ===
                leave.endDate.toDate().toLocaleDateString("th-TH");
              const dateInfo = isSameDay
                ? leave.startDate
                    .toDate()
                    .toLocaleDateString("th-TH", {
                      day: "numeric",
                      month: "short",
                      year: "2-digit",
                    })
                : `${leave.startDate.toDate().toLocaleDateString("th-TH", { day: "numeric", month: "short" })} - ${leave.endDate.toDate().toLocaleDateString("th-TH", { day: "numeric", month: "short" })}`;
    
              // รูปโปรไฟล์ (ถ้าไม่มีใช้ Placeholder)
              const userAvatar =
                leave.userPhoto ||
                "https://placehold.co/100x100/E2E8F0/475569?text=User";
    
              // HTML Template
              listHTML += `
                            <div class="p-3 mb-3 rounded-xl border shadow-sm ${colorClass} transition-all hover:shadow-md">
                                <div class="flex items-start gap-3">
                                    <img src="${userAvatar}" 
                                         alt="${leave.userName}"
                                         class="w-12 h-12 rounded-full object-cover border-2 border-white shadow-sm flex-shrink-0">
                                    
                                    <div class="flex-1 min-w-0">
                                        <div class="flex justify-between items-start">
                                            <div>
                                                <p class="text-sm font-bold text-gray-800 truncate">${leave.userName}</p>
                                                <p class="text-xs font-medium text-gray-600 mt-0.5">
                                                    ${leaveTypeText}
                                                </p>
                                            </div>
                                            <span class="text-[10px] bg-white/60 px-2 py-1 rounded-lg text-gray-500 font-medium border border-gray-100">
                                                ${dateInfo}
                                            </span>
                                        </div>
                                        
                                        <div class="mt-2 pt-2 border-t border-black/5">
                                            <p class="text-xs text-gray-600 italic truncate">"${leave.reason}"</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        `;
            });
          } else {
            notificationBadge.classList.add("hidden");
            listHTML = `<p id="no-notifications-msg" class="text-center text-gray-500 text-sm">วันนี้ไม่มีพนักงานลา</p>`;
          }
    
          notificationList.innerHTML = listHTML;
        } catch (error) {
          console.error("Error loading daily leave notifications:", error);
          notificationList.innerHTML = `<p class="text-center text-red-500 text-sm">เกิดข้อผิดพลาดในการโหลด</p>`;
          notificationBadge.classList.add("hidden");
        }
      }
    
      // --- ส่วนจัดการประวัติคำขอของพนักงาน (My Requests) ---
      // 1. ตัวแปร Elements
      const btnMyLeaveHistory = document.getElementById("btn-my-leave-history");
      const btnMyOtHistory = document.getElementById("btn-my-ot-history");
    
      const myLeaveModal = document.getElementById("my-leave-history-modal");
      const myOtModal = document.getElementById("my-ot-history-modal");
    
      const myLeaveContainer = document.getElementById("my-leave-list-container");
      const myOtContainer = document.getElementById("my-ot-list-container");
    
      // 2. ฟังก์ชัน Helper สำหรับปิด Modal ทั้งหมดที่กดปุ่มปิด หรือกดพื้นหลัง
      document
        .querySelectorAll(".close-modal-btn, .modal-overlay")
        .forEach((el) => {
          el.addEventListener("click", () => {
            myLeaveModal.classList.add("hidden");
            myOtModal.classList.add("hidden");
          });
        });
    
      // 3. โหลดประวัติการลาของฉัน
      if (btnMyLeaveHistory) {
        btnMyLeaveHistory.addEventListener("click", async () => {
          const user = auth.currentUser;
          myLeaveModal.classList.remove("hidden");
          myLeaveContainer.innerHTML =
            '<p class="text-center text-gray-400 mt-4">กำลังโหลด...</p>';
    
          try {
            const snapshot = await db
              .collection("leave_requests")
              .where("userId", "==", user.uid)
              .orderBy("submittedAt", "desc") // เรียงจากใหม่ไปเก่า
              .limit(20)
              .get();
    
            if (snapshot.empty) {
              myLeaveContainer.innerHTML =
                '<p class="text-center text-gray-400 mt-10">ไม่พบประวัติการยื่นใบลา</p>';
              return;
            }
    
            let html = "";
            // --- ส่วนของประวัติการลาของฉัน ---
            snapshot.forEach((doc) => {
              const data = doc.data();
              const leaveType = LEAVE_TYPE_MAP[data.leaveType] || data.leaveType;
    
              // จัดการวันที่
              const startStr = data.startDate
                ? data.startDate
                    .toDate()
                    .toLocaleDateString("th-TH", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })
                : "-";
              const endStr = data.endDate
                ? data.endDate
                    .toDate()
                    .toLocaleDateString("th-TH", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })
                : "-";
              const submittedStr = data.submittedAt
                ? data.submittedAt
                    .toDate()
                    .toLocaleDateString("th-TH", { day: "2-digit", month: "short" })
                : "-";
    
              let dateText = `${startStr} ถึง ${endStr}`;
              if (data.durationType === "hourly") {
                dateText = `${startStr} (${data.startTime} - ${data.endTime})`;
              }
    
              // กำหนดสีและข้อความของ Badge ตามสถานะ
              let statusConfig = {
                pending: {
                  label: "รออนุมัติ",
                  class: "bg-yellow-100 text-yellow-700",
                },
                approved: {
                  label: "อนุมัติแล้ว",
                  class: "bg-green-100 text-green-700",
                },
                rejected: { label: "ไม่อนุมัติ", class: "bg-red-100 text-red-700" },
              };
              const status = statusConfig[data.status] || {
                label: data.status,
                class: "bg-gray-100 text-gray-700",
              };
    
              // HTML ดีไซน์ใหม่ตามแบบประวัติ Admin
              html += `
            <div class="bg-white p-4 rounded-xl border border-gray-200 shadow-sm mb-3">
                <div class="flex justify-between items-start mb-3">
                    <div class="flex items-center gap-3">
                        <img src="${data.userPhoto || "https://placehold.co/100x100/E2E8F0/475569?text=User"}" 
                             class="w-10 h-10 rounded-full object-cover">
                        <div>
                            <h4 class="text-sm font-bold text-gray-800">${data.userName || "ฉัน"}</h4>
                            <p class="text-[10px] text-gray-400">ยื่นเมื่อ: ${submittedStr}</p>
                        </div>
                    </div>
                    <span class="text-[10px] px-2.5 py-1 rounded-full font-bold ${status.class}">
                        ${status.label}
                    </span>
                </div>
                <div class="bg-gray-50 p-3 rounded-lg border border-gray-100">
                    <p class="text-xs font-bold text-sky-700">${leaveType}</p>
                    <p class="text-xs text-gray-600 flex items-center gap-1">
                        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                        ${dateText}
                    </p>
                </div>
                ${data.approvedBy ? `<p class="text-[10px] text-gray-400 text-right mt-2 italic">อนุมัติโดย: ${data.approvedBy}</p>` : ""}
            </div>
        `;
            });
            myLeaveContainer.innerHTML = html;
          } catch (error) {
            console.error("Error loading my leaves:", error);
            let errorMsg = "เกิดข้อผิดพลาด";
            if (error.code === "failed-precondition")
              errorMsg =
                "ระบบกำลังสร้างดัชนีข้อมูล (Index) กรุณารอสักครู่แล้วลองใหม่";
            myLeaveContainer.innerHTML = `<p class="text-center text-red-400 mt-10 text-sm">${errorMsg}</p>`;
          }
        });
      }
      // 4. โหลดประวัติ OT ของฉัน
      if (btnMyOtHistory) {
        btnMyOtHistory.addEventListener("click", async () => {
          const user = auth.currentUser;
          myOtModal.classList.remove("hidden");
          myOtContainer.innerHTML =
            '<p class="text-center text-gray-400 mt-4">กำลังโหลด...</p>';
    
          try {
            const snapshot = await db
              .collection("ot_requests")
              .where("userId", "==", user.uid)
              .orderBy("submittedAt", "desc")
              .limit(20)
              .get();
    
            if (snapshot.empty) {
              myOtContainer.innerHTML =
                '<p class="text-center text-gray-400 mt-10">ไม่พบประวัติการขอ OT</p>';
              return;
            }
    
            let html = "";
            // --- ส่วนของประวัติ OT ของฉัน ---
            snapshot.forEach((doc) => {
              const data = doc.data();
              const otDate = data.date
                .toDate()
                .toLocaleDateString("th-TH", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                });
              const submittedStr = data.submittedAt
                ? data.submittedAt
                    .toDate()
                    .toLocaleDateString("th-TH", { day: "2-digit", month: "short" })
                : "-";
    
              // คำนวณจำนวนชั่วโมง
              let durationText = "-";
              if (data.startTime && data.endTime) {
                const [h1, m1] = data.startTime.split(":").map(Number);
                const [h2, m2] = data.endTime.split(":").map(Number);
                const totalMins = h2 * 60 + m2 - (h1 * 60 + m1);
                durationText = `${(Math.floor(totalMins / 30) * 0.5).toFixed(1)} hrs`;
              }
    
              let statusConfig = {
                pending: {
                  label: "รออนุมัติ",
                  class: "bg-yellow-100 text-yellow-700",
                },
                approved: {
                  label: "อนุมัติแล้ว",
                  class: "bg-green-100 text-green-700",
                },
                rejected: { label: "ไม่อนุมัติ", class: "bg-red-100 text-red-700" },
              };
              const status = statusConfig[data.status] || {
                label: data.status,
                class: "bg-gray-100 text-gray-700",
              };
    
              // HTML ดีไซน์ใหม่แบบ Card (OT Management Style)
              html += `
            <div class="bg-white p-4 rounded-xl border border-gray-200 shadow-sm mb-3">
                <div class="flex justify-between items-start mb-3">
                    <div class="flex items-center gap-3">
                        <img src="${data.userPhoto || "https://placehold.co/100x100/E2E8F0/475569?text=User"}" 
                             class="w-10 h-10 rounded-full object-cover">
                        <div>
                            <h4 class="text-sm font-bold text-gray-800">${data.userName || "ฉัน"}</h4>
                            <p class="text-[10px] text-gray-400">ยื่นเมื่อ: ${submittedStr}</p>
                        </div>
                    </div>
                    <span class="text-[10px] px-2.5 py-1 rounded-full font-bold ${status.class}">
                        ${status.label}
                    </span>
                </div>
                <div class="bg-orange-50/50 p-3 rounded-lg border border-orange-100">
                    <p class="text-xs font-bold text-orange-700">Request OT: ${otDate}</p>
                    <div class="flex justify-between mt-1">
                        <p class="text-xs text-gray-600">Period: ${data.startTime} - ${data.endTime}</p>
                        <p class="text-xs font-bold text-orange-600">${durationText}</p>
                    </div>
                </div>
                ${data.approvedBy ? `<p class="text-[10px] text-gray-400 text-right mt-2 italic">อนุมัติโดย: ${data.approvedBy}</p>` : ""}
            </div>
        `;
            });
            myOtContainer.innerHTML = html;
          } catch (error) {
            console.error("Error loading my OT:", error);
            let errorMsg = "เกิดข้อผิดพลาด";
            if (error.code === "failed-precondition")
              errorMsg =
                "ระบบกำลังสร้างดัชนีข้อมูล (Index) กรุณารอสักครู่แล้วลองใหม่";
            myOtContainer.innerHTML = `<p class="text-center text-red-400 mt-10 text-sm">${errorMsg}</p>`;
          }
        });
      }

      export async function handleLeaveApproval(docId, newStatus, buttonElement) {
    if (!docId) return;

    // [แก้ไข] ค้นหาการ์ดหลักด้วย class ใหม่
    const cardElement = buttonElement.closest(".leave-request-card");

    // 1. ปิดการใช้งานปุ่มและทำให้การ์ดจางลงทันที
    if (cardElement) {
      cardElement
        .querySelectorAll("button")
        .forEach((btn) => (btn.disabled = true));
      cardElement.style.transition = "opacity 0.3s ease, transform 0.3s ease";
      cardElement.style.opacity = "0.5";
    } else {
      // Fallback (กรณี selector ผิด)
      buttonElement.disabled = true;
    }

    try {
      // 2. อัปเดต Firestore (เหมือนเดิม)
      await db.collection("leave_requests").doc(docId).update({
        status: newStatus,
        approvedBy: auth.currentUser ? auth.currentUser.displayName : "Admin"
      });

      const statusText = newStatus === "approved" ? "อนุมัติ" : "ไม่อนุมัติ";
      showNotification(`${statusText}ใบลาสำเร็จ`, "success");

      // 3. ถ้าหาการ์ดเจอ ให้ซ่อนและลบออก
      if (cardElement) {
        cardElement.style.opacity = "0";
        cardElement.style.transform = "scale(0.95)";

        setTimeout(() => {
          cardElement.remove(); // ลบการ์ดออกจาก DOM

          // 4. [FIX] ตรวจสอบว่ามีรายการเหลือหรือไม่
          const listContainer = document.getElementById("leave-approval-list");
          if (listContainer && listContainer.children.length === 0) {
            // ค้นหา p id="leave-loading-msg"
            let loadingMsg = document.getElementById("leave-loading-msg");

            if (!loadingMsg) {
              // ถ้าไม่มี (เพราะถูกลบไปตอนโหลด) ให้สร้างขึ้นมาใหม่
              loadingMsg = document.createElement("p");
              loadingMsg.id = "leave-loading-msg";
              loadingMsg.className = "text-center text-gray-400 text-sm py-4";
              listContainer.appendChild(loadingMsg);
            }
            // อัปเดตข้อความ
            loadingMsg.textContent = "ไม่มีรายการรออนุมัติ";
          }
        }, 300); // รอ animation 0.3s
      } else {
        // 3b. Fallback (ถ้าหาการ์ดไม่เจอ) ให้โหลดซ้ำทั้งรายการ
        await loadPendingLeaveRequests();
      }
    } catch (error) {
      // 5. ถ้าเกิดข้อผิดพลาด
      console.error("Error updating leave status:", error);
      showNotification("เกิดข้อผิดพลาดในการอัปเดต", "error");

      // คืนค่าปุ่มให้กดได้อีกครั้ง
      if (cardElement) {
        cardElement
          .querySelectorAll("button")
          .forEach((btn) => (btn.disabled = false));
        cardElement.style.opacity = "1";
        cardElement.style.transform = "scale(1)";
      } else {
        buttonElement.disabled = false;
      }
    }
  }

  // [ ★★★ เพิ่มส่วนนี้ ★★★ ]
  // ผูก Event Listener สำหรับการอนุมัติ OT
  const otListContainer = document.getElementById("ot-approval-list");
  if (otListContainer) {
    otListContainer.addEventListener("click", (event) => {
      const approveBtn = event.target.closest(".approve-ot-btn");
      const rejectBtn = event.target.closest(".reject-ot-btn");

      if (approveBtn) {
        // กดปุ่มอนุมัติ
        const docId = approveBtn.dataset.id;
        if (!docId) return;

        approveBtn.disabled = true;
        approveBtn.textContent = "กำลังบันทึก...";
        handleOtApproval(docId, "approved", approveBtn);
      } else if (rejectBtn) {
        // กดปุ่มไม่อนุมัติ
        const docId = rejectBtn.dataset.id;
        if (!docId) return;

        rejectBtn.disabled = true;
        rejectBtn.textContent = "กำลังบันทึก...";
        handleOtApproval(docId, "rejected", rejectBtn);
      }
    });
  }

  // ฟังก์ชันเปิด Modal ขอ OT (ฝั่ง User) (เวอร์ชันแก้ไข: ใช้วิธี format วันที่/เวลา ที่ปลอดภัยกว่า)
  const openOtModal = async () => {
    const user = auth.currentUser; 
    if (!user) return;             

    const today = toLocalDateKey(new Date());
    const docId = `${user.uid}_${today}`;

    try {
      const workRecordDoc = await db
        .collection("work_records")
        .doc(docId)
        .get();
      if (!workRecordDoc.exists || !workRecordDoc.data().checkOut) {
        showNotification("ไม่พบข้อมูลการ Check-out ของวันนี้", "error");
        return;
      }

      const checkoutTime = workRecordDoc.data().checkOut.timestamp.toDate();

      // [ ★ แก้ไข ★ ] ใช้วิธีดึงค่าและ .padStart(2, '0') เพื่อให้ได้ YYYY-MM-DD
      const year = checkoutTime.getFullYear();
      const month = (checkoutTime.getMonth() + 1).toString().padStart(2, "0");
      const day = checkoutTime.getDate().toString().padStart(2, "0");

      // [ ★ แก้ไข ★ ] ใช้วิธีดึงค่าและ .padStart(2, '0') เพื่อให้ได้ HH:mm
      const hours = checkoutTime.getHours().toString().padStart(2, "0");
      const minutes = checkoutTime.getMinutes().toString().padStart(2, "0");

      // เติมข้อมูลลง Modal
      otRequestDate.value = `${year}-${month}-${day}`;
      otStartTime.value = `${hours}:${minutes}`;
      otEndTime.value = "";
      otReason.value = "";

      otRequestModal.classList.remove("hidden");
    } catch (error) {
      showNotification("เกิดข้อผิดพลาด: " + error.message, "error");
    }
  };

  // ฟังก์ชันปิด Modal ขอ OT
  const closeOtModal = () => {
    otRequestModal.classList.add("hidden");
  };

  // --- Event Listeners สำหรับ Modal ขอ OT (ฝั่ง User) ---
  requestOtBtn.addEventListener("click", openOtModal);
  cancelOtBtn.addEventListener("click", closeOtModal);
  otOverlay.addEventListener("click", closeOtModal);

  // Event Listener สำหรับปุ่ม "ส่งคำขอ OT" 
  submitOtBtn.addEventListener("click", async () => {
    const user = auth.currentUser; // ✨ 1. ดึงข้อมูลผู้ใช้ปัจจุบัน
    if (!user) return showNotification("กรุณาเข้าสู่ระบบ", "error");

    const startTimeStr = otStartTime.value;
    const endTimeStr = otEndTime.value;
    const reason = otReason.value.trim();
    const dateStr = otRequestDate.value;

    if (!dateStr || !startTimeStr || !endTimeStr || !reason) {
      showNotification("กรุณากรอกข้อมูล วันที่, เวลาเริ่มต้น, เวลาสิ้นสุด และเหตุผล", "warning");
      return;
    }

    if (endTimeStr <= startTimeStr) {
      showNotification("เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่มต้น", "warning");
      return;
    }

    submitOtBtn.disabled = true;
    submitOtBtn.textContent = "กำลังส่ง...";

    try {
      // ✨ 2. ดึงข้อมูลโปรไฟล์ล่าสุดของพนักงานจาก Database สดๆ
      const userDoc = await db.collection("users").doc(user.uid).get();
      const currentUserData = userDoc.exists ? userDoc.data() : {};

      // สร้าง Collection ใหม่สำหรับเก็บคำขอ OT
      const otRequestData = {
        userId: user.uid, // ✨ 3. ใช้ user.uid
        userName: currentUserData.fullName || user.displayName || "Unknown",
        userPhoto: currentUserData.profileImageUrl || user.photoURL || "https://placehold.co/100x100",
        department: currentUserData.department || "-",
        date: firebase.firestore.Timestamp.fromDate(new Date(dateStr)),
        startTime: startTimeStr,
        endTime: endTimeStr,
        reason: reason,
        status: "pending",
        submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
        workRecordDocId: `${user.uid}_${dateStr}`,
      };

      await db.collection("ot_requests").add(otRequestData);

      showNotification("ส่งคำขอ OT สำเร็จ!", "success");
      closeOtModal();
      requestOtBtn.classList.add("hidden"); 
    } catch (error) {
      console.error("Error submitting OT request:", error);
      showNotification("เกิดข้อผิดพลาด: " + error.message, "error");
    } finally {
      submitOtBtn.disabled = false;
      submitOtBtn.textContent = "ส่งคำขอ";
    }
  });

  const leaveListContainer = document.getElementById("leave-approval-list");
if (leaveListContainer) {
    leaveListContainer.addEventListener("click", (event) => {
        const approveBtn = event.target.closest(".approve-leave-btn");
        const rejectBtn = event.target.closest(".reject-leave-btn");

        if (approveBtn) {
            const docId = approveBtn.dataset.id;
            if (docId) handleLeaveApproval(docId, "approved", approveBtn);
        } else if (rejectBtn) {
            const docId = rejectBtn.dataset.id;
            if (docId) handleLeaveApproval(docId, "rejected", rejectBtn);
        }
    });
}
