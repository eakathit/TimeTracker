// ไฟล์: public/js/services/requestService.js
import { db } from '../config/firebase-config.js';
import { showNotification } from '../utils/uiHelper.js';

// 1. ฟังก์ชันส่งใบลา (Leave Request)
export async function submitLeaveRequest(leaveData) {
    try {
        const finalData = {
            ...leaveData,
            status: "pending",
            submittedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        await db.collection("leave_requests").add(finalData);
        showNotification("ยื่นใบลาสำเร็จ รอการอนุมัติ", "success");
        return true;
    } catch (error) {
        console.error("Error submitting leave request:", error);
        showNotification("เกิดข้อผิดพลาด: " + error.message, "error");
        return false;
    }
}

// 2. ฟังก์ชันบันทึกรายงานประจำวัน (Daily Report)
export async function submitDailyReport(userId, dateStr, reportData) {
    try {
        const docId = `${userId}_${dateStr}`;
        const workRecordRef = db.collection("work_records").doc(docId);
        
        const newReportEntry = {
            ...reportData,
            id: Date.now(),
            submittedAt: new Date()
        };

        const doc = await workRecordRef.get();
        if (doc.exists) {
            await workRecordRef.update({
                reports: firebase.firestore.FieldValue.arrayUnion(newReportEntry)
            });
        } else {
            await workRecordRef.set({
                userId: userId,
                date: firebase.firestore.Timestamp.fromDate(new Date(dateStr)),
                status: "no_checkin_report_only",
                reports: [newReportEntry]
            });
        }
        showNotification("เพิ่มรายงานเรียบร้อยแล้ว", "success");
        return true;
    } catch (error) {
        console.error("Error saving report:", error);
        showNotification("เกิดข้อผิดพลาด: " + error.message, "error");
        return false;
    }
}

// 3. ฟังก์ชันลบรายงานประจำวัน
export async function deleteDailyReportItem(docId, reportId) {
    try {
        const docRef = db.collection("work_records").doc(docId);
        const doc = await docRef.get();
        if (doc.exists) {
            const data = doc.data();
            const reportsArray = data.reports || [];
            const updatedReports = reportsArray.filter((r, idx) => (r.id ? r.id !== reportId : idx !== reportId));
            
            await docRef.update({ reports: updatedReports });
            showNotification("ลบรายงานสำเร็จ", "success");
            return true;
        }
        return false;
    } catch (error) {
        console.error("Error deleting report:", error);
        showNotification("เกิดข้อผิดพลาดในการลบ", "error");
        return false;
    }
}