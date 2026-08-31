"use client";

import { useState, useEffect, useCallback } from "react";
import { userStatusConfig, formatDate } from "@/app/_lib/utils";

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  defaultDomain: string | null;
  createdAt: string;
  _count: { campaigns: number };
}

interface Stats {
  users: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
  };
  campaigns: {
    total: number;
    active: number;
    success: number;
    failed: number;
  };
}

export default function AdminPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const params = filter !== "all" ? `?status=${filter}` : "";
      const [usersRes, statsRes] = await Promise.all([
        fetch(`/api/admin/users${params}`),
        fetch("/api/admin/stats"),
      ]);

      if (usersRes.ok) {
        const usersData = await usersRes.json();
        setUsers(usersData.users);
      }
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData);
      }
    } catch (err) {
      console.error("Failed to fetch admin data:", err);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }

  async function handleStatusChange(userId: string, newStatus: string) {
    setUpdatingId(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (res.ok) {
        showToast(
          `User ${newStatus.toLowerCase()} successfully`,
          "success"
        );
        fetchData();
      } else {
        const data = await res.json();
        showToast(data.error || "Failed to update user", "error");
      }
    } catch {
      showToast("Something went wrong", "error");
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <>
      {/* Toast */}
      {toast && (
        <div className={`toast toast-${toast.type}`}>
          <span>{toast.type === "success" ? "✅" : "❌"}</span>
          {toast.message}
        </div>
      )}

      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 style={{ fontSize: "22px", fontWeight: 700 }}>Admin Panel</h1>
          <p
            style={{
              fontSize: "14px",
              color: "var(--color-text-muted)",
              marginTop: "2px",
            }}
          >
            Manage users and system settings
          </p>
        </div>
      </div>

      <div className="page-body">
        {/* Stats */}
        {stats && (
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-label">Total Users</div>
              <div
                className="stat-value"
                style={{ color: "var(--color-primary-light)" }}
              >
                {stats.users.total}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Pending Approval</div>
              <div
                className="stat-value"
                style={{ color: "var(--color-warning)" }}
              >
                {stats.users.pending}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Total Campaigns</div>
              <div
                className="stat-value"
                style={{ color: "var(--color-accent)" }}
              >
                {stats.campaigns.total}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Active Campaigns</div>
              <div
                className="stat-value"
                style={{ color: "var(--color-success)" }}
              >
                {stats.campaigns.active}
              </div>
            </div>
          </div>
        )}

        {/* Filter Tabs */}
        <div
          style={{
            display: "flex",
            gap: "8px",
            marginBottom: "24px",
            flexWrap: "wrap",
          }}
        >
          {[
            { key: "all", label: "All Users" },
            { key: "PENDING", label: "⏳ Pending" },
            { key: "APPROVED", label: "✅ Approved" },
            { key: "REJECTED", label: "❌ Rejected" },
          ].map((tab) => (
            <button
              key={tab.key}
              className={`btn btn-sm ${
                filter === tab.key ? "btn-primary" : "btn-secondary"
              }`}
              onClick={() => {
                setFilter(tab.key);
                setLoading(true);
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Users Table */}
        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="skeleton"
                style={{ height: "56px", borderRadius: "var(--radius-md)" }}
              />
            ))}
          </div>
        ) : users.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">👥</div>
            <div className="empty-state-title">No users found</div>
            <div className="empty-state-desc">
              No users match the current filter.
            </div>
          </div>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Status</th>
                  <th>Campaigns</th>
                  <th>Joined</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const statusCfg =
                    userStatusConfig[user.status] || userStatusConfig.PENDING;
                  const isUpdating = updatingId === user.id;

                  return (
                    <tr key={user.id}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                          <div
                            style={{
                              width: "36px",
                              height: "36px",
                              borderRadius: "50%",
                              background:
                                user.role === "ADMIN"
                                  ? "linear-gradient(135deg, #f59e0b, #ef4444)"
                                  : "linear-gradient(135deg, var(--color-primary), var(--color-accent))",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: "14px",
                              fontWeight: 700,
                              color: "white",
                              flexShrink: 0,
                            }}
                          >
                            {user.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div
                              style={{
                                fontWeight: 600,
                                fontSize: "14px",
                                display: "flex",
                                alignItems: "center",
                                gap: "6px",
                              }}
                            >
                              {user.name}
                              {user.role === "ADMIN" && (
                                <span
                                  className="badge"
                                  style={{
                                    background: "rgba(245, 158, 11, 0.15)",
                                    color: "#f59e0b",
                                    fontSize: "10px",
                                    padding: "2px 6px",
                                  }}
                                >
                                  ADMIN
                                </span>
                              )}
                            </div>
                            <div
                              style={{
                                fontSize: "13px",
                                color: "var(--color-text-muted)",
                              }}
                            >
                              {user.email}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span
                          className="badge"
                          style={{
                            color: statusCfg.color,
                            background: statusCfg.bgColor,
                          }}
                        >
                          {statusCfg.label}
                        </span>
                      </td>
                      <td>{user._count.campaigns}</td>
                      <td>
                        <span style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
                          {formatDate(user.createdAt)}
                        </span>
                      </td>
                      <td>
                        {user.role !== "ADMIN" && (
                          <div
                            style={{
                              display: "flex",
                              gap: "6px",
                            }}
                          >
                            {user.status !== "APPROVED" && (
                              <button
                                className="btn btn-success btn-sm"
                                onClick={() =>
                                  handleStatusChange(user.id, "APPROVED")
                                }
                                disabled={isUpdating}
                              >
                                {isUpdating ? (
                                  <span className="spinner" />
                                ) : (
                                  "Approve"
                                )}
                              </button>
                            )}
                            {user.status !== "REJECTED" && (
                              <button
                                className="btn btn-danger btn-sm"
                                onClick={() =>
                                  handleStatusChange(user.id, "REJECTED")
                                }
                                disabled={isUpdating}
                              >
                                {isUpdating ? (
                                  <span className="spinner" />
                                ) : (
                                  "Reject"
                                )}
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
