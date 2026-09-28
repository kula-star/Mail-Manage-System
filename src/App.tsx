import { useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  Bell,
  Check,
  ChevronDown,
  CircleHelp,
  CloudUpload,
  FileClock,
  Filter,
  Globe2,
  Mail,
  Menu,
  MoreHorizontal,
  Plus,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Trash2,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import "./App.css";

type Address = {
  id: string;
  email: string;
  country: string;
  addedAt: string;
  replied: boolean;
  exported?: boolean;
};
type EventRow = {
  id: string;
  type: "Added" | "Removed" | "Output" | "Reply" | "Import" | "Country added" | "Country removed";
  email: string;
  country: string;
  at: string;
  description?: string;
  quantity?: number;
  totalCount?: number;
  duplicateCount?: number;
  invalidCount?: number;
};
type Database = { addresses: Address[]; events: EventRow[] };
const today = () => new Date().toISOString().slice(0, 10);
const PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
type ActivityPeriod = "daily" | "weekly" | "monthly";
type SortField = "email" | "country" | "addedAt" | "replied" | "exported";
type HistorySortField = "type" | "description" | "at";
const emptyDb = (): Database => ({ addresses: [], events: [] });
const readApiResponse = async (response: Response) => {
  const text = await response.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    const title = text.match(/<title[^>]*>(.*?)<\/title>/i)?.[1]?.trim();
    const summary = title || text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
    throw new Error(`API returned ${response.status} instead of JSON${summary ? `: ${summary}` : "."}`);
  }
  if (!response.ok) throw new Error(String(body.error || `Request failed (${response.status}).`));
  return body;
};
const api = async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
  const token = localStorage.getItem("mail-manage-token");
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  return (await readApiResponse(response)) as T;
};
const initials = (email: string) => email.slice(0, 1).toUpperCase();

