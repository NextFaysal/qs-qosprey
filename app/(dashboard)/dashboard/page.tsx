"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { campaignStatusConfig, formatDate } from "@/app/_lib/utils";

interface Account {
  id: string;
  name: string;
  token: string;
  domain: string | null;
  remoteUsername: string | null;
  remoteUserId: number | null;
  balance: string | null;
  isDefault: boolean;
  createdAt: string;
  _count?: { campaigns: number };
}

interface UserDomain {
  id: string;
  name: string | null;
  url: string;
  isDefault: boolean;
  createdAt: string;
}

interface CampaignLog {
  id: string;
  campaignId: string;
  event: string;
  detail: string;
  createdAt: string;
}

interface Campaign {
  id: string;
  domain: string | null;
  bins: string;
  minPrice: number | null;
  maxPrice: number | null;
  quantity: number;
  baseId: string | null;
  productDate: string | null;
  productEndDate: string | null;
  publishTime: string;
  mode: "CHECK_ONLY" | "AUTO_BUY";
  isCheck: number;
  status: string;
  matchedIds: string[];
  cartIds: string[];
  purchasedIds: string[];
  settlementMsg: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
  accountId: string | null;
  account?: {
    id: string;
    name: string;
    remoteUsername: string | null;
    balance: string | null;
  } | null;
  _count: { logs: number };
}

interface CartItem {
  id: number;
  card_id: number;
  user_id?: number;
  createtime?: number;
}

