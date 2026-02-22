// ฟังก์ชันคำนวณชั่วโมงงานและ OT
export function calculateWorkHours(checkinDate, checkoutDate) {
    // 1. หาเวลารวม (ms)
    let workDurationMillis = checkoutDate - checkinDate;
    if (workDurationMillis < 0) workDurationMillis = 0;

    // 2. หักเวลาพักเที่ยง 1 ชั่วโมง (12:00 - 13:00)
    const lunchStart = new Date(checkinDate);
    lunchStart.setHours(12, 0, 0, 0);
    const lunchEnd = new Date(checkinDate);
    lunchEnd.setHours(13, 0, 0, 0);

    if (checkinDate < lunchEnd && checkoutDate > lunchStart) {
      workDurationMillis -= 3600000;
    }

    let overtimeHours = 0;

    // 3. คำนวณ OT (ฐานเริ่มที่ 17:30 นับทุก 30 นาทีเต็ม)
    const otStartThreshold = new Date(checkoutDate);
    otStartThreshold.setHours(18, 0, 0, 0); // ต้องเลิก 18:00 ถึงจะเริ่มคิด OT

    const normalEndThreshold = new Date(checkoutDate);
    normalEndThreshold.setHours(17, 30, 0, 0); // จุดเริ่มนับฐาน OT

    if (checkoutDate >= otStartThreshold) {
      const otMillis = checkoutDate - normalEndThreshold;
      // ใช้ Math.floor เพื่อให้นับตามจำนวน 30 นาทีที่ทำครบจริง
      const otBlocks = Math.floor(otMillis / (1000 * 60 * 30));
      overtimeHours = otBlocks * 0.5;
    }

    // 4. คำนวณชั่วโมงงานปกติ (เวลารวมทั้งหมด - OT)
    const totalWorkHours = workDurationMillis / (1000 * 60 * 60);
    let regularWorkHours = totalWorkHours - overtimeHours;

    // ถ้าเกิน 8 ชั่วโมง ให้ตัดเหลือแค่ 8.00 (เพื่อความง่ายของ HR)
    if (regularWorkHours > 8) {
      regularWorkHours = 8.0;
    }

    return {
      regularWorkHours: Math.max(0, regularWorkHours),
      overtimeHours: Math.max(0, overtimeHours),
    };
}

export function toLocalISOString(date) {
  if (!date) return ""; // สำหรับ handle ค่า null เช่น checkout ที่ยังไม่เกิด

  const d = new Date(date);
  // ดึงค่าตามโซนเวลาท้องถิ่น (Local Timezone)
  const year = d.getFullYear();
  const month = (d.getMonth() + 1).toString().padStart(2, "0"); // getMonth() เริ่มที่ 0
  const day = d.getDate().toString().padStart(2, "0");
  const hours = d.getHours().toString().padStart(2, "0");
  const minutes = d.getMinutes().toString().padStart(2, "0");

  // ส่งค่ากลับในฟอร์แมต YYYY-MM-DDTHH:MM
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function toLocalDateKey(date) {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}
