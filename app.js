const TOKEN_KEY = "campus_parking_auth_token_v1";
const LANG_KEY = "preferredLang";
const THEME_KEY = "cp_theme";

// ── Dark mode ─────────────────────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = saved ? saved === "dark" : prefersDark;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  updateThemeIcon(dark);
}

function updateThemeIcon(dark) {
  const btn = document.getElementById("themeToggleBtn");
  if (!btn) return;
  btn.setAttribute("aria-pressed", String(dark));
  btn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  btn.innerHTML = dark
    ? '<i data-lucide="sun"></i>'
    : '<i data-lucide="moon"></i>';
  refreshLucideIcons();
}

function toggleTheme() {
  const isDark = document.documentElement.dataset.theme === "dark";
  const next = isDark ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem(THEME_KEY, next);
  updateThemeIcon(next === "dark");
}

// Apply theme before first paint
initTheme();
const API_BASE =
  window.CAMPUSPARK_API_BASE ||
  (["localhost", "127.0.0.1"].includes(window.location.hostname)
    ? "http://localhost:3000"
    : window.location.protocol === "file:"
      ? "http://localhost:3000"
      : "");

// ── Feature flags ─────────────────────────────────────────────────────────────
// Loaded once on init from /api/flags; cached in memory.
let featureFlags = {};

async function loadFeatureFlags() {
  try {
    featureFlags = await apiFetch("/api/flags", { auth: false });
  } catch { /* non-critical, default to empty (all off) */ }
}

function featureEnabled(key) {
  return featureFlags[key] === true;
}