// Live Countdown Timer Component for Campaign Card
function CampaignCountdown({
  publishTime,
  status,
}: {
  publishTime: string;
  status: string;
}) {
  const [timeLeft, setTimeLeft] = useState<{
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
    isPast: boolean;
  } | null>(null);

  useEffect(() => {
    function calculate() {
      // Polling worker starts 120s (2 minutes) before publishTime
      const target = new Date(publishTime).getTime() - 120 * 1000;
      const diff = target - Date.now();

      if (diff <= 0) {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0, isPast: true });
      } else {
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
        const minutes = Math.floor((diff / (1000 * 60)) % 60);
        const seconds = Math.floor((diff / 1000) % 60);
        setTimeLeft({ days, hours, minutes, seconds, isPast: false });
      }
    }

    calculate();
    const timer = setInterval(calculate, 1000);
    return () => clearInterval(timer);
  }, [publishTime]);

  if (status === "POLLING") {
    return (
      <div className="countdown-widget polling">
        <span className="pulse-dot" style={{ background: "var(--color-accent-light)", width: "8px", height: "8px" }} />
        <span>⚡ <strong>Active Polling:</strong> Checking API every 500ms</span>
      </div>
    );
  }

  if (status === "SUCCESS") {
    return (
      <div className="countdown-widget success">
        <span>🎉</span>
        <span><strong>Completed:</strong> Auto-Bought & Settled!</span>
      </div>
    );
  }

  if (status === "EXPIRED") {
    return (
      <div
        className="countdown-widget"
        style={{
          borderColor: "rgba(239, 68, 68, 0.3)",
          background: "rgba(239, 68, 68, 0.08)",
          color: "var(--color-danger)",
        }}
      >
        <span>⏰</span>
        <span>
          <strong>সময় সমাপ্ত:</strong> ৫ মিনিটে কোনো ম্যাচিং প্রোডাক্ট পাওয়া যায়নি
        </span>
      </div>
    );
  }

  if (status === "CANCELLED" || status === "FAILED") {
    return null;
  }

  if (!timeLeft) return null;

  if (timeLeft.isPast) {
    return (
      <div className="countdown-widget polling">
        <span className="pulse-dot" style={{ background: "var(--color-warning)", width: "8px", height: "8px" }} />
        <span>⏳ <strong>Starting soon:</strong> Preparing polling engine...</span>
      </div>
    );
  }

  return (
    <div className="countdown-widget">
      <span>⏱️</span>
      <span>Starts in:</span>
      <span className="countdown-digits">
        {timeLeft.days > 0 ? `${timeLeft.days}d ` : ""}
        {String(timeLeft.hours).padStart(2, "0")}h :{" "}
        {String(timeLeft.minutes).padStart(2, "0")}m :{" "}
        {String(timeLeft.seconds).padStart(2, "0")}s
      </span>
    </div>
  );
}

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<"campaigns" | "accounts" | "domains">("campaigns");

  // Data states
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [domains, setDomains] = useState<UserDomain[]>([]);
  const [systemDefaultDomain, setSystemDefaultDomain] = useState("https://api.pepecards2f7z1qtyyg.top");

  // Loading states
  const [loading, setLoading] = useState(true);
  const [campaignSubmitting, setCampaignSubmitting] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [accountSubmitting, setAccountSubmitting] = useState(false);
  const [domainSubmitting, setDomainSubmitting] = useState(false);
  const [reverifyingId, setReverifyingId] = useState<string | null>(null);

  // Search & Filter states
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  // Modals
  const [showCampaignModal, setShowCampaignModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showDomainModal, setShowDomainModal] = useState(false);

  // Inspector Modal State
  const [inspectingCampaign, setInspectingCampaign] = useState<Campaign | null>(null);
  const [inspectorTab, setInspectorTab] = useState<"overview" | "cart" | "logs">("overview");
  const [campaignLogs, setCampaignLogs] = useState<CampaignLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // Cart Manager Modal State
  const [showCartModal, setShowCartModal] = useState(false);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [cartLoading, setCartLoading] = useState(false);
  const [selectedCartAccountId, setSelectedCartAccountId] = useState<string>("");
  const [clearingCart, setClearingCart] = useState(false);

  // Token visibility toggle map: { [accountId]: boolean }
  const [showTokenMap, setShowTokenMap] = useState<Record<string, boolean>>({});

  // Toast
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  // Campaign Create Form
  const [campaignForm, setCampaignForm] = useState({
    accountId: "",
    domain: "",
    bins: "",
    minPrice: "",
    maxPrice: "",
    quantity: "1",
    baseId: "",
    productDate: "",
    productEndDate: "",
    publishTime: "",
    isCheck: 1, // 1 = ON, 2 = OFF
  });

  // Campaign Edit Form
  const [editForm, setEditForm] = useState({
    id: "",
    accountId: "",
    domain: "",
    bins: "",
    minPrice: "",
    maxPrice: "",
    quantity: "1",
    baseId: "",
    productDate: "",
    productEndDate: "",
    publishTime: "",
    isCheck: 1,
  });

  // Account Form
  const [accountForm, setAccountForm] = useState({
    name: "",
    token: "",
    domain: "",
  });

  // Domain Form
  const [domainForm, setDomainForm] = useState({
    name: "",
    url: "",
  });

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }

  // Copy to clipboard helper
  function copyText(text: string, label = "Copied") {
    navigator.clipboard.writeText(text);
    showToast(`${label} to clipboard! 📋`, "success");
  }

  // Fetch Campaigns
  const fetchCampaigns = useCallback(async () => {
    try {
      const res = await fetch("/api/campaigns");
      if (res.ok) {
        const data = await res.json();
        setCampaigns(data.campaigns || []);
      }
    } catch (err) {
      console.error("Failed to fetch campaigns:", err);
    }
  }, []);

  // Fetch Accounts
  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/accounts");
      if (res.ok) {
        const data = await res.json();
        setAccounts(data.accounts || []);
      }
    } catch (err) {
      console.error("Failed to fetch accounts:", err);
    }
  }, []);

  // Fetch Domains
  const fetchDomains = useCallback(async () => {
    try {
      const res = await fetch("/api/domains");
      if (res.ok) {
        const data = await res.json();
        setDomains(data.domains || []);
        if (data.defaultDomain) setSystemDefaultDomain(data.defaultDomain);
      }
    } catch (err) {
      console.error("Failed to fetch domains:", err);
    }
  }, []);

  // Fetch Live Logs for Campaign
  const fetchLogs = useCallback(async (id: string) => {
    setLogsLoading(true);
    try {
      const res = await fetch(`/api/campaigns/${id}/logs?pageSize=100`);
      if (res.ok) {
        const data = await res.json();
        setCampaignLogs(data.logs || []);
      }
    } catch (err) {
      console.error("Failed to fetch logs:", err);
    } finally {
      setLogsLoading(false);
    }
  }, []);

  // Open Inspector Modal
  function openInspector(campaign: Campaign, defaultSubtab: "overview" | "cart" | "logs" = "overview") {
    setInspectingCampaign(campaign);
    setInspectorTab(defaultSubtab);
    fetchLogs(campaign.id);
  }

  // Fetch Live Remote Cart Items
  const fetchCartItems = useCallback(async (accountId?: string) => {
    setCartLoading(true);
    try {
      const query = accountId ? `?accountId=${accountId}` : "";
      const res = await fetch(`/api/cart${query}`);
      if (res.ok) {
        const data = await res.json();
        setCartItems(data.items || []);
      } else {
        setCartItems([]);
      }
    } catch (err) {
      console.error("Failed to fetch cart items:", err);
    } finally {
      setCartLoading(false);
    }
  }, []);

  // Open Cart Manager Modal
  function openCartManager(accId?: string) {
    const targetAccId = accId || (accounts.find((a) => a.isDefault)?.id || accounts[0]?.id || "");
    setSelectedCartAccountId(targetAccId);
    setShowCartModal(true);
    fetchCartItems(targetAccId);
  }

  // Handle Clear Remote Cart
  async function handleClearCart() {
    if (!confirm("Are you sure you want to remove ALL products from this remote account cart?")) return;
    setClearingCart(true);
    try {
      const query = selectedCartAccountId ? `?accountId=${selectedCartAccountId}` : "";
      const res = await fetch(`/api/cart${query}`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message || "Cart emptied successfully! 🗑️", "success");
        fetchCartItems(selectedCartAccountId);
      } else {
        showToast(data.error || "Failed to empty cart", "error");
      }
    } catch {
      showToast("Request failed", "error");
    } finally {
      setClearingCart(false);
    }
  }

  // Initial Load
  useEffect(() => {
    Promise.all([fetchCampaigns(), fetchAccounts(), fetchDomains()]).finally(() => {
      setLoading(false);
    });

    const interval = setInterval(() => {
      fetchCampaigns();
    }, 4000);
    return () => clearInterval(interval);
  }, [fetchCampaigns, fetchAccounts, fetchDomains]);

  // Open Campaign Create Modal & Auto-Select Account
  function openCampaignModal() {
    let preselectedAccountId = "";
    let preselectedDomain = "";

    if (accounts.length === 1) {
      preselectedAccountId = accounts[0].id;
      preselectedDomain = accounts[0].domain || systemDefaultDomain;
    } else if (accounts.length > 1) {
      const defaultAcc = accounts.find((a) => a.isDefault) || accounts[0];
      preselectedAccountId = defaultAcc.id;
      preselectedDomain = defaultAcc.domain || systemDefaultDomain;
    } else {
      preselectedDomain = systemDefaultDomain;
    }

    const todayDate = new Date().toISOString().slice(0, 10);

    setCampaignForm({
      accountId: preselectedAccountId,
      domain: preselectedDomain,
      bins: "",
      minPrice: "",
      maxPrice: "",
      quantity: "1",
      baseId: "",
      productDate: todayDate,
      productEndDate: "",
      publishTime: "",
      isCheck: 1,
    });
    setShowCampaignModal(true);
  }

  // Open Campaign Edit Modal
  function openEditModal(campaign: Campaign) {
    let formattedPublishTime = "";
    try {
      const d = new Date(campaign.publishTime);
      formattedPublishTime = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
    } catch {
      formattedPublishTime = campaign.publishTime;
    }

    setEditForm({
      id: campaign.id,
      accountId: campaign.accountId || "",
      domain: campaign.domain || systemDefaultDomain,
      bins: campaign.bins,
      minPrice: campaign.minPrice !== null && campaign.minPrice !== undefined ? String(campaign.minPrice) : "",
      maxPrice: campaign.maxPrice !== null && campaign.maxPrice !== undefined ? String(campaign.maxPrice) : "",
      quantity: String(campaign.quantity),
      baseId: campaign.baseId || "",
      productDate: campaign.productDate || "",
      productEndDate: campaign.productEndDate || "",
      publishTime: formattedPublishTime,
      isCheck: campaign.isCheck ?? 1,
    });
    setShowEditModal(true);
  }

  // Handle Create Campaign
  async function handleCreateCampaign(e: React.FormEvent) {
    e.preventDefault();
    setCampaignSubmitting(true);

    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(campaignForm),
      });

      const data = await res.json();

      if (!res.ok) {
        showToast(data.error || "Failed to create campaign", "error");
        setCampaignSubmitting(false);
        return;
      }

      showToast("Auto-Buy Campaign created successfully! 🎉", "success");
      setShowCampaignModal(false);
      fetchCampaigns();
    } catch {
      showToast("Something went wrong", "error");
    } finally {
      setCampaignSubmitting(false);
    }
  }

  // Handle Edit Campaign Submit
  async function handleUpdateCampaign(e: React.FormEvent) {
    e.preventDefault();
    setEditSubmitting(true);

    try {
      const res = await fetch(`/api/campaigns/${editForm.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });

      const data = await res.json();

      if (!res.ok) {
        showToast(data.error || "Failed to update campaign", "error");
        setEditSubmitting(false);
        return;
      }

      showToast("Campaign updated successfully! ✏️", "success");
      setShowEditModal(false);
      fetchCampaigns();
    } catch {
      showToast("Something went wrong updating campaign", "error");
    } finally {
      setEditSubmitting(false);
    }
  }

  // Handle Cancel Campaign
  async function handleCancelCampaign(id: string) {
    if (!confirm("Are you sure you want to cancel this campaign?")) return;

    try {
      const res = await fetch(`/api/campaigns/${id}`, { method: "DELETE" });
      if (res.ok) {
        showToast("Campaign cancelled 🚫", "success");
        fetchCampaigns();
      } else {
        const data = await res.json();
        showToast(data.error || "Failed to cancel", "error");
      }
    } catch {
      showToast("Something went wrong", "error");
    }
  }

  // Handle Delete Campaign Permanently
  async function handleDeleteCampaign(id: string) {
    if (!confirm("Are you sure you want to permanently delete this campaign?")) return;

    try {
      const res = await fetch(`/api/campaigns/${id}?permanent=true`, { method: "DELETE" });
      if (res.ok) {
        showToast("Campaign deleted permanently 🗑️", "success");
        fetchCampaigns();
        if (inspectingCampaign?.id === id) setInspectingCampaign(null);
      } else {
        const data = await res.json();
        showToast(data.error || "Failed to delete campaign", "error");
      }
    } catch {
      showToast("Something went wrong", "error");
    }
  }

  // Handle Create Account
  async function handleCreateAccount(e: React.FormEvent) {
    e.preventDefault();
    setAccountSubmitting(true);

    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(accountForm),
      });

      const data = await res.json();

      if (!res.ok) {
        showToast(data.error || "Token verification failed", "error");
        setAccountSubmitting(false);
        return;
      }

      showToast(
        `Account verified & added! (User: @${data.account.remoteUsername || "OK"}, Balance: $${data.account.balance || "0"}) 🎉`,
        "success"
      );
      setShowAccountModal(false);
      setAccountForm({ name: "", token: "", domain: "" });
      fetchAccounts();
    } catch {
      showToast("Failed to connect to verification API", "error");
    } finally {
      setAccountSubmitting(false);
    }
  }

  // Handle Delete Account
  async function handleDeleteAccount(id: string, name: string) {
    if (!confirm(`Are you sure you want to remove account "${name}"?`)) return;

    try {
      const res = await fetch(`/api/accounts/${id}`, { method: "DELETE" });
      if (res.ok) {
        showToast("Account removed", "success");
        fetchAccounts();
      } else {
        const data = await res.json();
        showToast(data.error || "Failed to delete account", "error");
      }
    } catch {
      showToast("Something went wrong", "error");
    }
  }

  // Handle Set Default Account
  async function handleSetDefaultAccount(id: string) {
    try {
      const res = await fetch(`/api/accounts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDefault: true }),
      });
      if (res.ok) {
        showToast("Default account updated ★", "success");
        fetchAccounts();
      }
    } catch {
      showToast("Failed to update default account", "error");
    }
  }

  // Handle Re-verify Account
  async function handleReverifyAccount(id: string) {
    setReverifyingId(id);
    try {
      const res = await fetch(`/api/accounts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reverify: true }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(
          `Verified: @${data.account.remoteUsername} (Balance: $${data.account.balance})`,
          "success"
        );
        fetchAccounts();
      } else {
        showToast(data.error || "Re-verification failed", "error");
      }
    } catch {
      showToast("Re-verification request failed", "error");
    } finally {
      setReverifyingId(null);
    }
  }

  // Handle Create Domain
  async function handleCreateDomain(e: React.FormEvent) {
    e.preventDefault();
    setDomainSubmitting(true);

    try {
      const res = await fetch("/api/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(domainForm),
      });

      const data = await res.json();

      if (!res.ok) {
        showToast(data.error || "Failed to save domain", "error");
        setDomainSubmitting(false);
        return;
      }

      showToast("Domain added successfully! 🌐", "success");
      setShowDomainModal(false);
      setDomainForm({ name: "", url: "" });
      fetchDomains();
    } catch {
      showToast("Failed to save domain", "error");
    } finally {
      setDomainSubmitting(false);
    }
  }

  // Handle Delete Domain
  async function handleDeleteDomain(id: string) {
    if (!confirm("Are you sure you want to remove this domain?")) return;

    try {
      const res = await fetch(`/api/domains/${id}`, { method: "DELETE" });
      if (res.ok) {
        showToast("Domain removed", "success");
        fetchDomains();
      } else {
        const data = await res.json();
        showToast(data.error || "Failed to delete domain", "error");
      }
    } catch {
      showToast("Something went wrong", "error");
    }
  }

  // Filtered Campaigns
  const filteredCampaigns = useMemo(() => {
    return campaigns.filter((c) => {
      // Status filter
      if (statusFilter !== "ALL" && c.status !== statusFilter) {
        return false;
      }
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchBin = c.bins.toLowerCase().includes(q);
        const matchAcc = c.account?.name?.toLowerCase().includes(q);
        const matchUser = c.account?.remoteUsername?.toLowerCase().includes(q);
        const matchId = c.id.toLowerCase().includes(q);
        if (!matchBin && !matchAcc && !matchUser && !matchId) return false;
      }
      return true;
    });
  }, [campaigns, statusFilter, searchQuery]);

  // Stats
  const stats = {
    total: campaigns.length,
    active: campaigns.filter((c) => ["SCHEDULED", "POLLING"].includes(c.status)).length,
    success: campaigns.filter((c) => c.status === "SUCCESS").length,
    failed: campaigns.filter((c) => ["FAILED", "EXPIRED"].includes(c.status)).length,
  };

  return (
    <>
      {/* Toast Notification */}
      {toast && (
        <div className={`toast toast-${toast.type}`}>
          <span>{toast.type === "success" ? "✅" : "❌"}</span>
          {toast.message}
        </div>
      )}

      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 style={{ fontSize: "24px", fontWeight: 700, letterSpacing: "-0.02em" }}>
            PepeShops Dashboard
          </h1>
          <p
            style={{
              fontSize: "14px",
              color: "var(--color-text-muted)",
              marginTop: "4px",
            }}
          >
            Automated product monitoring, multi-quantity cart addition, and instant settlement order execution.
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button
            className="btn btn-secondary"
            onClick={() => openCartManager()}
            title="Inspect and clear remote account cart"
          >
            <span>🛒</span> Remote Cart
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => setShowAccountModal(true)}
          >
            <span>👤</span> + Add Account
          </button>
          <button
            className="btn btn-primary"
            onClick={openCampaignModal}
            id="add-campaign-btn"
          >
            <span>📦</span> + Add Product Request
          </button>
        </div>
      </div>

      {/* Page Body */}
      <div className="page-body">
        {/* Navigation Tabs */}
        <div className="tabs-nav">
          <button
            className={`tab-btn ${activeTab === "campaigns" ? "active" : ""}`}
            onClick={() => setActiveTab("campaigns")}
          >
            <span>📦</span>
            <span>Campaigns</span>
            <span className="tab-badge">{campaigns.length}</span>
          </button>
          <button
            className={`tab-btn ${activeTab === "accounts" ? "active" : ""}`}
            onClick={() => setActiveTab("accounts")}
          >
            <span>👤</span>
            <span>API Accounts</span>
            <span className="tab-badge">{accounts.length}</span>
          </button>
          <button
            className={`tab-btn ${activeTab === "domains" ? "active" : ""}`}
            onClick={() => setActiveTab("domains")}
          >
            <span>🌐</span>
            <span>Domains</span>
            <span className="tab-badge">{domains.length + 1}</span>
          </button>
        </div>

        {/* TAB 1: CAMPAIGNS */}
        {activeTab === "campaigns" && (
          <div>
            {/* Stats Bar */}
            <div className="stats-grid" style={{ marginBottom: "20px" }}>
              <div className="stat-card" style={{ cursor: "pointer" }} onClick={() => setStatusFilter("ALL")}>
                <div className="stat-label">Total Campaigns</div>
                <div className="stat-value" style={{ color: "var(--color-primary-light)" }}>
                  {stats.total}
                </div>
              </div>
              <div className="stat-card" style={{ cursor: "pointer" }} onClick={() => setStatusFilter("POLLING")}>
                <div className="stat-label">Active / Polling</div>
                <div className="stat-value" style={{ color: "var(--color-accent)" }}>
                  {stats.active}
                </div>
              </div>
              <div className="stat-card" style={{ cursor: "pointer" }} onClick={() => setStatusFilter("SUCCESS")}>
                <div className="stat-label">Purchased / Success</div>
                <div className="stat-value" style={{ color: "var(--color-success)" }}>
                  {stats.success}
                </div>
              </div>
              <div className="stat-card" style={{ cursor: "pointer" }} onClick={() => setStatusFilter("FAILED")}>
                <div className="stat-label">Failed / Expired</div>
                <div className="stat-value" style={{ color: "var(--color-danger)" }}>
                  {stats.failed}
                </div>
              </div>
            </div>

            {/* Advanced Search & Filter Toolbar */}
            <div className="filter-toolbar">
              <div className="filter-pills">
                <button
                  className={`filter-pill ${statusFilter === "ALL" ? "active" : ""}`}
                  onClick={() => setStatusFilter("ALL")}
                >
                  All ({campaigns.length})
                </button>
                <button
                  className={`filter-pill ${statusFilter === "SCHEDULED" ? "active" : ""}`}
                  onClick={() => setStatusFilter("SCHEDULED")}
                >
                  ⏳ Scheduled
                </button>
                <button
                  className={`filter-pill ${statusFilter === "POLLING" ? "active" : ""}`}
                  onClick={() => setStatusFilter("POLLING")}
                >
                  ⚡ Polling
                </button>
                <button
                  className={`filter-pill ${statusFilter === "SUCCESS" ? "active" : ""}`}
                  onClick={() => setStatusFilter("SUCCESS")}
                >
                  ✅ Success
                </button>
                <button
                  className={`filter-pill ${statusFilter === "EXPIRED" ? "active" : ""}`}
                  onClick={() => setStatusFilter("EXPIRED")}
                >
                  ⏰ Expired
                </button>
                <button
                  className={`filter-pill ${statusFilter === "FAILED" ? "active" : ""}`}
                  onClick={() => setStatusFilter("FAILED")}
                >
                  ❌ Failed
                </button>
              </div>

              <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                <div className="search-input-wrapper">
                  <span className="search-icon">🔍</span>
                  <input
                    type="text"
                    className="input"
                    placeholder="Search by Bin, account..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{ fontSize: "13px", height: "36px" }}
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      style={{
                        position: "absolute",
                        right: "10px",
                        top: "50%",
                        transform: "translateY(-50%)",
                        background: "none",
                        border: "none",
                        color: "var(--color-text-muted)",
                        cursor: "pointer",
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>

                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => fetchCampaigns()}
                  title="Refresh campaigns"
                  style={{ height: "36px", padding: "0 12px" }}
                >
                  🔄
                </button>
              </div>
            </div>

            {loading ? (
              <div className="campaign-grid">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="skeleton"
                    style={{ height: "220px", borderRadius: "var(--radius-lg)" }}
                  />
                ))}
              </div>
            ) : filteredCampaigns.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">📦</div>
                <div className="empty-state-title">
                  {searchQuery || statusFilter !== "ALL"
                    ? "No matching campaigns found"
                    : "No campaigns active"}
                </div>
                <div className="empty-state-desc">
                  {searchQuery || statusFilter !== "ALL"
                    ? "Try clearing your filters or search query."
                    : "Create your first product request. If you have an account added, it will be automatically linked!"}
                </div>
                <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
                  {searchQuery || statusFilter !== "ALL" ? (
                    <button
                      className="btn btn-secondary"
                      onClick={() => {
                        setStatusFilter("ALL");
                        setSearchQuery("");
                      }}
                    >
                      Reset Filters
                    </button>
                  ) : (
                    <button className="btn btn-primary" onClick={openCampaignModal}>
                      + Add Product Request
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="campaign-grid">
                {filteredCampaigns.map((campaign) => {
                  const statusCfg =
                    campaignStatusConfig[campaign.status] ||
                    campaignStatusConfig.SCHEDULED;

                  // Price format
                  let priceDisplay = "Any Price";
                  if (campaign.minPrice !== null && campaign.maxPrice !== null) {
                    priceDisplay = `$${campaign.minPrice} — $${campaign.maxPrice}`;
                  } else if (campaign.minPrice !== null) {
                    priceDisplay = `≥ $${campaign.minPrice}`;
                  } else if (campaign.maxPrice !== null) {
                    priceDisplay = `≤ $${campaign.maxPrice}`;
                  }

                  return (
                    <div key={campaign.id} className="campaign-card">
                      <div className="campaign-card-header">
                        <div>
                          <div
                            style={{
                              fontSize: "17px",
                              fontWeight: 700,
                              marginBottom: "4px",
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                            }}
                          >
                            <span>Bin: {campaign.bins}</span>
                            {campaign.status === "POLLING" && (
                              <span
                                className="pulse-dot"
                                style={{
                                  background: statusCfg.color,
                                  display: "inline-block",
                                }}
                              />
                            )}
                          </div>

                          <div
                            style={{
                              fontSize: "12px",
                              color: "var(--color-text-muted)",
                              display: "flex",
                              gap: "6px",
                              alignItems: "center",
                              flexWrap: "wrap",
                            }}
                          >
                            <span
                              style={{
                                background: campaign.isCheck === 2 ? "rgba(245, 158, 11, 0.15)" : "rgba(16, 185, 129, 0.15)",
                                color: campaign.isCheck === 2 ? "var(--color-warning)" : "var(--color-success)",
                                padding: "1px 6px",
                                borderRadius: "var(--radius-sm)",
                                fontSize: "11px",
                                fontWeight: 700,
                              }}
                            >
                              {campaign.isCheck === 2 ? "⚡ Check: OFF" : "🛡️ Check: ON"}
                            </span>

                            <span
                              style={{
                                background: "rgba(99, 102, 241, 0.15)",
                                color: "var(--color-primary-light)",
                                padding: "1px 6px",
                                borderRadius: "var(--radius-sm)",
                                fontSize: "11px",
                                fontWeight: 600,
                              }}
                            >
                              📦 Qty: {campaign.quantity}
                            </span>

                            {campaign.productDate && (
                              <span
                                style={{
                                  background: "rgba(59, 130, 246, 0.15)",
                                  color: "var(--color-info)",
                                  padding: "1px 6px",
                                  borderRadius: "var(--radius-sm)",
                                  fontSize: "11px",
                                  fontWeight: 600,
                                }}
                              >
                                📅 ≥ {campaign.productDate}
                              </span>
                            )}

                            {campaign.account && (
                              <span
                                style={{
                                  background: "rgba(255, 255, 255, 0.05)",
                                  color: "var(--color-text-secondary)",
                                  padding: "1px 6px",
                                  borderRadius: "var(--radius-sm)",
                                  fontSize: "11px",
                                }}
                              >
                                👤 {campaign.account.name}
                              </span>
                            )}
                          </div>
                        </div>

                        <span
                          className="badge"
                          style={{
                            color: statusCfg.color,
                            background: statusCfg.bgColor,
                          }}
                        >
                          {statusCfg.emoji} {statusCfg.label}
                        </span>
                      </div>

                      {/* LIVE COUNTDOWN TIMER ON CARD */}
                      <CampaignCountdown
                        publishTime={campaign.publishTime}
                        status={campaign.status}
                      />

                      <div className="campaign-card-body">
                        <div className="campaign-detail">
                          <span className="campaign-detail-label">Price Range</span>
                          <span className="campaign-detail-value">
                            {priceDisplay}
                          </span>
                        </div>
                        <div className="campaign-detail">
                          <span className="campaign-detail-label">Quantity</span>
                          <span className="campaign-detail-value" style={{ fontWeight: 700, color: "var(--color-text-primary)" }}>
                            {campaign.quantity} card(s)
                          </span>
                        </div>
                        <div className="campaign-detail">
                          <span className="campaign-detail-label">Base ID</span>
                          <span className="campaign-detail-value">
                            {campaign.baseId || "Any"}
                          </span>
                        </div>
                        <div className="campaign-detail">
                          <span className="campaign-detail-label">Publish Time</span>
                          <span className="campaign-detail-value">
                            {formatDate(campaign.publishTime)}
                          </span>
                        </div>

                        {campaign.productDate && (
                          <div className="campaign-detail" style={{ gridColumn: "1 / -1" }}>
                            <span className="campaign-detail-label">Release Date Filter</span>
                            <span
                              className="campaign-detail-value"
                              style={{
                                color: "var(--color-accent-light)",
                                fontWeight: 600,
                              }}
                            >
                              <code>sname</code> ≥ {campaign.productDate}
                            </span>
                          </div>
                        )}

                        {campaign.matchedIds.length > 0 && (
                          <div
                            className="campaign-detail"
                            style={{ gridColumn: "1 / -1" }}
                          >
                            <span className="campaign-detail-label">
                              Matched Product IDs ({campaign.matchedIds.length})
                            </span>
                            <span className="campaign-detail-value" style={{ fontFamily: "monospace", fontSize: "12px" }}>
                              {campaign.matchedIds.join(", ")}
                            </span>
                          </div>
                        )}

                        {campaign.cartIds && campaign.cartIds.length > 0 && (
                          <div
                            className="campaign-detail"
                            style={{ gridColumn: "1 / -1" }}
                          >
                            <span className="campaign-detail-label" style={{ color: "var(--color-info)" }}>
                              🛒 Cart Row IDs ({campaign.cartIds.length})
                            </span>
                            <span className="campaign-detail-value" style={{ color: "var(--color-info)", fontFamily: "monospace", fontSize: "12px" }}>
                              {campaign.cartIds.join(", ")}
                            </span>
                          </div>
                        )}

                        {campaign.settlementMsg && (
                          <div
                            className="campaign-detail"
                            style={{ gridColumn: "1 / -1" }}
                          >
                            <span className="campaign-detail-label">
                              Settlement Response
                            </span>
                            <span
                              className="campaign-detail-value"
                              style={{
                                color: campaign.status === "SUCCESS" ? "var(--color-success)" : "var(--color-warning)",
                                fontWeight: 600,
                              }}
                            >
                              💬 {campaign.settlementMsg}
                            </span>
                          </div>
                        )}

                        {campaign.lastError && !campaign.settlementMsg && (
                          <div
                            className="campaign-detail"
                            style={{ gridColumn: "1 / -1" }}
                          >
                            <span className="campaign-detail-label">
                              Last Error
                            </span>
                            <span
                              className="campaign-detail-value"
                              style={{
                                color: "var(--color-danger)",
                                fontSize: "13px",
                              }}
                            >
                              {campaign.lastError}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="campaign-card-footer">
                        <span
                          style={{
                            fontSize: "12px",
                            color: "var(--color-text-muted)",
                          }}
                        >
                          Created {formatDate(campaign.createdAt)}
                        </span>

                        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                          {/* Dedicated Inspector & Logs Button */}
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => openInspector(campaign, "overview")}
                            style={{ fontSize: "12px", padding: "4px 10px", background: "rgba(99, 102, 241, 0.12)", borderColor: "rgba(99, 102, 241, 0.3)" }}
                            title="Inspect campaign details & activity logs"
                          >
                            🔍 Details & Logs
                          </button>

                          {campaign.status === "SCHEDULED" && (
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => openEditModal(campaign)}
                              title="Edit campaign"
                            >
                              ✏️ Edit
                            </button>
                          )}

                          {["SCHEDULED", "POLLING"].includes(campaign.status) && (
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => handleCancelCampaign(campaign.id)}
                              style={{ color: "var(--color-warning)" }}
                              title="Cancel campaign"
                            >
                              Cancel
                            </button>
                          )}

                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => handleDeleteCampaign(campaign.id)}
                            title="Delete campaign permanently"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: ACCOUNTS */}
        {activeTab === "accounts" && (
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "20px",
                flexWrap: "wrap",
                gap: "12px",
              }}
            >
              <div>
                <h2 style={{ fontSize: "18px", fontWeight: 600 }}>Your API Accounts</h2>
                <p style={{ fontSize: "13px", color: "var(--color-text-muted)", marginTop: "2px" }}>
                  Each account stores a verified API token. When creating campaigns, you can choose which account to use.
                </p>
              </div>
              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  className="btn btn-secondary"
                  onClick={() => openCartManager()}
                >
                  🛒 View & Clear Cart
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => setShowAccountModal(true)}
                >
                  <span>+</span> Add Account
                </button>
              </div>
            </div>

            {accounts.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">👤</div>
                <div className="empty-state-title">No API accounts added yet</div>
                <div className="empty-state-desc">
                  Add your PepeCards account token. It will be verified against{" "}
                  <code>/v1/member/info</code> automatically!
                </div>
                <button
                  className="btn btn-primary"
                  onClick={() => setShowAccountModal(true)}
                >
                  + Add Your First Account
                </button>
              </div>
            ) : (
              <div className="account-grid">
                {accounts.map((acc) => (
                  <div
                    key={acc.id}
                    className={`account-card ${acc.isDefault ? "is-default" : ""}`}
                  >
                    <div className="account-header">
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ fontSize: "16px", fontWeight: 700 }}>{acc.name}</span>
                          {acc.isDefault && (
                            <span
                              style={{
                                fontSize: "11px",
                                background: "rgba(99, 102, 241, 0.2)",
                                color: "var(--color-primary-light)",
                                padding: "2px 8px",
                                borderRadius: "var(--radius-full)",
                                fontWeight: 700,
                              }}
                            >
                              ★ Default
                            </span>
                          )}
                        </div>
                        <div
                          style={{
                            fontSize: "13px",
                            color: "var(--color-text-muted)",
                            marginTop: "3px",
                          }}
                        >
                          User ID: {acc.remoteUserId || "Verified"} |{" "}
                          <span style={{ color: "var(--color-text-primary)", fontWeight: 600 }}>
                            @{acc.remoteUsername || "unknown"}
                          </span>
                        </div>
                      </div>

                      <div className="balance-chip">
                        <span>💰</span>
                        <span>${acc.balance || "0.00"}</span>
                      </div>
                    </div>

                    {/* Token Preview */}
                    <div>
                      <div
                        style={{
                          fontSize: "12px",
                          color: "var(--color-text-muted)",
                          marginBottom: "4px",
                          display: "flex",
                          justifyContent: "space-between",
                        }}
                      >
                        <span>API Token</span>
                        <button
                          type="button"
                          onClick={() =>
                            setShowTokenMap({
                              ...showTokenMap,
                              [acc.id]: !showTokenMap[acc.id],
                            })
                          }
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "var(--color-primary-light)",
                            cursor: "pointer",
                            fontSize: "11px",
                          }}
                        >
                          {showTokenMap[acc.id] ? "Hide" : "Show"}
                        </button>
                      </div>
                      <div className="token-box">
                        <span>
                          {showTokenMap[acc.id]
                            ? acc.token
                            : `${acc.token.slice(0, 8)}••••••••${acc.token.slice(-6)}`}
                        </span>
                        <button
                          type="button"
                          onClick={() => copyText(acc.token, "Token copied")}
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "var(--color-text-muted)",
                            cursor: "pointer",
                            padding: "2px 6px",
                          }}
                          title="Copy Token"
                        >
                          📋
                        </button>
                      </div>
                    </div>

                    {/* Domain & Usage */}
                    <div
                      style={{
                        fontSize: "12px",
                        color: "var(--color-text-secondary)",
                        display: "flex",
                        justifyContent: "space-between",
                        paddingTop: "6px",
                        borderTop: "1px solid var(--color-border)",
                      }}
                    >
                      <span title={acc.domain || systemDefaultDomain}>
                        🌐 {acc.domain ? new URL(acc.domain).hostname : "Default API"}
                      </span>
                      <span>
                        {acc._count?.campaigns || 0} campaign(s)
                      </span>
                    </div>

                    {/* Actions */}
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        paddingTop: "8px",
                      }}
                    >
                      <div style={{ display: "flex", gap: "6px" }}>
                        {!acc.isDefault && (
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => handleSetDefaultAccount(acc.id)}
                            style={{ fontSize: "12px" }}
                          >
                            Set Default
                          </button>
                        )}
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => handleReverifyAccount(acc.id)}
                          disabled={reverifyingId === acc.id}
                          style={{ fontSize: "12px" }}
                        >
                          {reverifyingId === acc.id ? "Checking..." : "🔄 Re-verify"}
                        </button>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => openCartManager(acc.id)}
                          style={{ fontSize: "12px" }}
                        >
                          🛒 Cart
                        </button>
                      </div>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => handleDeleteAccount(acc.id, acc.name)}
                        style={{ fontSize: "12px", padding: "4px 10px" }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: DOMAINS */}
        {activeTab === "domains" && (
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "20px",
              }}
            >
              <div>
                <h2 style={{ fontSize: "18px", fontWeight: 600 }}>API Base Domains</h2>
                <p style={{ fontSize: "13px", color: "var(--color-text-muted)", marginTop: "2px" }}>
                  Configure multiple API domains or mirror endpoints to poll and execute purchases.
                </p>
              </div>
              <button
                className="btn btn-primary"
                onClick={() => setShowDomainModal(true)}
              >
                <span>+</span> Add Custom Domain
              </button>
            </div>

            <div className="account-grid">
              {/* System Default Domain Card */}
              <div className="account-card is-default">
                <div className="account-header">
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "16px", fontWeight: 700 }}>PepeCards Official</span>
                      <span
                        style={{
                          fontSize: "11px",
                          background: "rgba(16, 185, 129, 0.2)",
                          color: "var(--color-success)",
                          padding: "2px 8px",
                          borderRadius: "var(--radius-full)",
                          fontWeight: 700,
                        }}
                      >
                        Official Default
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: "13px",
                        color: "var(--color-accent-light)",
                        fontFamily: "monospace",
                        marginTop: "6px",
                      }}
                    >
                      {systemDefaultDomain}
                    </div>
                  </div>
                </div>
                <p style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>
                  Built-in API endpoint for member info, product listing, cart operations, and settlement.
                </p>
              </div>

              {/* User Custom Domains */}
              {domains.map((dom) => (
                <div key={dom.id} className="account-card">
                  <div className="account-header">
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ fontSize: "16px", fontWeight: 700 }}>
                          {dom.name || "Custom Mirror"}
                        </span>
                        {dom.isDefault && (
                          <span
                            style={{
                              fontSize: "11px",
                              background: "rgba(99, 102, 241, 0.2)",
                              color: "var(--color-primary-light)",
                              padding: "2px 8px",
                              borderRadius: "var(--radius-full)",
                              fontWeight: 700,
                            }}
                          >
                            Default
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          fontSize: "13px",
                          color: "var(--color-accent-light)",
                          fontFamily: "monospace",
                          marginTop: "6px",
                        }}
                      >
                        {dom.url}
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      paddingTop: "12px",
                      borderTop: "1px solid var(--color-border)",
                    }}
                  >
                    <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                      Added {formatDate(dom.createdAt)}
                    </span>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => handleDeleteDomain(dom.id)}
                      style={{ fontSize: "12px", padding: "4px 10px" }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* MODAL: CAMPAIGN INSPECTOR & LOGS MODAL */}
      {inspectingCampaign && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setInspectingCampaign(null);
          }}
        >
          <div className="modal-content" style={{ maxWidth: "720px", width: "95%" }}>
            <div className="modal-header">
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <h2 style={{ fontSize: "18px", fontWeight: 700 }}>
                  🔍 Campaign Inspector: Bins {inspectingCampaign.bins}
                </h2>
                <span
                  className="badge"
                  style={{
                    color: campaignStatusConfig[inspectingCampaign.status]?.color || "#fff",
                    background: campaignStatusConfig[inspectingCampaign.status]?.bgColor || "rgba(255,255,255,0.1)",
                  }}
                >
                  {campaignStatusConfig[inspectingCampaign.status]?.emoji}{" "}
                  {campaignStatusConfig[inspectingCampaign.status]?.label || inspectingCampaign.status}
                </span>
              </div>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setInspectingCampaign(null)}
                style={{ fontSize: "18px", padding: "4px 8px" }}
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              {/* Subtabs */}
              <div className="modal-subtabs">
                <button
                  className={`modal-subtab ${inspectorTab === "overview" ? "active" : ""}`}
                  onClick={() => setInspectorTab("overview")}
                >
                  📋 Overview & Parameters
                </button>
                <button
                  className={`modal-subtab ${inspectorTab === "cart" ? "active" : ""}`}
                  onClick={() => setInspectorTab("cart")}
                >
                  🛒 Product IDs & Settlement ({inspectingCampaign.matchedIds.length})
                </button>
                <button
                  className={`modal-subtab ${inspectorTab === "logs" ? "active" : ""}`}
                  onClick={() => {
                    setInspectorTab("logs");
                    fetchLogs(inspectingCampaign.id);
                  }}
                >
                  📜 Activity Logs ({campaignLogs.length})
                </button>
              </div>

              {/* TAB 1: OVERVIEW */}
              {inspectorTab === "overview" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                  <div className="campaign-detail">
                    <span className="campaign-detail-label">Campaign ID</span>
                    <button
                      type="button"
                      className="copy-chip"
                      onClick={() => copyText(inspectingCampaign.id, "Campaign ID copied")}
                    >
                      {inspectingCampaign.id} 📋
                    </button>
                  </div>
                  <div className="campaign-detail">
                    <span className="campaign-detail-label">Target Account</span>
                    <span className="campaign-detail-value" style={{ fontWeight: 600 }}>
                      👤 {inspectingCampaign.account?.name || "Default Account"}
                      {inspectingCampaign.account?.remoteUsername && ` (@${inspectingCampaign.account.remoteUsername})`}
                    </span>
                  </div>
                  <div className="campaign-detail">
                    <span className="campaign-detail-label">Target Bins</span>
                    <span className="campaign-detail-value" style={{ fontWeight: 700, color: "var(--color-primary-light)" }}>
                      {inspectingCampaign.bins}
                    </span>
                  </div>
                  <div className="campaign-detail">
                    <span className="campaign-detail-label">Quantity to Buy</span>
                    <span className="campaign-detail-value" style={{ fontWeight: 700, color: "var(--color-text-primary)" }}>
                      {inspectingCampaign.quantity} card(s)
                    </span>
                  </div>
                  <div className="campaign-detail">
                    <span className="campaign-detail-label">Price Range Filter</span>
                    <span className="campaign-detail-value">
                      {inspectingCampaign.minPrice !== null || inspectingCampaign.maxPrice !== null
                        ? `$${inspectingCampaign.minPrice ?? 0} — $${inspectingCampaign.maxPrice ?? "Any"}`
                        : "Any Price"}
                    </span>
                  </div>
                  <div className="campaign-detail">
                    <span className="campaign-detail-label">Release Date Filter (sname)</span>
                    <span className="campaign-detail-value" style={{ color: "var(--color-accent-light)", fontWeight: 600 }}>
                      {inspectingCampaign.productDate ? `≥ ${inspectingCampaign.productDate}` : "Any Date"}
                    </span>
                  </div>
                  <div className="campaign-detail">
                    <span className="campaign-detail-label">Check Toggle Mode</span>
                    <span className="campaign-detail-value">
                      {inspectingCampaign.isCheck === 2 ? "⚡ Check: OFF (is_check: 2)" : "🛡️ Check: ON (is_check: 1)"}
                    </span>
                  </div>
                  <div className="campaign-detail">
                    <span className="campaign-detail-label">Base ID</span>
                    <span className="campaign-detail-value">
                      {inspectingCampaign.baseId || "Any"}
                    </span>
                  </div>
                  <div className="campaign-detail" style={{ gridColumn: "1 / -1" }}>
                    <span className="campaign-detail-label">Target API Domain</span>
                    <span className="campaign-detail-value" style={{ fontFamily: "monospace", fontSize: "12px", color: "var(--color-accent-light)" }}>
                      {inspectingCampaign.domain || systemDefaultDomain}
                    </span>
                  </div>
                  <div className="campaign-detail" style={{ gridColumn: "1 / -1" }}>
                    <span className="campaign-detail-label">Scheduled Publish Time</span>
                    <span className="campaign-detail-value">
                      {formatDate(inspectingCampaign.publishTime)}
                    </span>
                  </div>
                </div>
              )}

              {/* TAB 2: CART & SETTLEMENT */}
              {inspectorTab === "cart" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  {/* Matched Product IDs */}
                  <div
                    style={{
                      background: "var(--color-bg-input)",
                      border: "1px solid var(--color-border)",
                      borderRadius: "var(--radius-md)",
                      padding: "12px 16px",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                      <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-text-secondary)" }}>
                        🎯 Matched Product IDs ({inspectingCampaign.matchedIds.length})
                      </span>
                      {inspectingCampaign.matchedIds.length > 0 && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: "11px", padding: "2px 8px" }}
                          onClick={() => copyText(inspectingCampaign.matchedIds.join(","), "Product IDs copied")}
                        >
                          📋 Copy All
                        </button>
                      )}
                    </div>
                    {inspectingCampaign.matchedIds.length === 0 ? (
                      <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                        No product IDs matched yet. Polling will discover matching products once publish time arrives.
                      </span>
                    ) : (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                        {inspectingCampaign.matchedIds.map((pid) => (
                          <span key={pid} className="copy-chip" onClick={() => copyText(pid, `Product ID #${pid} copied`)}>
                            #{pid} 📋
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Cart Row IDs */}
                  <div
                    style={{
                      background: "var(--color-bg-input)",
                      border: "1px solid var(--color-border)",
                      borderRadius: "var(--radius-md)",
                      padding: "12px 16px",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                      <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-info)" }}>
                        🛒 Cart Row IDs ({inspectingCampaign.cartIds.length})
                      </span>
                      {inspectingCampaign.cartIds.length > 0 && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: "11px", padding: "2px 8px" }}
                          onClick={() => copyText(inspectingCampaign.cartIds.join(","), "Cart IDs copied")}
                        >
                          📋 Copy All
                        </button>
                      )}
                    </div>
                    {inspectingCampaign.cartIds.length === 0 ? (
                      <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                        No cart rows added yet.
                      </span>
                    ) : (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                        {inspectingCampaign.cartIds.map((cid) => (
                          <span key={cid} className="copy-chip" onClick={() => copyText(cid, `Cart ID #${cid} copied`)}>
                            Row #{cid} 📋
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Settlement Response */}
                  <div
                    style={{
                      background:
                        inspectingCampaign.status === "SUCCESS"
                          ? "rgba(16, 185, 129, 0.08)"
                          : "rgba(245, 158, 11, 0.08)",
                      border: `1px solid ${
                        inspectingCampaign.status === "SUCCESS"
                          ? "rgba(16, 185, 129, 0.3)"
                          : "rgba(245, 158, 11, 0.3)"
                      }`,
                      borderRadius: "var(--radius-md)",
                      padding: "12px 16px",
                    }}
                  >
                    <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: "4px" }}>
                      Settlement Order Message
                    </div>
                    <div
                      style={{
                        fontSize: "14px",
                        fontWeight: 600,
                        color:
                          inspectingCampaign.status === "SUCCESS"
                            ? "var(--color-success)"
                            : "var(--color-warning)",
                      }}
                    >
                      💬 {inspectingCampaign.settlementMsg || inspectingCampaign.lastError || "Waiting for execution..."}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: ACTIVITY LOGS */}
              {inspectorTab === "logs" && (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                    <span style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
                      Live timeline for this campaign ({campaignLogs.length} events)
                    </span>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => fetchLogs(inspectingCampaign.id)}
                      disabled={logsLoading}
                      style={{ fontSize: "11px", padding: "3px 10px" }}
                    >
                      {logsLoading ? "Refreshing..." : "🔄 Refresh Logs"}
                    </button>
                  </div>

                  {logsLoading && campaignLogs.length === 0 ? (
                    <div style={{ padding: "20px", textAlign: "center", color: "var(--color-text-muted)" }}>
                      Loading campaign activity logs...
                    </div>
                  ) : campaignLogs.length === 0 ? (
                    <div style={{ padding: "20px", textAlign: "center", color: "var(--color-text-muted)" }}>
                      No logs generated yet.
                    </div>
                  ) : (
                    <div className="timeline-list" style={{ maxHeight: "350px", overflowY: "auto", paddingRight: "8px" }}>
                      {campaignLogs.map((log) => {
                        let dotClass = "polling";
                        let eventColor = "var(--color-accent-light)";

                        if (log.event.includes("MATCH")) {
                          dotClass = "match";
                          eventColor = "var(--color-success)";
                        } else if (log.event.includes("CART")) {
                          dotClass = "cart";
                          eventColor = "var(--color-info)";
                        } else if (log.event.includes("FAIL") || log.event.includes("ERROR") || log.event.includes("TIMEOUT")) {
                          dotClass = "error";
                          eventColor = "var(--color-danger)";
                        } else if (log.event.includes("SUCCESS")) {
                          dotClass = "match";
                          eventColor = "var(--color-success)";
                        }

                        return (
                          <div key={log.id} className="timeline-item">
                            <span className={`timeline-dot ${dotClass}`} />
                            <div className="timeline-header">
                              <span className="timeline-event" style={{ color: eventColor }}>
                                {log.event}
                              </span>
                              <span className="timeline-time">{formatDate(log.createdAt)}</span>
                            </div>
                            <div className="timeline-detail">{log.detail}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setInspectingCampaign(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: REMOTE CART MANAGER */}
      {showCartModal && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowCartModal(false);
          }}
        >
          <div className="modal-content" style={{ maxWidth: "600px", width: "95%" }}>
            <div className="modal-header">
              <div>
                <h2 style={{ fontSize: "18px", fontWeight: 700 }}>🛒 Remote Account Cart</h2>
                <p style={{ fontSize: "12px", color: "var(--color-text-muted)", marginTop: "2px" }}>
                  View items currently stored in this account's cart and clear them if needed.
                </p>
              </div>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowCartModal(false)}
                style={{ fontSize: "18px", padding: "4px 8px" }}
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {/* Account selector */}
                <div className="input-group">
                  <label htmlFor="cart-account-select" className="input-label">
                    Select Account
                  </label>
                  <select
                    id="cart-account-select"
                    className="input"
                    value={selectedCartAccountId}
                    onChange={(e) => {
                      setSelectedCartAccountId(e.target.value);
                      fetchCartItems(e.target.value);
                    }}
                  >
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.name} — @{acc.remoteUsername || "User"} (${acc.balance || "0"})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Items in cart */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-text-secondary)" }}>
                      Items in Cart ({cartItems.length})
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: "12px" }}
                      onClick={() => fetchCartItems(selectedCartAccountId)}
                      disabled={cartLoading}
                    >
                      {cartLoading ? "Checking..." : "🔄 Refresh"}
                    </button>
                  </div>

                  {cartLoading ? (
                    <div style={{ padding: "20px", textAlign: "center", color: "var(--color-text-muted)" }}>
                      Fetching remote cart items...
                    </div>
                  ) : cartItems.length === 0 ? (
                    <div
                      style={{
                        padding: "24px",
                        textAlign: "center",
                        background: "var(--color-bg-input)",
                        borderRadius: "var(--radius-md)",
                        border: "1px solid var(--color-border)",
                      }}
                    >
                      <div style={{ fontSize: "24px", marginBottom: "6px" }}>🛒✨</div>
                      <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-text-primary)" }}>
                        Cart is clean & empty
                      </div>
                      <div style={{ fontSize: "12px", color: "var(--color-text-muted)", marginTop: "2px" }}>
                        No pending items in this remote account cart.
                      </div>
                    </div>
                  ) : (
                    <div
                      style={{
                        maxHeight: "260px",
                        overflowY: "auto",
                        display: "flex",
                        flexDirection: "column",
                        gap: "8px",
                      }}
                    >
                      {cartItems.map((item) => (
                        <div
                          key={item.id}
                          style={{
                            background: "var(--color-bg-card)",
                            border: "1px solid var(--color-border)",
                            borderRadius: "var(--radius-md)",
                            padding: "10px 14px",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                          }}
                        >
                          <div>
                            <div style={{ fontSize: "13px", fontWeight: 600 }}>
                              Card ID: <code>{item.card_id}</code>
                            </div>
                            <div style={{ fontSize: "11px", color: "var(--color-text-muted)", marginTop: "2px" }}>
                              Cart Row ID: <code>{item.id}</code>
                            </div>
                          </div>
                          <span
                            style={{
                              fontSize: "11px",
                              background: "rgba(59, 130, 246, 0.15)",
                              color: "var(--color-info)",
                              padding: "2px 8px",
                              borderRadius: "var(--radius-full)",
                              fontWeight: 600,
                            }}
                          >
                            In Cart
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="modal-footer" style={{ display: "flex", justifyContent: "space-between" }}>
              {cartItems.length > 0 ? (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={handleClearCart}
                  disabled={clearingCart}
                >
                  {clearingCart ? "Clearing..." : "🗑️ Empty Cart (delCart)"}
                </button>
              ) : (
                <div />
              )}
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowCartModal(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: ADD CAMPAIGN */}
      {showCampaignModal && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowCampaignModal(false);
          }}
        >
          <div className="modal-content">
            <div className="modal-header">
              <h2>📦 Add Product Request (Auto-Buy)</h2>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowCampaignModal(false)}
                style={{ fontSize: "18px", padding: "4px 8px" }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateCampaign}>
              <div className="modal-body">
                <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
                  {/* Account Selector */}
                  <div className="input-group">
                    <label htmlFor="campaign-account" className="input-label">
                      Select Account *
                    </label>
                    {accounts.length === 0 ? (
                      <div
                        style={{
                          padding: "12px",
                          background: "rgba(245, 158, 11, 0.1)",
                          border: "1px solid rgba(245, 158, 11, 0.3)",
                          borderRadius: "var(--radius-md)",
                          fontSize: "13px",
                          color: "var(--color-warning)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                        }}
                      >
                        <span>⚠️ No API accounts found. Please add one first!</span>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            setShowCampaignModal(false);
                            setShowAccountModal(true);
                          }}
                        >
                          + Add Account
                        </button>
                      </div>
                    ) : (
                      <select
                        id="campaign-account"
                        className="input"
                        value={campaignForm.accountId}
                        onChange={(e) => {
                          const accId = e.target.value;
                          const acc = accounts.find((a) => a.id === accId);
                          setCampaignForm({
                            ...campaignForm,
                            accountId: accId,
                            domain: acc?.domain || campaignForm.domain || systemDefaultDomain,
                          });
                        }}
                        required
                      >
                        {accounts.map((acc) => (
                          <option key={acc.id} value={acc.id}>
                            {acc.name} — @{acc.remoteUsername || "User"} (${acc.balance || "0"}) {acc.isDefault ? "★ Default" : ""}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  {/* Domain Selector */}
                  <div className="input-group">
                    <label htmlFor="campaign-domain" className="input-label">
                      Domain / API Base URL
                    </label>
                    <select
                      id="campaign-domain"
                      className="input"
                      value={campaignForm.domain}
                      onChange={(e) =>
                        setCampaignForm({ ...campaignForm, domain: e.target.value })
                      }
                    >
                      <option value={systemDefaultDomain}>
                        {systemDefaultDomain} (Default)
                      </option>
                      {domains.map((dom) => (
                        <option key={dom.id} value={dom.url}>
                          {dom.url} ({dom.name || "Mirror"})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Bins */}
                  <div className="input-group">
                    <label htmlFor="campaign-bins" className="input-label">
                      Bins *
                    </label>
                    <input
                      id="campaign-bins"
                      type="text"
                      className="input"
                      placeholder="e.g. 527520"
                      value={campaignForm.bins}
                      onChange={(e) =>
                        setCampaignForm({ ...campaignForm, bins: e.target.value })
                      }
                      required
                    />
                  </div>

                  {/* Product Date (sname filter) */}
                  <div className="input-group">
                    <label htmlFor="campaign-product-date" className="input-label">
                      Product Release Date (sname Date) *
                    </label>
                    <input
                      id="campaign-product-date"
                      type="date"
                      className="input"
                      value={campaignForm.productDate}
                      onChange={(e) =>
                        setCampaignForm({ ...campaignForm, productDate: e.target.value })
                      }
                      required
                    />
                    <span style={{ fontSize: "12px", color: "var(--color-text-muted)", marginTop: "4px" }}>
                      📅 <code>sname</code> ফিল্ডে এই তারিখ থেকে শুরু করে সর্বশেষ তারিখ পর্যন্ত প্রোডাক্টগুলোই শুধু কেনা হবে (যেমন: {campaignForm.productDate || "2026-08-14"})। পুরানো তারিখের প্রোডাক্ট বাদ যাবে।
                    </span>
                  </div>

                  {/* Price Range (Optional) */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                    <div className="input-group">
                      <label htmlFor="campaign-min-price" className="input-label">
                        Min Price <span style={{ color: "var(--color-text-muted)", fontWeight: "normal" }}>(Optional)</span>
                      </label>
                      <input
                        id="campaign-min-price"
                        type="number"
                        className="input"
                        placeholder="e.g. 1"
                        step="0.01"
                        value={campaignForm.minPrice}
                        onChange={(e) =>
                          setCampaignForm({ ...campaignForm, minPrice: e.target.value })
                        }
                      />
                    </div>
                    <div className="input-group">
                      <label htmlFor="campaign-max-price" className="input-label">
                        Max Price <span style={{ color: "var(--color-text-muted)", fontWeight: "normal" }}>(Optional)</span>
                      </label>
                      <input
                        id="campaign-max-price"
                        type="number"
                        className="input"
                        placeholder="e.g. 3"
                        step="0.01"
                        value={campaignForm.maxPrice}
                        onChange={(e) =>
                          setCampaignForm({ ...campaignForm, maxPrice: e.target.value })
                        }
                      />
                    </div>
                  </div>

                  {/* Quantity & Base ID (Optional) */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                    <div className="input-group">
                      <label htmlFor="campaign-quantity" className="input-label">
                        Quantity *
                      </label>
                      <input
                        id="campaign-quantity"
                        type="number"
                        className="input"
                        placeholder="1"
                        min="1"
                        value={campaignForm.quantity}
                        onChange={(e) =>
                          setCampaignForm({ ...campaignForm, quantity: e.target.value })
                        }
                        required
                      />
                    </div>
                    <div className="input-group">
                      <label htmlFor="campaign-base-id" className="input-label">
                        Base ID <span style={{ color: "var(--color-text-muted)", fontWeight: "normal" }}>(Optional)</span>
                      </label>
                      <input
                        id="campaign-base-id"
                        type="text"
                        className="input"
                        placeholder="e.g. 12167"
                        value={campaignForm.baseId}
                        onChange={(e) =>
                          setCampaignForm({ ...campaignForm, baseId: e.target.value })
                        }
                      />
                    </div>
                  </div>

                  {/* Publish Time */}
                  <div className="input-group">
                    <label htmlFor="campaign-publish-time" className="input-label">
                      Publish Time *
                    </label>
                    <input
                      id="campaign-publish-time"
                      type="datetime-local"
                      className="input"
                      value={campaignForm.publishTime}
                      onChange={(e) =>
                        setCampaignForm({
                          ...campaignForm,
                          publishTime: e.target.value,
                        })
                      }
                      required
                    />
                  </div>

                  {/* Check Option (is_check: 1 vs 2) */}
                  <div className="input-group">
                    <label className="input-label">Order Check Mode (is_check)</label>
                    <div className="toggle-wrapper">
                      <input
                        id="campaign-check-toggle"
                        type="checkbox"
                        className="toggle"
                        checked={campaignForm.isCheck === 1}
                        onChange={(e) =>
                          setCampaignForm({
                            ...campaignForm,
                            isCheck: e.target.checked ? 1 : 2,
                          })
                        }
                      />
                      <label
                        htmlFor="campaign-check-toggle"
                        style={{
                          fontSize: "14px",
                          cursor: "pointer",
                          color:
                            campaignForm.isCheck === 1
                              ? "var(--color-success)"
                              : "var(--color-warning)",
                          fontWeight: 600,
                        }}
                      >
                        {campaignForm.isCheck === 1
                          ? "🛡️ Check: ON (is_check = 1) — Refundable & Verified check"
                          : "⚡ Check: OFF (is_check = 2) — Fast settlement / No check"}
                      </label>
                    </div>
                    <span style={{ fontSize: "12px", color: "var(--color-text-muted)", marginTop: "4px" }}>
                      চেক বাটন ON রাখলে settlement এ <code>is_check = 1</code> যাবে, OFF রাখলে <code>is_check = 2</code> যাবে।
                    </span>
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowCampaignModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={campaignSubmitting || accounts.length === 0}
                >
                  {campaignSubmitting ? (
                    <>
                      <span className="spinner" /> Creating...
                    </>
                  ) : (
                    "Create Auto-Buy Campaign"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: EDIT CAMPAIGN */}
      {showEditModal && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowEditModal(false);
          }}
        >
          <div className="modal-content">
            <div className="modal-header">
              <h2>✏️ Edit Campaign</h2>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowEditModal(false)}
                style={{ fontSize: "18px", padding: "4px 8px" }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleUpdateCampaign}>
              <div className="modal-body">
                <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
                  {/* Account Selector */}
                  <div className="input-group">
                    <label htmlFor="edit-campaign-account" className="input-label">
                      Select Account *
                    </label>
                    <select
                      id="edit-campaign-account"
                      className="input"
                      value={editForm.accountId}
                      onChange={(e) =>
                        setEditForm({ ...editForm, accountId: e.target.value })
                      }
                      required
                    >
                      <option value="">-- No specific account --</option>
                      {accounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.name} — @{acc.remoteUsername || "User"} (${acc.balance || "0"})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Domain Selector */}
                  <div className="input-group">
                    <label htmlFor="edit-campaign-domain" className="input-label">
                      Domain / API Base URL
                    </label>
                    <select
                      id="edit-campaign-domain"
                      className="input"
                      value={editForm.domain}
                      onChange={(e) =>
                        setEditForm({ ...editForm, domain: e.target.value })
                      }
                    >
                      <option value={systemDefaultDomain}>
                        {systemDefaultDomain} (Default)
                      </option>
                      {domains.map((dom) => (
                        <option key={dom.id} value={dom.url}>
                          {dom.url} ({dom.name || "Mirror"})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Bins */}
                  <div className="input-group">
                    <label htmlFor="edit-campaign-bins" className="input-label">
                      Bins *
                    </label>
                    <input
                      id="edit-campaign-bins"
                      type="text"
                      className="input"
                      placeholder="e.g. 527520"
                      value={editForm.bins}
                      onChange={(e) =>
                        setEditForm({ ...editForm, bins: e.target.value })
                      }
                      required
                    />
                  </div>

                  {/* Product Date (sname filter) */}
                  <div className="input-group">
                    <label htmlFor="edit-campaign-product-date" className="input-label">
                      Product Release Date (sname Date) *
                    </label>
                    <input
                      id="edit-campaign-product-date"
                      type="date"
                      className="input"
                      value={editForm.productDate}
                      onChange={(e) =>
                        setEditForm({ ...editForm, productDate: e.target.value })
                      }
                      required
                    />
                    <span style={{ fontSize: "12px", color: "var(--color-text-muted)", marginTop: "4px" }}>
                      📅 <code>sname</code> ফিল্ডে এই তারিখ থেকে সর্বশেষ তারিখ পর্যন্ত প্রোডাক্টগুলোই শুধু কেনা হবে।
                    </span>
                  </div>

                  {/* Price Range (Optional) */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                    <div className="input-group">
                      <label htmlFor="edit-campaign-min-price" className="input-label">
                        Min Price <span style={{ color: "var(--color-text-muted)", fontWeight: "normal" }}>(Optional)</span>
                      </label>
                      <input
                        id="edit-campaign-min-price"
                        type="number"
                        className="input"
                        step="0.01"
                        placeholder="e.g. 1"
                        value={editForm.minPrice}
                        onChange={(e) =>
                          setEditForm({ ...editForm, minPrice: e.target.value })
                        }
                      />
                    </div>
                    <div className="input-group">
                      <label htmlFor="edit-campaign-max-price" className="input-label">
                        Max Price <span style={{ color: "var(--color-text-muted)", fontWeight: "normal" }}>(Optional)</span>
                      </label>
                      <input
                        id="edit-campaign-max-price"
                        type="number"
                        className="input"
                        step="0.01"
                        placeholder="e.g. 3"
                        value={editForm.maxPrice}
                        onChange={(e) =>
                          setEditForm({ ...editForm, maxPrice: e.target.value })
                        }
                      />
                    </div>
                  </div>

                  {/* Quantity & Base ID (Optional) */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                    <div className="input-group">
                      <label htmlFor="edit-campaign-quantity" className="input-label">
                        Quantity *
                      </label>
                      <input
                        id="edit-campaign-quantity"
                        type="number"
                        className="input"
                        min="1"
                        value={editForm.quantity}
                        onChange={(e) =>
                          setEditForm({ ...editForm, quantity: e.target.value })
                        }
                        required
                      />
                    </div>
                    <div className="input-group">
                      <label htmlFor="edit-campaign-base-id" className="input-label">
                        Base ID <span style={{ color: "var(--color-text-muted)", fontWeight: "normal" }}>(Optional)</span>
                      </label>
                      <input
                        id="edit-campaign-base-id"
                        type="text"
                        className="input"
                        placeholder="e.g. 12167"
                        value={editForm.baseId}
                        onChange={(e) =>
                          setEditForm({ ...editForm, baseId: e.target.value })
                        }
                      />
                    </div>
                  </div>

                  {/* Publish Time */}
                  <div className="input-group">
                    <label htmlFor="edit-campaign-publish-time" className="input-label">
                      Publish Time *
                    </label>
                    <input
                      id="edit-campaign-publish-time"
                      type="datetime-local"
                      className="input"
                      value={editForm.publishTime}
                      onChange={(e) =>
                        setEditForm({
                          ...editForm,
                          publishTime: e.target.value,
                        })
                      }
                      required
                    />
                  </div>

                  {/* Check Option (is_check: 1 vs 2) */}
                  <div className="input-group">
                    <label className="input-label">Order Check Mode (is_check)</label>
                    <div className="toggle-wrapper">
                      <input
                        id="edit-campaign-check-toggle"
                        type="checkbox"
                        className="toggle"
                        checked={editForm.isCheck === 1}
                        onChange={(e) =>
                          setEditForm({
                            ...editForm,
                            isCheck: e.target.checked ? 1 : 2,
                          })
                        }
                      />
                      <label
                        htmlFor="edit-campaign-check-toggle"
                        style={{
                          fontSize: "14px",
                          cursor: "pointer",
                          color:
                            editForm.isCheck === 1
                              ? "var(--color-success)"
                              : "var(--color-warning)",
                          fontWeight: 600,
                        }}
                      >
                        {editForm.isCheck === 1
                          ? "🛡️ Check: ON (is_check = 1) — Refundable & Verified check"
                          : "⚡ Check: OFF (is_check = 2) — Fast settlement / No check"}
                      </label>
                    </div>
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowEditModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={editSubmitting}
                >
                  {editSubmitting ? (
                    <>
                      <span className="spinner" /> Saving Changes...
                    </>
                  ) : (
                    "Save Changes"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: ADD ACCOUNT */}
      {showAccountModal && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAccountModal(false);
          }}
        >
          <div className="modal-content">
            <div className="modal-header">
              <h2>👤 Add API Account</h2>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowAccountModal(false)}
                style={{ fontSize: "18px", padding: "4px 8px" }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateAccount}>
              <div className="modal-body">
                <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
                  <div
                    style={{
                      background: "rgba(99, 102, 241, 0.08)",
                      border: "1px solid rgba(99, 102, 241, 0.2)",
                      borderRadius: "var(--radius-md)",
                      padding: "12px",
                      fontSize: "13px",
                      color: "var(--color-text-secondary)",
                      lineHeight: 1.5,
                    }}
                  >
                    <span>🛡️ <strong>Live Verification:</strong> একাউন্ট যোগ করার সময় স্বয়ংক্রিয়ভাবে{" "}
                    <code>/v1/member/info</code> এ টোকেন যাচাই করা হবে এবং আপনার ব্যালেন্স ও ইউজারনেম সিঙ্ক হবে।</span>
                  </div>

                  <div className="input-group">
                    <label htmlFor="account-name" className="input-label">
                      Account Label / Name *
                    </label>
                    <input
                      id="account-name"
                      type="text"
                      className="input"
                      placeholder="e.g. My Main Account, Account 1"
                      value={accountForm.name}
                      onChange={(e) =>
                        setAccountForm({ ...accountForm, name: e.target.value })
                      }
                      required
                      autoFocus
                    />
                  </div>

                  <div className="input-group">
                    <label htmlFor="account-token" className="input-label">
                      API Token *
                    </label>
                    <textarea
                      id="account-token"
                      className="input"
                      style={{ minHeight: "80px", fontFamily: "monospace", fontSize: "13px" }}
                      placeholder="Paste your token here (e.g. d5c19325-69b5-4942-851e-b4d2ef000ebc)"
                      value={accountForm.token}
                      onChange={(e) =>
                        setAccountForm({ ...accountForm, token: e.target.value })
                      }
                      required
                    />
                  </div>

                  <div className="input-group">
                    <label htmlFor="account-domain" className="input-label">
                      API Domain (Optional)
                    </label>
                    <input
                      id="account-domain"
                      type="text"
                      className="input"
                      placeholder={systemDefaultDomain}
                      value={accountForm.domain}
                      onChange={(e) =>
                        setAccountForm({ ...accountForm, domain: e.target.value })
                      }
                    />
                    <span style={{ fontSize: "12px", color: "var(--color-text-muted)", marginTop: "4px" }}>
                      ফাঁকা রাখলে ডিফল্ট <code>{systemDefaultDomain}</code> ব্যবহার হবে।
                    </span>
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowAccountModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={accountSubmitting}
                >
                  {accountSubmitting ? (
                    <>
                      <span className="spinner" /> Verifying Token...
                    </>
                  ) : (
                    "Verify & Save Account"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: ADD DOMAIN */}
      {showDomainModal && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowDomainModal(false);
          }}
        >
          <div className="modal-content">
            <div className="modal-header">
              <h2>🌐 Add Custom Domain</h2>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowDomainModal(false)}
                style={{ fontSize: "18px", padding: "4px 8px" }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateDomain}>
              <div className="modal-body">
                <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
                  <div className="input-group">
                    <label htmlFor="domain-name" className="input-label">
                      Domain Label (Optional)
                    </label>
                    <input
                      id="domain-name"
                      type="text"
                      className="input"
                      placeholder="e.g. Mirror Server 1"
                      value={domainForm.name}
                      onChange={(e) =>
                        setDomainForm({ ...domainForm, name: e.target.value })
                      }
                    />
                  </div>

                  <div className="input-group">
                    <label htmlFor="domain-url" className="input-label">
                      Domain URL *
                    </label>
                    <input
                      id="domain-url"
                      type="text"
                      className="input"
                      placeholder="https://api.pepecards2f7z1qtyyg.top"
                      value={domainForm.url}
                      onChange={(e) =>
                        setDomainForm({ ...domainForm, url: e.target.value })
                      }
                      required
                    />
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowDomainModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={domainSubmitting}
                >
                  {domainSubmitting ? (
                    <>
                      <span className="spinner" /> Saving...
                    </>
                  ) : (
                    "Save Domain"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
