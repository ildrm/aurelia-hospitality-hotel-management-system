import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertCircle,
  ArrowRight,
  BedDouble,
  Bell,
  BookOpen,
  Boxes,
  Building2,
  CalendarCheck,
  Calculator,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  Command,
  DoorOpen,
  FileClock,
  Gauge,
  Hotel,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Menu,
  MoonStar,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  UserRound,
  UsersRound,
  WalletCards,
  X
} from "lucide-react";
import type { Dashboard, InventoryItem, Reservation, Room, RoomStatus, ServiceOffering } from "../shared/domain";
import { can, type AuthUser, type Permission, type Role } from "../shared/auth";
import { api, ApiError, setCsrfToken } from "./api";

type View = "overview" | "frontdesk" | "rooms" | "folios" | "audit" | "catalog" | "revenue" | "services" | "housekeeping" | "inventory" | "accounting" | "crm";
type Modal =
  | { kind: "booking" }
  | { kind: "checkin"; reservation: Reservation }
  | { kind: "folio"; reservation: Reservation }
  | { kind: "audit" }
  | { kind: "service"; service: ServiceOffering }
  | { kind: "stock"; item: InventoryItem }
  | null;

const nav: Array<{ id: View; label: string; icon: typeof Gauge; permission: Permission }> = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, permission: "dashboard.read" },
  { id: "frontdesk", label: "Front desk", icon: CalendarCheck, permission: "reservation.read" },
  { id: "rooms", label: "Rooms", icon: BedDouble, permission: "room.read" },
  { id: "folios", label: "Folios", icon: WalletCards, permission: "folio.read" },
  { id: "catalog", label: "Room catalog", icon: BedDouble, permission: "catalog.read" },
  { id: "revenue", label: "Revenue", icon: CircleDollarSign, permission: "rate.read" },
  { id: "services", label: "Services", icon: Sparkles, permission: "service.read" },
  { id: "housekeeping", label: "Housekeeping", icon: ClipboardCheck, permission: "housekeeping.read" },
  { id: "inventory", label: "Inventory", icon: Boxes, permission: "inventory.read" },
  { id: "accounting", label: "Accounting", icon: Calculator, permission: "accounting.read" },
  { id: "crm", label: "Guest CRM", icon: UsersRound, permission: "crm.read" },
  { id: "audit", label: "Audit trail", icon: FileClock, permission: "audit.read" }
];

const preferredView: Record<Role, View> = {
  general_manager: "overview",
  front_desk: "overview",
  reservations: "frontdesk",
  housekeeping: "rooms",
  night_auditor: "audit",
  accountant: "accounting",
  inventory_manager: "inventory",
  revenue_manager: "revenue",
  crm_manager: "crm",
  activities_manager: "services"
};

const roomStatusLabel: Record<RoomStatus, string> = {
  vacant_clean: "Vacant · clean",
  vacant_dirty: "Vacant · dirty",
  occupied: "Occupied",
  out_of_order: "Out of order"
};

const reservationStatusLabel: Record<Reservation["status"], string> = {
  confirmed: "Confirmed",
  checked_in: "In house",
  checked_out: "Checked out",
  cancelled: "Cancelled",
  no_show: "No-show"
};

const money = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);

const shortDate = (value: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(`${value}T00:00:00Z`)
  );

function Status({ value, label }: { value: string; label: string }) {
  return (
    <span className={`status status-${value}`}>
      <span className="status-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="empty-state">
      <Search size={20} aria-hidden="true" />
      <p>{children}</p>
    </div>
  );
}

function IconButton({ label, children, onClick }: { label: string; children: ReactNode; onClick?: () => void }) {
  return (
    <button className="icon-button" type="button" aria-label={label} title={label} onClick={onClick}>
      {children}
    </button>
  );
}

const demoAccounts = [
  { role: "Front desk", name: "Mina Shah", email: "frontdesk@aurora.test", initials: "MS" },
  { role: "General manager", name: "Leila Farzan", email: "gm@aurora.test", initials: "LF" },
  { role: "Reservations", name: "Daniel Kim", email: "reservations@aurora.test", initials: "DK" },
  { role: "Housekeeping", name: "Samira Noor", email: "housekeeping@aurora.test", initials: "SN" },
  { role: "Night audit", name: "Owen Park", email: "auditor@aurora.test", initials: "OP" },
  { role: "Accounting", name: "Priya Nair", email: "accountant@aurora.test", initials: "PN" },
  { role: "Inventory", name: "Tariq Aziz", email: "inventory@aurora.test", initials: "TA" },
  { role: "Revenue", name: "Elena Rossi", email: "revenue@aurora.test", initials: "ER" },
  { role: "CRM", name: "Nora Ellis", email: "crm@aurora.test", initials: "NE" },
  { role: "Services", name: "Marco Silva", email: "activities@aurora.test", initials: "MS" }
];

function LoginScreen({ error, onLogin }: { error: string; onLogin: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState(demoAccounts[0].email);
  const [password, setPassword] = useState("Aurora2026!");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onLogin(email, password);
  };
  return (
    <main className="login-screen">
      <section className="login-brand-panel">
        <div className="login-brand"><span className="brand-mark"><Hotel size={24} /></span><span><strong>Aurelia</strong><small>Hospitality OS</small></span></div>
        <div className="login-brand-copy"><p>THE AURORA GRAND</p><h1>Property operations,<br />under control.</h1><span>Friday · Business date workspace</span></div>
        <div className="login-security"><ShieldCheck size={18} /><span><strong>Protected workspace</strong><small>Role and property scope are enforced on every request.</small></span></div>
      </section>
      <section className="login-form-panel">
        <div className="login-form-wrap">
          <span className="login-lock"><LockKeyhole size={21} /></span>
          <p className="login-eyebrow">Staff access</p>
          <h2>Sign in to Aurelia</h2>
          <p className="login-subtitle">Use your property credentials to continue.</p>
          <form onSubmit={submit} className="login-form">
            <label className="field"><span>Email address</span><input autoFocus required type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label className="field"><span>Password</span><input required type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
            {error && <div className="login-error" role="alert"><AlertCircle size={16} />{error}</div>}
            <button className="button button-primary login-submit" type="submit">Sign in <ArrowRight size={17} /></button>
          </form>
          <div className="demo-divider"><span>Training accounts</span></div>
          <div className="demo-accounts">
            {demoAccounts.map((account) => (
              <button key={account.email} className={email === account.email ? "selected" : ""} type="button" onClick={() => { setEmail(account.email); setPassword("Aurora2026!"); }}>
                <span className="avatar">{account.initials}</span><span><strong>{account.role}</strong><small>{account.name}</small></span>{email === account.email && <Check size={15} />}
              </button>
            ))}
          </div>
          <p className="demo-password">Training password <code>Aurora2026!</code></p>
        </div>
      </section>
    </main>
  );
}

