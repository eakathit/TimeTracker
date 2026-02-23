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

    listContainer.innerHTML = '<tr><td colspan="3" class="text-center py-4 text-gray-400 text-sm">กำลังโหลดข้อมูล...</td></tr>';

    try {
        const usersSnapshot = await db.collection("users").orderBy("fullName").get();
        let html = "";

        usersSnapshot.forEach((doc) => {
            const user = doc.data();
            const userId = doc.id;
            const currentRole = user.role || "user";

            html += `
            <tr class="hover:bg-gray-50/50 transition-colors border-b border-gray-100">
                <td class="px-4 py-3">
                    <div class="flex items-center gap-3">
                        <img src="${user.profileImageUrl || "https://placehold.co/100x100/E2E8F0/475569?text=User"}" 
                             class="w-8 h-8 rounded-full object-cover border border-gray-100 shadow-sm">
                        <div class="min-w-0">
                            <p class="text-sm font-bold text-gray-800 truncate">${user.fullName || "Unknown"}</p>
                            <p class="text-[10px] text-gray-400 truncate">${user.department || "Unassigned"}</p>
                        </div>
                    </div>
                </td>
                <td class="px-2 py-3 text-center">
                    <span class="inline-flex items-center justify-center rounded-full text-[9px] font-bold uppercase tracking-wide ${currentRole === "admin" ? "bg-purple-100 text-purple-700" : "bg-gray-100 text-gray-600"}" 
                          style="padding: 2px 8px;">
                        ${currentRole}
                    </span>
                </td>
                <td class="px-4 py-3 text-right">
                    <select onchange="window.updateUserRoleAdapter('${userId}', this.value)"
                        class="text-[11px] font-medium border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-sky-500 cursor-pointer shadow-sm">
                        <option value="user" ${currentRole === "user" ? "selected" : ""}>Set as User</option>
                        <option value="admin" ${currentRole === "admin" ? "selected" : ""}>Set as Admin</option>
                    </select>
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