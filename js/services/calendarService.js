// ไฟล์: public/js/services/calendarService.js
import { db, auth } from '../config/firebase-config.js';
import { showNotification, showConfirmDialog } from '../utils/uiHelper.js';

// --- ตัวแปร State สำหรับปฏิทิน ---
export let currentDisplayDate = new Date();
let calendarDataCache = {
    plans: new Map(),
    records: new Map(),
    users: new Map()
};

// 1. โหลดข้อมูลปฏิทินรายเดือน (วันหยุด, เสาร์ทำงาน, แผนงาน)
export async function loadCalendarData(date) {
    const user = auth.currentUser;
    if (!user) return;

    const calGrid = document.getElementById("cal-grid");
    const calHeader = document.getElementById("cal-month-year");
    const calDetailsContainer = document.getElementById("cal-details-container");

    if (!calGrid || !calHeader || !calDetailsContainer) return;

    calHeader.textContent = date.toLocaleString("th-TH", { month: "long", year: "numeric" });
    calGrid.innerHTML = '<div class="col-span-7 text-center p-4 text-gray-400">กำลังโหลด...</div>';
    calDetailsContainer.innerHTML = '<p class="text-center text-gray-400 text-sm">คลิกวันที่เพื่อดูรายละเอียด</p>';

    const year = date.getFullYear();
    const month = date.getMonth();
    const today = new Date();

    calendarDataCache.plans.clear();
    calendarDataCache.records.clear();
    calendarDataCache.users.clear();

    const startDate = new Date(year, month, 1);
    const endDate = new Date(year, month + 1, 0);
    const firstDayOfWeek = startDate.getDay();
    const daysInMonth = endDate.getDate();

    try {
        const [recordsSnapshot, calendarDoc, plansSnapshot, usersSnapshot] = await Promise.all([
            db.collection("work_records").where("userId", "==", user.uid).where("date", ">=", startDate).where("date", "<=", endDate).get(),
            db.collection("system_settings").doc("calendar_rules").get(),
            db.collection("user_plans").where("date", ">=", startDate).where("date", "<=", endDate).get(),
            db.collection("users").get()
        ]);

        usersSnapshot.forEach(doc => calendarDataCache.users.set(doc.id, doc.data()));
        recordsSnapshot.forEach(doc => calendarDataCache.records.set(doc.data().date.toDate().getDate(), doc.data()));

        const holidayMap = new Map();
        const workingSaturdayMap = new Map();
        if (calendarDoc.exists) {
            (calendarDoc.data().holidays || []).forEach(d => holidayMap.set(d, true));
            (calendarDoc.data().workingSaturdays || []).forEach(d => workingSaturdayMap.set(d, true));
        }

        plansSnapshot.forEach(doc => {
            const data = doc.data();
            const day = data.date.toDate().getDate();
            if (!calendarDataCache.plans.has(day)) calendarDataCache.plans.set(day, []);
            calendarDataCache.plans.get(day).push({ id: doc.id, ...data });
        });

        calGrid.innerHTML = "";
        for (let i = 0; i < firstDayOfWeek; i++) {
            calGrid.innerHTML += `<div class="p-2"></div>`;
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
            const plans = calendarDataCache.plans.get(day) || [];
            const dateKey = `${year}-${(month + 1).toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;

            const isHoliday = holidayMap.has(dateKey);
            const isWorkingSaturday = workingSaturdayMap.has(dateKey);
            const currentDayOfWeek = new Date(year, month, day).getDay();
            const isSunday = currentDayOfWeek === 0;
            const isRegularSaturday = currentDayOfWeek === 6;

            let planDotHtml = plans.length > 0 ? `<div class="w-2 h-2 bg-indigo-500 rounded-full mx-auto mt-0.5"></div>` : "";
            let dayNumberHtml = `<div class="w-7 h-7 flex items-center justify-center rounded-full mx-auto ${isToday ? 'bg-sky-100 text-sky-700 font-bold' : isHoliday ? 'text-red-500 font-bold' : isWorkingSaturday ? 'text-green-700 font-bold' : (isSunday || isRegularSaturday) ? 'text-red-400' : 'text-gray-400'}">${day}</div>`;

            let cellBaseClass = "p-2 text-center rounded-lg cursor-pointer hover:bg-gray-100";
            const dataAttr = `data-day-number="${day}" data-date-key="${dateKey}"`;

            if (isHoliday) {
                calGrid.innerHTML += `<div class="${cellBaseClass}" ${dataAttr}>${dayNumberHtml}${planDotHtml}<div class="text-xs mt-1 text-red-500 truncate" style="line-height: 1.25;">หยุด</div></div>`;
            } else if (isWorkingSaturday) {
                calGrid.innerHTML += `<div class="${cellBaseClass}" ${dataAttr}>${dayNumberHtml}${planDotHtml}<div class="text-xs mt-1 text-green-700 truncate" style="line-height: 1.25;">ทำงาน</div></div>`;
            } else {
                calGrid.innerHTML += `<div class="${cellBaseClass}" ${dataAttr}>${dayNumberHtml}${planDotHtml}</div>`;
            }
        }
    } catch (error) {
        console.error("Error fetching calendar data: ", error);
        calGrid.innerHTML = `<div class="col-span-7 text-center p-4 text-red-500">โหลดข้อมูลล้มเหลว</div>`;
    }
}

// 2. แสดงรายละเอียดแผนงานเมื่อคลิกวันที่
export function showCalendarDetails(e) {
    const cell = e.target.closest("[data-day-number]");
    if (!cell) return;

    const day = parseInt(cell.dataset.dayNumber);
    const dateKey = cell.dataset.dateKey; 
    const [y, m, d] = dateKey.split("-");
    const thaiDate = new Date(y, m - 1, d).toLocaleDateString("th-TH", { day: "numeric", month: "long" });

    const plans = calendarDataCache.plans.get(day) || [];
    const users = calendarDataCache.users;
    const container = document.getElementById("cal-details-container");
    const user = auth.currentUser;

    let detailHtml = `<h4 class="font-semibold text-lg">แผนงาน วันที่ ${thaiDate}</h4>`;

    if (plans.length > 0) {
        detailHtml += '<div class="space-y-3 pt-3">';
        plans.forEach((plan) => {
            const userName = users.get(plan.userId)?.fullName || "ไม่พบชื่อ";
            const userPhoto = users.get(plan.userId)?.profileImageUrl || "https://placehold.co/100x100/E2E8F0/475569?text=User";

            detailHtml += `
                <div class="flex items-start space-x-3">
                    <img src="${userPhoto}" class="w-10 h-10 rounded-full object-cover flex-shrink-0">
                    <div class="flex-1">
                        <div class="flex justify-between items-center">
                            <p class="font-semibold text-sm">${userName}</p>
                            ${plan.userId === user?.uid ? `<button class="plan-delete-btn text-red-400 hover:text-red-600" data-doc-id="${plan.id}"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V8z" clip-rule="evenodd"></path></svg></button>` : ""}
                        </div>
                        <p class="text-sm text-gray-700 whitespace-pre-wrap">${plan.planText}</p>
                    </div>
                </div>`;
        });
        detailHtml += "</div>";
    } else {
        detailHtml += '<p class="text-center text-gray-400 text-sm py-2">ยังไม่มีแผนงานสำหรับวันนี้</p>';
    }

    detailHtml += `
        <div class="pt-3 mt-3 border-t border-gray-100">
            <button id="plan-show-form-btn" class="w-full text-sm font-medium text-sky-600 p-2 rounded-lg hover:bg-sky-50">+ เพิ่มแผนของฉันในวันนี้</button>
            <div id="plan-new-form" class="hidden space-y-2 mt-2">
                <textarea id="plan-new-textarea" class="w-full p-2 border border-gray-300 rounded-lg" rows="2" placeholder="กรอกแผนงานของคุณ..."></textarea>
                <button id="plan-save-new-btn" data-date-key="${dateKey}" class="btn-primary w-full py-2 text-sm">บันทึกแผนของฉัน</button>
            </div>
        </div>`;
    container.innerHTML = detailHtml;
}

// 3. จัดการการคลิกในรายละเอียดแผนงาน (เพิ่ม/ลบ)
export async function handleCalendarDetailClick(e) {
    const user = auth.currentUser;
    if (e.target.id === "plan-show-form-btn") {
        document.getElementById("plan-new-form").classList.remove("hidden");
        e.target.classList.add("hidden");
        return;
    }

    if (e.target.id === "plan-save-new-btn") {
        const saveBtn = e.target;
        const dateKey = saveBtn.dataset.dateKey;
        const planText = document.getElementById("plan-new-textarea").value.trim();

        if (!planText) return alert("กรุณากรอกแผนงาน");
        saveBtn.disabled = true;
        saveBtn.textContent = "กำลังบันทึก...";

        try {
            await db.collection("user_plans").add({
                userId: user.uid,
                date: firebase.firestore.Timestamp.fromDate(new Date(dateKey)),
                planText: planText,
                lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
            });
            showNotification("บันทึกแผนสำเร็จ!");
            loadCalendarData(currentDisplayDate);
        } catch (error) {
            showNotification("เกิดข้อผิดพลาด", "error");
            saveBtn.disabled = false;
            saveBtn.textContent = "บันทึกแผนของฉัน";
        }
    }

    if (e.target.closest(".plan-delete-btn")) {
        const docId = e.target.closest(".plan-delete-btn").dataset.docId;
        showConfirmDialog("ลบแผนงานนี้ใช่หรือไม่?", async () => {
            try {
                await db.collection("user_plans").doc(docId).delete();
                showNotification("ลบแผนงานแล้ว", "success");
                loadCalendarData(currentDisplayDate);
            } catch (error) {
                showNotification("ลบไม่สำเร็จ", "error");
            }
        });
    }
}

// 4. โหลดกฎปฏิทินบริษัท (วันหยุด, เสาร์ทำงาน) สำหรับหน้า Admin
export async function loadCalendarRules() {
    const holidayList = document.getElementById("holiday-list");
    const workSatList = document.getElementById("working-saturday-list");
    if (!holidayList || !workSatList) return;

    holidayList.innerHTML = '<p class="text-sm text-gray-400">กำลังโหลด...</p>';
    workSatList.innerHTML = '<p class="text-sm text-gray-400">กำลังโหลด...</p>';

    try {
        const doc = await db.collection("system_settings").doc("calendar_rules").get();
        if (!doc.exists) {
            holidayList.innerHTML = '<p class="text-sm text-gray-400">ไม่พบข้อมูล</p>';
            workSatList.innerHTML = '<p class="text-sm text-gray-400">ไม่พบข้อมูล</p>';
            return;
        }

        const data = doc.data();
        const holidays = data.holidays || [];
        const workingSaturdays = data.workingSaturdays || [];

        const createListHTML = (dateArray, type) => {
            if (dateArray.length === 0) return '<p class="text-sm text-gray-400">ไม่มีรายการ</p>';
            dateArray.sort((a, b) => new Date(a) - new Date(b));
            return dateArray.map(dateStr => `
                <div class="flex justify-between items-center bg-white p-2 rounded-md shadow-sm">
                    <span class="text-sm font-medium">${dateStr}</span>
                    <button data-date="${dateStr}" data-type="${type}" class="calendar-delete-btn text-red-400 hover:text-red-600 p-1">
                        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V8z" clip-rule="evenodd"></path></svg>
                    </button>
                </div>
            `).join("");
        };

        holidayList.innerHTML = createListHTML(holidays, "holidays");
        workSatList.innerHTML = createListHTML(workingSaturdays, "workingSaturdays");
    } catch (error) {
        console.error("Error loading rules:", error);
    }
}

// 5. โหลดและแสดงวันหยุดในกล่องจัดการปฏิทิน
export async function loadAndDisplayHolidays() {
    const holidayContainer = document.getElementById("holiday-list-display");
    const worksatContainer = document.getElementById("worksat-list-display");
    
    // ถ้าหน้าเว็บไม่มีกล่องนี้เลย ค่อยหยุดทำงาน
    if (!holidayContainer && !worksatContainer) return; 

    try {
        const doc = await db.collection("system_settings").doc("calendar_rules").get();
        let holidays = [], workingSaturdays = [];
        if (doc.exists) {
            holidays = doc.data().holidays || [];
            workingSaturdays = doc.data().workingSaturdays || [];
        }

        const createItemHTML = (dateStr, type) => `
            <div class="flex justify-between items-center p-2 rounded-lg ${type === 'holidays' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'} text-sm font-medium mb-1">
                <span>${dateStr}</span>
                <button class="calendar-delete-item-btn p-0.5 hover:bg-black/10 rounded" data-date="${dateStr}" data-type="${type}">
                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V8z" clip-rule="evenodd"></path></svg>
                </button>
            </div>
        `;

        if (holidayContainer) {
            holidayContainer.innerHTML = holidays.length ? holidays.sort().map(d => createItemHTML(d, "holidays")).join("") : '<p class="text-xs text-center text-gray-400">ยังไม่มีข้อมูล</p>';
        }
        if (worksatContainer) {
            worksatContainer.innerHTML = workingSaturdays.length ? workingSaturdays.sort().map(d => createItemHTML(d, "workingSaturdays")).join("") : '<p class="text-xs text-center text-gray-400">ยังไม่มีข้อมูล</p>';
        }
    } catch (error) {
        console.error("Error display holidays:", error);
    }
}

// 6. ผูก Event Listener สำหรับแอดมินลบ/เพิ่มวันหยุด
export function setupAdminCalendarControls() {
    const listWrapper = document.getElementById("holiday-list-wrapper");
    const toggleBtn = document.getElementById("toggle-holiday-list-btn");

    if (listWrapper) {
        // จัดการปุ่มลบ
        listWrapper.addEventListener("click", (e) => {
            const deleteBtn = e.target.closest(".calendar-delete-item-btn");
            if (deleteBtn) {
                const date = deleteBtn.dataset.date;
                const type = deleteBtn.dataset.type;
                showConfirmDialog(`ลบ ${type === "holidays" ? "วันหยุด" : "เสาร์ทำงาน"}: ${date}?`, async () => {
                    try {
                        await db.collection("system_settings").doc("calendar_rules").update({
                            [type]: firebase.firestore.FieldValue.arrayRemove(date)
                        });
                        showNotification(`ลบ ${date} สำเร็จ!`, "success");
                        loadAndDisplayHolidays();
                        loadCalendarData(currentDisplayDate);
                    } catch (error) {
                        showNotification("เกิดข้อผิดพลาดในการลบ", "error");
                    }
                });
            }
        });
    }

    if (toggleBtn && listWrapper) {
        // คืน Event เดิมให้ปุ่มกด ซ่อน/แสดง
        toggleBtn.addEventListener("click", () => {
            if (listWrapper.classList.contains("hidden")) {
                loadAndDisplayHolidays(); // สั่งดึงข้อมูลทุกครั้งที่เปิด
                listWrapper.classList.remove("hidden");
                toggleBtn.textContent = "ซ่อนรายการที่บันทึกไว้";
            } else {
                listWrapper.classList.add("hidden");
                toggleBtn.textContent = "แสดงรายการที่บันทึกไว้";
            }
        });
    }
}