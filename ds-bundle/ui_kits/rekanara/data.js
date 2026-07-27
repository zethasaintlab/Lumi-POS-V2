/* Data bersama UI kit ORIGEN. Plain JS (bukan JSX) — dimuat sebagai
   <script> biasa sebelum skrip babel, mengekspos window.REKANARA. */
window.REKANARA = {
  brand: { name: 'The Cafe by ORIGEN' },
  user: { name: 'Super Admin User', role: 'Super Admin' },

  // Sidebar admin — diturunkan dari alur kerja produk. { group, items:[{id,label,icon}] }
  nav: [
    { items: [{ id: 'dashboard', label: 'Dashboard', icon: 'dashboard' }] },
    { group: 'Operations', items: [
      { id: 'pos', label: 'Open Register (POS)', icon: 'register' },
      { id: 'kds', label: 'Kitchen Display', icon: 'chef' },
    ] },
    { group: 'Products', items: [
      { id: 'categories', label: 'Product Categories', icon: 'layers' },
      { id: 'products', label: 'Products', icon: 'package' },
      { id: 'modifiers', label: 'Modifiers', icon: 'sliders' },
    ] },
    { group: 'Marketing', items: [
      { id: 'promos', label: 'Promos & Discounts', icon: 'tag' },
    ] },
    { group: 'Inventory', items: [
      { id: 'stock-mov', label: 'Stock Movements', icon: 'truck' },
      { id: 'stock-adj', label: 'Stock Adjustments', icon: 'sliders' },
      { id: 'stock-opname', label: 'Stock Opname', icon: 'clipboard' },
    ] },
    { group: 'Accounting', items: [
      { id: 'transactions', label: 'Transactions', icon: 'file' },
      { id: 'comp-logs', label: 'Complimentary Logs', icon: 'gift' },
      { id: 'refunds', label: 'Refund History', icon: 'refresh' },
      { id: 'journal', label: 'Auto-Journal', icon: 'book' },
    ] },
    { group: 'Customers', items: [
      { id: 'customers', label: 'Customer List', icon: 'users' },
    ] },
    { group: 'Tables', items: [
      { id: 'table-mon', label: 'Table Monitoring', icon: 'table' },
      { id: 'table-mgmt', label: 'Table Management', icon: 'table' },
    ] },
    { group: 'Reservations', items: [
      { id: 'reservations', label: 'Reservation List', icon: 'calendar' },
    ] },
    { group: 'Team & Schedule', items: [
      { id: 'attendance', label: 'My Attendance', icon: 'clock' },
      { id: 'shift', label: 'Shift & Schedule', icon: 'calendar' },
      { id: 'timeoff', label: 'Attendance & Time Off', icon: 'user' },
    ] },
    { group: 'Settings', items: [
      { id: 'access', label: 'Access Control', icon: 'shield' },
      { id: 'activity', label: 'Activity Logs', icon: 'activity' },
      { id: 'settings', label: 'Settings', icon: 'settings' },
      { id: 'testimonials', label: 'Testimonials', icon: 'message' },
      { id: 'gallery', label: 'Gallery', icon: 'image' },
    ] },
  ],

  // Layar yang benar-benar dibangun di kit ini (sisanya placeholder jujur).
  built: ['dashboard', 'shift', 'settings', 'access', 'reservations', 'customers', 'table-mgmt', 'table-mon'],

  tables: [
    { code: 'A01', area: 'Main Hall', cap: '2 Seats', type: 'Regular', group: '-', pos: '-', reservable: true },
    { code: 'A02', area: 'Main Hall', cap: '5 Seats', type: 'Regular', group: '-', pos: '-', reservable: true },
    { code: 'A03', area: 'Main Hall', cap: '2 Seats', type: 'Regular', group: '-', pos: '-', reservable: true },
    { code: 'A04', area: 'Main Hall', cap: '6 Seats', type: 'Regular', group: 'Keluarga', pos: '10.00%, 10.00%', reservable: true },
  ],
};