// ── Funnel analytics — client-side event batching ────────────────────────────
// Tracks: search | spot_view | reserve_start | reserve_complete | check_in | check_out
// Events are batched every 10 seconds to avoid per-action network overhead.
const FUNNEL_SESSION_KEY = "cp_session_id";
const funnelSessionId = (() => {
  let id = sessionStorage.getItem(FUNNEL_SESSION_KEY);
  if (!id) {
    id = (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(FUNNEL_SESSION_KEY, id);
  }
  return id;
})();

let funnelQueue = [];
let funnelFlushTimer = null;

function trackEvent(event, spotId = null, meta = null) {
  funnelQueue.push({ sessionId: funnelSessionId, event, spotId, meta });
  if (!funnelFlushTimer) {
    funnelFlushTimer = setTimeout(flushFunnelEvents, 10_000);
  }
}

async function flushFunnelEvents() {
  funnelFlushTimer = null;
  if (funnelQueue.length === 0) return;
  const batch = funnelQueue.splice(0);
  try {
    await fetch(`${API_BASE}/api/analytics/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batch),
      keepalive: true
    });
  } catch { /* non-critical, silently drop */ }
}

// Flush before page unload so events aren't lost on navigation
window.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushFunnelEvents();
});

let currentUser = null;
let authToken = localStorage.getItem(TOKEN_KEY) || "";
let currentLang = localStorage.getItem(LANG_KEY) || "en";
let spots = [];
let myBookings = [];
let selectedSpotId = null;
let selectedMapSpotId = null;
let selectedCheckInBookingId = null;
let searchDebounceTimer = null;
let currentRoute = "/";
let mobilePanel = "map";
let deferredInstallPrompt = null;
let adminStats = { total: 0, available: 0, todayBookings: 0 };
let leafletMap = null;
let leafletLayerGroup = null;
let leafletMapResizeTimer = null;
const leafletMarkers = new Map();
const spotLatLngCache = new Map();
let heatmapLayer = null;
let heatmapData = [];
let heatmapVisible = true;
let heatmapRefreshTimer = null;
let routePolylineLayer = null;
let aiRecommendedSpotId = null;
let autocompleteDebounceTimer = null;

// Seattle hourly demand curve (matches server.js HOURLY_DEMAND)
const HOURLY_DEMAND = [
  0.05, 0.03, 0.03, 0.03, 0.06, 0.12,
  0.30, 0.66, 0.88, 0.78, 0.64, 0.72,
  0.82, 0.70, 0.60, 0.62, 0.85, 0.92,
  0.66, 0.46, 0.30, 0.18, 0.12, 0.07
];

// Same deterministic bias as server.js spotOccupancyBias
function spotBias(name = "") {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  return 0.75 + (Math.abs(h) % 1000) / 2000;
}

function predictSpotsInOneHour(spot) {
  const total = Number(spot.totalSpots || 1);
  const now = new Date();
  const isDST = now.getUTCMonth() >= 2 && now.getUTCMonth() <= 10;
  const currentHour = (now.getUTCHours() + 24 + (isDST ? -7 : -8)) % 24;
  const futureHour = (currentHour + 1) % 24;
  const futureDemand = HOURLY_DEMAND[futureHour] ?? 0.5;
  const futureOccupancy = Math.min(0.99, futureDemand * spotBias(spot.name));
  return Math.max(0, Math.round(total * (1 - futureOccupancy)));
}

// Gradient key = occupancy rate: 0 = empty (green) → 1 = full (red)
const HEATMAP_GRADIENT = {
  0.0: "#00c853",
  0.3: "#76ff03",
  0.55: "#ffea00",
  0.75: "#ff6d00",
  1.0: "#d50000"
};

const zoneFilter = document.getElementById("zoneFilter");
const langSwitcher = document.getElementById("lang-switcher");
const searchInput = document.getElementById("searchInput");
const arrivalTime = document.getElementById("arrivalTime");
const duration = document.getElementById("duration");
const evOnlyFilter = document.getElementById("evOnlyFilter");
const recommendBtn = document.getElementById("recommendBtn");
const spotGrid = document.getElementById("spotGrid");


const bookingList = document.getElementById("bookingList");
const mapGrid = document.querySelector("#map-view .map-grid");
const leafletMapCanvas = document.getElementById("leafletMapCanvas");
const mapDetailTitle = document.getElementById("mapDetailTitle");
const mapDetailMeta = document.getElementById("mapDetailMeta");
const mapDetailZone = document.getElementById("mapDetailZone");
const mapDetailAvailability = document.getElementById("mapDetailAvailability");
const mapDetailPrice = document.getElementById("mapDetailPrice");
const mapNavigateBtn = document.getElementById("mapNavigateBtn");
const mapReserveBtn = document.getElementById("mapReserveBtn");
const heatmapToggle = document.getElementById("heatmapToggle");
const dialog = document.getElementById("bookingDialog");
const checkInDialog = document.getElementById("checkInDialog");
const bookingForm = document.getElementById("bookingForm");
const checkInForm = document.getElementById("checkInForm");
const dialogSpotInfo = document.getElementById("dialogSpotInfo");
const checkInReservationInfo = document.getElementById("checkInReservationInfo");
const plateInput = document.getElementById("plateInput");
const phoneInput = document.getElementById("phoneInput");
const ticketCodeInput = document.getElementById("ticketCodeInput");
const spotCardTemplate = document.getElementById("spotCardTemplate");
const bookingTemplate = document.getElementById("bookingTemplate");
const sessionDisplay = document.getElementById("sessionDisplay");
const userNameInput = document.getElementById("userNameInput");
const userNameError = document.getElementById("userNameError");
const passwordInput = document.getElementById("passwordInput");
const passwordError = document.getElementById("passwordError");
const authErrorMessage = document.getElementById("authErrorMessage");
const authSuccessMessage = document.getElementById("authSuccessMessage");
const loginBtn = document.getElementById("loginBtn");
const registerBtn = document.getElementById("registerBtn");
const loginRole = document.getElementById("loginRole");
const topLoginBtn = document.getElementById("topLoginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const loginView = document.getElementById("loginView");
const dashboardView = document.getElementById("dashboardView");
const reservationsView = document.getElementById("reservationsView");
const adminView = document.getElementById("adminView");
const routeLinks = [...document.querySelectorAll("[data-route-link]")];
const adminNavLink = document.getElementById("adminNavLink");
const showListBtn = document.getElementById("showListBtn");
const showMapBtn = document.getElementById("showMapBtn");
const cancelCheckInBtn = document.getElementById("cancelCheckInBtn");
const adminTotalCount = document.getElementById("adminTotalCount");
const adminAvailableCount = document.getElementById("adminAvailableCount");
const adminTodayBookingCount = document.getElementById("adminTodayBookingCount");
const adminSpotList = document.getElementById("adminSpotList");
const adminFlagList = document.getElementById("adminFlagList");
const installPrompt = document.getElementById("installPrompt");
const installAppBtn = document.getElementById("installAppBtn");
const dismissInstallPromptBtn = document.getElementById("dismissInstallPromptBtn");
const iosInstallHint = document.getElementById("iosInstallHint");
const dismissIosHintBtn = document.getElementById("dismissIosHintBtn");
const roleTabStudent   = document.getElementById("roleTabStudent");
const roleTabAdmin     = document.getElementById("roleTabAdmin");
const departureInput   = document.getElementById("departureInput");
const aiRecommendBtn   = document.getElementById("aiRecommendBtn");
const aiResultPanel    = document.getElementById("aiResultPanel");

const i18n = {
  en: {
    accountLabel: "Account",
    roleLabel: "Role",
    usernameLabel: "Username",
    usernamePlaceholder: "Enter your username",
    passwordLabel: "Password",
    passwordPlaceholder: "Enter your password",
    languageLabel: "Language",
    signInBtn: "Sign In",
    signUpBtn: "Student Sign Up",
    signOutBtn: "Sign Out",
    defaultAdminNote: "Default admin account: admin / admin123",
    heroEyebrow: "Campus Mobility",
    appTitle: "CampusPark",
    heroSubtitle: "Reserve parking faster around Seattle campus landmarks without getting buried in a cluttered interface.",
    totalSpaces: "Total Spaces",
    availableNow: "Available Now",
    todayReservations: "Today's Reservations",
    liveTrend: "Live trend",
    discoverLabel: "Discover",
    searchLabel: "Search",
    searchPlaceholder: "Search by landmark or address",
    zoneLabel: "Zone",
    allZones: "All Zones",
    arrivalTimeLabel: "Arrival Time",
    durationLabel: "Duration",
    duration1: "1 Hour",
    duration2: "2 Hours",
    duration3: "3 Hours",
    duration4: "4 Hours",
    evSpacesLabel: "EV Spaces",
    showEvOnly: "Show EV Only",
    recommendBtn: "Recommend",
    exportBtn: "Export",
    parkingSpots: "Parking Spots",
    resultsSubtitle: "Live inventory, compact cards, faster scanning.",
    adminPanel: "Admin Panel",
    adminSubtitle: "Manage lot visibility without leaving the dashboard.",
    spaceIdLabel: "Space ID",
    spaceIdPlaceholder: "e.g. E-41",
    newZonePlaceholder: "e.g. Student Center",
    locationLabel: "Location",
    locationPlaceholder: "e.g. Student Center East Entrance",
    addSpaceBtn: "Add Space",
    myReservations: "My Reservations",
    reservationsSubtitle: "Upcoming and active bookings.",
    mapViewLabel: "Map View",
    mapCanvasTitle: "Seattle Parking Canvas",
    mapCanvasSubtitle: "OpenStreetMap stays pinned while the inventory list scrolls independently.",
    selectedLocationLabel: "Selected Location",
    selectParkingLot: "Select a parking lot",
    mapDefaultMeta: "Choose a card on the left to preview the lot and inventory here.",
    availabilityLabel: "Availability",
    priceLabel: "Price",
    reserveSelectedBtn: "Reserve Selected Spot",
    confirmReservation: "Confirm Reservation",
    licensePlate: "License Plate",
    phoneNumber: "Phone Number",
    platePlaceholder: "e.g. 8ABC123",
    phonePlaceholder: "e.g. 5551234567",
    cancelBtn: "Cancel",
    cancelReservationBtn: "Cancel Reservation",
    notSignedIn: "Not signed in",
    adminRole: "Admin",
    studentRole: "Student",
    noMatchingSpots: "No parking spaces match the current filters.",
    noMatchingEvSpots: "No available EV spaces match the current filters.",
    unavailableAddress: "Address unavailable",
    priceUnavailable: "Price unavailable",
    signInFirstBtn: "Sign In First",
    fullBtn: "Full",
    noReservationsYet: "No reservations yet.",
    signInToReservations: "Sign in to view and manage your reservations.",
    selectedLocationUnavailable: "No parking lots found",
    selectedLocationNoMatch: "Adjust filters or search terms to reveal matching locations.",
    availabilityTag: "Availability",
    priceTag: "Price",
    zoneTag: "Zone",
    reserveRecommendation: "Recommended space:",
    noSearchResults: "No available parking spaces match your current search.",
    enabled: "Enabled",
    disabled: "Disabled",
    reserveBtn: "Reserve",
    bookingOwner: "Reserved by:",
    platePhone: "Plate:",
    enterUsername: "Please enter your username.",
    enterPassword: "Please enter your password.",
    accountCreated: "Account created. Signing you in...",
    spotsLeft: "spots left",
    spotLeft: "spot left"
  },
  zh: {
    accountLabel: "账户",
    roleLabel: "角色",
    usernameLabel: "用户名",
    usernamePlaceholder: "请输入用户名",
    passwordLabel: "密码",
    passwordPlaceholder: "请输入密码",
    languageLabel: "语言",
    signInBtn: "登录",
    signUpBtn: "学生注册",
    signOutBtn: "退出登录",
    defaultAdminNote: "默认管理员账号：admin / admin123",
    heroEyebrow: "校园出行",
    appTitle: "CampusPark",
    heroSubtitle: "更快预订西雅图校园周边车位，减少寻找停车位的时间。",
    totalSpaces: "总车位数",
    availableNow: "当前可用",
    todayReservations: "今日预约",
    liveTrend: "实时趋势",
    discoverLabel: "发现车位",
    searchLabel: "搜索",
    searchPlaceholder: "按地标或地址搜索",
    zoneLabel: "区域",
    allZones: "全部区域",
    arrivalTimeLabel: "到达时间",
    durationLabel: "时长",
    duration1: "1 小时",
    duration2: "2 小时",
    duration3: "3 小时",
    duration4: "4 小时",
    evSpacesLabel: "充电车位",
    showEvOnly: "仅看 EV",
    recommendBtn: "推荐",
    exportBtn: "导出",
    parkingSpots: "停车位",
    resultsSubtitle: "实时库存，卡片紧凑，浏览更高效。",
    adminPanel: "管理面板",
    adminSubtitle: "无需离开仪表板即可管理车位状态。",
    spaceIdLabel: "车位编号",
    spaceIdPlaceholder: "例如 E-41",
    newZonePlaceholder: "例如 Student Center",
    locationLabel: "位置",
    locationPlaceholder: "例如 Student Center East Entrance",
    addSpaceBtn: "新增车位",
    myReservations: "我的预约",
    reservationsSubtitle: "即将开始和进行中的预约。",
    mapViewLabel: "地图视图",
    mapCanvasTitle: "西雅图停车地图",
    mapCanvasSubtitle: "OpenStreetMap 保持固定，左侧车位列表可独立滚动。",
    selectedLocationLabel: "已选位置",
    selectParkingLot: "请选择一个停车点",
    mapDefaultMeta: "点击左侧卡片，在这里查看位置和库存。",
    availabilityLabel: "可用情况",
    priceLabel: "价格",
    reserveSelectedBtn: "预约当前车位",
    confirmReservation: "确认预约",
    licensePlate: "车牌号",
    phoneNumber: "电话号码",
    platePlaceholder: "例如 8ABC123",
    phonePlaceholder: "例如 5551234567",
    cancelBtn: "取消",
    cancelReservationBtn: "取消预约",
    notSignedIn: "未登录",
    adminRole: "管理员",
    studentRole: "学生",
    noMatchingSpots: "没有符合当前筛选条件的车位。",
    noMatchingEvSpots: "没有符合当前筛选条件的 EV 车位。",
    unavailableAddress: "地址不可用",
    priceUnavailable: "价格不可用",
    signInFirstBtn: "请先登录",
    fullBtn: "已满",
    noReservationsYet: "暂无预约。",
    signInToReservations: "登录后可查看和管理预约。",
    selectedLocationUnavailable: "没有找到停车点",
    selectedLocationNoMatch: "请调整筛选条件或搜索词。",
    availabilityTag: "可用情况",
    priceTag: "价格",
    zoneTag: "区域",
    reserveRecommendation: "推荐车位：",
    noSearchResults: "没有符合当前搜索的可用车位。",
    enabled: "已启用",
    disabled: "已停用",
    reserveBtn: "预订",
    bookingOwner: "预约人：",
    platePhone: "车牌：",
    enterUsername: "请输入用户名。",
    enterPassword: "请输入密码。",
    accountCreated: "账号已创建，正在为你登录……",
    spotsLeft: "个车位剩余",
    spotLeft: "个车位剩余"
  },
  es: {
    accountLabel: "Cuenta",
    roleLabel: "Rol",
    usernameLabel: "Nombre de usuario",
    usernamePlaceholder: "Ingresa tu nombre de usuario",
    passwordLabel: "Contraseña",
    passwordPlaceholder: "Ingresa tu contraseña",
    languageLabel: "Idioma",
    signInBtn: "Iniciar sesión",
    signUpBtn: "Registro de estudiante",
    signOutBtn: "Cerrar sesión",
    defaultAdminNote: "Cuenta de administrador por defecto: admin / admin123",
    heroEyebrow: "Movilidad del campus",
    appTitle: "CampusPark",
    heroSubtitle: "Reserva estacionamiento más rápido cerca de los puntos clave del campus de Seattle.",
    totalSpaces: "Espacios totales",
    availableNow: "Disponible ahora",
    todayReservations: "Reservas de hoy",
    liveTrend: "Tendencia en vivo",
    discoverLabel: "Descubrir",
    searchLabel: "Buscar",
    searchPlaceholder: "Buscar por punto de referencia o dirección",
    zoneLabel: "Zona",
    allZones: "Todas las zonas",
    arrivalTimeLabel: "Hora de llegada",
    durationLabel: "Duración",
    duration1: "1 hora",
    duration2: "2 horas",
    duration3: "3 horas",
    duration4: "4 horas",
    evSpacesLabel: "Espacios EV",
    showEvOnly: "Solo EV",
    recommendBtn: "Recomendar",
    exportBtn: "Exportar",
    parkingSpots: "Estacionamientos",
    resultsSubtitle: "Inventario en vivo, tarjetas compactas y exploración más rápida.",
    adminPanel: "Panel de administración",
    adminSubtitle: "Gestiona la visibilidad sin salir del panel.",
    spaceIdLabel: "ID del espacio",
    spaceIdPlaceholder: "ej. E-41",
    newZonePlaceholder: "ej. Student Center",
    locationLabel: "Ubicación",
    locationPlaceholder: "ej. Student Center East Entrance",
    addSpaceBtn: "Agregar espacio",
    myReservations: "Mis reservas",
    reservationsSubtitle: "Reservas activas y próximas.",
    mapViewLabel: "Vista del mapa",
    mapCanvasTitle: "Mapa de estacionamiento de Seattle",
    mapCanvasSubtitle: "OpenStreetMap permanece fijo mientras la lista de inventario se desplaza por separado.",
    selectedLocationLabel: "Ubicación seleccionada",
    selectParkingLot: "Selecciona un estacionamiento",
    mapDefaultMeta: "Elige una tarjeta a la izquierda para ver detalles aquí.",
    availabilityLabel: "Disponibilidad",
    priceLabel: "Precio",
    reserveSelectedBtn: "Reservar ubicación seleccionada",
    confirmReservation: "Confirmar reserva",
    licensePlate: "Placa",
    phoneNumber: "Número de teléfono",
    platePlaceholder: "ej. 8ABC123",
    phonePlaceholder: "ej. 5551234567",
    cancelBtn: "Cancelar",
    cancelReservationBtn: "Cancelar reserva",
    notSignedIn: "Sin iniciar sesión",
    adminRole: "Administrador",
    studentRole: "Estudiante",
    noMatchingSpots: "No hay estacionamientos que coincidan con los filtros actuales.",
    noMatchingEvSpots: "No hay espacios EV disponibles que coincidan con los filtros actuales.",
    unavailableAddress: "Dirección no disponible",
    priceUnavailable: "Precio no disponible",
    signInFirstBtn: "Inicia sesión primero",
    fullBtn: "Completo",
    noReservationsYet: "Aún no hay reservas.",
    signInToReservations: "Inicia sesión para ver y gestionar tus reservas.",
    selectedLocationUnavailable: "No se encontraron estacionamientos",
    selectedLocationNoMatch: "Ajusta los filtros o la búsqueda para ver resultados.",
    availabilityTag: "Disponibilidad",
    priceTag: "Precio",
    zoneTag: "Zona",
    reserveRecommendation: "Espacio recomendado:",
    noSearchResults: "No hay espacios disponibles para tu búsqueda actual.",
    enabled: "Habilitado",
    disabled: "Deshabilitado",
    reserveBtn: "Reservar",
    bookingOwner: "Reservado por:",
    platePhone: "Placa:",
    enterUsername: "Por favor, ingresa tu nombre de usuario.",
    enterPassword: "Por favor, ingresa tu contraseña.",
    accountCreated: "Cuenta creada. Iniciando sesión...",
    spotsLeft: "espacios disponibles",
    spotLeft: "espacio disponible"
  },
  vi: {
    accountLabel: "Tài khoản",
    roleLabel: "Vai trò",
    usernameLabel: "Tên đăng nhập",
    usernamePlaceholder: "Nhập tên đăng nhập",
    passwordLabel: "Mật khẩu",
    passwordPlaceholder: "Nhập mật khẩu",
    languageLabel: "Ngôn ngữ",
    signInBtn: "Đăng nhập",
    signUpBtn: "Đăng ký sinh viên",
    signOutBtn: "Đăng xuất",
    defaultAdminNote: "Tài khoản quản trị mặc định: admin / admin123",
    heroEyebrow: "Di chuyển trong khuôn viên",
    appTitle: "CampusPark",
    heroSubtitle: "Đặt chỗ đậu xe nhanh hơn quanh các địa điểm gần khuôn viên Seattle.",
    totalSpaces: "Tổng số chỗ",
    availableNow: "Còn chỗ hiện tại",
    todayReservations: "Đặt chỗ hôm nay",
    liveTrend: "Xu hướng trực tiếp",
    discoverLabel: "Khám phá",
    searchLabel: "Tìm kiếm",
    searchPlaceholder: "Tìm theo địa danh hoặc địa chỉ",
    zoneLabel: "Khu vực",
    allZones: "Tất cả khu vực",
    arrivalTimeLabel: "Thời gian đến",
    durationLabel: "Thời lượng",
    duration1: "1 giờ",
    duration2: "2 giờ",
    duration3: "3 giờ",
    duration4: "4 giờ",
    evSpacesLabel: "Chỗ EV",
    showEvOnly: "Chỉ EV",
    recommendBtn: "Đề xuất",
    exportBtn: "Xuất",
    parkingSpots: "Bãi đỗ xe",
    resultsSubtitle: "Dữ liệu trực tiếp, thẻ gọn hơn, quét nhanh hơn.",
    adminPanel: "Bảng quản trị",
    adminSubtitle: "Quản lý trạng thái mà không rời dashboard.",
    spaceIdLabel: "Mã chỗ",
    spaceIdPlaceholder: "ví dụ E-41",
    newZonePlaceholder: "ví dụ Student Center",
    locationLabel: "Vị trí",
    locationPlaceholder: "ví dụ Student Center East Entrance",
    addSpaceBtn: "Thêm chỗ",
    myReservations: "Đặt chỗ của tôi",
    reservationsSubtitle: "Các đặt chỗ sắp tới và đang hoạt động.",
    mapViewLabel: "Bản đồ",
    mapCanvasTitle: "Bản đồ đỗ xe Seattle",
    mapCanvasSubtitle: "OpenStreetMap được ghim cố định trong khi danh sách chỗ đỗ cuộn độc lập.",
    selectedLocationLabel: "Vị trí đã chọn",
    selectParkingLot: "Chọn một bãi đỗ xe",
    mapDefaultMeta: "Chọn thẻ bên trái để xem chi tiết tại đây.",
    availabilityLabel: "Tình trạng",
    priceLabel: "Giá",
    reserveSelectedBtn: "Đặt vị trí đã chọn",
    confirmReservation: "Xác nhận đặt chỗ",
    licensePlate: "Biển số xe",
    phoneNumber: "Số điện thoại",
    platePlaceholder: "ví dụ 8ABC123",
    phonePlaceholder: "ví dụ 5551234567",
    cancelBtn: "Hủy",
    cancelReservationBtn: "Hủy đặt chỗ",
    notSignedIn: "Chưa đăng nhập",
    adminRole: "Quản trị",
    studentRole: "Sinh viên",
    noMatchingSpots: "Không có bãi đỗ phù hợp với bộ lọc hiện tại.",
    noMatchingEvSpots: "Không có chỗ EV phù hợp với bộ lọc hiện tại.",
    unavailableAddress: "Không có địa chỉ",
    priceUnavailable: "Không có giá",
    signInFirstBtn: "Vui lòng đăng nhập",
    fullBtn: "Hết chỗ",
    noReservationsYet: "Chưa có đặt chỗ nào.",
    signInToReservations: "Đăng nhập để xem và quản lý đặt chỗ.",
    selectedLocationUnavailable: "Không tìm thấy bãi đỗ",
    selectedLocationNoMatch: "Hãy điều chỉnh bộ lọc hoặc từ khóa tìm kiếm.",
    availabilityTag: "Tình trạng",
    priceTag: "Giá",
    zoneTag: "Khu vực",
    reserveRecommendation: "Bãi được đề xuất:",
    noSearchResults: "Không có chỗ trống phù hợp với tìm kiếm hiện tại.",
    enabled: "Đang bật",
    disabled: "Đã tắt",
    reserveBtn: "Đặt chỗ",
    bookingOwner: "Đặt bởi:",
    platePhone: "Biển số:",
    enterUsername: "Vui lòng nhập tên đăng nhập.",
    enterPassword: "Vui lòng nhập mật khẩu.",
    accountCreated: "Tài khoản đã được tạo. Đang đăng nhập...",
    spotsLeft: "chỗ còn trống",
    spotLeft: "chỗ còn trống"
  },
  fr: {
    accountLabel: "Compte",
    roleLabel: "Rôle",
    usernameLabel: "Nom d'utilisateur",
    usernamePlaceholder: "Entrez votre nom d'utilisateur",
    passwordLabel: "Mot de passe",
    passwordPlaceholder: "Entrez votre mot de passe",
    languageLabel: "Langue",
    signInBtn: "Se connecter",
    signUpBtn: "Inscription étudiant",
    signOutBtn: "Se déconnecter",
    defaultAdminNote: "Compte administrateur par défaut : admin / admin123",
    heroEyebrow: "Mobilité du campus",
    appTitle: "CampusPark",
    heroSubtitle: "Réservez plus vite près du campus de Seattle sans perdre de temps à chercher une place.",
    totalSpaces: "Places totales",
    availableNow: "Disponible maintenant",
    todayReservations: "Réservations du jour",
    liveTrend: "Tendance en direct",
    discoverLabel: "Découvrir",
    searchLabel: "Recherche",
    searchPlaceholder: "Rechercher par repère ou adresse",
    zoneLabel: "Zone",
    allZones: "Toutes les zones",
    arrivalTimeLabel: "Heure d'arrivée",
    durationLabel: "Durée",
    duration1: "1 heure",
    duration2: "2 heures",
    duration3: "3 heures",
    duration4: "4 heures",
    evSpacesLabel: "Places EV",
    showEvOnly: "EV uniquement",
    recommendBtn: "Recommander",
    exportBtn: "Exporter",
    parkingSpots: "Places de parking",
    resultsSubtitle: "Inventaire en direct, cartes compactes, repérage plus rapide.",
    adminPanel: "Panneau admin",
    adminSubtitle: "Gérez la visibilité sans quitter le tableau de bord.",
    spaceIdLabel: "ID de place",
    spaceIdPlaceholder: "ex. E-41",
    newZonePlaceholder: "ex. Student Center",
    locationLabel: "Emplacement",
    locationPlaceholder: "ex. Student Center East Entrance",
    addSpaceBtn: "Ajouter une place",
    myReservations: "Mes réservations",
    reservationsSubtitle: "Réservations actives et à venir.",
    mapViewLabel: "Vue carte",
    mapCanvasTitle: "Carte de stationnement de Seattle",
    mapCanvasSubtitle: "OpenStreetMap reste fixe pendant que la liste d'inventaire défile séparément.",
    selectedLocationLabel: "Emplacement sélectionné",
    selectParkingLot: "Sélectionnez un parking",
    mapDefaultMeta: "Choisissez une carte à gauche pour prévisualiser l'emplacement ici.",
    availabilityLabel: "Disponibilité",
    priceLabel: "Prix",
    reserveSelectedBtn: "Réserver l'emplacement sélectionné",
    confirmReservation: "Confirmer la réservation",
    licensePlate: "Plaque d'immatriculation",
    phoneNumber: "Numéro de téléphone",
    platePlaceholder: "ex. 8ABC123",
    phonePlaceholder: "ex. 5551234567",
    cancelBtn: "Annuler",
    cancelReservationBtn: "Annuler la réservation",
    notSignedIn: "Non connecté",
    adminRole: "Admin",
    studentRole: "Étudiant",
    noMatchingSpots: "Aucune place ne correspond aux filtres actuels.",
    noMatchingEvSpots: "Aucune place EV disponible ne correspond aux filtres actuels.",
    unavailableAddress: "Adresse indisponible",
    priceUnavailable: "Prix indisponible",
    signInFirstBtn: "Connectez-vous d'abord",
    fullBtn: "Complet",
    noReservationsYet: "Aucune réservation pour le moment.",
    signInToReservations: "Connectez-vous pour voir et gérer vos réservations.",
    selectedLocationUnavailable: "Aucun parking trouvé",
    selectedLocationNoMatch: "Ajustez les filtres ou la recherche pour afficher des résultats.",
    availabilityTag: "Disponibilité",
    priceTag: "Prix",
    zoneTag: "Zone",
    reserveRecommendation: "Place recommandée :",
    noSearchResults: "Aucune place disponible ne correspond à votre recherche.",
    enabled: "Activé",
    disabled: "Désactivé",
    reserveBtn: "Réserver",
    bookingOwner: "Réservé par :",
    platePhone: "Plaque :",
    enterUsername: "Veuillez saisir votre nom d'utilisateur.",
    enterPassword: "Veuillez saisir votre mot de passe.",
    accountCreated: "Compte créé. Connexion en cours...",
    spotsLeft: "places restantes",
    spotLeft: "place restante"
  }
};

init();

async function init() {
  setupDefaultArrival();
  bindEvents();
  syncViewportState();
  syncRoute({ replace: true });
  setupInstallExperience();
  initI18n();
  syncLoginRoleUi();
  // Load feature flags early so all rendering can gate on them
  await loadFeatureFlags();
  await restoreSession();
  // Try loading data; if it fails on cold start, retry once after a short delay
  try {
    await refreshAll();
  } catch (_) {
    await new Promise(r => setTimeout(r, 1200));
    try {
      await refreshAll();
    } catch (err) {
      console.error("Failed to load parking data:", err);
      // Show a non-blocking banner so the user knows to refresh
      const banner = document.createElement("p");
      banner.textContent = "⚠️ Could not load parking data. Please refresh the page.";
      banner.style.cssText = "background:#fef2f2;color:#b91c1c;padding:10px 16px;text-align:center;margin:0;font-size:13px;";
      document.querySelector(".app-shell")?.prepend(banner);
    }
  }
  syncSessionUi();
  setupHeatmap();
  initSpotStream();
  refreshLucideIcons();
  maybeShowOnboarding();
}

// ── Onboarding guide ──────────────────────────────────────────────────────────
const ONBOARDING_KEY = "cp_onboarded_v1";

function maybeShowOnboarding() {
  if (localStorage.getItem(ONBOARDING_KEY)) return;
  const dialog = document.getElementById("onboardingDialog");
  if (!dialog) return;
  dialog.showModal();
  setupOnboarding(dialog);
}

function setupOnboarding(dialog) {
  const slides = dialog.querySelectorAll(".onboarding-slide");
  const dots   = dialog.querySelectorAll(".onboarding-dot");
  const prev   = dialog.querySelector("#onboardingPrev");
  const next   = dialog.querySelector("#onboardingNext");
  const skip   = dialog.querySelector("#onboardingSkip");
  let current  = 0;
  const total  = slides.length;

  function goTo(idx) {
    slides[current].classList.remove("active");
    dots[current].classList.remove("active");
    current = Math.max(0, Math.min(total - 1, idx));
    slides[current].classList.add("active");
    dots[current].classList.add("active");
    prev.hidden   = current === 0;
    next.textContent = current === total - 1 ? "Get Started" : "Next";
  }

  prev.addEventListener("click", () => goTo(current - 1));
  next.addEventListener("click", () => {
    if (current < total - 1) { goTo(current + 1); }
    else { finishOnboarding(dialog); }
  });
  skip.addEventListener("click", () => finishOnboarding(dialog));
  dots.forEach(dot => dot.addEventListener("click", () => goTo(Number(dot.dataset.dot))));
  // Allow closing by clicking backdrop
  dialog.addEventListener("click", e => {
    if (e.target === dialog) finishOnboarding(dialog);
  });
}

function finishOnboarding(dialog) {
  localStorage.setItem(ONBOARDING_KEY, "1");
  dialog.close();
}

function bindEvents() {
  if (loginRole) {
    loginRole.addEventListener("change", syncLoginRoleUi);
  }
  if (roleTabStudent && roleTabAdmin) {
    roleTabStudent.addEventListener("click", () => {
      roleTabStudent.classList.add("active");
      roleTabAdmin.classList.remove("active");
      registerBtn.classList.remove("hidden");
      userNameInput.placeholder = userNameInput.getAttribute("data-i18n-placeholder") || "Enter your username";
    });
    roleTabAdmin.addEventListener("click", () => {
      roleTabAdmin.classList.add("active");
      roleTabStudent.classList.remove("active");
      registerBtn.classList.add("hidden");
      userNameInput.value = userNameInput.value || "";
    });
  }
  if (heatmapToggle) {
    heatmapToggle.addEventListener("click", () => {
      heatmapVisible = !heatmapVisible;
      syncHeatmapToggleUi();
      updateHeatmapLayer();
    });
  }
  zoneFilter.addEventListener("change", async () => {
    try { await refreshSpots(); } catch (_) {}
    renderSpots();
    renderMapView();
  });
  searchInput.addEventListener("input", () => {
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
    }
    searchDebounceTimer = window.setTimeout(async () => {
      await recommendSpot({ silent: true });
    }, 250);
  });
  searchInput.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    await recommendSpot();
  });
  langSwitcher.addEventListener("change", (event) => {
    setLanguage(event.target.value);
  });
  userNameInput.addEventListener("input", clearUsernameError);
  userNameInput.addEventListener("input", clearAuthError);
  passwordInput.addEventListener("input", clearPasswordError);
  passwordInput.addEventListener("input", clearAuthError);
  arrivalTime.addEventListener("change", async () => {
    try { await refreshSpots(); } catch (_) {}
    renderSpots();
    renderMapView();
  });
  evOnlyFilter.addEventListener("change", () => {
    renderSpots();
    renderMapView();
  });
  recommendBtn.addEventListener("click", recommendSpot);
  if (aiRecommendBtn) {
    aiRecommendBtn.addEventListener("click", handleAiRecommend);
  }
  if (departureInput) {
    departureInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); hideAddressSuggestions(); handleAiRecommend(); }
      if (e.key === "Escape") { hideAddressSuggestions(); }
      if (e.key === "ArrowDown") {
        const first = document.querySelector(".autocomplete-item");
        if (first) { e.preventDefault(); first.focus(); }
      }
    });
    departureInput.addEventListener("input", () => {
      clearTimeout(autocompleteDebounceTimer);
      const val = departureInput.value.trim();
      if (val.length < 3 || /^\d{5}(-\d{4})?$/.test(val)) { hideAddressSuggestions(); return; }
      autocompleteDebounceTimer = setTimeout(() => fetchAndShowSuggestions(val), 320);
    });
    departureInput.addEventListener("blur", () => {
      setTimeout(hideAddressSuggestions, 180);
    });
  }
  // ZIP quick-fill chips — clicking fills the input and auto-submits
  document.querySelectorAll(".zip-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      if (departureInput) {
        departureInput.value = btn.dataset.zip;
        departureInput.focus();
      }
      hideAddressSuggestions();
      handleAiRecommend();
    });
  });
  // Admin CSV export
  document.getElementById("exportBookingsBtn")?.addEventListener("click", () => {
    const token = authToken;
    const url = `${API_BASE}/api/admin/bookings/export`;
    const a = document.createElement("a");
    a.href = token ? `${url}?_t=${encodeURIComponent(token)}` : url;
    a.download = "";
    // Use fetch with auth header so the token is sent properly
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.blob() : Promise.reject())
      .then(blob => {
        const burl = URL.createObjectURL(blob);
        const a2 = document.createElement("a");
        a2.href = burl;
        a2.download = `campuspark-bookings-${new Date().toISOString().slice(0, 10)}.csv`;
        a2.click();
        URL.revokeObjectURL(burl);
      })
      .catch(() => alert("Export failed — ensure you are signed in as admin."));
  });
  mapNavigateBtn.addEventListener("click", handleMapNavigate);
  mapReserveBtn.addEventListener("click", handleMapReserve);
  bookingForm.addEventListener("submit", handleConfirmBooking);
  checkInForm.addEventListener("submit", handleConfirmCheckIn);
  cancelCheckInBtn.addEventListener("click", () => {
    selectedCheckInBookingId = null;
    checkInDialog.close();
  });
  checkInDialog.addEventListener("close", () => {
    if (!checkInDialog.open) {
      selectedCheckInBookingId = null;
    }
  });
  ticketCodeInput.addEventListener("input", () => {
    ticketCodeInput.value = ticketCodeInput.value.replace(/\D/g, "").slice(0, 6);
  });
  loginBtn.addEventListener("click", handleLogin);
  registerBtn.addEventListener("click", handleRegister);
  logoutBtn.addEventListener("click", handleLogout);
  document.getElementById("themeToggleBtn")?.addEventListener("click", toggleTheme);
  installAppBtn.addEventListener("click", handleInstallApp);
  dismissInstallPromptBtn.addEventListener("click", dismissInstallUi);
  dismissIosHintBtn.addEventListener("click", dismissInstallUi);
  showListBtn.addEventListener("click", () => {
    mobilePanel = "list";
    syncViewportState();
  });
  showMapBtn.addEventListener("click", () => {
    mobilePanel = "map";
    syncViewportState();
  });
  routeLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      navigateTo(link.dataset.routeLink || "/");
    });
  });
  window.addEventListener("popstate", () => {
    syncRoute({ replace: true });
    render();
  });
  window.addEventListener("resize", syncViewportState);
}

function syncLoginRoleUi() {
  if (!loginRole) return;
  const isAdmin = loginRole.value === "admin";
  registerBtn.classList.toggle("hidden", isAdmin);
  if (isAdmin && !userNameInput.value.trim()) {
    userNameInput.value = "admin";
  }
}

function setupDefaultArrival() {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  now.setHours(now.getHours() + 1);
  arrivalTime.value = toLocalInput(now);
}

async function restoreSession() {
  if (!authToken) return;
  try {
    const result = await apiFetch("/api/session");
    currentUser = result.user;
  } catch {
    clearToken();
  }
}

async function refreshAll() {
  await refreshSpots();
  await refreshStats();
  if (currentUser) {
    await refreshMyBookings();
  } else {
    myBookings = [];
  }
  fillZoneOptions();
  render();
}

async function refreshSpots() {
  const at = new Date(arrivalTime.value || Date.now()).toISOString();
  const zone = zoneFilter.value || "all";
  const search = searchInput.value.trim();
  const query = new URLSearchParams({ at, zone });
  if (search) {
    query.set("search", search);
    trackEvent("search", null, { query: search, zone });
  }
  const result = await apiFetch(`/api/spots?${query.toString()}`, { auth: false });
  spots = result.spots || [];
}

function syncHeatmapToggleUi() {
  if (!heatmapToggle) return;
  heatmapToggle.classList.toggle("active", heatmapVisible);
  heatmapToggle.setAttribute("aria-pressed", String(heatmapVisible));
}

function ensureHeatmapLayer() {
  const L = ensureLeafletMap();
  if (!L || !L.heatLayer || !leafletMap) return null;

  // leaflet.heat's internal _reset() reads map.getSize() synchronously during
  // addTo(). Leaflet's canvas Renderer also computes pixel bounds at that moment.
  // If the map container is still zero-sized (first load before layout, map pane
  // hidden on mobile, or invalidateSize() hasn't fired yet), those bounds are
  // null and the library throws "Cannot read properties of null (reading
  // 'getSize')". Guard here: return null until the container has real pixels.
  // scheduleLeafletMapResize() will call updateHeatmapLayer() once the map is
  // properly sized, so no data is lost.
  if (!leafletMapCanvas || leafletMapCanvas.clientWidth === 0) return null;

  if (!heatmapLayer) {
    heatmapLayer = L.heatLayer([], {
      radius: 35,
      blur: 24,
      minOpacity: 0.7,
      maxZoom: 17,
      gradient: HEATMAP_GRADIENT
    });
  }
  return heatmapLayer;
}

function updateHeatmapLayer() {
  // If the map container is zero-sized, evict the heat layer immediately.
  // A zero-sized container means getSize() returns {x:0}, which _reset() writes
  // into canvas.width — then simpleheat.draw() calls ctx.getImageData(0,0,0,h)
  // and throws IndexSizeError "source width is 0" (leaflet-heat line 6:1414).
  // Removing the layer prevents _reset from firing on it at 0×0 dimensions.
  // When the user returns to the dashboard, renderLeafletMap() → updateHeatmapLayer()
  // re-adds the layer once the container has real pixel dimensions again.
  if (!leafletMapCanvas || leafletMapCanvas.clientWidth === 0) {
    if (heatmapLayer && leafletMap && leafletMap.hasLayer(heatmapLayer)) {
      leafletMap.removeLayer(heatmapLayer);
    }
    return;
  }

  const layer = ensureHeatmapLayer();
  if (!layer || !leafletMap) return;

  if (heatmapVisible) {
    // Add the layer to the map FIRST if it isn't there yet.
    // onAdd → _initCanvas initialises layer._heat and sets layer._map, so
    // the subsequent setLatLngs → redraw() → requestAnimFrame(_redraw) call
    // fires into a valid map reference.
    if (!leafletMap.hasLayer(layer)) {
      layer.addTo(leafletMap);
    }
    // Build points from real-time spot availability.
    // intensity = occupancy rate (0 = all free/green, 1 = full/red).
    const points = spots
      .map((spot, idx) => {
        const [lat, lng] = getSpotLatLng(spot, idx);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        const total = spot.totalSpots || spot.total_spots || 1;
        const avail = spot.availableSpots ?? spot.available_spots ?? total;
        const occupancy = Math.min(1, Math.max(0, 1 - avail / total));
        return [lat, lng, occupancy];
      })
      .filter(Boolean);
    layer.setLatLngs(points);
  } else if (leafletMap.hasLayer(layer)) {
    // NEVER call setLatLngs before removeLayer.
    //
    // The bug: setLatLngs → redraw() schedules requestAnimFrame(_redraw).
    // removeLayer → Leaflet immediately sets layer._map = null.
    // On the next browser paint frame _redraw runs; its very first statement
    // is `var l = this._map.getSize()` with zero null guard (leaflet.heat
    // 0.2.0, line 11 col 1949) → "Cannot read properties of null
    // (reading 'getSize')".
    leafletMap.removeLayer(layer);
  }
}

async function fetchHeatmapData() {
  try {
    const data = await apiFetch("/api/analytics/heatmap", { auth: false });
    heatmapData = Array.isArray(data) ? data : [];
    updateHeatmapLayer();
  } catch {
    // Keep last known heatmap on transient failures.
  }
}

function setupHeatmap() {
  if (!heatmapToggle) return;
  if (!featureEnabled("heatmap") || !window.L || !window.L.heatLayer) {
    heatmapToggle.classList.add("hidden");
    return;
  }
  syncHeatmapToggleUi();
  updateHeatmapLayer();
}

// ── Server-Sent Events: real-time spot availability ──────────────────────────
let spotEventSource = null;
function initSpotStream() {
  if (spotEventSource) {
    spotEventSource.close();
  }
  const es = new EventSource("/api/spots/stream");
  spotEventSource = es;

  es.onmessage = (evt) => {
    try {
      const updates = JSON.parse(evt.data);
      if (!Array.isArray(updates)) return;
      // Merge incoming availability into the local spots array
      const byId = new Map(updates.map(u => [u.id, u]));
      spots = spots.map(s => {
        const u = byId.get(s.id);
        if (!u) return s;
        return { ...s, availableSpots: u.availableSpots, totalSpots: u.totalSpots, pricePerHour: u.pricePerHour };
      });
      renderSpots();
      renderMapView();
      updateHeatmapLayer();
    } catch { /* ignore parse errors */ }
  };

  es.onerror = () => {
    // Reconnect after 15 s on error (browser auto-reconnects, but add backoff)
    es.close();
    spotEventSource = null;
    setTimeout(initSpotStream, 15000);
  };

  window.addEventListener("beforeunload", () => es.close());
}

async function refreshMyBookings() {
  const result = await apiFetch("/api/bookings/me");
  myBookings = Array.isArray(result.bookings) ? result.bookings : [];
}

async function refreshStats() {
  const at = new Date(arrivalTime.value || Date.now()).toISOString();
  const query = new URLSearchParams({ at });
  const result = await apiFetch(`/api/stats?${query.toString()}`, { auth: false });
  adminStats = {
    total: Number(result.total || 0),
    available: Number(result.available || 0),
    todayBookings: Number(result.todayBookings || 0)
  };
}

function fillZoneOptions() {
  const current = zoneFilter.value || "all";
  zoneFilter.innerHTML = `<option value="all">${t("allZones")}</option>`;
  const zones = [...new Set(spots.map((s) => s.zone))];
  zones.forEach((zone) => {
    const option = document.createElement("option");
    option.value = zone;
    option.textContent = zone;
    zoneFilter.appendChild(option);
  });
  zoneFilter.value = zones.includes(current) || current === "all" ? current : "all";
}

function syncSessionUi() {
  if (!currentUser) {
    sessionDisplay.textContent = t("notSignedIn");
    logoutBtn.classList.add("hidden");
    topLoginBtn.classList.remove("hidden");
    adminNavLink.classList.add("hidden");
    return;
  }
  const roleLabel = currentUser.role === "admin" ? t("adminRole") : t("studentRole");
  sessionDisplay.textContent = `${currentUser.name} (${roleLabel})`;
  logoutBtn.classList.remove("hidden");
  topLoginBtn.classList.add("hidden");
  adminNavLink.classList.toggle("hidden", currentUser.role !== "admin");
}

function normalizeRoute(pathname) {
  if (pathname === "/reservations") return "/reservations";
  if (pathname === "/login") return "/login";
  if (pathname === "/admin") return "/admin";
  return "/";
}

function setupInstallExperience() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    if (!isStandaloneMode()) {
      installPrompt.classList.remove("hidden");
    }
  });

  if (shouldShowIosInstallHint()) {
    iosInstallHint.classList.remove("hidden");
  }
}

function isStandaloneMode() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function shouldShowIosInstallHint() {
  const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
  const isSafari = /safari/i.test(window.navigator.userAgent) && !/crios|fxios|edgios/i.test(window.navigator.userAgent);
  return isIos && isSafari && !isStandaloneMode();
}

async function handleInstallApp() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice.catch(() => null);
  deferredInstallPrompt = null;
  installPrompt.classList.add("hidden");
}

function dismissInstallUi() {
  installPrompt.classList.add("hidden");
  iosInstallHint.classList.add("hidden");
}

function isMobileViewport() {
  return window.innerWidth < 768;
}

function configureLeafletIcons() {
  if (!window.L || configureLeafletIcons.done) return;
  configureLeafletIcons.done = true;
  window.L.Icon.Default.imagePath = "";
  window.L.Icon.Default.mergeOptions({
    iconRetinaUrl: "/node_modules/leaflet/dist/images/marker-icon-2x.png",
    iconUrl: "/node_modules/leaflet/dist/images/marker-icon.png",
    shadowUrl: "/node_modules/leaflet/dist/images/marker-shadow.png"
  });
}

function ensureLeafletMap() {
  if (!window.L || !leafletMapCanvas) return null;
  configureLeafletIcons();

  if (!leafletMap) {
    leafletMap = window.L.map(leafletMapCanvas, {
      zoomControl: true,
      attributionControl: true
    });
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(leafletMap);
    // Use marker clustering if available, fall back to plain layerGroup
    leafletLayerGroup = window.L.markerClusterGroup
      ? window.L.markerClusterGroup({
          maxClusterRadius: 60,
          showCoverageOnHover: false,
          spiderfyOnMaxZoom: true,
          disableClusteringAtZoom: 17
        }).addTo(leafletMap)
      : window.L.layerGroup().addTo(leafletMap);
    leafletMap.setView([47.615, -122.3384], 15);
    scheduleLeafletMapResize();
  }

  return window.L;
}

function scheduleLeafletMapResize() {
  if (!leafletMap) return;
  if (leafletMapResizeTimer) {
    clearTimeout(leafletMapResizeTimer);
  }
  leafletMapResizeTimer = window.setTimeout(() => {
    // Guard: if the map container is still zero-sized (e.g. the dashboard is
    // hidden because the user navigated to /login), do NOT call invalidateSize().
    // invalidateSize() fires moveend → layer._reset() → getSize() returns {x:0}
    // → canvas.width set to 0 → _redraw() → simpleheat.draw() calls
    // ctx.getImageData(0,0,0,h) → IndexSizeError "source width is 0" (line 6:1414).
    if (!leafletMapCanvas || leafletMapCanvas.clientWidth === 0) return;
    leafletMap.invalidateSize();
    // Now that the map has real pixel dimensions, apply the heatmap layer if
    // it was previously skipped because the container was still zero-sized.
    updateHeatmapLayer();
  }, 180);
}

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

// Dynamic surge pricing based on real-time occupancy
function getSurgeFactor(spot) {
  const total = Number(spot.totalSpots || 1);
  const avail = Number(spot.availableSpots ?? total);
  const occ = 1 - avail / Math.max(total, 1);
  if (occ >= 0.92) return { factor: 2.0, label: "🔥 2× surge" };
  if (occ >= 0.82) return { factor: 1.5, label: "⚡ 1.5×" };
  if (occ >= 0.65) return { factor: 1.2, label: "↑ 1.2×" };
  return { factor: 1.0, label: null };
}

function getSurgePrice(spot) {
  const base = Number(spot.pricePerHour);
  if (!Number.isFinite(base)) return { display: "N/A", surgeLabel: null };
  const { factor, label } = getSurgeFactor(spot);
  const price = +(base * factor).toFixed(2);
  return {
    display: `$${price.toFixed(2)}/hr`,
    base: `$${base.toFixed(2)}/hr`,
    surgeLabel: label,
    isSurge: factor > 1.0,
    price
  };
}

function getSpotLatLng(spot, index) {
  const cacheKey = String(spot.id || index);
  const cached = spotLatLngCache.get(cacheKey);
  if (cached) return cached;

  const lat = Number(spot.latitude ?? spot.lat);
  const lng = Number(spot.longitude ?? spot.lng ?? spot.lon);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    const coords = [lat, lng];
    spotLatLngCache.set(cacheKey, coords);
    return coords;
  }

  const seedSource = `${spot.id || ""}${spot.name || ""}${spot.address || ""}${index}`;
  const seed = hashString(seedSource);
  const latOffset = ((seed % 1000) / 1000 - 0.5) * 0.01;
  const lngOffset = (((seed / 1000) % 1000) / 1000 - 0.5) * 0.012;
  const coords = [47.615 + latOffset, -122.3384 + lngOffset];
  spotLatLngCache.set(cacheKey, coords);
  return coords;
}

function syncViewportState() {
  const isMobile = isMobileViewport();
  if (!isMobile) {
    dashboardView.classList.remove("is-showing-list", "is-showing-map", "is-mobile");
    showListBtn.classList.remove("is-active");
    showMapBtn.classList.remove("is-active");
    scheduleLeafletMapResize();
    return;
  }

  dashboardView.classList.add("is-mobile");
  dashboardView.classList.toggle("is-showing-list", mobilePanel === "list");
  dashboardView.classList.toggle("is-showing-map", mobilePanel === "map");
  showListBtn.classList.toggle("is-active", mobilePanel === "list");
  showMapBtn.classList.toggle("is-active", mobilePanel === "map");
  if (mobilePanel === "map") {
    scheduleLeafletMapResize();
  }
}

function syncRoute(options = {}) {
  const targetRoute = normalizeRoute(window.location.pathname);
  currentRoute = targetRoute;

  if (options.replace && window.location.pathname !== targetRoute) {
    window.history.replaceState({}, "", targetRoute);
  }

  const safeRoute =
    targetRoute === "/admin" && (!currentUser || currentUser.role !== "admin")
      ? "/login"
      : targetRoute === "/reservations" && !currentUser
        ? "/login"
        : targetRoute;

  currentRoute = safeRoute;

  if (options.replace && window.location.pathname !== safeRoute) {
    window.history.replaceState({}, "", safeRoute);
  }

  loginView.classList.toggle("hidden", safeRoute !== "/login");
  dashboardView.classList.toggle("hidden", safeRoute !== "/");
  reservationsView.classList.toggle("hidden", safeRoute !== "/reservations");
  adminView.classList.toggle("hidden", safeRoute !== "/admin");
  document.body.classList.toggle("reservations-route", safeRoute === "/reservations");

  routeLinks.forEach((link) => {
    link.classList.toggle("is-active", (link.dataset.routeLink || "/") === safeRoute);
  });
}

function navigateTo(pathname) {
  const targetRoute = normalizeRoute(pathname);
  if (window.location.pathname !== targetRoute) {
    window.history.pushState({}, "", targetRoute);
  }
  syncRoute({ replace: true });
  render();
}

function render() {
  renderSpots();
  renderMapView();
  renderBookings();
  renderAdminView();
}

const adminTodayRevenue = document.getElementById("adminTodayRevenue");
let _chartHourly   = null;
let _chartZone     = null;
let _chartFunnel   = null;
let _chartDauTrend = null;

function renderAdminView() {
  if (!adminView) return;

  adminTotalCount.textContent = String(adminStats.total || 0);
  adminAvailableCount.textContent = String(adminStats.available || 0);
  adminTodayBookingCount.textContent = String(adminStats.todayBookings || 0);

  // Fetch and render revenue charts (admin only)
  if (currentUser?.role === "admin") {
    apiFetch("/api/admin/analytics").then(data => {
      if (adminTodayRevenue) {
        adminTodayRevenue.textContent = `$${Number(data.todayRevenue || 0).toFixed(2)}`;
      }
      renderAdminCharts(data);
    }).catch(() => {});

    apiFetch("/api/analytics/funnel").then(data => {
      renderFunnelChart(data.funnel);
    }).catch(() => {});

    apiFetch("/api/admin/flags").then(flags => {
      renderAdminFlags(flags);
    }).catch(() => {});

    apiFetch("/api/admin/metrics").then(m => {
      renderSessionMetrics(m);
    }).catch(() => {});
  }

  adminSpotList.innerHTML = "";

  if (!currentUser || currentUser.role !== "admin") {
    const locked = document.createElement("p");
    locked.textContent = "Admin access required.";
    adminSpotList.appendChild(locked);
    return;
  }

  spots.forEach((spot) => {
    const item = document.createElement("article");
    item.className = "booking-item card";
    const body = document.createElement("div");
    const title = document.createElement("strong");
    const details = document.createElement("p");
    const totalSpots = Number(spot.totalSpots || 0);
    const availableSpots = Number(spot.availableSpots || 0);
    title.textContent = `${spot.name || spot.id} · ${spot.zone || "Zone"}`;
    details.textContent = `${availableSpots}/${totalSpots || "?"} available · ${spot.isEV ? "EV" : "Standard"} · ${spot.address || "Address unavailable"}`;
    body.appendChild(title);
    body.appendChild(details);
    item.appendChild(body);
    adminSpotList.appendChild(item);
  });
}

function renderAdminCharts(data) {
  if (!window.Chart) return;

  const accent = "#0abab5";
  const ai = "#7c6ff7";
  const chartDefaults = {
    responsive: true,
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { color: "rgba(0,0,0,0.04)" }, ticks: { font: { size: 10 } } },
      y: { grid: { color: "rgba(0,0,0,0.06)" }, ticks: { font: { size: 10 } }, beginAtZero: true }
    }
  };

  const hourlyCanvas = document.getElementById("chartHourlyBookings");
  if (hourlyCanvas && data.hourlyBookings) {
    if (_chartHourly) _chartHourly.destroy();
    _chartHourly = new window.Chart(hourlyCanvas, {
      type: "bar",
      data: {
        labels: data.hourlyBookings.labels,
        datasets: [{
          label: "Bookings",
          data: data.hourlyBookings.data,
          backgroundColor: accent + "99",
          borderColor: accent,
          borderWidth: 1,
          borderRadius: 4
        }]
      },
      options: chartDefaults
    });
  }

  const zoneCanvas = document.getElementById("chartZoneRevenue");
  if (zoneCanvas && data.zoneRevenue?.labels?.length) {
    if (_chartZone) _chartZone.destroy();
    const colors = [accent, ai, "#f59e0b", "#10b981", "#ef4444", "#3b82f6"];
    _chartZone = new window.Chart(zoneCanvas, {
      type: "bar",
      data: {
        labels: data.zoneRevenue.labels,
        datasets: [{
          label: "Revenue ($)",
          data: data.zoneRevenue.data,
          backgroundColor: data.zoneRevenue.labels.map((_, i) => colors[i % colors.length] + "cc"),
          borderColor: data.zoneRevenue.labels.map((_, i) => colors[i % colors.length]),
          borderWidth: 1,
          borderRadius: 4
        }]
      },
      options: {
        ...chartDefaults,
        plugins: { ...chartDefaults.plugins, tooltip: {
          callbacks: { label: ctx => `$${ctx.parsed.y.toFixed(2)}` }
        }}
      }
    });
  }
}

function renderFunnelChart(funnel) {
  if (!window.Chart || !funnel?.length) return;
  const canvas = document.getElementById("chartFunnel");
  if (!canvas) return;
  if (_chartFunnel) _chartFunnel.destroy();
  const labels = funnel.map(f => f.step.replace("_", " "));
  const counts = funnel.map(f => f.count);
  const convRate = funnel.map(f => Math.round(f.conversionFromPrev * 100));
  _chartFunnel = new window.Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Events",
        data: counts,
        backgroundColor: "#0abab599",
        borderColor: "#0abab5",
        borderWidth: 1,
        borderRadius: 4,
        yAxisID: "yCount"
      }, {
        label: "Conv %",
        data: convRate,
        type: "line",
        borderColor: "#7c6ff7",
        backgroundColor: "#7c6ff720",
        pointRadius: 4,
        tension: 0.3,
        yAxisID: "yPct"
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: true, position: "top" } },
      scales: {
        yCount: { position: "left", beginAtZero: true, ticks: { font: { size: 10 } }, title: { display: true, text: "Events" } },
        yPct:   { position: "right", min: 0, max: 100, ticks: { font: { size: 10 }, callback: v => `${v}%` }, grid: { drawOnChartArea: false }, title: { display: true, text: "Conv %" } }
      }
    }
  });
}

function renderAdminFlags(flags) {
  if (!adminFlagList) return;
  adminFlagList.innerHTML = "";
  if (!flags?.length) {
    adminFlagList.innerHTML = "<p>No feature flags configured.</p>";
    return;
  }
  flags.forEach(flag => {
    const item = document.createElement("div");
    item.className = "flag-item";
    item.innerHTML = `
      <div class="flag-meta">
        <div class="flag-key">${flag.key.replace(/_/g, " ")}</div>
        ${flag.description ? `<div class="flag-desc">${flag.description}</div>` : ""}
      </div>
      <label class="flag-toggle" title="Toggle ${flag.key}">
        <input type="checkbox" ${flag.enabled ? "checked" : ""} data-flag="${flag.key}" />
        <span class="flag-toggle-track"></span>
      </label>
    `;
    const checkbox = item.querySelector("input[type=checkbox]");
    checkbox.addEventListener("change", async () => {
      try {
        await apiFetch(`/api/admin/flags/${encodeURIComponent(flag.key)}`, {
          method: "PATCH",
          body: { enabled: checkbox.checked }
        });
        // Refresh local cache
        featureFlags[flag.key] = checkbox.checked;
      } catch (err) {
        alert(err.message);
        checkbox.checked = !checkbox.checked; // revert
      }
    });
    adminFlagList.appendChild(item);
  });
}

function renderSessionMetrics(m) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set("metricDau",        m.dau);
  set("metricWau",        m.wau);
  set("metricMau",        m.mau);
  set("metricRetention",  `${m.retentionD7}%`);
  set("metricNewToday",   m.newUsersToday);
  set("metricNewWeek",    m.newUsersWeek);
  set("metricTotal",      m.totalUsers);
  set("metricBookings30", m.d30Bookings);

  if (!window.Chart || !m.dauTrend?.length) return;
  const canvas = document.getElementById("chartDauTrend");
  if (!canvas) return;
  if (_chartDauTrend) _chartDauTrend.destroy();
  _chartDauTrend = new window.Chart(canvas, {
    type: "line",
    data: {
      labels: m.dauTrend.map(d => d.date),
      datasets: [{
        label: "Bookings/day",
        data: m.dauTrend.map(d => d.bookings),
        borderColor: "#0abab5",
        backgroundColor: "#0abab520",
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: "#0abab5"
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: "rgba(0,0,0,0.04)" }, ticks: { font: { size: 10 } } },
        y: { grid: { color: "rgba(0,0,0,0.06)" }, ticks: { font: { size: 10 } }, beginAtZero: true }
      }
    }
  });
}

// ── Smart empty state ─────────────────────────────────────────────────────────
// Builds a contextual "no results" block with actionable suggestions based on
// which filters are active, whether spots exist at all, and EV filter state.
function buildEmptyState() {
  const search    = searchInput?.value.trim() || "";
  const zone      = zoneFilter?.value || "all";
  const isEVOnly  = evOnlyFilter?.checked;
  const allSpots  = spots; // full unfiltered list from last refresh

  const wrap = document.createElement("div");
  wrap.className = "empty-state";

  const suggestions = [];

  if (isEVOnly && allSpots.some(s => !s.isEV && s.isAvailable)) {
    suggestions.push({ label: "Show non-EV spots too", action: () => { evOnlyFilter.checked = false; renderSpots(); } });
  }
  if (search) {
    suggestions.push({ label: `Clear search "${search}"`, action: () => { searchInput.value = ""; refreshAll(); } });
  }
  if (zone !== "all") {
    suggestions.push({ label: `Show all zones`, action: () => { zoneFilter.value = "all"; refreshAll(); } });
  }
  if (allSpots.length === 0) {
    suggestions.push({ label: "Refresh availability", action: () => refreshAll() });
  }
  if (!suggestions.length) {
    suggestions.push({ label: "Reset all filters", action: () => {
      if (searchInput) searchInput.value = "";
      if (zoneFilter) zoneFilter.value = "all";
      if (evOnlyFilter) evOnlyFilter.checked = false;
      refreshAll();
    }});
  }

  const icon = document.createElement("div");
  icon.className = "empty-state-icon";
  icon.textContent = isEVOnly ? "⚡" : search ? "🔍" : "🅿️";

  const title = document.createElement("p");
  title.className = "empty-state-title";
  title.textContent = isEVOnly
    ? "No EV spots available right now"
    : search
      ? `No spots match "${search}"`
      : zone !== "all"
        ? `No spots available in ${zone}`
        : "No spots available";

  const hint = document.createElement("p");
  hint.className = "empty-state-hint";
  hint.textContent = "Try one of these:";

  const list = document.createElement("div");
  list.className = "empty-state-suggestions";

  suggestions.forEach(({ label, action }) => {
    const btn = document.createElement("button");
    btn.className = "empty-state-btn";
    btn.type = "button";
    btn.textContent = label;
    btn.addEventListener("click", action);
    list.appendChild(btn);
  });

  wrap.appendChild(icon);
  wrap.appendChild(title);
  wrap.appendChild(hint);
  wrap.appendChild(list);
  return wrap;
}

function renderSpots() {
  spotGrid.innerHTML = "";
  const visibleSpots = getVisibleSpots();

  if (!visibleSpots.length) {
    spotGrid.appendChild(buildEmptyState());
    return;
  }

  // Sort AI-recommended spot to the top
  const sortedSpots = aiRecommendedSpotId
    ? [
        ...visibleSpots.filter((s) => s.id === aiRecommendedSpotId),
        ...visibleSpots.filter((s) => s.id !== aiRecommendedSpotId)
      ]
    : visibleSpots;

  sortedSpots.forEach((spot) => {
    const node = spotCardTemplate.content.cloneNode(true);
    const card = node.querySelector(".spot-card");
    const idEl = node.querySelector(".spot-id");
    const evEl = node.querySelector(".spot-ev");
    const zoneEl = node.querySelector(".spot-zone");
    const demandEl = node.querySelector(".spot-demand");
    const locationEl = node.querySelector(".spot-location");
    const availabilityMetricEl = node.querySelector(".spot-metric-availability");
    const priceMetricEl = node.querySelector(".spot-metric-price");
    const statusEl = node.querySelector(".spot-status");
    const bookBtn = node.querySelector(".book-btn");
    const spotTitle = spot.name || spot.id;
    const spotAddress = spot.address || spot.location || t("unavailableAddress");
    const rawAvailability = Number(spot.availableSpots || 0);
    const surge = getSurgePrice(spot);
    const priceText = surge.display !== "N/A" ? surge.display : t("priceUnavailable");
    const statusText = spot.isAvailable
      ? `${rawAvailability} ${rawAvailability === 1 ? t("spotLeft") : t("spotsLeft")}`
      : t("fullBtn");
    const isSelected = selectedMapSpotId === spot.id;

    const isAiPick = spot.id === aiRecommendedSpotId;
    card.dataset.spotId = spot.id;
    card.classList.toggle("is-selected", isSelected);
    card.classList.toggle("is-ai-pick", isAiPick);

    idEl.innerHTML = `
      ${isAiPick ? `<div class="spot-ai-banner">🤖 AI Recommended</div>` : ""}
      <span class="spot-title-wrap">
        ${getLandmarkIconMarkup(spot)}
        <span>${spotTitle}</span>
      </span>
    `;
    evEl.classList.toggle("hidden", !spot.isEV);
    if (spot.isEV) {
      evEl.innerHTML = `
        <i data-lucide="zap"></i>
        <span>EV</span>
      `;
    } else {
      evEl.innerHTML = "";
    }
    zoneEl.textContent = spot.zone || "Zone";
    if (demandEl && featureEnabled("demand_prediction")) {
      const predicted = predictSpotsInOneHour(spot);
      const trend = predicted > rawAvailability ? "📈" : predicted < rawAvailability ? "📉" : "→";
      demandEl.classList.remove("hidden");
      demandEl.textContent = `${trend} ~${predicted} in 1hr`;
      demandEl.title = `Predicted available spots in 1 hour based on historical demand`;
    } else if (demandEl) {
      demandEl.classList.add("hidden");
    }
    locationEl.textContent = spotAddress;
    availabilityMetricEl.textContent = `${rawAvailability}/${Number(spot.totalSpots || 0) || "?"} spots`;
    // Asynchronously load and display average rating
    if (spot._avgRating !== undefined) {
      const ratingMetric = node.querySelector(".spot-metric-rating");
      if (ratingMetric && spot._avgRating) {
        ratingMetric.textContent = `★ ${spot._avgRating}`;
        ratingMetric.classList.remove("hidden");
      }
    } else {
      apiFetch(`/api/spots/${spot.id}/rating`, { auth: false }).then(r => {
        if (!r.average) return;
        spot._avgRating = r.average;
        const card2 = spotGrid.querySelector(`[data-spot-id="${spot.id}"]`);
        const el = card2?.querySelector(".spot-metric-rating");
        if (el) { el.textContent = `★ ${r.average}`; el.classList.remove("hidden"); }
      }).catch(() => {});
    }
    if (surge.isSurge && featureEnabled("surge_pricing")) {
      priceMetricEl.innerHTML = `<span class="surge-price">${surge.display}</span> <span class="surge-badge">${surge.surgeLabel}</span> <s class="surge-base">${surge.base}</s>`;
    } else {
      priceMetricEl.textContent = priceText;
    }
    statusEl.textContent = statusText;
    statusEl.classList.remove("available", "occupied");
    statusEl.classList.add(spot.isAvailable ? "available" : "occupied");
    bookBtn.disabled = !spot.isAvailable || !currentUser;
    bookBtn.textContent = !currentUser ? t("signInFirstBtn") : spot.isAvailable ? t("reserveBtn") : t("fullBtn");

    card.addEventListener("click", () => {
      selectedMapSpotId = spot.id;
      trackEvent("spot_view", spot.id);
      mobilePanel = "map";
      syncViewportState();
      renderSpots();
      renderMapView();
    });
    card.addEventListener("mouseenter", () => {
      if (selectedMapSpotId === spot.id) return;
      selectedMapSpotId = spot.id;
      renderSpots();
      renderMapView();
    });

    bookBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      selectedMapSpotId = spot.id;
      selectedSpotId = spot.id;
      dialogSpotInfo.textContent = `${spotTitle} · ${spot.zone} · ${priceText}`;
      plateInput.value = "";
      phoneInput.value = "";
      trackEvent("reserve_start", spot.id);
      dialog.showModal();
    });

    spotGrid.appendChild(card);
  });

  refreshLucideIcons();
}

function renderMapView() {
  const visibleSpots = getVisibleSpots();

  if (!visibleSpots.length) {
    selectedMapSpotId = null;
  }

  if (!selectedMapSpotId && visibleSpots.length) {
    selectedMapSpotId = visibleSpots[0].id;
  }

  const selectedSpot =
    visibleSpots.find((spot) => spot.id === selectedMapSpotId) || visibleSpots[0] || null;

  if (!selectedSpot) {
    mapDetailTitle.textContent = "No parking lots found";
    mapDetailMeta.textContent = "Adjust filters or search terms to reveal matching locations.";
    mapDetailZone.textContent = "Zone";
    mapDetailAvailability.textContent = "Availability";
    mapDetailPrice.textContent = "Price";
    mapNavigateBtn.disabled = true;
    mapReserveBtn.disabled = true;
    renderLeafletMap(visibleSpots, null);
    return;
  }

  const rawAvailability = Number(selectedSpot.availableSpots || 0);
  const mapSurge = getSurgePrice(selectedSpot);
  const priceText = mapSurge.display !== "N/A" ? mapSurge.display : "Price unavailable";
  const availabilityText = selectedSpot.isAvailable
    ? `${rawAvailability} ${rawAvailability === 1 ? "spot" : "spots"} left`
    : "Full";
  mapDetailTitle.textContent = selectedSpot.name || selectedSpot.id;
  mapDetailMeta.textContent = selectedSpot.address || "Address unavailable";
  mapDetailZone.textContent = selectedSpot.zone || "Zone unavailable";
  mapDetailAvailability.textContent = availabilityText;
  if (mapSurge.isSurge) {
    mapDetailPrice.innerHTML = `${mapSurge.display} <span class="surge-badge">${mapSurge.surgeLabel}</span>`;
  } else {
    mapDetailPrice.textContent = priceText;
  }
  mapNavigateBtn.disabled = false;
  mapReserveBtn.disabled = !selectedSpot.isAvailable || !currentUser;

  renderLeafletMap(visibleSpots, selectedSpot);
}

function renderLeafletMap(visibleSpots, selectedSpot) {
  const L = ensureLeafletMap();
  if (!L || !leafletMap || !leafletMapCanvas) {
    if (leafletMapCanvas) {
      leafletMapCanvas.classList.add("is-unavailable");
    }
    mapGrid.classList.remove("hidden");
    mapGrid.classList.remove("is-muted");
    return;
  }

  leafletMapCanvas.classList.remove("is-unavailable");
  mapGrid.classList.add("hidden");

  if (leafletLayerGroup) {
    leafletLayerGroup.clearLayers();
  }
  leafletMarkers.clear();

  const bounds = L.latLngBounds();
  let selectedLatLng = null;

  visibleSpots.slice(0, 12).forEach((spot, index) => {
    const [lat, lng] = getSpotLatLng(spot, index);
    const marker = L.marker([lat, lng], {
      title: spot.name || spot.id
    });
    const rawPrice = Number(spot.pricePerHour);
    const rawAvailability = Number(spot.availableSpots || 0);
    const priceText = Number.isFinite(rawPrice) ? `$${rawPrice.toFixed(2)}/hr` : t("priceUnavailable");
    const availabilityText = spot.isAvailable
      ? `${rawAvailability} ${rawAvailability === 1 ? t("spotLeft") : t("spotsLeft")}`
      : t("fullBtn");
    marker.bindPopup(
      `<div class="leaflet-popup"><strong>${escapeHtml(spot.name || spot.id)}</strong><div>${escapeHtml(priceText)}</div><div>${escapeHtml(availabilityText)}</div></div>`
    );
    marker.on("click", () => {
      selectedMapSpotId = spot.id;
      renderSpots();
      renderMapView();
      scrollSelectedCardIntoView();
    });
    marker.addTo(leafletLayerGroup);
    leafletMarkers.set(spot.id, marker);
    bounds.extend([lat, lng]);

    if (selectedSpot && spot.id === selectedSpot.id) {
      selectedLatLng = [lat, lng];
      marker.openPopup();
    }
  });

  if (selectedLatLng) {
    leafletMap.setView(selectedLatLng, 15);
  } else if (bounds.isValid()) {
    leafletMap.fitBounds(bounds, { padding: [40, 40] });
  }

  updateHeatmapLayer();
  scheduleLeafletMapResize();
}

function handleMapReserve() {
  const targetSpot = spots.find((spot) => spot.id === selectedMapSpotId);
  if (!targetSpot || !targetSpot.isAvailable || !currentUser) {
    return;
  }

  selectedSpotId = targetSpot.id;
  const rawPrice = Number(targetSpot.pricePerHour);
  const priceText = Number.isFinite(rawPrice) ? `$${rawPrice.toFixed(2)}/hr` : t("priceUnavailable");
  dialogSpotInfo.textContent = `${targetSpot.name || targetSpot.id} · ${targetSpot.zone} · ${priceText}`;
  plateInput.value = "";
  phoneInput.value = "";
  dialog.showModal();
}

function openNavigation(locationName, address, lat, lng) {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isMac = /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    // Use precise coordinates when available
    if (isIOS || isMac) {
      window.open(`maps://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`, "_blank");
    } else {
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`, "_blank");
    }
  } else {
    // Fall back to address text
    const dest = address && address.trim() ? address.trim() : `${locationName}, Seattle, WA`;
    if (isIOS || isMac) {
      window.open(`maps://maps.apple.com/?daddr=${encodeURIComponent(dest)}&dirflg=d`, "_blank");
    } else {
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}&travelmode=driving`, "_blank");
    }
  }
}

function handleMapNavigate() {
  const targetSpot = spots.find((spot) => spot.id === selectedMapSpotId);
  if (!targetSpot) return;
  const idx = spots.indexOf(targetSpot);
  const [lat, lng] = getSpotLatLng(targetSpot, idx);
  openNavigation(
    targetSpot.name || targetSpot.id,
    targetSpot.address || targetSpot.location || "",
    lat, lng
  );
}

function openCheckInDialog(booking) {
  selectedCheckInBookingId = booking.id;
  ticketCodeInput.value = booking.ticketCode || "";
  checkInReservationInfo.textContent = `Reservation ${booking.id.slice(0, 8)} · Space ${booking.spotId} · Enter the 6-digit paper ticket code from the garage gate.`;
  checkInDialog.showModal();
}

async function handleCheckOut(booking) {
  const confirmed = window.confirm(
    `Check out Space ${booking.spotId} and settle parking charges now?`
  );
  if (!confirmed) return;

  try {
    await apiFetch("/api/check-out", {
      method: "POST",
      body: { reservationId: booking.id }
    });
    trackEvent("check_out", booking.spotId);
    await refreshAll();
  } catch (error) {
    alert(error.message);
  }
}

function renderBookings() {
  if (!bookingList) return;

  bookingList.innerHTML = "";

  if (!currentUser) {
    const hint = document.createElement("p");
    hint.textContent = t("signInToReservations");
    bookingList.appendChild(hint);
    return;
  }

  if (!myBookings.length) {
    const empty = document.createElement("p");
    empty.textContent = t("noReservationsYet");
    bookingList.appendChild(empty);
    return;
  }

  myBookings.forEach((booking) => {
    const node = bookingTemplate.content.cloneNode(true);
    const statusEl = node.querySelector(".booking-status");
    const ticketEl = node.querySelector(".booking-ticket");
    const settlementEl = node.querySelector(".booking-settlement");
    const checkInBtn = node.querySelector(".checkin-btn");
    const checkOutBtn = node.querySelector(".checkout-btn");
    node.querySelector(".booking-spot").textContent = `Space ${booking.spotId}`;
    statusEl.textContent = booking.status;
    statusEl.classList.toggle("is-pending", booking.status === "PENDING");
    statusEl.classList.toggle("is-active", booking.status === "ACTIVE");
    statusEl.classList.toggle("is-completed", booking.status === "COMPLETED");
    node.querySelector(".booking-time").textContent = `${fmtDate(booking.startTime)} - ${fmtDate(booking.endTime)}`;
    node.querySelector(".booking-plate").textContent = `${t("platePhone")} ${booking.plate} / ${t("phoneNumber")}: ${booking.phone}`;
    node.querySelector(".booking-owner").textContent = `${t("bookingOwner")} ${booking.ownerName}`;

    const qrCanvas = node.querySelector(".booking-qr");
    if (booking.ticketCode) {
      const checkInText = booking.checkInTime ? fmtDate(booking.checkInTime) : "Just now";
      ticketEl.textContent = `Ticket ${booking.ticketCode} · Checked in ${checkInText}`;
      ticketEl.classList.remove("hidden");
      // Generate QR code for the ticket code
      if (qrCanvas && window.QRCode) {
        window.QRCode.toCanvas(qrCanvas, booking.ticketCode, { width: 100, margin: 1, color: { dark: "#0f1923", light: "#ffffff" } }, () => {});
        qrCanvas.classList.remove("hidden");
      }
    } else {
      ticketEl.classList.add("hidden");
      if (qrCanvas) qrCanvas.classList.add("hidden");
    }

    // Countdown timer
    const countdownEl = node.querySelector(".booking-countdown");
    if (countdownEl) {
      if (booking.status === "PENDING" && booking.createdAt) {
        // PENDING expires 5 min after creation
        const expiresAt = new Date(booking.createdAt).getTime() + 5 * 60 * 1000;
        countdownEl.dataset.countdownTarget = String(expiresAt);
        countdownEl.dataset.countdownLabel = "Expires";
        countdownEl.classList.remove("hidden");
      } else if (booking.status === "ACTIVE" && booking.endTime) {
        const endsAt = new Date(booking.endTime).getTime();
        countdownEl.dataset.countdownTarget = String(endsAt);
        countdownEl.dataset.countdownLabel = "Ends";
        countdownEl.classList.remove("hidden");
      } else {
        countdownEl.classList.add("hidden");
      }
    }

    if (booking.status === "PENDING") {
      checkInBtn.classList.remove("hidden");
      checkInBtn.addEventListener("click", () => openCheckInDialog(booking));
    } else {
      checkInBtn.classList.add("hidden");
    }

    if (booking.status === "ACTIVE") {
      checkOutBtn.classList.remove("hidden");
      checkOutBtn.addEventListener("click", () => handleCheckOut(booking));
    } else {
      checkOutBtn.classList.add("hidden");
    }

    if (booking.status === "COMPLETED" && booking.finalAmount !== null) {
      const checkOutText = booking.checkOutTime ? fmtDate(booking.checkOutTime) : "recently";
      settlementEl.textContent = `Settled at $${Number(booking.finalAmount).toFixed(2)} · Checked out ${checkOutText}`;
      settlementEl.classList.remove("hidden");
    } else {
      settlementEl.classList.add("hidden");
    }

    // Star rating for completed bookings
    const ratingEl = node.querySelector(".booking-rating");
    if (ratingEl && booking.status === "COMPLETED") {
      ratingEl.classList.remove("hidden");
      const stars = ratingEl.querySelectorAll(".star-btn");
      let selectedStars = 0;
      const paintStars = (n) => stars.forEach((s, i) => s.classList.toggle("filled", i < n));
      stars.forEach(btn => {
        btn.addEventListener("mouseover", () => paintStars(Number(btn.dataset.star)));
        btn.addEventListener("mouseout", () => paintStars(selectedStars));
        btn.addEventListener("click", async () => {
          const val = Number(btn.dataset.star);
          selectedStars = val;
          paintStars(val);
          ratingEl.querySelector(".rating-prompt").textContent = `Thanks for rating ${"★".repeat(val)}`;
          try {
            await apiFetch(`/api/spots/${booking.spotId}/rate`, {
              method: "POST",
              body: { stars: val, reservationId: booking.id }
            });
          } catch { /* silent — rating is best-effort */ }
        });
      });
    }

    const cancelBtn = node.querySelector(".cancel-btn");
    cancelBtn.classList.toggle("hidden", booking.status === "COMPLETED");
    cancelBtn.addEventListener("click", async () => {
      try {
        await apiFetch(`/api/bookings/${booking.id}`, { method: "DELETE" });
        await refreshAll();
      } catch (error) {
        alert(error.message);
      }
    });

    bookingList.appendChild(node);
  });

  // Start live countdown tickers for all visible countdown elements
  startCountdownTimers();
}

let countdownInterval = null;
function startCountdownTimers() {
  if (countdownInterval) clearInterval(countdownInterval);

  function tick() {
    const now = Date.now();
    document.querySelectorAll(".booking-countdown[data-countdown-target]").forEach(el => {
      const target = Number(el.dataset.countdownTarget);
      const label = el.dataset.countdownLabel || "Ends";
      const diffMs = target - now;
      if (diffMs <= 0) {
        el.textContent = `${label}: expired`;
        el.classList.add("countdown-expired");
        el.classList.remove("countdown-urgent");
        return;
      }
      const totalSec = Math.floor(diffMs / 1000);
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      const display = h > 0
        ? `${h}h ${String(m).padStart(2, "0")}m`
        : `${m}:${String(s).padStart(2, "0")}`;
      el.textContent = `${label} in ${display}`;
      el.classList.toggle("countdown-urgent", diffMs < 2 * 60 * 1000);
    });
  }

  tick(); // immediate first paint
  countdownInterval = setInterval(tick, 1000);
}

async function recommendSpot(options = {}) {
  aiRecommendedSpotId = null; // clear AI pin on regular search
  try {
    const query = new URLSearchParams();
    const zone = zoneFilter.value || "all";
    const search = searchInput.value.trim();
    const silent = Boolean(options.silent);

    if (zone && zone !== "all") {
      query.set("zone", zone);
    }
    if (search) {
      query.set("search", search);
    }

    const center = leafletMap ? leafletMap.getCenter() : { lat: 47.615, lng: -122.3384 };
    query.set("lat", center.lat.toFixed(6));
    query.set("lng", center.lng.toFixed(6));

    const result = await apiFetch(`/api/recommend?${query.toString()}`, { auth: false });
    const recommended = Array.isArray(result.data) ? result.data : [];

    if (!recommended.length) {
      spots = [];
      renderSpots();
      renderMapView();
      if (!silent) {
        alert(t("noSearchResults"));
      }
      return;
    }

    spots = recommended.map((spot) => ({
      ...spot,
      isAvailable: spot.status === "active" && Number(spot.availableSpots || 0) > 0,
      booked: !(spot.status === "active" && Number(spot.availableSpots || 0) > 0)
    }));
    selectedMapSpotId = spots[0]?.id || null;
    renderSpots();
    renderMapView();

    const best = spots[0];
    if (!silent) {
      alert(`${t("reserveRecommendation")} ${best.name || best.id} (${best.zone})`);
    }
  } catch (error) {
    if (!options.silent) {
      alert(error.message);
    } else {
      console.error("Live search failed:", error);
    }
  }
}

// ── AI En-route Parking Recommendation ─────────────────────────────────────

// Normalise the departure input: bare US ZIP codes get ", WA, USA" appended so
// Nominatim resolves them unambiguously instead of returning random world results.
function normaliseAddressInput(raw) {
  const trimmed = raw.trim();
  // Match 5-digit or ZIP+4 (e.g. 98006 or 98006-1234)
  if (/^\d{5}(-\d{4})?$/.test(trimmed)) {
    return `${trimmed}, WA, USA`;
  }
  return trimmed;
}

// ── Address autocomplete ──────────────────────────────────────────────────────
const addressSuggestions = document.getElementById("addressSuggestions");

async function fetchAndShowSuggestions(query) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&countrycodes=us`;
    const res = await fetch(url, { headers: { "User-Agent": "CampusPark/1.0 (campus-parking-app)" } });
    if (!res.ok) return;
    const results = await res.json();
    renderAddressSuggestions(results);
  } catch { /* network issue — silently skip */ }
}

function renderAddressSuggestions(results) {
  if (!addressSuggestions) return;
  if (!results.length) { hideAddressSuggestions(); return; }
  addressSuggestions.innerHTML = "";
  results.forEach((r, idx) => {
    const btn = document.createElement("button");
    btn.className = "autocomplete-item";
    btn.type = "button";
    btn.textContent = r.display_name;
    btn.tabIndex = 0;
    btn.addEventListener("mousedown", (e) => e.preventDefault()); // prevent blur before click
    btn.addEventListener("click", () => {
      if (departureInput) departureInput.value = r.display_name;
      hideAddressSuggestions();
      departureInput?.focus();
    });
    btn.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); results[idx + 1] && btn.nextElementSibling?.focus(); }
      if (e.key === "ArrowUp") { e.preventDefault(); idx === 0 ? departureInput?.focus() : btn.previousElementSibling?.focus(); }
      if (e.key === "Escape") { hideAddressSuggestions(); departureInput?.focus(); }
    });
    addressSuggestions.appendChild(btn);
  });
  addressSuggestions.hidden = false;
}

