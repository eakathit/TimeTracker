import {
  db,
  auth,
  cloudFunctions,
  storage,
  messaging,
} from "./config/firebase-config.js";
import {
  FACTORY_LOCATION,
  ALLOWED_RADIUS_METERS,
  MAX_ACCEPTABLE_ACCURACY,
  latestPosition,
  setMockPosition,
  calculateDistance,
  startWatchingPosition,
  stopWatchingPosition,
} from "./services/locationService.js";
import {
  currentDisplayDate,
  loadCalendarData,
  showCalendarDetails,
  handleCalendarDetailClick,
  loadCalendarRules,
  setupAdminCalendarControls,
  loadAndDisplayHolidays,
} from "./services/calendarService.js";
import {
  handleGoogleLogin,
  handleLogout,
  saveUserProfile,
  loadRoleManagement,
  updateUserRole,
} from "./services/authService.js";
import {
  toLocalISOString,
  toLocalDateKey,
  calculateWorkHours,
} from "./utils/dateHelper.js";
import { showNotification, showConfirmDialog } from "./utils/uiHelper.js";
import {
  loadPayrollSummary,
  exportPayrollSummaryToExcel,
} from "./services/payrollService.js";
import {
  loadWorkHistory,
  loadLeaveHistory,
  loadOtHistory,
  loadTimesheetSummary,
} from "./services/historyService.js";
import {
  loadAdminDashboardOverview,
  loadDailyAuditData,
  loadDailyLeaveNotifications,
  handleLeaveApproval,
} from "./services/dashboardService.js";
import {
  submitLeaveRequest,
  submitDailyReport,
  deleteDailyReportItem,
} from "./services/requestService.js";
import {
  loadPendingLeaveRequests,
  loadPendingOtRequests,
  handleOtApproval,
} from "./services/approvalService.js";
import {
  checkUserWorkStatus,
  proceedWithCheckin,
  handleCheckoutAction,
  setupOnsiteLeader,
  joinOnsiteRoom,
  loadScript,
  switchRole,
} from "./services/attendanceService.js";
import {
  loadTimelineData,
  loadTimesheetTable,
  loadEmployeeSummary,
  exportEmployeeSummaryToExcel,
  populateProjectOptions,
  fetchProjectData,
  exportProjectSummaryToExcelData,
} from "./services/timesheetService.js";

