export function showNotification(message, type = "success") {
  const notificationElement = document.getElementById("notification");
  // [แก้ไข] เลือก p และ span ด้วย ID ใหม่
  const msgElement = document.getElementById("notification-message");
  const iconElement = document.getElementById("notification-icon");

  if (!notificationElement || !msgElement || !iconElement) return;

  msgElement.textContent = message;

  // [ใหม่] สร้างชุดไอคอนสำหรับสถานะต่างๆ
  const icons = {
    success: `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" /></svg>`,
    error: `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" /></svg>`,
    warning: `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.257 3.099c.636-1.1 2.15-1.1 2.786 0l5.625 9.742c.636 1.1-.178 2.46-1.393 2.46H3.725c-1.215 0-2.029-1.36-1.393-2.46l5.625-9.742zM9 11a1 1 0 112 0v1a1 1 0 11-2 0v-1zm1-4a1 1 0 011 1v2a1 1 0 11-2 0V8a1 1 0 011-1z" clip-rule="evenodd" /></svg>`,
  };

  // Reset classes
  notificationElement.classList.remove(
    "bg-green-500",
    "bg-red-500",
    "bg-yellow-500",
    "bg-gray-500",
  );
  // [แก้ไข] เปลี่ยนจาก -translate-y-10 เป็น translate-y-10 (เลื่อนจากล่าง)
  notificationElement.classList.remove("opacity-0", "translate-y-10");

  // Add showing classes (เลื่อนขึ้นมาที่ 0)
  notificationElement.classList.add("opacity-100", "translate-y-0");

  // Set color and icon based on type
  if (type === "success") {
    notificationElement.classList.add("bg-green-500");
    iconElement.innerHTML = icons.success;
  } else if (type === "error") {
    notificationElement.classList.add("bg-red-500");
    iconElement.innerHTML = icons.error;
  } else if (type === "warning") {
    notificationElement.classList.add("bg-yellow-500"); // [แก้ไข] ใช้สีเหลืองสำหรับ warning
    iconElement.innerHTML = icons.warning;
  } else {
    notificationElement.classList.add("bg-gray-500");
    iconElement.innerHTML = ""; // ไม่มีไอคอน
  }

  // Hide after a delay
  setTimeout(() => {
    notificationElement.classList.remove("opacity-100", "translate-y-0");
    // [แก้ไข] ให้เลื่อนกลับลงไปด้านล่าง
    notificationElement.classList.add("opacity-0", "translate-y-10");
  }, 3000); // Hide after 3 seconds
}

export function showConfirmDialog(
  message,
  onConfirm,
  onCancel = null,
  okText = "ตกลง",
  cancelText = "ยกเลิก",
) {
  const confirmModal = document.getElementById("confirm-modal");
  const overlay = document.getElementById("confirm-overlay");
  const msgElement = document.getElementById("confirm-message");
  const okBtn = document.getElementById("confirm-ok-btn");
  const cancelBtn = document.getElementById("confirm-cancel-btn");

  if (!confirmModal || !msgElement || !okBtn || !cancelBtn || !overlay) return;

  msgElement.textContent = message;

  // [เพิ่มใหม่] เปลี่ยนข้อความปุ่ม
  okBtn.textContent = okText;
  cancelBtn.textContent = cancelText;

  // ... (ส่วน Event Listener เหมือนเดิม ไม่ต้องแก้) ...
  const handleConfirm = () => {
    closeDialog();
    if (typeof onConfirm === "function") onConfirm();
  };

  const handleCancel = () => {
    closeDialog();
    if (typeof onCancel === "function") onCancel();
  };

  const closeDialog = () => {
    confirmModal.classList.add("hidden");
    okBtn.removeEventListener("click", handleConfirm);
    cancelBtn.removeEventListener("click", handleCancel);
    overlay.removeEventListener("click", handleCancel);

    // [เพิ่มใหม่] คืนค่าข้อความปุ่มเป็นค่าเริ่มต้น (เผื่อใช้ที่อื่น)
    setTimeout(() => {
      okBtn.textContent = "ตกลง";
      cancelBtn.textContent = "ยกเลิก";
    }, 300);
  };

  okBtn.addEventListener("click", handleConfirm);
  cancelBtn.addEventListener("click", handleCancel);
  overlay.addEventListener("click", handleCancel);

  confirmModal.classList.remove("hidden");
}