function App() {
  const [user, setUser] = useState(() =>
    localStorage.getItem("mail-manage-token")
      ? localStorage.getItem("mail-manage-session") || ""
      : "",
  );
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [authError, setAuthError] = useState(
    () => sessionStorage.getItem("mail-manage-auth-error") || "",
  );
  const [database, setDatabase] = useState<Database>(emptyDb());
  const [countries, setCountries] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<
    "Overview" | "Addresses" | "History" | "API"
  >("Overview");
  const [search, setSearch] = useState("");
  const [countryFilter, setCountryFilter] = useState("All countries");
  const [dateFilter, setDateFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [activityPeriod, setActivityPeriod] = useState<ActivityPeriod>("daily");
  const [selected, setSelected] = useState<string[]>([]);
  const [sortField, setSortField] = useState<SortField>("addedAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [historySortField, setHistorySortField] = useState<HistorySortField>("at");
  const [historySortDirection, setHistorySortDirection] = useState<"asc" | "desc">("desc");
  const [showAdd, setShowAdd] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [countryInput, setCountryInput] = useState("United States");
  const [newCountry, setNewCountry] = useState("");
  const [rangeStart, setRangeStart] = useState("1");
  const [rangeEnd, setRangeEnd] = useState("");
  const [showExport, setShowExport] = useState(false);
  const [notice, setNotice] = useState("");
  const [apiEmail, setApiEmail] = useState("");
  const [apiCountry, setApiCountry] = useState("");
  const [apiResponse, setApiResponse] = useState("");
  const [apiBusy, setApiBusy] = useState(false);
  const [apiFormat, setApiFormat] = useState<"json" | "formdata">("formdata");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshData = async () => {
    const data = await api<Database & { countries: string[] }>("/api/data");
    setDatabase({ addresses: data.addresses, events: data.events });
    setCountries(data.countries);
  };
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const token = localStorage.getItem("mail-manage-token");
    void fetch("/api/data", { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        const body = await readApiResponse(response);
        return body as Database & { countries: string[] };
      })
      .then((data) => {
        if (cancelled) return;
        setDatabase({ addresses: data.addresses, events: data.events });
        setCountries(data.countries);
      })
      .catch((error: Error) => {
        if (cancelled) return;
        localStorage.removeItem("mail-manage-token");
        localStorage.removeItem("mail-manage-session");
        sessionStorage.setItem("mail-manage-auth-error", error.message);
        window.location.reload();
      });
    return () => {
      cancelled = true;
    };
  }, [user]);
  const addAddress = async (rawEmail: string, country: string) => {
    try {
      await api("/api/addresses", {
        method: "POST",
        body: JSON.stringify({ email: rawEmail, country }),
      });
      await refreshData();
      return "";
    } catch (error) {
      return (error as Error).message;
    }
  };
  const importCsv = (file: File) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim().toLowerCase(),
      complete: ({ data }) => {
        void api<{ added: number; duplicates: number; invalid: number; total: number }>(
          "/api/addresses/import",
          { method: "POST", body: JSON.stringify({ rows: data }) },
        )
          .then(async (result) => {
            await refreshData();
            setNotice(
              `Import complete: ${result.total} rows, ${result.added} added, ${result.duplicates} duplicates${result.invalid ? `, ${result.invalid} invalid emails skipped` : ""}. Unknown countries were saved as Other.`,
            );
          })
          .catch((error: Error) => setNotice(error.message));
      },
      error: () => setNotice("Could not read that CSV file."),
    });
  };
  const removeAddresses = async (ids: string[]) => {
    try {
      const result = await api<{ removed: number }>("/api/addresses", {
        method: "DELETE",
        body: JSON.stringify({ ids }),
      });
      await refreshData();
      setSelected([]);
      setNotice(
        `${result.removed} address${result.removed === 1 ? "" : "es"} removed.`,
      );
    } catch (error) {
      setNotice((error as Error).message);
    }
  };
  const removeAllAddresses = async () => {
    if (!database.addresses.length) return;
    if (!window.confirm(`Remove all ${database.addresses.length} addresses from this account? This cannot be undone.`)) return;
    try {
      const result = await api<{ removed: number }>("/api/addresses/all", { method: "DELETE" });
      await refreshData();
      setSelected([]);
      setPage(1);
      setNotice(`${result.removed} addresses removed.`);
    } catch (error) { setNotice((error as Error).message); }
  };
  const setReply = async (address: Address) => {
    if (address.replied) return;
    try {
      await api(`/api/addresses/${address.id}/reply`, { method: "PATCH" });
      await refreshData();
    } catch (error) {
      setNotice((error as Error).message);
    }
  };
  const exportCsv = async (selection?: { start: number; end: number } | { ids: string[] }) => {
    try {
      const result = await api<{ emails: string[]; count: number }>(
        "/api/exports",
        { method: "POST", body: JSON.stringify(selection || {}) },
      );
      if (!result.count) {
        setNotice("There are no addresses in that range to export.");
        return;
      }
      const blob = new Blob(
        [
          Papa.unparse(
            result.emails.map((email) => [email]),
            { header: false },
          ),
        ],
        { type: "text/csv;charset=utf-8" },
      );
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `email-addresses-${today()}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
      await refreshData();
      setShowExport(false);
      if (selection && "ids" in selection) setSelected([]);
      setNotice(
        `${result.count} email address${result.count === 1 ? "" : "es"} exported.`,
      );
    } catch (error) {
      setNotice((error as Error).message);
    }
  };

  const clearHistory = async () => {
    if (!window.confirm("Clear all activity history for this account? This cannot be undone.")) return;
    try {
      const result = await api<{ cleared: number }>("/api/history", { method: "DELETE" });
      await refreshData();
      setPage(1);
      setNotice(`${result.cleared} history record${result.cleared === 1 ? "" : "s"} cleared.`);
    } catch (error) { setNotice((error as Error).message); }
  };

  const testAddAddressApi = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setApiBusy(true);
    setApiResponse("");
    try {
      const headers: HeadersInit = {};
      const body = apiFormat === "formdata"
        ? (() => { const form = new FormData(); form.append("email", apiEmail); form.append("country", apiCountry); form.append("ownerEmail", user); return form; })()
        : JSON.stringify({ email: apiEmail, country: apiCountry, ownerEmail: user });
      if (apiFormat === "json") headers["Content-Type"] = "application/json";
      const response = await fetch("/v1/addmailaddress", { method: "POST", headers, body });
      const result = await readApiResponse(response) as { success?: boolean; countryFallback?: boolean; address?: Address; error?: string };
      if (!result.address) throw new Error(result.error || "The API response did not include an address.");
      await refreshData();
      const message = { success: result.success, message: "Address saved", email: result.address.email, country: result.address.country, countryFallback: result.countryFallback };
      setApiResponse(JSON.stringify(message, null, 2));
      setNotice(`API added ${result.address.email} as ${result.address.country}.`);
    } catch (error) {
      setApiResponse(JSON.stringify({ success: false, error: (error as Error).message }, null, 2));
    } finally { setApiBusy(false); }
  };

  const changeSort = (field: SortField) => {
    setPage(1);
    if (sortField === field) setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDirection(field === "addedAt" ? "desc" : "asc"); }
  };
  const changeHistorySort = (field: HistorySortField) => {
    setPage(1);
    if (historySortField === field) setHistorySortDirection(historySortDirection === "asc" ? "desc" : "asc");
    else { setHistorySortField(field); setHistorySortDirection(field === "at" ? "desc" : "asc"); }
  };

  const addCountry = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const result = await api<{ countries: string[] }>("/api/countries", {
        method: "POST",
        body: JSON.stringify({ country: newCountry }),
      });
      setCountries(result.countries);
      setNewCountry("");
      setNotice("Country added.");
    } catch (error) {
      setNotice((error as Error).message);
    }
  };
  const removeCountry = async (country: string) => {
    try {
      const result = await api<{ countries: string[] }>(
        `/api/countries/${encodeURIComponent(country)}`,
        { method: "DELETE" },
      );
      setCountries(result.countries);
      if (countryFilter === country) setCountryFilter("All countries");
      if (countryInput === country) setCountryInput(result.countries[0] || "");
      setNotice(`${country} removed.`);
    } catch (error) {
      setNotice((error as Error).message);
    }
  };

  const chartData = useMemo(() => {
    const now = new Date();
    const periods = activityPeriod === "daily" ? 7 : activityPeriod === "weekly" ? 8 : 12;
    const starts = Array.from({ length: periods }, (_, index) => {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (activityPeriod === "daily") start.setDate(start.getDate() - (periods - 1 - index));
      if (activityPeriod === "weekly") {
        start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - 7 * (periods - 1 - index));
      }
      if (activityPeriod === "monthly") start.setMonth(start.getMonth() - (periods - 1 - index), 1);
      return start;
    });
    const bucketFor = (value: string) => {
      const at = new Date(value);
      if (activityPeriod === "daily") return new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
      if (activityPeriod === "weekly") {
        const monday = new Date(at.getFullYear(), at.getMonth(), at.getDate());
        monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
        return monday.getTime();
      }
      return new Date(at.getFullYear(), at.getMonth(), 1).getTime();
    };
    return starts.map((start) => {
      const events = database.events.filter((event) => bucketFor(event.at) === start.getTime());
      const added = events.reduce((total, event) => total + (event.type === "Added" ? 1 : event.type === "Import" ? event.quantity || 0 : 0), 0);
      const removed = events.filter((event) => event.type === "Removed").length;
      const replies = events.filter((event) => event.type === "Reply").length;
      const exports = events.filter((event) => event.type === "Output").reduce((total, event) => total + (event.quantity || 0), 0);
      const label = activityPeriod === "daily"
        ? start.toLocaleDateString("en", { weekday: "short" })
        : start.toLocaleDateString("en", activityPeriod === "weekly" ? { month: "short", day: "numeric" } : { month: "short" });
      return { day: label, Added: added, Removed: removed, Replies: replies, Exports: exports };
    });
  }, [activityPeriod, database.events]);
  const periodStats = useMemo(() => chartData.reduce((stats, row) => ({
    Added: stats.Added + row.Added,
    Removed: stats.Removed + row.Removed,
    Reply: stats.Reply + row.Replies,
    Output: stats.Output + row.Exports,
  }), { Added: 0, Removed: 0, Reply: 0, Output: 0 }), [chartData]);
  const periodName = activityPeriod === "daily" ? "LAST 7 DAYS" : activityPeriod === "weekly" ? "LAST 8 WEEKS" : "LAST 12 MONTHS";
  const countryData = useMemo(
    () =>
      countries
        .map((country) => ({
          name: country,
          total: database.addresses.filter(
            (address) => address.country === country,
          ).length,
        }))
        .filter((item) => item.total)
        .sort((a, b) => b.total - a.total)
        .slice(0, 5),
    [countries, database.addresses],
  );
  const allFilteredAddresses = database.addresses.filter(
    (address) =>
      (address.email.includes(search.toLowerCase()) ||
        address.country.toLowerCase().includes(search.toLowerCase())) &&
      (countryFilter === "All countries" || address.country === countryFilter),
  ).sort((left, right) => {
    const a = left[sortField];
    const b = right[sortField];
    const comparison = typeof a === "boolean" || typeof b === "boolean"
      ? Number(Boolean(a)) - Number(Boolean(b))
      : String(a).localeCompare(String(b));
    return sortDirection === "asc" ? comparison : -comparison;
  });
  const allFilteredEvents = database.events.filter(
    (event) =>
      (!dateFilter || event.at.slice(0, 10) === dateFilter) &&
      (countryFilter === "All countries" || event.country === countryFilter) &&
      (!search ||
        event.email.toLowerCase().includes(search.toLowerCase()) ||
        event.country.toLowerCase().includes(search.toLowerCase()) ||
        event.type.toLowerCase().includes(search.toLowerCase()) ||
        (event.description || "").toLowerCase().includes(search.toLowerCase())),
  ).sort((left, right) => {
    const a = historySortField === "description" ? left.description || left.email : left[historySortField];
    const b = historySortField === "description" ? right.description || right.email : right[historySortField];
    const comparison = String(a).localeCompare(String(b));
    return historySortDirection === "asc" ? comparison : -comparison;
  });
  const recentEvents = [...database.events].sort((left, right) => {
    const a = historySortField === "description" ? left.description || left.email : left[historySortField];
    const b = historySortField === "description" ? right.description || right.email : right[historySortField];
    const comparison = String(a).localeCompare(String(b));
    return historySortDirection === "asc" ? comparison : -comparison;
  }).slice(0, 5);
  const visiblePageSize = pageSize === 0 ? Math.max(allFilteredAddresses.length, allFilteredEvents.length, 1) : pageSize;
  const currentPageCount = Math.max(
    1,
    Math.ceil(
      (activeTab === "Addresses"
        ? allFilteredAddresses.length
        : allFilteredEvents.length) / visiblePageSize,
    ),
  );
  const currentPage = Math.min(page, currentPageCount);
  const filteredAddresses = allFilteredAddresses.slice(
    (currentPage - 1) * visiblePageSize,
    currentPage * visiblePageSize,
  );
  const filteredEvents = allFilteredEvents.slice(
    (currentPage - 1) * visiblePageSize,
    currentPage * visiblePageSize,
  );
  const pageAddresses = filteredAddresses;
  const pageEvents = filteredEvents;

  const authenticate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthError("");
    sessionStorage.removeItem("mail-manage-auth-error");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email")).trim().toLowerCase();
    const password = String(form.get("password"));
    try {
      const result = await api<{ token: string; email: string }>(
        `/api/auth/${authMode}`,
        {
          method: "POST",
          body: JSON.stringify({
            email,
            password,
            inviteCode: form.get("invite"),
          }),
        },
      );
      localStorage.setItem("mail-manage-token", result.token);
      localStorage.setItem("mail-manage-session", result.email);
      setUser(result.email);
      setDatabase(emptyDb());
    } catch (error) {
      setAuthError((error as Error).message);
    }
  };

  if (!user)
    return (
      <main className="auth-page">
        <div className="auth-brand">
          <span className="brand-mark">
            <Mail size={20} />
          </span>
          <span>
            postmark<span className="brand-dot">.</span>
          </span>
        </div>
        <section className="auth-panel">
          <span className="eyebrow">MAIL OPERATIONS / SECURE ACCESS</span>
          <h1>
            {authMode === "signin"
              ? "Good to see you."
              : "Make room for better outreach."}
          </h1>
          <p className="auth-copy">
            {authMode === "signin"
              ? "Sign in to manage your address book and activity."
              : "Create an account to organize your contact list."}
          </p>
          <form className="auth-form" onSubmit={authenticate}>
            <label>
              Email address
              <input
                type="email"
                name="email"
                placeholder="you@company.com"
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                name="password"
                placeholder="At least 8 characters"
                minLength={8}
                required
              />
            </label>
            {authMode === "signup" && (
              <label>
                Access code
                <input
                  type="password"
                  name="invite"
                  placeholder="Enter your access code"
                  required
                />
              </label>
            )}
            {authError && <p className="auth-error">{authError}</p>}
            <button className="primary-btn auth-submit" type="submit">
              {authMode === "signin" ? "Sign in" : "Create account"}
              <ArrowDownToLine size={16} />
            </button>
          </form>
          <p className="auth-switch">
            {authMode === "signin"
              ? "New to Postmark?"
              : "Already have an account?"}{" "}
            <button
              type="button"
              onClick={() => {
                setAuthMode(authMode === "signin" ? "signup" : "signin");
                setAuthError("");
              }}
            >
              {authMode === "signin" ? "Create account" : "Sign in"}
            </button>
          </p>
          <div className="auth-foot">
            <ShieldCheck size={15} /> Passwords secured · records stored in
            MongoDB
          </div>
        </section>
        <span className="auth-side-note">CONTACT MANAGEMENT / 01</span>
      </main>
    );

  const nav = ["Overview", "Addresses", "History", "API"] as const;
  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <span className="brand-mark">
            <Mail size={19} />
          </span>
          <span>
            postmark<span className="brand-dot">.</span>
          </span>
          <button
            className="mobile-close icon-btn"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>
        <div className="workspace-label">WORKSPACE</div>
        <button className="workspace-select">
          <span className="workspace-avatar">M</span>
          <span className="workspace-name">Mail operations</span>
          <ChevronDown size={15} />
        </button>
        <div className="nav-label">MANAGE</div>
        <nav className="main-nav">
          {nav.map((item) => (
            <button
              key={item}
              className={`nav-item ${activeTab === item ? "active" : ""}`}
              onClick={() => setActiveTab(item)}
            >
              {item === "Overview" ? (
                <Activity size={17} />
              ) : item === "Addresses" ? (
                <Users size={17} />
              ) : item === "History" ? (
                <FileClock size={17} />
              ) : <Activity size={17} />}
              {item}
              {item === "Addresses" && (
                <span className="nav-count">{database.addresses.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <div className="plan-card">
          <span className="plan-icon">
            <TrendingUp size={17} />
          </span>
          <strong>Keep your list tidy</strong>
          <span>
            {database.addresses.length.toLocaleString()} contacts in your
            workspace
          </span>
          <button onClick={() => setActiveTab("Addresses")}>
            Manage addresses <span>→</span>
          </button>
        </div>
        <button className="sidebar-link">
          <Settings2 size={17} /> Settings
        </button>
        <button
          className="profile-row"
          onClick={() => {
            localStorage.removeItem("mail-manage-token");
            localStorage.removeItem("mail-manage-session");
            setUser("");
            setDatabase(emptyDb());
          }}
        >
          <span className="profile-avatar">{initials(user)}</span>
          <span className="profile-meta">
            <strong>{user.split("@")[0]}</strong>
            <small>{user}</small>
          </span>
          <MoreHorizontal size={18} />
        </button>
      </aside>
      {sidebarOpen && (
        <button
          className="sidebar-scrim"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close navigation"
        />
      )}
      <main className="main-area">
        <header className="topbar">
          <button
            className="mobile-menu icon-btn"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={19} />
          </button>
          <div className="breadcrumb">
            Workspace <span>/</span> <strong>{activeTab}</strong>
          </div>
          <div className="top-actions">
            <span className="date-pill">
              <span className="online-dot" /> All systems operational
            </span>
            <button className="icon-btn" aria-label="Help">
              <CircleHelp size={18} />
            </button>
            <button
              className="icon-btn notification-btn"
              aria-label="Notifications"
            >
              <Bell size={18} />
              <i />
            </button>
            <span className="top-avatar">{initials(user)}</span>
          </div>
        </header>
        <div className="page-content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                MONDAY,{" "}
                {new Date()
                  .toLocaleDateString("en", {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })
                  .toUpperCase()}
              </span>
              <h1>
                {activeTab === "Overview"
                  ? "Good morning"
                  : activeTab === "Addresses"
                    ? "Address book"
                    : activeTab === "History" ? "Activity history" : "API reference"}
                <span className="heading-period">.</span>
              </h1>
              <p>
                {activeTab === "Overview"
                  ? "A clear view of your contacts and daily activity."
                  : activeTab === "Addresses"
                    ? "Manage, organize, and export your contacts."
                    : activeTab === "History" ? "A complete record of changes across your workspace." : "Add email addresses from your own tools and integrations."}
              </p>
            </div>
            <div className="heading-actions">
              <button
                className="secondary-btn"
                disabled={!allFilteredAddresses.length}
                onClick={() => {
                  setRangeStart("1");
                  setRangeEnd(String(allFilteredAddresses.length));
                  setShowExport(true);
                }}
              >
                <ArrowDownToLine size={16} /> Export range
              </button>
              <button className="primary-btn" onClick={() => setShowAdd(true)}>
                <Plus size={17} /> Add address
              </button>
              {activeTab === "Addresses" && <button className="secondary-btn danger-outline" disabled={!database.addresses.length} onClick={() => void removeAllAddresses()}><Trash2 size={16} /> Remove all</button>}
              {activeTab === "History" && <button className="secondary-btn danger-outline" onClick={() => void clearHistory()}><Trash2 size={16} /> Clear history</button>}
            </div>
          </div>
          {notice && (
            <div className="notice">
              <Check size={16} />
              {notice}
              <button onClick={() => setNotice("")} aria-label="Dismiss">
                <X size={15} />
              </button>
            </div>
          )}
          {activeTab === "Overview" && (
            <>
              <section className="metric-grid">
                <Metric
                  icon={<Users size={17} />}
                  color="mint"
                  label="TOTAL ADDRESSES"
                  value={database.addresses.length}
                  detail="In your address book"
                />
                <Metric
                  icon={<ArrowUpFromLine size={17} />}
                  color="blue"
                  label={`ADDED ${periodName}`}
                  value={periodStats.Added}
                  detail="New contacts added"
                />
                <Metric
                  icon={<Trash2 size={17} />}
                  color="coral"
                  label={`REMOVED ${periodName}`}
                  value={periodStats.Removed}
                  detail="Contacts removed"
                />
                <Metric
                  icon={<Send size={17} />}
                  color="yellow"
                  label={`REPLIES ${periodName}`}
                  value={periodStats.Reply}
                  detail={`${periodStats.Output} addresses exported in this range`}
                />
              </section>
              <section className="chart-grid">
                <article className="panel activity-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>{activityPeriod[0].toUpperCase() + activityPeriod.slice(1)} activity</h2>
                      <p>{activityPeriod === "daily" ? "Actions by day over the last 7 days" : activityPeriod === "weekly" ? "Actions by week over the last 8 weeks" : "Actions by month over the last 12 months"}</p>
                    </div>
                    <label className="period-select-label">
                      <span className="sr-only">Activity period</span>
                      <select className="select-small" value={activityPeriod} onChange={(event) => setActivityPeriod(event.target.value as ActivityPeriod)}>
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                      </select>
                    </label>
                  </div>
                  <div className="chart-legend">
                    <span>
                      <i className="legend-added" /> Additions
                    </span>
                    <span>
                      <i className="legend-removed" /> Removals
                    </span>
                    <span>
                      <i className="legend-reply" /> Replies
                    </span>
                    <span>
                      <i className="legend-export" /> Exports
                    </span>
                  </div>
                  <div className="activity-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={chartData}
                        margin={{ top: 12, right: 8, left: -22, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient
                            id="addedFill"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="0%"
                              stopColor="#55bd9e"
                              stopOpacity={0.2}
                            />
                            <stop
                              offset="95%"
                              stopColor="#55bd9e"
                              stopOpacity={0}
                            />
                          </linearGradient>
                        </defs>
                        <CartesianGrid
                          stroke="#edf0ed"
                          strokeDasharray="3 4"
                          vertical={false}
                        />
                        <XAxis
                          dataKey="day"
                          axisLine={false}
                          tickLine={false}
                          tick={{ fill: "#929a97", fontSize: 11 }}
                          dy={9}
                        />
                        <YAxis
                          axisLine={false}
                          tickLine={false}
                          tick={{ fill: "#929a97", fontSize: 11 }}
                          allowDecimals={false}
                        />
                        <Tooltip
                          contentStyle={{
                            border: "1px solid #e8ece8",
                            borderRadius: 7,
                            fontSize: 12,
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="Added"
                          stroke="#4ba98c"
                          strokeWidth={2}
                          fill="url(#addedFill)"
                        />
                        <Area
                          type="monotone"
                          dataKey="Removed"
                          stroke="#e18f7d"
                          strokeWidth={1.8}
                          fill="transparent"
                        />
                        <Area
                          type="monotone"
                          dataKey="Replies"
                          stroke="#d7a94c"
                          strokeWidth={1.8}
                          fill="transparent"
                        />
                        <Area
                          type="monotone"
                          dataKey="Exports"
                          stroke="#7596ad"
                          strokeWidth={1.8}
                          fill="transparent"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </article>
                <article className="panel country-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>By country</h2>
                      <p>Contact distribution</p>
                    </div>
                    <Globe2 size={17} className="panel-icon" />
                  </div>
                  <div className="country-list">
                    {countryData.length ? (
                      countryData.map((row, index) => (
                        <div className="country-row" key={row.name}>
                          <span className={`country-rank rank-${index + 1}`}>
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <span className="country-name">{row.name}</span>
                          <div className="country-track">
                            <i
                              style={{
                                width: `${Math.max(6, (row.total / countryData[0].total) * 100)}%`,
                              }}
                            />
                          </div>
                          <strong>{row.total}</strong>
                        </div>
                      ))
                    ) : (
                      <div className="empty-small">
                        Country breakdown appears as addresses are added.
                      </div>
                    )}
                  </div>
                  <button
                    className="text-link"
                    onClick={() => {
                      setActiveTab("Addresses");
                      setCountryFilter("All countries");
                    }}
                  >
                    View address book <span>→</span>
                  </button>
                </article>
              </section>
              <section className="panel recent-panel">
                <div className="panel-heading">
                  <div>
                    <h2>Recent activity</h2>
                    <p>The latest updates in your workspace</p>
                  </div>
                  <button
                    className="text-link"
                    onClick={() => setActiveTab("History")}
                  >
                    View history <span>→</span>
                  </button>
                </div>
                  <EventTable events={recentEvents} sortField={historySortField} sortDirection={historySortDirection} onSort={changeHistorySort} />
              </section>
            </>
          )}
          {activeTab === "Addresses" && (
            <>
              <section className="panel countries-panel">
                <div className="country-manage-heading">
                  <div>
                    <h2>Countries</h2>
                    <p>
                      Add or remove the country names available for your
                      addresses.
                    </p>
                  </div>
                  <form className="country-add-form" onSubmit={addCountry}>
                    <input
                      aria-label="New country name"
                      placeholder="Add a country name"
                      value={newCountry}
                      onChange={(event) => setNewCountry(event.target.value)}
                      maxLength={80}
                      required
                    />
                    <button className="secondary-btn compact" type="submit">
                      <Plus size={15} /> Add country
                    </button>
                  </form>
                </div>
                <div className="country-chips">
                  {countries.map((country) => (
                    <span className="country-chip" key={country}>
                      {country}
                      <button
                        type="button"
                        onClick={() => removeCountry(country)}
                        aria-label={`Remove ${country}`}
                        title="Remove country"
                      >
                        <X size={13} />
                      </button>
                    </span>
                  ))}
                </div>
              </section>
              <section className="panel data-panel">
                <div className="table-toolbar">
                  <div className="table-summary">
                    <strong>
                      {database.addresses.length.toLocaleString()}
                    </strong>{" "}
                    addresses
                  </div>
                  <div className="table-controls">
                    <label className="search-field">
                      <Search size={16} />
                      <input
                        placeholder="Search addresses..."
                        value={search}
                        onChange={(event) => {
                          setPage(1);
                          setSearch(event.target.value);
                        }}
                      />
                    </label>
                    <label className="filter-select">
                      <Filter size={15} />
                      <select
                        value={countryFilter}
                        onChange={(event) => {
                          setPage(1);
                          setCountryFilter(event.target.value);
                        }}
                      >
                        <option>All countries</option>
                        {countries.map((country) => (
                          <option key={country}>{country}</option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="secondary-btn compact"
                      onClick={() => fileRef.current?.click()}
                    >
                      <CloudUpload size={16} /> Import CSV
                    </button>
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".csv,text/csv"
                      hidden
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) importCsv(file);
                        event.target.value = "";
                      }}
                    />
                  </div>
                </div>
                {selected.length > 0 && (
                  <div className="selection-bar">
                    <span>{selected.length} selected</span>
                    <button onClick={() => void exportCsv({ ids: selected })}>
                      <ArrowDownToLine size={15} /> Export selected
                    </button>
                    <button
                      className="danger-text"
                      onClick={() => removeAddresses(selected)}
                    >
                      <Trash2 size={15} /> Remove
                    </button>
                  </div>
                )}
                <div className="responsive-table">
                  <table>
                    <thead>
                      <tr>
                        <th>
                          <input
                            type="checkbox"
                            checked={
                              filteredAddresses.length > 0 &&
                              filteredAddresses.every((item) =>
                                selected.includes(item.id),
                              )
                            }
                            onChange={(event) =>
                              setSelected(
                                event.target.checked
                                  ? filteredAddresses.map((item) => item.id)
                                  : [],
                              )
                            }
                            aria-label="Select all addresses"
                          />
                        </th>
                        <th aria-sort={sortField === "email" ? sortDirection === "asc" ? "ascending" : "descending" : "none"}><button className="sort-button" onClick={() => changeSort("email")}>Email address {sortField === "email" ? sortDirection === "asc" ? "↑" : "↓" : "↕"}</button></th>
                        <th aria-sort={sortField === "country" ? sortDirection === "asc" ? "ascending" : "descending" : "none"}><button className="sort-button" onClick={() => changeSort("country")}>Country {sortField === "country" ? sortDirection === "asc" ? "↑" : "↓" : "↕"}</button></th>
                        <th aria-sort={sortField === "addedAt" ? sortDirection === "asc" ? "ascending" : "descending" : "none"}><button className="sort-button" onClick={() => changeSort("addedAt")}>Date added {sortField === "addedAt" ? sortDirection === "asc" ? "↑" : "↓" : "↕"}</button></th>
                        <th aria-sort={sortField === "replied" ? sortDirection === "asc" ? "ascending" : "descending" : "none"}><button className="sort-button" onClick={() => changeSort("replied")}>Reply status {sortField === "replied" ? sortDirection === "asc" ? "↑" : "↓" : "↕"}</button></th>
                        <th aria-sort={sortField === "exported" ? sortDirection === "asc" ? "ascending" : "descending" : "none"}><button className="sort-button" onClick={() => changeSort("exported")}>Export status {sortField === "exported" ? sortDirection === "asc" ? "↑" : "↓" : "↕"}</button></th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {pageAddresses.map((address) => (
                        <tr key={address.id}>
                          <td>
                            <input
                              type="checkbox"
                              checked={selected.includes(address.id)}
                              onChange={(event) =>
                                setSelected(
                                  event.target.checked
                                    ? [...selected, address.id]
                                    : selected.filter(
                                        (id) => id !== address.id,
                                      ),
                                )
                              }
                              aria-label={`Select ${address.email}`}
                            />
                          </td>
                          <td>
                            <span className="email-cell">
                              <span className="email-avatar">
                                {initials(address.email)}
                              </span>
                              {address.email}
                            </span>
                          </td>
                          <td>{address.country}</td>
                          <td>
                            {new Date(address.addedAt).toLocaleString("en", {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </td>
                          <td>
                            <button
                              className={`reply-badge ${address.replied ? "replied" : ""}`}
                              onClick={() => setReply(address)}
                            >
                              {address.replied ? (
                                <>
                                  <Check size={13} /> Replied
                                </>
                              ) : (
                                "Mark replied"
                              )}
                            </button>
                          </td>
                          <td><span className={`export-status ${address.exported ? "exported" : "not-exported"}`}>{address.exported ? "Exported" : "Not exported"}</span></td>
                          <td>
                            <button
                              className="row-icon"
                              onClick={() => removeAddresses([address.id])}
                              aria-label={`Remove ${address.email}`}
                            >
                              <Trash2 size={15} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filteredAddresses.length === 0 && (
                    <EmptyState
                      icon={<Mail size={20} />}
                      title={
                        search || countryFilter !== "All countries"
                          ? "No matching addresses"
                          : "Your address book is empty"
                      }
                      detail={
                        search || countryFilter !== "All countries"
                          ? "Try a different search or country filter."
                          : "Add an address manually or import a CSV to get started."
                      }
                      action={
                        !search && countryFilter === "All countries" ? (
                          <button
                            className="primary-btn"
                            onClick={() => setShowAdd(true)}
                          >
                            <Plus size={16} /> Add address
                          </button>
                        ) : undefined
                      }
                    />
                  )}
                </div>
                <Pagination
                  page={currentPage}
                  pageCount={currentPageCount}
                  total={allFilteredAddresses.length}
                  pageSize={pageSize}
                  onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
                  onPageChange={setPage}
                />
                <div className="table-footer">
                  <span>
                    Showing {allFilteredAddresses.length} matching addresses
                  </span>
                  <span>
                    CSV format: <code>email, country</code>
                  </span>
                </div>
              </section>
            </>
          )}
          {activeTab === "History" && (
            <section className="panel data-panel">
              <div className="table-toolbar">
                <div className="table-summary">
                  <strong>{allFilteredEvents.length.toLocaleString()}</strong>{" "}
                  events
                </div>
                <div className="table-controls">
                  <label className="search-field">
                    <Search size={16} />
                    <input
                      placeholder="Search history..."
                      value={search}
                      onChange={(event) => {
                        setPage(1);
                        setSearch(event.target.value);
                      }}
                    />
                  </label>
                  <label className="filter-select">
                    <Filter size={15} />
                    <select
                      value={countryFilter}
                      onChange={(event) => {
                        setPage(1);
                        setCountryFilter(event.target.value);
                      }}
                    >
                      <option>All countries</option>
                      {countries.map((country) => (
                        <option key={country}>{country}</option>
                      ))}
                    </select>
                  </label>
                  <input
                    className="date-control"
                    type="date"
                    value={dateFilter}
                    onChange={(event) => {
                      setPage(1);
                      setDateFilter(event.target.value);
                    }}
                    aria-label="Filter by date"
                  />
                </div>
              </div>
              <div className="responsive-table">
                <EventTable events={pageEvents} sortField={historySortField} sortDirection={historySortDirection} onSort={changeHistorySort} />
              </div>
              <Pagination
                page={currentPage}
                pageCount={currentPageCount}
                total={allFilteredEvents.length}
                pageSize={pageSize}
                onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
                onPageChange={setPage}
              />
              <div className="table-footer">
                <span>History is grouped by date and country</span>
                <button
                  className="text-link"
                  onClick={() => {
                    setPage(1);
                    setDateFilter("");
                    setCountryFilter("All countries");
                    setSearch("");
                  }}
                >
                  Clear filters <span>×</span>
                </button>
              </div>
            </section>
          )}
          {activeTab === "API" && (
            <section className="api-layout">
              <article className="panel api-reference-panel">
                <div className="panel-heading"><div><h2>Add mail address</h2><p>Public endpoint; no Authorization header is checked.</p></div><span className="method-pill">POST</span></div>
                <div className="endpoint-line"><code>/v1/addmailaddress</code><span>application/json or multipart/form-data</span></div>
                <pre className="api-code"><code>{`{
  "email": "example@et.com",
  "country": "united states",
  "ownerEmail": "account@example.com"
}`}</code></pre>
                <p className="api-note">No bearer authorization is required. Include <code>ownerEmail</code> to select the account; it may be omitted only when this database has exactly one account. Blank or unknown countries are saved as <strong>Other</strong>. Duplicate email addresses return HTTP 409. Anyone who can reach this endpoint can add to the selected account.</p>
                <h3>Example request</h3>
                <pre className="api-code"><code>{`curl -X POST http://localhost:5173/v1/addmailaddress \\
  -H "Content-Type: application/json" \
  -d '{"email":"example@et.com","country":"united states","ownerEmail":"account@example.com"}'`}</code></pre>
                <h3>Form-data fields</h3>
                <dl className="api-fields"><div><dt>email</dt><dd>example@et.com</dd></div><div><dt>country</dt><dd>united states, or blank to use Other</dd></div><div><dt>ownerEmail</dt><dd>account@example.com, needed when multiple accounts exist</dd></div></dl>
                <pre className="api-code"><code>{`curl -X POST http://localhost:5173/v1/addmailaddress \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -F "email=example@et.com" \\
  -F "country=united states" \\
  -F "ownerEmail=account@example.com"`}</code></pre>
              </article>
              <article className="panel api-try-panel">
                <div className="panel-heading"><div><h2>Try this request</h2><p>Sends a live request using your current session.</p></div></div>
                <div className="api-format-switch" role="group" aria-label="Request body format">
                  <button type="button" className={apiFormat === "formdata" ? "active" : ""} onClick={() => setApiFormat("formdata")}>Form-data</button>
                  <button type="button" className={apiFormat === "json" ? "active" : ""} onClick={() => setApiFormat("json")}>JSON</button>
                </div>
                <form className="api-try-form" onSubmit={testAddAddressApi}>
                  <label>Email address<input type="email" value={apiEmail} onChange={(event) => setApiEmail(event.target.value)} placeholder="example@et.com" required /></label>
                  <label>Country (optional)<input value={apiCountry} onChange={(event) => setApiCountry(event.target.value)} placeholder="Leave blank to use Other" /></label>
                  <button className="primary-btn" type="submit" disabled={apiBusy}>{apiBusy ? "Sending..." : "Send API request"}</button>
                </form>
                {apiResponse && <pre className="api-code api-response"><code>{apiResponse}</code></pre>}
              </article>
            </section>
          )}
          <footer className="page-footer">
            <span>POSTMARK · ADDRESS OPERATIONS</span>
            <span>
              <span className="online-dot" /> MongoDB-backed workspace
            </span>
          </footer>
        </div>
      </main>
      {showExport && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowExport(false);
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="export-title"
          >
            <div className="modal-heading">
              <span className="modal-icon">
                <ArrowDownToLine size={18} />
              </span>
              <button
                className="icon-btn"
                onClick={() => setShowExport(false)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <span className="eyebrow">CSV EXPORT</span>
            <h2 id="export-title">Choose an address range</h2>
            <p>
              Export by position in the currently sorted address list.
              There are {allFilteredAddresses.length} matching addresses.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const start = Number(rangeStart);
                const end = Number(rangeEnd);
                const ids = allFilteredAddresses
                  .slice(start - 1, end)
                  .map((address) => address.id);
                void exportCsv({ ids });
              }}
            >
              <div className="range-fields">
                <label>
                  From
                  <input
                    type="number"
                    min="1"
                    max={allFilteredAddresses.length}
                    value={rangeStart}
                    onChange={(event) => setRangeStart(event.target.value)}
                    required
                  />
                </label>
                <span>to</span>
                <label>
                  Through
                  <input
                    type="number"
                    min={rangeStart || 1}
                    max={allFilteredAddresses.length}
                    value={rangeEnd}
                    onChange={(event) => setRangeEnd(event.target.value)}
                    required
                  />
                </label>
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setShowExport(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="primary-btn">
                  <ArrowDownToLine size={16} /> Export range
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {showAdd && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowAdd(false);
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-title"
          >
            <div className="modal-heading">
              <span className="modal-icon">
                <Plus size={18} />
              </span>
              <button
                className="icon-btn"
                onClick={() => setShowAdd(false)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <span className="eyebrow">ADDRESS BOOK</span>
            <h2 id="add-title">Add an address</h2>
            <p>
              Add a contact to your workspace. Duplicate emails are
              automatically flagged.
            </p>
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                const error = await addAddress(emailInput, countryInput);
                if (error) {
                  setNotice(error);
                  return;
                }
                setEmailInput("");
                setShowAdd(false);
                setNotice("Address added successfully.");
              }}
            >
              <label>
                Email address
                <input
                  autoFocus
                  type="email"
                  placeholder="name@example.com"
                  value={emailInput}
                  onChange={(event) => setEmailInput(event.target.value)}
                  required
                />
              </label>
              <label>
                Country
                <select
                  value={countryInput}
                  onChange={(event) => setCountryInput(event.target.value)}
                >
                  {countries.map((country) => (
                    <option key={country}>{country}</option>
                  ))}
                </select>
              </label>
              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setShowAdd(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="primary-btn">
                  <Plus size={16} /> Add address
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

function Metric({
  icon,
  color,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  color: string;
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <article className="metric-card">
      <div className="metric-top">
        <span className={`metric-icon ${color}`}>{icon}</span>
        <span className="metric-change">TODAY</span>
      </div>
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value.toLocaleString()}</strong>
      <span className="metric-detail">{detail}</span>
    </article>
  );
}
function Pagination({
  page,
  pageCount,
  total,
  pageSize,
  onPageSizeChange,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
  onPageChange: (page: number) => void;
}) {
  const effectivePageSize = pageSize === 0 ? Math.max(total, 1) : pageSize;
  if (total <= effectivePageSize && pageSize !== 0) return <div className="pagination page-size-only"><label>Rows per page<select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>{PAGE_SIZE_OPTIONS.map((size) => <option value={size} key={size}>{size}</option>)}<option value={0}>All</option></select></label><span>Showing {total} rows</span></div>;
  const firstRow = total === 0 ? 0 : (page - 1) * effectivePageSize + 1;
  const lastRow = Math.min(page * effectivePageSize, total);
  const commitPage = (value: string, input: HTMLInputElement) => {
    const target = Number(value);
    if (Number.isInteger(target) && target >= 1 && target <= pageCount) onPageChange(target);
    else input.value = String(page);
  };
  return (
    <nav className="pagination" aria-label="Table pages">
      <span>
        Showing {firstRow}-{lastRow} of {total}
      </span>
      <div className="pagination-actions">
        <label className="page-size-select">Rows per page<select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>{PAGE_SIZE_OPTIONS.map((size) => <option value={size} key={size}>{size}</option>)}<option value={0}>All</option></select></label>
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          Previous
        </button>
        <label className="page-jump">
          Page
          <input
            key={page}
            type="number"
            min={1}
            max={pageCount}
            defaultValue={page}
            aria-label={`Page number, current page ${page} of ${pageCount}`}
            onBlur={(event) => commitPage(event.currentTarget.value, event.currentTarget)}
            onKeyDown={(event) => { if (event.key === "Enter") commitPage(event.currentTarget.value, event.currentTarget); }}
          />
          <span>of {pageCount}</span>
        </label>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pageCount}
          aria-label="Next page"
        >
          Next
        </button>
      </div>
    </nav>
  );
}
function EventTable({ events, sortField, sortDirection, onSort }: { events: EventRow[]; sortField: HistorySortField; sortDirection: "asc" | "desc"; onSort: (field: HistorySortField) => void }) {
  const sortMark = (field: HistorySortField) => sortField === field ? sortDirection === "asc" ? "↑" : "↓" : "↕";
  return (
    <table className="event-table">
      <thead>
        <tr>
          <th aria-sort={sortField === "type" ? sortDirection === "asc" ? "ascending" : "descending" : "none"}><button className="sort-button" onClick={() => onSort("type")}>Action type {sortMark("type")}</button></th>
          <th aria-sort={sortField === "description" ? sortDirection === "asc" ? "ascending" : "descending" : "none"}><button className="sort-button" onClick={() => onSort("description")}>Description {sortMark("description")}</button></th>
          <th aria-sort={sortField === "at" ? sortDirection === "asc" ? "ascending" : "descending" : "none"}><button className="sort-button" onClick={() => onSort("at")}>Date {sortMark("at")}</button></th>
        </tr>
      </thead>
      <tbody>
        {events.map((event) => (
          <tr key={event.id}>
            <td>
              <span className={`event-kind ${event.type.toLowerCase().replaceAll(" ", "-")}`}>
                <i />
                {event.type}
              </span>
            </td>
            <td className="event-email">
              {event.description || (event.type === "Import" ? (
                <span className="import-summary">
                  <strong>{event.totalCount || 0} rows</strong>
                  <span>{event.quantity || 0} added · {event.duplicateCount || 0} duplicates{event.invalidCount ? ` · ${event.invalidCount} invalid` : ""}</span>
                </span>
              ) : event.type === "Added" ? `Added ${event.email} (${event.country})` : event.type === "Removed" ? `Removed ${event.email} (${event.country})` : event.type === "Reply" ? `Marked ${event.email} as replied` : event.type === "Output" ? `Exported ${event.quantity || 0} email addresses` : event.email)}
            </td>
            <td className="event-date">
              {new Date(event.at).toLocaleString("en", {
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </td>
          </tr>
        ))}
      </tbody>
      {events.length === 0 && (
        <tbody>
          <tr>
            <td colSpan={3}>
              <EmptyState
                icon={<FileClock size={20} />}
                title="No activity yet"
                detail="Your address changes, exports, and replies will appear here."
              />
            </td>
          </tr>
        </tbody>
      )}
    </table>
  );
}
function EmptyState({
  icon,
  title,
  detail,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">{icon}</span>
      <strong>{title}</strong>
      <p>{detail}</p>
      {action}
    </div>
  );
}

export default App;