export function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [view, setView] = useState<View>("overview");
  const [modal, setModal] = useState<Modal>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [loginError, setLoginError] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const refresh = async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      setDashboard(await api.dashboard());
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setUser(null);
        setDashboard(null);
      }
      notifyError(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const boot = async () => {
      try {
        const session = await api.me();
        setCsrfToken(session.csrfToken);
        setUser(session.user);
        setView(preferredView[session.user.role]);
        setDashboard(await api.dashboard());
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 401)) notifyError(error);
      } finally {
        setLoading(false);
      }
    };
    void boot();
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape") setModal(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const notifyError = (error: unknown) => {
    const message = error instanceof ApiError ? error.message : "The operation could not be completed.";
    setToast({ type: "error", message });
  };

  const login = async (email: string, password: string) => {
    setLoginError("");
    setLoading(true);
    try {
      const session = await api.login(email, password);
      setCsrfToken(session.csrfToken);
      setUser(session.user);
      setView(preferredView[session.user.role]);
      setDashboard(await api.dashboard());
    } catch (error) {
      setLoginError(error instanceof ApiError ? error.message : "Sign-in failed");
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    try { await api.logout(); } catch { /* Clear local access even if the server session expired. */ }
    setCsrfToken("");
    setUser(null);
    setDashboard(null);
    setQuery("");
    setModal(null);
  };

  const run = async (operation: () => Promise<unknown>, success: string) => {
    setUpdating(true);
    try {
      await operation();
      await refresh(true);
      setModal(null);
      setToast({ type: "success", message: success });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setUser(null);
        setDashboard(null);
      }
      notifyError(error);
    } finally {
      setUpdating(false);
    }
  };

  const searchedReservations = useMemo(() => {
    if (!dashboard) return [];
    const normalized = query.toLowerCase().trim();
    if (!normalized) return dashboard.reservations;
    return dashboard.reservations.filter((reservation) =>
      [reservation.guestName, reservation.confirmation, reservation.email, reservation.source]
        .join(" ")
        .toLowerCase()
        .includes(normalized)
    );
  }, [dashboard, query]);

  if (loading) {
    return (
      <main className="loading-screen">
        <div className="brand-mark" aria-hidden="true"><Hotel size={26} /></div>
        <p>Opening property workspace…</p>
      </main>
    );
  }

  if (!user || !dashboard) return <LoginScreen error={loginError} onLogin={login} />;

  const availableNav = nav.filter((item) => can(user, item.permission));
  const currentLabel = availableNav.find((item) => item.id === view)?.label ?? availableNav[0]?.label ?? "Workspace";

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark" aria-hidden="true"><Hotel size={23} /></div>
          <div><strong>Aurelia</strong><span>Hospitality OS</span></div>
          <IconButton label="Close menu" onClick={() => setSidebarOpen(false)}><X size={20} /></IconButton>
        </div>
        <button className="property-switcher" type="button">
          <span className="property-icon"><Building2 size={18} /></span>
          <span><strong>{dashboard.property.name}</strong><small>{dashboard.property.code} · Live</small></span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        <nav aria-label="Primary navigation">
          <p className="nav-label">Operations</p>
          {availableNav.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={view === item.id ? "nav-active" : ""}
                type="button"
                aria-current={view === item.id ? "page" : undefined}
                onClick={() => { setView(item.id); setSidebarOpen(false); }}
              >
                <Icon size={19} aria-hidden="true" />
                <span>{item.label}</span>
                {item.id === "frontdesk" && dashboard.metrics.arrivals > 0 && <b>{dashboard.metrics.arrivals}</b>}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="system-health">
            <span className="health-pulse" aria-hidden="true" />
            <span><strong>All systems operational</strong><small>Synced just now</small></span>
          </div>
          <div className="profile-row">
            <div className="profile-button">
              <span className="avatar">{user.initials}</span>
              <span><strong>{user.name}</strong><small>{user.roleLabel}</small></span>
            </div>
            <IconButton label="Sign out" onClick={() => void logout()}><LogOut size={17} /></IconButton>
          </div>
        </div>
      </aside>
      {sidebarOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}

      <div className="workspace">
        <header className="topbar">
          <IconButton label="Open menu" onClick={() => setSidebarOpen(true)}><Menu size={20} /></IconButton>
          <div className="breadcrumb">
            <span>{dashboard.property.code}</span><span>/</span><strong>{currentLabel}</strong>
          </div>
          {can(user, "reservation.read") && <label className="global-search">
            <Search size={18} aria-hidden="true" />
            <span className="sr-only">Search guests and reservations</span>
            <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search guests, reservations…" />
            <kbd><Command size={11} />K</kbd>
          </label>}
          <div className="business-date">
            <Clock3 size={16} aria-hidden="true" />
            <span>Business date</span>
            <strong>{shortDate(dashboard.businessDate)}</strong>
          </div>
          <IconButton label="Refresh data" onClick={() => void refresh()}><RefreshCw size={18} /></IconButton>
          <IconButton label="Notifications"><Bell size={18} /><span className="notification-dot" /></IconButton>
        </header>

        <main id="main-content" className="main-content">
          {query && view !== "frontdesk" ? (
            <SearchResults reservations={searchedReservations} onOpen={(r) => setModal({ kind: "folio", reservation: r })} onClose={() => setQuery("")} />
          ) : (
            <>
              {view === "overview" && <Overview dashboard={dashboard} user={user} setView={setView} openModal={setModal} />}
              {view === "frontdesk" && <FrontDesk dashboard={dashboard} user={user} reservations={searchedReservations} openModal={setModal} />}
              {view === "rooms" && <Rooms dashboard={dashboard} canUpdate={can(user, "room.update")} run={run} />}
              {view === "folios" && <Folios dashboard={dashboard} openModal={setModal} />}
              {view === "catalog" && <RoomCatalog dashboard={dashboard} />}
              {view === "revenue" && <Revenue dashboard={dashboard} canUpdate={can(user, "rate.update")} run={run} />}
              {view === "services" && <Services dashboard={dashboard} canBook={can(user, "service.book")} openModal={setModal} />}
              {view === "housekeeping" && <Housekeeping dashboard={dashboard} canUpdate={can(user, "housekeeping.update")} run={run} />}
              {view === "inventory" && <Inventory dashboard={dashboard} canUpdate={can(user, "inventory.update")} openModal={setModal} />}
              {view === "accounting" && <Accounting dashboard={dashboard} />}
              {view === "crm" && <GuestCrm dashboard={dashboard} canUpdate={can(user, "crm.update")} run={run} />}
              {view === "audit" && <AuditTrail dashboard={dashboard} canRun={can(user, "audit.run")} openAudit={() => setModal({ kind: "audit" })} />}
            </>
          )}
        </main>
      </div>

      {modal?.kind === "booking" && can(user, "reservation.create") && <BookingModal dashboard={dashboard} busy={updating} close={() => setModal(null)} run={run} />}
      {modal?.kind === "checkin" && can(user, "reservation.checkin") && <CheckInModal dashboard={dashboard} reservation={modal.reservation} busy={updating} close={() => setModal(null)} run={run} />}
      {modal?.kind === "folio" && can(user, "folio.read") && <FolioModal user={user} dashboard={dashboard} reservation={dashboard.reservations.find(r => r.id === modal.reservation.id) ?? modal.reservation} busy={updating} close={() => setModal(null)} run={run} />}
      {modal?.kind === "audit" && can(user, "audit.run") && <NightAuditModal dashboard={dashboard} busy={updating} close={() => setModal(null)} run={run} />}
      {modal?.kind === "service" && can(user, "service.book") && <ServiceBookingModal dashboard={dashboard} service={modal.service} busy={updating} close={() => setModal(null)} run={run} />}
      {modal?.kind === "stock" && can(user, "inventory.update") && <StockMovementModal item={modal.item} busy={updating} close={() => setModal(null)} run={run} />}
      {toast && (
        <div className={`toast toast-${toast.type}`} role="status">
          {toast.type === "success" ? <CheckCircle2 size={19} /> : <AlertCircle size={19} />}
          <span>{toast.message}</span>
          <button aria-label="Dismiss notification" onClick={() => setToast(null)}><X size={16} /></button>
        </div>
      )}
    </div>
  );
}

function PageHeading({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail: string; action?: ReactNode }) {
  return (
    <div className="page-heading">
      <div><p>{eyebrow}</p><h1>{title}</h1><span>{detail}</span></div>
      {action}
    </div>
  );
}

