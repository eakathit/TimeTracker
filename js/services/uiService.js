// ไฟล์: public/js/services/uiService.js
import { db } from '../config/firebase-config.js';
import { showNotification, showConfirmDialog } from '../utils/uiHelper.js';

let controlsInitialized = false;

// ==========================================
// 1. ระบบ Theme (โหมดมืด / สว่าง)
// ==========================================
export function initTheme() {
    const darkModeToggle = document.getElementById("dark-mode-toggle");
    const savedTheme = localStorage.getItem("theme");

    if (savedTheme === "dark" || (!savedTheme && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
        document.documentElement.setAttribute("data-theme", "dark");
        if (darkModeToggle) darkModeToggle.checked = true;
        updateDarkModeStatus(true);
    } else {
        document.documentElement.setAttribute("data-theme", "light");
        if (darkModeToggle) darkModeToggle.checked = false;
        updateDarkModeStatus(false);
    }
}

export function setupThemeToggle() {
    const darkModeToggle = document.getElementById("dark-mode-toggle");
    if (darkModeToggle) {
        darkModeToggle.addEventListener("change", (e) => {
            const isDark = e.target.checked;
            document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
            localStorage.setItem("theme", isDark ? "dark" : "light");
            updateDarkModeStatus(isDark);
        });
    }
}

function updateDarkModeStatus(isDark) {
    const darkModeStatus = document.getElementById("dark-mode-status");
    if (!darkModeStatus) return;
    if (isDark) {
        darkModeStatus.textContent = "เปิดใช้งาน";
        darkModeStatus.classList.add("text-green-500");
    } else {
        darkModeStatus.textContent = "ปิดใช้งาน";
        darkModeStatus.classList.remove("text-green-500");
    }
}

// ==========================================
// 2. ระบบ Dropdown และการดึงข้อมูลตั้งค่า
// ==========================================
export async function populateDropdownOptions() {
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
            const doc = await db.collection("system_settings").doc(config.docId).get();
            if (!doc.exists) continue;

            const items = doc.data().names || [];
            const optionsContainer = document.getElementById(config.optionsId);
            if (!optionsContainer) continue;
            
            const panel = optionsContainer.closest(".absolute");
            const selectedText = panel.previousElementSibling.querySelector("span");

            optionsContainer.innerHTML = "";

            items.forEach((name) => {
                const optionDiv = document.createElement("div");
                optionDiv.className = "p-2 rounded-lg hover:bg-sky-50 cursor-pointer text-sm";
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
}

// ==========================================
// 3. ระบบ Controls หน้า Admin Settings
// ==========================================
export function initializeControls() {
    if (controlsInitialized) return;

    const dropdownConfigs = [
        { panelId: "work-type-panel", selectBtnId: "work-type-btn", searchId: "work-type-search" },
        { panelId: "project-panel", selectBtnId: "project-btn", searchId: "project-search" },
        { panelId: "delete-work-type-panel", selectBtnId: "delete-work-type-select-btn" },
        { panelId: "delete-project-panel", selectBtnId: "delete-project-select-btn" },
        { panelId: "duration-panel", selectBtnId: "duration-btn" },
        { panelId: "edit-modal-work-type-panel", selectBtnId: "edit-modal-work-type-btn", searchId: "edit-modal-work-type-search" },
        { panelId: "edit-modal-project-panel", selectBtnId: "edit-modal-project-btn", searchId: "edit-modal-project-search" },
        { panelId: "edit-modal-duration-panel", selectBtnId: "edit-modal-duration-btn" },
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
            if (isCurrentlyHidden) panel.classList.remove("hidden");
            else panel.classList.add("hidden");
        });

        panel.addEventListener("click", (e) => e.stopPropagation());

        if (config.searchId) {
            const searchInput = document.getElementById(config.searchId);
            const optionsContainer = panel.querySelector(".overflow-y-auto");
            if (searchInput && optionsContainer) {
                searchInput.addEventListener("input", () => {
                    const filter = searchInput.value.toLowerCase();
                    for (const option of optionsContainer.children) {
                        option.style.display = option.textContent.toLowerCase().includes(filter) ? "" : "none";
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

    // --- Admin Add/Delete Logic ---
    const setupAdminAction = (btnId, valueSourceId, docId, action) => {
        const actionButton = document.getElementById(btnId);
        if (!actionButton) return;

        actionButton.addEventListener("click", async () => {
            const isDelete = action === "delete";
            const valueElement = document.getElementById(valueSourceId);
            if (!valueElement) return;

            const value = isDelete ? valueElement.textContent.trim() : valueElement.value.trim();

            if ((isDelete && value.includes("...")) || (!isDelete && !value)) {
                showNotification(isDelete ? "กรุณาเลือกรายการที่จะลบ" : "กรุณากรอกข้อมูล", "warning");
                return;
            }

            if (isDelete) {
                showConfirmDialog(`คุณแน่ใจหรือไม่ว่าจะลบ "${value}"?`, async () => {
                    try {
                        actionButton.disabled = true; actionButton.classList.add("opacity-50");
                        const docRef = db.collection("system_settings").doc(docId);
                        await docRef.update({ names: firebase.firestore.FieldValue.arrayRemove(value) });
                        showNotification(`ลบ "${value}" สำเร็จ!`, "success");
                        await populateDropdownOptions();
                        valueElement.textContent = `เลือก${docId === "workTypes" ? "ประเภทงาน" : "โครงการ"}ที่จะลบ...`;
                        valueElement.classList.add("text-gray-500");
                    } catch (error) {
                        console.error(`Error deleting ${docId}:`, error);
                        showNotification("เกิดข้อผิดพลาดในการลบ", "error");
                    } finally {
                        actionButton.disabled = false; actionButton.classList.remove("opacity-50");
                    }
                });
            } else {
                try {
                    actionButton.disabled = true; actionButton.classList.add("opacity-50");
                    const docRef = db.collection("system_settings").doc(docId);
                    await docRef.set({ names: firebase.firestore.FieldValue.arrayUnion(value) }, { merge: true });
                    showNotification(`เพิ่ม "${value}" สำเร็จ!`, "success");
                    await populateDropdownOptions();
                    valueElement.value = "";
                } catch (error) {
                    console.error(`Error adding ${docId}:`, error);
                    showNotification("เกิดข้อผิดพลาดในการเพิ่ม", "error");
                } finally {
                    actionButton.disabled = false; actionButton.classList.remove("opacity-50");
                }
            }
        });
    };

    setupAdminAction("add-work-type-btn", "add-work-type-input", "workTypes", "add");
    setupAdminAction("delete-work-type-btn", "delete-work-type-selected-text", "workTypes", "delete");
    setupAdminAction("add-project-btn", "add-project-input", "projects", "add");
    setupAdminAction("delete-project-btn", "delete-project-selected-text", "projects", "delete");

    // --- จัดการปุ่มเลือกระยะเวลาเวลา ---
    const durationOptions = document.getElementById("duration-options");
    if (durationOptions) {
        durationOptions.addEventListener("click", (e) => {
            const option = e.target.closest(".duration-option");
            if (option) {
                const selectedValue = option.textContent.trim();
                const durationSelectedText = document.getElementById("duration-selected-text");
                const customTimeInputs = document.getElementById("custom-time-inputs");
                
                if(durationSelectedText) {
                    durationSelectedText.textContent = selectedValue;
                    durationSelectedText.classList.remove("text-gray-500");
                }
                document.getElementById("duration-panel")?.classList.add("hidden");
                
                if (customTimeInputs) {
                    if (selectedValue === "SOME TIME") customTimeInputs.classList.remove("hidden");
                    else customTimeInputs.classList.add("hidden");
                }
            }
        });
    }

    controlsInitialized = true;
}

// ==========================================
// 4. ระบบเลือกสถานที่ Check-in (หน้าแรก)
// ==========================================
export function setupWorkTypeSelection() {
    const workTypeButtons = document.querySelectorAll(".work-type-btn");
    const onsiteDetailsForm = document.getElementById("onsite-details-form");
    
    workTypeButtons.forEach((button) => {
        button.addEventListener("click", () => {
            workTypeButtons.forEach((btn) => {
                btn.classList.remove("bg-sky-500", "text-white", "shadow");
                btn.classList.add("text-gray-600");
            });
            button.classList.add("bg-sky-500", "text-white", "shadow");
            if (onsiteDetailsForm) {
                onsiteDetailsForm.classList.toggle("hidden", button.dataset.workType !== "on_site");
            }
            window.selectedWorkType = button.dataset.workType;
        });
    });
}

// 5. ระบบ Settings Tabs (Modern Pill UI & Animation)
// ==========================================
export function setupSettingsTabs() {
    const tabBtns = document.querySelectorAll(".settings-tab-btn");
    const tabContents = document.querySelectorAll(".settings-tab-content");

    if (tabBtns.length === 0) return;

    tabBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
            // 1. ล้างสถานะปุ่มทั้งหมด (เปลี่ยนกลับเป็นสีเทา)
            tabBtns.forEach((b) => {
                b.classList.remove("bg-sky-50", "text-sky-600", "font-semibold", "shadow-sm", "border-sky-100");
                b.classList.add("text-gray-500", "font-medium", "hover:bg-gray-100", "hover:text-gray-700", "border-transparent");
            });

            // 2. ซ่อนและลบ Animation ออกจากเนื้อหาทั้งหมด
            tabContents.forEach((c) => {
                c.classList.add("hidden");
                c.classList.remove("animate-tab"); // เคลียร์คลาส Animation ออกก่อน
            });

            // 3. ไฮไลท์ปุ่มที่ถูกคลิก (เปลี่ยนเป็นสีฟ้าทรงแคปซูล)
            btn.classList.remove("text-gray-500", "font-medium", "hover:bg-gray-100", "hover:text-gray-700", "border-transparent");
            btn.classList.add("bg-sky-50", "text-sky-600", "font-semibold", "shadow-sm", "border-sky-100");

            // 4. แสดงเนื้อหาเป้าหมาย พร้อมทริกเกอร์ Animation ใหม่
            const targetId = btn.dataset.target;
            const targetContent = document.getElementById(targetId);
            if (targetContent) {
                targetContent.classList.remove("hidden");
                
                // เทคนิค: บังคับให้เบราว์เซอร์รีเฟรช 1 รอบ (Reflow) เพื่อให้ Animation เล่นซ้ำทุกครั้งที่กด
                void targetContent.offsetWidth; 
                
                targetContent.classList.add("animate-tab"); // เติมคลาส Animation เล่นแสง
            }
        });
    });
}