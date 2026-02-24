// ไฟล์: public/js/services/authService.js
import { auth, db } from '../config/firebase-config.js';
import { showNotification, showConfirmDialog } from '../utils/uiHelper.js';

// 1. ฟังก์ชันจัดการ Login (Google)
export function handleGoogleLogin() {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });

    const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    if (isLocalhost) {
        console.log("🛠️ Emulator Mode: Forcing Popup Login");
        auth.signInWithPopup(provider).catch(err => console.error("Emulator Popup Error:", err));
        return;
    }

    if (isMobile) {
        auth.signInWithRedirect(provider).catch(err => {
            console.error("Redirect Login Error:", err);
            alert("เกิดข้อผิดพลาดในการเริ่ม Login: " + err.message);
        });
    } else {
        auth.signInWithPopup(provider).catch(err => {
            if (err.code === "auth/popup-blocked") {
                alert("Pop-up ถูกบล็อก! กรุณาอนุญาต Pop-up สำหรับเว็บนี้");
            } else if (err.code !== "auth/cancelled-popup-request") {
                console.error("Popup Login Error:", err);
            }
        });
    }
}

// 2. ฟังก์ชันจัดการ Logout
export function handleLogout() {
    showConfirmDialog("คุณต้องการออกจากระบบใช่หรือไม่?", () => {
        auth.signOut().catch(error => {
            console.error("Sign out error:", error);
            showNotification("เกิดข้อผิดพลาดในการออกจากระบบ", "error");
        });
    });
}

// 3. ฟังก์ชันบันทึกข้อมูล Profile ลง Firestore
export async function saveUserProfile(userUid, newName, newDept) {
    if (!userUid) throw new Error("ไม่พบข้อมูลผู้ใช้");
    if (!newName || !newDept) throw new Error("กรุณากรอกชื่อและแผนกให้ครบถ้วน");

    const updatedData = {
        fullName: newName,
        department: newDept,
    };

    await db.collection("users").doc(userUid).update(updatedData);
    return updatedData;
}

// 4. ฟังก์ชันโหลดรายชื่อพนักงานเพื่อจัดการสิทธิ์ (Admin Settings)
export async function loadRoleManagement() {
    const listContainer = document.getElementById("role-management-list");
    if (!listContainer) return;

    listContainer.innerHTML = '<tr><td colspan="3" class="text-center py-8 text-gray-400 text-sm"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-500 mx-auto mb-2"></div>กำลังโหลดข้อมูล...</td></tr>';

    try {
        const usersSnapshot = await db.collection("users").orderBy("fullName").get();
        let html = "";

        usersSnapshot.forEach((doc) => {
            const user = doc.data();
            const userId = doc.id;
            const currentRole = user.role || "user";
            
            // ป้องกัน Error หากชื่อมีเครื่องหมายคำพูด
            const safeName = (user.fullName || "").replace(/'/g, "\\'").replace(/"/g, "&quot;");
            const safeDept = (user.department || "").replace(/'/g, "\\'").replace(/"/g, "&quot;");

            html += `
            <tr class="hover:bg-gray-50/50 transition-colors border-b border-gray-100 group">
                <td class="px-4 py-3">
                    <div class="flex items-center gap-3">
                        <img src="${user.profileImageUrl || "https://placehold.co/100x100/E2E8F0/475569?text=User"}" 
                             class="w-10 h-10 rounded-full object-cover border border-gray-100 shadow-sm">
                        <div class="min-w-0">
                            <p class="text-sm font-bold text-gray-800 truncate">${user.fullName || "Unknown"}</p>
                            <p class="text-[10px] text-gray-400 truncate">${user.department || "Unassigned"}</p>
                        </div>
                    </div>
                </td>
                <td class="px-2 py-3 text-center">
                    <span class="inline-flex items-center justify-center rounded-lg text-[10px] font-bold uppercase tracking-wide ${currentRole === "admin" ? "bg-indigo-50 text-indigo-600 border border-indigo-100" : "bg-gray-50 text-gray-500 border border-gray-200"}" 
                          style="padding: 4px 10px;">
                        ${currentRole}
                    </span>
                </td>
                <td class="px-4 py-3 text-right">
                    <button onclick="window.openAdminUserEditModal('${userId}', '${safeName}', '${safeDept}', '${currentRole}')"
                        class="inline-flex items-center gap-1.5 px-3 py-2 bg-white text-gray-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl text-xs font-bold transition-all shadow-sm border border-gray-200 hover:border-indigo-200 active:scale-95">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.536L16.732 3.732z"></path></svg>
                        แก้ไข
                    </button>
                </td>
            </tr>
            `;
        });
        
        listContainer.innerHTML = html || '<tr><td colspan="3" class="text-center py-4 text-gray-500">ไม่พบผู้ใช้งาน</td></tr>';

    } catch (error) {
        console.error("Error loading roles:", error);
        listContainer.innerHTML = '<tr><td colspan="3" class="text-center py-4 text-red-500 text-sm">โหลดข้อมูลไม่สำเร็จ</td></tr>';
    }
}

// 5. [ใหม่] ฟังก์ชันบันทึกการแก้ไขข้อมูลผู้ใช้งานโดย Admin
export async function saveAdminUserEdit(userId, newName, newDept, newRole) {
    try {
        await db.collection("users").doc(userId).update({ 
            fullName: newName,
            department: newDept,
            role: newRole 
        });
        showNotification(`อัปเดตข้อมูล ${newName} สำเร็จ`, "success");
        loadRoleManagement(); // โหลดตารางใหม่
        return true;
    } catch (error) {
        console.error("Error updating user:", error);
        showNotification("ไม่สามารถอัปเดตข้อมูลได้: " + error.message, "error");
        return false;
    }
}

// 5. ฟังก์ชันอัปเดต Role 
export async function updateUserRole(userId, newRole) {
    try {
        await db.collection("users").doc(userId).update({ role: newRole });
        showNotification(`อัปเดตสิทธิ์เป็น ${newRole.toUpperCase()} เรียบร้อยแล้ว`, "success");
        loadRoleManagement(); // โหลดตารางใหม่
    } catch (error) {
        console.error("Error updating role:", error);
        showNotification("ไม่สามารถอัปเดตสิทธิ์ได้: " + error.message, "error");
    }
}