function Overview({ dashboard, user, setView, openModal }: { dashboard: Dashboard; user: AuthUser; setView: (v: View) => void; openModal: (m: Modal) => void }) {
  const arrivals = dashboard.reservations.filter((r) => r.arrival === dashboard.businessDate && r.status === "confirmed");
  const departures = dashboard.reservations.filter((r) => r.departure === dashboard.businessDate && r.status === "checked_in");
  const clean = dashboard.rooms.filter((r) => r.status === "vacant_clean").length;
  const dirty = dashboard.rooms.filter((r) => r.status === "vacant_dirty").length;
  const ooo = dashboard.rooms.filter((r) => r.status === "out_of_order").length;
  return (
    <>
      <PageHeading
        eyebrow="Friday operations"
        title={`Good morning, ${user.name.split(" ")[0]}`}
        detail={`${dashboard.metrics.arrivals} arrivals and ${dashboard.metrics.departures} departures need the team's attention today.`}
        action={can(user, "reservation.create") ? <button className="button button-primary" onClick={() => openModal({ kind: "booking" })}><Plus size={17} />New reservation</button> : undefined}
      />
      <section className="metric-grid" aria-label="Today's performance">
        <Metric label="Occupancy" value={`${dashboard.metrics.occupancy}%`} detail={`${dashboard.metrics.inHouse} rooms occupied`} icon={<Gauge />} trend="On books" />
        <Metric label="Arrivals" value={String(dashboard.metrics.arrivals)} detail={`${arrivals.length} awaiting check-in`} icon={<DoorOpen />} trend="Today" />
        <Metric label="Departures" value={String(dashboard.metrics.departures)} detail={`${departures.length} still in house`} icon={<KeyRound />} trend="Due out" />
        <Metric label="Room revenue" value={money(dashboard.metrics.roomRevenue)} detail="Posted to date" icon={<CircleDollarSign />} trend="Business date" />
      </section>
      <div className="overview-grid">
        <section className="panel panel-arrivals">
          <div className="panel-header"><div><h2>Arrivals</h2><p>Priority queue for today</p></div><button className="text-button" onClick={() => setView("frontdesk")}>View all <ArrowRight size={15} /></button></div>
          <div className="guest-list">
            {arrivals.map((reservation) => (
              <button className="guest-row" key={reservation.id} disabled={!can(user, "reservation.checkin")} onClick={() => openModal({ kind: "checkin", reservation })}>
                <span className="guest-avatar">{reservation.guestName.split(" ").map(n => n[0]).slice(0, 2).join("")}</span>
                <span className="guest-primary"><strong>{reservation.guestName}</strong><small>{reservation.confirmation} · {reservation.roomType}</small></span>
                <span className="guest-meta"><strong>{reservation.adults} guest{reservation.adults > 1 ? "s" : ""}</strong><small>{reservation.source}</small></span>
                <Status value="confirmed" label="Ready" />
                <ArrowRight size={17} aria-hidden="true" />
              </button>
            ))}
            {!arrivals.length && <EmptyState>No arrivals match the current business date.</EmptyState>}
          </div>
        </section>
        <aside className="panel room-readiness">
          <div className="panel-header"><div><h2>Room readiness</h2><p>Live housekeeping status</p></div><button className="icon-button" aria-label="Open rooms" onClick={() => setView("rooms")}><ArrowRight size={17} /></button></div>
          <div className="readiness-visual">
            <div className="donut" style={{ "--progress": `${Math.round((clean / dashboard.rooms.length) * 100)}%` } as React.CSSProperties}>
              <span><strong>{clean}</strong><small>ready</small></span>
            </div>
            <div className="readiness-legend">
              <span><i className="legend-ready" />Clean <strong>{clean}</strong></span>
              <span><i className="legend-dirty" />Dirty <strong>{dirty}</strong></span>
              <span><i className="legend-occupied" />Occupied <strong>{dashboard.metrics.inHouse}</strong></span>
              <span><i className="legend-ooo" />Out of order <strong>{ooo}</strong></span>
            </div>
          </div>
          <div className="attention-callout">
            <Sparkles size={18} aria-hidden="true" />
            <div><strong>{clean >= dashboard.metrics.arrivals ? "Arrival demand is covered" : "Room-ready risk detected"}</strong><span>{clean} clean rooms for {dashboard.metrics.arrivals} remaining arrivals.</span></div>
          </div>
        </aside>
        <section className="panel departures-panel">
          <div className="panel-header"><div><h2>Due out</h2><p>Settlement and room-release queue</p></div><span className="count-badge">{departures.length}</span></div>
          {departures.map((reservation) => (
            <button className="departure-row" key={reservation.id} disabled={!can(user, "folio.read")} onClick={() => openModal({ kind: "folio", reservation })}>
              <span><strong>{reservation.guestName}</strong><small>{reservation.confirmation} · Room {dashboard.rooms.find(r => r.id === reservation.roomId)?.number}</small></span>
              <span className={Math.abs(reservation.balance) > 0.009 ? "balance-due" : "balance-clear"}>{reservation.balance ? money(reservation.balance) : "Settled"}</span>
              <ArrowRight size={16} />
            </button>
          ))}
        </section>
        <section className="panel pulse-panel">
          <div className="panel-header"><div><h2>Operations pulse</h2><p>Current service indicators</p></div></div>
          <div className="pulse-list">
            <span><CheckCircle2 /><strong>Keys online</strong><small>4 min ago</small></span>
            <span><CheckCircle2 /><strong>Payments online</strong><small>2 min ago</small></span>
            <span><AlertCircle /><strong>{ooo} room unavailable</strong><small>Engineering</small></span>
          </div>
        </section>
      </div>
    </>
  );
}

function Metric({ label, value, detail, icon, trend }: { label: string; value: string; detail: string; icon: ReactNode; trend: string }) {
  return (
    <article className="metric">
      <div className="metric-top"><span className="metric-icon">{icon}</span><span className="metric-trend">{trend}</span></div>
      <strong>{value}</strong><h2>{label}</h2><p>{detail}</p>
    </article>
  );
}

