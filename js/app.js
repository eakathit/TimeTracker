import {
  db,
  auth,
  cloudFunctions,
  storage,
  messaging,
} from "./config/firebase-config.js";
import { 
    FACTORY_LOCATION, ALLOWED_RADIUS_METERS, MAX_ACCEPTABLE_ACCURACY, 
    latestPosition, setMockPosition, calculateDistance, 
    startWatchingPosition, stopWatchingPosition 
} from './services/locationService.js';
import { 
    currentDisplayDate, loadCalendarData, showCalendarDetails, 
    handleCalendarDetailClick, loadCalendarRules, 
    setupAdminCalendarControls, loadAndDisplayHolidays 
} from './services/calendarService.js';
import { 
    handleGoogleLogin, handleLogout, saveUserProfile, 
    loadRoleManagement, updateUserRole 
} from './services/authService.js';
import { toLocalISOString, toLocalDateKey, calculateWorkHours } from './utils/dateHelper.js';
import { showNotification, showConfirmDialog } from "./utils/uiHelper.js";
import { loadPayrollSummary, exportPayrollSummaryToExcel } from './services/payrollService.js';
import { loadWorkHistory, loadLeaveHistory, loadOtHistory, loadTimesheetSummary } from './services/historyService.js';
import { loadAdminDashboardOverview, loadDailyAuditData, loadDailyLeaveNotifications, handleLeaveApproval } from './services/dashboardService.js';
import { submitLeaveRequest, submitDailyReport, deleteDailyReportItem } from './services/requestService.js';
import { loadPendingLeaveRequests, loadPendingOtRequests, handleOtApproval } from './services/approvalService.js';

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
  const applySummaryFiltersBtn = document.getElementById(
    "apply-summary-filters-btn",
  );
  const exportEmployeeSummaryBtn = document.getElementById(
    "export-employee-summary-btn",
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
  const timelineDatePicker = document.getElementById("timeline-date-picker");
  const timelineContainer = document.getElementById("timeline-list-container");
  const refreshTimelineBtn = document.getElementById("refresh-timeline-btn");
  const tsTabBtns = document.querySelectorAll(".ts-tab-btn");
  const tsTabContents = document.querySelectorAll(".ts-tab-content");

  let html5QrCode;
  let currentRoomId = null;
  let roomUnsubscribe = null; // สำหรับยกเลิกการฟัง Realtime update

  // --- 1. การสลับ Role (Member / Leader) ---
  const roleMemberBtn = document.getElementById("role-member-btn");
  const roleLeaderBtn = document.getElementById("role-leader-btn");
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
    updateProfilePage(userData);

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

    // [ฉบับแก้ไขสมบูรณ์] ฟังก์ชัน initializeProjectSummary
    const initializeProjectSummary = () => {
      const db = firebase.firestore();

      // 1. ดึง Element มาเก็บไว้ในตัวแปร
      const projectSelect = document.getElementById("project-summary-select");
      const monthInput = document.getElementById("project-summary-month");
      const resultsContainer = document.getElementById(
        "project-summary-results",
      );
      const exportBtn = document.getElementById("export-project-summary-btn");

      // ★ Safety Check
      if (!projectSelect || !monthInput || !resultsContainer || !exportBtn)
        return;

      // 2. ฟังก์ชันย่อยสำหรับ Export Excel
      const exportProjectSummaryToExcel = async () => {
        const selectedProject = projectSelect.value;
        const selectedMonth = monthInput.value;

        if (!selectedProject || !selectedMonth) {
          alert("กรุณาเลือกเดือนและโครงการก่อน Export");
          return;
        }

        const originalBtnText = exportBtn.innerHTML;
        exportBtn.innerHTML = "Preparing...";
        exportBtn.disabled = true;

        try {
          // 1. กำหนดช่วงเวลา
          const [year, month] = selectedMonth.split("-").map(Number);
          const startDate = new Date(year, month - 1, 1);
          const endDate = new Date(year, month, 0, 23, 59, 59, 999);

          // 2. ดึงข้อมูล Users และ Work Records
          const [usersSnap, recordsSnap] = await Promise.all([
            db.collection("users").get(),
            db
              .collection("work_records")
              .where("date", ">=", startDate)
              .where("date", "<=", endDate)
              .get(),
          ]);

          // --- [แก้จุดที่ 1] เก็บทั้งชื่อและแผนก ---
          const usersMap = {};
          usersSnap.forEach((doc) => {
            const d = doc.data();
            usersMap[doc.id] = {
              name: d.fullName || "Unknown",
              dept: d.department || "-", // เก็บแผนกไว้ใช้
            };
          });

          // 3. เตรียมข้อมูลสำหรับ Excel
          const dataForExcel = [];
          recordsSnap.forEach((doc) => {
            const data = doc.data();
            const userInfo = usersMap[data.userId] || {
              name: "Unknown",
              dept: "-",
            }; // ดึงข้อมูลพนักงาน

            const reports = data.reports || (data.report ? [data.report] : []);

            reports.forEach((r) => {
              if (r.project === selectedProject) {
                const dateStr = data.date
                  .toDate()
                  .toLocaleDateString("th-TH", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                  });

                // --- [แก้จุดที่ 2] ดึงแผนกจาก userInfo และสลับคอลัมน์ ---
                dataForExcel.push({
                  Date: dateStr,
                  Employee: userInfo.name,
                  Department: userInfo.dept, // ดึงจาก Users โดยตรง
                  "Work Detail": r.workType,
                  Project: r.project,
                  "Start Time": r.startTime || "-",
                  "End Time": r.endTime || "-",
                  "Total Hours": r.hours || 0, // ย้ายมาอยู่ตรงนี้ (ก่อน Time Period)
                  "Time Period": r.duration, // ย้ายไปไว้ท้ายสุด
                });
              }
            });
          });

          if (dataForExcel.length === 0) {
            alert("ไม่พบข้อมูลรายงานสำหรับโครงการนี้ในช่วงเวลาที่เลือก");
            return;
          }

          // 4. สร้างไฟล์ Excel
          const ws = XLSX.utils.json_to_sheet(dataForExcel);
          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, ws, "Project Report");

          const fileName = `Report_${selectedProject}_${selectedMonth}.xlsx`;
          XLSX.writeFile(wb, fileName);
        } catch (error) {
          console.error("Export Error:", error);
          alert("เกิดข้อผิดพลาดในการ Export: " + error.message);
        } finally {
          exportBtn.innerHTML = originalBtnText;
          exportBtn.disabled = false;
        }
      };

      // 3. ตั้งค่าเดือนปัจจุบันเป็นค่าเริ่มต้น
      const now = new Date();
      const year = now.getFullYear();
      const month = (now.getMonth() + 1).toString().padStart(2, "0");
      monthInput.value = `${year}-${month}`;

      // 4. ฟังก์ชันดึงรายชื่อโครงการใส่ Dropdown
      const populateProjectOptions = async () => {
        try {
          const doc = await db
            .collection("system_settings")
            .doc("projects")
            .get();
          // เคลียร์ค่าเก่าก่อน
          projectSelect.innerHTML =
            '<option value="">Select Project...</option>';

          if (doc.exists) {
            const projects = doc.data().names || [];
            projects.forEach((name) => {
              const option = document.createElement("option");
              option.value = name;
              option.textContent = name;
              projectSelect.appendChild(option);
            });
          }
        } catch (error) {
          console.error("Error populating project summary dropdown:", error);
        }
      };

      // 5. ฟังก์ชันดึงข้อมูลมาแสดงผล (Fetch Data)
      const fetchProjectData = async () => {
        const selectedProject = projectSelect.value;
        const selectedMonth = monthInput.value;

        if (!selectedProject || !selectedMonth) {
          resultsContainer.innerHTML =
            '<p class="text-sm text-center text-gray-400 py-2">กรุณาเลือกเดือนและโครงการ</p>';
          return;
        }

        resultsContainer.innerHTML =
          '<p class="text-sm text-center text-gray-500 py-2">กำลังค้นหาข้อมูล...</p>';

        const [yearNum, monthNum] = selectedMonth.split("-").map(Number);
        const startDate = new Date(yearNum, monthNum - 1, 1);
        const endDate = new Date(yearNum, monthNum, 0, 23, 59, 59, 999);

        try {
          // ดึง Records ทั้งหมดของเดือนนั้น (ไม่ filter project ใน query เพราะเป็น Array)
          const querySnapshot = await db
            .collection("work_records")
            .where("date", ">=", startDate)
            .where("date", "<=", endDate)
            .get();

          if (querySnapshot.empty) {
            resultsContainer.innerHTML =
              '<p class="text-sm text-center text-gray-500 py-2">ไม่พบข้อมูลในเดือนนี้</p>';
            return;
          }

          const usersSnapshot = await db.collection("users").get();
          const usersMap = {};
          usersSnapshot.forEach(
            (doc) => (usersMap[doc.id] = doc.data().fullName),
          );

          let resultsHTML = `
            <div class="flex justify-between items-center mb-3">
                <h4 class="font-semibold text-gray-800">Showing results for : ${selectedProject}</h4>
            </div>
            <div class="space-y-3">
        `;

          let matchCount = 0;

          querySnapshot.forEach((doc) => {
            const record = doc.data();
            // ดึง reports array (หรือ report เดิมถ้ามี)
            const reports =
              record.reports || (record.report ? [record.report] : []);

            // กรองเอาเฉพาะรายการใน Array ที่ตรงกับโปรเจกต์ที่เลือก
            const matchingReports = reports.filter(
              (r) => r.project === selectedProject,
            );

            if (matchingReports.length > 0) {
              const reportDate = record.date
                .toDate()
                .toLocaleDateString("th-TH", {
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                });
              const userName = usersMap[record.userId] || record.userId;

              matchingReports.forEach((report) => {
                matchCount++;
                resultsHTML += `
                        <div class="p-4 bg-white rounded-xl border border-gray-200 shadow-sm">
                            <div class="flex justify-between items-center">
                                <p class="font-semibold text-gray-800">${userName}</p>
                                <p class="text-[10px] text-gray-400 font-bold uppercase">${reportDate}</p>
                            </div>
                            <div class="mt-3 flex flex-wrap gap-2">
                                <span class="bg-sky-50 text-sky-700 text-xs px-2.5 py-1 rounded-lg font-bold border border-sky-100">
                                    ${report.workType}
                                </span>
                                <span class="bg-gray-50 text-gray-600 text-xs px-2.5 py-1 rounded-lg font-medium border border-gray-100">
                                    เวลา: ${report.duration}
                                </span>
                            </div>
                        </div>
                    `;
              });
            }
          });

          if (matchCount === 0) {
            resultsContainer.innerHTML =
              '<p class="text-sm text-center text-gray-500 py-2">ไม่พบข้อมูลโปรเจกต์ที่เลือกในเดือนนี้</p>';
          } else {
            resultsContainer.innerHTML = resultsHTML + "</div>";
          }
        } catch (error) {
          console.error("Error:", error);
          resultsContainer.innerHTML =
            '<p class="text-sm text-center text-red-500 py-2">เกิดข้อผิดพลาดในการโหลดข้อมูล</p>';
        }
      };

      // 6. เริ่มทำงาน
      populateProjectOptions();

      // ผูก Event Listeners
      if (projectSelect)
        projectSelect.addEventListener("change", fetchProjectData);
      if (monthInput) monthInput.addEventListener("change", fetchProjectData);

      if (exportBtn) {
        exportBtn.addEventListener("click", async () => {
          showNotification("กำลังโหลดโมดูล Excel...", "warning");
          // เช็คว่าโหลด XLSX หรือยัง
          if (typeof XLSX === "undefined") {
            try {
              // ฟังก์ชัน loadScript ต้องมีอยู่แล้วใน scope หลัก
              await loadScript(
                "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
              );
            } catch (e) {
              alert("โหลดไม่สำเร็จ กรุณาเช็คอินเทอร์เน็ต");
              return;
            }
          }
          exportProjectSummaryToExcel();
        });
      }
    };

    initializeProjectSummary();
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


            // 1. ฟังก์ชันบันทึก Check-in (แยกออกมาให้เรียกใช้ง่ายๆ ไม่ซ้อนกัน)
            const proceedWithCheckin = async (finalWorkType, reportData = null) => {
                const checkinSpan = document.querySelector('#checkin-btn span');
                const checkinBtnElement = document.getElementById('checkin-btn');
                
                try {
                    checkinBtnElement.disabled = true;
                    if (checkinSpan) checkinSpan.textContent = "กำลังบันทึก...";
                    
                    const now = new Date();
                    const docId = `${currentUser.uid}_${toLocalDateKey(now)}`;

                    const workRecord = {
                        userId: currentUser.uid,
                        date: firebase.firestore.Timestamp.fromDate(now),
                        checkIn: {
                            timestamp: firebase.firestore.Timestamp.fromDate(now),
                            location: new firebase.firestore.GeoPoint(latestPosition.coords.latitude, latestPosition.coords.longitude),
                            googleMapLink: `https://www.google.com/maps/search/?api=1&query=$${latestPosition.coords.latitude},${latestPosition.coords.longitude}`,
                            accuracy: latestPosition.coords.accuracy,
                            workType: finalWorkType,
                            onSiteDetails: null,
                            photoUrl: null
                        },
                        status: "checked_in",
                        reports: reportData ? [{
                            ...reportData,
                            id: Date.now(),
                            submittedAt: firebase.firestore.Timestamp.fromDate(now)
                        }] : [],
                        checkOut: null,
                        overtime: null
                    };

                    await db.collection('work_records').doc(docId).set(workRecord);
                    showNotification("Check-in สำเร็จแล้ว!", "success");
                    updateUIToCheckedIn(); // เปลี่ยนปุ่มเป็นสีแดง Check-out

                    // อัปเดตเวลาบนหน้าจอ
                    const savedRecord = await db.collection('work_records').doc(docId).get();
                    if (savedRecord.exists) {
                        const serverCheckinTime = savedRecord.data().checkIn.timestamp.toDate();
                        summaryCheckinTime.textContent = serverCheckinTime.toLocaleTimeString('th-TH');
                        summaryCheckinTime.classList.replace('text-gray-400', 'text-green-600');
                        summaryCheckoutTime.textContent = '-';
                        summaryCheckoutTime.classList.replace('text-red-500', 'text-gray-400');
                        summaryWorkHours.textContent = '-';
                    }

                } catch (error) {
                    console.error("Check-in Error:", error);
                    showNotification("Error: " + error.message, 'error');
                    checkinBtnElement.disabled = false;
                    if (checkinSpan) checkinSpan.textContent = "Check In";
                }
            };

            // 2. จัดการปุ่ม "ยืนยัน (Confirm)" ใน Modal 
            const confirmCheckinBtn = document.getElementById('confirm-checkin-btn');
            if (confirmCheckinBtn) {

                confirmCheckinBtn.addEventListener('click', async () => {
                    const workType = document.getElementById('checkin-work-type-text').textContent.trim();
                    const project = document.getElementById('checkin-project-text').textContent.trim();
                    let duration = document.getElementById('checkin-duration-text').textContent.trim();

                    if (workType.includes('เลือก') || project.includes('เลือก') || duration.includes('เลือก')) {
                        return showNotification('กรุณากรอกข้อมูลให้ครบถ้วน', 'warning');
                    }

                    let hoursUsed = 0;
                    let saveStartTime = "";
                    let saveEndTime = "";

                    if (duration === 'SOME TIME') {
                        const startT = document.getElementById('checkin-start-time').value;
                        const endT = document.getElementById('checkin-end-time').value;

                        if (!startT || !endT) return showNotification('กรุณาระบุเวลาเริ่มและสิ้นสุด', 'warning');

                        const start = new Date(`2000-01-01T${startT}`);
                        const end = new Date(`2000-01-01T${endT}`);
                        const diffHrs = (end - start) / (1000 * 60 * 60);

                        if (diffHrs <= 0) return showNotification('เวลาสิ้นสุดต้องมากกว่าเวลาเริ่มต้น', 'warning');

                        hoursUsed = parseFloat(diffHrs.toFixed(2));
                        duration = `SOME TIME (${startT} - ${endT})`;
                        saveStartTime = startT;
                        saveEndTime = endT;

                    } else if (duration.includes('HALF DAY')) {
                        if (duration.includes('08:30')) {
                            hoursUsed = 3.5; saveStartTime = "08:30"; saveEndTime = "12:00"; duration = "HALF DAY (08:30 - 12:00)";
                        } else {
                            hoursUsed = 4.5; saveStartTime = "13:00"; saveEndTime = "17:30"; duration = "HALF DAY (13:00 - 17:30)";
                        }
                    } else {
                        hoursUsed = 8.0; saveStartTime = "08:30"; saveEndTime = "17:30"; duration = "ALL (08:30 - 17:30)";
                    }

                    // ปิด Modal
                    document.getElementById('checkin-report-modal').classList.add('hidden');

                    // ส่งข้อมูลไปบันทึก
                    await proceedWithCheckin('in_factory', {
                        workType: workType,
                        project: project,
                        duration: duration,
                        hours: hoursUsed,
                        startTime: saveStartTime,
                        endTime: saveEndTime
                    });
                });
            }

            // 3. จัดการปุ่ม Check In วงกลมใหญ่หน้าแรก
            const mainCheckinBtn = document.getElementById('checkin-btn');
            if (mainCheckinBtn) {

                mainCheckinBtn.addEventListener('click', async () => {
                    const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

                    // 🌟 [โหมดเทส] จำลองว่ายืนอยู่กลางโรงงานเลย
                    if (isLocalhost) {
                    console.log("🛠️ Localhost Mode: Bypassing GPS check...");
                    setMockPosition({ coords: { latitude: FACTORY_LOCATION.latitude, longitude: FACTORY_LOCATION.longitude, accuracy: 10 } });
                }
                    if (!latestPosition) {
                        showNotification("กำลังรอสัญญาณ GPS กรุณารอสักครู่...", "warning");
                        return;
                    }

                    // เช็คระยะทาง (ถ้ารันเทส ให้บังคับระยะทางเป็น 0)
                    let distance = calculateDistance(latestPosition.coords.latitude, latestPosition.coords.longitude, FACTORY_LOCATION.latitude, FACTORY_LOCATION.longitude);
                    if (isLocalhost) distance = 0; 

                    if (distance > ALLOWED_RADIUS_METERS) {
                        showNotification(`อยู่นอกพื้นที่ (${distance.toFixed(0)} ม.)`, 'error');
                        return;
                    }

                    // ผ่านเงื่อนไข -> เปิด Modal ให้กรอก Report 
                    document.getElementById('checkin-report-modal').classList.remove('hidden');
                });
            }
  // --- Logic สำหรับ Modal Check-in (เพิ่มใหม่) ---

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

 
  

  async function checkUserWorkStatus() {
    if (!auth.currentUser || !currentUser) return;

    const today = toLocalDateKey(new Date());
    const docId = `${currentUser.uid}_${today}`;

    // ดึงข้อมูลแบบปกติ เพื่อให้ Firebase จัดการ Offline/Cache เองตามธรรมชาติ
    // ลดปัญหา FirebaseError: Failed to get document from cache
    let workRecordDoc;
    try {
      workRecordDoc = await db.collection("work_records").doc(docId).get();
    } catch (e) {
      console.warn(
        "Network error, trying to fetch status from local cache...",
        e,
      );
      // ถ้าดึงปกติไม่ได้จริงๆ ค่อยลองดึงจาก cache แบบเงียบๆ
      try {
        workRecordDoc = await db
          .collection("work_records")
          .doc(docId)
          .get({ source: "cache" });
      } catch (cacheError) {
        return; // ถ้าไม่มีทั้งเน็ตและไม่มี cache ให้หยุดทำงาน
      }
    }

    if (workRecordDoc && workRecordDoc.exists) {
      const data = workRecordDoc.data();

      // --- [ตรวจสอบ Check-In] ---
      // ถ้าเป็นกรณี Report Only (มี Record แต่ไม่มี Check-in) ให้แสดงสถานะเตรียม Check-in ปกติ
      if (!data.checkIn || !data.checkIn.timestamp) {
        console.log(
          "Found record but no check-in data (Potential Report Only)",
        );
        updateUIToCheckIn();
        return;
      }

      const checkinTime = data.checkIn.timestamp.toDate();
      summaryCheckinTime.textContent = checkinTime.toLocaleTimeString("th-TH");
      summaryCheckinTime.classList.remove("text-gray-400");
      summaryCheckinTime.classList.add("text-green-600");

      if (data.status === "checked_in") {
        updateUIToCheckedIn();
      } else if (data.status === "completed" && data.checkOut) {
        updateUIToCompleted();

        const checkoutTime = data.checkOut.timestamp.toDate();

        // 1. คำนวณชั่วโมงเบื้องต้น
        let { regularWorkHours, overtimeHours: calculatedOt } =
          calculateWorkHours(checkinTime, checkoutTime);

        // 2. จัดการค่า OT (หัวใจสำคัญ: เชื่อข้อมูลในฐานข้อมูลเป็นอันดับแรก)
        let finalOt = 0;
        // ตรวจสอบว่ามีข้อมูล OT บันทึกไว้ไหม (ถ้ามีให้ใช้ค่าในนั้น แม้จะเป็น 0 ก็ตาม)
        if (data.overtime && typeof data.overtime.hours === "number") {
          finalOt = data.overtime.hours;
        } else {
          // ถ้าใน DB ยังไม่มีข้อมูล OT (กรณีเก่า) ให้ใช้ค่าจากการคำนวณ
          finalOt = calculatedOt;
        }

        summaryCheckoutTime.textContent =
          checkoutTime.toLocaleTimeString("th-TH");
        summaryCheckoutTime.classList.remove("text-gray-400");
        summaryCheckoutTime.classList.add("text-red-500");

        // แสดงชั่วโมงงานปกติ
        summaryWorkHours.textContent = `${regularWorkHours.toFixed(2)} hours`;

        // แสดง OT เฉพาะรายการที่มากกว่า 0
        if (finalOt > 0) {
          summaryWorkHours.textContent += ` (OT ${finalOt} hrs)`;
        }
      }
    } else {
      // กรณีไม่มีข้อมูล Record ใดๆ ของวันนี้เลย
      updateUIToCheckIn();
    }
  }

  async function loadEmployeeSummary(page = 1) {
    const container = document.getElementById(
      "employee-summary-container-admin",
    );
    const paginationControls = document.getElementById(
      "summary-pagination-controls",
    );
    if (!container || !paginationControls) return;

    container.innerHTML =
      '<p class="text-sm text-center text-gray-500 py-2">กำลังโหลดข้อมูลพนักงาน...</p>';
    paginationControls.innerHTML = "";

    const startDateString = summaryStartDateInput.value;
    const endDateString = summaryEndDateInput.value;
    const userIdFilter = document.getElementById(
      "summary-employee-select",
    ).value;
    const statusFilter = summaryStatusFilterSelect.value;

    if (!startDateString || !endDateString) {
      container.innerHTML =
        '<p class="text-sm text-center text-red-500 py-4">กรุณาเลือกวันที่เริ่มต้นและสิ้นสุด</p>';
      return;
    }

    const startDate = new Date(startDateString);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(endDateString);
    endDate.setHours(23, 59, 59, 999);

    const ITEMS_PER_PAGE = 20;
    let currentPage = page;
    let totalItems = 0;
    let totalPages = 1;

    try {
      const usersSnapshot = await db
        .collection("users")
        .orderBy("fullName")
        .get();
      if (usersSnapshot.empty) {
        container.innerHTML =
          '<p class="text-sm text-center text-gray-500 py-2">ไม่พบข้อมูลผู้ใช้ในระบบ</p>';
        return;
      }

      let allUsersData = {};
      usersSnapshot.forEach((doc) => {
        const userData = doc.data();
        if (!userIdFilter || doc.id === userIdFilter) {
          allUsersData[doc.id] = { ...userData, workRecords: [] };
        }
      });

      let workRecordsQuery = db
        .collection("work_records")
        .where("date", ">=", startDate)
        .where("date", "<=", endDate);

      if (statusFilter && statusFilter !== "not_checked_in") {
        workRecordsQuery = workRecordsQuery.where("status", "==", statusFilter);
      }

      workRecordsQuery = workRecordsQuery.orderBy("date", "desc");

      const recordsSnapshot = await workRecordsQuery.get();

      recordsSnapshot.forEach((doc) => {
        const record = doc.data();
        if (allUsersData[record.userId]) {
          allUsersData[record.userId].workRecords.push(record);
        }
      });

      let filteredUserIds = Object.keys(allUsersData);

      if (statusFilter === "not_checked_in") {
        filteredUserIds = filteredUserIds.filter(
          (userId) => allUsersData[userId].workRecords.length === 0,
        );
      } else if (statusFilter) {
        filteredUserIds = filteredUserIds.filter(
          (userId) => allUsersData[userId].workRecords.length > 0,
        );
      }

      totalItems = filteredUserIds.length;
      totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
      if (currentPage > totalPages) currentPage = totalPages;
      if (currentPage < 1) currentPage = 1;

      const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
      const endIndex = startIndex + ITEMS_PER_PAGE;
      const userIdsToShow = filteredUserIds.slice(startIndex, endIndex);

      let resultsHTML = "";
      if (userIdsToShow.length === 0) {
        resultsHTML = `<p class="text-sm text-center text-gray-500 py-4">ไม่พบข้อมูลพนักงานตามเงื่อนไขที่เลือก</p>`;
      } else {
        userIdsToShow.forEach((userId) => {
          const user = allUsersData[userId];
          const latestRecord =
            user.workRecords.length > 0 ? user.workRecords[0] : null;
          const report = latestRecord?.report;

          let statusText = "ยังไม่เข้างาน";
          let statusColor = "bg-gray-400";
          let checkInTime = "-";
          let checkOutTime = "-";
          let workHours = "-";
          let overtime = "-";
          let workTypeInfo = "-";
          let reportInfo = '<span class="text-gray-400">ยังไม่ส่งรายงาน</span>';
          let recordDate = "-";

          if (latestRecord) {
            recordDate = latestRecord.date.toDate().toLocaleDateString("th-TH");
            checkInTime = latestRecord.checkIn.timestamp
              .toDate()
              .toLocaleTimeString("th-TH", {
                hour: "2-digit",
                minute: "2-digit",
              });
            workTypeInfo =
              latestRecord.checkIn.workType === "in_factory"
                ? "ในโรงงาน"
                : `On-site: ${latestRecord.checkIn.onSiteDetails || "N/A"}`;

            if (report) {
              reportInfo = `${report.workType} (${report.project || "N/A"})`;
            }

            if (latestRecord.status === "checked_in") {
              statusText = "กำลังทำงาน";
              statusColor = "bg-green-500";
            } else if (latestRecord.status === "completed") {
              statusText = "สิ้นสุดการทำงาน";
              statusColor = "bg-red-500";
              if (latestRecord.checkOut) {
                checkOutTime = latestRecord.checkOut.timestamp
                  .toDate()
                  .toLocaleTimeString("th-TH", {
                    hour: "2-digit",
                    minute: "2-digit",
                  });

                // 1. คำนวณใหม่เสมอจากเวลาเข้า-ออกจริง
                const { regularWorkHours, overtimeHours: calculatedOt } =
                  calculateWorkHours(
                    latestRecord.checkIn.timestamp.toDate(),
                    latestRecord.checkOut.timestamp.toDate(),
                  );
                workHours = regularWorkHours.toFixed(2) + " ชม.";

                // 2. ตรวจสอบค่าจาก Database
                let finalOt = 0;
                // ถ้า DB มีค่า > 0 ให้ใช้ค่าจาก DB (เชื่อ DB)
                if (
                  latestRecord.overtime &&
                  typeof latestRecord.overtime.hours === "number"
                ) {
                  finalOt = latestRecord.overtime.hours;
                } else {
                  // ถ้า DB เป็น 0 หรือไม่มีค่า ให้ใช้ค่าที่คำนวณได้ (Fallback)
                  finalOt = calculatedOt;
                }
                overtime = finalOt.toFixed(1) + " ชม.";
                // -----------------------------------------
              }
            }
          } else {
            recordDate = "ไม่มีข้อมูลในช่วงนี้";
          }

          // ดึง Link แผนที่ (ถ้ามี)
          const mapLink = latestRecord?.checkIn?.googleMapLink || "#";
          const hasMap = !!latestRecord?.checkIn?.googleMapLink;

          resultsHTML += `
                    <div class="p-4 bg-white rounded-xl border border-gray-200 shadow-sm">
                        <div class="flex justify-between items-start">
                            <div class="flex items-center gap-3">
                                <img src="${user.profileImageUrl || "https://placehold.co/100x100/E2E8F0/475569?text=User"}" class="w-12 h-12 rounded-full object-cover flex-shrink-0">
                                <div>
                                    <p class="font-semibold text-gray-800">${user.fullName || "ไม่มีชื่อ"}</p>
                                    <div class="flex items-center gap-1.5 mt-1">
                                        <div class="w-2.5 h-2.5 rounded-full ${statusColor}"></div>
                                        <p class="text-xs font-medium text-gray-600">${statusText} (${recordDate})</p>
                                    </div>
                                    
                                    ${
                                      hasMap
                                        ? `
                                        <a href="${mapLink}" target="_blank" class="inline-flex items-center gap-1 mt-1 text-xs text-blue-600 hover:underline">
                                            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                                            ดูแผนที่ (Google Maps)
                                        </a>
                                    `
                                        : ""
                                    }
                                </div>
                            </div>
                        </div>
                        <div class="mt-3 pt-3 border-t border-gray-100 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                            <div><span class="text-gray-500">เข้า:</span> <span class="font-semibold text-green-600">${checkInTime}</span></div>
                            <div><span class="text-gray-500">ออก:</span> <span class="font-semibold text-red-500">${checkOutTime}</span></div>
                            <div><span class="text-gray-500">รวม:</span> <span class="font-medium text-gray-700">${workHours}</span></div>
                            <div><span class="text-gray-500">OT:</span> <span class="font-medium text-gray-700">${overtime}</span></div>
                            <div class="col-span-2 mt-1"><span class="text-gray-500">ประเภท:</span> <span class="font-medium text-gray-700">${workTypeInfo}</span></div>
                            <div class="col-span-2 mt-1"><span class="text-gray-500">รายงาน:</span> <span class="font-medium text-gray-700">${reportInfo}</span></div>
                        </div>
                    </div>
                `;
        });
      }

      container.innerHTML = resultsHTML;

      if (totalPages > 1) {
        const prevButton = document.createElement("button");
        prevButton.textContent = "◀";
        prevButton.className = `px-3 py-1 text-sm rounded ${currentPage === 1 ? "bg-gray-200 text-gray-400 cursor-not-allowed" : "bg-sky-500 text-white hover:bg-sky-600"}`;
        prevButton.disabled = currentPage === 1;
        prevButton.onclick = () => loadEmployeeSummary(currentPage - 1);
        paginationControls.appendChild(prevButton);

        const pageInfo = document.createElement("span");
        pageInfo.textContent = `หน้า ${currentPage} / ${totalPages}`;
        pageInfo.className = "text-sm text-gray-600 mx-2";
        paginationControls.appendChild(pageInfo);

        const nextButton = document.createElement("button");
        nextButton.textContent = "▶";
        nextButton.className = `px-3 py-1 text-sm rounded ${currentPage === totalPages ? "bg-gray-200 text-gray-400 cursor-not-allowed" : "bg-sky-500 text-white hover:bg-sky-600"}`;
        nextButton.disabled = currentPage === totalPages;
        nextButton.onclick = () => loadEmployeeSummary(currentPage + 1);
        paginationControls.appendChild(nextButton);
      }
    } catch (error) {
      console.error("Error loading employee summary:", error);
      container.innerHTML =
        '<p class="text-sm text-center text-red-500 py-2">เกิดข้อผิดพลาดในการโหลดข้อมูล</p>';
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

  async function exportEmployeeSummaryToExcel() {
    const startDateString = summaryStartDateInput.value;
    const endDateString = summaryEndDateInput.value;
    const userIdFilter = document.getElementById(
      "summary-employee-select",
    ).value;
    const statusFilter = summaryStatusFilterSelect.value;

    if (!startDateString || !endDateString) {
      return alert("กรุณาเลือกช่วงวันที่ก่อน Export");
    }

    showNotification("กำลังเตรียมข้อมูลสำหรับ Export...");

    try {
      const startDate = new Date(startDateString);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(endDateString);
      endDate.setHours(23, 59, 59, 999);

      // --- Step 1: ดึงข้อมูลปฏิทินและใบลา ---
      const holidayMap = new Map();
      const workingSaturdayMap = new Map();
      const approvedLeaveMap = new Map();

      try {
        const calendarDoc = await db
          .collection("system_settings")
          .doc("calendar_rules")
          .get();
        if (calendarDoc.exists) {
          const data = calendarDoc.data();
          (data.holidays || []).forEach((dateStr) =>
            holidayMap.set(dateStr, true),
          );
          (data.workingSaturdays || []).forEach((dateStr) =>
            workingSaturdayMap.set(dateStr, true),
          );
        }

        const approvedLeaveSnapshot = await db
          .collection("leave_requests")
          .where("status", "==", "approved")
          .where("startDate", "<=", endDate)
          .get();

        approvedLeaveSnapshot.forEach((doc) => {
          const leave = doc.data();

          if (leave.endDate.toDate() < startDate) return;

          const leaveTypeDisplay =
            LEAVE_TYPE_MAP[leave.leaveType] || leave.leaveType;

          if (leave.durationType === "hourly") {
            const dateKey = leave.startDate
              .toDate()
              .toISOString()
              .split("T")[0];
            const key = `${leave.userId}_${dateKey}`;
            approvedLeaveMap.set(key, {
              type: leaveTypeDisplay,
              durationType: "hourly",
              startTime: leave.startTime,
              endTime: leave.endTime,
            });
          } else {
            const start = leave.startDate.toDate();
            const end = leave.endDate.toDate();
            const current = new Date(
              Date.UTC(
                start.getUTCFullYear(),
                start.getUTCMonth(),
                start.getUTCDate(),
              ),
            );
            const final = new Date(
              Date.UTC(
                end.getUTCFullYear(),
                end.getUTCMonth(),
                end.getUTCDate(),
              ),
            );

            while (current.getTime() <= final.getTime()) {
              const y = current.getUTCFullYear();
              const m = (current.getUTCMonth() + 1).toString().padStart(2, "0");
              const d = current.getUTCDate().toString().padStart(2, "0");
              const dateKey = `${y}-${m}-${d}`;
              const key = `${leave.userId}_${dateKey}`;
              approvedLeaveMap.set(key, {
                type: leaveTypeDisplay,
                durationType: "full_day",
              });
              current.setUTCDate(current.getUTCDate() + 1);
            }
          }
        });
      } catch (e) {
        console.warn("Could not load calendar rules or approved leaves:", e);
      }

      // --- Step 2: ดึง User ---
      const usersSnapshot = await db
        .collection("users")
        .orderBy("fullName")
        .get();
      let filteredUsers = [];
      usersSnapshot.forEach((doc) => {
        if (!userIdFilter || doc.id === userIdFilter) {
          filteredUsers.push({
            id: doc.id,
            fullName: doc.data().fullName || doc.id,
            department: doc.data().department || "-",
          });
        }
      });

      if (filteredUsers.length === 0) {
        alert("ไม่พบข้อมูลพนักงานที่เลือก");
        return;
      }

      // --- Step 3 & 4: ดึง work_records ---
      const recordsSnapshot = await db
        .collection("work_records")
        .where("date", ">=", startDate)
        .where("date", "<=", endDate)
        .get();

      const recordsMap = new Map();
      recordsSnapshot.forEach((doc) => {
        const record = doc.data();
        const docId = doc.id;
        const dateString = docId.substring(docId.indexOf("_") + 1);
        const userId = record.userId;

        if (!recordsMap.has(userId)) {
          recordsMap.set(userId, new Map());
        }
        recordsMap.get(userId).set(dateString, record);
      });

      // --- Step 5: สร้าง Headers (เพิ่ม Google Map Link) ---
      const dataForExcel = [
        [
          "ชื่อพนักงาน",
          "แผนก",
          "วันที่",
          "ประเภทวัน",
          "สถานะ",
          "เวลาเข้า",
          "เวลาออก",
          "ชั่วโมงปกติ",
          "ชั่วโมง OT",
          "รายละเอียด On-site",
          "Google Map Link", // <--- เพิ่มคอลัมน์นี้ครับ
          "รายงาน: ประเภท",
          "รายงาน: โครงการ",
          "รายงาน: ระยะเวลา",
        ],
      ];

      const localDateFormatter = new Intl.DateTimeFormat("th-TH", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
      const localTimeFormatter = new Intl.DateTimeFormat("th-TH", {
        hour: "2-digit",
        minute: "2-digit",
      });

      // --- Step 6: Loop ---
      for (
        let day = new Date(startDate);
        day <= endDate;
        day.setDate(day.getDate() + 1)
      ) {
        const y = day.getFullYear();
        const m = (day.getMonth() + 1).toString().padStart(2, "0");
        const d = day.getDate().toString().padStart(2, "0");
        const dateKey = `${y}-${m}-${d}`;
        const dayOfWeek = day.getDay();

        let dayType = "วันทำงาน";
        if (holidayMap.has(dateKey)) dayType = "วันหยุดนักขัตฤกษ์";
        else if (dayOfWeek === 0) dayType = "วันอาทิตย์";
        else if (dayOfWeek === 6 && !workingSaturdayMap.has(dateKey))
          dayType = "วันเสาร์ (หยุด)";
        else if (dayOfWeek === 6 && workingSaturdayMap.has(dateKey))
          dayType = "วันเสาร์ (ทำงาน)";

        for (const user of filteredUsers) {
          const record = recordsMap.get(user.id)?.get(dateKey) || null;
          const approvedLeave = approvedLeaveMap.get(`${user.id}_${dateKey}`);

          let statusText = "",
            checkInTime = "-",
            checkOutTime = "-";
          let regularWorkHours = 0,
            overtimeHours = 0;
          let workTypeInfo = "-",
            onSiteDetails = "-",
            googleMapLink = "-";
          let reportType = "-",
            reportProject = "-",
            reportDuration = "-";

          if (record) {
            const report = record.report || {};
            const checkinDate = record.checkIn.timestamp.toDate();
            checkInTime = localTimeFormatter.format(checkinDate);
            workTypeInfo =
              record.checkIn.workType === "in_factory" ? "ในโรงงาน" : "On-site";
            onSiteDetails = record.checkIn.onSiteDetails || "-";

            // ดึงลิงก์ Google Map (ถ้ามี)
            googleMapLink = record.checkIn.googleMapLink || "-";

            reportType = report.workType || "-";
            reportProject = report.project || "-";
            reportDuration = report.duration || "-";

            if (record.status === "checked_in") {
              statusText = "กำลังทำงาน";
            } else if (record.status === "completed") {
              statusText = "สิ้นสุดการทำงาน";
              if (record.checkOut) {
                const checkoutDate = record.checkOut.timestamp.toDate();
                checkOutTime = localTimeFormatter.format(checkoutDate);

                // คำนวณ OT (Fallback logic)
                const hours = calculateWorkHours(checkinDate, checkoutDate);
                regularWorkHours = hours.regularWorkHours;

                if (
                  record.overtime &&
                  typeof record.overtime.hours === "number" &&
                  record.overtime.hours > 0
                ) {
                  overtimeHours = record.overtime.hours;
                } else {
                  overtimeHours = hours.overtimeHours;
                }
              }
            }

            const checkInMinutes =
              checkinDate.getHours() * 60 + checkinDate.getMinutes();
            const LATE_THRESHOLD_MINUTES = 8 * 60 + 30;

            if (
              dayType === "วันทำงาน" &&
              checkInMinutes > LATE_THRESHOLD_MINUTES
            ) {
              statusText = "มาสาย";
              if (approvedLeave && approvedLeave.durationType === "hourly") {
                const [eh, em] = approvedLeave.endTime.split(":").map(Number);
                if (checkInMinutes >= eh * 60 + em)
                  statusText = `ลา: ${approvedLeave.type} (ชม.)`;
              }
            }
          } else {
            if (approvedLeave) {
              let leaveText = approvedLeave.type.replace(/\s*\(.*\)\s*/g, "");
              if (approvedLeave.durationType === "hourly")
                leaveText += ` (${approvedLeave.startTime} - ${approvedLeave.endTime})`;
              statusText = `ลา: ${leaveText}`;
            } else if (
              dayType === "วันทำงาน" ||
              dayType === "วันเสาร์ (ทำงาน)"
            ) {
              statusText = "ไม่ได้ลงเวลา";
            } else {
              statusText = "วันหยุด";
            }
          }

          // Push ข้อมูลให้ตรงกับลำดับ Header
          dataForExcel.push([
            user.fullName,
            user.department,
            localDateFormatter.format(day),
            dayType,
            statusText,
            checkInTime,
            checkOutTime,
            regularWorkHours.toFixed(2),
            overtimeHours.toFixed(1),
            workTypeInfo,
            onSiteDetails,
            googleMapLink, // <--- ใส่ค่า Link ตรงนี้ (ลำดับต้องตรงกับ Header)
            reportType,
            reportProject,
            reportDuration,
          ]);
        }
      }

      if (dataForExcel.length <= 1) {
        alert("ไม่พบข้อมูลที่จะ Export ตามเงื่อนไขที่เลือก");
        return;
      }

      const ws = XLSX.utils.aoa_to_sheet(dataForExcel);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "สรุปเวลาทำงาน");
      const fileName = `สรุปเวลาทำงาน_${startDateString}_ถึง_${endDateString}.xlsx`;
      XLSX.writeFile(wb, fileName);
    } catch (error) {
      console.error("Error exporting excel:", error);
      alert("เกิดข้อผิดพลาด: " + error.message);
    }
  }

  function updateUIToCheckIn() {
    checkinBtn.classList.remove("hidden");
    checkoutBtn.classList.add("hidden");
    document.getElementById("request-ot-btn").classList.add("hidden");
    // Reset checkout button if previously completed
    checkoutBtn.disabled = false;
    checkoutBtn.classList.add(
      "checkout-btn-anim",
      "bg-red-500",
      "hover:bg-red-600",
    );
    checkoutBtn.classList.remove("bg-green-500", "completed-btn-anim");
    checkoutBtn.innerHTML = `
            <svg class="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
            <span class="text-2xl font-semibold mt-2">Check Out</span>
        `;
  }

  function updateUIToCheckedIn() {
    checkinBtn.classList.add("hidden");
    checkoutBtn.classList.remove("hidden");
    // Ensure checkout button is in the default state
    checkoutBtn.disabled = false;
    checkoutBtn.classList.add(
      "checkout-btn-anim",
      "bg-red-500",
      "hover:bg-red-600",
    );
    checkoutBtn.classList.remove("bg-green-500", "completed-btn-anim");
    checkoutBtn.innerHTML = `
            <svg class="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
            <span class="text-2xl font-semibold mt-2">Check Out</span>
        `;
  }

  function updateUIToCompleted() {
    checkinBtn.classList.add("hidden");
    checkoutBtn.classList.remove("hidden");
    checkoutBtn.disabled = true;
    checkoutBtn.classList.remove(
      "checkout-btn-anim",
      "bg-red-500",
      "hover:bg-red-600",
    );
    checkoutBtn.classList.add("bg-green-500", "completed-btn-anim");
    checkoutBtn.innerHTML = `
            <svg class="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
            <span class="text-2xl font-semibold mt-2">Completed</span>
        `;
    document.getElementById("request-ot-btn").classList.remove("hidden"); // [เพิ่มบรรทัดนี้]
  }

  // --- Logic ปุ่ม Check Out (รองรับ Group Checkout) ---
  checkoutBtn.addEventListener("click", async () => {
    // 1. Validation พื้นฐาน
    if (!currentUser) return showNotification("ไม่พบข้อมูลผู้ใช้", "error");
    if (!latestPosition)
      return showNotification("กำลังรอสัญญาณ GPS...", "warning");

    const checkoutSpan = checkoutBtn.querySelector("span");
    checkoutBtn.disabled = true;
    if (checkoutSpan) checkoutSpan.textContent = "ตรวจสอบสถานะกลุ่ม...";

    try {
      // 2. เตรียมข้อมูลเวลา
      const now = new Date();

      const docId = `${currentUser.uid}_${toLocalDateKey(now)}`;
      const workRecordRef = db.collection("work_records").doc(docId);
      const workRecordDoc = await workRecordRef.get();

      if (!workRecordDoc.exists) throw new Error("ไม่พบข้อมูลการเข้างาน");

      const recordData = workRecordDoc.data();
      const workType = recordData.checkIn.workType;
      const roomId = recordData.checkIn.roomId;

      // กำหนด Location Note
      const locationNote =
        workType === "in_factory"
          ? "factory_normal"
          : recordData.checkIn.locationNote || "On-site";

      // --- ฟังก์ชันบันทึก Check-out (ฉบับแก้ไข: Fix lat error + Cloud Function + Debug Mode) ---
      const executeSaveCheckout = async (
        withOT,
        note,
        groupUpdateData = null,
      ) => {
        // 1. ตรวจสอบข้อมูลพิกัด (Fix ReferenceError)
        if (!latestPosition || !latestPosition.coords) {
          if (typeof Swal !== "undefined") {
            Swal.fire(
              "ผิดพลาด",
              "ไม่พบข้อมูลตำแหน่ง GPS กรุณาลองใหม่อีกครั้ง",
              "error",
            );
          } else {
            alert("ไม่พบข้อมูลตำแหน่ง GPS");
          }
          return;
        }

        // ประกาศตัวแปร lat, lng จาก latestPosition ให้ถูกต้อง
        const lat = latestPosition.coords.latitude;
        const lng = latestPosition.coords.longitude;

        try {
          if (checkoutSpan) checkoutSpan.textContent = "กำลังบันทึก...";

          // ================= 🚧 TEST CODE START 🚧 =================
          // ⚠️ การตั้งค่าโหมด:
          // - true  = โหมดเทส (ระบบจะยอมใช้เวลาที่คุณล็อคไว้ด้านล่าง เพื่อให้คำนวณ OT ได้)
          // - false = โหมดใช้งานจริง (ระบบจะบังคับใช้เวลา Server เท่านั้น ป้องกันการโกง 100%)
          const isDebugMode = false;

          let clientCheckoutTime = new Date(); // เวลาปัจจุบันของเครื่อง

          if (isDebugMode) {
            // ล็อคเวลาเป็น 18:45 ของวันนี้ เพื่อเทสว่า OT ขึ้นไหม (0.75 ชม.)
            clientCheckoutTime.setHours(18, 45, 0, 0);
            console.warn(
              "⚠️ DEBUG MODE ACTIVATED: Force Checkout Time to 18:45",
            );
          }

          // เรียกใช้ Cloud Function 'recordTimestamp'
          const recordTimestampFn =
            cloudFunctions.httpsCallable("recordTimestamp");

          console.log("🚀 Payload to send:", {
            type: "checkout",
            calculateOT: withOT,
            checkoutTime: clientCheckoutTime.toISOString(),
            isDebug: isDebugMode,
            location: { latitude: lat, longitude: lng },
            note: note,
          });

          console.log("Sending request to Cloud Function...");

          const result = await recordTimestampFn({
            type: "checkout",
            calculateOT: withOT, // บอก Server ว่าเราขอคิด OT ไหม
            checkoutTime: clientCheckoutTime.toISOString(), // ส่งเวลาเครื่องไป
            isDebug: isDebugMode, // ส่งกุญแจลับไปบอก Server
            location: {
              // ส่งพิกัดที่ถูกต้อง
              latitude: lat,
              longitude: lng,
            },
            note: note, // ส่งหมายเหตุ
          });

          console.log("✅ Server Response:", result.data);

          // --- ส่วนจัดการ Group Checkout (สำหรับหัวหน้า) ---
          if (groupUpdateData && roomId) {
            console.log("Group checkout data processed for leader.");
            const roomRef = db.collection("onsite_rooms").doc(roomId);
            await roomRef.update(groupUpdateData);
          }

          // --- แจ้งเตือนความสำเร็จ ---
          if (typeof Swal !== "undefined") {
            let msg = "บันทึกเวลาเลิกงานเรียบร้อยแล้ว";

            // ถ้า Server ส่งยอด OT กลับมา ให้โชว์ด้วย
            if (result.data && result.data.overtimeHours > 0) {
              msg += `\n(บันทึก OT: ${result.data.overtimeHours} ชม.)`;
            }

            Swal.fire({
              title: "สำเร็จ",
              text: msg,
              icon: "success",
              timer: 2000,
              showConfirmButton: false,
            }).then(() => window.location.reload());
          } else {
            alert("บันทึกเวลาเลิกงานเรียบร้อยแล้ว");
            window.location.reload();
          }
        } catch (error) {
          console.error("❌ Checkout Error:", error);

          // แสดง Error ที่ชัดเจน
          let errorMsg = error.message;
          if (error.code === "permission-denied")
            errorMsg = "ไม่มีสิทธิ์เข้าถึงข้อมูล";
          if (error.code === "internal")
            errorMsg = "เกิดข้อผิดพลาดที่ Server (Cloud Function)";

          if (typeof Swal !== "undefined") {
            Swal.fire("เกิดข้อผิดพลาด", errorMsg, "error");
          } else {
            alert("Error: " + errorMsg);
          }

          // คืนค่าปุ่มให้กดใหม่ได้
          if (checkoutSpan) checkoutSpan.textContent = "Check Out";
          checkoutBtn.disabled = false;
        }
      };

      // Helper: ถาม OT (ใช้ร่วมกันทุกกรณี)
      function checkTimeAndProceed(note, groupUpdate = null) {
        const h = now.getHours();
        const m = now.getMinutes();

        // ★ แก้กลับเป็น 18 (หรือเวลาที่คุณต้องการให้ระบบเริ่มถามเรื่อง OT)
        // เดิมตอนเทสคือ h >= 8
        if (h >= 18) {
          setTimeout(() => {
            showConfirmDialog(
              "เลยเวลาเลิกงาน ต้องการบันทึก OT หรือไม่?",
              () => executeSaveCheckout(true, note, groupUpdate),
              () => executeSaveCheckout(false, note, groupUpdate),
              "บันทึก OT",
              "ไม่เอา OT",
            );
          }, 300);
        } else {
          executeSaveCheckout(true, note, groupUpdate);
        }
      }

      // =========================================================
      // 3. Logic แยกตามประเภทงาน (Main Logic)
      // =========================================================

      // >>> กรณี: Onsite Group (ทำงานเป็นกลุ่ม) <<<
      if (workType === "onsite_group" && roomId) {
        // ดึงข้อมูลห้อง (Room) มาตรวจสอบสถานะ
        const roomRef = db.collection("onsite_rooms").doc(roomId);
        const roomDoc = await roomRef.get();
        if (!roomDoc.exists)
          throw new Error("ไม่พบข้อมูลกลุ่มงาน (Room Not Found)");
        const roomData = roomDoc.data();

        const isLeader = currentUser.uid === roomData.leaderId;

        if (isLeader) {
          // [Leader Logic]: เป็นคนเลือกสถานที่ปิดงาน

          showConfirmDialog(
            "Leader: จบงานที่ไหน? (สมาชิกจะยึดตามคุณ)",

            // Choice A: กลับโรงงาน (ขวา)
            async () => {
              const dist = calculateDistance(
                latestPosition.coords.latitude,
                latestPosition.coords.longitude,
                FACTORY_LOCATION.latitude,
                FACTORY_LOCATION.longitude,
              );
              if (dist > ALLOWED_RADIUS_METERS) {
                showNotification(
                  `คุณยังไม่ถึงโรงงาน (ห่าง ${dist.toFixed(0)} ม.)`,
                  "error",
                );
                checkoutBtn.disabled = false;
                if (checkoutSpan) checkoutSpan.textContent = "Check Out";
                return;
              }

              // ถ้าผ่าน: เตรียมข้อมูลปิดห้องว่า "กลับโรงงาน"
              const groupUpdate = {
                status: "closed",
                checkoutMode: "factory_return",
                checkoutTime: firebase.firestore.FieldValue.serverTimestamp(),
              };
              checkTimeAndProceed("factory_return", groupUpdate);
            },

            // Choice B: พักโรงแรม (ซ้าย)
            async () => {
              // เตรียมข้อมูลปิดห้องว่า "พักโรงแรม"
              const groupUpdate = {
                status: "closed",
                checkoutMode: "offsite_hotel",
                checkoutTime: firebase.firestore.FieldValue.serverTimestamp(),
              };
              checkTimeAndProceed("offsite_hotel", groupUpdate);
            },
            "กลับโรงงาน",
            "พักโรงแรม",
          );
        } else {
          // [Member Logic]: รอหัวหน้า / ทำตามหัวหน้า

          if (roomData.status !== "closed" || !roomData.checkoutMode) {
            // หัวหน้ายังไม่กดปิดงาน
            showNotification(
              "กรุณารอหัวหน้ากลุ่ม (Leader) กด Check-out ก่อน",
              "warning",
            );
            checkoutBtn.disabled = false;
            if (checkoutSpan) checkoutSpan.textContent = "Check Out";
            return;
          }

          // หัวหน้ากดแล้ว -> ตรวจสอบโหมดที่หัวหน้าเลือก
          if (roomData.checkoutMode === "factory_return") {
            // หัวหน้าเลือกกลับโรงงาน -> สมาชิกต้องเช็คระยะด้วย
            const dist = calculateDistance(
              latestPosition.coords.latitude,
              latestPosition.coords.longitude,
              FACTORY_LOCATION.latitude,
              FACTORY_LOCATION.longitude,
            );
            if (dist > ALLOWED_RADIUS_METERS) {
              showNotification(
                `หัวหน้าจบงานที่โรงงาน แต่คุณอยู่นอกพื้นที่ (${dist.toFixed(0)} ม.)`,
                "error",
              );
              checkoutBtn.disabled = false;
              if (checkoutSpan) checkoutSpan.textContent = "Check Out";
              return;
            }
            checkTimeAndProceed("factory_return_member");
          } else {
            // หัวหน้าเลือกพักโรงแรม -> สมาชิกผ่านได้เลย
            checkTimeAndProceed("offsite_hotel_member");
          }
        }
      } else {
        // >>> กรณี: ทำงานคนเดียว / In Factory (Logic เดิม) <<<

        const dist = calculateDistance(
          latestPosition.coords.latitude,
          latestPosition.coords.longitude,
          FACTORY_LOCATION.latitude,
          FACTORY_LOCATION.longitude,
        );
        if (dist <= ALLOWED_RADIUS_METERS) {
          // อยู่ในโรงงาน -> ผ่าน
          checkTimeAndProceed("factory_normal");
        } else {
          // อยู่นอกโรงงาน -> แจ้งเตือน
          showNotification(
            `อยู่นอกพื้นที่โรงงาน (${dist.toFixed(0)} ม.)`,
            "error",
          );
          checkoutBtn.disabled = false;
          if (checkoutSpan) checkoutSpan.textContent = "Check Out";
        }
      }
    } catch (error) {
      console.error("Checkout Global Error:", error);
      showNotification("Error: " + error.message, "error");
      checkoutBtn.disabled = false;
      if (checkoutSpan) checkoutSpan.textContent = "Check Out";
    }
  });

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

  function switchRole(role) {
    // role เ
    if (role === "member") {
      memberSection.classList.remove("hidden");
      leaderSection.classList.add("hidden");

      roleMemberBtn.classList.add(...activeClass);
      roleMemberBtn.classList.remove(...inactiveClass);
      roleLeaderBtn.classList.remove(...activeClass);
      roleLeaderBtn.classList.add(...inactiveClass);

      // ปิดปุ่ม Check In หลัก เพราะสมาชิกจะ Check in ผ่าน QR
      document.getElementById("checkin-btn").classList.add("hidden");
    } else {
      memberSection.classList.add("hidden");
      leaderSection.classList.remove("hidden");

      roleLeaderBtn.classList.add(...activeClass);
      roleLeaderBtn.classList.remove(...inactiveClass);
      roleMemberBtn.classList.remove(...activeClass);
      roleMemberBtn.classList.add(...inactiveClass);

      // Leader สร้างห้องแล้วถือว่า Check-in เลย หรือกดปุ่มสร้างห้อง
      document.getElementById("checkin-btn").classList.add("hidden");
    }
  }

  if (roleMemberBtn)
    roleMemberBtn.addEventListener("click", () => switchRole("member"));
  if (roleLeaderBtn)
    roleLeaderBtn.addEventListener("click", () => switchRole("leader"));

  // --- 2. Logic ฝั่ง Leader (สร้างห้อง) ---
  const createRoomBtn = document.getElementById("create-room-btn");
  const roomQrContainer = document.getElementById("room-qr-container");
  const roomMembersList = document.getElementById("room-members-list");

  if (createRoomBtn) {
    createRoomBtn.addEventListener("click", async () => {
      // <--- 1. ต้องมี async ตรงนี้
      const project = document.getElementById("room-project-input").value;
      const locationName = document.getElementById("room-location-input").value;

      if (!project || !locationName) {
        alert("กรุณากรอกชื่อโครงการและสถานที่");
        return;
      }

      if (!currentUser) {
        alert("คุณยังไม่ได้เข้าสู่ระบบ หรือ Session หมดอายุ");
        return;
      }

      if (!latestPosition) {
        alert("กรุณารอสัญญาณ GPS สักครู่...");
        return;
      }

      createRoomBtn.disabled = true;
      createRoomBtn.textContent = "กำลังสร้างห้อง...";

      // ------------------------------------------------------------------
      // [จุดที่แก้] โหลด Library QR Code ก่อนเริ่มทำงาน (ต้องมี await)
      // ------------------------------------------------------------------
      if (typeof QRCode === "undefined") {
        // เช็คว่ามี QRCode หรือยัง ถ้าไม่มีค่อยโหลด
        try {
          // รอให้โหลดเสร็จก่อนค่อยไปต่อ
          await loadScript(
            "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js",
          );
        } catch (e) {
          console.error(e);
          alert("ไม่สามารถโหลดระบบ QR Code ได้ กรุณาตรวจสอบอินเทอร์เน็ต");
          createRoomBtn.disabled = false;
          createRoomBtn.textContent = "สร้างห้อง Check-in";
          return; // จบการทำงานทันทีถ้าโหลดไม่ได้
        }
      }
      // ------------------------------------------------------------------

      try {
        const leaderNow = new Date();
        // 1. สร้าง Room ID
        const roomId = Math.random().toString(36).substring(2, 9).toUpperCase();

        // ... (โค้ดส่วนสร้าง roomData และ Firestore เหมือนเดิม) ...
        const roomData = {
          roomId: roomId,
          leaderId: currentUser.uid,
          leaderName: currentUserData.fullName,
          project: project,
          locationName: locationName,
          // เก็บพิกัด GPS ของ Leader
          gpsLocation: new firebase.firestore.GeoPoint(
            latestPosition.coords.latitude,
            latestPosition.coords.longitude,
          ),
          // เก็บเวลาที่ Leader สร้างห้องไว้ให้สมาชิกใช้
          leaderTimestamp: firebase.firestore.Timestamp.fromDate(leaderNow),
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          isActive: true,
          members: [],
        };

        await db.collection("onsite_rooms").doc(roomId).set(roomData);
        // เรียก performCheckIn ของ Leader
        await performCheckIn(
          roomId,
          project,
          locationName,
          "leader",
          currentUser.uid,
          leaderNow,
        );

        // 4. สร้าง QR Code (ตอนนี้ QRCode จะไม่ error แล้วเพราะเรา await โหลดมาแล้ว)
        document.getElementById("qrcode").innerHTML = "";
        new QRCode(document.getElementById("qrcode"), {
          text: roomId,
          width: 180,
          height: 180,
        });

        // 5. แสดง UI
        createRoomBtn.classList.add("hidden");
        roomQrContainer.classList.remove("hidden");
        listenToRoomMembers(roomId);
      } catch (error) {
        console.error("Error creating room:", error);
        alert("เกิดข้อผิดพลาด: " + error.message);
        createRoomBtn.disabled = false;
        createRoomBtn.textContent = "สร้างห้อง Check-in";
      }
    });
  }

  function listenToRoomMembers(roomId) {
    roomUnsubscribe = db
      .collection("onsite_rooms")
      .doc(roomId)
      .onSnapshot((doc) => {
        if (doc.exists) {
          const data = doc.data();
          const members = data.members || [];

          // อัปเดตรายชื่อสมาชิกที่หน้าจอ Leader
          if (members.length === 0) {
            roomMembersList.innerHTML =
              '<li class="text-gray-400 italic">รอสมาชิกสแกน...</li>';
          } else {
            // ดึงชื่อจาก users collection (แบบง่ายอาจจะเก็บชื่อใน array members เลยก็ได้ แต่ที่นี่สมมติเก็บแค่ uid)
            // เพื่อความง่าย แนะนำให้เก็บ {uid, name} ใน members array ตอนจอย
            roomMembersList.innerHTML = members
              .map(
                (m) =>
                  `<li class="text-green-600 font-medium">✓ ${m.name}</li>`,
              )
              .join("");
          }
        }
      });
  }

  // --- 3. Logic Member (Scan QR) ---
  const startScanBtn = document.getElementById("start-scan-btn");

  if (startScanBtn) {
    startScanBtn.addEventListener("click", async () => {
      // เติม async

      // 1. สั่งโหลด Library กล้อง
      try {
        // ใส่ URL ของ html5-qrcode
        await loadScript("https://unpkg.com/html5-qrcode");
      } catch (e) {
        alert("โหลดกล้องไม่สำเร็จ");
        return;
      }

      const html5QrCode = new Html5Qrcode("reader");
      const qrCodeSuccessCallback = (decodedText, decodedResult) => {
        // หยุดสแกนเมื่อเจอ QR
        html5QrCode
          .stop()
          .then(() => {
            document.getElementById("reader").classList.add("hidden");
            document.getElementById("scan-status").textContent =
              "สแกนสำเร็จ! กำลังตรวจสอบ...";
            joinRoom(decodedText); // decodedText คือ roomId
          })
          .catch((err) => {
            console.log("Stop failed ", err);
          });
      };

      const config = { fps: 10, qrbox: { width: 250, height: 250 } };

      // เปิดกล้อง
      document.getElementById("reader").classList.remove("hidden");
      html5QrCode
        .start({ facingMode: "environment" }, config, qrCodeSuccessCallback)
        .catch((err) => {
          alert("ไม่สามารถเปิดกล้องได้: " + err);
        });
    });
  }

  async function joinRoom(roomId) {
    if (!currentUser) return;

    try {
      // 1. ตรวจสอบว่าห้องมีอยู่จริงและยัง Active อยู่
      const roomRef = db.collection("onsite_rooms").doc(roomId);
      const roomDoc = await roomRef.get();

      if (!roomDoc.exists || !roomDoc.data().isActive) {
        alert("ห้องนี้ปิดไปแล้ว หรือรหัสไม่ถูกต้อง");
        document.getElementById("scan-status").textContent =
          "กดปุ่มเพื่อเริ่มสแกนใหม่";
        return;
      }

      const roomData = roomDoc.data();

      // 2. ตรวจสอบระยะห่างกับ Leader (Optional: ป้องกันการส่งรูป QR ให้กัน)
      // หากต้องการเข้มงวด ให้เช็ค distance ระหว่าง latestPosition กับ roomData.gpsLocation

      // 3. ทำการ Check-in
      await performCheckIn(
        roomId,
        roomData.project,
        roomData.locationName,
        "member",
        roomData.leaderId,
      );

      // 4. อัปเดตชื่อลงในรายชื่อสมาชิกของห้อง
      await roomRef.update({
        members: firebase.firestore.FieldValue.arrayUnion({
          uid: currentUser.uid,
          name: currentUserData.fullName,
        }),
      });

      alert(`เข้าร่วมกลุ่ม "${roomData.project}" สำเร็จ!`);
      // รีเฟรชหน้าหรือเปลี่ยนสถานะ UI
      location.reload(); // หรือ updateUIToCheckedIn()
    } catch (error) {
      console.error("Join room error:", error);
      alert("เกิดข้อผิดพลาดในการเข้าร่วม: " + error.message);
    }
  }

  // --- 4. ฟังก์ชัน Check-in รวม (ใช้ทั้ง Leader และ Member) ---
  // เพิ่ม parameter 'customTime' ต่อท้าย

  async function performCheckIn(
    roomId,
    project,
    locationName,
    role,
    leaderId,
    customTime = null,
  ) {
    // 1. กำหนดเวลา: ถ้ามี customTime (จาก Leader) ให้ใช้ค่านั้น ถ้าไม่มี (Member) ให้ดึงจาก Room
    let checkInTime = customTime || new Date();
    let checkInLocation = new firebase.firestore.GeoPoint(
      latestPosition.coords.latitude,
      latestPosition.coords.longitude,
    );

    // 2. ถ้าเป็นสมาชิก (Member) ให้ไปดึงเวลาและพิกัดจากข้อมูลห้อง (Room)
    if (role === "member") {
      const roomDoc = await db.collection("onsite_rooms").doc(roomId).get();
      if (roomDoc.exists) {
        const rData = roomDoc.data();
        // ใช้เวลาเดียวกับ Leader
        if (rData.leaderTimestamp) {
          checkInTime = rData.leaderTimestamp.toDate();
        }
        // ใช้พิกัดเดียวกับ Leader
        if (rData.gpsLocation) {
          checkInLocation = rData.gpsLocation;
        }
      }
    }

    const docId = `${currentUser.uid}_${toLocalDateKey(checkInTime)}`;

    const workRecord = {
      userId: currentUser.uid,
      date: firebase.firestore.Timestamp.fromDate(checkInTime),
      checkIn: {
        timestamp: firebase.firestore.Timestamp.fromDate(checkInTime),
        location: checkInLocation, // ใช้พิกัดที่ดึงมา (ของ Leader)
        // สร้างลิงก์แผนที่จากพิกัดของ Leader
        googleMapLink: `https://www.google.com/maps/search/?api=1&query=${checkInLocation.latitude},${checkInLocation.longitude}`,
        accuracy: role === "leader" ? latestPosition.coords.accuracy : null,
        workType: "onsite_group",
        roomId: roomId,
        leaderId: leaderId,
        onSiteDetails: `${locationName} (Group: ${project})`,
        photoUrl: null,
      },
      status: "checked_in",
      report: null,
      checkOut: null,
      overtime: null,
    };

    await db.collection("work_records").doc(docId).set(workRecord);
    updateUIToCheckedIn();
    showNotification("บันทึกเวลาเข้างานเรียบร้อย (เวลาเดียวกับหัวหน้า)");
  }

  // เพิ่ม Logic การกดปุ่ม On-site ใน Event Listener เดิม
  workTypeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      // 1. เปลี่ยนสีปุ่ม (เหมือนเดิม)
      workTypeButtons.forEach((btn) => {
        btn.classList.remove("bg-sky-500", "text-white", "shadow");
        btn.classList.add("text-gray-600");
      });
      button.classList.add("bg-sky-500", "text-white", "shadow");

      // 2. อัปเดตตัวแปร selectedWorkType
      selectedWorkType = button.dataset.workType;

      // 3. Logic การแสดงผล (แก้ไขใหม่)
      if (selectedWorkType === "on_site") {
        // แสดงฟอร์ม QR
        document
          .getElementById("onsite-details-form")
          .classList.remove("hidden");

        // *** [แก้ไข] สั่งซ่อนทั้งปุ่ม Check In และ Check Out เสมอเมื่อเข้าโหมด On-site ***
        document.getElementById("checkin-btn").classList.add("hidden");
        document.getElementById("checkout-btn").classList.add("hidden");
        document.getElementById("request-ot-btn").classList.add("hidden"); // ซ่อนปุ่ม OT ด้วยถ้ามี

        // เริ่มต้นที่โหมด Member
        switchRole("member");
      } else {
        // ซ่อนฟอร์ม QR
        document.getElementById("onsite-details-form").classList.add("hidden");

        // *** [แก้ไข] ให้เช็คสถานะล่าสุดเพื่อโชว์ปุ่มที่ถูกต้อง (เข้า หรือ ออก) ***
        checkUserWorkStatus();
      }
    });
  });

  // ตัวอย่างฟังก์ชันเมื่อ Leader กดปุ่ม "ส่งรายงานกลุ่ม"
  async function submitGroupReport(roomId, reportData) {
    // 1. ดึงข้อมูลห้องเพื่อเอารายชื่อสมาชิก
    const roomDoc = await db.collection("onsite_rooms").doc(roomId).get();
    const members = roomDoc.data().members || [];

    // 2. เตรียมข้อมูล Report
    const reportPayload = {
      workType: reportData.workType, // เช่น "ติดตั้งระบบไฟ"
      project: reportData.project, // เช่น "Project A"
      duration: "ทั้งวัน (08:30 - 17:30)",
      submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
      submittedBy: "Leader", // ระบุว่าหัวหน้าทำให้
    };

    // 3. วนลูปอัปเดตให้ทุกคนในลิสต์ (รวมถึงตัว Leader เองด้วย)
    const batch = db.batch(); // ใช้ Batch เพื่อความเร็วและชัวร์
    const dateKey = toLocalDateKey(new Date()); // ฟังก์ชันแปลงวันที่เป็น YYYY-MM-DD

    members.forEach((member) => {
      const docId = `${member.uid}_${dateKey}`;
      const ref = db.collection("work_records").doc(docId);

      // สั่งอัปเดตเฉพาะส่วน report
      batch.update(ref, { report: reportPayload });
    });

    // 4. ยิงขึ้น Database ทีเดียว
    await batch.commit();
    alert("บันทึกรายงานให้สมาชิก " + members.length + " คน เรียบร้อยแล้ว!");
  }

  // ตั้งค่าวันที่เริ่มต้นเป็นวันนี้
  if (timelineDatePicker) {
    const todayISO = new Date().toISOString().split("T")[0];
    timelineDatePicker.value = todayISO;
  }

  if (tsTabBtns) {
    tsTabBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.dataset.target; // เก็บค่า ID ของแท็บที่กด เช่น 'tab-payroll'

        // 1. รีเซ็ตทุกปุ่มให้เป็นสถานะ "ไม่ได้เลือก"
        tsTabBtns.forEach((b) => {
          // ลบ Class สีฟ้า
          b.classList.remove("border-sky-500", "text-sky-600", "bg-sky-50");
          // ใส่ Class สีเทาปกติ
          b.classList.add(
            "border-transparent",
            "text-gray-500",
            "hover:text-gray-700",
            "hover:border-gray-300",
          );
        });

        // 2. ตั้งค่าปุ่มที่ถูกกดให้เป็น "เลือกแล้ว" (Active)
        btn.classList.remove(
          "border-transparent",
          "text-gray-500",
          "hover:text-gray-700",
          "hover:border-gray-300",
        );
        btn.classList.add("border-sky-500", "text-sky-600");

        // 3. แสดงเนื้อหา (Content) ของแท็บที่เลือก
        tsTabContents.forEach((c) => {
          if (c.id === target) {
            c.classList.remove("hidden");
            c.classList.add("animate-fade-in");
          } else {
            c.classList.add("hidden");
            c.classList.remove("animate-fade-in");
          }
        });

        // ตรวจสอบว่าถ้ากดแท็บ Payroll ให้โหลดรายชื่อพนักงาน ---
        if (target === "tab-payroll") {
          console.log("เข้าสู่แท็บ Payroll: กำลังโหลดรายชื่อพนักงาน...");
          if (typeof populatePayrollUserDropdown === "function") {
            populatePayrollUserDropdown();
          }

          if (typeof populatePayrollDeptDropdown === "function") {
            populatePayrollDeptDropdown();
          }
        }
      });
    });
  }

  // 3. ฟังก์ชันโหลดข้อมูล Timeline (หัวใจหลัก)
  async function loadTimelineData() {
    if (!timelineContainer) return;

    timelineContainer.innerHTML =
      '<div class="flex justify-center py-8"><svg class="animate-spin h-8 w-8 text-sky-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg></div>';

    const selectedDateStr = timelineDatePicker.value;
    const selectedDate = new Date(selectedDateStr);
    selectedDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(selectedDate);
    nextDay.setDate(selectedDate.getDate() + 1);

    try {
      // ดึงข้อมูล 2 ส่วนพร้อมกัน: Users ทั้งหมด และ Records ของวันนี้
      const [usersSnapshot, recordsSnapshot] = await Promise.all([
        db.collection("users").orderBy("fullName").get(),
        db
          .collection("work_records")
          .where("date", ">=", selectedDate)
          .where("date", "<", nextDay)
          .get(),
      ]);

      // Map Records ให้เข้าถึงง่ายด้วย userId
      const recordsMap = {};
      recordsSnapshot.forEach((doc) => {
        recordsMap[doc.data().userId] = doc.data();
      });

      let html = "";

      if (usersSnapshot.empty) {
        timelineContainer.innerHTML =
          '<p class="text-center text-gray-400">ไม่พบข้อมูลพนักงาน</p>';
        return;
      }

      usersSnapshot.forEach((doc) => {
        const user = doc.data();
        const userId = doc.id;
        const record = recordsMap[userId];

        // Default Values (กรณีไม่มาทำงาน)
        let checkInTime = "--:--";
        let checkOutTime = "--:--";
        let statusBadge =
          '<span class="px-2 py-1 rounded bg-gray-100 text-gray-500 text-xs">Absent</span>';
        let checkInColor = "text-gray-300";
        let checkOutColor = "text-gray-300";
        let locationIcon = ""; // ไม่แสดงไอคอนถ้ายังไม่เข้างาน

        if (record) {
          // มีข้อมูลการลงเวลา
          const cin = record.checkIn.timestamp.toDate();
          checkInTime = cin.toLocaleTimeString("th-TH", {
            hour: "2-digit",
            minute: "2-digit",
          });
          checkInColor = "text-blue-500";

          // Check Late Condition (สายถ้าเข้าหลัง 08:30)
          const lateThreshold = new Date(cin);
          lateThreshold.setHours(8, 30, 0, 0);

          if (cin > lateThreshold) {
            statusBadge =
              '<span class="px-2 py-1 rounded bg-orange-100 text-orange-600 text-xs font-bold">Late</span>';
          } else {
            statusBadge =
              '<span class="px-2 py-1 rounded bg-green-100 text-green-600 text-xs font-bold">On Time</span>';
          }

          if (record.checkOut) {
            const cout = record.checkOut.timestamp.toDate();
            checkOutTime = cout.toLocaleTimeString("th-TH", {
              hour: "2-digit",
              minute: "2-digit",
            });
            checkOutColor = "text-pink-500";
          }

          // Location Icon Logic
          if (record.checkIn.workType === "in_factory") {
            // ไอคอนโรงงาน/GPS
            locationIcon = `<div class="tooltip" title="Factory (GPS)"><svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg></div>`;
          } else {
            // ไอคอน On-site
            locationIcon = `<div class="tooltip" title="On-Site"><svg class="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg></div>`;
          }
        }

        // HTML Structure (เลียนแบบ Timeline ในรูป)
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

            </div>
            `;
      });

      timelineContainer.innerHTML = html;
    } catch (error) {
      console.error("Error loading timeline:", error);
      timelineContainer.innerHTML =
        '<p class="text-center text-red-500">เกิดข้อผิดพลาดในการโหลดข้อมูล</p>';
    }
  }

  // 4. ผูก Event Listener
  if (refreshTimelineBtn) {
    refreshTimelineBtn.addEventListener("click", loadTimelineData);
  }
  if (timelineDatePicker) {
    timelineDatePicker.addEventListener("change", loadTimelineData);
  }

  // 5. เชื่อมต่อเมนู Sidebar ให้เปิดหน้านี้ และโหลดข้อมูล
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.addEventListener("click", (e) => {
      if (item.dataset.page === "timesheet-management-page") {
        loadTimelineData(); // โหลดข้อมูลทันทีเมื่อกดเข้ามา
      }
    });
  });

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
  const tsApplyBtn = document.getElementById("ts-apply-filter-btn");

  if (tsFilterStart && tsFilterEnd) {
    // Default: วันที่ 1 ถึง ปัจจุบัน ของเดือนนี้
    const date = new Date();
    const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
    tsFilterStart.value = firstDay.toISOString().split("T")[0];
    tsFilterEnd.value = date.toISOString().split("T")[0];
  }

  // 2. ฟังก์ชันโหลดข้อมูลตาราง
  async function loadTimesheetTable() {
    const tbody = document.getElementById("ts-table-body");
    const recordCount = document.getElementById("ts-record-count");
    const startDateStr = tsFilterStart.value;
    const endDateStr = tsFilterEnd.value;
    const searchTerm = document
      .getElementById("ts-search-input")
      .value.toLowerCase();

    if (!tbody) return;

    tbody.innerHTML =
      '<tr><td colspan="8" class="px-6 py-8 text-center text-gray-400"><div class="flex justify-center items-center gap-2"><svg class="animate-spin h-5 w-5 text-sky-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>กำลังโหลดข้อมูล...</div></td></tr>';

    try {
      const startDate = new Date(startDateStr);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(endDateStr);
      endDate.setHours(23, 59, 59, 999);

      // ดึงข้อมูล Users และ Work Records
      const [usersSnapshot, recordsSnapshot] = await Promise.all([
        db.collection("users").get(),
        db
          .collection("work_records")
          .where("date", ">=", startDate)
          .where("date", "<=", endDate)
          .orderBy("date", "desc") // เรียงจากล่าสุดไปเก่า
          .get(),
      ]);

      // Map User Data
      const usersMap = {};
      usersSnapshot.forEach((doc) => (usersMap[doc.id] = doc.data()));

      let html = "";
      let count = 0;

      if (recordsSnapshot.empty) {
        tbody.innerHTML =
          '<tr><td colspan="8" class="px-6 py-8 text-center text-gray-400">ไม่พบข้อมูลในช่วงเวลานี้</td></tr>';
        if (recordCount) recordCount.textContent = `แสดง 0 รายการ`;
        return;
      }

      recordsSnapshot.forEach((doc) => {
        const record = doc.data();
        const user = usersMap[record.userId];
        const userName = user ? user.fullName : "Unknown User";

        if (searchTerm && !userName.toLowerCase().includes(searchTerm)) {
          return;
        }

        count++;

        const dateObj = record.date.toDate();
        const dateStr = dateObj.toLocaleDateString("th-TH", {
          day: "2-digit",
          month: "short",
          year: "2-digit",
        });
        const dayName = dateObj.toLocaleDateString("th-TH", {
          weekday: "short",
        });

        const checkInTime = record.checkIn.timestamp
          .toDate()
          .toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
        let checkOutTime = "-";
        let workHours = "-";
        let otHours = "-";
        let statusBadge = "";
        let rowClass =
          "hover:bg-gray-50 transition-colors border-b border-gray-100";

        const lateThreshold = new Date(record.checkIn.timestamp.toDate());
        lateThreshold.setHours(8, 30, 0, 0);
        const isLate = record.checkIn.timestamp.toDate() > lateThreshold;

        if (record.status === "completed" && record.checkOut) {
          checkOutTime = record.checkOut.timestamp
            .toDate()
            .toLocaleTimeString("th-TH", {
              hour: "2-digit",
              minute: "2-digit",
            });
          const calcs = calculateWorkHours(
            record.checkIn.timestamp.toDate(),
            record.checkOut.timestamp.toDate(),
          );
          workHours = calcs.regularWorkHours.toFixed(2);

          let otVal = calcs.overtimeHours;
          if (record.overtime && record.overtime.hours > 0)
            otVal = record.overtime.hours;
          otHours =
            otVal > 0
              ? `<span class="text-orange-600 font-bold">${otVal.toFixed(1)}</span>`
              : "-";

          if (isLate) {
            statusBadge = `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">สาย</span>`;
          } else {
            statusBadge = `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">ปกติ</span>`;
          }
        } else {
          statusBadge = `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">กำลังทำงาน</span>`;
          const now = new Date();
          if (
            now.getDate() !== dateObj.getDate() &&
            record.status === "checked_in"
          ) {
            statusBadge = `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">Missing Out</span>`;
            rowClass = "bg-red-50 hover:bg-red-100 border-b border-red-100";
          }
        }

        html += `
                <tr class="${rowClass}">
                    <td class="px-6 py-4 whitespace-nowrap">
                        <div class="flex items-center">
                            <div class="flex-shrink-0 h-8 w-8">
                                <img class="h-8 w-8 rounded-full object-cover" src="${user?.profileImageUrl || "https://placehold.co/100x100/E2E8F0/475569?text=User"}" alt="">
                            </div>
                            <div class="ml-4">
                                <div class="text-sm font-medium text-gray-900">${userName}</div>
                                <div class="text-xs text-gray-500">${user?.department || "N/A"}</div>
                            </div>
                        </div>
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap">
                        <div class="text-sm text-gray-900">${dateStr}</div>
                        <div class="text-xs text-gray-500">${dayName}</div>
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-500">
                        08:30 - 17:30
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-center text-sm ${isLate ? "text-red-600 font-semibold" : "text-gray-900"}">
                        ${checkInTime}
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-900">
                        ${checkOutTime}
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-900 font-medium">
                        ${workHours}
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-500">
                        ${otHours}
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-center">
                        ${statusBadge}
                    </td>
                </tr>
                `;
      });

      tbody.innerHTML = html;
      if (recordCount) recordCount.textContent = `แสดง ${count} รายการ`;
    } catch (error) {
      console.error("Error loading timesheet table:", error);
      tbody.innerHTML =
        '<tr><td colspan="8" class="px-6 py-8 text-center text-red-500">เกิดข้อผิดพลาดในการโหลดข้อมูล</td></tr>';
    }
  }

  // 3. ผูก Event Listener
  if (tsApplyBtn) tsApplyBtn.addEventListener("click", loadTimesheetTable);

  // โหลดข้อมูลเมื่อกด Tab "Timesheet"
  const timesheetTabBtn = document.querySelector(
    '.ts-tab-btn[data-target="ts-timesheet-content"]',
  );
  if (timesheetTabBtn) {
    timesheetTabBtn.addEventListener("click", () => {
      // โหลดเฉพาะถ้าตารางยังว่างอยู่ (หรือจะโหลดใหม่ทุกครั้งก็ได้)
      const tbody = document.getElementById("ts-table-body");
      // if(tbody && tbody.children.length <= 1) {
      loadTimesheetTable();
      // }
    });
  }

  // --- [NEW] Daily Audit Logic ---

  const auditDatePicker = document.getElementById("audit-date-picker");
  const auditTableBody = document.getElementById("audit-table-body");
  const auditFilterBtns = document.querySelectorAll(".audit-filter-btn");
  let currentAuditFilter = "all";

  // ตั้งค่าเริ่มต้นเป็นวันนี้
  if (auditDatePicker) {
    // ตั้งค่าวันที่ปัจจุบัน
    auditDatePicker.value = new Date().toISOString().split("T")[0];

    //  เมื่อมีการเปลี่ยนวันที่
    auditDatePicker.addEventListener("change", () => loadDailyAuditData(currentUser, currentUserData));

    loadDailyAuditData(currentUser, currentUserData);
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

      currentAuditFilter = btn.dataset.filter;
      loadDailyAuditData(); // โหลดข้อมูลใหม่ตามฟิลเตอร์
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

  async function handleCheckOut() {
    // 1. ตรวจสอบเบื้องต้น
    if (!currentWorkRecordId) return;

    const now = new Date();
    // now.setHours(19, 8, 0); // หลอกระบบว่าตอนนี้คือ 19:08 น.

    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    // 2. กำหนดเวลาเลิกงานปกติ (เช่น 17:30)
    const normalEndTime = { h: 17, m: 30 }; // แก้ให้เป็น 8 โมงเช้า เพื่อให้เวลาตอนนี้ (10:00) ถือว่าเป็น OT

    // คำนวณว่าตอนนี้เกินเวลาเลิกงานมาแล้วกี่นาที
    const totalMinutesNow = currentHour * 60 + currentMinute;
    const totalMinutesEnd = normalEndTime.h * 60 + normalEndTime.m;
    const otMinutes = totalMinutesNow - totalMinutesEnd;

    // 3. ถ้าเวลาปัจจุบันเกิน 17:30 น. (otMinutes > 0)
    if (otMinutes > 0) {
      const otHours = (otMinutes / 60).toFixed(1); // เช่น 0.5, 1.0

      const result = await Swal.fire({
        title: "ยืนยันการบันทึก OT",
        html: `ขณะนี้เวลา <b>${currentHour}:${currentMinute.toString().padStart(2, "0")} น.</b><br>
                   คุณทำงานเกินเวลาปกติมาแล้ว <b>${otHours} ชม.</b><br><br>
                   <span class="text-sm text-gray-500">คุณต้องการบันทึกเวลานี้เป็น OT หรือไม่?</span>`,
        icon: "question",
        showCancelButton: true,
        confirmButtonText: "ใช่, บันทึกเป็น OT",
        cancelButtonText: "ไม่, บันทึกเป็นเวลาปกติ (ไม่มี OT)",
        confirmButtonColor: "#f97316", // สีส้ม (Orange-500)
        cancelButtonColor: "#94a3b8", // สีเทา
      });

      if (result.isConfirmed) {
        // กรณีพนักงานยืนยัน OT: พาไปหน้าเขียนคำขอ OT หรือบันทึก Flag ไว้
        // 1. สั่งบันทึกข้อมูล Check-out ลง DB ทันที โดยส่งค่า true เพื่อบอกว่าเป็น OT
        await executeSaveCheckout(true, "factory_normal");

        showNotification("กรุณากรอกรายละเอียดการทำ OT ในขั้นตอนถัดไป", "info");
        // คุณอาจจะสั่งให้เปิด Tab ขอ OT ทันที
        showTab("tab-ot-request");
        // หมายเหตุ: ตรงนี้เรายังต้องทำการ Check-out ให้เสร็จก่อน
      } else {
        // กรณีพนักงานเลือก "ไม่": ระบบจะบันทึก Checkout ปกติ
        // แต่อาจจะใส่ Note ไว้ในระบบว่า "พนักงานไม่ขอรับ OT (เดินทางกลับจาก On-site)"
        console.log("User declined OT calculation.");
      }
    }

    // 4. ทำกระบวนการ Check-out ปกติ (โค้ดเดิมของคุณ)
    try {
      // ตัวอย่างเพิ่ม Note เข้าไปใน Record
      await db
        .collection("work_records")
        .doc(currentWorkRecordId)
        .update({
          checkOutTime: `${currentHour}:${currentMinute.toString().padStart(2, "0")}`,
          status: "completed",
          // otStatus: result.isConfirmed ? 'requested' : 'declined'
        });

      Swal.fire("สำเร็จ", "ลงเวลาออกงานเรียบร้อยแล้ว", "success");
      checkStatus(); // อัปเดต UI หน้าแรก
    } catch (error) {
      console.error("Check-out Error:", error);
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

  function initTheme() {
    const savedTheme = localStorage.getItem("theme");

    if (savedTheme === "dark") {
      document.documentElement.setAttribute("data-theme", "dakr");
    }
  }

  function initTheme() {
    const savedTheme = localStorage.getItem("theme");

    // นอกนั้น (ไม่เคยบันทึก หรือบันทึกเป็น light) ให้เปิด Light Mode เสมอ
    if (savedTheme === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
      if (darkModeToggle) darkModeToggle.checked = true;
      updateDarkModeStatus(true);
    } else {
      // กรณีเข้าครั้งแรก (savedTheme เป็น null) -> เข้าเงื่อนไขนี้ (Light)
      document.documentElement.setAttribute("data-theme", "light");
      if (darkModeToggle) darkModeToggle.checked = false;
      updateDarkModeStatus(false);
    }
  }

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
          ? record.checkOut.timestamp
              .toDate()
              .toLocaleTimeString("th-TH", {
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
    const generatePayrollBtn = document.getElementById("generate-payroll-summary-btn");
    if (generatePayrollBtn) {
        generatePayrollBtn.addEventListener("click", loadPayrollSummary);
    }

    const exportPayrollBtn = document.getElementById("export-payroll-summary-btn");
    if (exportPayrollBtn) {
        exportPayrollBtn.addEventListener("click", async () => {
            showNotification("กำลังเตรียมข้อมูล Excel...", "info");
            
            // เช็คว่าโหลด Library Excel มาหรือยัง ถ้ายังให้โหลดอัตโนมัติ
            if (typeof XLSX === "undefined") {
                try {
                    const script = document.createElement("script");
                    script.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
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
    
    if (payrollSearchInput) payrollSearchInput.addEventListener("input", loadPayrollSummary);
    if (payrollFilterDept) payrollFilterDept.addEventListener("change", loadPayrollSummary);

// ==========================================
    // 🌟 ผูก Event สำหรับหน้า History (ประวัติและสถิติ) - แก้ปัญหาตัวแปรซ้ำ
    // ==========================================
    
    // ผูก Event แบบไม่สร้างตัวแปร (ใช้ ?. เพื่อเช็คว่ามีปุ่มนี้อยู่บนหน้าจอไหมก่อนผูก)
    document.getElementById("history-range-select")?.addEventListener("change", loadWorkHistory);
    document.getElementById("leave-history-search-btn")?.addEventListener("click", loadLeaveHistory);
    document.getElementById("ot-history-search-btn")?.addEventListener("click", loadOtHistory);

    document.getElementById("summary-stat-user-select")?.addEventListener("change", loadTimesheetSummary);
    document.getElementById("summary-stat-year-select")?.addEventListener("change", loadTimesheetSummary);

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

    document.getElementById("cal-grid")?.addEventListener("click", showCalendarDetails);
    document.getElementById("cal-details-container")?.addEventListener("click", handleCalendarDetailClick);

    // ส่วนของ Admin เพิ่มกฎปฏิทิน
    // ==========================================
    // 🌟 ส่วนของ Admin เพิ่มกฎปฏิทิน (แก้ปัญหาปุ่มหน่วง)
    // ==========================================
    const handleAddCalendarRuleAdapter = async (type, btnElement) => {
        const dateInput = document.getElementById("admin-calendar-date-input") || document.getElementById("calendar-admin-date-input");
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
            await db.collection("system_settings").doc("calendar_rules").set({
                [type]: firebase.firestore.FieldValue.arrayUnion(dateStr)
            }, { merge: true });
            
            showNotification(`เพิ่มวันที่ ${dateStr} สำเร็จ`, "success");
            if (dateInput) dateInput.value = "";
            
            // 3. สั่งโหลด UI ใหม่
            if (typeof loadAndDisplayHolidays === 'function') await loadAndDisplayHolidays();
            if (typeof loadCalendarRules === 'function') loadCalendarRules();
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
    document.getElementById("add-holiday-btn")?.addEventListener("click", function() { handleAddCalendarRuleAdapter("holidays", this); });
    document.getElementById("add-working-saturday-btn")?.addEventListener("click", function() { handleAddCalendarRuleAdapter("workingSaturdays", this); });
    
    document.getElementById("calendar-admin-add-holiday")?.addEventListener("click", function() { handleAddCalendarRuleAdapter("holidays", this); });
    document.getElementById("calendar-admin-add-worksat")?.addEventListener("click", function() { handleAddCalendarRuleAdapter("workingSaturdays", this); });

    // Event Delegation สำหรับลบกฎ (เผื่อมี UI เก่า)
    document.getElementById("admin-calendar-controls-card")?.addEventListener("click", async (e) => {
        const deleteBtn = e.target.closest(".calendar-delete-btn");
        if (deleteBtn) {
            const date = deleteBtn.dataset.date;
            const type = deleteBtn.dataset.type;
            deleteBtn.disabled = true;
            try {
                await db.collection("system_settings").doc("calendar_rules").update({
                    [type]: firebase.firestore.FieldValue.arrayRemove(date)
                });
                showNotification(`ลบวันที่ ${date} สำเร็จ`, "success");
                if (typeof loadAndDisplayHolidays === 'function') loadAndDisplayHolidays();
                if (typeof loadCalendarRules === 'function') loadCalendarRules();
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
                const updatedData = await saveUserProfile(currentUser?.uid, newName, newDept);
                
                // 2. อัปเดตตัวแปร Global ใน app.js และรีเฟรชหน้าจอ
                currentUserData = { ...currentUserData, ...updatedData };
                if (typeof updateProfilePage === "function") updateProfilePage(currentUserData);
                
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
        showConfirmDialog(`คุณต้องการเปลี่ยนสิทธิ์ผู้ใช้เป็น ${newRole.toUpperCase()} ใช่หรือไม่?`, () => {
            updateUserRole(userId, newRole);
        }, () => {
            loadRoleManagement(); // ถ้ากดยกเลิก ให้โหลดตารางกลับเป็นค่าเดิม
        });
    };

    // ==========================================
    // 🌟 ผูก Event สำหรับส่งใบลาและรายงาน (Request Service)
    // ==========================================
    
    // 1. ผูกปุ่มบันทึก Report
    if (saveReportBtn) {
        saveReportBtn.addEventListener("click", async () => {
            if (!currentUser) return showNotification("กรุณาเข้าสู่ระบบ", "error");
            
            const selectedDateStr = reportDateInput.value;
            if (!selectedDateStr) return showNotification("กรุณาเลือกวันที่", "warning");

            const workType = workTypeSelectedText.textContent.trim();
            const project = projectSelectedText.textContent.trim();
            const durationText = durationSelectedText.textContent.trim();

            if (workType.includes("เลือก") || project.includes("เลือก") || durationText.includes("เลือก")) {
                return showNotification("กรุณากรอกข้อมูลให้ครบ", "warning");
            }

            let timeRange = durationText, hoursUsed = 8.0, saveStartTime = "08:30", saveEndTime = "17:30";

            if (durationText === "SOME TIME") {
                const startT = customTimeStartInput.value;
                const endT = customTimeEndInput.value;
                if (!startT || !endT) return showNotification("กรุณากรอกเวลาเริ่มต้นและสิ้นสุด", "warning");
                
                hoursUsed = parseFloat(((new Date(`2000-01-01T${endT}`) - new Date(`2000-01-01T${startT}`)) / 3600000).toFixed(2));
                if (hoursUsed <= 0) return showNotification("เวลาสิ้นสุดต้องมากกว่าเวลาเริ่ม", "warning");
                
                timeRange = `SOME TIME (${startT} - ${endT})`;
                saveStartTime = startT; saveEndTime = endT;
            } else if (durationText.includes("HALF DAY")) {
                if (durationText.includes("08:30")) { hoursUsed = 3.5; saveEndTime = "12:00"; timeRange = "HALF DAY (08:30 - 12:00)"; }
                else { hoursUsed = 4.5; saveStartTime = "13:00"; timeRange = "HALF DAY (13:00 - 17:30)"; }
            } else {
                timeRange = "ALL (08:30 - 17:30)";
            }

            saveReportBtn.disabled = true;
            saveReportBtn.textContent = "กำลังบันทึก...";

            const reportData = { workType, project, duration: timeRange, hours: hoursUsed, startTime: saveStartTime, endTime: saveEndTime };
            
            const success = await submitDailyReport(currentUser.uid, selectedDateStr, reportData);
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
            if (!currentUser || !currentUserData) return showNotification("กรุณาเข้าสู่ระบบก่อนยื่นใบลา", "error");

            const leaveType = leaveTypeSelect.value;
            const startDateStr = leaveStartDate.value;
            const reason = leaveReason.value.trim();
            const durationType = leaveDurationType.value;
            const endDateStr = leaveEndDate.value;
            
            if (!leaveType || !startDateStr || !reason) return showNotification("กรุณากรอกข้อมูลให้ครบถ้วน", "warning");

            let startDate = new Date(startDateStr);
            let endDate = durationType === "hourly" ? new Date(startDateStr) : new Date(endDateStr);

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
                leaveType, reason, durationType,
                startDate: firebase.firestore.Timestamp.fromDate(startDate),
                endDate: firebase.firestore.Timestamp.fromDate(endDate),
            };

            if (durationType === "hourly") {
                if (!leaveStartTime.value || !leaveEndTime.value) {
                    submitLeaveBtn.disabled = false; submitLeaveBtn.textContent = "ส่งใบลา";
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
    document.querySelectorAll(".nav-item").forEach(item => {
        item.addEventListener("click", (e) => {
             const pageId = item.dataset.page;
             if (pageId === "admin-approvals-page" && currentUserData && currentUserData.role === "admin") {
                 if (typeof loadAllUsersForDropdown === "function") loadAllUsersForDropdown();
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

});
