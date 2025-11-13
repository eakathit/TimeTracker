self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const domain = url.hostname;
  
  if (
    domain === 'localhost' || // [!!!] ต้องมีบรรทัดนี้
    domain.endsWith('cloudfunctions.net') ||
    domain.endsWith('firebasestorage.googleapis.com') ||
    domain.endsWith('timetracker-f1e11.web.app') || 
    domain.endsWith('accounts.google.com')
  ) {
    return; // ปล่อยผ่าน
  }

  event.respondWith(fetch(event.request));
});