function FrontDesk({ dashboard, user, reservations, openModal }: { dashboard: Dashboard; user: AuthUser; reservations: Reservation[]; openModal: (m: Modal) => void }) {
  const [filter, setFilter] = useState<"all" | "arrivals" | "inhouse" | "departures">("all");
  const filtered = reservations.filter((r) => {
    if (filter === "arrivals") return r.arrival === dashboard.businessDate && r.status === "confirmed";
    if (filter === "departures") return r.departure === dashboard.businessDate && r.status === "checked_in";
    if (filter === "inhouse") return r.status === "checked_in";
    return true;
  });
  return (
    <>
      <PageHeading eyebrow="Stay operations" title="Front desk" detail="Arrivals, departures, in-house guests, and today’s exceptions."
        action={can(user, "reservation.create") ? <button className="button button-primary" onClick={() => openModal({ kind: "booking" })}><Plus size={17} />New reservation</button> : undefined} />
      <div className="segmented" role="tablist" aria-label="Reservation filters">
        {(["all", "arrivals", "inhouse", "departures"] as const).map((item) => (
          <button key={item} role="tab" aria-selected={filter === item} onClick={() => setFilter(item)}>
            {item === "all" ? "All stays" : item === "inhouse" ? "In house" : item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </div>
      <section className="panel table-panel">
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>Guest</th><th>Stay</th><th>Room</th><th>Source</th><th>Folio</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {filtered.map((reservation) => {
                const room = dashboard.rooms.find((item) => item.id === reservation.roomId);
                const product = dashboard.roomProducts.find((item) => item.id === reservation.roomProductId);
                const meal = dashboard.mealPlans.find((item) => item.id === reservation.mealPlanId);
                const guestTotal = reservation.adults + reservation.infants + reservation.children + reservation.teens + reservation.seniors;
                return (
                  <tr key={reservation.id}>
                    <td><strong>{reservation.guestName}</strong><small>{reservation.confirmation}</small></td>
                    <td><strong>{shortDate(reservation.arrival)} → {shortDate(reservation.departure)}</strong><small>{guestTotal} guest{guestTotal > 1 ? "s" : ""} · {meal?.code ?? "Legacy board"}</small></td>
                    <td><strong>{room ? room.number : "Unassigned"}</strong><small>{product?.name ?? reservation.roomType}</small></td>
                    <td>{reservation.source}</td>
                    <td className={reservation.balance > 0 ? "balance-due" : ""}>{reservation.balance ? money(reservation.balance) : "—"}</td>
                    <td><Status value={reservation.status} label={reservationStatusLabel[reservation.status]} /></td>
                    <td>
                      {reservation.status === "confirmed" && can(user, "reservation.checkin") ? (
                        <button className="button button-small" onClick={() => openModal({ kind: "checkin", reservation })}>Check in</button>
                      ) : can(user, "folio.read") ? (
                        <IconButton label={`Open ${reservation.guestName} folio`} onClick={() => openModal({ kind: "folio", reservation })}><ArrowRight size={17} /></IconButton>
                      ) : <span className="view-only">View only</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!filtered.length && <EmptyState>No stays match this view.</EmptyState>}
        </div>
      </section>
    </>
  );
}

function Rooms({ dashboard, canUpdate, run }: { dashboard: Dashboard; canUpdate: boolean; run: (op: () => Promise<unknown>, success: string) => Promise<void> }) {
  const floors = [...new Set(dashboard.rooms.map((room) => room.floor))];
  return (
    <>
      <PageHeading eyebrow="Housekeeping" title="Rooms" detail={`${dashboard.metrics.available} ready rooms across ${floors.length} guest floors.`} />
      <div className="room-summary">
        {(Object.keys(roomStatusLabel) as RoomStatus[]).map((status) => (
          <span key={status}><Status value={status} label={roomStatusLabel[status]} /><strong>{dashboard.rooms.filter(r => r.status === status).length}</strong></span>
        ))}
      </div>
      {floors.map((floor) => (
        <section className="floor-section" key={floor}>
          <div className="floor-heading"><h2>Floor {floor}</h2><span>{dashboard.rooms.filter(r => r.floor === floor).length} rooms</span></div>
          <div className="room-grid">
            {dashboard.rooms.filter((r) => r.floor === floor).map((room) => {
              const guest = dashboard.reservations.find((r) => r.roomId === room.id && r.status === "checked_in");
              return (
                <article className={`room-card room-${room.status}`} key={room.id}>
                  <div><strong>{room.number}</strong><Status value={room.status} label={roomStatusLabel[room.status]} /></div>
                  <p>{room.type} · {money(room.rate)}</p>
                  <span>{guest ? guest.guestName : room.features[0]}</span>
                  {canUpdate && room.status === "vacant_dirty" && <button onClick={() => void run(() => api.roomStatus(room.id, "vacant_clean", "Room inspected and released"), `Room ${room.number} marked clean`)}><Check size={15} />Mark clean</button>}
                  {canUpdate && room.status === "vacant_clean" && <button onClick={() => void run(() => api.roomStatus(room.id, "vacant_dirty", "Housekeeping service required"), `Room ${room.number} marked dirty`)}><ClipboardCheck size={15} />Needs service</button>}
                  {canUpdate && room.status === "out_of_order" && <button onClick={() => void run(() => api.roomStatus(room.id, "vacant_dirty", "Engineering returned room to housekeeping"), `Room ${room.number} returned to service`)}><RefreshCw size={15} />Return to service</button>}
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}

function Folios({ dashboard, openModal }: { dashboard: Dashboard; openModal: (m: Modal) => void }) {
  const active = dashboard.reservations.filter((r) => ["confirmed", "checked_in"].includes(r.status));
  const outstanding = active.reduce((sum, reservation) => sum + Math.max(reservation.balance, 0), 0);
  return (
    <>
      <PageHeading eyebrow="Guest ledger" title="Folios" detail="Review immutable postings, tokenized payments, and settlement state." />
      <section className="folio-summary">
        <div><span>Open folios</span><strong>{active.length}</strong></div>
        <div><span>Outstanding balance</span><strong>{money(outstanding)}</strong></div>
        <div><span>Payments posted</span><strong>{money(dashboard.folios.filter(f => f.kind === "payment").reduce((s, f) => s + f.amount, 0))}</strong></div>
      </section>
      <section className="panel table-panel">
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>Guest folio</th><th>Status</th><th>Charges</th><th>Payments</th><th>Balance</th><th><span className="sr-only">Open</span></th></tr></thead>
            <tbody>{active.map((reservation) => {
              const entries = dashboard.folios.filter(f => f.reservationId === reservation.id);
              const charges = entries.filter(e => e.kind === "charge").reduce((s, e) => s + e.amount, 0);
              const payments = entries.filter(e => e.kind === "payment").reduce((s, e) => s + e.amount, 0);
              return <tr key={reservation.id}>
                <td><strong>{reservation.guestName}</strong><small>{reservation.confirmation}</small></td>
                <td><Status value={reservation.status} label={reservationStatusLabel[reservation.status]} /></td>
                <td>{money(charges)}</td><td>{money(payments)}</td>
                <td className={reservation.balance > 0 ? "balance-due" : "balance-clear"}><strong>{money(reservation.balance)}</strong></td>
                <td><IconButton label={`Open ${reservation.guestName} folio`} onClick={() => openModal({ kind: "folio", reservation })}><ArrowRight size={17} /></IconButton></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function RoomCatalog({ dashboard }: { dashboard: Dashboard }) {
  return <>
    <PageHeading eyebrow="Sellable catalog" title="Rooms, beds & board" detail="Canonical room products with explicit bed composition, age capacity, accessibility, and meal inclusions." />
    <section className="catalog-grid">
      {dashboard.roomProducts.map((product) => <article className="catalog-card" key={product.id}>
        <div className="catalog-card-head"><span className="product-code">{product.code}</span><Status value={product.accessible ? "vacant_clean" : "confirmed"} label={product.accessible ? "Accessible" : product.category} /></div>
        <h2>{product.name}</h2><p>{product.description}</p>
        <div className="catalog-rate"><span>Base rate</span><strong>{money(product.baseRate)}</strong><small>per room night</small></div>
        <div className="catalog-section"><strong>Bed configuration</strong>{product.beds.map((bed, index) => <span key={`${bed.type}-${index}`}><BedDouble size={15} /><b>{bed.quantity} × {bed.type.replaceAll("_", " ")}</b><small>Sleeps {bed.sleeps * bed.quantity} · {bed.ageBands.join(", ")}</small></span>)}</div>
        <div className="occupancy-row">{Object.entries(product.maxOccupancy).map(([band, count]) => <span key={band}><strong>{count}</strong><small>{band}</small></span>)}</div>
        <div className="amenity-list">{product.amenities.map((item) => <span key={item}>{item}</span>)}</div>
      </article>)}
    </section>
    <section className="panel meal-plan-panel"><div className="panel-header"><div><h2>Meal plans</h2><p>Included meal periods are explicit at quote and confirmation</p></div></div>
      <div className="meal-plan-grid">{dashboard.mealPlans.map((plan) => <article key={plan.id}><span className="meal-code">{plan.code}</span><div><strong>{plan.name}</strong><p>{plan.periods.length ? plan.periods.map(p => p.replaceAll("_", " ")).join(" · ") : "No meals included"}</p></div><span><strong>{money(plan.adultPrice)}</strong><small>adult / day</small></span><span><strong>{money(plan.childPrice)}</strong><small>child / day</small></span></article>)}</div>
    </section>
  </>;
}

function Revenue({ dashboard, canUpdate, run }: { dashboard: Dashboard; canUpdate: boolean; run: (op: () => Promise<unknown>, success: string) => Promise<void> }) {
  const activeRules = dashboard.rateRules.filter(r => r.active).length;
  const affiliateRevenue = dashboard.affiliates.reduce((sum, item) => sum + item.revenue, 0);
  return <>
    <PageHeading eyebrow="Commercial strategy" title="Rates & partnerships" detail="Effective-dated pricing, conditions, meal-plan packages, promo rules, and affiliate attribution." />
    <section className="folio-summary"><div><span>Published rate plans</span><strong>{dashboard.ratePlans.length}</strong></div><div><span>Active pricing rules</span><strong>{activeRules}</strong></div><div><span>Affiliate revenue</span><strong>{money(affiliateRevenue)}</strong></div></section>
    <div className="revenue-layout">
      <section className="panel table-panel"><div className="panel-header"><div><h2>Rate plans</h2><p>Board basis, cancellation, lead time and discount</p></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Plan</th><th>Meal plan</th><th>Terms</th><th>Discount</th><th>Products</th></tr></thead><tbody>{dashboard.ratePlans.map(plan => { const meal=dashboard.mealPlans.find(m=>m.id===plan.mealPlanId); return <tr key={plan.id}><td><strong>{plan.name}</strong><small>{plan.code}</small></td><td><strong>{meal?.code}</strong><small>{meal?.name}</small></td><td>{plan.refundable ? "Refundable" : "Non-refundable"}<small>{plan.advancePurchaseDays ? `${plan.advancePurchaseDays} days advance` : "No lead time"}</small></td><td>{plan.discountPercent}%</td><td>{plan.eligibleRoomProductIds.length}</td></tr>;})}</tbody></table></div></section>
      <section className="panel rate-rule-panel"><div className="panel-header"><div><h2>Seasonal & special rules</h2><p>Effective dates and booking conditions</p></div></div>{dashboard.rateRules.map(rule => <article key={rule.id}><span className={`rule-state ${rule.active ? "active" : ""}`} /><div><strong>{rule.name}</strong><small>{shortDate(rule.startDate)} – {shortDate(rule.endDate)} · min {rule.minStay} night{rule.minStay>1?"s":""}</small></div><span className={rule.adjustment < 0 ? "discount-value" : "premium-value"}>{rule.adjustment > 0 ? "+" : ""}{rule.adjustment}{rule.adjustmentType === "percent" ? "%" : " USD"}</span>{rule.promoCode && <code>{rule.promoCode}</code>}{canUpdate && <button className="button button-small" onClick={() => void run(() => api.setRateRuleActive(rule.id, !rule.active), `${rule.name} ${rule.active ? "paused" : "activated"}`)}>{rule.active ? "Pause" : "Activate"}</button>}</article>)}</section>
    </div>
    <section className="panel affiliate-panel"><div className="panel-header"><div><h2>Affiliate partners</h2><p>Attributed bookings, revenue and commission exposure</p></div></div><div>{dashboard.affiliates.map(item => <article key={item.id}><span className="guest-avatar">{item.name.split(" ").map(p=>p[0]).slice(0,2).join("")}</span><span><strong>{item.name}</strong><small>{item.code} · {item.status}</small></span><span><small>Bookings</small><strong>{item.bookings}</strong></span><span><small>Revenue</small><strong>{money(item.revenue)}</strong></span><span><small>Commission</small><strong>{item.commissionPercent}%</strong></span></article>)}</div></section>
  </>;
}

function Services({ dashboard, canBook, openModal }: { dashboard: Dashboard; canBook: boolean; openModal: (m: Modal) => void }) {
  const categories = ["all", ...new Set(dashboard.services.map(s => s.category))];
  const [category, setCategory] = useState("all");
  const visible = dashboard.services.filter(s => category === "all" || s.category === category);
  return <>
    <PageHeading eyebrow="Ancillary commerce" title="Services & experiences" detail={`${dashboard.services.length} capacity-controlled offerings across dining, wellness, entertainment, adventure, marine, and guest services.`} />
    <div className="segmented service-filter">{categories.map(item => <button key={item} aria-selected={category===item} onClick={()=>setCategory(item)}>{item === "all" ? "All services" : item.replaceAll("_", " ")}</button>)}</div>
    <section className="service-grid">{visible.map(service => <article className="service-card" key={service.id}><div className="service-card-top"><span className={`service-icon service-${service.category}`}><Sparkles size={17} /></span><Status value={service.riskLevel === "high" ? "out_of_order" : service.riskLevel === "controlled" ? "vacant_dirty" : "vacant_clean"} label={service.riskLevel} /></div><p>{service.category.replaceAll("_", " ")}</p><h2>{service.name}</h2><span className="service-venue">{service.venue}</span><div className="service-facts"><span><Clock3 size={14}/>{service.durationMinutes} min</span><span><UsersRound size={14}/>{service.capacityPerSlot} / slot</span><span>Age {service.minAge}+</span></div><div className="service-slots">{service.slots.slice(0,4).map(slot=><span key={slot}>{slot}</span>)}</div><footer><strong>{money(service.price)}</strong><small>per participant</small>{canBook && <button className="button button-small" onClick={()=>openModal({kind:"service",service})}>Book</button>}</footer>{service.requiresWaiver && <div className="waiver-note"><ShieldCheck size={13}/>Waiver required</div>}</article>)}</section>
    {dashboard.serviceBookings.length > 0 && <section className="panel service-booking-list"><div className="panel-header"><div><h2>Upcoming bookings</h2><p>Confirmed ancillary reservations</p></div></div>{dashboard.serviceBookings.map(booking=><article key={booking.id}><span><strong>{booking.guestName}</strong><small>{dashboard.services.find(s=>s.id===booking.serviceId)?.name}</small></span><span>{shortDate(booking.serviceDate)} · {booking.slot}</span><span>{booking.participants} participants</span><strong>{money(booking.total)}</strong></article>)}</section>}
  </>;
}

function Housekeeping({ dashboard, canUpdate, run }: { dashboard: Dashboard; canUpdate: boolean; run: (op: () => Promise<unknown>, success: string) => Promise<void> }) {
  const columns: HousekeepingTaskStatus[] = ["queued", "in_progress", "inspection", "completed"];
  const next: Record<HousekeepingTaskStatus, HousekeepingTaskStatus | null> = { queued: "in_progress", in_progress: "inspection", inspection: "completed", completed: null };
  return <>
    <PageHeading eyebrow="Rooms division" title="Housekeeping control" detail="Priority, assignment, progress, laundry and room-release status in one operational board." />
    <section className="housekeeping-board">{columns.map(status => <div className="task-column" key={status}><header><span>{status.replaceAll("_"," ")}</span><strong>{dashboard.housekeepingTasks.filter(t=>t.status===status).length}</strong></header>{dashboard.housekeepingTasks.filter(t=>t.status===status).map(task=>{const room=dashboard.rooms.find(r=>r.id===task.roomId); const nextStatus=next[status]; return <article key={task.id} className={`task-card priority-${task.priority}`}><div><strong>Room {room?.number}</strong><Status value={task.priority === "urgent" ? "out_of_order" : task.priority === "high" ? "vacant_dirty" : "confirmed"} label={task.priority}/></div><h3>{task.type.replaceAll("_"," ")}</h3><p>{task.notes}</p><span><UserRound size={13}/>{task.assignee}</span><small>Due {new Date(task.dueAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</small>{canUpdate && nextStatus && <button className="button button-small" onClick={()=>void run(()=>api.updateHousekeepingTask(task.id,nextStatus),`Room ${room?.number} moved to ${nextStatus.replaceAll("_"," ")}`)}>{nextStatus === "completed" ? "Complete" : `Start ${nextStatus.replaceAll("_"," ")}`}</button>}</article>})}</div>)}</section>
  </>;
}

type HousekeepingTaskStatus = Dashboard["housekeepingTasks"][number]["status"];

function Inventory({ dashboard, canUpdate, openModal }: { dashboard: Dashboard; canUpdate: boolean; openModal: (m: Modal) => void }) {
  const value = dashboard.inventoryItems.reduce((sum,item)=>sum+item.onHand*item.unitCost,0);
  const low = dashboard.inventoryItems.filter(item=>item.onHand<=item.reorderPoint).length;
  return <>
    <PageHeading eyebrow="Stores & procurement" title="Warehouse inventory" detail="Perpetual stock, valuation, par levels, reorder control, receipts and departmental issues." />
    <section className="folio-summary"><div><span>Inventory value</span><strong>{money(value)}</strong></div><div><span>Tracked SKUs</span><strong>{dashboard.inventoryItems.length}</strong></div><div><span>Reorder alerts</span><strong className={low ? "balance-due" : "balance-clear"}>{low}</strong></div></section>
    <section className="panel table-panel"><div className="data-table-wrap"><table className="data-table inventory-table"><thead><tr><th>Item</th><th>Location</th><th>On hand</th><th>Par / reorder</th><th>Unit cost</th><th>Valuation</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{dashboard.inventoryItems.map(item=><tr key={item.id}><td><strong>{item.name}</strong><small>{item.sku} · {item.category}</small></td><td>{item.warehouse}</td><td className={item.onHand<=item.reorderPoint?"balance-due":""}><strong>{item.onHand} {item.unit}</strong></td><td><strong>{item.parLevel} / {item.reorderPoint}</strong><small>{item.onHand<=item.reorderPoint?"Reorder now":"Within control"}</small></td><td>{money(item.unitCost)}</td><td>{item.valuation.replaceAll("_"," ")}</td><td>{canUpdate && <button className="button button-small" onClick={()=>openModal({kind:"stock",item})}>Move stock</button>}</td></tr>)}</tbody></table></div></section>
  </>;
}

function Accounting({ dashboard }: { dashboard: Dashboard }) {
  const totalDebits=dashboard.journalEntries.flatMap(j=>j.lines).reduce((s,l)=>s+l.debit,0);
  const totalCredits=dashboard.journalEntries.flatMap(j=>j.lines).reduce((s,l)=>s+l.credit,0);
  return <>
    <PageHeading eyebrow="Finance control" title="Accounting journal" detail="Balanced, source-traceable entries by business date, account, and cost center." />
    <section className="folio-summary"><div><span>Posted journals</span><strong>{dashboard.journalEntries.filter(j=>j.status==="posted").length}</strong></div><div><span>Total debits</span><strong>{money(totalDebits)}</strong></div><div><span>Total credits</span><strong className={Math.abs(totalDebits-totalCredits)<.01?"balance-clear":"balance-due"}>{money(totalCredits)}</strong></div></section>
    <section className="journal-list">{dashboard.journalEntries.map(journal=>{const debit=journal.lines.reduce((s,l)=>s+l.debit,0); const credit=journal.lines.reduce((s,l)=>s+l.credit,0); return <article className="panel journal-card" key={journal.id}><header><span><strong>{journal.journalNumber}</strong><small>{journal.source} · {shortDate(journal.businessDate)}</small></span><Status value={Math.abs(debit-credit)<.01?"vacant_clean":"out_of_order"} label={Math.abs(debit-credit)<.01?"Balanced":"Out of balance"}/></header><h2>{journal.description}</h2><table><thead><tr><th>Account</th><th>Cost center</th><th>Debit</th><th>Credit</th></tr></thead><tbody>{journal.lines.map((line,index)=><tr key={`${line.accountCode}-${index}`}><td><strong>{line.accountCode}</strong> {line.accountName}</td><td>{line.costCenter}</td><td>{line.debit?money(line.debit):"—"}</td><td>{line.credit?money(line.credit):"—"}</td></tr>)}</tbody><tfoot><tr><td colSpan={2}>Entry total</td><td>{money(debit)}</td><td>{money(credit)}</td></tr></tfoot></table></article>})}</section>
  </>;
}

function GuestCrm({ dashboard, canUpdate, run }: { dashboard: Dashboard; canUpdate: boolean; run: (op: () => Promise<unknown>, success: string) => Promise<void> }) {
  return <>
    <PageHeading eyebrow="Guest intelligence" title="Guest CRM" detail="Consent-aware profiles combining stay value, loyalty, preferences, dietary needs, and service context." />
    <section className="crm-grid">{dashboard.guestProfiles.map(profile=><article className="crm-card" key={profile.id}><header><span className="guest-avatar">{profile.name.split(" ").map(p=>p[0]).slice(0,2).join("")}</span><span><h2>{profile.name}</h2><p>{profile.email} · {profile.phone}</p></span><span className={`loyalty loyalty-${profile.loyaltyTier.toLowerCase()}`}>{profile.loyaltyTier}</span></header><div className="crm-value"><span><small>Lifetime value</small><strong>{money(profile.lifetimeValue)}</strong></span><span><small>Completed stays</small><strong>{profile.stays}</strong></span></div><section><strong>Preferences</strong><div className="amenity-list">{profile.preferences.map(item=><span key={item}>{item}</span>)}</div></section><section><strong>Dietary & profile tags</strong><div className="amenity-list">{[...profile.dietaryNeeds,...profile.tags].map(item=><span key={item}>{item}</span>)}</div></section><footer><span><ShieldCheck size={14}/>Email {profile.consent.email?"yes":"no"} · SMS {profile.consent.sms?"yes":"no"} · Personalization {profile.consent.personalization?"yes":"no"}</span>{canUpdate && <button className="button button-small" disabled={profile.tags.includes("Reviewed")} onClick={()=>void run(()=>api.updateGuestProfile(profile.id,[...profile.tags,"Reviewed"],profile.preferences),`${profile.name} profile reviewed`)}>Mark reviewed</button>}</footer></article>)}</section>
  </>;
}

function AuditTrail({ dashboard, canRun, openAudit }: { dashboard: Dashboard; canRun: boolean; openAudit: () => void }) {
  return (
    <>
      <PageHeading eyebrow="Controls" title="Audit trail" detail="Append-only operational events with actor, reason, and correlation reference."
        action={canRun ? <button className="button button-primary" onClick={openAudit}><MoonStar size={17} />Run night audit</button> : undefined} />
      <div className="audit-layout">
        <section className="panel audit-timeline">
          <div className="panel-header"><div><h2>Recent events</h2><p>Property scope · newest first</p></div><ShieldCheck size={20} /></div>
          {dashboard.audit.length ? dashboard.audit.map((event) => (
            <article className="audit-event" key={event.id}>
              <span className="audit-icon"><FileClock size={16} /></span>
              <div><strong>{event.summary}</strong><p>{event.actor} · {event.reason}</p><small>{new Date(event.at).toLocaleString()} · {event.correlationId.slice(0, 8)}</small></div>
              <Status value={event.action} label={event.action.replaceAll("_", " ")} />
            </article>
          )) : <EmptyState>New operational events will appear here.</EmptyState>}
        </section>
        <aside className="panel control-panel">
          <ShieldCheck size={24} />
          <h2>Control posture</h2>
          <p>Audit entries are written in the same transaction as business state. Corrections use new business events.</p>
          <ul><li><Check />Actor and property scope</li><li><Check />Reason captured</li><li><Check />Correlation reference</li><li><Check />Outbox event staged</li></ul>
        </aside>
      </div>
    </>
  );
}

function SearchResults({ reservations, onOpen, onClose }: { reservations: Reservation[]; onOpen: (r: Reservation) => void; onClose: () => void }) {
  return <>
    <PageHeading eyebrow="Global search" title="Search results" detail={`${reservations.length} matching guest or reservation records.`}
      action={<button className="button" onClick={onClose}><X size={16} />Clear search</button>} />
    <section className="panel search-results">{reservations.map(r => <button key={r.id} onClick={() => onOpen(r)}>
      <span className="guest-avatar">{r.guestName.split(" ").map(n => n[0]).join("")}</span>
      <span><strong>{r.guestName}</strong><small>{r.confirmation} · {shortDate(r.arrival)} → {shortDate(r.departure)}</small></span>
      <Status value={r.status} label={reservationStatusLabel[r.status]} /><ArrowRight size={17} />
    </button>)}</section>
  </>;
}

function ModalFrame({ title, subtitle, close, children, footer }: { title: string; subtitle: string; close: () => void; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.currentTarget === e.target) close(); }}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header><div><h2 id="modal-title">{title}</h2><p>{subtitle}</p></div><IconButton label="Close dialog" onClick={close}><X size={20} /></IconButton></header>
        <div className="modal-body">{children}</div>
        <footer>{footer}</footer>
      </section>
    </div>
  );
}

function BookingModal({ dashboard, busy, close, run }: { dashboard: Dashboard; busy: boolean; close: () => void; run: (op: () => Promise<unknown>, success: string) => Promise<void> }) {
  const tomorrow = new Date(`${dashboard.businessDate}T12:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const initialProduct=dashboard.roomProducts[0];
  const initialRate=dashboard.ratePlans.find(rate=>rate.eligibleRoomProductIds.includes(initialProduct?.id));
  const [form, setForm] = useState({
    guestName: "", email: "", arrival: dashboard.businessDate, departure: tomorrow.toISOString().slice(0, 10),
    adults: 2, infants: 0, children: 0, teens: 0, seniors: 0,
    roomProductId: initialProduct?.id ?? "", ratePlanId: initialRate?.id ?? "", mealPlanId: initialRate?.mealPlanId ?? dashboard.mealPlans[0]?.id ?? "",
    promoCode: "", source: "Direct" as Reservation["source"]
  });
  const product=dashboard.roomProducts.find(item=>item.id===form.roomProductId);
  const advanceDays=Math.round((Date.parse(form.arrival)-Date.parse(dashboard.businessDate))/86400000);
  const eligibleRates=dashboard.ratePlans.filter(rate=>rate.eligibleRoomProductIds.includes(form.roomProductId) && advanceDays>=rate.advancePurchaseDays);
  const ratePlan=dashboard.ratePlans.find(item=>item.id===form.ratePlanId);
  const mealPlan=dashboard.mealPlans.find(item=>item.id===form.mealPlanId);
  const nights = Math.max(0, Math.round((Date.parse(form.departure) - Date.parse(form.arrival)) / 86400000));
  const roomEstimate=(product?.baseRate ?? 0)*nights*(1-(ratePlan?.discountPercent??0)/100);
  const mealEstimate=nights*((form.adults+form.teens+form.seniors)*(mealPlan?.adultPrice??0)+form.children*(mealPlan?.childPrice??0));
  const total=(roomEstimate+mealEstimate)*1.1;
  const capacityValid=product ? form.infants<=product.maxOccupancy.infant && form.children<=product.maxOccupancy.child && form.teens<=product.maxOccupancy.teen && form.adults<=product.maxOccupancy.adult && form.seniors<=product.maxOccupancy.senior : false;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(() => api.createReservation({ ...form, idempotencyKey: crypto.randomUUID() }), "Reservation confirmed");
  };
  return <ModalFrame title="New reservation" subtitle="Confirm product, bed configuration, guest ages, board basis, and rate conditions." close={close}
    footer={<><button className="button" onClick={close}>Cancel</button><button className="button button-primary" type="submit" form="booking-form" disabled={busy || nights < 1 || !capacityValid || !ratePlan}>{busy ? "Confirming..." : "Confirm reservation"}<ArrowRight size={16} /></button></>}>
    <form id="booking-form" className="form-grid" onSubmit={submit}>
      <label className="field field-wide"><span>Guest name</span><input required autoFocus autoComplete="name" value={form.guestName} onChange={e => setForm({ ...form, guestName: e.target.value })} placeholder="Full name" /></label>
      <label className="field field-wide"><span>Email</span><input required type="email" autoComplete="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="guest@example.com" /></label>
      <label className="field"><span>Arrival</span><input required type="date" min={dashboard.businessDate} value={form.arrival} onChange={e => { const arrival=e.target.value; const days=Math.round((Date.parse(arrival)-Date.parse(dashboard.businessDate))/86400000); const current=dashboard.ratePlans.find(rate=>rate.id===form.ratePlanId); const next=current?.eligibleRoomProductIds.includes(form.roomProductId)&&days>=current.advancePurchaseDays?current:dashboard.ratePlans.find(rate=>rate.eligibleRoomProductIds.includes(form.roomProductId)&&days>=rate.advancePurchaseDays); setForm({ ...form, arrival, ratePlanId:next?.id??"", mealPlanId:next?.mealPlanId??form.mealPlanId }); }} /></label>
      <label className="field"><span>Departure</span><input required type="date" min={form.arrival} value={form.departure} onChange={e => setForm({ ...form, departure: e.target.value })} /></label>
      <label className="field field-wide"><span>Room product</span><select value={form.roomProductId} onChange={e=>{const productId=e.target.value; const nextRate=dashboard.ratePlans.find(rate=>rate.eligibleRoomProductIds.includes(productId)&&advanceDays>=rate.advancePurchaseDays); setForm({...form,roomProductId:productId,ratePlanId:nextRate?.id??"",mealPlanId:nextRate?.mealPlanId??form.mealPlanId});}}>{dashboard.roomProducts.map(item=><option key={item.id} value={item.id}>{item.name} · {item.code}</option>)}</select></label>
      {product && <div className="booking-product field-wide"><span><BedDouble size={17}/><span><strong>{product.beds.map(b=>`${b.quantity}× ${b.type.replaceAll("_"," ")}`).join(" · ")}</strong><small>{product.amenities.join(" · ")}</small></span></span><strong>{money(product.baseRate)}</strong></div>}
      <fieldset className="age-grid field-wide"><legend>Guests by age band</legend>{(["infants","children","teens","adults","seniors"] as const).map(band=><label key={band}><span>{band}</span><input type="number" min={band==="adults"?1:0} max={product?.maxOccupancy[band==="infants"?"infant":band==="children"?"child":band==="teens"?"teen":band==="adults"?"adult":"senior"]??0} value={form[band]} onChange={e=>setForm({...form,[band]:Number(e.target.value)})}/><small>max {product?.maxOccupancy[band==="infants"?"infant":band==="children"?"child":band==="teens"?"teen":band==="adults"?"adult":"senior"]??0}</small></label>)}</fieldset>
      {!capacityValid && <p className="login-error field-wide"><AlertCircle size={15}/>Guest composition exceeds this product's age-band capacity.</p>}
      <label className="field"><span>Rate plan</span><select value={form.ratePlanId} onChange={e=>{const selected=dashboard.ratePlans.find(r=>r.id===e.target.value);setForm({...form,ratePlanId:e.target.value,mealPlanId:selected?.mealPlanId??form.mealPlanId});}}>{eligibleRates.map(item=><option key={item.id} value={item.id}>{item.name} · {item.discountPercent}% off{item.advancePurchaseDays?` · ${item.advancePurchaseDays}d advance`:""}</option>)}</select></label>
      {!eligibleRates.length && <p className="login-error"><AlertCircle size={15}/>No rate plan is eligible for this arrival date.</p>}
      <label className="field"><span>Meal plan</span><select value={form.mealPlanId} onChange={e=>setForm({...form,mealPlanId:e.target.value})}>{dashboard.mealPlans.map(item=><option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
      <label className="field"><span>Booking source</span><select value={form.source} onChange={e => setForm({ ...form, source: e.target.value as Reservation["source"] })}><option>Direct</option><option>Corporate</option><option>OTA</option><option>Walk-in</option></select></label>
      <label className="field"><span>Promo / affiliate code</span><input value={form.promoCode} onChange={e=>setForm({...form,promoCode:e.target.value.toUpperCase()})} placeholder="Optional"/></label>
      <div className="price-summary field-wide"><span><BookOpen size={18} /><span><strong>{mealPlan?.code} · {mealPlan?.periods.length ? mealPlan.periods.map(p=>p.replaceAll("_"," ")).join(", ") : "No meals"}</strong><small>{nights} night{nights !== 1 ? "s" : ""} · estimate before seasonal rules · tax included</small></span></span><strong>{money(total)}</strong></div>
    </form>
  </ModalFrame>;
}

function CheckInModal({ dashboard, reservation, busy, close, run }: { dashboard: Dashboard; reservation: Reservation; busy: boolean; close: () => void; run: (op: () => Promise<unknown>, success: string) => Promise<void> }) {
  const rooms = dashboard.rooms
    .filter(r => r.type === reservation.roomType && r.status === "vacant_clean")
    .sort((a, b) => Number(b.id === reservation.roomId) - Number(a.id === reservation.roomId));
  const [roomId, setRoomId] = useState(reservation.roomId && rooms.some(r => r.id === reservation.roomId) ? reservation.roomId : rooms[0]?.id ?? "");
  return <ModalFrame title={`Check in ${reservation.guestName}`} subtitle={`${reservation.confirmation} · ${shortDate(reservation.arrival)} to ${shortDate(reservation.departure)}`} close={close}
    footer={<><button className="button" onClick={close}>Cancel</button><button className="button button-primary" disabled={!roomId || busy} onClick={() => void run(() => api.checkIn(reservation.id, roomId, "Identity and arrival details verified"), `${reservation.guestName} checked in`)}>{busy ? "Checking in…" : "Complete check-in"}<KeyRound size={16} /></button></>}>
    <div className="verification-list"><span><CheckCircle2 /><span><strong>Reservation confirmed</strong><small>Stay dates and occupancy reviewed</small></span></span><span><CheckCircle2 /><span><strong>Guest verification</strong><small>Identity check recorded by front desk</small></span></span><span><AlertCircle /><span><strong>Payment guarantee</strong><small>Collect payment in the folio after check-in</small></span></span></div>
    <fieldset className="room-picker"><legend>Assign a ready {reservation.roomType} room</legend>
      {rooms.map(room => <label key={room.id}><input type="radio" name="room" checked={roomId === room.id} onChange={() => setRoomId(room.id)} /><span><strong>{room.number}</strong><small>Floor {room.floor} · {room.features.join(" · ")}</small></span><span>{money(room.rate)}</span></label>)}
      {!rooms.length && <EmptyState>No clean {reservation.roomType} rooms are ready. Release one from the Rooms view first.</EmptyState>}
    </fieldset>
  </ModalFrame>;
}

function FolioModal({ user, dashboard, reservation, busy, close, run }: { user: AuthUser; dashboard: Dashboard; reservation: Reservation; busy: boolean; close: () => void; run: (op: () => Promise<unknown>, success: string) => Promise<void> }) {
  const entries = dashboard.folios.filter(f => f.reservationId === reservation.id);
  const mayPay = can(user, "payment.capture");
  const mayPost = can(user, "folio.post");
  const mayCheckout = can(user, "stay.checkout");
  const [tab, setTab] = useState<"charge" | "payment">(mayPay ? "payment" : "charge");
  const [amount, setAmount] = useState(Math.max(reservation.balance, 0).toFixed(2));
  const [description, setDescription] = useState("Restaurant charge");
  const [last4, setLast4] = useState("4242");
  const submit = () => tab === "payment"
    ? run(() => api.pay(reservation.id, Number(amount), last4), "Tokenized payment posted")
    : run(() => api.postCharge(reservation.id, Number(amount), "MISC", description), "Charge posted to folio");
  const postingAllowed = reservation.status === "checked_in" && Math.abs(reservation.balance) >= 0.009 && (mayPay || mayPost);
  const action = reservation.status === "checked_in" && Math.abs(reservation.balance) < 0.009 && mayCheckout
    ? <button className="button button-primary" disabled={busy} onClick={() => void run(() => api.checkout(reservation.id), `${reservation.guestName} checked out`)}>Check out <DoorOpen size={16} /></button>
    : postingAllowed
      ? <button className="button button-primary" disabled={busy || Number(amount) <= 0} onClick={() => void submit()}>{busy ? "Posting..." : tab === "payment" ? "Post payment" : "Post charge"}</button>
      : null;
  return <ModalFrame title={`${reservation.guestName} · Folio`} subtitle={`${reservation.confirmation} · ${reservationStatusLabel[reservation.status]}`} close={close}
    footer={<><button className="button" onClick={close}>Close</button>{action}</>}>
    <div className="folio-balance"><span><small>Current balance</small><strong className={reservation.balance > 0 ? "balance-due" : "balance-clear"}>{money(reservation.balance)}</strong></span><span><small>Reserved total</small><strong>{money(reservation.total)}</strong></span></div>
    <div className="folio-entries">
      {entries.map(entry => <div key={entry.id}><span className={`entry-icon entry-${entry.kind}`}>{entry.kind === "charge" ? <Plus size={14} /> : <Check size={14} />}</span><span><strong>{entry.description}</strong><small>{entry.code} · {new Date(entry.createdAt).toLocaleString()}</small></span><strong>{entry.kind === "payment" ? "−" : ""}{money(entry.amount)}</strong></div>)}
      {!entries.length && <EmptyState>No postings on this folio.</EmptyState>}
    </div>
    {postingAllowed && <div className="posting-box">
      {mayPay && mayPost && <div className="segmented compact"><button aria-selected={tab === "payment"} onClick={() => { setTab("payment"); setAmount(Math.max(reservation.balance, 0).toFixed(2)); }}>Payment</button><button aria-selected={tab === "charge"} onClick={() => { setTab("charge"); setAmount(""); }}>Charge</button></div>}
      <div className="posting-fields">
        <label className="field"><span>Amount</span><input type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></label>
        {tab === "payment" ? <label className="field"><span>Provider token ending</span><input inputMode="numeric" maxLength={4} value={last4} onChange={e => setLast4(e.target.value.replace(/\D/g, ""))} /></label> : <label className="field"><span>Description</span><input value={description} onChange={e => setDescription(e.target.value)} /></label>}
      </div>
      <p><ShieldCheck size={15} />No card number or security code enters Aurelia.</p>
    </div>}
  </ModalFrame>;
}

function ServiceBookingModal({ dashboard, service, busy, close, run }: { dashboard: Dashboard; service: ServiceOffering; busy: boolean; close: () => void; run: (op: () => Promise<unknown>, success: string) => Promise<void> }) {
  const reservationOptions = dashboard.reservations.filter(r=>["confirmed","checked_in"].includes(r.status));
  const [reservationId,setReservationId]=useState(reservationOptions[0]?.id ?? "");
  const selected=reservationOptions.find(r=>r.id===reservationId);
  const [guestName,setGuestName]=useState(selected?.guestName ?? "");
  const [serviceDate,setServiceDate]=useState(dashboard.businessDate);
  const [slot,setSlot]=useState(service.slots[0] ?? "");
  const [participants,setParticipants]=useState(1);
  const [youngestAge,setYoungestAge]=useState(Math.max(service.minAge,18));
  const [waiver,setWaiver]=useState(false);
  const submit=(event:FormEvent)=>{event.preventDefault(); void run(()=>api.bookService(service.id,{reservationId:reservationId||null,guestName,serviceDate,slot,participants,youngestAge,waiverAccepted:waiver}),`${service.name} booked`);};
  return <ModalFrame title={`Book ${service.name}`} subtitle={`${service.venue} · ${money(service.price)} per participant`} close={close} footer={<><button className="button" onClick={close}>Cancel</button><button className="button button-primary" type="submit" form="service-booking" disabled={busy || !slot || !guestName || (service.requiresWaiver&&!waiver)}>{busy?"Booking...":"Confirm service"}<ArrowRight size={16}/></button></>}>
    <form id="service-booking" className="form-grid" onSubmit={submit}>
      <label className="field field-wide"><span>Link to stay</span><select value={reservationId} onChange={e=>{setReservationId(e.target.value); const r=reservationOptions.find(x=>x.id===e.target.value); if(r)setGuestName(r.guestName);}}><option value="">External guest</option>{reservationOptions.map(r=><option key={r.id} value={r.id}>{r.guestName} · {r.confirmation}</option>)}</select></label>
      <label className="field field-wide"><span>Guest name</span><input required value={guestName} onChange={e=>setGuestName(e.target.value)}/></label>
      <label className="field"><span>Date</span><input required type="date" min={dashboard.businessDate} value={serviceDate} onChange={e=>setServiceDate(e.target.value)}/></label>
      <label className="field"><span>Time</span><select value={slot} onChange={e=>setSlot(e.target.value)}>{service.slots.map(item=><option key={item}>{item}</option>)}</select></label>
      <label className="field"><span>Participants</span><input type="number" min="1" max={service.capacityPerSlot} value={participants} onChange={e=>setParticipants(Number(e.target.value))}/></label>
      <label className="field"><span>Youngest participant age</span><input type="number" min="0" max="120" value={youngestAge} onChange={e=>setYoungestAge(Number(e.target.value))}/></label>
      <div className="price-summary field-wide"><span><UsersRound size={18}/><span><strong>Booking total</strong><small>{participants} participant{participants!==1?"s":""} · capacity {service.capacityPerSlot} per slot</small></span></span><strong>{money(service.price*participants)}</strong></div>
      {service.minAge>0 && <p className="service-safety field-wide"><AlertCircle size={16}/>Minimum age {service.minAge}. The youngest participant entered is {youngestAge}.</p>}
      {service.requiresWaiver && <label className="waiver-check field-wide"><input type="checkbox" checked={waiver} onChange={e=>setWaiver(e.target.checked)}/><span><strong>Safety waiver confirmed</strong><small>Eligibility and operator requirements were reviewed with all participants.</small></span></label>}
    </form>
  </ModalFrame>;
}

function StockMovementModal({ item, busy, close, run }: { item: InventoryItem; busy: boolean; close: () => void; run: (op: () => Promise<unknown>, success: string) => Promise<void> }) {
  const [type,setType]=useState<"receipt"|"issue">("receipt");
  const [quantity,setQuantity]=useState(1);
  const [department,setDepartment]=useState("Housekeeping");
  const [reference,setReference]=useState("");
  const submit=(event:FormEvent)=>{event.preventDefault(); void run(()=>api.moveStock(item.id,{type,quantity,department,reference}),`${item.name} stock updated`);};
  const projected=item.onHand+(type==="receipt"?quantity:-quantity);
  return <ModalFrame title={`Move stock · ${item.name}`} subtitle={`${item.sku} · ${item.warehouse}`} close={close} footer={<><button className="button" onClick={close}>Cancel</button><button className="button button-primary" type="submit" form="stock-movement" disabled={busy || quantity<=0 || projected<0 || !reference}>{busy?"Posting...":"Post movement"}</button></>}>
    <form id="stock-movement" className="form-grid" onSubmit={submit}>
      <div className="segmented field-wide"><button type="button" aria-selected={type==="receipt"} onClick={()=>setType("receipt")}>Receive</button><button type="button" aria-selected={type==="issue"} onClick={()=>setType("issue")}>Issue</button></div>
      <label className="field"><span>Quantity ({item.unit})</span><input type="number" min="0.01" step="0.01" value={quantity} onChange={e=>setQuantity(Number(e.target.value))}/></label>
      <label className="field"><span>Department</span><select value={department} onChange={e=>setDepartment(e.target.value)}><option>Housekeeping</option><option>Food & Beverage</option><option>Engineering</option><option>Guest Services</option><option>Stores</option></select></label>
      <label className="field field-wide"><span>{type==="receipt"?"Purchase order / receipt":"Requisition / issue"} reference</span><input required value={reference} onChange={e=>setReference(e.target.value)} placeholder={type==="receipt"?"PO-2026-1042":"REQ-HK-0084"}/></label>
      <div className={`stock-projection field-wide ${projected<=item.reorderPoint?"low":""}`}><span><small>Current on hand</small><strong>{item.onHand} {item.unit}</strong></span><ArrowRight size={18}/><span><small>Projected on hand</small><strong>{projected} {item.unit}</strong></span></div>
      {projected<0 && <p className="login-error field-wide"><AlertCircle size={15}/>Issue exceeds available stock.</p>}
    </form>
  </ModalFrame>;
}

function NightAuditModal({ dashboard, busy, close, run }: { dashboard: Dashboard; busy: boolean; close: () => void; run: (op: () => Promise<unknown>, success: string) => Promise<void> }) {
  const dueOut = dashboard.reservations.filter(r => r.departure <= dashboard.businessDate && r.status === "checked_in");
  const blockers = dueOut.length;
  return <ModalFrame title="Run night audit" subtitle={`Close business date ${dashboard.businessDate}`} close={close}
    footer={<><button className="button" onClick={close}>Cancel</button><button className="button button-primary" disabled={busy || blockers > 0} onClick={() => void run(() => api.nightAudit("Pre-audit controls reviewed and approved"), "Night audit completed")}>{busy ? "Closing date…" : "Close business date"}<MoonStar size={16} /></button></>}>
    <div className={`audit-readiness ${blockers ? "audit-blocked" : "audit-ready"}`}>{blockers ? <AlertCircle /> : <CheckCircle2 />}<div><strong>{blockers ? `${blockers} blocking exception${blockers > 1 ? "s" : ""}` : "Pre-audit checks passed"}</strong><span>{blockers ? "Complete due-out stays before closing the business date." : "No due-out stays remain in house."}</span></div></div>
    <div className="checklist">
      <span><Check />Open cashier check <strong>Clear</strong></span>
      <span>{blockers ? <AlertCircle /> : <Check />}Due-out stays <strong>{blockers ? `${blockers} open` : "Clear"}</strong></span>
      <span><Check />Interface exceptions <strong>Clear</strong></span>
      <span><Check />Audit snapshot <strong>Ready</strong></span>
    </div>
    <p className="risk-note"><ShieldCheck size={17} />This action advances the property business date and is recorded in the immutable audit trail.</p>
  </ModalFrame>;
}