function hideAddressSuggestions() {
  if (addressSuggestions) addressSuggestions.hidden = true;
}

async function geocodeAddress(address) {
  const query = normaliseAddressInput(address);
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=us`;
  const res = await fetch(url, {
    headers: { "User-Agent": "CampusPark/1.0 (campus-parking-app)" }
  });
  if (!res.ok) throw new Error("Geocoding request failed. Please try again.");
  const data = await res.json();
  if (!data || !data.length) throw new Error(`Could not locate "${address}". Try a full address or valid ZIP code.`);
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), name: data[0].display_name };
}

function clearRoutePolyline() {
  if (routePolylineLayer && leafletMap) {
    try { leafletMap.removeLayer(routePolylineLayer); } catch (_) {}
    routePolylineLayer = null;
  }
}

function renderAiResults(results, fromName) {
  if (!aiResultPanel) return;

  if (!results || !results.length) {
    aiResultPanel.innerHTML = `<p class="ai-empty">No available parking spots found along this route.</p>`;
    aiResultPanel.classList.remove("hidden");
    return;
  }

  const best = results[0];
  const fmtDist = (m) => m < 1000 ? `${m}\u202fm` : `${(m / 1000).toFixed(1)}\u202fkm`;
  const fmtPrice = (p) => Number.isFinite(Number(p)) ? `$${Number(p).toFixed(2)}/hr` : null;
  const onRouteBadge = best.onRoute
    ? `<span class="ai-tag ai-tag-green">On your route</span>`
    : `<span class="ai-tag ai-tag-amber">${fmtDist(best.distM)} from route</span>`;

  const altRows = results.slice(1).map((s) => `
    <div class="ai-alt-row">
      <span class="ai-alt-name">${escapeHtml(s.name || s.id)}</span>
      <span class="ai-alt-meta">${s.available} spots · ${fmtDist(s.distM)}</span>
      <button class="ai-alt-select" type="button" onclick="selectAiSpot('${escapeHtml(s.id)}')">Select</button>
    </div>`).join("");

  aiResultPanel.innerHTML = `
    <div class="ai-result-card">
      <div class="ai-result-badge">🤖 AI Recommended</div>
      <h3 class="ai-result-name">${escapeHtml(best.name || best.id)}</h3>
      <p class="ai-result-addr">${escapeHtml(best.address || "Address unavailable")}</p>
      <div class="ai-result-tags">
        ${onRouteBadge}
        <span class="ai-tag ai-tag-blue">${best.available} spot${best.available === 1 ? "" : "s"} free</span>
        <span class="ai-tag">${escapeHtml(best.zone || "Zone N/A")}</span>
        ${fmtPrice(best.pricePerHour) ? `<span class="ai-tag">${fmtPrice(best.pricePerHour)}</span>` : ""}
      </div>
      ${altRows ? `<details class="ai-alts"><summary>${results.length - 1} alternative${results.length > 2 ? "s" : ""}</summary>${altRows}</details>` : ""}
      <button class="btn-primary ai-reserve-cta" type="button"
        onclick="selectAiSpot('${escapeHtml(best.id)}')">
        Reserve This Spot
      </button>
    </div>`;
  aiResultPanel.classList.remove("hidden");
}

async function handleAiRecommend() {
  const address = departureInput?.value?.trim();
  if (!address) {
    departureInput?.focus();
    return;
  }

  if (aiRecommendBtn) {
    aiRecommendBtn.disabled = true;
    aiRecommendBtn.textContent = "Finding…";
  }
  if (aiResultPanel) aiResultPanel.classList.add("hidden");

  try {
    // 1. Geocode departure address via Nominatim
    const from = await geocodeAddress(address);

    // 2. Call AI recommendation endpoint
    const params = new URLSearchParams({
      fromLat: from.lat.toFixed(6),
      fromLng: from.lng.toFixed(6)
    });
    const data = await apiFetch(`/api/recommend-enroute?${params}`, { auth: false });

    // 3. Draw route polyline on Leaflet map
    clearRoutePolyline();
    const L = window.L;
    if (L && leafletMap && data.route?.coordinates?.length) {
      const latlngs = data.route.coordinates.map(([lng, lat]) => [lat, lng]);
      routePolylineLayer = L.polyline(latlngs, {
        color: "#0abab5",
        weight: 5,
        opacity: 0.85,
        dashArray: "10, 6"
      }).addTo(leafletMap);
      // Zoom map to fit the route
      try { leafletMap.fitBounds(routePolylineLayer.getBounds(), { padding: [48, 48] }); } catch (_) {}
    }

    // 4. Render recommendation card
    renderAiResults(data.results, from.name);

    // 5. Highlight best spot on map, pin to top of list
    if (data.results?.length) {
      aiRecommendedSpotId = data.results[0].id;
      selectedMapSpotId = data.results[0].id;
      renderSpots();
      renderMapView();
      scrollSelectedCardIntoView();
    }
  } catch (err) {
    if (aiResultPanel) {
      aiResultPanel.innerHTML = `<p class="ai-empty ai-error-msg">⚠️ ${escapeHtml(err.message)}</p>`;
      aiResultPanel.classList.remove("hidden");
    }
  } finally {
    if (aiRecommendBtn) {
      aiRecommendBtn.disabled = false;
      aiRecommendBtn.textContent = "Find Parking";
    }
  }
}

// Called from inline onclick in AI result card HTML
window.selectAiSpot = function selectAiSpot(spotId) {
  selectedMapSpotId = spotId;
  renderSpots();
  renderMapView();
  scrollSelectedCardIntoView();
};

// ── end AI section ──────────────────────────────────────────────────────────

function getVisibleSpots() {
  if (!evOnlyFilter.checked) return spots;
  return spots.filter((spot) => spot.isEV && spot.isAvailable);
}

function scrollSelectedCardIntoView() {
  if (!selectedMapSpotId) return;
  const selectedCard = spotGrid.querySelector(`[data-spot-id="${CSS.escape(selectedMapSpotId)}"]`);
  if (!selectedCard) return;
  selectedCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function handleLogin() {
  clearUsernameError();
  clearPasswordError();
  clearAuthError();
  clearAuthSuccess();
  const name = userNameInput.value.trim();
  const password = passwordInput.value;
  if (!name) {
    showUsernameError(t("enterUsername"));
    return;
  }
  if (!password) {
    showPasswordError(t("enterPassword"));
    return;
  }
  try {
    const result = await apiFetch("/api/auth/login", {
      method: "POST",
      body: { name, password },
      auth: false
    });
    authToken = result.token;
    localStorage.setItem(TOKEN_KEY, authToken);
    currentUser = result.user;
    passwordInput.value = "";
    syncSessionUi();
    await refreshAll();
    navigateTo(currentUser.role === "admin" ? "/admin" : "/");
    // Ask for notification permission after successful login (natural moment)
    requestNotificationPermission();
  } catch (error) {
    showAuthError(error.message);
  }
}

async function handleRegister() {
  clearUsernameError();
  clearPasswordError();
  clearAuthError();
  clearAuthSuccess();
  const name = userNameInput.value.trim();
  const password = passwordInput.value;
  if (!name) {
    showUsernameError(t("enterUsername"));
    return;
  }
  if (password.length < 6) {
    showPasswordError("Password must be at least 6 characters.");
    return;
  }
  try {
    await apiFetch("/api/signup", {
      method: "POST",
      body: { name, password },
      auth: false
    });
    showAuthSuccess(t("accountCreated"));
    await handleLogin();
  } catch (error) {
    if (error.status === 409) {
      showUsernameError(error.message);
      return;
    }
    showAuthError(error.message);
  }
}

async function handleLogout() {
  try {
    if (authToken) {
      await apiFetch("/api/auth/logout", { method: "POST" });
    }
  } catch {}
  clearToken();
  currentUser = null;
  userNameInput.value = "";
  passwordInput.value = "";
  syncSessionUi();
  await refreshAll();
  navigateTo("/");
}

async function handleConfirmBooking(event) {
  event.preventDefault();
  if (!currentUser) {
    alert("Please sign in first.");
    return;
  }
  if (!selectedSpotId) return;

  const plate = plateInput.value.trim().toUpperCase();
  const phone = phoneInput.value.trim();
  const startTime = new Date(arrivalTime.value);
  const durationHours = Number(duration.value);

  if (!plate || !/^[A-Z0-9]{2,8}$/.test(plate)) {
    alert("Invalid licence plate. Use 2–8 letters/digits (e.g., ABC1234).");
    return;
  }
  if (!isValidDate(startTime)) {
    alert("Please select a valid arrival time.");
    return;
  }
  if (!isPhoneValid(phone)) {
    alert(
      "Invalid phone format. Please enter a 10-digit number (e.g., 123-456-7890 or 1234567890)"
    );
    return;
  }

  // Generate a stable idempotency key for this booking attempt so network
  // retries replaying the same request never create a duplicate reservation.
  const bookingIdempotencyKey = generateIdempotencyKey();
  try {
    const booking = await apiFetch("/api/bookings", {
      method: "POST",
      idempotencyKey: bookingIdempotencyKey,
      body: {
        spotId: selectedSpotId,
        plate,
        phone,
        startTime: startTime.toISOString(),
        durationHours
      }
    });
    dialog.close();
    trackEvent("reserve_complete", selectedSpotId, { plate });
    await refreshAll();
    // Schedule local notification: warn 1 min before 5-min PENDING expiry
    scheduleLocalNotification(
      "⏰ Reservation Expiring",
      `Your reservation for ${plate} expires in 1 minute — check in now!`,
      4 * 60 * 1000  // 4 minutes after booking creation
    );
  } catch (error) {
    alert(error.message);
  }
}

// ── Local notification scheduling ────────────────────────────────────────────
async function requestNotificationPermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

const notifTimers = new Set();
async function scheduleLocalNotification(title, body, delayMs) {
  const granted = await requestNotificationPermission();
  if (!granted) return;
  const id = setTimeout(() => {
    notifTimers.delete(id);
    if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then(reg => {
        reg.showNotification(title, { body, icon: "/icons/icon-192.png", tag: "campuspark-alert" });
      });
    } else {
      new Notification(title, { body });
    }
  }, delayMs);
  notifTimers.add(id);
}

async function handleConfirmCheckIn(event) {
  event.preventDefault();

  if (!currentUser) {
    alert("Please sign in first.");
    return;
  }

  if (!selectedCheckInBookingId) {
    alert("Select a reservation to check in.");
    return;
  }

  const ticketCode = ticketCodeInput.value.trim();
  if (!/^\d{6}$/.test(ticketCode)) {
    alert("Please enter a valid 6-digit ticket code.");
    return;
  }

  try {
    await apiFetch("/api/check-in", {
      method: "POST",
      body: {
        reservationId: selectedCheckInBookingId,
        ticketCode
      }
    });
    const checkedInBooking = myBookings.find(b => b.id === selectedCheckInBookingId);
    if (checkedInBooking) trackEvent("check_in", checkedInBooking.spotId);
    checkInDialog.close();
    selectedCheckInBookingId = null;
    await refreshAll();
    if (currentRoute !== "/reservations") {
      navigateTo("/reservations");
    }
  } catch (error) {
    alert(error.message);
  }
}

function generateIdempotencyKey() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

async function apiFetch(path, options = {}) {
  const method = options.method || "GET";
  const headers = { "Content-Type": "application/json" };
  if (options.auth !== false) {
    Object.assign(headers, authHeaders());
  }
  // Auto-attach idempotency key for mutating requests to prevent double-submit
  if ((method === "POST" || method === "PUT" || method === "PATCH") && !options.skipIdempotency) {
    headers["Idempotency-Key"] = options.idempotencyKey || generateIdempotencyKey();
  }
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
  } catch {
    throw new Error("Network error — please check your connection and try again.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || data.error || "Request failed");
    error.status = response.status;
    throw error;
  }
  return data;
}

function showUsernameError(message) {
  userNameInput.classList.add("input-error");
  userNameError.textContent = message;
  userNameError.classList.remove("hidden");
}

function clearUsernameError() {
  userNameInput.classList.remove("input-error");
  userNameError.textContent = "";
  userNameError.classList.add("hidden");
}

function showPasswordError(message) {
  passwordInput.classList.add("input-error");
  passwordError.textContent = message;
  passwordError.classList.remove("hidden");
}

function clearPasswordError() {
  passwordInput.classList.remove("input-error");
  passwordError.textContent = "";
  passwordError.classList.add("hidden");
}

function showAuthSuccess(message) {
  authSuccessMessage.textContent = message;
  authSuccessMessage.classList.remove("hidden");
}

function clearAuthSuccess() {
  authSuccessMessage.textContent = "";
  authSuccessMessage.classList.add("hidden");
}

function showAuthError(message) {
  authErrorMessage.textContent = message;
  authErrorMessage.classList.remove("hidden");
}

function clearAuthError() {
  authErrorMessage.textContent = "";
  authErrorMessage.classList.add("hidden");
}

function t(key) {
  return i18n[currentLang]?.[key] || i18n.en[key] || key;
}

function applyTranslations() {
  document.documentElement.lang = currentLang;
  if (langSwitcher) {
    langSwitcher.value = currentLang;
  }

  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const key = element.dataset.i18n;
    element.textContent = t(key);
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    const key = element.dataset.i18nPlaceholder;
    element.placeholder = t(key);
  });
}

function setLanguage(lang) {
  currentLang = i18n[lang] ? lang : "en";
  localStorage.setItem(LANG_KEY, currentLang);
  applyTranslations();
  fillZoneOptions();
  syncSessionUi();
  render();
}

function initI18n() {
  applyTranslations();
}

function authHeaders() {
  if (!authToken) return {};
  return { Authorization: `Bearer ${authToken}` };
}

function clearToken() {
  authToken = "";
  localStorage.removeItem(TOKEN_KEY);
}

function getLandmarkIconMarkup(spot) {
  const name = String(spot.name || "");
  if (name.includes("Spheres")) {
    return '<i class="spot-landmark-icon" data-lucide="globe-2"></i>';
  }
  if (name.includes("NEU Campus") || name.includes("NEU")) {
    return '<i class="spot-landmark-icon" data-lucide="graduation-cap"></i>';
  }
  return "";
}

function refreshLucideIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toLocalInput(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${h}:${min}`;
}

function fmtDate(isoString) {
  const d = new Date(isoString);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}

function isValidDate(date) {
  return date instanceof Date && !Number.isNaN(date.getTime());
}

function isPhoneValid(phone) {
  return /^(?:\d{10}|\d{3}-\d{3}-\d{4}|\(\d{3}\)\s?\d{3}-\d{4}|\d{3}\s\d{3}\s\d{4})$/.test(
    phone.trim()
  );
}