document.addEventListener("DOMContentLoaded", function () {
  const loadScript = (src) => {
    return new Promise((resolve, reject) => {
      // เช็คว่าเคยโหลดไปหรือยัง ถ้ามีแล้วไม่ต้องโหลดซ้ำ
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  };

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      // 1. ลงทะเบียน sw.js (โค้ดเดิมของคุณ)
      navigator.serviceWorker.register("/sw.js").then(
        function (registration) {
          console.log(
            "ServiceWorker registration successful with scope: ",
            registration.scope,
          );
        },
        function (err) {
          console.log("ServiceWorker registration failed: ", err);
        },
      );

      // 2. ★ เพิ่มส่วนนี้เข้าไปครับ ★
      // หน้าที่: เมื่อ sw.js ตัวใหม่ (ที่มีการแก้บั๊ก) เริ่มทำงาน มันจะสั่งให้หน้าเว็บ Refresh ตัวเองทันที 1 ครั้ง
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        console.log("New Service Worker activated. Reloading page...");
        window.location.reload();
      });
    });
  }

  // เพิ่มโค้ดนี้เพื่อให้แจ้งเตือนเด้งตอนเปิดเว็บอยู่
  if (messaging) {
    messaging.onMessage((payload) => {
      console.log("ได้รับข้อความขณะเปิดแอป: ", payload);

      const title = payload.notification.title;
      const body = payload.notification.body;

      // 1. แสดงในแอป (Toast เดิมของคุณ)
      showNotification(title + ": " + body, "info");

      // 2. สั่งให้ระบบเด้งแถบแจ้งเตือนบนหน้าจอ (System Banner)
      // หมายเหตุ: iOS ในโหมด PWA อาจจะไม่เด้งซ้ำถ้าเปิดหน้าจออยู่ แต่ในคอมและ Android จะเด้งครับ
      if (Notification.permission === "granted") {
        new Notification(title, {
          body: body,
          icon: "/icons/icon-192.png", // ใส่ path ไอคอนของคุณ
        });
      }
    });
  }

  async function setupNotifications() {
    try {
      // 1. ตรวจสอบว่าเบราว์เซอร์รองรับ Firebase Messaging หรือไม่ (ป้องกัน Error บน iOS/Safari รุ่นเก่า)
      const isSupported = await firebase.messaging.isSupported();
      if (!isSupported) {
        console.log("FCM ไม่รองรับบนเบราว์เซอร์นี้");
        return;
      }

      const messaging = firebase.messaging();

      // 2. ขอสิทธิ์แจ้งเตือนจากผู้ใช้
      const permission = await Notification.requestPermission();

      if (permission === "granted") {
        console.log("ได้รับอนุญาตให้แจ้งเตือนเรียบร้อย");

        // 3. ลงทะเบียน Service Worker (ไฟล์ firebase-messaging-sw.js ต้องอยู่ที่ root)
        const registration = await navigator.serviceWorker.register(
          "/firebase-messaging-sw.js",
        );

        // 4. รับ Token (VAPID Key ต้องตรงกับใน Firebase Console ของคุณ)
        const currentToken = await messaging.getToken({
          vapidKey:
            "BE54Oa8UjJ0PUlUKsN879Qu27UdEyEMpq91Zd_VZeez403fM2xRAspp3XeUTl2iLSh90ip0uRXONGncKOIgw37s", // <--- ตรวจสอบรหัสนี้ให้ตรงกับใน Console
          serviceWorkerRegistration: registration,
        });

        if (currentToken) {
          console.log("FCM Token:", currentToken);
          await saveFCMToken(currentToken);
        } else {
          console.warn(
            "ไม่สามารถสร้าง Token ได้ กรุณาตรวจสอบการตั้งค่า Firebase",
          );
        }
      } else if (permission === "denied") {
        console.warn("ผู้ใช้ปฏิเสธการแจ้งเตือน");
      }
    } catch (err) {
      console.error("เกิดข้อผิดพลาดในการตั้งค่า Notification:", err);
    }
  }

  // ฟังก์ชันสำหรับขอ Token และบันทึกลง Database
  async function saveFCMToken() {
    if (!messaging || !currentUser) return;

    try {
      if (Notification.permission === "granted") {
        // ★ แก้ไข: เรียกหา Service Worker ตัวหลัก (sw.js) ที่กำลังทำงานอยู่
        const registration = await navigator.serviceWorker.ready;

        const token = await messaging.getToken({
          vapidKey:
            "BE54Oa8UjJ0PUlUKsN879Qu27UdEyEMpq91Zd_VZeez403fM2xRAspp3XeUTl2iLSh90ip0uRXONGncKOIgw37s",
          serviceWorkerRegistration: registration, // ส่ง sw.js เข้าไป
        });

        if (token) {
          console.log("FCM Token Updated:", token);
          await db.collection("users").doc(currentUser.uid).update({
            fcmToken: token,
            tokenUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          });
        }
      }
    } catch (error) {
      console.error("Error auto-saving token:", error);
    }
  }

  // ฟังก์ชันตรวจสอบปุ่ม
  function checkNotificationStatus() {
    const btn = document.getElementById("enable-notify-btn");
    if (!btn) return;

    if (Notification.permission === "granted") {
      btn.classList.add("hidden"); // อนุญาตแล้ว ซ่อนปุ่ม
    } else if (Notification.permission === "denied") {
      btn.classList.remove("hidden");
      btn.classList.replace("bg-indigo-500", "bg-gray-400");
      btn.disabled = true;
      btn.querySelector("span").textContent = "ถูกปิดกั้นการแจ้งเตือน";
    } else {
      btn.classList.remove("hidden"); // ยังไม่เลือก โชว์ปุ่ม
    }
  }

  // ผูก Event ปุ่มกด
  const notifyBtn = document.getElementById("enable-notify-btn");
  if (notifyBtn) {
    notifyBtn.addEventListener("click", async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission === "granted") {
          const registration = await navigator.serviceWorker.ready; // ★ เพิ่มบรรทัดนี้

          const token = await messaging.getToken({
            vapidKey:
              "BE54Oa8UjJ0PUlUKsN879Qu27UdEyEMpq91Zd_VZeez403fM2xRAspp3XeUTl2iLSh90ip0uRXONGncKOIgw37s",
            serviceWorkerRegistration: registration, // ★ ใส่เพิ่ม
          });

          if (token) {
            console.log("Token:", token);
            // บันทึกลง Firestore
            if (currentUser) {
              await db.collection("users").doc(currentUser.uid).update({
                fcmToken: token,
              });
            }
          }
          checkNotificationStatus(); // อัปเดตปุ่ม
        }
      } catch (error) {
        console.error("Notify Error:", error);
        alert("เกิดข้อผิดพลาด: " + error.message);
      }
    });
  }

  const LEAVE_TYPE_MAP = {
    annual: "ลาพักร้อน",
    sick: "ลาป่วย",
    personal: "ลากิจ",
    maternity: "ลาคลอด", // เพิ่มบรรทัดนี้
  };

  // --- UI Elements ---
  const loadingSpinner = document.getElementById("loading-spinner");
  const loginPage = document.getElementById("login-page");
  const appContainer = document.getElementById("app-container");
  const lineLoginBtn = document.getElementById("line-login-btn");
  const checkinBtn = document.getElementById("checkin-btn");
  const checkoutBtn = document.getElementById("checkout-btn");
  const mainContent = document.getElementById("main-content");
  const locationStatusDiv = document.getElementById("location-status");
  const locationIcon = document.getElementById("location-icon");
  const locationText = document.getElementById("location-text");
  const workTypeButtons = document.querySelectorAll(".work-type-btn");
  const onsiteDetailsForm = document.getElementById("onsite-details-form");
  const onsiteLocationInput = document.getElementById("onsite-location-input");
  const photoUploadInput = document.getElementById("photo-upload-input");
  const photoPreview = document.getElementById("photo-preview");
  const summaryCheckinTime = document.getElementById("summary-checkin-time");
  const summaryCheckoutTime = document.getElementById("summary-checkout-time");
  const summaryWorkHours = document.getElementById("summary-work-hours");
  const pages = mainContent.querySelectorAll(".page");
  const navItems = document.querySelectorAll(".nav-item");
  const timeElement = document.getElementById("current-time");

  // --- UI Elements for Report Page ---
  const saveReportBtn = document.getElementById("save-report-btn");
  const reportDateInput = document.getElementById("report-date-input");
  const workTypeSelectedText = document.getElementById(
    "work-type-selected-text",
  );
  const projectSelectedText = document.getElementById("project-selected-text");
  const durationSelectedText = document.getElementById(
    "duration-selected-text",
  );
  const customTimeInputs = document.getElementById("custom-time-inputs");
  const customTimeStartInput = document.getElementById(
    "custom-time-start-input",
  );
  const customTimeEndInput = document.getElementById("custom-time-end-input");
  const summaryStartDateInput = document.getElementById("summary-start-date");
  const summaryEndDateInput = document.getElementById("summary-end-date");
  const summaryEmployeeFilterInput = document.getElementById(
    "summary-employee-filter",
  );
  const summaryStatusFilterSelect = document.getElementById(
    "summary-status-filter",
  );

  // 1. ดึง Elements
  const editUserSelect = document.getElementById("edit-user-select");
  const editDateSelect = document.getElementById("edit-date-select");
  const searchRecordBtn = document.getElementById("search-record-btn");
  const searchResultsContainer = document.getElementById(
    "search-results-container",
  );

  const editModal = document.getElementById("edit-modal");
  const modalOverlay = document.getElementById("modal-overlay");
  const cancelEditBtn = document.getElementById("cancel-edit-btn");
  const saveEditBtn = document.getElementById("save-edit-btn");

  // Input ภายใน Modal
  const editDocIdInput = document.getElementById("edit-doc-id");
  const editCheckinTimeInput = document.getElementById("edit-checkin-time");
  const editCheckoutTimeInput = document.getElementById("edit-checkout-time");
  const editOnsiteDetailsInput = document.getElementById("edit-onsite-details");
  // Elements สำหรับ Dropdown ใน Modal
  const editModalWorkTypeSelectedText = document.getElementById(
    "edit-modal-work-type-selected-text",
  );
  const editModalProjectSelectedText = document.getElementById(
    "edit-modal-project-selected-text",
  );
  const editModalDurationSelectedText = document.getElementById(
    "edit-modal-duration-selected-text",
  );
  const editModalCustomTimeInputs = document.getElementById(
    "edit-modal-custom-time-inputs",
  );
  const editModalCustomTimeStartInput = document.getElementById(
    "edit-modal-custom-time-start-input",
  );
  const editModalCustomTimeEndInput = document.getElementById(
    "edit-modal-custom-time-end-input",
  );
  // --- 1. ดึง Element ของฟอร์มใบลา ---
  const leaveRequestModal = document.getElementById("leave-request-modal");
  const leaveOverlay = document.getElementById("leave-overlay");
  const cancelLeaveBtn = document.getElementById("cancel-leave-btn");
  const submitLeaveBtn = document.getElementById("submit-leave-btn");
  // [ใหม่] ดึง Element ที่เพิ่มเข้ามา
  const leaveDurationType = document.getElementById("leave-duration-type");
  const leaveEndDateWrapper = document.getElementById("leave-end-date-wrapper");
  const leaveHourlyInputsWrapper = document.getElementById(
    "leave-hourly-inputs-wrapper",
  );
  const leaveStartTime = document.getElementById("leave-start-time");
  const leaveEndTime = document.getElementById("leave-end-time");
  // --- 2. ดึง Element ของ Input ---
  const leaveTypeSelect = document.getElementById("leave-type-select");
  const leaveStartDate = document.getElementById("leave-start-date");
  const leaveEndDate = document.getElementById("leave-end-date");
  const leaveReason = document.getElementById("leave-reason");
  // --- [เพิ่ม] ตัวแปรสำหรับ Modal แก้ไขโปรไฟล์ ---
  const profileEditModal = document.getElementById("profile-edit-modal");
  const profileEditBtn = document.getElementById("profile-edit-btn");
  const profileEditCancelBtn = document.getElementById(
    "profile-edit-cancel-btn",
  );
  const profileEditOverlay = document.getElementById("profile-edit-overlay");
  const profileEditNameInput = document.getElementById(
    "profile-edit-name-input",
  );
  const profileEditDeptInput = document.getElementById(
    "profile-edit-dept-input",
  );
  const profileEditSaveBtn = document.getElementById("profile-edit-save-btn");
  // [เพิ่มใหม่] --- UI Elements สำหรับขอ OT ---
  const requestOtBtn = document.getElementById("request-ot-btn");
  const otRequestModal = document.getElementById("ot-request-modal");
  const otOverlay = document.getElementById("ot-overlay");
  const cancelOtBtn = document.getElementById("cancel-ot-btn");
  const submitOtBtn = document.getElementById("submit-ot-btn");
  const otRequestDate = document.getElementById("ot-request-date");
  const otStartTime = document.getElementById("ot-start-time");
  const otEndTime = document.getElementById("ot-end-time");
  const otReason = document.getElementById("ot-reason");

  // --- Timeline & Timesheet Management Logic ---
  const timelineContainer = document.getElementById("timeline-list-container");

  let html5QrCode;
  let currentRoomId = null;
  let roomUnsubscribe = null; // สำหรับยกเลิกการฟัง Realtime update

  const memberSection = document.getElementById("member-section");
  const leaderSection = document.getElementById("leader-section");

  // CSS Class สำหรับปุ่มที่ถูกเลือก/ไม่ถูกเลือก
  const activeClass = ["border-sky-500", "text-sky-600", "bg-sky-50"];
  const inactiveClass = ["border-gray-300", "text-gray-500", "bg-white"];

  // --- App State ---
  let currentUser = null;
  let selectedWorkType = "in_factory";
  let photoFile = null;
  let controlsInitialized = false;
  let currentUserData = null;

  // (วางโค้ดนี้ก่อน auth.onAuthStateChanged)
  function openProfileEditModal() {
    if (!currentUserData) return; // ตรวจสอบว่ามีข้อมูล User

    // 1. เติมข้อมูลเดิมลงในฟอร์ม
    profileEditNameInput.value = currentUserData.fullName || "";

    // [แก้ไข] ตรวจสอบ 'Unassigned' เพื่อแสดง Placeholder
    const currentDept = currentUserData.department;
    if (currentDept && currentDept !== "Unassigned") {
      profileEditDeptInput.value = currentDept;
    } else {
      profileEditDeptInput.value = ""; // ตั้งเป็นค่าว่าง ("") เพื่อให้แสดง "-- เลือกฝ่าย/แผนก --"
    }

    // 2. แสดง Modal
    if (profileEditModal) profileEditModal.classList.remove("hidden");
  }

  // --- [เพิ่ม] ฟังก์ชันปิด Modal ---
  function closeProfileEditModal() {
    if (profileEditModal) profileEditModal.classList.add("hidden");
  }

  // --- [เพิ่ม] ผูก Event Listener (ปุ่มเปิด/ปิด Modal) ---
  if (profileEditBtn)
    profileEditBtn.addEventListener("click", openProfileEditModal);
  if (profileEditCancelBtn)
    profileEditCancelBtn.addEventListener("click", closeProfileEditModal);
  if (profileEditOverlay)
    profileEditOverlay.addEventListener("click", closeProfileEditModal);

  async function initializeApp(user, userData) {
    console.log("Initializing App...");
    currentUserData = userData;

    // --------------------------------------------------------
    // 1. อัปเดตข้อมูลพื้นฐาน (Header & Profile)
    // --------------------------------------------------------
    const displayNameEl = document.getElementById("user-display-name");
    if (displayNameEl) {
      displayNameEl.textContent = userData.fullName || "ผู้ใช้งาน";
    }

    // --------------------------------------------------------
    // 2. อัปเดตข้อมูล Sidebar (Mini Profile ด้านล่างซ้าย)
    // --------------------------------------------------------
    const sbPic = document.getElementById("sidebar-user-pic");
    const sbName = document.getElementById("sidebar-user-name");
    const sbRole = document.getElementById("sidebar-user-role");

    if (sbPic && sbName && sbRole) {
      sbName.textContent = userData.fullName || "User";
      sbRole.textContent =
        userData.role === "admin" ? "Administrator" : "Employee";

      if (userData.profileImageUrl) {
        sbPic.src = `${userData.profileImageUrl}?t=${new Date().getTime()}`;
      } else {
        sbPic.src = "https://placehold.co/100x100/E2E8F0/475569?text=User";
      }
    }

    // --------------------------------------------------------
    // 3. จัดการเมนู Sidebar (Desktop) ตาม Role
    // --------------------------------------------------------
    const adminMenuGroup = document.getElementById("admin-menu-group");
    const systemMenuGroup = document.getElementById("system-menu-group");

    if (currentUserData.role === "admin") {
      if (adminMenuGroup) adminMenuGroup.classList.remove("hidden");
      if (systemMenuGroup) systemMenuGroup.classList.remove("hidden");
    } else {
      if (adminMenuGroup) adminMenuGroup.classList.add("hidden");
      if (systemMenuGroup) systemMenuGroup.classList.add("hidden");
    }

    // --------------------------------------------------------
    // 4. จัดการ Mobile Bottom Nav (เมนูมือถือ)
    // --------------------------------------------------------
    const mobileCalendarNav = document.getElementById("calendar-or-admin-nav");

    if (currentUserData.role === "admin") {
      // --- ADMIN MOBILE VIEW ---
      if (mobileCalendarNav) {
        // เปลี่ยนให้ปุ่มนี้เปิดหน้า "รวมเมนู Admin"
        mobileCalendarNav.dataset.page = "admin-mobile-menu-page";

        // ไอคอน Hamburger / Grid
        mobileCalendarNav.innerHTML = `
                <div class="relative">
                    <svg class="w-7 h-7 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                    <span id="mobile-admin-badge" class="hidden absolute top-0 right-2 w-3 h-3 bg-red-500 rounded-full border-2 border-white"></span>
                </div>
                `;

        // ผูก Event ให้ปุ่มต่างๆ ในหน้า Admin Mobile Menu
        setTimeout(() => {
          const btnCalendar = document.getElementById("btn-menu-calendar");
          const btnDashboard = document.getElementById("btn-menu-dashboard");
          const btnApprovals = document.getElementById("btn-menu-approvals");

          // ปุ่ม: ดูปฏิทิน
          if (btnCalendar) {
            btnCalendar.onclick = () => {
              showPage("calendar-page");
              if (typeof loadCalendarData === "function")
                loadCalendarData(currentDisplayDate);

              const adminControls = document.getElementById(
                "admin-calendar-controls-card",
              );
              if (adminControls) {
                adminControls.classList.remove("hidden");
                if (typeof loadCalendarRules === "function")
                  loadCalendarRules();
              }
            };
          }

          // ปุ่ม: ดู Dashboard
          if (btnDashboard) {
            btnDashboard.onclick = () => {
              showPage("admin-dashboard-page");
              if (typeof loadAdminDashboardOverview === "function")
                loadAdminDashboardOverview();
            };
          }

          // ปุ่ม: อนุมัติ (Approvals)
          if (btnApprovals) {
            btnApprovals.onclick = () => {
              showPage("admin-approvals-page");
              if (typeof loadAllUsersForDropdown === "function")
                loadAllUsersForDropdown();
              if (typeof loadPendingLeaveRequests === "function")
                loadPendingLeaveRequests();
              if (typeof loadPendingOtRequests === "function")
                loadPendingLeaveRequests(currentUserData);
              loadPendingOtRequests(currentUserData);
            };
          }
        }, 500);
      }
    } else {
      // --- USER MOBILE VIEW ---
      if (mobileCalendarNav) {
        mobileCalendarNav.dataset.page = "calendar-page";
        mobileCalendarNav.innerHTML = `
                <svg class="w-7 h-7 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                </svg>
                `;
      }
    }

    // --------------------------------------------------------
    // 5. จัดการปุ่ม Toggle แจ้งเตือน (Notification Switch)
    // --------------------------------------------------------
    const notifyToggle = document.getElementById("notify-toggle");
    const notifyLabel = document.getElementById("notify-status-label");

    if (notifyToggle) {
      // --- 5.1 ตั้งค่าสถานะเริ่มต้น (On Load) ---
      // ถ้า Database ไม่มีค่า (undefined) ให้ถือว่าเป็น true (เปิด)
      const isEnabled = userData.receiveNotifications !== false;

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

      // --- 5.2 สร้าง Event Listener ใหม่ ---
      const newToggle = notifyToggle.cloneNode(true);
      notifyToggle.parentNode.replaceChild(newToggle, notifyToggle);

      newToggle.addEventListener("change", async (e) => {
        const isChecked = e.target.checked;
        const label = document.getElementById("notify-status-label");

        if (isChecked) {
          // เปิด (ON)
          if (label) label.textContent = "กำลังเปิด...";
          try {
            const permission = await Notification.requestPermission();
            if (permission === "granted") {
              await saveFCMToken();
              await db
                .collection("users")
                .doc(user.uid)
                .update({ receiveNotifications: true });

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
          // ปิด (OFF)
          try {
            await db
              .collection("users")
              .doc(user.uid)
              .update({ receiveNotifications: false });
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

    // --------------------------------------------------------
    // 6. เตรียมแสดงผล (UI State & Navigation)
    // --------------------------------------------------------
    const appContainer = document.getElementById("app-container");
    const loadingSpinner = document.getElementById("loading-spinner");
    const loginPage = document.getElementById("login-page");

    if (loginPage) loginPage.style.display = "none";
    if (loadingSpinner) loadingSpinner.style.display = "none";
    if (appContainer) appContainer.style.removeProperty("display");

    // บังคับเปิดหน้าแรก (Check In)
    showPage("check-in-out-page");

    // Reset เมนู Active
    document
      .querySelectorAll(".nav-item")
      .forEach((n) => n.classList.remove("active"));
    document
      .querySelectorAll('.nav-item[data-page="check-in-out-page"]')
      .forEach((n) => n.classList.add("active"));

    // --------------------------------------------------------
    // 7. เริ่มต้นระบบหลัก (GPS & Controls)
    // --------------------------------------------------------
    initializeControls();
    startWatchingPosition();

    // --------------------------------------------------------
    // 8. โหลดข้อมูลเบื้องหลัง (Background Data)
    // --------------------------------------------------------
    try {
      await Promise.all([checkUserWorkStatus(), populateDropdownOptions()]);
      console.log("Background data loaded successfully");
    } catch (error) {
      console.error("Error loading background data:", error);
    }
  }

  /* --- แก้ไข: เพิ่มบรรทัด currentUser = user; --- */
  auth.onAuthStateChanged(async (user) => {
    console.log("🔄 Auth State Changed Triggered");

    const loginPage = document.getElementById("login-page");
    const loadingSpinner = document.getElementById("loading-spinner");
    const appContainer = document.getElementById("app-container");

    if (loginPage) loginPage.style.display = "none";
    if (loadingSpinner) loadingSpinner.style.display = "flex";

    try {
      if (user) {
        console.log("✅ User detected:", user.uid);

        // ★★★ เพิ่มบรรทัดนี้สำคัญมาก! ★★★
        currentUser = user;
        // -----------------------------

        const userDocRef = db.collection("users").doc(user.uid);
        console.log("⏳ Fetching user profile...");

        // Timeout protection
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("Timeout loading user profile")),
            8000,
          ),
        );

        let userDoc;
        try {
          userDoc = await Promise.race([userDocRef.get(), timeoutPromise]);
        } catch (err) {
          console.warn("⚠️ Fetch profile slow/failed:", err);
          userDoc = { exists: false };
        }

        if (userDoc.exists) {
          await initializeApp(user, userDoc.data());

          saveFCMToken();

          const params = new URLSearchParams(window.location.search);
          const targetPage = params.get("page");

          if (targetPage) {
            // เติมคำว่า -page ต่อท้าย (ถ้ายังไม่มี)
            const targetPageId = targetPage.endsWith("-page")
              ? targetPage
              : targetPage + "-page";

            // เช็คว่ามีหน้านี้จริงไหม
            const pageElement = document.getElementById(targetPageId);

            // ถ้าเป็นหน้า Admin ต้องเช็คสิทธิ์ด้วย
            const isAdminPage = targetPageId.includes("admin");
            const hasPermission =
              !isAdminPage || userDoc.data().role === "admin";

            if (pageElement && hasPermission) {
              console.log("🚀 Deep linking to:", targetPageId);

              // หน่วงเวลาเล็กน้อยเพื่อให้ระบบโหลดเสร็จก่อนสลับหน้า
              setTimeout(() => {
                // 1. สลับหน้า
                if (typeof showPage === "function") showPage(targetPageId);

                // 2. ปรับเมนูให้ Active (Optional)
                document
                  .querySelectorAll(".nav-item")
                  .forEach((n) => n.classList.remove("active"));
                const activeNav = document.querySelector(
                  `.nav-item[data-page="${targetPageId}"]`,
                );
                if (activeNav) activeNav.classList.add("active");
              }, 500);
            }
          }
        } else {
          console.warn("⚠️ No user profile found, creating default...");
          const newUserProfile = {
            fullName: user.displayName || user.email || "New User",
            email: user.email || null,
            profileImageUrl: user.photoURL || null,
            department: "Unassigned",
            role: "user",
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          };
          userDocRef
            .set(newUserProfile)
            .catch((e) => console.error("Save profile error", e));
          await initializeApp(user, newUserProfile);
        }

        const today = toLocalDateKey(new Date());
        if (reportDateInput) {
          reportDateInput.value = today; // ตั้งค่าวันที่ในช่อง Input เป็นวันนี้
          loadSentReports(); // สั่งโหลดรายงานของวันนี้มาโชว์
        }
      } else {
        console.log("👋 User logged out");
        if (typeof stopWatchingPosition === "function") stopWatchingPosition();
        currentUser = null;

        if (appContainer) appContainer.style.display = "none";
        if (loginPage) loginPage.style.display = "flex";
        if (loadingSpinner) loadingSpinner.style.display = "none";
      }
    } catch (error) {
      console.error("❌ Critical Auth Error:", error);
      alert("เกิดข้อผิดพลาดร้ายแรง: " + error.message);

      if (loadingSpinner) loadingSpinner.style.display = "none";
      if (loginPage) loginPage.style.display = "flex";
    }
  });

  // โดย onAuthStateChanged (ที่อยู่ข้างบน) ซึ่งกำลังรอฟังอยู่แล้ว
  auth
    .setPersistence(firebase.auth.Auth.Persistence.LOCAL)
    .then(() => {
      // เรียก getRedirectResult เพื่อประมวลผลการเด้งกลับจาก LINE/Google
      return auth.getRedirectResult();
    })
    .then((result) => {
      if (result.user) {
        console.log("เข้าสู่ระบบผ่าน Redirect สำเร็จ (ด้วย Local Persistence)");
      }
      // ไม่ต้องทำอะไรต่อ ... onAuthStateChanged (ข้างบน) จะจัดการเอง
    })
    .catch((error) => {
      console.error("Firebase Persistence Error:", error.code, error.message);
      if (error.code === "auth/persistence-unavailable") {
        alert(
          "เบราว์เซอร์ของคุณไม่อนุญาตให้จัดเก็บข้อมูล กรุณาปิดโหมด Private Browsing",
        );
      } else {
        console.error("LINE/Google Redirect Error:", error.code, error.message);
      }
      // ถ้า Error, onAuthStateChanged (ข้างบน) ก็จะยังคงทำงาน
      // และแสดงหน้า Login ตามปกติ (เพราะ user = null)
    });

  workTypeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      workTypeButtons.forEach((btn) => {
        btn.classList.remove("bg-sky-500", "text-white", "shadow");
        btn.classList.add("text-gray-600");
      });
      button.classList.add("bg-sky-500", "text-white", "shadow");
      selectedWorkType = button.dataset.workType;
      onsiteDetailsForm.classList.toggle(
        "hidden",
        selectedWorkType !== "on_site",
      );
    });
  });

  const populateDropdownOptions = async () => {
    const db = firebase.firestore();
    const configs = [
      { docId: "workTypes", optionsId: "work-type-options" },
      { docId: "projects", optionsId: "project-options" },
      { docId: "workTypes", optionsId: "delete-work-type-options" },
      { docId: "projects", optionsId: "delete-project-options" },
      { docId: "workTypes", optionsId: "edit-modal-work-type-options" },
      { docId: "projects", optionsId: "edit-modal-project-options" },
      { docId: "workTypes", optionsId: "checkin-work-type-options" },
      { docId: "projects", optionsId: "checkin-project-options" },
    ];

    for (const config of configs) {
      try {
        const doc = await db
          .collection("system_settings")
          .doc(config.docId)
          .get();
        if (!doc.exists) continue;

        const items = doc.data().names || [];
        const optionsContainer = document.getElementById(config.optionsId);
        const panel = optionsContainer.closest(".absolute");
        const selectedText = panel.previousElementSibling.querySelector("span");

        optionsContainer.innerHTML = "";

        items.forEach((name) => {
          const optionDiv = document.createElement("div");
          optionDiv.className =
            "p-2 rounded-lg hover:bg-sky-50 cursor-pointer text-sm";
          optionDiv.textContent = name;

          optionDiv.addEventListener("click", () => {
            selectedText.textContent = name;
            selectedText.classList.remove("text-gray-500");
            panel.classList.add("hidden");
          });
          optionsContainer.appendChild(optionDiv);
        });
      } catch (error) {
        console.error(`Error populating ${config.docId}:`, error);
      }
    }
  };

  function initializeControls() {
    if (controlsInitialized) return;

    const db = firebase.firestore();

    const dropdownConfigs = [
      {
        panelId: "work-type-panel",
        selectBtnId: "work-type-btn",
        searchId: "work-type-search",
      },
      {
        panelId: "project-panel",
        selectBtnId: "project-btn",
        searchId: "project-search",
      },
      {
        panelId: "delete-work-type-panel",
        selectBtnId: "delete-work-type-select-btn",
      },
      {
        panelId: "delete-project-panel",
        selectBtnId: "delete-project-select-btn",
      },
      { panelId: "duration-panel", selectBtnId: "duration-btn" },
      {
        panelId: "edit-modal-work-type-panel",
        selectBtnId: "edit-modal-work-type-btn",
        searchId: "edit-modal-work-type-search",
      },
      {
        panelId: "edit-modal-project-panel",
        selectBtnId: "edit-modal-project-btn",
        searchId: "edit-modal-project-search",
      },
      {
        panelId: "edit-modal-duration-panel",
        selectBtnId: "edit-modal-duration-btn",
      },
    ];

    dropdownConfigs.forEach((config) => {
      const selectBtn = document.getElementById(config.selectBtnId);
      const panel = document.getElementById(config.panelId);

      if (!selectBtn || !panel) return;

      selectBtn.addEventListener("click", (e) => {
        e.stopPropagation();

        const isCurrentlyHidden = panel.classList.contains("hidden");
        dropdownConfigs.forEach((otherConf) => {
          if (otherConf.panelId !== config.panelId) {
            document.getElementById(otherConf.panelId)?.classList.add("hidden");
          }
        });

        if (isCurrentlyHidden) {
          panel.classList.remove("hidden");
        } else {
          panel.classList.add("hidden");
        }
      });

      panel.addEventListener("click", (e) => e.stopPropagation());

      if (config.searchId) {
        const searchInput = document.getElementById(config.searchId);
        const optionsContainer = panel.querySelector(".overflow-y-auto");
        if (searchInput && optionsContainer) {
          searchInput.addEventListener("input", () => {
            const filter = searchInput.value.toLowerCase();
            for (const option of optionsContainer.children) {
              option.style.display = option.textContent
                .toLowerCase()
                .includes(filter)
                ? ""
                : "none";
            }
          });
        }
      }
    });

    document.addEventListener("click", () => {
      dropdownConfigs.forEach((config) => {
        document.getElementById(config.panelId)?.classList.add("hidden");
      });
    });

    const setupAdminAction = (btnId, valueSourceId, docId, action) => {
      const actionButton = document.getElementById(btnId);
      if (!actionButton) {
        console.error(`Button with ID ${btnId} not found.`);
        return;
      }

      actionButton.addEventListener("click", async () => {
        const isDelete = action === "delete";
        const valueElement = document.getElementById(valueSourceId);
        if (!valueElement) {
          console.error(`Value source with ID ${valueSourceId} not found.`);
          alert("เกิดข้อผิดพลาด: ไม่พบ Element สำหรับอ่านค่า");
          return;
        }

        const value = isDelete
          ? valueElement.textContent.trim()
          : valueElement.value.trim();

        if ((isDelete && value.includes("...")) || (!isDelete && !value)) {
          showNotification(
            isDelete ? "กรุณาเลือกรายการที่จะลบ" : "กรุณากรอกข้อมูล",
            "warning",
          );
          return;
        }

        if (isDelete) {
          showConfirmDialog(`คุณแน่ใจหรือไม่ว่าจะลบ "${value}"?`, async () => {
            try {
              actionButton.disabled = true;
              actionButton.classList.add("opacity-50");

              const docRef = db.collection("system_settings").doc(docId);
              const updateAction =
                firebase.firestore.FieldValue.arrayRemove(value);
              await docRef.update({ names: updateAction });

              showNotification(`ลบ "${value}" สำเร็จ!`, "success");
              await populateDropdownOptions();

              valueElement.textContent = `เลือก${docId === "workTypes" ? "ประเภทงาน" : "โครงการ"}ที่จะลบ...`;
              valueElement.classList.add("text-gray-500");
            } catch (error) {
              console.error(`Error deleting ${docId}:`, error);
              showNotification("เกิดข้อผิดพลาดในการลบ", "error");
            } finally {
              actionButton.disabled = false;
              actionButton.classList.remove("opacity-50");
            }
          });
        } else {
          try {
            actionButton.disabled = true;
            actionButton.classList.add("opacity-50");

            const docRef = db.collection("system_settings").doc(docId);
            const updateAction =
              firebase.firestore.FieldValue.arrayUnion(value);

            // [ของใหม่] ใช้ set + merge: true (สร้างใหม่ถ้าไม่มี, อัปเดตถ้ามี)
            await docRef.set({ names: updateAction }, { merge: true });

            showNotification(`เพิ่ม "${value}" สำเร็จ!`, "success");
            await populateDropdownOptions();
            valueElement.value = "";
          } catch (error) {
            console.error(`Error adding ${docId}:`, error);
            showNotification("เกิดข้อผิดพลาดในการเพิ่ม", "error");
          } finally {
            actionButton.disabled = false;
            actionButton.classList.remove("opacity-50");
          }
        }
      });
    };
    setupAdminAction(
      "add-work-type-btn",
      "add-work-type-input",
      "workTypes",
      "add",
    );
    setupAdminAction(
      "delete-work-type-btn",
      "delete-work-type-selected-text",
      "workTypes",
      "delete",
    );
    setupAdminAction("add-project-btn", "add-project-input", "projects", "add");
    setupAdminAction(
      "delete-project-btn",
      "delete-project-selected-text",
      "projects",
      "delete",
    );

    document
      .getElementById("duration-options")
      .addEventListener("click", (e) => {
        // ใช้ closest เพื่อหาตัวปุ่มที่แท้จริง (ป้องกันปัญหากดโดนขอบหรือไอคอนแล้วไม่ติด)
        const option = e.target.closest(".duration-option");

        if (option) {
          // ใช้ .trim() ตัดช่องว่างหน้าหลังออก เพื่อความชัวร์ในการเปรียบเทียบ
          const selectedValue = option.textContent.trim();

          // อัปเดตข้อความบนปุ่ม
          durationSelectedText.textContent = selectedValue;
          durationSelectedText.classList.remove("text-gray-500");

          // ซ่อน Panel
          document.getElementById("duration-panel").classList.add("hidden");
          // ตรวจสอบเงื่อนไขเปิด/ปิดช่องกรอกเวลา
          if (selectedValue === "SOME TIME") {
            customTimeInputs.classList.remove("hidden"); // แสดงช่องกรอกเวลา
          } else {
            customTimeInputs.classList.add("hidden"); // ซ่อนช่องกรอกเวลา
          }
        }
      });

    const adminSearchResultsContainer = document.getElementById(
      "search-results-container",
    );
    if (adminSearchResultsContainer) {
      adminSearchResultsContainer.addEventListener("click", (e) => {
        // ตรวจสอบว่าปุ่มที่คลิก (หรือแม่ของมัน) คือปุ่ม "แก้ไข" หรือไม่
        const editBtn = e.target.closest(".edit-record-btn");
        // ตรวจสอบว่าปุ่มที่คลิก (หรือแม่ของมัน) คือปุ่ม "เพิ่ม" หรือไม่
        const addBtn = e.target.closest(".add-record-btn");

        if (editBtn) {
          // ถ้าใช่ปุ่ม "แก้ไข"
          e.preventDefault(); // ป้องกันพฤติกรรมเริ่มต้น
          const docId = editBtn.dataset.docId;
          openEditModal(docId, null, null); // เรียก Modal โดยใช้ docId
        } else if (addBtn) {
          // ถ้าใช่ปุ่ม "เพิ่ม"
          e.preventDefault(); // ป้องกันพฤติกรรมเริ่มต้น
          const userId = addBtn.dataset.userId;
          const dateStr = addBtn.dataset.dateStr;
          openEditModal(null, userId, dateStr); // เรียก Modal โดยใช้ userId และ date
        }
      });
    }

    const leaveHistorySearchBtn = document.getElementById(
      "leave-history-search-btn",
    );
    if (leaveHistorySearchBtn) {
      leaveHistorySearchBtn.addEventListener("click", loadLeaveHistory);
    }

    // ผูก Event ปุ่มค้นหาประวัติ OT
    const otHistorySearchBtn = document.getElementById("ot-history-search-btn");
    if (otHistorySearchBtn) {
      otHistorySearchBtn.addEventListener("click", loadOtHistory);
    }

    // ค้นหาโค้ดส่วน Tab เดิม แล้วแทนที่ด้วยโค้ดชุดนี้
    const leaveTabNav = document.getElementById("leave-tab-nav");
    const otTabNav = document.getElementById("ot-tab-nav");

    // ฟังก์ชันสำหรับจัดการ Tab ทั้ง Leave และ OT
    const setupTabs = (navElement) => {
      if (!navElement) return;

      const tabs = navElement.querySelectorAll("a");
      const container = navElement.closest(".card");
      const contents = container.querySelectorAll(
        ".leave-tab-content, .ot-tab-content",
      );

      // ตรวจสอบ Theme สี (ฟ้า หรือ ส้ม)
      const isLeave = navElement.id === "leave-tab-nav";
      const activeTextColor = isLeave ? "text-blue-600" : "text-orange-600";

      tabs.forEach((tab) => {
        tab.addEventListener("click", (e) => {
          e.preventDefault();
          const targetId = tab.dataset.target;

          // 1. Reset Tabs
          tabs.forEach((t) => {
            t.className = `flex-1 py-2.5 text-sm font-medium text-center rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-200 transition-all duration-200`;
          });

          // 2. Hide All Contents
          contents.forEach((c) => {
            c.classList.add("hidden");
          });

          // 3. Set Active Tab Style
          tab.className = `flex-1 py-2.5 text-sm font-semibold text-center rounded-lg shadow bg-white ${activeTextColor} transition-all duration-200`;

          // 4. Show Target Content
          const targetContent = document.getElementById(targetId);
          if (targetContent) {
            targetContent.classList.remove("hidden");
          }
        });
      });
    };

    setupTabs(leaveTabNav);
    setupTabs(otTabNav);

    controlsInitialized = true;
  }

  const adminGoToCalendarBtn = document.getElementById(
    "admin-go-to-calendar-btn",
  );
  if (adminGoToCalendarBtn) {
    adminGoToCalendarBtn.addEventListener("click", () => {
      // 1. สั่งให้เปิดหน้าปฏิทิน
      showPage("calendar-page");

      // 2. โหลดข้อมูลปฏิทิน
      loadCalendarData(currentDisplayDate);

      // 3. อัปเดตแถบเมนูด้านล่าง
      navItems.forEach((n) => n.classList.remove("active"));
      // 3.1 หาปุ่มเมนูปฏิทิน (ปุ่มที่ 3)
      const dashboardNavButton = document.getElementById(
        "calendar-or-admin-nav",
      );
      if (dashboardNavButton) {
        dashboardNavButton.classList.add("active");
      }
    });
  }

  // 1. ตั้งค่าให้ Dropdown ใน Modal ทำงาน (เลือกแล้วเปลี่ยนข้อความ)
  const checkinDropdowns = [
    {
      panelId: "checkin-work-type-panel",
      selectBtnId: "checkin-work-type-btn",
      textId: "checkin-work-type-text",
      optionsId: "checkin-work-type-options",
    },
    {
      panelId: "checkin-project-panel",
      selectBtnId: "checkin-project-btn",
      textId: "checkin-project-text",
      optionsId: "checkin-project-options",
      searchId: "checkin-project-search",
    },
    {
      panelId: "checkin-duration-panel",
      selectBtnId: "checkin-duration-btn",
      textId: "checkin-duration-text",
      optionsId: "checkin-duration-options",
    },
  ];

  checkinDropdowns.forEach((config) => {
    const btn = document.getElementById(config.selectBtnId);
    const panel = document.getElementById(config.panelId);
    const textSpan = document.getElementById(config.textId);
    const optionsContainer = document.getElementById(config.optionsId);

    // เปิด/ปิด Dropdown
    if (btn)
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        panel.classList.toggle("hidden");
      });

    // เลือกรายการ
    if (optionsContainer) {
      optionsContainer.addEventListener("click", (e) => {
        if (e.target.tagName === "DIV") {
          textSpan.textContent = e.target.textContent;
          textSpan.classList.remove("text-gray-500");
          textSpan.classList.add("text-gray-800");
          panel.classList.add("hidden");
        }
      });
    }

    // ค้นหา (Search)
    if (config.searchId) {
      const searchInput = document.getElementById(config.searchId);
      if (searchInput) {
        searchInput.addEventListener("input", () => {
          const filter = searchInput.value.toLowerCase();
          for (let opt of optionsContainer.children) {
            opt.style.display = opt.textContent.toLowerCase().includes(filter)
              ? ""
              : "none";
          }
        });
      }
    }
  });

  // 2. ปุ่ม Cancel (ปิด Modal)
  document
    .getElementById("cancel-checkin-modal-btn")
    .addEventListener("click", () => {
      document.getElementById("checkin-report-modal").classList.add("hidden");
      // เปิดปุ่ม Check-in กลับมาให้กดใหม่ได้
      checkinBtn.disabled = false;
      const checkinSpan = checkinBtn.querySelector("span");
      if (checkinSpan) checkinSpan.textContent = "Check In";
    });

  function updateProfilePage(userData) {
    const profilePic = document.getElementById("profile-page-pic");
    const profileName = document.getElementById("profile-page-name");
    const profileDepartment = document.getElementById(
      "profile-page-department",
    );

    if (profilePic) {
      const placeholderLg =
        "https://placehold.co/150x150/E2E8F0/475569?text=User";
      profilePic.onerror = () => {
        profilePic.src = placeholderLg;
      };

      // [แก้ไข] เพิ่ม ?t=... เพื่อบังคับให้เบราว์เซอร์โหลดรูปใหม่ (Cache Busting)
      let imageUrl =
        userData.profileImageUrl || (currentUser && currentUser.photoURL);
      if (imageUrl) {
        // เพิ่ม timestamp ต่อท้าย URL
        profilePic.src = imageUrl + "?t=" + new Date().getTime();
      } else {
        profilePic.src = placeholderLg;
      }
    }
    if (profileName) {
      profileName.textContent = userData.fullName || "ชื่อผู้ใช้";
    }
    if (profileDepartment) {
      profileDepartment.textContent = userData.department || "ไม่มีข้อมูลแผนก";
    }
  }

  // เพิ่มฟังก์ชันนี้ลงใน index.html
  function viewEmployeeDetail(userId, startDate, endDate) {
    // 1. แจ้งเตือนเพื่อให้ Admin ทราบ
    showNotification("กำลังแสดงประวัติพนักงาน...", "info");

    // 2. สั่งให้ระบบเปลี่ยนหน้าไปที่ 'Timesheet Management'
    // และเลือก Tab 'Daily Audit'
    showPage("timesheet-management-page");

    // 3. คลิกที่แท็บ Audit ให้อัตโนมัติ (Trigger Tab Click)
    const auditTabBtn = document.querySelector(
      '.ts-tab-btn[data-target="tab-audit"]',
    );
    if (auditTabBtn) auditTabBtn.click();

    // 4. ตั้งค่าวันที่ในหน้า Audit ให้ตรงกับช่วงเวลาที่เลือกใน Payroll
    const auditDatePicker = document.getElementById("audit-date-picker");
    if (auditDatePicker) {
      // ตั้งค่าเป็นวันเริ่มต้นของช่วง Payroll เพื่อให้ Admin ไล่ดูได้ง่าย
      auditDatePicker.value = startDate;

      // สั่งให้โหลดข้อมูลหน้า Audit ทันที
      if (typeof loadDailyAuditData === "function") {
        loadDailyAuditData();
      }
    }

    console.log("Viewing Detail for:", userId, "Date:", startDate);
  }

  const provider = new firebase.auth.GoogleAuthProvider();
  // บังคับให้ Google แสดงหน้าต่างเลือกบัญชีทุกครั้ง
  provider.setCustomParameters({
    prompt: "select_account",
  });

  // [คงไว้] 2. ฟังก์ชันตรวจสอบมือถือ (ยังจำเป็น)
  function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent,
    );
  }

  function showPage(pageId) {
    pages.forEach((p) => p.classList.remove("active"));
    const activePage = document.getElementById(pageId);
    if (activePage) activePage.classList.add("active");
  }

  // [แก้ไข] --- โค้ด Event Listener สำหรับ Navigation ---
  // [FIXED] Navigation Logic แบบปลอดภัย
  navItems.forEach((item) => {
    item.addEventListener("click", (e) => {
      e.preventDefault();
      const pageId = item.dataset.page;

      // 1. หยุด GPS ถ้าไม่ใช่หน้าลงเวลา (เพื่อประหยัดแบต)
      if (pageId !== "check-in-out-page") {
        if (typeof stopWatchingPosition === "function") stopWatchingPosition();
      }

      // 2. ตรวจสอบสิทธิ์ Admin (ถ้าเข้าหน้า Dashboard หรือ Timesheet)
      if (
        (pageId === "admin-dashboard-page" ||
          pageId === "timesheet-management-page" ||
          pageId === "settings-page") && // ✨ เพิ่มหน้านี้เข้าไปด้วย
        (!currentUserData || currentUserData.role !== "admin")
      ) {
        alert("คุณไม่มีสิทธิ์เข้าถึงหน้านี้");
        return;
      }

      // 3. จัดการ Active Class (ไฮไลท์เมนู)
      navItems.forEach((n) => n.classList.remove("active"));
      document
        .querySelectorAll(`.nav-item[data-page="${pageId}"]`)
        .forEach((nav) => nav.classList.add("active"));

      // 4. แสดงหน้า
      if (typeof showPage === "function") showPage(pageId);

      // --- Logic เฉพาะของแต่ละหน้า ---
      // A. หน้าลงเวลา
      if (pageId === "check-in-out-page") {
        setMockPosition(null);
        if (checkinBtn) checkinBtn.disabled = true;
        if (locationStatusDiv)
          locationStatusDiv.className =
            "flex items-center p-3 rounded-xl bg-gray-100 text-gray-700";
        if (locationText) locationText.textContent = "กำลังตรวจสอบตำแหน่ง...";
        if (typeof startWatchingPosition === "function")
          startWatchingPosition();
      }

      // B. หน้า Report หรือ Dashboard หรือ Timesheet หน้า report หรือ Dashboard หรือ Timesheet
      if (
        pageId === "report-page" ||
        pageId === "admin-dashboard-page" ||
        pageId === "timesheet-management-page"
      ) {
        // ★ เพิ่มเงื่อนไข: รันฟังก์ชันเหล่านี้เฉพาะคนที่เป็น Admin เท่านั้น
        if (currentUserData && currentUserData.role === "admin") {
          loadAllUsersForDropdown();
          if (typeof loadPendingLeaveRequests === "function")
            loadPendingLeaveRequests();
          if (typeof loadPendingOtRequests === "function")
            loadPendingOtRequests();

          // เพิ่มโค้ด 4 บรรทัดนี้ เพื่อสั่งให้โหลดข้อมูลตาราง Audit และ Timeline ครับ
          if (pageId === "timesheet-management-page") {
            if (typeof loadTimelineData === "function") loadTimelineData();
            if (typeof loadDailyAuditData === "function")
              loadDailyAuditData(currentUser, currentUserData);
          }

          // ★★★ Safety Check สำหรับ Admin UI ★★★
          const summaryContainer = document.getElementById(
            "employee-summary-container-admin",
          );
          if (summaryContainer) {
            summaryContainer.innerHTML =
              '<p class="text-sm text-center text-gray-400 py-4">กรุณาเลือกช่วงวันที่และกด "แสดงข้อมูล"</p>';
          }

          const pagination = document.getElementById(
            "summary-pagination-controls",
          );
          if (pagination) {
            pagination.innerHTML = "";
          }
        }
        // ถ้าไม่ใช่ Admin ระบบจะข้ามไปเลย ไม่เกิด Error ใน Console ครับ
      }

      // C. หน้าปฏิทิน
      if (pageId === "calendar-page") {
        if (
          typeof loadCalendarData === "function" &&
          typeof currentDisplayDate !== "undefined"
        ) {
          loadCalendarData(currentDisplayDate);
        }
        const adminControls = document.getElementById(
          "admin-calendar-controls-card",
        );
        if (adminControls) {
          if (currentUserData && currentUserData.role === "admin") {
            adminControls.classList.remove("hidden");
            if (typeof loadCalendarRules === "function") loadCalendarRules();
          } else {
            adminControls.classList.add("hidden");
          }
        }
      }

      if (pageId === "settings-page") {
        // ใช้ฟังก์ชันที่มีอยู่จริงในไฟล์ของคุณเพื่อโหลดข้อมูล Project และ Work Type
        if (typeof populateDropdownOptions === "function") {
          loadRoleManagement();
        }

        // เรียกฟังก์ชันจัดการ Role ที่เราสร้างใหม่
        if (typeof loadRoleManagement === "function") {
          loadRoleManagement();
        }
      }

      // D. หน้า Profile
      if (pageId === "profile-page") {
        if (typeof loadWorkHistory === "function") loadWorkHistory();
        if (currentUser) {
          db.collection("users")
            .doc(currentUser.uid)
            .get()
            .then((doc) => {
              if (doc.exists && typeof updateProfilePage === "function") {
                updateProfilePage(doc.data());
              }
            });
        }
      }
    });
  });

  const historyRangeSelect = document.getElementById("history-range-select");
  if (historyRangeSelect) {
    historyRangeSelect.addEventListener("change", loadWorkHistory);
  }

  function resetReportForm() {
    workTypeSelectedText.textContent = "Select Detail...";
    workTypeSelectedText.classList.add("text-gray-500");
    projectSelectedText.textContent = "Select Project NO";
    projectSelectedText.classList.add("text-gray-500");
    durationSelectedText.textContent = "Select Period...";
    durationSelectedText.classList.add("text-gray-500");
    customTimeInputs.classList.add("hidden");
    customTimeStartInput.value = "";
    customTimeEndInput.value = "";
  }

  async function loadSentReports() {
    // 1. ตรวจสอบความพร้อมของข้อมูล (ป้องกัน Console Error)
    if (!currentUser || !currentUser.uid || !currentUserData) {
      return; // หยุดทำงานถ้าข้อมูล User ยังไม่พร้อม
    }

    const container = document.getElementById("sent-reports-container");
    if (!container) return;

    // 2. ระบุวันที่ (ถ้าไม่มีให้ใช้วันที่ปัจจุบัน)
    const selectedDate = reportDateInput.value || toLocalDateKey(new Date());
    const docId = `${currentUser.uid}_${selectedDate}`;

    // แสดง Loading สั้นๆ
    container.innerHTML = `
        <div class="flex justify-center py-8">
            <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-sky-500"></div>
        </div>
    `;

    try {
      // 3. ดึงข้อมูลจาก work_records
      const doc = await db.collection("work_records").doc(docId).get();
      let htmlContent = "";

      if (doc.exists) {
        const data = doc.data();
        // ตรวจสอบทั้งอาเรย์ใหม่ (reports) และฟิลด์เก่า (report) เพื่อความยืดหยุ่น
        const reportsArray = data.reports || (data.report ? [data.report] : []);

        if (reportsArray.length > 0) {
          reportsArray.forEach((item, index) => {
            // แปลง object เป็น string เพื่อใช้ใน function ลบ
            const itemData = JSON.stringify(item).replace(/"/g, "&quot;");

            htmlContent += `
                        <div class="card !p-4 border-l-4 border-sky-400 mb-3 shadow-sm bg-white relative group">
                            <div class="flex justify-between items-start mb-2">
                                <span class="bg-sky-100 text-sky-700 text-[10px] px-2 py-0.5 rounded-full font-bold">
                                    No.${index + 1}
                                </span>
                                <button class="delete-report-btn text-gray-300 hover:text-red-500 transition-colors" 
                                        onclick="deleteReportItem('${docId}', ${item.id || index})">
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
          htmlContent = `<div class="text-center py-8 text-gray-400 text-sm">ยังไม่มีรายงานสำหรับวันนี้</div>`;
        }
      } else {
        htmlContent = `<div class="text-center py-8 text-gray-400 text-sm">ยังไม่มีรายงานสำหรับวันนี้</div>`;
      }
      container.innerHTML = htmlContent;
    } catch (error) {
      console.error("Error loading reports:", error);
      container.innerHTML = `<div class="text-center py-8 text-red-400 text-sm">โหลดข้อมูลไม่สำเร็จ</div>`;
    }
  }

  // ฟังก์ชันเสริมแสดงสถานะไม่มีข้อมูลให้ดูสวยงาม
  function showEmptyState() {
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

  function updateClock() {
    if (timeElement) {
      const now = new Date();
      timeElement.textContent = now.toLocaleTimeString("th-TH", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    }
  }
  setInterval(updateClock, 1000);
  updateClock();

  // 3. เพิ่ม Event Listener ให้ปุ่ม
  document.getElementById("cal-prev-month").addEventListener("click", () => {
    currentDisplayDate.setMonth(currentDisplayDate.getMonth() - 1);
    loadCalendarData(currentDisplayDate);
  });

  document.getElementById("cal-next-month").addEventListener("click", () => {
    currentDisplayDate.setMonth(currentDisplayDate.getMonth() + 1);
    loadCalendarData(currentDisplayDate);
  });

  const openLeaveModal = () => {
    if (leaveRequestModal) {
      leaveRequestModal.classList.remove("hidden");
    }
  };

  // ฟังก์ชันปิด Modal และล้างฟอร์ม (แก้ไข)
  // ฟังก์ชันปิด Modal และล้างฟอร์ม (แก้ไข)
  const closeLeaveModal = () => {
    if (leaveRequestModal) {
      leaveRequestModal.classList.add("hidden");
      // ล้างค่าในฟอร์ม
      leaveTypeSelect.value = "";
      leaveStartDate.value = "";
      leaveEndDate.value = "";
      leaveReason.value = "";

      // [ใหม่] รีเซ็ตค่าใหม่
      leaveDurationType.value = "full_day"; // กลับไปเป็นค่าเริ่มต้น
      leaveDurationType.disabled = false; // [เพิ่ม] ปลดล็อค dropdown เสมอเมื่อปิด
      leaveStartTime.value = "";
      leaveEndTime.value = "";

      // [ใหม่] รีเซ็ตการแสดงผล
      leaveEndDateWrapper.classList.remove("hidden");
      leaveHourlyInputsWrapper.classList.add("hidden");

      // [ลบส่วนที่เป็นบั๊กออกแล้ว]
    }
  };

  // --- [แก้ไข] ย้าย Event Listeners ของฟอร์มลาออกมาไว้ข้างนอก ---

  // [Fix 1] ฟังก์ชันสำหรับสลับการแสดงผล (Full Day/Hourly)
  const handleDurationToggle = () => {
    const durationType = leaveDurationType.value;
    if (durationType === "hourly") {
      leaveEndDateWrapper.classList.add("hidden");
      leaveHourlyInputsWrapper.classList.remove("hidden");
      // ตั้งวันที่สิ้นสุดให้เป็นวันเดียวกับวันที่เริ่ม
      leaveEndDate.value = leaveStartDate.value;
      leaveStartTime.value = "08:30";
    } else {
      // 'full_day'
      leaveEndDateWrapper.classList.remove("hidden");
      leaveHourlyInputsWrapper.classList.add("hidden");
      // ล้างค่าเวลา (เผื่อไว้)
      leaveStartTime.value = "";
      leaveEndTime.value = "";
    }
  };

  // [Fix 1] ผูก Event Listener ของ leaveDurationType (สลับวัน/ชั่วโมง) *เพียงครั้งเดียว*
  if (leaveDurationType) {
    leaveDurationType.addEventListener("change", handleDurationToggle);
  }

  // [Fix 1] ผูก Event Listener ของ leaveStartDate (สำหรับโหมด Hourly) *เพียงครั้งเดียว*
  if (leaveStartDate) {
    leaveStartDate.addEventListener("change", () => {
      if (leaveDurationType.value === "hourly") {
        leaveEndDate.value = leaveStartDate.value;
      }
    });
  }

  // [Fix 2] ฟังก์ชันสำหรับจำกัดการลา "รายชั่วโมง" (Feature Request)
  const handleLeaveTypeChange = () => {
    const selectedType = leaveTypeSelect.value;

    // [แก้ไข] เพิ่ม 'sick' (ลาป่วย) เข้าไปในเงื่อนไข
    if (selectedType === "personal" || selectedType === "sick") {
      // ถ้าเป็น "ลากิจ" หรือ "ลาป่วย" -> ปลดล็อค dropdown
      leaveDurationType.disabled = false;
    } else {
      // ถ้าเป็นประเภทอื่น (พักร้อน, คลอด)
      // 1. บังคับให้เป็น "เต็มวัน"
      leaveDurationType.value = "full_day";
      // 2. ล็อค dropdown
      leaveDurationType.disabled = true;

      // 3. (สำคัญ) เรียกใช้ handleDurationToggle() เพื่อซ่อนช่องรายชั่วโมง
      //    (เผื่อว่าก่อนหน้านี้มันถูกเปิดค้างไว้)
      handleDurationToggle();
    }
  };

  // [Fix 2] ผูก Event Listener ของ leaveTypeSelect (เลือกประเภทการลา) *เพียงครั้งเดียว*
  if (leaveTypeSelect) {
    leaveTypeSelect.addEventListener("change", handleLeaveTypeChange);
  }

  // นี่คือวิธีที่ปลอดภัยกว่า หากปุ่มถูกสร้างทีหลัง หรืออยู่ในหน้าที่ยังไม่ active
  document.body.addEventListener("click", function (event) {
    // เช็กว่าสิ่งที่คลิกคือปุ่มยื่นใบลา (ทั้ง ID เดิม และ ID ใหม่ใน Profile)
    if (
      event.target.closest("#show-leave-form-btn") ||
      event.target.closest("#show-leave-form-btn-profile")
    ) {
      openLeaveModal();
    }
  });

  if (cancelLeaveBtn) {
    cancelLeaveBtn.addEventListener("click", closeLeaveModal);
  }
  if (leaveOverlay) {
    leaveOverlay.addEventListener("click", closeLeaveModal);
  }

  // 3. เพิ่ม Event Listener หลัก (ใช้ Event Delegation)
  document
    .getElementById("cal-grid")
    .addEventListener("click", showCalendarDetails);
  document
    .getElementById("cal-details-container")
    .addEventListener("click", handleCalendarDetailClick);

  // --- จบส่วนโค้ด Details ---

  saveEditBtn.addEventListener("click", async () => {
    const docId = editDocIdInput.value;
    const checkinStr = editCheckinTimeInput.value;
    const checkoutStr = editCheckoutTimeInput.value;

    if (!docId || !checkinStr) {
      alert("ข้อมูล ID หรือ เวลา Check-in ไม่ถูกต้อง");
      return;
    }

    saveEditBtn.disabled = true;
    saveEditBtn.textContent = "กำลังบันทึก...";

    try {
      // ดึง userId และ dateKey จาก docId
      const [userId, dateKey] = docId.split("_");
      const baseDate = new Date(dateKey + "T00:00:00"); // ใช้วันที่จาก docId เป็นหลัก

      // --- 1. รวบรวมข้อมูล Report ---
      const workType = editModalWorkTypeSelectedText.textContent;
      const project = editModalProjectSelectedText.textContent;
      let duration = editModalDurationSelectedText.textContent;

      if (duration === "SOME TIME") {
        const startTime = editModalCustomTimeStartInput.value;
        const endTime = editModalCustomTimeEndInput.value;

        if (startTime && endTime) {
          // บันทึกรูปแบบเวลา เช่น "09:00 - 11:00"
          duration = `${startTime} - ${endTime}`;
        } else {
          // 1. เปลี่ยนข้อความเป็นภาษาอังกฤษ เพื่อไม่ให้ UI กลับเป็นไทย
          duration = "SOME TIME (Incomplete)";

          // 2. (แนะนำ) เพิ่มการแจ้งเตือนให้ผู้ใช้กรอกเวลาให้ครบ และหยุดการทำงานไม่ให้บันทึก
          if (typeof showNotification === "function") {
            showNotification(
              "Please select both start and end times.",
              "warning",
            );
          } else {
            alert("Please select both start and end times.");
          }
          return; // หยุดการทำงานของฟังก์ชันบันทึกทันทีเพื่อให้ผู้ใช้ไปแก้เวลาก่อน
        }
      }

      const reportData = {
        workType: workType.includes("...") ? null : workType,
        project: project.includes("...") ? null : project,
        duration: duration.includes("...") ? null : duration,
        submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
      };

      // --- 2. ตรวจสอบว่าเป็นการ "เพิ่มใหม่" หรือ "แก้ไข" ---
      const workRecordRef = db.collection("work_records").doc(docId);
      const doc = await workRecordRef.get();
      let isCreatingNew = !doc.exists;

      let dataToSave = {};
      const checkinTimestamp = firebase.firestore.Timestamp.fromDate(
        new Date(checkinStr),
      );
      const checkoutTimestamp = checkoutStr
        ? firebase.firestore.Timestamp.fromDate(new Date(checkoutStr))
        : null;

      if (isCreatingNew) {
        // --- 3A. Logic สำหรับ "การสร้างใหม่" (Add) ---
        dataToSave = {
          userId: userId,
          date: firebase.firestore.Timestamp.fromDate(baseDate), // ใช้วันที่ที่เลือก
          checkIn: {
            timestamp: checkinTimestamp,
            location: null, // Admin add, no location
            accuracy: null,
            workType: "in_factory", // Default for admin
            onSiteDetails: editOnsiteDetailsInput.value || null,
            photoUrl: null,
          },
          checkOut: checkoutTimestamp
            ? {
                timestamp: checkoutTimestamp,
                location: null,
              }
            : null,
          status: checkoutTimestamp ? "completed" : "checked_in",
          report: reportData.workType ? reportData : null, // เพิ่ม report ถ้ามีการกรอก
          overtime: null, // ต้องคำนวณ
        };

        // คำนวณ OT ถ้าสถานะเป็น completed
        if (dataToSave.status === "completed") {
          const { regularWorkHours, overtimeHours } = calculateWorkHours(
            new Date(checkinStr),
            new Date(checkoutStr),
          );
          dataToSave.overtime = { hours: overtimeHours };
        }

        // ใช้ .set() สำหรับการสร้างเอกสารใหม่
        await workRecordRef.set(dataToSave);
      } else {
        // --- 3B. Logic สำหรับ "การแก้ไข" (Edit) ---
        const existingRecord = doc.data();

        // ใช้ .update() เพื่อ merge ข้อมูล, ป้องกันข้อมูลเดิม (เช่น location) หาย
        dataToSave = {
          "checkIn.timestamp": checkinTimestamp,
          "checkIn.onSiteDetails": editOnsiteDetailsInput.value || null, // อัปเดต onSiteDetails
          checkOut: checkoutTimestamp
            ? {
                timestamp: checkoutTimestamp,
                location: existingRecord.checkOut?.location || null, // ใช้ location เดิมถ้ามี
              }
            : null,
          status: checkoutTimestamp ? "completed" : "checked_in",
          report: reportData.workType ? reportData : existingRecord.report, // อัปเดต report
        };

        // คำนวณ OT ถ้าสถานะเป็น completed
        if (dataToSave.status === "completed") {
          const { regularWorkHours, overtimeHours } = calculateWorkHours(
            new Date(checkinStr),
            new Date(checkoutStr),
          );
          dataToSave["overtime"] = { hours: overtimeHours }; // อัปเดต field overtime
        } else {
          dataToSave["overtime"] = null; // ล้างค่า OT ถ้า check-out ถูกลบ
        }

        // ใช้ .update() สำหรับการแก้ไขเอกสารเดิม
        await workRecordRef.update(dataToSave);
      }

      // --- 4. Success ---
      showNotification("บันทึกข้อมูลสำเร็จ!", "success");
      editModal.classList.add("hidden");
      searchRecordBtn.click(); // กดค้นหาอีกครั้งเพื่อรีเฟรชข้อมูลที่แสดง
    } catch (error) {
      console.error("Error saving record:", error);
      showNotification("เกิดข้อผิดพลาด: " + error.message, "error");
    } finally {
      saveEditBtn.disabled = false;
      saveEditBtn.textContent = "บันทึกการแก้ไข";
    }
  });

  // เพิ่ม Event Listener ให้ปุ่ม Cancel (โค้ดนี้น่าจะมีอยู่แล้ว)
  cancelEditBtn.addEventListener("click", () => {
    editModal.classList.add("hidden");
  });

  // 2. ฟังก์ชันสำหรับโหลดรายชื่อพนักงาน
  // [ปรับปรุง] --- 2. ฟังก์ชันสำหรับโหลดรายชื่อพนักงาน ---
  // [FIXED] ฟังก์ชันโหลดรายชื่อพนักงาน แบบปลอดภัย (Safety Check)
  async function loadAllUsersForDropdown() {
    // 1. ดึง Element ทั้งหมด (เพิ่ม statUserSelect เข้ามา)
    const editUserSelect = document.getElementById("edit-user-select");
    const summaryEmployeeSelect = document.getElementById(
      "summary-employee-select",
    );
    const leaveHistoryUserSelect = document.getElementById(
      "leave-history-user-filter",
    );
    const otHistoryUserSelect = document.getElementById(
      "ot-history-user-filter",
    );
    const statUserSelect = document.getElementById("summary-stat-user-select"); // << เพิ่มบรรทัดนี้

    try {
      const usersSnapshot = await db
        .collection("users")
        .orderBy("fullName")
        .get();

      // 2. ฟังก์ชันย่อย: ช่วยเคลียร์ค่าและใส่ค่าเริ่มต้น (ถ้า Element มีอยู่จริง)
      const safeReset = (element, defaultText) => {
        if (element)
          element.innerHTML = `<option value="">${defaultText}</option>`;
      };

      // รีเซ็ตทุก Dropdown
      safeReset(editUserSelect, "--- เลือกพนักงาน ---");
      safeReset(summaryEmployeeSelect, "พนักงานทั้งหมด");
      safeReset(leaveHistoryUserSelect, "พนักงานทั้งหมด");
      safeReset(otHistoryUserSelect, "พนักงานทั้งหมด");
      safeReset(statUserSelect, "--- เลือกพนักงาน ---"); // << ตอนนี้จะไม่ Error แล้ว

      // 3. วนลูปใส่รายชื่อพนักงาน
      usersSnapshot.forEach((doc) => {
        const user = doc.data();
        const optionText = user.fullName || doc.id;
        const optionValue = doc.id;

        const safeAppend = (element) => {
          if (element) {
            const option = document.createElement("option");
            option.value = optionValue;
            option.textContent = optionText;
            element.appendChild(option);
          }
        };

        // ใส่รายชื่อลงในทุก Dropdown
        safeAppend(editUserSelect);
        safeAppend(summaryEmployeeSelect);
        safeAppend(leaveHistoryUserSelect);
        safeAppend(otHistoryUserSelect);
        safeAppend(statUserSelect); // << เพิ่มบรรทัดนี้เพื่อให้ชื่อไปโผล่ในหน้า Summary
      });
    } catch (error) {
      console.error("Error loading users:", error);
    }
  }

  // 5. [ปรับปรุง] ฟังก์ชันเปิด Modal และดึงข้อมูล (รวม Report)
  async function openEditModal(docId, newUserId, newDateStr) {
    try {
      let record = {};
      let report = {};
      let checkinDate = null;
      let checkoutDate = null;
      let finalDocId = docId;

      if (docId) {
        // --- Case 1: แก้ไข (Logic เดิม) ---
        const workRecordDoc = await db
          .collection("work_records")
          .doc(docId)
          .get();
        if (!workRecordDoc.exists) {
          alert("ไม่พบข้อมูลที่จะแก้ไข");
          return;
        }
        record = workRecordDoc.data();
        report = record.report || {};
        checkinDate = record.checkIn.timestamp.toDate();
        checkoutDate = record.checkOut
          ? record.checkOut.timestamp.toDate()
          : null;
      } else {
        // --- Case 2: เพิ่มใหม่ (Logic ใหม่) ---
        finalDocId = `${newUserId}_${newDateStr}`; // ตั้ง ID ที่จะสร้าง

        // ตั้งเวลาเริ่มต้น 08:30 และ 17:30 ของวันที่เลือก
        const defaultCheckin = new Date(`${newDateStr}T08:30:00`);
        const defaultCheckout = new Date(`${newDateStr}T17:30:00`);

        checkinDate = defaultCheckin;
        checkoutDate = defaultCheckout;

        // report กับ record.checkIn.onSiteDetails จะเป็น object ว่าง
      }
      // --- เติมข้อมูลลง Modal (ใช้ร่วมกันทั้ง 2 กรณี) ---
      editDocIdInput.value = finalDocId;
      editCheckinTimeInput.value = toLocalISOString(checkinDate);
      editCheckoutTimeInput.value = toLocalISOString(checkoutDate);
      editOnsiteDetailsInput.value = record.checkIn?.onSiteDetails || "";

      // เติมข้อมูล Report
      if (report.workType) {
        editModalWorkTypeSelectedText.textContent = report.workType;
        editModalWorkTypeSelectedText.classList.remove("text-gray-500");
      } else {
        editModalWorkTypeSelectedText.textContent = "--- เลือกประเภทงาน ---";
        editModalWorkTypeSelectedText.classList.add("text-gray-500");
      }

      if (report.project) {
        editModalProjectSelectedText.textContent = report.project;
        editModalProjectSelectedText.classList.remove("text-gray-500");
      } else {
        editModalProjectSelectedText.textContent = "--- เลือกโครงการ ---";
        editModalProjectSelectedText.classList.add("text-gray-500");
      }

      // Logic การตั้งค่า Duration
      editModalCustomTimeInputs.classList.add("hidden");
      const standardDurations = [
        "ทั้งวัน (08:30 - 17:30)",
        "ครึ่งวันเช้า (08:30 - 12:00)",
        "ครึ่งวันบ่าย (13:00 - 17:30)",
      ];
      if (report.duration) {
        if (standardDurations.includes(report.duration)) {
          editModalDurationSelectedText.textContent = report.duration;
          editModalDurationSelectedText.classList.remove("text-gray-500");
        } else {
          editModalDurationSelectedText.textContent = "กำหนดเวลา";
          editModalDurationSelectedText.classList.remove("text-gray-500");
          editModalCustomTimeInputs.classList.remove("hidden");
          const times = report.duration.split(" - ");
          if (times.length === 2) {
            editModalCustomTimeStartInput.value = times[0];
            editModalCustomTimeEndInput.value = times[1];
          } else {
            editModalCustomTimeStartInput.value = "";
            editModalCustomTimeEndInput.value = "";
          }
        }
      } else {
        // [แก้ไข] ถ้าเป็นการเพิ่มใหม่ ให้ตั้งค่าเริ่มต้นเป็น "ทั้งวัน"
        if (!docId) {
          editModalDurationSelectedText.textContent = "ทั้งวัน (08:30 - 17:30)";
          editModalDurationSelectedText.classList.remove("text-gray-500");
        } else {
          editModalDurationSelectedText.textContent = "--- เลือกระยะเวลา ---";
          editModalDurationSelectedText.classList.add("text-gray-500");
        }
        editModalCustomTimeStartInput.value = "";
        editModalCustomTimeEndInput.value = "";
      }

      editModal.classList.remove("hidden");
    } catch (error) {
      console.error("Error opening modal:", error);
      alert("เกิดข้อผิดพลาดในการเปิดหน้าแก้ไข");
    }
  }

  // [NEW FUNCTION] Load and display daily leave notifications

  // ฟังก์ชันโหลดข้อมูลรายงานตามวันที่เลือก (ฉบับสมบูรณ์)
  // ฟังก์ชันโหลดข้อมูลรายงาน (ฉบับใช้ปุ่มสีฟ้าเดิม)
  async function loadReportForSelectedDate() {
    if (!currentUser) return;

    const selectedDate = reportDateInput.value;
    if (!selectedDate) return;

    const docId = `${currentUser.uid}_${selectedDate}`;

    saveReportBtn.textContent = "Checking records...";
    saveReportBtn.disabled = true;

    try {
      const doc = await db.collection("work_records").doc(docId).get();

      // ล้างฟอร์มเป็นภาษาอังกฤษก่อน
      resetReportForm();

      saveReportBtn.className = "btn-primary w-full py-3 text-base";

      if (doc.exists && doc.data().report) {
        const report = doc.data().report;

        // ใส่ข้อมูลเก่ากลับเข้าไป (ใช้ภาษาอังกฤษ)
        workTypeSelectedText.textContent =
          report.workType || "Select Detail...";
        if (report.workType)
          workTypeSelectedText.classList.remove("text-gray-500");

        projectSelectedText.textContent = report.project || "Select Project NO";
        if (report.project)
          projectSelectedText.classList.remove("text-gray-500");

        // เช็คระยะเวลา
        const standardDurations = [
          "ALL (08:30 - 17:30)",
          "HALF DAY (08:30 - 12:00)",
          "HALF DAY (13:00 - 17:30)",
        ];

        if (report.duration && !standardDurations.includes(report.duration)) {
          durationSelectedText.textContent = "SOME TIME";
          durationSelectedText.classList.remove("text-gray-500");
          customTimeInputs.classList.remove("hidden");

          const times = report.duration.split(" - ");
          if (times.length === 2) {
            customTimeStartInput.value = times[0];
            customTimeEndInput.value = times[1];
          }
        } else {
          durationSelectedText.textContent =
            report.duration || "Select Period...";
          if (report.duration)
            durationSelectedText.classList.remove("text-gray-500");
        }

        saveReportBtn.textContent = "Update Report";
      } else {
        saveReportBtn.textContent = "Save Report";
      }
    } catch (error) {
      console.error("Error loading report:", error);
    } finally {
      saveReportBtn.disabled = false;
    }
  }

  // เพิ่ม Event Listener เมื่อเปลี่ยนวันที่
  if (reportDateInput) {
    reportDateInput.addEventListener("change", loadReportForSelectedDate);
  }

  if (reportDateInput) {
    reportDateInput.addEventListener("change", () => {
      loadSentReports(); // เมื่อเปลี่ยนวันที่ ให้โหลดรายงานของวันนั้นใหม่ทันที
    });
  }

  // --- 2. Logic ฝั่ง Leader (สร้างห้อง) ---
  const roomQrContainer = document.getElementById("room-qr-container");
  const roomMembersList = document.getElementById("room-members-list");

  // 6. Logic สำหรับ Tab Timesheet (Summary) - Reusing existing function concept
  const tsSummaryLoadBtn = document.getElementById("ts-summary-load-btn");
  if (tsSummaryLoadBtn) {
    tsSummaryLoadBtn.addEventListener("click", async () => {
      // ตรงนี้คุณสามารถ reuse ฟังก์ชัน loadEmployeeSummary ที่มีอยู่ได้
      // หรือเขียน logic ดึงข้อมูลมาแสดงเป็นตาราง Table ง่ายๆ ตรงนี้ครับ
      const start = document.getElementById("ts-summary-start").value;
      const end = document.getElementById("ts-summary-end").value;
      if (!start || !end) return alert("กรุณาเลือกวัน");

      // ตัวอย่างการเรียกใช้ (ถ้าคุณอยาก reuse ของเดิม ให้ copy logic มาแปะ)
      alert("ฟังก์ชันนี้จะแสดงสรุปตั้งแต่วันที่ " + start + " ถึง " + end);
    });
  }

  // --- Timesheet Table Logic ---
  // 1. ตั้งค่าเริ่มต้น
  const tsFilterStart = document.getElementById("ts-filter-start");
  const tsFilterEnd = document.getElementById("ts-filter-end");

  if (tsFilterStart && tsFilterEnd) {
    // Default: วันที่ 1 ถึง ปัจจุบัน ของเดือนนี้
    const date = new Date();
    const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
    tsFilterStart.value = firstDay.toISOString().split("T")[0];
    tsFilterEnd.value = date.toISOString().split("T")[0];
  }

  // --- [NEW] Daily Audit Logic (แก้ไขแล้ว) ---
  const auditDatePicker = document.getElementById("audit-date-picker");
  const auditTableBody = document.getElementById("audit-table-body");
  const auditFilterBtns = document.querySelectorAll(".audit-filter-btn");

  // สร้างตัวแปร Global ไว้ให้ dashboardService มองเห็น
  window.currentAuditFilter = "all";

  if (auditDatePicker) {
    // ตั้งค่าวันที่ปัจจุบัน (แต่ยังไม่สั่งดึงข้อมูลจนกว่าจะล็อกอินเสร็จ)
    auditDatePicker.value = new Date().toISOString().split("T")[0];

    // เมื่อมีการเปลี่ยนวันที่ด้วยตัวเอง
    auditDatePicker.addEventListener("change", () => {
      if (typeof loadDailyAuditData === "function")
        loadDailyAuditData(currentUser, currentUserData);
    });
  }

  // ผูกปุ่ม Filter
  auditFilterBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      // เปลี่ยนสีปุ่ม
      auditFilterBtns.forEach((b) => {
        b.classList.remove("bg-sky-600", "text-white");
        b.classList.add("bg-gray-100", "text-gray-600");
      });
      btn.classList.remove("bg-gray-100", "text-gray-600");
      btn.classList.add("bg-sky-600", "text-white");
      // ★ 1. ใช้ window. เพื่อให้ Service ไฟล์อื่นมองเห็น
      window.currentAuditFilter = btn.dataset.filter; 
      // ★ 2. ส่ง currentUser และ currentUserData ไปด้วยเสมอ!
      if (typeof loadDailyAuditData === "function") {
          loadDailyAuditData(currentUser, currentUserData); 
      }
    });
  });

  async function loadTimesheetSummary() {
    const userId = document.getElementById("summary-stat-user-select").value;
    const year = parseInt(
      document.getElementById("summary-stat-year-select").value,
    );
    const container = document.getElementById("summary-stat-results");

    if (!userId || !year) return;

    container.innerHTML = `<div class="flex justify-center py-20"><div class="animate-spin rounded-full h-10 w-10 border-b-2 border-sky-500"></div></div>`;

    const startOfYear = new Date(year, 0, 1);
    const endOfYear = new Date(year, 11, 31, 23, 59, 59);

    try {
      // 1. ดึงข้อมูลบันทึกเวลา
      const recordsSnap = await db
        .collection("work_records")
        .where("userId", "==", userId)
        .where("date", ">=", startOfYear)
        .where("date", "<=", endOfYear)
        .get();

      // 2. ดึงข้อมูลการลาที่อนุมัติแล้ว
      const leavesSnap = await db
        .collection("leave_requests")
        .where("userId", "==", userId)
        .where("status", "==", "approved")
        .where(
          "startDate",
          ">=",
          firebase.firestore.Timestamp.fromDate(startOfYear),
        )
        .where(
          "startDate",
          "<=",
          firebase.firestore.Timestamp.fromDate(endOfYear),
        )
        .get();

      let stats = { late: 0, ot: 0, sick: 0, annual: 0, absent: 0 };

      recordsSnap.forEach((doc) => {
        const data = doc.data();

        // ★★★ แก้ไข: เพิ่มการตรวจสอบว่ามี checkIn จริงๆ ก่อนดึงเวลา ★★★
        if (data.checkIn && data.checkIn.timestamp) {
          const cin = data.checkIn.timestamp.toDate();

          // เช็คสายหลัง 08:30
          if (
            cin.getHours() > 8 ||
            (cin.getHours() === 8 && cin.getMinutes() > 30)
          ) {
            stats.late++;
          }
        }

        // เก็บ OT (แยกออกมาเช็คต่างหาก เผื่อเคสที่มี OT แต่ไม่มี Check-in หรือโครงสร้างแปลกๆ)
        if (data.overtime && typeof data.overtime.hours === "number") {
          stats.ot += data.overtime.hours;
        }
      });

      leavesSnap.forEach((doc) => {
        const data = doc.data();
        if (data.leaveType === "sick") stats.sick++;
        else stats.annual++;
      });

      // 3. Render Dashboard UI
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
            <div class="mt-6 p-4 bg-gray-50 rounded-xl border border-gray-100 flex items-center gap-3">
                <div class="p-2 bg-white rounded-lg shadow-sm font-bold text-sky-600 text-sm">i</div>
                <p class="text-xs text-gray-500 leading-relaxed">
                    ข้อมูลนี้สรุปจากการบันทึกเวลาจริงและใบลาที่ได้รับการอนุมัติแล้วเท่านั้น หากข้อมูลไม่ถูกต้อง กรุณาตรวจสอบการอนุมัติใบลาในระบบ
                </p>
            </div>
        `;
    } catch (e) {
      container.innerHTML = `<p class="text-center text-red-500">เกิดข้อผิดพลาด: ${e.message}</p>`;
    }
  }

  // ผูก Event เพิ่มเติมตอนเริ่มระบบ
  document
    .getElementById("summary-stat-user-select")
    ?.addEventListener("change", loadTimesheetSummary);
  document
    .getElementById("summary-stat-year-select")
    ?.addEventListener("change", loadTimesheetSummary);

  // เติมปีใน Dropdown (ย้อนหลัง 2 ปี ถึงปัจจุบัน)
  const yearSelect = document.getElementById("summary-stat-year-select");
  if (yearSelect) {
    const curYear = new Date().getFullYear();
    for (let y = curYear; y >= curYear - 2; y--) {
      const opt = document.createElement("option");
      opt.value = y;
      opt.textContent = `ปี ${y + 543}`;
      yearSelect.appendChild(opt);
    }
  }

  function updateToken() {
    messaging
      .getToken({
        vapidKey:
          "BE54Oa8UjJ0PUlUKsN879Qu27UdEyEMpq91Zd_VZeez403fM2xRAspp3XeUTl2iLSh90ip0uRXONGncKOIgw37s",
      })
      .then((currentToken) => {
        if (currentToken) {
          // บันทึกลง Firestore เสมอ
          // แม้ใน Function จะลบทิ้งไป แต่พอ User เปิดเว็บใหม่ Token ใหม่จะมาวางที่เดิมเอง
          db.collection("users").doc(auth.currentUser.uid).update({
            fcmToken: currentToken,
          });
        }
      });
  }

  // ฟังก์ชันสำหรับดูรายละเอียดรายคน (ต้องอยู่นอกฟังก์ชันอื่น)
  window.viewEmployeeDetail = function (userId, startDate, endDate) {
    console.log(
      "Viewing Detail for:",
      userId,
      "Range:",
      startDate,
      "to",
      endDate,
    );

    // 1. แจ้งเตือนผู้ใช้
    if (typeof showNotification === "function") {
      showNotification("กำลังเปิดประวัติการลงเวลา...", "info");
    }

    // 2. สลับไปหน้า Timesheet Management (Audit)
    if (typeof showPage === "function") {
      showPage("timesheet-management-page");
    }

    // 3. จำลองการคลิกแท็บ Audit
    const auditTabBtn = document.querySelector(
      '.ts-tab-btn[data-target="tab-audit"]',
    );
    if (auditTabBtn) auditTabBtn.click();

    // 4. ตั้งค่าวันที่ในหน้า Audit ให้ตรงกับที่เลือก
    const auditDatePicker = document.getElementById("audit-date-picker");
    if (auditDatePicker) {
      auditDatePicker.value = startDate;
      // สั่งโหลดข้อมูลทันที
      if (typeof loadDailyAuditData === "function") {
        loadDailyAuditData();
      }
    }
  };

  // ฟังก์ชันสำหรับโหลดรายชื่อพนักงานเข้า Dropdown ของ Payroll
  async function populatePayrollUserDropdown() {
    const userSelect = document.getElementById("payroll-search-name");
    if (!userSelect) return;

    try {
      // ดึงข้อมูลพนักงานทั้งหมดจาก collection 'users' เรียงตามชื่อ
      const snapshot = await db.collection("users").orderBy("fullName").get();

      // ล้างค่าเดิมก่อน (ยกเว้น option แรกที่เป็น "พนักงานทุกคน")
      userSelect.innerHTML = '<option value="">-- พนักงานทุกคน --</option>';

      snapshot.forEach((doc) => {
        const user = doc.data();
        const option = document.createElement("option");
        // ใช้ชื่อจริงเป็น Value เพื่อใช้ในการ Filter
        option.value = user.fullName.toLowerCase();
        option.textContent = user.fullName;
        userSelect.appendChild(option);
      });
      console.log("Payroll dropdown populated.");
    } catch (error) {
      console.error("Error populating user dropdown:", error);
    }
  }

  // ฟังก์ชันสำหรับโหลดชื่อแผนกที่ "มีอยู่จริง" เข้า Dropdown
  async function populatePayrollDeptDropdown() {
    const deptSelect = document.getElementById("payroll-filter-dept");
    if (!deptSelect) return;

    try {
      // 1. ดึงข้อมูลพนักงานทุกคน
      const snapshot = await db.collection("users").get();

      // 2. ใช้ Set เพื่อเก็บชื่อแผนกแบบไม่ให้ซ้ำกัน
      const departments = new Set();

      snapshot.forEach((doc) => {
        const userData = doc.data();
        if (userData.department) {
          // เก็บชื่อแผนกใส่ Set (จะถูกลบตัวที่ซ้ำออกให้อัตโนมัติ)
          departments.add(userData.department);
        }
      });

      // 3. ล้างค่าเดิมใน Dropdown (ยกเว้น "ทุกแผนก")
      deptSelect.innerHTML = '<option value="">-- ทุกแผนก --</option>';

      // 4. แปลง Set เป็น Array และเรียงลำดับตัวอักษร จากนั้นนำมาสร้าง Option
      Array.from(departments)
        .sort()
        .forEach((deptName) => {
          const option = document.createElement("option");
          option.value = deptName;
          option.textContent = deptName;
          deptSelect.appendChild(option);
        });

      console.log("Payroll department dropdown updated.");
    } catch (error) {
      console.error("Error loading departments:", error);
    }
  }

  // --- Dark Mode Logic ---
  const darkModeToggle = document.getElementById("dark-mode-toggle");
  const darkModeStatus = document.getElementById("dark-mode-status");

  // 1. ฟังก์ชันตรวจสอบและเริ่มใช้งานธีม
  function initTheme() {
    const savedTheme = localStorage.getItem("theme");

    // ถ้าเคยบันทึกว่าเป็น dark หรือ ไม่เคยบันทึกแต่เครื่องตั้งค่าเป็น dark mode ไว้
    if (
      savedTheme === "dark" ||
      (!savedTheme && window.matchMedia("(prefers-color-scheme: dark)").matches)
    ) {
      document.documentElement.setAttribute("data-theme", "dark");
      if (darkModeToggle) darkModeToggle.checked = true;
      updateDarkModeStatus(true);
    } else {
      document.documentElement.setAttribute("data-theme", "light");
      if (darkModeToggle) darkModeToggle.checked = false;
      updateDarkModeStatus(false);
    }
  }

  // 2. ฟังก์ชันอัปเดตข้อความสถานะ
  function updateDarkModeStatus(isDark) {
    if (!darkModeStatus) return;
    if (isDark) {
      darkModeStatus.textContent = "เปิดใช้งาน";
      darkModeStatus.classList.add("text-green-500");
    } else {
      darkModeStatus.textContent = "ปิดใช้งาน";
      darkModeStatus.classList.remove("text-green-500");
    }
  }

  // 3. Event Listener เมื่อกดปุ่ม Toggle
  if (darkModeToggle) {
    darkModeToggle.addEventListener("change", (e) => {
      if (e.target.checked) {
        document.documentElement.setAttribute("data-theme", "dark");
        localStorage.setItem("theme", "dark");
        updateDarkModeStatus(true);
      } else {
        document.documentElement.setAttribute("data-theme", "light");
        localStorage.setItem("theme", "light");
        updateDarkModeStatus(false);
      }
    });
  }

  // เรียกใช้งานทันทีเมื่อโหลดหน้าเว็บ
  initTheme();

  // 3. [เพิ่ม] ฟังก์ชันสำหรับค้นหาข้อมูลเมื่อคลิกปุ่ม
  searchRecordBtn.addEventListener("click", async () => {
    const userId = editUserSelect.value;
    const dateStr = editDateSelect.value; // YYYY-MM-DD

    if (!userId || !dateStr) {
      searchResultsContainer.innerHTML =
        '<p class="text-sm text-center text-red-500 py-2">กรุณาเลือกพนักงานและวันที่</p>';
      return;
    }

    searchResultsContainer.innerHTML =
      '<p class="text-sm text-center text-gray-500 py-2">กำลังค้นหาข้อมูล...</p>';

    try {
      const docId = `${userId}_${dateStr}`;
      const workRecordRef = db.collection("work_records").doc(docId);
      const doc = await workRecordRef.get();

      if (doc.exists) {
        // --- กรณีพบข้อมูล (เหมือนเดิม) ---
        const record = doc.data();
        const report = record.report || {};

        const checkinTime = record.checkIn.timestamp
          .toDate()
          .toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
        const checkoutTime = record.checkOut
          ? record.checkOut.timestamp.toDate().toLocaleTimeString("th-TH", {
              hour: "2-digit",
              minute: "2-digit",
            })
          : "-";
        const reportInfo = report.workType
          ? `${report.workType} (${report.project || "N/A"})`
          : "ยังไม่ส่งรายงาน";

        searchResultsContainer.innerHTML = `
                                <div class="p-4 bg-white rounded-xl border border-gray-200 shadow-sm">
                                    <div class="flex justify-between items-start">
                                        <p class="font-semibold text-gray-800">ข้อมูลที่พบ</p>
                                        <button data-doc-id="${doc.id}" class="edit-record-btn text-sm bg-sky-100 text-sky-700 font-semibold px-3 py-1 rounded-lg hover:bg-sky-200">
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
      } else {
        // --- [แก้ไข] กรณีไม่พบข้อมูล -> แสดงปุ่ม "เพิ่ม" ---
        searchResultsContainer.innerHTML = `
                                <p class="text-sm text-center text-yellow-600 py-2">ไม่พบข้อมูลการลงเวลาสำหรับผู้ใช้และวันที่ที่เลือก</p>
                                <button 
                                    data-user-id="${userId}" 
                                    data-date-str="${dateStr}" 
                                    class="add-record-btn mt-2 w-full btn-primary py-2 text-sm">
                                    + เพิ่มข้อมูลสำหรับวันนี้
                                </button>
                            `;
      }
    } catch (error) {
      console.error("Error searching record:", error);
      searchResultsContainer.innerHTML =
        '<p class="text-sm text-center text-red-500 py-2">เกิดข้อผิดพลาดในการค้นหา</p>';
    }
  });

  // ==========================================
  // 🌟 ผูก Event ปุ่มในหน้า Payroll (เชื่อมไปที่ Service)
  // ==========================================
  const generatePayrollBtn = document.getElementById(
    "generate-payroll-summary-btn",
  );
  if (generatePayrollBtn) {
    generatePayrollBtn.addEventListener("click", loadPayrollSummary);
  }

  const exportPayrollBtn = document.getElementById(
    "export-payroll-summary-btn",
  );
  if (exportPayrollBtn) {
    exportPayrollBtn.addEventListener("click", async () => {
      showNotification("กำลังเตรียมข้อมูล Excel...", "info");

      // เช็คว่าโหลด Library Excel มาหรือยัง ถ้ายังให้โหลดอัตโนมัติ
      if (typeof XLSX === "undefined") {
        try {
          const script = document.createElement("script");
          script.src =
            "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
          script.onload = () => exportPayrollSummaryToExcel();
          document.head.appendChild(script);
        } catch (e) {
          alert("โหลด Library ไม่สำเร็จ กรุณาเช็คอินเทอร์เน็ต");
        }
      } else {
        exportPayrollSummaryToExcel();
      }
    });
  }

  // ผูก Event ให้ช่องค้นหา/กรองแผนก (พิมพ์ปุ๊บ ค้นหาปั๊บ)
  const payrollSearchInput = document.getElementById("payroll-search-name");
  const payrollFilterDept = document.getElementById("payroll-filter-dept");

  if (payrollSearchInput)
    payrollSearchInput.addEventListener("input", loadPayrollSummary);
  if (payrollFilterDept)
    payrollFilterDept.addEventListener("change", loadPayrollSummary);

  // ==========================================
  // 🌟 ผูก Event สำหรับหน้า History (ประวัติและสถิติ) - แก้ปัญหาตัวแปรซ้ำ
  // ==========================================

  // ผูก Event แบบไม่สร้างตัวแปร (ใช้ ?. เพื่อเช็คว่ามีปุ่มนี้อยู่บนหน้าจอไหมก่อนผูก)
  document
    .getElementById("history-range-select")
    ?.addEventListener("change", loadWorkHistory);
  document
    .getElementById("leave-history-search-btn")
    ?.addEventListener("click", loadLeaveHistory);
  document
    .getElementById("ot-history-search-btn")
    ?.addEventListener("click", loadOtHistory);

  document
    .getElementById("summary-stat-user-select")
    ?.addEventListener("change", loadTimesheetSummary);
  document
    .getElementById("summary-stat-year-select")
    ?.addEventListener("change", loadTimesheetSummary);

  // ==========================================
  // 🌟 ผูก Event สำหรับปฏิทินและแผนงาน
  // ==========================================
  document.getElementById("cal-prev-month")?.addEventListener("click", () => {
    currentDisplayDate.setMonth(currentDisplayDate.getMonth() - 1);
    loadCalendarData(currentDisplayDate);
  });

  document.getElementById("cal-next-month")?.addEventListener("click", () => {
    currentDisplayDate.setMonth(currentDisplayDate.getMonth() + 1);
    loadCalendarData(currentDisplayDate);
  });

  document
    .getElementById("cal-grid")
    ?.addEventListener("click", showCalendarDetails);
  document
    .getElementById("cal-details-container")
    ?.addEventListener("click", handleCalendarDetailClick);

  // ส่วนของ Admin เพิ่มกฎปฏิทิน
  // ==========================================
  // 🌟 ส่วนของ Admin เพิ่มกฎปฏิทิน (แก้ปัญหาปุ่มหน่วง)
  // ==========================================
  const handleAddCalendarRuleAdapter = async (type, btnElement) => {
    const dateInput =
      document.getElementById("admin-calendar-date-input") ||
      document.getElementById("calendar-admin-date-input");
    const dateStr = dateInput?.value;

    if (!dateStr) return showNotification("กรุณาเลือกวันที่ก่อน", "warning");

    // 🟢 1. เติมลูกเล่น Loading ทันทีที่กดปุ่ม เพื่อลดความรู้สึกหน่วง
    const originalText = btnElement ? btnElement.innerHTML : "เพิ่ม";
    if (btnElement) {
      btnElement.disabled = true;
      btnElement.innerHTML = `<span class="animate-spin inline-block h-4 w-4 border-b-2 border-white rounded-full mr-2"></span>กำลังบันทึก...`;
    }

    try {
      // 2. บันทึกข้อมูล
      await db
        .collection("system_settings")
        .doc("calendar_rules")
        .set(
          {
            [type]: firebase.firestore.FieldValue.arrayUnion(dateStr),
          },
          { merge: true },
        );

      showNotification(`เพิ่มวันที่ ${dateStr} สำเร็จ`, "success");
      if (dateInput) dateInput.value = "";

      // 3. สั่งโหลด UI ใหม่
      if (typeof loadAndDisplayHolidays === "function")
        await loadAndDisplayHolidays();
      if (typeof loadCalendarRules === "function") loadCalendarRules();
      loadCalendarData(currentDisplayDate);

      // 4. แอบเปิดกล่องรายการที่บันทึกไว้ให้อัตโนมัติ (ให้ Admin เห็นผลลัพธ์ทันที)
      const listWrapper = document.getElementById("holiday-list-wrapper");
      const toggleBtn = document.getElementById("toggle-holiday-list-btn");
      if (listWrapper && listWrapper.classList.contains("hidden")) {
        listWrapper.classList.remove("hidden");
        if (toggleBtn) toggleBtn.textContent = "ซ่อนรายการที่บันทึกไว้";
      }
    } catch (error) {
      console.error(error);
      showNotification("เกิดข้อผิดพลาดในการเพิ่ม", "error");
    } finally {
      // 🔴 5. คืนค่าปุ่มกลับเป็นปกติ
      if (btnElement) {
        btnElement.disabled = false;
        btnElement.innerHTML = originalText;
      }
    }
  };

  // ผูก Event ให้ปุ่ม (ส่ง parameter ตัวปุ่ม this เข้าไปด้วย)
  document
    .getElementById("add-holiday-btn")
    ?.addEventListener("click", function () {
      handleAddCalendarRuleAdapter("holidays", this);
    });
  document
    .getElementById("add-working-saturday-btn")
    ?.addEventListener("click", function () {
      handleAddCalendarRuleAdapter("workingSaturdays", this);
    });

  document
    .getElementById("calendar-admin-add-holiday")
    ?.addEventListener("click", function () {
      handleAddCalendarRuleAdapter("holidays", this);
    });
  document
    .getElementById("calendar-admin-add-worksat")
    ?.addEventListener("click", function () {
      handleAddCalendarRuleAdapter("workingSaturdays", this);
    });

  // Event Delegation สำหรับลบกฎ (เผื่อมี UI เก่า)
  document
    .getElementById("admin-calendar-controls-card")
    ?.addEventListener("click", async (e) => {
      const deleteBtn = e.target.closest(".calendar-delete-btn");
      if (deleteBtn) {
        const date = deleteBtn.dataset.date;
        const type = deleteBtn.dataset.type;
        deleteBtn.disabled = true;
        try {
          await db
            .collection("system_settings")
            .doc("calendar_rules")
            .update({
              [type]: firebase.firestore.FieldValue.arrayRemove(date),
            });
          showNotification(`ลบวันที่ ${date} สำเร็จ`, "success");
          if (typeof loadAndDisplayHolidays === "function")
            loadAndDisplayHolidays();
          if (typeof loadCalendarRules === "function") loadCalendarRules();
          loadCalendarData(currentDisplayDate);
        } catch (error) {
          showNotification("เกิดข้อผิดพลาดในการลบ", "error");
        }
      }
    });

  // เริ่มทำงานระบบเปิด/ปิด และลบรายการในปฏิทิน Admin
  setupAdminCalendarControls();

  // ==========================================
  // 🌟 ผูก Event สำหรับ Auth & Profile
  // ==========================================
  const googleLoginBtn = document.getElementById("google-login-btn");
  if (googleLoginBtn) {
    googleLoginBtn.addEventListener("click", (e) => {
      e.preventDefault();
      handleGoogleLogin();
    });
  }

  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", handleLogout);
  }

  if (profileEditSaveBtn) {
    profileEditSaveBtn.addEventListener("click", async () => {
      profileEditSaveBtn.disabled = true;
      profileEditSaveBtn.textContent = "กำลังบันทึก...";

      try {
        const newName = profileEditNameInput.value.trim();
        const newDept = profileEditDeptInput.value.trim();

        // 1. โยนงานให้ authService ไปบันทึกใน DB
        const updatedData = await saveUserProfile(
          currentUser?.uid,
          newName,
          newDept,
        );

        // 2. อัปเดตตัวแปร Global ใน app.js และรีเฟรชหน้าจอ
        currentUserData = { ...currentUserData, ...updatedData };
        if (typeof updateProfilePage === "function")
          updateProfilePage(currentUserData);

        showNotification("บันทึกโปรไฟล์สำเร็จ!", "success");
        closeProfileEditModal();
      } catch (error) {
        showNotification(error.message, "warning");
      } finally {
        profileEditSaveBtn.disabled = false;
        profileEditSaveBtn.textContent = "บันทึก";
      }
    });
  }

  // เปิดทางให้ HTML (หน้า Admin Settings) สามารถเรียกใช้ฟังก์ชันอัปเดตสิทธิ์จาก dropdown ได้
  window.updateUserRoleAdapter = (userId, newRole) => {
    showConfirmDialog(
      `คุณต้องการเปลี่ยนสิทธิ์ผู้ใช้เป็น ${newRole.toUpperCase()} ใช่หรือไม่?`,
      () => {
        updateUserRole(userId, newRole);
      },
      () => {
        loadRoleManagement(); // ถ้ากดยกเลิก ให้โหลดตารางกลับเป็นค่าเดิม
      },
    );
  };

  // ==========================================
  // 🌟 ผูก Event สำหรับส่งใบลาและรายงาน (Request Service)
  // ==========================================

  // 1. ผูกปุ่มบันทึก Report
  if (saveReportBtn) {
    saveReportBtn.addEventListener("click", async () => {
      if (!currentUser) return showNotification("กรุณาเข้าสู่ระบบ", "error");

      const selectedDateStr = reportDateInput.value;
      if (!selectedDateStr)
        return showNotification("กรุณาเลือกวันที่", "warning");

      const workType = workTypeSelectedText.textContent.trim();
      const project = projectSelectedText.textContent.trim();
      const durationText = durationSelectedText.textContent.trim();

      if (
        workType.includes("เลือก") ||
        project.includes("เลือก") ||
        durationText.includes("เลือก")
      ) {
        return showNotification("กรุณากรอกข้อมูลให้ครบ", "warning");
      }

      let timeRange = durationText,
        hoursUsed = 8.0,
        saveStartTime = "08:30",
        saveEndTime = "17:30";

      if (durationText === "SOME TIME") {
        const startT = customTimeStartInput.value;
        const endT = customTimeEndInput.value;
        if (!startT || !endT)
          return showNotification("กรุณากรอกเวลาเริ่มต้นและสิ้นสุด", "warning");

        hoursUsed = parseFloat(
          (
            (new Date(`2000-01-01T${endT}`) -
              new Date(`2000-01-01T${startT}`)) /
            3600000
          ).toFixed(2),
        );
        if (hoursUsed <= 0)
          return showNotification("เวลาสิ้นสุดต้องมากกว่าเวลาเริ่ม", "warning");

        timeRange = `SOME TIME (${startT} - ${endT})`;
        saveStartTime = startT;
        saveEndTime = endT;
      } else if (durationText.includes("HALF DAY")) {
        if (durationText.includes("08:30")) {
          hoursUsed = 3.5;
          saveEndTime = "12:00";
          timeRange = "HALF DAY (08:30 - 12:00)";
        } else {
          hoursUsed = 4.5;
          saveStartTime = "13:00";
          timeRange = "HALF DAY (13:00 - 17:30)";
        }
      } else {
        timeRange = "ALL (08:30 - 17:30)";
      }

      saveReportBtn.disabled = true;
      saveReportBtn.textContent = "กำลังบันทึก...";

      const reportData = {
        workType,
        project,
        duration: timeRange,
        hours: hoursUsed,
        startTime: saveStartTime,
        endTime: saveEndTime,
      };

      const success = await submitDailyReport(
        currentUser.uid,
        selectedDateStr,
        reportData,
      );
      if (success) {
        resetReportForm();
        if (typeof loadSentReports === "function") loadSentReports();
      }

      saveReportBtn.disabled = false;
      saveReportBtn.textContent = "Save Report";
    });
  }

  // 2. ผูกปุ่มส่งใบลา
  if (submitLeaveBtn) {
    submitLeaveBtn.addEventListener("click", async () => {
      if (!currentUser || !currentUserData)
        return showNotification("กรุณาเข้าสู่ระบบก่อนยื่นใบลา", "error");

      const leaveType = leaveTypeSelect.value;
      const startDateStr = leaveStartDate.value;
      const reason = leaveReason.value.trim();
      const durationType = leaveDurationType.value;
      const endDateStr = leaveEndDate.value;

      if (!leaveType || !startDateStr || !reason)
        return showNotification("กรุณากรอกข้อมูลให้ครบถ้วน", "warning");

      let startDate = new Date(startDateStr);
      let endDate =
        durationType === "hourly"
          ? new Date(startDateStr)
          : new Date(endDateStr);

      if (durationType !== "hourly" && (!endDateStr || endDate < startDate)) {
        return showNotification("วันที่สิ้นสุดไม่ถูกต้อง", "warning");
      }

      submitLeaveBtn.disabled = true;
      submitLeaveBtn.textContent = "กำลังส่งเรื่อง...";

      const leaveData = {
        userId: currentUser.uid,
        userName: currentUserData.fullName,
        userPhoto: currentUserData.profileImageUrl || currentUser.photoURL,
        department: currentUserData.department,
        leaveType,
        reason,
        durationType,
        startDate: firebase.firestore.Timestamp.fromDate(startDate),
        endDate: firebase.firestore.Timestamp.fromDate(endDate),
      };

      if (durationType === "hourly") {
        if (!leaveStartTime.value || !leaveEndTime.value) {
          submitLeaveBtn.disabled = false;
          submitLeaveBtn.textContent = "ส่งใบลา";
          return showNotification("กรุณาระบุเวลา", "warning");
        }
        leaveData.startTime = leaveStartTime.value;
        leaveData.endTime = leaveEndTime.value;
      }

      const success = await submitLeaveRequest(leaveData);
      if (success) closeLeaveModal();

      submitLeaveBtn.disabled = false;
      submitLeaveBtn.textContent = "ส่งใบลา";
    });
  }

  // 3. ฟังก์ชันลบรายงาน (เชื่อมกับปุ่ม HTML เดิม)
  window.deleteReportItem = (docId, reportId) => {
    showConfirmDialog("คุณแน่ใจหรือไม่ที่จะลบรายงานนี้?", async () => {
      const success = await deleteDailyReportItem(docId, reportId);
      if (success && typeof loadSentReports === "function") loadSentReports();
    });
  };

  // ==========================================
  // 🌟 ผูก Event สำหรับหน้า Approvals Center (OT & Leave)
  // ==========================================

  // โหลดข้อมูลเมื่อเปิดหน้า Approvals
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.addEventListener("click", (e) => {
      const pageId = item.dataset.page;
      if (
        pageId === "admin-approvals-page" &&
        currentUserData &&
        currentUserData.role === "admin"
      ) {
        if (typeof loadAllUsersForDropdown === "function")
          loadAllUsersForDropdown();
        loadPendingLeaveRequests(currentUserData); // ✨ โยน currentUserData เข้าไป
        loadPendingOtRequests(currentUserData);
      }
    });
  });

  // Event Delegation สำหรับปุ่มอนุมัติ OT
  const otListContainer = document.getElementById("ot-approval-list");
  if (otListContainer) {
    otListContainer.addEventListener("click", (event) => {
      const approveBtn = event.target.closest(".approve-ot-btn");
      const rejectBtn = event.target.closest(".reject-ot-btn");

      if (approveBtn) {
        const docId = approveBtn.dataset.id;
        if (docId) handleOtApproval(docId, "approved", approveBtn);
      } else if (rejectBtn) {
        const docId = rejectBtn.dataset.id;
        if (docId) handleOtApproval(docId, "rejected", rejectBtn);
      }
    });
  }

  // 🌟 ผูก Event สำหรับ Check-in & On-site Group (Attendance Service)
  // ==========================================
  const confirmCheckinBtn = document.getElementById("confirm-checkin-btn");
  if (confirmCheckinBtn) {
    confirmCheckinBtn.addEventListener("click", async () => {
      const workType = document
        .getElementById("checkin-work-type-text")
        .textContent.trim();
      const project = document
        .getElementById("checkin-project-text")
        .textContent.trim();
      let duration = document
        .getElementById("checkin-duration-text")
        .textContent.trim();

      if (
        workType.includes("เลือก") ||
        project.includes("เลือก") ||
        duration.includes("เลือก")
      ) {
        return showNotification("กรุณากรอกข้อมูลให้ครบถ้วน", "warning");
      }

      let hoursUsed = 0,
        saveStartTime = "",
        saveEndTime = "";
      if (duration === "SOME TIME") {
        const startT = document.getElementById("checkin-start-time").value;
        const endT = document.getElementById("checkin-end-time").value;
        if (!startT || !endT)
          return showNotification("กรุณาระบุเวลาเริ่มและสิ้นสุด", "warning");
        const diffHrs =
          (new Date(`2000-01-01T${endT}`) - new Date(`2000-01-01T${startT}`)) /
          3600000;
        if (diffHrs <= 0)
          return showNotification(
            "เวลาสิ้นสุดต้องมากกว่าเวลาเริ่มต้น",
            "warning",
          );
        hoursUsed = parseFloat(diffHrs.toFixed(2));
        duration = `SOME TIME (${startT} - ${endT})`;
        saveStartTime = startT;
        saveEndTime = endT;
      } else if (duration.includes("HALF DAY")) {
        if (duration.includes("08:30")) {
          hoursUsed = 3.5;
          saveStartTime = "08:30";
          saveEndTime = "12:00";
          duration = "HALF DAY (08:30 - 12:00)";
        } else {
          hoursUsed = 4.5;
          saveStartTime = "13:00";
          saveEndTime = "17:30";
          duration = "HALF DAY (13:00 - 17:30)";
        }
      } else {
        hoursUsed = 8.0;
        saveStartTime = "08:30";
        saveEndTime = "17:30";
        duration = "ALL (08:30 - 17:30)";
      }

      document.getElementById("checkin-report-modal").classList.add("hidden");
      await proceedWithCheckin("in_factory", {
        workType,
        project,
        duration,
        hours: hoursUsed,
        startTime: saveStartTime,
        endTime: saveEndTime,
      });
    });
  }

  const mainCheckinBtn = document.getElementById("checkin-btn");
  if (mainCheckinBtn) {
    mainCheckinBtn.addEventListener("click", async () => {
      const isLocalhost =
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1";
      if (isLocalhost)
        setMockPosition({
          coords: {
            latitude: FACTORY_LOCATION.latitude,
            longitude: FACTORY_LOCATION.longitude,
            accuracy: 10,
          },
        });

      if (!latestPosition)
        return showNotification(
          "กำลังรอสัญญาณ GPS กรุณารอสักครู่...",
          "warning",
        );

      let distance = calculateDistance(
        latestPosition.coords.latitude,
        latestPosition.coords.longitude,
        FACTORY_LOCATION.latitude,
        FACTORY_LOCATION.longitude,
      );
      if (isLocalhost) distance = 0;

      if (distance > ALLOWED_RADIUS_METERS) {
        showNotification(`อยู่นอกพื้นที่ (${distance.toFixed(0)} ม.)`, "error");
        return;
      }
      document
        .getElementById("checkin-report-modal")
        .classList.remove("hidden");
    });
  }

  if (checkoutBtn) checkoutBtn.addEventListener("click", handleCheckoutAction);

  const createRoomBtn = document.getElementById("create-room-btn");
  if (createRoomBtn) {
    createRoomBtn.addEventListener("click", async () => {
      const project = document.getElementById("room-project-input").value;
      const locationName = document.getElementById("room-location-input").value;
      if (!project || !locationName)
        return alert("กรุณากรอกชื่อโครงการและสถานที่");

      createRoomBtn.disabled = true;
      createRoomBtn.textContent = "กำลังสร้างห้อง...";
      try {
        if (typeof QRCode === "undefined")
          await loadScript(
            "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js",
          );
        const roomId = await setupOnsiteLeader(
          project,
          locationName,
          currentUserData,
        );
        if (roomId) {
          document.getElementById("qrcode").innerHTML = "";
          new QRCode(document.getElementById("qrcode"), {
            text: roomId,
            width: 180,
            height: 180,
          });
          createRoomBtn.classList.add("hidden");
          document
            .getElementById("room-qr-container")
            .classList.remove("hidden");
        }
      } finally {
        createRoomBtn.disabled = false;
        createRoomBtn.textContent = "สร้างห้อง Check-in";
      }
    });
  }

  const startScanBtn = document.getElementById("start-scan-btn");
  if (startScanBtn) {
    startScanBtn.addEventListener("click", async () => {
      try {
        await loadScript("https://unpkg.com/html5-qrcode");
      } catch (e) {
        return alert("โหลดกล้องไม่สำเร็จ");
      }

      const html5QrCode = new Html5Qrcode("reader");
      const qrCodeSuccessCallback = (decodedText, decodedResult) => {
        html5QrCode
          .stop()
          .then(() => {
            document.getElementById("reader").classList.add("hidden");
            document.getElementById("scan-status").textContent =
              "สแกนสำเร็จ! กำลังตรวจสอบ...";
            joinOnsiteRoom(decodedText, currentUserData);
          })
          .catch((err) => console.log("Stop failed ", err));
      };
      document.getElementById("reader").classList.remove("hidden");
      html5QrCode
        .start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          qrCodeSuccessCallback,
        )
        .catch((err) => alert("เปิดกล้องไม่ได้: " + err));
    });
  }

  // ==========================================
  // 🌟 ผูก Event สำหรับระบบตารางเวลาและสรุปข้อมูล (Timesheet Service)
  // ==========================================

  // 1. Timeline (หน้า Audit หลัก)
  const refreshTimelineBtn = document.getElementById("refresh-timeline-btn");
  const timelineDatePicker = document.getElementById("timeline-date-picker");
  if (refreshTimelineBtn)
    refreshTimelineBtn.addEventListener("click", loadTimelineData);
  if (timelineDatePicker)
    timelineDatePicker.addEventListener("change", loadTimelineData);

  // ==========================================
  // 🌟 1.5 ระบบเปลี่ยน Tab ในหน้า Timesheet Management (เพิ่มกลับเข้ามา)
  // ==========================================
  const tsTabBtns = document.querySelectorAll(".ts-tab-btn");
  const tsTabContents = document.querySelectorAll(".ts-tab-content");

  if (tsTabBtns.length > 0) {
    tsTabBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        // 1. ล้างสไตล์ Active ของปุ่มทั้งหมด (เปลี่ยนเป็นสีเทา)
        tsTabBtns.forEach((b) => {
          b.classList.remove("border-sky-600", "text-sky-600");
          b.classList.add(
            "border-transparent",
            "text-gray-500",
            "hover:text-gray-700",
            "hover:border-gray-300",
          );
        });

        // 2. ซ่อนเนื้อหา (Content) ของทุก Tab
        tsTabContents.forEach((c) => c.classList.add("hidden"));

        // 3. ไฮไลท์ปุ่มที่ถูกคลิก (เปลี่ยนเป็นสีฟ้า)
        btn.classList.remove(
          "border-transparent",
          "text-gray-500",
          "hover:text-gray-700",
          "hover:border-gray-300",
        );
        btn.classList.add("border-sky-600", "text-sky-600");

        // 4. แสดงเนื้อหาเป้าหมาย
        const targetId = btn.dataset.target;
        const targetContent = document.getElementById(targetId);
        if (targetContent) {
          targetContent.classList.remove("hidden");
        }
        if (targetId === "tab-audit" || targetId === "ts-audit-content") {
          if (typeof loadDailyAuditData === "function")
            loadDailyAuditData(currentUser, currentUserData);
          if (typeof loadTimelineData === "function") loadTimelineData();
        }
      });
    });
  }

  // 2. Timesheet Table (ตารางเวลาเข้า-ออก)
  const tsApplyBtn = document.getElementById("ts-apply-filter-btn");
  const timesheetTabBtn = document.querySelector(
    '.ts-tab-btn[data-target="ts-timesheet-content"]',
  );
  if (tsApplyBtn) tsApplyBtn.addEventListener("click", loadTimesheetTable);
  if (timesheetTabBtn)
    timesheetTabBtn.addEventListener("click", loadTimesheetTable);

  // 3. Employee Summary (หน้าสรุปเวลาพนักงาน)
  const applySummaryFiltersBtn = document.getElementById(
    "apply-summary-filters-btn",
  );
  const exportEmployeeSummaryBtn = document.getElementById(
    "export-employee-summary-btn",
  );
  if (applySummaryFiltersBtn)
    applySummaryFiltersBtn.addEventListener("click", () =>
      loadEmployeeSummary(1),
    );
  if (exportEmployeeSummaryBtn) {
    exportEmployeeSummaryBtn.addEventListener("click", async () => {
      showNotification("กำลังเตรียมข้อมูล Excel...", "info");
      if (typeof XLSX === "undefined") {
        try {
          await loadScript(
            "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
          );
        } catch (e) {
          return alert("โหลด Excel Library ไม่สำเร็จ");
        }
      }
      exportEmployeeSummaryToExcel();
    });
  }

  // 4. Project Summary (หน้าสรุปโปรเจกต์)
  const projectSelect = document.getElementById("project-summary-select");
  const monthInput = document.getElementById("project-summary-month");
  const exportProjectBtn = document.getElementById(
    "export-project-summary-btn",
  );

  // ตั้งค่าเดือนเริ่มต้น
  if (monthInput && !monthInput.value) {
    const now = new Date();
    monthInput.value = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, "0")}`;
  }

  // โหลดรายชื่อ Project ทันทีที่เข้าแอป
  populateProjectOptions();

  if (projectSelect) projectSelect.addEventListener("change", fetchProjectData);
  if (monthInput) monthInput.addEventListener("change", fetchProjectData);
  if (exportProjectBtn) {
    exportProjectBtn.addEventListener("click", async () => {
      const originalText = exportProjectBtn.innerHTML;
      exportProjectBtn.innerHTML = "Preparing...";
      exportProjectBtn.disabled = true;
      try {
        if (typeof XLSX === "undefined") {
          await loadScript(
            "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
          );
        }
        await exportProjectSummaryToExcelData();
      } catch (e) {
        alert("เกิดข้อผิดพลาดในการโหลด Excel Module");
      } finally {
        exportProjectBtn.innerHTML = originalText;
        exportProjectBtn.disabled = false;
      }
    });
  }
});
