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
